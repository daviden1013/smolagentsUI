import os
import json
import base64
import io

from flask import Flask, render_template
from flask_socketio import SocketIO, emit

from smolagents.memory import ActionStep, PlanningStep, FinalAnswerStep, ToolCall
from smolagents.models import ChatMessageStreamDelta
from smolagents.agent_types import AgentImage, AgentAudio

current_agent = None

def serve(agent, host="127.0.0.1", port=5000, debug=True):
    global current_agent
    current_agent = agent
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app = Flask(__name__, 
                template_folder=os.path.join(base_dir, 'templates'),
                static_folder=os.path.join(base_dir, 'static'))
    
    # Use threading mode for compatibility with OpenAI/Trio/HttpCore
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

    @app.route('/')
    def index():
        return render_template('index.html')

    @socketio.on('start_run')
    def handle_run(data):
        task = data.get('message')
        if not task or not current_agent:
            return

        print(f"🚀 Starting run: {task}")
        
        try:
            emit('agent_start')

            # Run with stream=True
            # reset=False keeps conversation history in memory
            stream = current_agent.run(task, stream=True, reset=False)
            
            for step in stream:
                # Yield control to the socket thread to flush data to client immediately
                socketio.sleep(0)

                if isinstance(step, ChatMessageStreamDelta):
                    if step.content:
                        emit('stream_delta', {'content': step.content})
                
                elif isinstance(step, ToolCall):
                    emit('tool_start', {
                        'tool_name': step.name,
                        'arguments': str(step.arguments)
                    })

                elif isinstance(step, ActionStep):
                    process_action_step(step)
                
                elif isinstance(step, PlanningStep):
                    emit('planning_step', {'plan': step.plan})

                elif isinstance(step, FinalAnswerStep):
                    process_final_answer(step)

        except Exception as e:
            print(f"Error: {e}")
            emit('error', {'message': str(e)})
        finally:
            emit('run_complete')

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