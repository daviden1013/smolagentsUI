import io
import base64
import pprint
import inspect
import json
from typing import Generator, List, Dict, Any, Optional
from .utils import serialize_step

# smolagents imports
from smolagents.memory import (
    ActionStep, 
    PlanningStep, 
    FinalAnswerStep, 
    ToolCall, 
    TaskStep, 
    SystemPromptStep
)
from smolagents import CodeAgent
from smolagents.monitoring import Timing
from smolagents.models import ChatMessageStreamDelta, ChatMessage, TokenUsage


class AgentWrapper:
    def __init__(self, agent:CodeAgent):
        """
        This class wraps a smolagent.CodeAgent to manage memory, serialization and streaming.
        """
        if not isinstance(agent, CodeAgent):
            raise ValueError("AgentWrapper currently only supports CodeAgent instances.")   
        self.agent = agent

    def get_steps_data(self) -> List[Dict]:
        """
        Serializes the current agent memory into a list of dictionaries.
        """
        return [serialize_step(step) for step in self.agent.memory.steps]

    def load_memory(self, steps_data: List[Dict]):
        """
        Reconstructs agent memory steps from a list of dictionaries 
        and updates the agent's internal memory state.
        """
        reconstructed_steps = []

        for step_data in steps_data:
            # 1. Identify and reconstruct ActionStep
            if "step_number" in step_data:
                # Reconstruct nested objects
                timing = Timing(start_time=step_data["timing"]["start_time"], end_time=step_data["timing"]["end_time"]) if step_data.get("timing") else None
                token_usage = TokenUsage(input_tokens=step_data["token_usage"]["input_tokens"],
                                         output_tokens=step_data["token_usage"]["output_tokens"]) if step_data.get("token_usage") else None
                
                # Reconstruct ToolCalls
                tool_calls = []
                if step_data.get("tool_calls"):
                    for tc in step_data["tool_calls"]:
                        tool_calls.append(ToolCall(
                            id=tc["id"],
                            name=tc["name"],
                            arguments=tc["arguments"]
                        ))

                # Reconstruct ChatMessages
                model_input_messages = [
                    ChatMessage.from_dict(msg) for msg in step_data.get("model_input_messages", [])
                ] if step_data.get("model_input_messages") else None
                
                model_output_message = ChatMessage.from_dict(step_data["model_output_message"]) if step_data.get("model_output_message") else None

                model_output = step_data.get("model_output")
                if isinstance(model_output, (dict, list)):
                    model_output = json.dumps(model_output)

                step = ActionStep(
                    step_number=step_data["step_number"],
                    timing=timing,
                    model_input_messages=model_input_messages,
                    tool_calls=tool_calls,
                    error=step_data.get("error"),
                    model_output_message=model_output_message,
                    model_output=model_output,
                    observations=step_data.get("observations"),
                    action_output=step_data.get("action_output"),
                    token_usage=token_usage,
                    code_action=step_data.get("code_action"),
                    is_final_answer=step_data.get("is_final_answer", False)
                )
                reconstructed_steps.append(step)

            # 2. Identify and reconstruct PlanningStep
            elif "plan" in step_data:
                timing = Timing(**step_data["timing"]) if step_data.get("timing") else None
                token_usage = TokenUsage(**step_data["token_usage"]) if step_data.get("token_usage") else None
                
                model_input_messages = [
                    ChatMessage.from_dict(msg) for msg in step_data.get("model_input_messages", [])
                ]
                model_output_message = ChatMessage.from_dict(step_data["model_output_message"])

                step = PlanningStep(
                    model_input_messages=model_input_messages,
                    model_output_message=model_output_message,
                    plan=step_data["plan"],
                    timing=timing,
                    token_usage=token_usage
                )
                reconstructed_steps.append(step)

            # 3. Identify and reconstruct TaskStep
            elif "task" in step_data:
                step = TaskStep(
                    task=step_data["task"],
                    task_images=step_data.get("task_images") 
                )
                reconstructed_steps.append(step)

        self.agent.memory.reset()
        self.agent.memory.steps = reconstructed_steps

    def clear_memory(self):
        self.agent.memory.reset()

    def get_executor_state(self) -> Dict[str, Any]:
        """
        Retrieves the current variable state from the agent's Python executor.
        """
        if hasattr(self.agent.python_executor, "state"):
             return self.agent.python_executor.state
        return {}

    def set_executor_state(self, state: Dict[str, Any]):
        """
        Injects a dictionary of variables back into the agent's Python executor.
        """
        if state and hasattr(self.agent.python_executor, "send_variables"):
            print(f"🔄 Restoring {len(state)} variables to Python executor.")
            self.agent.python_executor.send_variables(state)

    def get_active_variables(self) -> List[Dict[str, Any]]:
        """
        Returns a filtered list of variables from the executor state
        suitable for the Variable Viewer UI.
        """
        if not hasattr(self.agent.python_executor, "state"):
            return []

        variables = []
        state = self.agent.python_executor.state
        
        for name, value in state.items():
            # 1. Filter System Variables and Private attributes
            if name.startswith('_'):
                continue
            
            # 2. Filter Constants (All Uppercase)
            if name.isupper():
                continue

            # 3. Filter Modules, Functions, and Classes (we only want data)
            if inspect.ismodule(value) or inspect.isclass(value) or inspect.isfunction(value) or inspect.isbuiltin(value):
                continue
            
            # 4. Filter Specific Framework objects (optional, e.g. the agent itself if injected)
            type_name = type(value).__name__
            if type_name in ['CodeAgent', 'Tool']:
                continue

            # 5. Extract Metadata
            preview = str(value)
            if len(preview) > 100:
                preview = preview[:100] + "..."
            
            shape = ""
            # Handle pandas DataFrame/Series shape
            if hasattr(value, "shape") and isinstance(value.shape, tuple):
                shape = str(value.shape)
            # Handle list/dict length
            elif hasattr(value, "__len__"):
                try:
                    shape = str(len(value)) + " items"
                except:
                    pass

            variables.append({
                "name": name,
                "type": type_name,
                "preview": preview,
                "shape": shape
            })
            
        # Sort alphabetically
        return sorted(variables, key=lambda x: x['name'])
    
    def get_variable_details(self, name: str) -> Dict[str, Any]:
        """
        Retrieves the full details of a variable for inspection.
        """
        if not hasattr(self.agent.python_executor, "state"):
            return {"error": "Executor state not available"}
        
        value = self.agent.python_executor.state.get(name)
        if value is None:
             return {"error": f"Variable '{name}' not found"}

        type_name = type(value).__name__
        
        # 1. Pandas DataFrame -> HTML Table
        if hasattr(value, "to_html") and type_name == "DataFrame":
            try:
                # We render a scrollable HTML table. 
                # max_rows can be adjusted or removed to show all.
                html = value.to_html(max_rows=1000, classes="df-table", border=0)
                return {
                    "name": name, 
                    "type": "dataframe", 
                    "content": html
                }
            except Exception as e:
                return {"name": name, "type": "text", "content": f"Error converting DataFrame: {e}"}

        # 2. Images (PIL or Matplotlib Figure) -> Base64
        # Check for PIL Image
        if hasattr(value, "save") and type_name.endswith("Image"):
            try:
                buffered = io.BytesIO()
                value.save(buffered, format="PNG")
                img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
                return {
                    "name": name, 
                    "type": "image", 
                    "content": f"data:image/png;base64,{img_str}"
                }
            except:
                pass
        
        # Check for Matplotlib Figure
        if hasattr(value, "savefig"):
            try:
                buffered = io.BytesIO()
                value.savefig(buffered, format='png')
                img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
                return {
                    "name": name, 
                    "type": "image", 
                    "content": f"data:image/png;base64,{img_str}"
                }
            except:
                pass

        # 3. Default -> String Representation
        # Use pprint for cleaner formatting of lists/dicts
        try:
            formatted_text = pprint.pformat(value, indent=2)
        except:
            formatted_text = str(value)
            
        return {
            "name": name, 
            "type": "text", 
            "content": formatted_text
        }

    def run(self, task: str) -> Generator[Dict, None, Optional[ActionStep]]:
        """
        Runs the agent and yields UI-friendly event dictionaries.
        """
        stream = self.agent.run(task, stream=True, reset=False)
        final_step_obj = None

        for step in stream:
            # Streaming Text
            if isinstance(step, ChatMessageStreamDelta):
                if step.content:
                    yield {'type': 'stream_delta', 'content': step.content}
            
            # Action Steps (Code & Logs)
            elif isinstance(step, ActionStep):
                yield {
                        'type': 'action_step',
                        'step_number': step.step_number,
                        'model_output': step.model_output,
                        'code_action': step.code_action,
                        'observations': step.observations or "",
                        'error': str(step.error) if step.error else None
                        }
                
                if step.is_final_answer:
                    final_step_obj = step
                    yield {'type': 'final_answer', 
                        'content': serialize_step(step.action_output)
                        }
                    
            # Planning
            elif isinstance(step, PlanningStep):
                yield {'type': 'planning_step', 'plan': step.plan}

        return final_step_obj