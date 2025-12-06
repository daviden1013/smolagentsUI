from smolagents import CodeAgent, OpenAIModel, WebSearchTool
import smolagentsUI

model = OpenAIModel(model_id="openai/gpt-oss-120b",
                    api_key="", 
                    api_base="http://localhost:8000/v1")
agent = CodeAgent(tools=[WebSearchTool()], model=model, stream_outputs=True)

smolagentsUI.serve(agent, storage_path="./chat_history/mychat.json")

