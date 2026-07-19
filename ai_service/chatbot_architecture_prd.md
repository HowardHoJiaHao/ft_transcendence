# PRD: Production-Ready Chatbot Architecture

## 1. Purpose

Redesign the RacketDiction AI chatbot architecture so user messages are routed, handled, and answered consistently in production-like conditions.

The current chatbot works for some happy paths, but the responsibilities between Python keyword routing, LangChain agent routing, RAG fallback, and generic error handling are not clearly separated. This causes poor responses for normal messages such as greetings, marketplace safety issues, or provider failures.

This PRD defines the target architecture only. It does not require immediate code changes.

## 2. Current Problems

### 2.1 Mixed Routing Responsibility

Current behavior combines:

- Python pre-routing in `main.py`
- LangChain agent tool routing in `agent.py`
- RAG fallback in `_fallback_non_llm_answer`
- Hardcoded generic error response

Because routing is split across multiple places, it is hard to reason about why a message was handled a certain way.

### 2.2 Weak Fallback Behavior

When the LLM provider fails, the fallback may retrieve unrelated FAQ chunks.

Example bad behavior:

```text
User: hi how are you?
Bot: I found this in the RacketDiction guide...
```

A greeting should not return random FAQ content.

### 2.3 Critical Marketplace Issues Depend Too Much On LLM Availability

Messages such as:

```text
i was scammed
i was cheated
seller is fake
paid but no item
```

should receive a consistent safety/support response even if the LLM provider is down or rate-limited.

### 2.4 No Explicit Confidence Gate

RAG context is currently treated as useful if any context is returned. The system does not clearly reject low-relevance retrieved documents.

### 2.5 Unclear Boundaries Between Tool Execution And Wording

The LLM sometimes decides intent, sometimes calls tools, and sometimes formats final answers. Product search should use verified marketplace data only, while the LLM should not invent products, prices, policies, refunds, or seller guarantees.

## 3. Goals

- Make chatbot routing understandable, testable, and maintainable.
- Use deterministic handling for critical marketplace and safety cases.
- Use LLMs for flexible language understanding and response composition where appropriate.
- Prevent unrelated FAQ/RAG content from being shown for irrelevant messages.
- Keep product, order, user, and policy actions constrained to approved tools.
- Provide graceful fallback when the LLM provider fails.
- Make each intent easy to test with example user messages.

## 4. Non-Goals

- Replacing the existing ML racket recommendation model.
- Building a full customer support ticket system.
- Processing refunds, payments, or disputes directly inside the chatbot.
- Allowing the LLM to execute arbitrary backend/database operations.
- Rewriting the frontend chat UI.

## 5. Target Architecture

Use a hybrid router architecture:

```text
User message
  |
  v
Input Normalizer
  |
  v
Critical Intent Guard
  |
  v
Intent Router
  |
  v
Domain Handler
  |
  v
Tool Execution Layer
  |
  v
Response Composer
  |
  v
Fallback Handler
  |
  v
Final Answer
```

This is not a pure keyword bot and not a pure LLM agent. The system should use deterministic checks where reliability matters, and LLM reasoning where flexible language understanding is helpful.

## 6. Pipeline Details

### 6.1 Input Normalizer

Responsibilities:

- Keep the original user message for final response context.
- Create a normalized copy for routing.
- Normalize common variants and typos.

Examples:

```text
racquet -> racket
begineer -> beginner
scammed / cheated / fraud -> marketplace safety term group
```

The normalizer should not change the meaning of the user message. It only makes routing more reliable.

### 6.2 Critical Intent Guard

This runs before the LLM router.

Purpose:

- Catch high-value or sensitive marketplace issues.
- Return reliable support guidance even if the LLM provider is unavailable.
- Prevent unsafe or misleading answers.

Initial critical categories:

- `marketplace_safety`: scam, cheated, fake seller, suspicious seller, paid but no item
- `account_security`: hacked account, password issue, unauthorized login, 2FA issue
- `payment_dispute`: refund, payment problem, deposit issue, dispute
- `privacy_sensitive`: personal data, password, private account details
- `unsafe_or_illegal`: illegal request, violence, self-harm, abuse

The critical guard should use broad category matching, not thousands of individual hardcoded conversations.

### 6.3 Intent Router

The intent router decides what the user is trying to do.

Recommended implementation:

```text
1. Critical deterministic guard
2. LLM JSON intent classifier
3. Deterministic fallback parser
```

The LLM classifier should return strict JSON only.

Example output:

