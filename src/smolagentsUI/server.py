import os
import json
import base64
import io
import datetime
import uuid
from typing import List, Dict, Any, Optional

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit

from smolagents.memory import (
    ActionStep, 
    PlanningStep, 
    FinalAnswerStep, 
    ToolCall, 
    TaskStep, 
    SystemPromptStep
)
from smolagents.monitoring import Timing
from smolagents.models import ChatMessageStreamDelta
from smolagents.agent_types import AgentImage, AgentAudio

current_agent = None
current_storage_file = None
current_session_id = None

def serve(agent, host="127.0.0.1", port=5000, debug=True, storage_path="MyChats.json"):
    global current_agent, current_storage_file
    current_agent = agent
    current_storage_file = storage_path
    
    if current_storage_file and not os.path.exists(current_storage_file):
        with open(current_storage_file, 'w', encoding='utf-8') as f:
            json.dump([], f)
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app = Flask(__name__, 
                template_folder=os.path.join(base_dir, 'templates'),
                static_folder=os.path.join(base_dir, 'static'))
    
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

    # --- Helpers ---

    def _load_db():
        if not current_storage_file or not os.path.exists(current_storage_file):
            return []
        try:
            with open(current_storage_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️ Error reading history file: {e}")
            return []

    def _save_db(sessions):
        if not current_storage_file:
            return
        try:
            with open(current_storage_file, 'w', encoding='utf-8') as f:
                json.dump(sessions, f, indent=2)
        except Exception as e:
            print(f"❌ Error saving history: {e}")

    def _serialize_step(step) -> Dict[str, Any]:
        data = {"type": type(step).__name__}
        
        if isinstance(step, TaskStep):
            data["task"] = step.task
            data["task_images"] = []
            
        elif isinstance(step, ActionStep):
            data["step_number"] = step.step_number
            data["code"] = step.code_action
            data["observations"] = step.observations
            data["error"] = str(step.error) if step.error else None
            
            timing_obj = getattr(step, "duration", getattr(step, "timing", None))
            if hasattr(timing_obj, "dict"):
                data["timing"] = timing_obj.dict()
            else:
                data["timing"] = None
            
            images = []
            if step.observations_images:
                for img in step.observations_images:
                    if img:
                        try:
                            buffered = io.BytesIO()
                            img.save(buffered, format="PNG")
                            img_str = base64.b64encode(buffered.getvalue()).decode()
                            images.append(img_str)
                        except Exception:
                            pass
            data["images"] = images

        elif isinstance(step, FinalAnswerStep):
            if isinstance(step.output, AgentImage):
                try:
                    buffered = io.BytesIO()
                    step.output.to_raw().save(buffered, format="PNG")
                    img_str = base64.b64encode(buffered.getvalue()).decode()
                    data["content"] = img_str
                    data["is_image"] = True
                except:
                    data["content"] = "Error saving final image"
            else:
                data["content"] = str(step.output)
                data["is_image"] = False

        return data

    def _save_current_session(final_step=None):
        """
        Saves the current memory. 
        Args:
            final_step: The FinalAnswerStep if available (since it might not be in memory.steps)
        """
        global current_session_id
        if not current_storage_file or not current_agent:
            return

        if not current_session_id:
            current_session_id = str(uuid.uuid4())

        # 1. Prepare steps list
        # We copy the list to avoid mutating the actual agent memory
        steps_to_save = list(current_agent.memory.steps)
        
        # 2. Append FinalAnswerStep if provided and not already present
        if final_step:
            # Check if the last step is already this final step to avoid dupes
            if not steps_to_save or steps_to_save[-1] is not final_step:
                steps_to_save.append(final_step)

        steps_data = [_serialize_step(step) for step in steps_to_save]
        
        preview = "New Chat"
        for step in steps_to_save:
            if isinstance(step, TaskStep):
                preview = step.task[:50] + "..."
                break
        
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        sessions = _load_db()
        existing_idx = next((i for i, s in enumerate(sessions) if s["id"] == current_session_id), -1)
        
        session_data = {
            "id": current_session_id,
            "timestamp": timestamp,
            "preview": preview,
            "steps": steps_data
        }

        if existing_idx >= 0:
            sessions[existing_idx] = session_data
        else:
            sessions.insert(0, session_data)

        _save_db(sessions)
        handle_get_history()

    def _rehydrate_memory(steps_data):
        new_steps = []
        for s in steps_data:
            step_type = s.get("type")
            
            if step_type == "TaskStep":
                new_steps.append(TaskStep(task=s["task"], task_images=[]))
                
            elif step_type == "ActionStep":
                timing_data = s.get("timing")
                timing_obj = None
                if isinstance(timing_data, dict):
                    timing_obj = Timing(
                        start_time=timing_data.get("start_time", 0.0),
                        end_time=timing_data.get("end_time")
                    )
                else:
                    timing_obj = Timing(start_time=0.0, end_time=0.0)

                step = ActionStep(
                    step_number=s.get("step_number", 1),
                    code_action=s.get("code"),
                    observations=s.get("observations"),
                    observations_images=[], 
                    error=s.get("error"),
                    timing=timing_obj
                )
                new_steps.append(step)
                
            elif step_type == "FinalAnswerStep":
                content = s.get("content")
                new_steps.append(FinalAnswerStep(output=content))
        
        current_agent.memory.steps = new_steps

    # --- Routes ---

    @app.route('/')
    def index():
        return render_template('index.html')

    @socketio.on('get_history')
    def handle_get_history():
        sessions = _load_db()
        summary_list = [{
            "id": s["id"], 
            "timestamp": s["timestamp"], 
            "preview": s.get("preview", "No preview")
        } for s in sessions]
        emit('history_list', {'sessions': summary_list})

    @socketio.on('new_chat')
    def handle_new_chat():
        global current_session_id
        current_session_id = None
        if current_agent:
            current_agent.memory.steps = []
        emit('reload_chat', {'steps': []})

    @socketio.on('load_session')
    def handle_load_session(data):
        global current_session_id
        target_id = data.get('id')
        sessions = _load_db()
        session = next((s for s in sessions if s["id"] == target_id), None)
        
        if not session:
            emit('error', {'message': "Session not found"})
            return
            
        print(f"📂 Loading session: {target_id}")
        current_session_id = target_id
        _rehydrate_memory(session.get("steps", []))
        emit('reload_chat', session)

    @socketio.on('start_run')
    def handle_run(data):
        global current_session_id
        task = data.get('message')
        if not task or not current_agent:
            return

        if current_session_id is None:
             current_session_id = str(uuid.uuid4())

        print(f"🚀 Starting run: {task}")
        captured_final_step = None # Store the final step if we see it
        
        try:
            emit('agent_start')
            stream = current_agent.run(task, stream=True, reset=False)
            
            for step in stream:
                socketio.sleep(0)
                
                # Check for FinalAnswerStep
                if isinstance(step, FinalAnswerStep):
                    captured_final_step = step
                    process_final_answer(step)
                
                elif isinstance(step, ChatMessageStreamDelta):
                    if step.content:
                        emit('stream_delta', {'content': step.content})
                elif isinstance(step, ToolCall):
                    emit('tool_start', {'tool_name': step.name, 'arguments': str(step.arguments)})
                elif isinstance(step, ActionStep):
                    process_action_step(step)
                elif isinstance(step, PlanningStep):
                    emit('planning_step', {'plan': step.plan})

        except Exception as e:
            print(f"Error: {e}")
            emit('error', {'message': str(e)})
        finally:
            emit('run_complete')
            # Pass the captured step to the save function
            _save_current_session(final_step=captured_final_step)

    def process_action_step(step: ActionStep):
        images = []
        if step.observations_images:
            for img in step.observations_images:
                if img:
                    try:
                        buffered = io.BytesIO()
                        img.save(buffered, format="PNG")
                        img_str = base64.b64encode(buffered.getvalue()).decode()
                        images.append(f"data:image/png;base64,{img_str}")
                    except Exception:
                        pass

        emit('action_step', {
            'step_number': step.step_number,
            'code': step.code_action,
            'observations': step.observations or "",
            'images': images,
            'error': str(step.error) if step.error else None
        })

    def process_final_answer(step: FinalAnswerStep):
        result = step.output
        content = ""
        type_ = "text"

        if isinstance(result, AgentImage):
            type_ = "image"
            try:
                buffered = io.BytesIO()
                result.to_raw().save(buffered, format="PNG")
                img_str = base64.b64encode(buffered.getvalue()).decode()
                content = f"data:image/png;base64,{img_str}"
            except:
                content = "Error processing image"
        else:
            content = str(result)

        emit('final_answer', {'type': type_, 'content': content})

    print(f"✨ SmolagentsUI running on http://{host}:{port}")
    socketio.run(app, host=host, port=port, debug=debug)