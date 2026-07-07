import os
import asyncio
import json
import re
import traceback
from typing import Any, Dict, List, Optional
from fastapi import FastAPI
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
    get_beginner_recommendations,
    get_profile_based_recommendations,
    get_faq_policies,
)
from agent import (
    create_agent,
    run_agent_with_history,
    format_listing_search_response,
    format_beginner_recommendation_response,
)
from rag import ingest_faqs, retrieve_faq_context

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
    recommendationProfile: Optional[Dict[str, str]] = None

def _normalized_text(message: str) -> str:
    text = message.lower().strip()
    replacements = {
        "racquet": "racket",
        "racquets": "rackets",
        "begineer": "beginner",
        "newbee": "newbie",
    }
    for old, new in replacements.items():
        text = re.sub(rf"\b{re.escape(old)}\b", new, text)
    return re.sub(r"\s+", " ", text)

def _has_any(text: str, terms) -> bool:
    return any(term in text for term in terms)

def _is_greeting(message: str) -> bool:
    text = _normalized_text(message)
    if _is_beginner_recommendation(message) or _search_filters_from_message(message):
        return False

    task_terms = (
        "recommend", "search", "show", "find", "buy", "sell", "order", "racket",
        "product", "listing", "scam", "cheat", "fraud", "refund", "payment",
        "seller", "account", "password", "2fa",
    )
    if _has_any(text, task_terms):
        return False

    greetings = (
        "hi", "hello", "hey", "good morning", "good afternoon", "good evening",
        "how are you", "how r u", "sup",
    )
    return _has_any(text, greetings) and len(text.split()) <= 8

def _is_marketplace_safety_intent(message: str) -> bool:
    text = _normalized_text(message)
    safety_terms = (
        "scam", "scammed", "cheat", "cheated", "fraud", "fraudulent",
        "fake seller", "suspicious seller", "seller suspicious", "paid but no item",
        "paid already", "no item", "did not receive", "never receive",
        "report seller", "report listing", "fake racket", "clone racket",
    )
    return _has_any(text, safety_terms)

def _is_account_security_intent(message: str) -> bool:
    text = _normalized_text(message)
    account_terms = (
        "hacked", "unauthorized login", "unauthorised login", "password",
        "reset password", "forgot password", "2fa", "two factor", "verification code",
    )
    return _has_any(text, account_terms) and _has_any(text, ("account", "login", "password", "2fa", "code"))

def _is_payment_dispute_intent(message: str) -> bool:
    text = _normalized_text(message)
    payment_terms = (
        "refund", "payment problem", "payment issue", "deposit", "dispute",
        "paid seller", "paid already", "money back", "transfer money",
    )
    return _has_any(text, payment_terms)

def _is_supported_faq_intent(message: str) -> bool:
    text = _normalized_text(message)
    return (
        bool(re.search(r"\b\d+u\b", text))
        or _has_any(text, ("weight", "flex", "balance", "tension"))
        or _has_any(text, ("post ad", "post an ad", "sell", "listing", "list my", "list your"))
        or _has_any(text, ("buy", "contact seller", "chat seller", "delivery", "meet up", "mailing"))
        or _has_any(text, ("2fa", "two factor", "account security", "verify email", "verification"))
        or _is_marketplace_safety_intent(message)
        or _is_account_security_intent(message)
        or _is_payment_dispute_intent(message)
    )

def _greeting_answer() -> str:
    return (
        "Hi Boss, I am good. I can help you find rackets, compare listings, "
        "recommend beginner-friendly options, or answer RacketDiction marketplace questions."
    )

def _marketplace_safety_answer() -> str:
    return (
        "Sorry that happened, Boss. Please stop sending money or moving the conversation outside RacketDiction.\n\n"
        "What to do now:\n"
        "- Keep screenshots of the chat, payment proof, listing, and seller profile.\n"
        "- Report the seller or listing from the product/seller page.\n"
        "- Contact platform support so they can investigate.\n"
        "- If money was transferred, contact your bank or payment provider quickly too."
    )

def _account_security_answer() -> str:
    return (
        "That sounds like an account security issue, Boss.\n\n"
        "Please change your password, enable 2FA if you can still access the account, "
        "and contact platform support if you notice unknown logins or cannot sign in."
    )

