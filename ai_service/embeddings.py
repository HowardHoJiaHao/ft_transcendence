import os
from langchain_openai import OpenAIEmbeddings

def get_embeddings():
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    model = os.getenv("OPENROUTER_EMBEDDING_MODEL", "nvidia/llama-nemotron-embed-vl-1b-v2:free")

    return OpenAIEmbeddings(
        openai_api_key=api_key,
        openai_api_base=base_url,
        model=model
    )
