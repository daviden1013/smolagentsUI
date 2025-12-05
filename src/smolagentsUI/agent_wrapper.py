import io
import base64
from typing import Generator, List, Dict, Any, Optional

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
from smolagents.models import ChatMessageStreamDelta

class AgentWrapper:
    def __init__(self, agent:CodeAgent):
        """
        This class wraps a smolagent.CodeAgent to manage memory, serialization and streaming.

        Parameters:
        -----------
        agent : CodeAgent
            An instance of smolagents.CodeAgent to be wrapped.
        """
        if not isinstance(agent, CodeAgent):
            raise ValueError("AgentWrapper currently only supports CodeAgent instances.")   
        self.agent = agent

    def get_steps_data(self, include_final_step: Optional[FinalAnswerStep] = None) -> List[Dict]:
        """
        Serializes the current agent memory into a list of dictionaries.
        """
        steps_to_save = list(self.agent.memory.steps)
        
        # Check if the last step is already this final step to avoid dupes
        if include_final_step:
            if not steps_to_save or steps_to_save[-1] is not include_final_step:
                steps_to_save.append(include_final_step)

        return [self._serialize_step(step) for step in steps_to_save]

    def reload_memory(self, steps_data: List[Dict]):
        """Rehydrates the agent's memory from stored JSON data."""
        new_steps = []
        for s in steps_data:
            step_type = s.get("type")
            
            if step_type == "TaskStep":
                new_steps.append(TaskStep(task=s["task"]))
                
            elif step_type == "ActionStep":
                timing_data = s.get("timing")
                timing_obj = Timing(start_time=0.0, end_time=0.0)
                if isinstance(timing_data, dict):
                    timing_obj = Timing(
                        start_time=timing_data.get("start_time", 0.0),
                        end_time=timing_data.get("end_time")
                    )

                step = ActionStep(
                    step_number=s.get("step_number", 1),
                    code_action=s.get("code"),
                    observations=s.get("observations"),
                    error=s.get("error"),
                    timing=timing_obj
                )
                new_steps.append(step)
                
            elif step_type == "FinalAnswerStep":
                content = s.get("content")
                new_steps.append(FinalAnswerStep(output=content))
        
        self.agent.memory.steps = new_steps

    def clear_memory(self):
        self.agent.memory.reset()

    def run(self, task: str) -> Generator[Dict, None, Optional[FinalAnswerStep]]:
        """
        Runs the agent and yields UI-friendly event dictionaries.
        Returns the FinalAnswerStep (if success) for saving.
        """
        stream = self.agent.run(task, stream=True, reset=False)
        final_step_obj = None

        for step in stream:
            # 1. Final Answer
            if isinstance(step, FinalAnswerStep):
                final_step_obj = step
                yield {'type': 'final_answer', 
                       'content': str(step.output)
                      }
            
            # 2. Streaming Text
            elif isinstance(step, ChatMessageStreamDelta):
                if step.content:
                    yield {'type': 'stream_delta', 'content': step.content}
            
            # 3. Tool Calls
            elif isinstance(step, ToolCall):
                yield {'type': 'tool_start', 'tool_name': step.name, 'arguments': str(step.arguments)}
            
            # 4. Action Steps (Code & Logs)
            elif isinstance(step, ActionStep):
                yield {
                        'type': 'action_step',
                        'step_number': step.step_number,
                        'code': step.code_action,
                        'observations': step.observations or "",
                        'error': str(step.error) if step.error else None
                      }
            
            # 5. Planning
            elif isinstance(step, PlanningStep):
                yield {'type': 'planning_step', 'plan': step.plan}

        return final_step_obj

    # --- Serialization Helpers ---
    def _serialize_step(self, step) -> Dict[str, Any]:
        data = {"type": type(step).__name__}
        
        if isinstance(step, TaskStep):
            data["task"] = step.task
            
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

        elif isinstance(step, FinalAnswerStep):
            data["content"] = str(step.output)

        return data