def _payment_dispute_answer() -> str:
    return (
        "I cannot process refunds or payment disputes directly, Boss.\n\n"
        "Please keep your payment proof and chat screenshots, then contact platform support. "
        "If you paid outside the platform, contact your bank or payment provider as soon as possible."
    )

def _capability_answer() -> str:
    return (
        "Sorry Boss, I can mainly help with racket recommendations, marketplace listings, "
        "buying/selling guidance, order questions, and RacketDiction account or safety topics."
    )

def _deterministic_intent_answer(message: str) -> Optional[str]:
    if _is_marketplace_safety_intent(message):
        return _marketplace_safety_answer()
    if _is_account_security_intent(message):
        return _account_security_answer()
    if _is_payment_dispute_intent(message):
        return _payment_dispute_answer()
    specific_faq_answer = None
    if _search_filters_from_message(message) is None:
        specific_faq_answer = _fallback_specific_faq_answer(message)
    if specific_faq_answer:
        return specific_faq_answer
    if _is_greeting(message):
        return _greeting_answer()
    return None

def _resolve_tool_action(action, action_input):
    tool_map = {
        "search_listings": search_listings,
        "get_listing_detail": get_listing_detail,
        "get_seller_info": get_seller_info,
        "get_user_profile": get_user_profile,
        "get_order_status": get_order_status,
        "get_my_orders": get_my_orders,
        "get_beginner_recommendations": get_beginner_recommendations,
        "get_profile_based_recommendations": get_profile_based_recommendations,
        "get_faq_policies": get_faq_policies,
    }
    tool_fn = tool_map.get(action)
    if tool_fn is None:
        return None

    if action_input is None:
        action_input = {}
    elif isinstance(action_input, str):
        stripped = action_input.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, dict):
                    action_input = parsed
            except json.JSONDecodeError:
                pass

    if hasattr(tool_fn, "invoke"):
        return tool_fn.invoke(action_input)

    if isinstance(action_input, dict):
        return tool_fn(**action_input)
    if isinstance(action_input, str):
        return tool_fn(action_input)
    return tool_fn(**action_input)

def _extract_pseudo_tool_call(text: str):
    if "<tool_call>" not in text:
        return None

    after_tag = text.split("<tool_call>", 1)[1]
    action = re.split(r"<|\s|\(", after_tag, maxsplit=1)[0].strip()
    if not action:
        return None

    # Some Anthropic-compatible models emit malformed XML-ish tool calls like:
    # <tool_call>search_listings<tool_call>weight</arg_key><arg_value>5U</arg_value>
    pairs = re.findall(
        r"<(?:arg_key|tool_call)>\s*([^<]+?)\s*</arg_key>\s*<arg_value>\s*([^<]+?)\s*</arg_value>",
        text,
        re.DOTALL,
    )
    action_input = {key.strip(): value.strip() for key, value in pairs}

    call_match = re.search(r"\w+\((.*?)\)", after_tag, re.DOTALL)
    if call_match:
        for key, value in re.findall(r"(\w+)\s*:\s*['\"]([^'\"]+)['\"]", call_match.group(1)):
            action_input[key.strip()] = value.strip()

    return action, action_input

def _strip_pseudo_tool_calls(text: str) -> str:
    stripped = re.sub(r"<tool_call>.*?(?:</tool_call>|$)", "", text, flags=re.DOTALL).strip()
    return stripped or "Sorry Boss, I had trouble completing that search. Please try again lah."

def _extract_price_filters(message: str):
    text = _normalized_text(message)
    max_match = re.search(
        r"(?:under|below|less than|lower than|not more than|<=)\s*(?:rm\s*)?(\d+(?:\.\d+)?)|(?:rm\s*)?(\d+(?:\.\d+)?)\s*(?:rm)?\s*(?:or less|and below|or below)",
        text,
    )
    min_match = re.search(
        r"(?:above|over|more than|higher than|at least|>=)\s*(?:rm\s*)?(\d+(?:\.\d+)?)",
        text,
    )

    filters = {}
    if max_match:
        filters["max_price"] = float(next(group for group in max_match.groups() if group))
        filters["sort"] = "price-low"
    if min_match:
        filters["min_price"] = float(min_match.group(1))
    return filters

