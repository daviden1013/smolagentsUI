import io
import base64
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

                step = ActionStep(
                    step_number=step_data["step_number"],
                    timing=timing,
                    model_input_messages=model_input_messages,
                    tool_calls=tool_calls,
                    model_output_message=model_output_message,
                    model_output=step_data.get("model_output"),
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