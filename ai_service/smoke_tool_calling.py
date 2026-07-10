"""Live OpenRouter smoke test for native multi-tool calling.

Run inside the AI service environment:

    python smoke_tool_calling.py

The script never calls the marketplace backend. It verifies that the configured
model and LangChain/OpenRouter combination exchange native tool-call objects.
"""

import asyncio
import os
import sys

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_core.messages import AIMessage

from agent import create_llm


@tool
def sample_seller_listings(seller_id: int) -> dict:
    """Return fixture listings for one seller ID."""

    return {
        "ok": True,
        "seller_id": seller_id,
        "listings": [{"id": seller_id * 10, "price": 100 + seller_id}],
    }


async def main() -> int:
    if not os.getenv("OPENROUTER_API_KEY", "").strip():
        print("OPENROUTER_API_KEY is required for the live smoke test.")
        return 2

    graph = create_agent(
        model=create_llm(),
        tools=[sample_seller_listings],
        system_prompt=(
            "Use the tool for every seller mentioned. Fetch both sellers before "
            "giving a one-sentence comparison."
        ),
    )
    result = await graph.ainvoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "Compare the listings from seller 9 and seller 10.",
                }
            ]
        },
        config={"recursion_limit": 12},
    )

    calls = []
    for message in result.get("messages", []):
        if isinstance(message, AIMessage):
            calls.extend(message.tool_calls or [])
    seller_ids = {
        int(call.get("args", {}).get("seller_id"))
        for call in calls
        if call.get("name") == "sample_seller_listings"
        and call.get("args", {}).get("seller_id") is not None
    }
    if seller_ids != {9, 10}:
        print(f"Native tool calling failed: observed seller IDs {sorted(seller_ids)}")
        return 1
    print("Native multi-tool calling passed for sellers 9 and 10.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