def _extract_requested_count(message: str):
    text = _normalized_text(message)
    if re.search(r"\b(one|single|only one|just one)\b", text):
        return 1

    word_map = {
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "nine": 9,
        "ten": 10,
        "eleven": 11,
        "twelve": 12,
        "thirteen": 13,
        "fourteen": 14,
        "fifteen": 15,
        "sixteen": 16,
        "seventeen": 17,
        "eighteen": 18,
        "nineteen": 19,
        "twenty": 20,
    }

    for word, value in word_map.items():
        if re.search(rf"\b{word}\s+(?:rackets?|racquets?|listings?|options|choices|results?)\b", text):
            return value

    count_match = re.search(
        r"\b(\d+)\s*(?:rackets?|racquets?|listings?|options|choices|results?)\b",
        text,
    )
    if count_match:
        return int(count_match.group(1))

    action_match = re.search(r"\b(?:show|give|list|recommend)\s*(?:me\s*)?(\d+)\b", text)
    if action_match:
        return int(action_match.group(1))

    return None

def _search_filters_from_message(message: str):
    text = _normalized_text(message)
    is_listing_request = any(word in text for word in ("racket", "racquet", "listing", "product"))
    if not is_listing_request:
        return None

    filters = _extract_price_filters(message)
    if not filters and "racket" not in text and "racquet" not in text:
        return None

    for brand in ("yonex", "lining", "li-ning", "victor", "kawasaki", "apacs", "mizuno"):
        if brand in text:
            filters["query"] = "Li-Ning" if brand == "li-ning" else brand.title()
            break

    weight_match = re.search(r"\b([1-9]u)\b", text)
    if weight_match:
        filters["weight"] = weight_match.group(1).upper()

    if "head light" in text or "head-light" in text:
        filters["balance"] = "Head Light"
    elif "head heavy" in text or "head-heavy" in text:
        filters["balance"] = "Head Heavy"
    elif "even balance" in text:
        filters["balance"] = "Even Balance"

    return filters

def _needs_listing_search_fallback(user_message: str, answer: str):
    if not isinstance(answer, str):
        return False
    if "Racket ID:" in answer or "No listings match" in answer or "Error searching products" in answer:
        return False
    lowered_answer = answer.lower().strip()
    looks_unfinished = lowered_answer.startswith(("let me search", "i'll search", "i will search"))
    return looks_unfinished and _search_filters_from_message(user_message) is not None

def _fallback_listing_search(user_message: str):
    filters = _search_filters_from_message(user_message)
    if filters is None:
        return None
    return _resolve_tool_action("search_listings", filters)

def _fallback_faq_query(user_message: str):
    text = _normalized_text(user_message)
    if _is_marketplace_safety_intent(user_message):
        return f"marketplace safety scams report seller suspicious fake racket payment evidence {user_message}"
    if _is_account_security_intent(user_message):
        return f"account security 2FA password login email verification {user_message}"
    if _is_payment_dispute_intent(user_message):
        return f"payment dispute refund deposit support evidence report seller {user_message}"
    if re.search(r"\b\d+u\b", text) or any(term in text for term in ("weight", "flex", "balance", "tension")):
        return f"badminton racket specifications weight 1U 2U 3U 4U 5U flex balance tension {user_message}"
    if any(term in text for term in ("post ad", "post an ad", "sell", "listing", "list my", "list your")):
        return f"how to sell create listing post ad {user_message}"
    if any(term in text for term in ("buy", "contact seller", "chat seller", "delivery", "meet up", "mailing")):
        return f"how to buy contact seller delivery meet up mailing {user_message}"
    return user_message

