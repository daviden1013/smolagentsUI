from typing import Any, Tuple, Dict
import json
import io
import base64
import dill

try:
    from PIL import Image
except ImportError:
    Image = None

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
except ImportError:
    plt = None

try:
    import pandas as pd
except ImportError:
    pd = None


def serialize_step(step: Any) -> Any:
    """ Recursive function to make step a JSON-serializable object. """
    if step is None:
        return None
    elif isinstance(step, (str, int, float, bool)):
        # Try to parse string as JSON if it looks like a JSON object/array
        if isinstance(step, str):
            try:
                if (step.startswith("{") and step.endswith("}")) or (step.startswith("[") and step.endswith("]")):
                    parsed = json.loads(step)
                    return serialize_step(parsed)
            except json.JSONDecodeError:
                pass
        return step
    elif isinstance(step, (list, tuple)):
        return [serialize_step(item) for item in step]
    elif isinstance(step, dict):
        return {str(k): serialize_step(v) for k, v in step.items()}
    # PIL Image -> Base64
    elif Image and isinstance(step, Image.Image): 
        try:
            buffered = io.BytesIO()
            step.save(buffered, format="PNG")
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            return f"data:image/png;base64,{img_str}"
        except Exception:
            return "[Error serializing Image]"
    # Matplotlib Figure -> Base64
    elif plt and hasattr(step, 'savefig'):
        try:
            buffered = io.BytesIO()
            step.savefig(buffered, format='png')
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            return f"data:image/png;base64,{img_str}"
        except Exception:
            return "[Error serializing Plot]"

    # Pandas DataFrame -> Markdown Table
    elif pd and isinstance(step, pd.DataFrame):
        try:
            return step.to_markdown(index=True)
        except Exception:
            return str(step)
    elif hasattr(step, "__dict__"):
        # For custom object, convert their __dict__ to a serializable format
        return {"_type": step.__class__.__name__, **{k: serialize_step(v) for k, v in step.__dict__.items()}}
    else:
        # For any other type, convert to string
        return str(step)
    
def serialize_python_state(state: Dict[str, Any]) -> bytes:
    """
    Serializes the Python state dictionary using dill.
    Returns bytes suitable for BLOB storage.
    """
    if not state:
        return b""
    try:
        return dill.dumps(state)
    except Exception as e:
        print(f"Warning: Could not serialize python state: {e}")
        return b""

def deserialize_python_state(data: bytes) -> Dict[str, Any]:
    """
    Deserializes the Python state from bytes.
    """
    if not data:
        return {}
    try:
        return dill.loads(data)
    except Exception as e:
        print(f"Warning: Could not restore python state: {e}")
        return {}