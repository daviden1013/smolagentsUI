from typing import Any, Tuple
import json
import io
import base64

try:
    from PIL import Image
except ImportError:
    Image = None

try:
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
            # excessive columns can break UI, so we might want to truncate or just let it be
            return step.to_markdown(index=False)
        except Exception:
            return str(step)
    elif hasattr(step, "__dict__"):
        # For custom object, convert their __dict__ to a serializable format
        return {"_type": step.__class__.__name__, **{k: serialize_step(v) for k, v in step.__dict__.items()}}
    else:
        # For any other type, convert to string
        return str(step)