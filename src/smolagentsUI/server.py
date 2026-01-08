import os
import traceback
import copy
import uuid
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
from .conversation_manager import ConversationManager
from .agent_wrapper import AgentWrapper
from smolagents.memory import TaskStep

# Global State
prototype_agent = None  # The user-provided agent (template)
active_agents = {}    # Maps session_id -> AgentWrapper instance
stop_signals = {}       # Maps session_id -> bool (True if stop requested)
conversation_manager = None

def get_agent_wrapper(session_id):
    """
    Retrieves an existing agent wrapper for the session, 
    or creates a new 'child' agent from the prototype.
    """
    global active_agents, prototype_agent
    
    if session_id in active_agents:
        print(f"🔄 Reusing existing agent for session: {session_id}")
        return active_agents[session_id]

    print(f"✨ Spawning new agent for session: {session_id}")
    
    # Copy the prototype agent
    new_agent = copy.copy(prototype_agent)
    new_agent.memory = copy.deepcopy(prototype_agent.memory)
    new_agent.memory.reset()
    if hasattr(prototype_agent, 'python_executor'):
        new_agent.python_executor = copy.deepcopy(prototype_agent.python_executor)
    
    new_agent.python_executor.state.clear()
    
    # Wrap new agent
    wrapper = AgentWrapper(new_agent)
    
    # Load history if this is an old session being resumed
    session_data = conversation_manager.get_session(session_id)
    if session_data:
        wrapper.load_memory(session_data.get("steps", []))
        if session_data.get("python_state") is not None:
            wrapper.set_executor_state(session_data["python_state"])
        
    active_agents[session_id] = wrapper
    return wrapper

