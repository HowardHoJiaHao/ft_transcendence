import os

from langchain_openai import OpenAIEmbeddings


def get_embeddings() -> OpenAIEmbeddings:
    return OpenAIEmbeddings(
        api_key=os.getenv("OPENROUTER_API_KEY", ""),
        base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        model=os.getenv(
            "OPENROUTER_EMBEDDING_MODEL",
            "nvidia/llama-nemotron-embed-vl-1b-v2:free",
        ),
        # OpenAI SDK 2.x defaults to base64 embeddings when this is omitted.
        # The configured OpenRouter NVIDIA route returns float vectors and can
        # otherwise respond with an empty data array.
        model_kwargs={"encoding_format": "float"},
        check_embedding_ctx_length=False,
    )
