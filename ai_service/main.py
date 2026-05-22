import os
import asyncio
import json
import re
from typing import List, Dict, Any
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from contextvars import copy_context

from tools import (
    user_id_var,
    search_listings,
    get_listing_detail,
    get_seller_info,
    get_user_profile,
    get_order_status,
    get_my_orders,
    get_faq_policies,
)
from agent import create_agent, run_agent_with_history
from rag import ingest_faqs

app = FastAPI(title="RacketDiction AI Service")

# Cache the agent executor
agent_executor = None

@app.on_event("startup")
async def startup_event():
    global agent_executor
    print("AI Service Starting Up...")
    # Initialize the agent executor
    agent_executor = create_agent()
    
    # Automatically ingest FAQs on boot (creates pgvector tables if not exist)
    print("Running initial FAQ ingestion...")
    # Run in a background thread to not block server startup
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, ingest_faqs)
    print("Startup process completed.")

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []
    userId: int = 0

def _resolve_tool_action(action, action_input):
    tool_map = {
        "search_listings": search_listings,
        "get_listing_detail": get_listing_detail,
        "get_seller_info": get_seller_info,
        "get_user_profile": get_user_profile,
        "get_order_status": get_order_status,
        "get_my_orders": get_my_orders,
        "get_faq_policies": get_faq_policies,
    }
    tool_fn = tool_map.get(action)
    if tool_fn is None:
        return None

    if isinstance(action_input, dict):
        return tool_fn(**action_input)
    if action_input is None:
        return tool_fn()
    if isinstance(action_input, str):
        stripped = action_input.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, dict):
                    return tool_fn(**parsed)
            except json.JSONDecodeError:
                pass
        return tool_fn(action_input)
    return tool_fn(action_input)

def _normalize_agent_answer(ans):
    # Handle dict payloads from structured agents
    if isinstance(ans, dict):
        action = ans.get("action")
        if action == "Final Answer":
            return ans.get("action_input", "")
        resolved = _resolve_tool_action(action, ans.get("action_input"))
        return resolved if resolved is not None else str(ans)

    if not isinstance(ans, str):
        return str(ans)

    trimmed = ans.strip()

    # Strip fenced code blocks that wrap JSON
    fence_match = re.fullmatch(r"```\s*(\{.*\})\s*```", trimmed, re.DOTALL)
    if fence_match:
        trimmed = fence_match.group(1).strip()

    # Try to parse JSON structured output from the full text
    if "\"action\"" in trimmed:
        candidate = trimmed
        if not trimmed.startswith("{"):
            start = trimmed.find("{")
            end = trimmed.rfind("}")
            if start != -1 and end != -1 and end > start:
                candidate = trimmed[start : end + 1]
        try:
            payload = json.loads(candidate)
            if payload.get("action") == "Final Answer":
                return payload.get("action_input", "")
            resolved = _resolve_tool_action(payload.get("action"), payload.get("action_input"))
            if resolved is not None:
                return resolved
        except json.JSONDecodeError:
            pass

    return ans

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ai_service"}

@app.post("/chat")
async def chat_endpoint(req: ChatRequest):
    global agent_executor
    if agent_executor is None:
        agent_executor = create_agent()

    # Set user ID in ContextVar for the current execution thread context
    user_id_var.set(req.userId)
    
    # Convert Pydantic models to dicts for our helper
    history_dicts = [{"role": m.role, "content": m.content} for m in req.history]
    
    async def response_generator():
        # Setup context propagation for the background worker thread
        ctx = copy_context()
        
        def run_agent():
            return run_agent_with_history(agent_executor, history_dicts, req.message)
            
        loop = asyncio.get_event_loop()
        try:
            # Execute agent in an executor thread with propagated ContextVars
            ans = await loop.run_in_executor(None, lambda: ctx.run(run_agent))
            ans = _normalize_agent_answer(ans)
            
            # Stream the final answer word-by-word (simulate streaming since structured agents 
            # complete their multi-turn tool reasoning synchronously first)
            words = ans.split(" ")
            for i, word in enumerate(words):
                # Add trailing space except for the last word
                chunk = word + (" " if i < len(words) - 1 else "")
                yield f"data: {json.dumps({'token': chunk})}\n\n"
                await asyncio.sleep(0.01) # Ultra fast smooth token streaming
                
            yield "data: [DONE]\n\n"
        except Exception as e:
            print(f"Error in Agent Execution: {e}")
            err_msg = "Maaf Boss, I encountered an issue retrieving that. Please try again or contact support lah."
            yield f"data: {json.dumps({'token': err_msg})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(response_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    # Start FastAPI server
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