def _fallback_specific_faq_answer(user_message: str):
    weight_match = re.search(r"\b(\d+)u\b", _normalized_text(user_message))
    if not weight_match:
        return None

    weight = f"{weight_match.group(1)}U"
    weight_answers = {
        "1U": "1U is an extremely heavy badminton racket category, usually 100g+. It is mostly used for training wrist and arm strength, not casual play.",
        "2U": "2U is an extremely heavy badminton racket category, usually 100g+. It is mostly used for training wrist and arm strength, not casual play.",
        "3U": "3U means a badminton racket weighs about 85g - 89g. It is a standard heavy weight, usually preferred by advanced attacking or singles players who want more smash power.",
        "4U": "4U means a badminton racket weighs about 80g - 84g. It is a popular all-round weight with a good balance of power and maneuverability.",
        "5U": "5U means a badminton racket weighs about 75g - 79g. It is light, quick to handle, and easier on the wrist.",
        "6U": "6U is an ultra-light badminton racket category, roughly within 60g - 74g. It is good for beginners, juniors, fast defense, and net play.",
        "7U": "7U is an ultra-light badminton racket category, roughly within 60g - 74g. It is good for beginners, juniors, fast defense, and net play.",
        "8U": "8U is an ultra-light badminton racket category, roughly within 60g - 74g. It is good for beginners, juniors, fast defense, and net play.",
    }
    if weight not in weight_answers:
        return (
            f"{weight} is not a common racket weight category in this marketplace guide, Boss. "
            "Most listings here use 1U to 8U.\n\n"
            "Rule of thumb: the bigger the U number, the lighter the racket. "
            "If you are buying from a seller, double-check the actual weight in grams too."
        )
    return f"{weight_answers[weight]}\n\nRule of thumb, Boss: the bigger the U number, the lighter the racket."

def _faq_sources_for_message(user_message: str):
    text = _normalized_text(user_message)
    if re.search(r"\b\d+u\b", text) or any(term in text for term in ("weight", "flex", "balance", "tension")):
        return {"badminton_guide.md"}
    if any(term in text for term in ("post ad", "post an ad", "sell", "listing", "list my", "list your")):
        return {"how_to_sell.md"}
    if any(term in text for term in ("buy", "contact seller", "chat seller", "delivery", "meet up", "mailing")):
        return {"how_to_buy.md", "dealing_methods.md"}
    if _is_marketplace_safety_intent(user_message) or _is_account_security_intent(user_message) or _is_payment_dispute_intent(user_message):
        return {"account_and_safety.md"}
    return set()

def _filter_faq_context(context: str, allowed_sources) -> str:
    if not context or not allowed_sources:
        return context

    chunks = re.split(r"\n\n(?=\[Source: )", context.strip())
    filtered = []
    for chunk in chunks:
        source_match = re.match(r"\[Source: ([^\]]+)\]", chunk)
        if source_match and source_match.group(1) in allowed_sources:
            filtered.append(chunk)
    return "\n\n".join(filtered)

def _fallback_non_llm_answer(user_message: str):
    deterministic_answer = _deterministic_intent_answer(user_message)
    if deterministic_answer:
        return deterministic_answer

    listing_result = _fallback_listing_search(user_message)
    if listing_result:
        return listing_result

    specific_faq_answer = _fallback_specific_faq_answer(user_message)
    if specific_faq_answer:
        return specific_faq_answer

    if not _is_supported_faq_intent(user_message):
        return _capability_answer()

    faq_context = retrieve_faq_context(_fallback_faq_query(user_message))
    faq_context = _filter_faq_context(faq_context, _faq_sources_for_message(user_message))
    if faq_context:
        return (
            "I found this in the RacketDiction guide, Boss:\n\n"
            f"{faq_context}"
        )

    return _capability_answer()

def _should_direct_listing_search(user_message: str):
    filters = _search_filters_from_message(user_message)
    return filters

def _is_beginner_recommendation(user_message: str):
    text = _normalized_text(user_message)
    beginner_terms = ("beginner", "newbie", "new player", "start badminton")
    recommendation_terms = ("recommend", "best", "suggest", "what should", "which racket", "racket", "racquet")
    racket_context_terms = ("racket", "rackets", "badminton", "racquet", "racquets", "shuttle")
    off_domain_terms = ("guitar", "shoe", "shoes", "football", "basketball", "tennis", "laptop", "phone")
    if _has_any(text, off_domain_terms) and not _has_any(text, racket_context_terms):
        return False
    return (
        any(term in text for term in beginner_terms)
        and any(term in text for term in recommendation_terms)
        and _has_any(text, racket_context_terms)
    )

def _wants_single_pick(user_message: str):
    text = _normalized_text(user_message)
    single_terms = ("one", "single", "only one", "just one", "best pick", "top pick")
    expert_terms = ("expert", "advanced", "pro", "professional")
    return any(term in text for term in single_terms) or ("best" in text and any(term in text for term in expert_terms))

