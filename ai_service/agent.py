import os
from langchain.agents import AgentExecutor, initialize_agent, AgentType
from langchain.memory import ConversationBufferWindowMemory
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, AIMessage
from tools import all_tools

def create_agent():
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    base_url = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
    model = os.getenv("ANTHROPIC_MODEL", "ilmu-glm-5.1")

    llm = ChatAnthropic(
        anthropic_api_key=api_key,
        anthropic_api_url=base_url,
        model=model,
        temperature=0.3,
    )
    
    system_message = """You are RacketBot, the AI customer service assistant for RacketDiction —
a Malaysian online marketplace for badminton equipment.

You help BUYERS only. You can:
1. Help buyers find the right racket or equipment using the `search_listings` and `get_listing_detail` tools.
2. Answer how-to and platform policy questions using the `get_faq_policies` tool.
3. Check specific listing and seller profile details using the `get_seller_info` tool.
4. Check current user profile using `get_user_profile` tool (only if user is logged in).
5. Check order status for logged-in buyers using `get_my_orders` and `get_order_status` tools.

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
