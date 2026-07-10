import asyncio
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent import (
    PROVIDER_FALLBACK,
    RacketBotAgent,
    create_agent,
    validate_answer,
)
from rag import ingest_knowledge
from tools import auth_token_var, user_id_var


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

agent_instance: Optional[RacketBotAgent] = None
agent_creation_lock = asyncio.Lock()


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
    logger.info("RacketDiction AI service starting")
    ingestion_task = None
    if os.getenv("RAG_INGEST_ON_STARTUP", "true").lower() in {"1", "true", "yes"}:
        ingestion_task = asyncio.create_task(_ingest_in_background())
        app.state.knowledge_ingestion_task = ingestion_task
    yield
    if ingestion_task and not ingestion_task.done():
        ingestion_task.cancel()


app = FastAPI(title="RacketDiction AI Service", lifespan=lifespan)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = Field(default_factory=list)
    userId: int = 0
    authToken: str = ""
    recommendationProfile: Optional[Dict[str, str]] = None


async def _run_and_validate(
    agent: RacketBotAgent,
    req: ChatRequest,
    history: List[Dict[str, str]],
) -> str:
    result = await agent.run(
        history=history,
        message=req.message,
        recommendation_profile=req.recommendationProfile,
    )
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


@app.post("/chat")
async def chat_endpoint(req: ChatRequest):
    history = [
        {"role": message.role, "content": message.content}
        for message in req.history[-10:]
    ]

    async def response_generator():
        user_token = user_id_var.set(req.userId)
        auth_token = auth_token_var.set(req.authToken)
        try:
            agent = await _get_agent()
            timeout = float(os.getenv("RACKETBOT_REQUEST_TIMEOUT_SECONDS", "20"))
            answer = await asyncio.wait_for(
                _run_and_validate(agent, req, history),
                timeout=timeout,
            )
        except Exception as exc:
            logger.error("RacketBot request failed: %s", type(exc).__name__)
            answer = PROVIDER_FALLBACK
        finally:
            auth_token_var.reset(auth_token)
            user_id_var.reset(user_token)

        for chunk in _sse_chunks(answer):
            yield chunk
            await asyncio.sleep(0)

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