```json
{
  "intent": "product_search",
  "confidence": 0.91,
  "entities": {
    "brand": "Yonex",
    "weight": "4U",
    "max_price": 500
  },
  "needs_tool": true
}
```

If the classifier fails, the deterministic fallback parser can still handle obvious searches such as:

```text
show me yonex 4U racket under RM500
```

### 6.4 Supported Intents

Initial intent set:

- `greeting`
- `product_search`
- `product_detail`
- `racket_recommendation_guided`
- `beginner_racket_advice`
- `racket_spec_question`
- `marketplace_safety`
- `buying_help`
- `selling_help`
- `order_status`
- `account_help`
- `general_faq`
- `unsupported`

Each intent must have one owner handler.

### 6.5 Domain Handlers

Each handler owns one user goal.

Recommended handlers:

- `GreetingHandler`
- `ProductSearchHandler`
- `ProductDetailHandler`
- `GuidedRecommendationHandler`
- `BeginnerRecommendationHandler`
- `RacketSpecFaqHandler`
- `MarketplaceSafetyHandler`
- `BuyingHelpHandler`
- `SellingHelpHandler`
- `OrderStatusHandler`
- `AccountHelpHandler`
- `UnsupportedHandler`

Handlers decide which tools are allowed. The LLM should not freely call every tool for every intent.

### 6.6 Tool Execution Layer

Tools should receive validated arguments only.

Rules:

- Product search uses validated filters such as `brand`, `weight`, `balance`, `min_price`, `max_price`, and `limit`.
- Product results must come from marketplace data only.
- The LLM must not invent listing IDs, prices, seller names, locations, or ratings.
- Protected user/order tools require login context.
- Payment/refund/dispute tools should not exist unless the backend actually supports them.

### 6.7 Response Composer

The response composer turns structured handler output into user-facing text.

Use deterministic templates for:

- Greeting
- Unsupported messages
- Scam/safety guidance
- Login required
- No products found
- LLM provider unavailable

Use the LLM for:

- Formatting verified product search results
- Explaining racket specifications
- Summarizing relevant FAQ snippets
- Making recommendation explanations natural

When the LLM is used for composition, it must receive only approved context.

Composer instruction:

```text
Use only the provided data. Do not invent listings, prices, policies, refunds, seller promises, or platform actions.
```

### 6.8 Fallback Handler

Fallback must be intent-aware.

Bad fallback:

```text
Any unknown message -> retrieve FAQ -> show whatever comes back
```

Good fallback:

```text
Greeting intent + LLM failure
-> greeting template

Marketplace safety intent + LLM failure
-> safety support template

Product search intent + search failure
-> product search unavailable template

Unknown intent + low confidence
-> capability message
```

Generic fallback message should be the last resort only.

## 7. RAG Requirements

RAG should be used only for intents that need documentation or policy context.

Allowed RAG intents:

- `racket_spec_question`
- `buying_help`
- `selling_help`
- `account_help`
- `marketplace_safety`
- `general_faq`

RAG should not run for:

- `greeting`
- `product_search`
- `racket_recommendation_guided`
- `order_status`
- `unsupported`

RAG should include a relevance gate.

If retrieved context is low confidence or unrelated, the bot should not display it.

Expected behavior:

```text
User: hi how are you?
Bot: Hi Boss, I can help you find rackets, compare listings, or answer RacketDiction marketplace questions.
```

Not:

```text
Bot: I found this in the RacketDiction guide...
```

## 8. Example Routes

### 8.1 Greeting

Input:

```text
hi how are you?
```

Route:

```text
Input Normalizer -> Intent Router -> greeting -> GreetingHandler -> template
```

Expected answer:

```text
Hi Boss, I am good. I can help you find rackets, compare listings, or answer RacketDiction marketplace questions.
```

### 8.2 Marketplace Safety

Input:

```text
i was scammed, help
```

Route:

```text
Input Normalizer -> Critical Intent Guard -> marketplace_safety -> MarketplaceSafetyHandler
```

Expected answer:

```text
Sorry that happened, Boss. Please keep your chat/payment evidence, report the seller or listing from their profile/product page, and contact platform support so they can investigate. Avoid sending more money or moving the conversation outside RacketDiction.
```

### 8.3 Beginner Racket Advice

Input:

```text
recommend beginner racket
```

Route:

```text
Input Normalizer -> Intent Router -> beginner_racket_advice -> BeginnerRecommendationHandler -> get_beginner_recommendations -> Response Composer
```

Expected behavior:

