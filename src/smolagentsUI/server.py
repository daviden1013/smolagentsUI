import os
import json
import traceback
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit

# Import our new modules
from .conversation_manager import ConversationManager
from .agent_wrapper import AgentWrapper

from smolagents.memory import TaskStep

current_agent_wrapper = None
conversation_manager = None
current_session_id = None

def serve(agent, host="127.0.0.1", port=5000, debug=True, storage_path=None):
    global current_agent_wrapper, conversation_manager, current_session_id
    
    # Initialize Core Components
    current_agent_wrapper = AgentWrapper(agent)
    conversation_manager = ConversationManager(storage_path)
    
    # Initialize Flask
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app = Flask(__name__, 
                template_folder=os.path.join(base_dir, 'templates'),
                static_folder=os.path.join(base_dir, 'static'))
    
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

    # --- Routes ---

    @app.route('/')
    def index():
        return render_template('index.html')

    # --- Socket Events ---

    @socketio.on('get_history')
    def handle_get_history():
        summary_list = conversation_manager.get_session_summaries()
        emit('history_list', {'sessions': summary_list})

    @socketio.on('new_chat')
    def handle_new_chat():
        global current_session_id
        current_session_id = None
        current_agent_wrapper.clear_memory()
        emit('reload_chat', {'steps': []})

    @socketio.on('load_session')
    def handle_load_session(data):
        global current_session_id
        target_id = data.get('id')
        session = conversation_manager.get_session(target_id)
        
        if not session:
            emit('error', {'message': "Session not found"})
            return
            
        print(f"📂 Loading session: {target_id}")
        current_session_id = target_id
        current_agent_wrapper.load_memory(session.get("steps", []))
        emit('reload_chat', session)

    @socketio.on('start_run')
    def handle_run(data):
        global current_session_id
        task = data.get('message')
        if not task or not current_agent_wrapper:
            return

        print(f"🚀 Starting run: {task}")
        
        try:
            emit('agent_start')
            
            # Use manual iteration to capture the return value of the generator.
            # The agent_wrapper.run() generator returns the FinalAnswerStep object
            # upon completion, which we need for saving.
            generator = current_agent_wrapper.run(task)
            
            while True:
                try:
                    event = next(generator)
                    socketio.sleep(0) # Yield to event loop
                    emit(event['type'], event) # Pass events directly to UI
                except StopIteration as e:
                    break

        except Exception as e:
            print(f"Error: {e}")
            print(f"Caught exception type: {type(e).__name__}")
            traceback.print_exc()
            emit('error', {'message': str(e)})
        finally:
            emit('run_complete')
            
            # --- Saving Logic ---
            # Retrieve the full finalized memory.
            # We pass captured_final_step so get_steps_data can append it if it's missing from memory.
            steps_data = current_agent_wrapper.get_steps_data()
            
            # Determine preview text (Task name)
            preview = "New Chat"
            if len(steps_data) > 0 and steps_data[0].get('task'):
                 preview = steps_data[0]['task'][:50] + "..."

            # Save
            current_session_id = conversation_manager.save_session(
                current_session_id, 
                steps_data, 
                task_preview=preview
            )
            
            # Refresh history list in UI
            handle_get_history()

    print(f"✨ SmolagentsUI running on http://{host}:{port}")
    socketio.run(app, host=host, port=port, debug=debug)