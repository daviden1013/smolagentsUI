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
                    api_base="http://localhost:8000/v1")


instructions = """
Specific Instructions:

1. Do not save any files to disk. All outputs should be returned via `final_answer` function which is the ONLY way users can see your outputs.
2. Users might not see your intermediate reasoning steps, so make sure to explain your thoughts clearly in the `final_answer` function.
3. It is highly encouraged to pass a Dict or List to the `final_answer` function with a friendly and helpful explanatory text and the requested output (e.g., Markdown text, Dict, PIL iamge, matplotlib image, pandas dataframe...), for example, 
    - `final_answer(["<Your explanation and thoughts>", df.head(), img])`
    - `final_answer({"Explanation": "<Your explanation and thoughts>", "dataframe": df.head()})`
    - `final_answer({"Caption": "<a caption>", "Method": <a method summary>, "image": img})`
"""

agent = CodeAgent(tools=[], 
                  model=model, executor_type='local', 
                  additional_authorized_imports = ["pandas", "numpy", "tableone", "sklearn", "sklearn.*", "matplotlib", "matplotlib.*", "PIL", "PIL.*"],
                  instructions=instructions,
                  stream_outputs=True)

import smolagentsUI
smolagentsUI.serve(agent, host="0.0.0.0", port=5000, storage_path="./chat_history/mychat.db")

# For in-memory chat history (non-persistent), leave out `storage_path` parameter
# smolagentsUI.serve(agent, host="0.0.0.0")