![Python Version](https://img.shields.io/pypi/pyversions/smolagentsUI)
![PyPI](https://img.shields.io/pypi/v/smolagentsUI)

A lightweight web UI for 🤗[smolagents](https://github.com/huggingface/smolagents).

## 🆕Recent Updates
- [v0.1.0](https://github.com/daviden1013/smolagentsUI/releases/tag/v0.1.0) (Dec 11, 2025): First release!

## 📑Table of Contents
- [Overview](#overview)
- [Prerequisite](#prerequisite)
- [Installation](#installation)
- [Quick Start](#quick-start)

## ✨Overview
🤗[Smolagents](https://github.com/huggingface/smolagents) is a flexible and powerful framework for building AI agents powered by large language models (LLMs). This repo aims to provide a friendly web App for both developers and end users. 

| **Features** | **Support** |
|----------|----------|
| **Chat history** | :white_check_mark: persistent storage with local database |
| **Image and dataset** | :white_check_mark: Displays images, dataframes, and complex objects |

<div align="center"><img src="docs/readme_images/new_session.PNG" width=800 ></div>


## 💿Installation
The Python package is available on PyPI. 
```bash
pip install smolagentsUI
```

## 🚀Quick Start
In this demo, we build a Code Agent to analyze the public [breast cancer dataset](https://archive.ics.uci.edu/dataset/14/breast+cancer). The agent has access to a Python interpreter. All actions are executed via Python code. The agent can load a dataset from disk, perform exploratory data analysis, build machine learning models, and visualize results. For more information about Code Agents, please refer to the [Smolagents documentation](https://huggingface.co/docs/smolagents/guided_tour).

We first define a custom tool that loads a dataset as a pandas DataFrame. The agent will use this tool to access the breast cancer dataset.
```python
from smolagents import Tool
import pandas as pd

class DataLoaderTool(Tool):
    name = "data_loader"
    description = """ Get breast cancer dataset as pandas.DataFrame. """
    inputs = {}
    output_type = "object"

    def __init__(self, df: pd.DataFrame):
        super().__init__()
        self.df = df.copy()

    def forward(self) -> pd.DataFrame:
        return self.df
```

We then create an instance of the tool with the locally stored breast cancer dataset.

```python
df = pd.read_csv('./demo/data/breast-cancer.data.csv')
data_loader_tool = DataLoaderTool(df=df)
```

Next, we create a Code Agent with the data loader tool. We use a locally served *gpt-oss-120b* as the LLM backend. For data analysis tasks, we authorize additional Python libraries such as `pandas`, `numpy`, `sklearn`, `tableone`, `matplotlib`, and `PIL` for the agent to use.

```python
from smolagents import CodeAgent, OpenAIModel

model = OpenAIModel(model_id="openai/gpt-oss-120b",
                    api_key="", 
                    api_base="http://localhost:8000/v1")

agent = CodeAgent(tools=[data_loader_tool], 
                  model=model, executor_type='local', 
                  additional_authorized_imports = ["pandas", "numpy", "tableone", "sklearn", "sklearn.*", "matplotlib", "matplotlib.*", "PIL", "PIL.*"],
                  stream_outputs=True)
```

We add some additional instructions to the agent's system prompt to ensure that all outputs are returned via the `final_answer` function. Adjust this per your specific use case.

```python
additional_system_instructions = """
Additional Instructions:

1. Always use final_answer function to display your outputs (e.g., PIL iamge, matplotlib image, pandas dataframe, Markdown text...) to the user.
2. Input complex objects (e.g., Dict of dataframes) directly into final_answer function will cause error. Instead, convert them into a single pandas DataFrame or a single image before passing to final_answer.
3. Do not save any files to disk. All outputs should be returned via final_answer function.
4. (for gpt-oss) Never use "commentary" channel to output. Use "final" channel.
"""

# Append the additional instructions to system prompt
agent.prompt_templates["system_prompt"] = agent.prompt_templates["system_prompt"] + additional_system_instructions
```

Now, we start the web UI server with a persistent chat history storage (SQLite database file). If this is the first time, a SQLite database file will be created in the specified path. If the `storage_path` parameter is omitted, the chat history will be stored in memory only (non-persistent).

```python
import smolagentsUI

# Create or load chat history from the specified SQLite database file
smolagentsUI.serve(agent, host="0.0.0.0", port=5000, storage_path="./chat_history/mychat.db")

# For in-memory chat history (non-persistent), leave out `storage_path` parameter
# smolagentsUI.serve(agent, host="0.0.0.0", port=5000)
```

<div align="center"><img src="docs/readme_images/live_demo.gif" width=1000 ></div>