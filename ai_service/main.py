import asyncio
import hmac
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent import (
    AgentLimitReachedError,
    PROVIDER_FALLBACK,
    RacketBotAgent,
    create_agent,
    validate_answer,
)
from rag import ingest_knowledge
from recommender import RecommendationProfileError, validate_profile
from training import ensure_model_storage, training_worker
from tools import auth_token_var, user_id_var


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

agent_instance: Optional[RacketBotAgent] = None
agent_creation_lock = asyncio.Lock()

# if no agent, create one, otherwise, reuse existing one. This is a singleton pattern to avoid creating multiple agents and consuming too much memory and resources.
async def _get_agent() -> RacketBotAgent:
    global agent_instance
    if agent_instance is not None:
        return agent_instance
    async with agent_creation_lock:
        if agent_instance is None:
            agent_instance = create_agent()
    return agent_instance


async def _ingest_in_background() -> None:
    try:
        result = await asyncio.to_thread(ingest_knowledge)
        logger.info("Knowledge startup task finished: %s", result)
    except Exception as exc:
        logger.warning(
            "Knowledge startup task failed; previous active version remains: %s",
            type(exc).__name__,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "RacketDiction AI service starting chat_provider=deepseek "
        "chat_model=%s embedding_provider=openrouter embedding_model=%s",
        os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash"),
        os.getenv(
            "OPENROUTER_EMBEDDING_MODEL",
            "nvidia/llama-nemotron-embed-vl-1b-v2:free",
        ),
    )
    if not os.getenv("DEEPSEEK_API_KEY", "").strip():
        logger.warning("DEEPSEEK_API_KEY is missing; chatbot requests will fail")
    if not os.getenv("OPENROUTER_API_KEY", "").strip():
        logger.warning(
            "OPENROUTER_API_KEY is missing; vector RAG will use its local "
            "fallback and cannot generate new embeddings"
        )
    ensure_model_storage()
    training_task = asyncio.create_task(training_worker())
    app.state.ml_training_task = training_task
    ingestion_task = None
    if os.getenv("RAG_INGEST_ON_STARTUP", "true").lower() in {"1", "true", "yes"}:
        ingestion_task = asyncio.create_task(_ingest_in_background())
        app.state.knowledge_ingestion_task = ingestion_task
    yield
    if ingestion_task and not ingestion_task.done():
        ingestion_task.cancel()
    if not training_task.done():
        training_task.cancel()


app = FastAPI(title="RacketDiction AI Service", lifespan=lifespan)


class ChatMessage(BaseModel):
    role: str
    content: str = Field(default="", max_length=2000)


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=2000)
    history: List[ChatMessage] = Field(default_factory=list, max_length=10)
    userId: int = 0
    authToken: str = ""
    recommendationProfile: Optional[Dict[str, str]] = None


async def _run_and_validate(
    agent: RacketBotAgent,
    req: ChatRequest,
    history: List[Dict[str, str]],
) -> str:
    recommendation_profile = None
    if req.recommendationProfile is not None:
        try:
            # Accept only the controlled assessment fields and values before
            # placing them in model context. validate_profile also discards any
            # unexpected keys supplied by a direct API caller.
            recommendation_profile = validate_profile(req.recommendationProfile)
        except RecommendationProfileError:
            logger.warning("RacketBot rejected invalid recommendation profile")
            return (
                "The racket assessment is incomplete or invalid. "
                "Please restart it and answer all five questions."
            )

    try:
        result = await agent.run(
            history=history,
            message=req.message,
            recommendation_profile=recommendation_profile,
        )
    except AgentLimitReachedError as exc:
        logger.warning("RacketBot stopped at its model-call safety limit")
        return str(exc)
    answer = result.answer
    authenticated = bool(req.authToken.strip())
    valid, reason = validate_answer(answer, authenticated=authenticated)
    if valid:
        logger.info("RacketBot validator result=pass rewrite_used=false")
        return answer

    logger.warning("RacketBot validator result=%s rewrite_used=false", reason)
    if reason == "unauthenticated_private_data_leak":
        return "Please log in before asking RacketBot to show private account information."

    rewritten = await agent.rewrite_answer(user_message=req.message, draft=answer)
    rewritten_valid, rewritten_reason = validate_answer(
        rewritten,
        authenticated=authenticated,
    )
    logger.info(
        "RacketBot validator result=%s rewrite_used=true",
        "pass" if rewritten_valid else rewritten_reason,
    )
    return rewritten if rewritten_valid else PROVIDER_FALLBACK


def _sse_chunks(answer: str):
    chunks = re.findall(r"\S+\s*", answer)
    for chunk in chunks:
        yield f"data: {json.dumps({'token': chunk})}\n\n"
    yield "data: [DONE]\n\n"


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "ai_service",
        "agent": "native_tool_calling_v3",
    }

def _verify_proxy(header_value: str) -> None:
    expected = os.getenv("AI_INTERNAL_SECRET", "").strip()
    if not expected:
        return
    provided = header_value or ""
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


# endpoint for chat requests 
@app.post("/chat")
async def chat_endpoint(
    req: ChatRequest,
    x_racketbot_proxy: str = Header(default=""),
): # chatRequest is the request body, x_racketbot_proxy is the header that is used to verify that the request is coming from the go proxy, not from the user directly
    _verify_proxy(x_racketbot_proxy) #check secret header to verify that the request is coming from the go proxy, not from the user directly
    # limit last 10 chat history to avoid sending too much data to the agent
    history = [
        {"role": message.role, "content": message.content}
        for message in req.history[-10:]
    ]

    # create a generator function to stream the response back to the client, in SSE chunk
    async def response_generator():
        user_token = user_id_var.set(req.userId) #store id and auth token in context variable, so that the agent can access it later
        auth_token = auth_token_var.set(req.authToken)
        try:
            agent = await _get_agent() #agent is create here, it is a singleton, so that the agent can maintain its state across requests, build one and reused it
            timeout = float(os.getenv("RACKETBOT_REQUEST_TIMEOUT_SECONDS", "60"))
            answer = await asyncio.wait_for(
                _run_and_validate(agent, req, history), #the main engine of the agent, it will run the agent and validate the answer, if the answer is not valid, it will rewrite the answer and validate again, if still not valid, it will return a fallback answer
                timeout=timeout,
            )
        except Exception as exc:
            logger.error("RacketBot request failed: %s", type(exc).__name__)
            answer = PROVIDER_FALLBACK
        finally: #clear content so that the next request will not use the previous request's context
            auth_token_var.reset(auth_token)
            user_id_var.reset(user_token)
        #split the finished answer to chunks and yield each chunk as a SSE event, with a small sleep to allow the event loop to process other tasks
        for chunk in _sse_chunks(answer):
            yield chunk
            await asyncio.sleep(0)
    #return response like a streaming response, with media type text/event-stream, and headers to disable caching and keep the connection alive
    return StreamingResponse(
        response_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
