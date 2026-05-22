import os
from langchain_openai import OpenAIEmbeddings

def get_embeddings():
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    return OpenAIEmbeddings(
        openai_api_key=api_key,
        openai_api_base="https://openrouter.ai/api/v1",
        model="nvidia/llama-nemotron-embed-vl-1b-v2:free"
    )
