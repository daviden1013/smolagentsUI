from smolagents import CodeAgent, OpenAIModel, Tool
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
    
df = pd.read_csv('./demo/data/breast-cancer.data.csv')
data_loader_tool = DataLoaderTool(df=df)

model = OpenAIModel(model_id="openai/gpt-oss-120b",
                    api_key="", 
                    api_base="http://localhost:8000/v1",
                    reasoning_effort="high")


instructions = """
Specific Instructions:

1. Do not save any files to disk. All outputs should be returned via `final_answer` function which is the ONLY way users can see your outputs.
2. Users might not see your intermediate reasoning steps or code, so make sure to explain your thoughts clearly in the `final_answer` function.
3. If your output is an object, 
    - it is highly encouraged to pass a List to the `final_answer` function with a friendly and helpful explanatory text and the requested output (e.g., Markdown text, Dict, PIL iamge, matplotlib image, pandas dataframe...), for example, `final_answer(["<Your explanation and thoughts in Markdown>", df.head(), img, ...])`
    - always check your output object by printing its type and content summary before passing to `final_answer` function to avoid errors. For example, you can use `print(type(your_object))` and `print(your_object)` to check the type and content of your output object.
4. Communication is key. If you need clarification or more information from the user, ask clarifying questions via the `final_answer` function before taking actions.
5. If the task requires writing long code. Do not try to write the whole code at once. Instead, break down the code into smaller snippets and implement them one by one, testing each part before moving on to the next. 
"""

agent = CodeAgent(tools=[data_loader_tool], 
                  model=model, executor_type='local', 
                  additional_authorized_imports = ["pandas", "numpy.*", "tableone", "scipy", "scipy.*", "sklearn", "sklearn.*", "statsmodels", "statsmodels.*", "matplotlib", "matplotlib.*", "PIL", "PIL.*"],
                  instructions=instructions,
                  max_steps=32,
                  use_structured_outputs_internally=True,
                  stream_outputs=True)

import smolagentsUI
smolagentsUI.serve(agent, host="0.0.0.0", port=5000, storage_path="./chat_history/mychat.db")

# For in-memory chat history (non-persistent), leave out `storage_path` parameter
# smolagentsUI.serve(agent, host="0.0.0.0")