def _beginner_fallback_answer(listing_result: str):
    return f"{listing_result}\n\nMy pick: start with the top recommended listing, Boss. Avoid heavy 1U-3U stiff head-heavy rackets until your timing and wrist strength improve."

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

    pseudo_call = _extract_pseudo_tool_call(trimmed)
    if pseudo_call:
        action, action_input = pseudo_call
        resolved = _resolve_tool_action(action, action_input)
        if resolved is not None:
            return resolved
        return _strip_pseudo_tool_calls(trimmed)

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
            if req.recommendationProfile:
                ans = await loop.run_in_executor(
                    None,
                    lambda: ctx.run(
                        lambda: _resolve_tool_action(
                            "get_profile_based_recommendations",
                            req.recommendationProfile,
                        )
                    ),
                )
            elif deterministic_answer := _deterministic_intent_answer(req.message):
                ans = deterministic_answer
            elif _is_beginner_recommendation(req.message):
                guide_context = retrieve_faq_context("beginner badminton racket specs weight flex balance string tension")
                requested_count = _extract_requested_count(req.message)
                limit = requested_count if isinstance(requested_count, int) and requested_count > 0 else None
                listing_result = await loop.run_in_executor(
                    None,
                    lambda: ctx.run(
                        lambda: _resolve_tool_action(
                            "get_beginner_recommendations",
                            {
                                "max_price": 300,
                                "limit": limit,
                                "include_guide": True,
                                "include_avoid": True,
                            },
                        )
                    ),
                )
                try:
                    ans = await loop.run_in_executor(
                        None,
                        lambda: ctx.run(lambda: format_beginner_recommendation_response(
                            req.message,
                            guide_context,
                            listing_result,
                            requested_count,
                        )),
                    )
                    if not ans or len(str(ans).split()) < 20 or "racket" not in str(ans).lower():
                        ans = _beginner_fallback_answer(listing_result)
                except Exception as e:
                    print(f"Error formatting beginner recommendation: {e}")
                    ans = _beginner_fallback_answer(listing_result)
            else:
                direct_filters = _should_direct_listing_search(req.message)
                if direct_filters is not None:
                    requested_count = _extract_requested_count(req.message)
                    if isinstance(requested_count, int) and requested_count > 0:
                        direct_filters = {**direct_filters, "limit": requested_count}
                    else:
                        if "sort" not in direct_filters:
                            direct_filters = {**direct_filters, "sort": "rating"}
                    tool_result = await loop.run_in_executor(
                        None,
                        lambda: ctx.run(lambda: _resolve_tool_action("search_listings", direct_filters)),
                    )
                    ans = await loop.run_in_executor(
                        None,
                        lambda: ctx.run(lambda: format_listing_search_response(req.message, tool_result, requested_count)),
                    )
                else:
                    # Execute agent in an executor thread with propagated ContextVars
                    ans = await loop.run_in_executor(None, lambda: ctx.run(run_agent))
                    ans = _normalize_agent_answer(ans)
                    if _needs_listing_search_fallback(req.message, ans):
                        fallback_ans = _fallback_listing_search(req.message)
                        if fallback_ans:
                            ans = fallback_ans
                    requested_count = _extract_requested_count(req.message)
                    if isinstance(ans, str) and "Racket ID:" in ans:
                        ans = await loop.run_in_executor(
                            None,
                            lambda: ctx.run(lambda: format_listing_search_response(req.message, ans, requested_count)),
                        )
            
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
            traceback.print_exc()
            fallback = await loop.run_in_executor(
                None,
                lambda: ctx.run(lambda: _fallback_non_llm_answer(req.message)),
            )
            err_msg = fallback or "Maaf Boss, I encountered an issue retrieving that. Please try again or contact support lah."
            for i, word in enumerate(err_msg.split(" ")):
                chunk = word + (" " if i < len(err_msg.split(" ")) - 1 else "")
                yield f"data: {json.dumps({'token': chunk})}\n\n"
                await asyncio.sleep(0.01)
            yield "data: [DONE]\n\n"

    return StreamingResponse(response_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    # Start FastAPI server
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
