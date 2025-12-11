from smolagents import CodeAgent, OpenAIModel, Tool
import smolagentsUI
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

model = OpenAIModel(model_id="openai/gpt-oss-120b",
                    api_key="", 
                    api_base="http://localhost:8000/v1")

agent = CodeAgent(tools=[DataLoaderTool(df)], 
                  model=model, executor_type='local', 
                  additional_authorized_imports = ["pandas", "numpy", "tableone", "sklearn", "sklearn.*", "matplotlib", "matplotlib.*", "PIL", "PIL.*"],
                  stream_outputs=True)

additional_system_instructions = """
Additional Instructions:

1. Always use final_answer function to display your outputs (e.g., PIL iamge, matplotlib image, pandas dataframe, Markdown text...) to the user.
2. Input complex objects (e.g., Dict of dataframes) directly into final_answer function will cause error. Instead, convert them into a single pandas DataFrame or a single image before passing to final_answer.
3. Do not save any files to disk. All outputs should be returned via final_answer function.
4. (for gpt-oss) Never use "commentary" channel to output. Use "final" channel.
"""

# Append the additional instructions to system prompt
agent.prompt_templates["system_prompt"] = agent.prompt_templates["system_prompt"] + additional_system_instructions

smolagentsUI.serve(agent, host="0.0.0.0", storage_path="./chat_history/mychat.db")
# smolagentsUI.serve(agent, host="0.0.0.0")