- Return beginner-friendly racket spec guidance.
- Return deduplicated marketplace listings.
- Avoid flooding the user with too many products.

### 8.4 Product Search

Input:

```text
show me yonex 4U racket under RM500
```

Route:

```text
Input Normalizer -> Intent Router -> product_search -> ProductSearchHandler -> search_listings -> Response Composer
```

Expected extracted entities:

```json
{
  "brand": "Yonex",
  "weight": "4U",
  "max_price": 500
}
```

Expected behavior:

- Search database listings.
- Return only real listings.
- If no exact match, explain the closest alternatives.

### 8.5 Unsupported

Input:

```text
write my assignment
```

Route:

```text
Input Normalizer -> Intent Router -> unsupported -> UnsupportedHandler
```

Expected answer:

```text
Sorry Boss, I can mainly help with RacketDiction marketplace questions, racket recommendations, product listings, and buyer support.
```

## 9. Error Handling Requirements

### 9.1 LLM Provider Failure

If OpenRouter or the selected model fails:

- Do not expose raw provider errors to the user.
- Do not retrieve random FAQ content.
- Use the selected intent's deterministic fallback.

### 9.2 Tool Failure

If a tool fails:

- Product search failure should say listings are temporarily unavailable.
- Order status failure should say order lookup is temporarily unavailable.
- FAQ lookup failure should say the guide could not be retrieved.

### 9.3 Low Confidence Intent

If intent confidence is low:

- Ask a short clarifying question, or
- Show a capability message.

Do not answer with unrelated FAQ content.

## 10. Observability Requirements

Log structured routing decisions for debugging.

Recommended fields:

```json
{
  "message_id": "generated-id",
  "user_id": 123,
  "intent": "product_search",
  "intent_confidence": 0.91,
  "handler": "ProductSearchHandler",
  "tools_called": ["search_listings"],
  "llm_used": true,
  "fallback_used": false,
  "error_type": null
}
```

Do not log secrets, passwords, full payment details, or private personal data.

## 11. Testing Requirements

Create test cases for each intent.

Minimum test set:

- Greeting: `hi how are you?`
- Marketplace safety: `i was scammed`
- Marketplace safety: `i was cheated`
- Product search: `show me 4U racket under RM500`
- Product search: `recommend yonex racket`
- Beginner advice: `recommend beginner racket`
- Beginner typo: `recommend begineer best`
- Racket spec FAQ: `what does 5U mean?`
- Buying help: `how do I contact seller?`
- Selling help: `how to post an ad?`
- Account help: `how to enable 2FA?`
- Unsupported: `write my assignment`
- LLM failure simulation
- RAG low relevance simulation

## 12. Acceptance Criteria

- `hi how are you?` returns a greeting, not FAQ snippets.
- `i was scammed` returns marketplace safety/support guidance even if the LLM provider is unavailable.
- Product search returns only real marketplace listings.
- Beginner recommendation returns beginner-focused advice and deduplicated listings.
- RAG is not used for unrelated greetings or unsupported queries.
- If RAG context is unrelated, the bot does not display it.
- LLM provider failure does not produce random FAQ output.
- Every response path is traceable to one intent and one handler.

## 13. Recommended Implementation Phases

### Phase 1: Stabilize Current Behavior

- Add explicit `greeting` handling.
- Add `marketplace_safety` fallback.
- Prevent RAG fallback for greetings and unsupported messages.
- Add basic tests for the worst current failures.

### Phase 2: Introduce Intent Router

- Add structured intent output.
- Use strict JSON for LLM intent classification.
- Keep deterministic critical guard before the LLM router.
- Route all messages through named intents.

### Phase 3: Split Handlers

- Move product search, beginner advice, marketplace safety, FAQ, and unsupported logic into separate handlers.
- Make each handler own its allowed tools.

### Phase 4: Improve RAG Quality

- Add relevance scoring.
- Add intent-specific retrieval queries.
- Refuse to show low-confidence context.

### Phase 5: Production Hardening

- Add structured route logs.
- Add provider failure simulation tests.
- Add response snapshots for common flows.
- Consider using a more reliable paid LLM model/provider.

## 14. Final Recommendation

Adopt a hybrid chatbot architecture:

```text
Critical rules first.
LLM JSON router second.
Strict domain handlers third.
Verified tools only.
LLM composition only with approved context.
Intent-aware fallback always.
```

This keeps the chatbot flexible while preventing bad production behavior when the LLM is unavailable, confused, or given an unsupported message.