def serve(agent, host="127.0.0.1", port=5000, debug=True, storage_path=None):
    global prototype_agent, conversation_manager
    
    # 1. Store the prototype
    prototype_agent = agent
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

    @socketio.on('get_agent_specs')
    def handle_get_agent_specs():
        """Extracts and sends the prototype agent's specs to the UI."""
        specs = {
            'model': 'Unknown Model',
            'tools': [],
            'imports': []
        }
        
        if prototype_agent:
            # Model Name
            try:
                if hasattr(prototype_agent.model, 'model_id'):
                    specs['model'] = prototype_agent.model.model_id
                elif hasattr(prototype_agent.model, 'id'):
                    specs['model'] = prototype_agent.model.id
                else:
                    specs['model'] = str(type(prototype_agent.model).__name__)
            except Exception:
                specs['model'] = "Could not retrieve model ID"

            # Tools
            try:
                # agent.tools is typically a dict {name: tool_obj}
                if isinstance(prototype_agent.tools, dict):
                    specs['tools'] = list(prototype_agent.tools.keys())
                elif isinstance(prototype_agent.tools, list):
                    # Handle case where it might be a list of objects with a 'name' attribute
                    specs['tools'] = [t.name for t in prototype_agent.tools if hasattr(t, 'name')]
            except Exception:
                pass

            # Imports
            try:
                # Combine standard authorized imports and any additional ones
                base_imports = getattr(prototype_agent, 'authorized_imports', [])
                add_imports = getattr(prototype_agent, 'additional_authorized_imports', [])
                # Ensure they are lists before combining
                base_imports = list(base_imports) if base_imports else []
                add_imports = list(add_imports) if add_imports else []
                
                unique_imports = list(set(base_imports + add_imports))
                specs['imports'] = unique_imports
            except Exception:
                pass
        
        emit('agent_specs', specs)

    @socketio.on('new_chat')
    def handle_new_chat():
        # Just tell UI to clear; backend will lazy-create the agent when run starts
        emit('reload_chat', {'steps': []})

    @socketio.on('load_session')
    def handle_load_session(data):
        target_id = data.get('id')
        session = conversation_manager.get_session(target_id)
        
        if not session:
            emit('error', {'message': "Session not found"})
            return
        
        # Prepare session data for UI (exclude raw python state)
        session_display = {k: v for k, v in session.items() if k != 'python_state'}
            
        print(f"📂 Loading session UI: {target_id}")
        
        # Get the wrapper (this restores the python_state internally)
        wrapper = get_agent_wrapper(target_id) 
        
        # Send Chat History
        emit('reload_chat', session_display)

        # Send Restored Variables
        vars_data = wrapper.get_active_variables()
        emit('variable_state', {
            'variables': vars_data, 
            'session_id': target_id
        })

    @socketio.on('rename_session')
    def handle_rename_session(data):
        session_id = data.get('id')
        new_name = data.get('new_name')
        if conversation_manager.rename_session(session_id, new_name):
            emit('history_list', {'sessions': conversation_manager.get_session_summaries()})

    @socketio.on('delete_session')
    def handle_delete_session(data):
        session_id = data.get('id')
        
        # Cleanup active session if it exists
        if session_id in active_agents:
            del active_agents[session_id]
            
        if conversation_manager.delete_session(session_id):
            emit('history_list', {'sessions': conversation_manager.get_session_summaries()})

    @socketio.on('inspect_variable')
    def handle_inspect_variable(data):
        session_id = data.get('session_id')
        var_name = data.get('name')
        
        if not session_id or not var_name:
            return
            
        wrapper = get_agent_wrapper(session_id)
        if wrapper:
            details = wrapper.get_variable_details(var_name)
            emit('variable_details', details)

    @socketio.on('stop_run')
    def handle_stop_run(data):
        session_id = data.get('session_id')
        if session_id:
            print(f"🛑 Stop signal received for {session_id}")
            stop_signals[session_id] = True

    @socketio.on('start_run')
    def handle_run(data):
        session_id = data.get('session_id')
        task = data.get('message')
        
        # Determine Session ID (if new chat, generate one)
        if not session_id:
            session_id = str(uuid.uuid4())
            emit('session_created', {'id': session_id})

        # Get the specific agent for this session
        wrapper = get_agent_wrapper(session_id)
        
        # Reset Stop Signal
        stop_signals[session_id] = False

        print(f"🚀 Starting run for {session_id}: {task}")
        
        try:
            emit('agent_start', {'session_id': session_id})
            
            generator = wrapper.run(task)
            
            while True:
                # Check Stop Signal
                if stop_signals.get(session_id, False):
                    emit('stream_delta', {'content': "\n\n[Stopped by user]", 'session_id': session_id})
                    break

                try:
                    event = next(generator)
                    socketio.sleep(0)
                    
                    # Inject Session ID into event so UI knows where to route it
                    event['session_id'] = session_id
                    emit(event['type'], event)

                    # Update variable viewer after every Action Step (code execution)
                    if event['type'] == 'action_step':
                        vars_data = wrapper.get_active_variables()
                        emit('variable_state', {
                            'variables': vars_data, 
                            'session_id': session_id
                        })
                    
                except StopIteration:
                    break

        except Exception as e:
            print(f"Error in session {session_id}: {e}")
            traceback.print_exc()
            emit('error', {'message': str(e), 'session_id': session_id})
        finally:
            emit('run_complete', {'session_id': session_id})
            
            # --- Saving Logic ---
            steps_data = wrapper.get_steps_data()
            current_state = wrapper.get_executor_state()
            
            # Determine preview
            preview = "New Chat"
            if len(steps_data) > 0 and steps_data[0].get('task'):
                 preview = steps_data[0]['task'][:50] + "..."
            elif conversation_manager.get_session(session_id):
                 preview = conversation_manager.get_session(session_id).get('preview', 'New Chat')

            # Thread-safe save
            final_id = conversation_manager.save_session(
                session_id, 
                steps_data, 
                task_preview=preview,
                python_state=current_state
            )
            
            # Refresh history list
            emit('history_list', {'sessions': conversation_manager.get_session_summaries()})

    print(f"✨ SmolagentsUI running on http://{host}:{port}")
    socketio.run(app, host=host, port=port, debug=debug)