import os
from langchain.agents import AgentExecutor, initialize_agent, AgentType
from langchain.memory import ConversationBufferWindowMemory
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from tools import all_tools

def create_llm():
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    model = os.getenv("OPENROUTER_MODEL", "google/gemma-4-31b-it:free")

    return ChatOpenAI(
        openai_api_key=api_key,
        openai_api_base=base_url,
        model_name=model,
        temperature=0.3,
        model_kwargs={
            "extra_body": {
                "reasoning": {
                    "enabled": True,
                },
            },
        },
    )

def create_agent():
    llm = create_llm()
    
    system_message = """You are RacketBot, the AI customer service assistant for RacketDiction —
a Malaysian online marketplace for badminton equipment.

You help BUYERS only. You can:
1. Help buyers find the right racket or equipment using the `search_listings` and `get_listing_detail` tools.
2. Answer how-to and platform policy questions using the `get_faq_policies` tool.
3. Check specific listing and seller profile details using the `get_seller_info` tool.
4. Check current user profile using `get_user_profile` tool (only if user is logged in).
5. Check order status for logged-in buyers using `get_my_orders` and `get_order_status` tools.
6. Recommend first rackets for beginners using the `get_beginner_recommendations` tool.

You cannot:
- Help with seller account issues (direct them to support)
- Process payments, refunds, or edit listing prices
- Access or modify passwords or personal data
- Make guarantees or promises on behalf of sellers

Platform facts to keep in mind:
- Prices are in Malaysian Ringgit (RM).
- Dealing methods are Meet Up or Mailing/Delivery.
- Buyers contact sellers via the "Chat Seller" button on product pages.
- Users need a free account to contact sellers.
- 2FA is available for account security.

Tone: Friendly, concise, helpful.
Use casual Malaysian English where natural (e.g. lah, boleh, Boss, ya).
Keep answers short and formatted nicely in bullet points where appropriate.
Formatting guidelines:
- Avoid Markdown tables (they break in small chat windows).
- Prefer card-style blocks with labels, each field on its own line.
- Use a short header line like "[ Racket 7 — Kawasaki Hyper Nano 7U ]" for each item.
- When listing multiple items, separate cards with a blank line.
- Keep labels consistent: Price, Weight, Flex, Balance, Location, Best for.
- After each card, add a line: Product link: {title} | /products/{id}
- Never include raw tool syntax, XML tags, JSON action objects, or text like <tool_call> in your final answer.
- For listing requests with a budget, call `search_listings` with `max_price` or `min_price`; for "under/lower than/below RM500", use `max_price: 500`.
- If a search has no exact match, run one broader search before answering, then clearly say whether the broader results changed brand, weight, or balance.
If a user is not logged in and requests a protected action (like checking their orders), politely ask them to login first.
When you cannot help, always suggest they contact platform support.
"""

    memory = ConversationBufferWindowMemory(
        memory_key="chat_history",
        k=10,
        return_messages=True,
        output_key="output"
    )
    
    agent = initialize_agent(
        tools=all_tools,
        llm=llm,
        agent=AgentType.STRUCTURED_CHAT_ZERO_SHOT_REACT_DESCRIPTION,
        verbose=True,
        memory=memory,
        agent_kwargs={
            "prefix": system_message,
        },
        handle_parsing_errors=True
    )
    return agent

def run_agent_with_history(agent_executor, history, query):
    # Reset memory for this request (to maintain statelessness)
    memory = agent_executor.memory
    memory.clear()
    
    # Load recent conversation turns from frontend message payload
    for msg in history:
        role = msg.get("role")
        content = msg.get("content")
        if role == "user":
            memory.chat_memory.add_message(HumanMessage(content=content))
        elif role in ("assistant", "ai"):
            memory.chat_memory.add_message(AIMessage(content=content))
            
    # Run the agent executor
    response = agent_executor.run(input=query)
    return response

def format_listing_search_response(user_query, tool_result, requested_count=None):
    llm = create_llm()
    count_hint = ""
    if isinstance(requested_count, int) and requested_count > 0:
        count_hint = f"The user explicitly asked for {requested_count} racket(s). Return exactly that many listings. "
    response = llm.invoke([
        SystemMessage(content=(
            "You are RacketBot. Turn marketplace search results into a concise buyer-facing answer. "
            "Do not call tools. Do not invent listings. Do not include image URLs. "
            "If there is no exact match but alternatives are provided, clearly explain the tradeoff. "
            "If the user asks for a single or best pick, choose exactly one listing and explain why in 1-2 short reasons. "
            "If the user asks for multiple rackets, return that number without extra filler. "
            "If the user does not specify a number, decide how many to show based on the question and keep it concise. "
            "Never use Markdown tables. "
            "Use short card-style blocks with labels: Price, Weight, Flex, Balance, Location, Seller, Best for. "
            "After each card, add a line: Product link: {title} | /products/{id}."
        )),
        HumanMessage(content=(
            f"User asked: {user_query}\n\n"
            f"Count guidance: {count_hint}\n\n"
            f"Search result data:\n{tool_result}\n\n"
            "Write the final chat response in friendly Malaysian English."
        )),
    ])
    if isinstance(response.content, list):
        text_parts = [
            part.get("text", "")
            for part in response.content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        return "\n".join(part for part in text_parts if part).strip()
    return response.content

def format_beginner_recommendation_response(user_query, guide_context, listing_result, requested_count=None):
    llm = create_llm()
    count_hint = ""
    if isinstance(requested_count, int) and requested_count > 0:
        count_hint = f"The user explicitly asked for {requested_count} racket(s). Return exactly that many listings. "
    response = llm.invoke([
        SystemMessage(content=(
            "You are RacketBot. Recommend beginner badminton rackets from provided marketplace data. "
            "Do not call tools. Do not invent listings. Do not include image URLs. Never use Markdown tables. "
            "Prefer light 5U-8U, flexible or medium-flex, even-balance or head-light rackets, and low tension advice. "
            "If the user asks for a single or best pick, choose exactly one listing and explain why in 1-2 short reasons. "
            "If the user asks for multiple rackets, return that number without extra filler. "
            "If the user does not specify a number, decide how many to show based on the question and keep it concise. "
            "You may summarize or omit the guide unless the user asks for tips or guidance. "
            "After each card, add a line: Product link: {title} | /products/{id}."
        )),
        HumanMessage(content=(
            f"User asked: {user_query}\n\n"
            f"Count guidance: {count_hint}\n\n"
            f"Beginner guide context:\n{guide_context}\n\n"
            f"Available marketplace listings:\n{listing_result}\n\n"
            "Write a concise friendly final answer in Malaysian English."
        )),
    ])
    if isinstance(response.content, list):
        text_parts = [
            part.get("text", "")
            for part in response.content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        return "\n".join(part for part in text_parts if part).strip()
    return response.content
