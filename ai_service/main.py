import os
import asyncio
from typing import List, Dict, Any
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from contextvars import copy_context

from tools import user_id_var
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

    import json
    return StreamingResponse(response_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    # Start FastAPI server
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
