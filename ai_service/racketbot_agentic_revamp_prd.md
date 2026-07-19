# PRD: RacketBot Agentic Reasoning Revamp

Date: 2026-07-09
Status: Draft for discussion

## 1. Problem

RacketBot currently behaves too much like a scripted router:

```text
keyword detected -> choose one tool -> print the tool result
```

This makes the bot feel rigid and shallow. It can answer known happy paths, but
new questions often require more deterministic rules, more one-off tools, and
more special-case fallback logic. The result is a chatbot that feels like it is
choosing which printer to use, rather than thinking through the user's question.

Examples of current pain:

- Seller comparison can become "call seller listing tool once and dump output"
  instead of gathering both sellers and comparing them.
- Tools return user-facing prose instead of structured facts, so the AI has
  less room to reason and compose.
- Keyword fallback logic can fight the agent and route questions to the wrong
  path.
- Provider failures add more deterministic emergency paths, which solves
  reliability but makes the architecture feel less intelligent.

The desired product is a real AI assistant that collects facts, reasons over
them, designs a response, checks its answer, and only then replies.

## 2. Product Vision

RacketBot should act like an agentic buyer assistant for RacketDiction.

It should not simply pick a prewritten answer path. It should:

1. Understand what the user is asking.
2. Decide what data is needed.
3. Call one or more data tools to gather facts.
4. Reason over the facts.
5. Compose a helpful answer in natural language.
6. Check whether the answer is complete, grounded, and safe.
7. Loop back for more data or rewrite if the answer is weak.

The core design principle:

```text
Tools provide facts.
The AI constructs the answer.
```

## 3. Goals

- Move from scripted routing to an agent loop with planning, data collection,
  reasoning, response composition, and self-checking.
- Make tools generic and reusable instead of creating a new tool for every new
  question.
- Make tool outputs structured data, not final prose.
- Allow the AI to call multiple tools in one answer when needed.
- Preserve strict backend authorization for private data.
- Keep deterministic code only for security, permission checks, hard business
  rules, provider outage fallback, and input/output validation.
- Improve answer quality for comparison, recommendation, seller, listing,
  profile, order, FAQ, and safety questions.

## 4. Non-Goals

- Do not give the AI unrestricted SQL access.
- Do not let the AI bypass backend permissions.
- Do not allow the AI to modify users, listings, orders, payments, prices,
  passwords, or seller data in this revamp.
- Do not create highly specific tools such as `compare_seller_9_and_10`.
- Do not rely on keyword routing as the primary decision engine.
- Do not remove deterministic safety checks.

## 5. Target User Experience

### Example 1: Seller Comparison

User:

```text
Can you compare seller 9 and seller 10 listing?
```

Desired internal process:

```text
Planner:
- Need seller 9 listings.
- Need seller 10 listings.
- Need to compare price, racket specs, seller rating, and practical tradeoffs.

Collector:
- get_seller_listings(9)
- get_seller_listings(10)

Reasoner:
- Seller 9 has an actual racket at RM150, 3U, stiff shaft, head heavy.
- Seller 10 has cheaper items, but some may be accessories, not rackets.
- If buyer wants a racket, seller 9 may be better.
- If buyer only wants cheapest item, seller 10 may be cheaper.

Composer:
- Explain the tradeoff clearly.
- Do not dump raw tool output.

Critic:
- Did the answer compare both sellers? Yes.
- Did it mention price and specs? Yes.
- Did it avoid inventing data? Yes.
```

Desired response:

```text
Boss, if you are comparing actual racket value, Seller 9 looks better.

Seller 9 has Racket Pro Attack at RM150:
- 3U
- Stiff Shaft
- Head Heavy
- Seller rating 4.4/5

Seller 10 has cheaper items, but the cheapest result is not necessarily a
racket, so it is not a fair racket-to-racket comparison.

My take:
- Best racket deal: Seller 9
- Cheapest item overall: Seller 10
- Better for smash/power: Seller 9 because of 3U + stiff + head heavy
```

### Example 2: Buyer Recommendation

User:

```text
I am a beginner. Should I buy this 3U stiff head-heavy racket or a 5U flexible one?
```

Desired behavior:

- Fetch listing details if listing IDs are provided.
- Use racket knowledge from FAQ/RAG.
- Reason about beginner suitability.
- Explain why the 5U flexible racket is likely easier.
- Mention tradeoffs, not just one winner.

### Example 3: Private Data

User:

```text
What is my username?
```

Desired behavior:

- AI decides it needs the current user's profile.
- Tool calls `get_my_profile`.
- Backend enforces JWT ownership.
- AI writes a short answer using returned data.

If logged out, the tool returns a structured `AUTH_REQUIRED` error and the AI
politely asks the user to log in.

## 6. Architecture Overview

Target pipeline:

```text
Frontend
  |
Backend AI proxy
  - validates optional JWT
  - forwards auth context
  - never trusts user-supplied userId
  |
AI Agent Orchestrator
  |
  +-- Planner
  |   Decides what facts are needed.
  |
  +-- Collector
  |   Calls safe tools and stores observations.
  |
  +-- Sufficiency Check
  |   Decides whether enough data has been collected.
  |
  +-- Reasoner
  |   Compares, ranks, explains, and derives tradeoffs.
  |
  +-- Composer
  |   Writes a natural answer for the chat UI.
  |
  +-- Critic
      Checks grounding, completeness, safety, and clarity.
      If weak, loop back to Collector or Composer.
```

Recommended implementation direction:

- Use LangGraph or an explicit LangChain agent loop for the orchestrator.
- Keep the backend as the source of truth for auth and database access.
- Keep tools as typed data adapters.
- Keep RAG as a retriever tool, not as a direct final answer path.

## 7. Agent Loop Design

### 7.1 Planner

Input:

- User message
- Conversation history
- Auth state
- Available tool list

Output:

```json
{
  "question_type": "seller_comparison",
  "data_needed": [
    "seller_9_listings",
    "seller_10_listings"
  ],
  "allowed_tools": [
    "get_seller_listings"
  ],
  "risk_level": "public"
}
```

Planner rules:

- Identify what facts are missing.
- Prefer generic tools.
- Do not answer yet unless no tools are needed.
- For comparison questions, plan multiple data calls.
- For private data, require auth-aware tools.

### 7.2 Collector

The collector executes the plan using tools.

It should support:

- One tool call.
- Multiple sequential tool calls.
- Multiple parallel public data calls where safe.
- Follow-up calls if the first result is insufficient.

Example:

```text
get_seller_listings(9)
get_seller_listings(10)
```

Collector output should be structured observations, not prose.

### 7.3 Sufficiency Check

The agent should ask:

```text
Do I have enough facts to answer the user's actual question?
```

If not, loop back to collection.

Examples:

- If comparing sellers and only one seller was fetched, collect the second.
- If comparing two listings and only listing IDs were found, fetch details.
- If a recommendation requires beginner context but experience level is
  missing, either ask a follow-up or provide assumptions clearly.

### 7.4 Reasoner

The reasoner turns facts into judgment.

Examples:

- Compare price.
- Compare racket weight.
- Compare flex and balance.
- Identify accessories vs actual rackets.
- Explain beginner suitability.
- Identify safety risk.
- Explain why one choice is better for a specific buyer goal.

The reasoner should not invent missing facts.

### 7.5 Composer

The composer writes the answer.

Responsibilities:

- Fit chat UI.
- Use concise Malaysian-friendly tone.
- Avoid raw JSON or raw tool dumps.
- Show tradeoffs clearly.
- Include product links where useful.
- Separate facts from recommendations.

### 7.6 Critic

The critic checks:

- Did the answer address the user's question?
- Did it use all required data?
- Did it compare all requested entities?
- Did it leak private data?
- Did it invent facts?
- Is the answer too generic?
- Is the answer too long for chat?

If the answer fails, the agent loops:

```text
Critic fail: "Only seller 9 was compared."
Action: go back to Collector and fetch seller 10.
```

## 8. Tool Design Principles

### 8.1 Tools Return Facts, Not Final Answers

Current-style output:

```text
Racket ID: 68
Title: Racket Pro Attack
Price: RM 150
...
```

Target output:

```json
{
  "type": "seller_listings",
  "seller_id": 9,
  "listings": [
    {
      "id": 68,
      "title": "Racket Pro Attack",
      "price": 150,
      "weight": "3U",
      "flex": "Stiff Shaft",
      "balance": "Head Heavy",
      "category": "Rackets",
      "location": "Subang Jaya",
      "seller_name": "Sport Master",
      "seller_rating": 4.4,
      "url": "/products/68"
    }
  ]
}
```

### 8.2 Generic Tool Set

Recommended core tools:

```text
search_listings(filters)
get_listing_detail(listing_id)
get_seller_profile(seller_id)
get_seller_listings(seller_id, filters)
get_my_profile()
get_my_orders(filters)
get_order_detail(order_id)
retrieve_policy_context(query)
retrieve_racket_knowledge(query)
```

Optional later tools:

```text
get_listing_reviews(listing_id)
get_seller_reviews(seller_id)
get_related_listings(listing_id)
get_market_price_range(specs)
```

Avoid tools like:

```text
answer_contact_seller_question()
compare_two_sellers()
answer_fake_racket_question()
```

Those tools encode final response behavior and make the system less flexible.

### 8.3 Tool Result Contract

Each tool should return a common envelope:

```json
{
  "ok": true,
  "tool": "get_seller_listings",
  "data": {},
  "meta": {
    "source": "backend",
    "freshness": "live",
    "permission": "public"
  },
  "error": null
}
```

Error example:

```json
{
  "ok": false,
  "tool": "get_my_orders",
  "data": null,
  "meta": {
    "permission": "private"
  },
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "User must log in to view orders."
  }
}
```

This lets the AI reason about success, missing data, and permission failures.

## 9. Security And Permission Model

Deterministic code should remain strict here.

Rules:

- The AI must never receive raw database credentials.
- The AI must never run arbitrary SQL.
- Private tools must use backend-validated JWT context.
- User ID must come from the backend auth layer, not from the frontend body.
- Order/profile tools must only return data for the authenticated user.
- Public tools may return public listing and seller data.
- The critic must check for private data leakage before final response.

Good:

```text
get_my_orders() -> backend uses JWT user id
```

Bad:

```text
run_sql("select * from orders where user_id = 7")
```

## 10. Fallback Philosophy

Fallbacks should be emergency brakes, not the primary brain.

Allowed fallback uses:

- LLM provider rate limit.
- LLM provider outage.
- Tool timeout.
- Malformed model tool call.
- Safety refusal.

Fallback should:

- Be safe.
- Be simple.
- Avoid pretending to reason deeply.
- Avoid expanding into a second deterministic chatbot.
- Clearly say when the answer is limited because the AI provider is unavailable.

Example:

```text
The AI provider is temporarily unavailable, Boss. I can still show the raw
seller listing facts, but I cannot do a deeper comparison right now.
```

## 11. Migration Plan

### Phase 1: Define Tool Data Contracts

- Convert tool outputs from prose strings to structured JSON.
- Keep old formatting temporarily for backward compatibility.
- Add envelope fields: `ok`, `tool`, `data`, `meta`, `error`.

### Phase 2: Build Agent Orchestrator

- Add explicit planner, collector, reasoner, composer, and critic stages.
- Use LangGraph or a clear LangChain loop.
- Add max steps to prevent infinite loops.
- Store observations separately from final answer.

### Phase 3: Reduce Deterministic Routing

- Remove most keyword-based routing from the main chat path.
- Keep deterministic checks for auth, safety, and provider fallback.
- Let the planner choose tools for seller, listing, profile, order, and FAQ
  questions.

### Phase 4: Improve Tool Selection

- Provide clear tool descriptions.
- Provide examples of multi-tool reasoning.
- Add tests for questions that require multiple tools.

### Phase 5: Add Critic And Loopback

- Add final answer quality checks.
- If answer misses requested entities, loop back.
- If answer is ungrounded, rewrite or collect more data.
- If answer is too generic, rewrite with concrete facts.

### Phase 6: Observability

Add internal debug traces:

```json
{
  "plan": {},
  "tools_called": [],
  "observations_count": 2,
  "critic_result": "pass",
  "fallback_used": false
}
```

Do not expose private trace details to users.

## 12. Acceptance Criteria

### Multi-Tool Reasoning

- "Compare seller 9 and seller 10 listing" calls seller listing tools for both
  sellers before answering.
- "Which is better, product 68 or product 20?" fetches both listing details
  before answering.
- "Find me a beginner racket under RM300 and explain why" searches listings,
  uses racket knowledge, then explains tradeoffs.

### Response Quality

- Final answer should not look like raw tool output.
- Final answer should include tradeoffs where relevant.
- Final answer should clearly distinguish facts from recommendations.
- Final answer should say when data is missing.

### Safety

- "Show Howard order" must not reveal Howard's orders to another user.
- Logged-out private requests should return login-required.
- Logged-in private requests should only use authenticated user data.

### Flexibility

- New comparison questions should not require new comparison-specific tools.
- New recommendation phrasing should not require new keyword branches.
- New seller/listing questions should be handled by planning plus generic tools.

## 13. Example End-To-End Trace

User:

```text
Can you compare seller 9 and seller 10 listing?
```

Planner output:

```json
{
  "question_type": "seller_comparison",
  "data_needed": [
    {
      "tool": "get_seller_listings",
      "args": { "seller_id": 9 }
    },
    {
      "tool": "get_seller_listings",
      "args": { "seller_id": 10 }
    }
  ]
}
```

Collector observations:

```json
[
  {
    "tool": "get_seller_listings",
    "seller_id": 9,
    "listings_count": 3
  },
  {
    "tool": "get_seller_listings",
    "seller_id": 10,
    "listings_count": 5
  }
]
```

Reasoner notes:

```text
Seller 9 has a true racket option at RM150.
Seller 10 has cheaper accessories, but those are not directly comparable to a
racket.
For racket value, seller 9 is stronger. For cheapest item overall, seller 10 is
cheaper.
```

Critic check:

```json
{
  "answered_user_question": true,
  "compared_all_requested_sellers": true,
  "grounded_in_tool_data": true,
  "private_data_leak": false,
  "needs_more_data": false
}
```

Final answer:

```text
Boss, if you mean actual racket value, Seller 9 looks better.

Seller 9:
- Racket Pro Attack
- RM150
- 3U, Stiff Shaft, Head Heavy
- Good if you want power and do not mind a heavier racket

Seller 10:
- Has cheaper items, but the cheapest one is an accessory, not a racket
- Not a fair racket-to-racket comparison unless we filter only rackets

My take:
- Best racket deal: Seller 9
- Cheapest item overall: Seller 10
- Better for smash/power: Seller 9
```

## 14. Open Questions

- Should the agent ask follow-up questions when user intent is broad, or should
  it answer with assumptions?
- Should seller/listing comparison only compare rackets by default, or all
  marketplace items?
- Should we show internal reasoning traces in development mode?
- Should fallback answers mention provider outages to the user, or hide that
  behind a simpler message?
- Should LangGraph be introduced now, or should the current LangChain agent be
  refactored first?

## 15. Recommended Next Step

Do not keep adding more specific answer tools.

The next engineering step should be a small prototype of the new loop:

```text
Planner -> Collector -> Reasoner -> Composer -> Critic
```

Start with one test case:

```text
Compare seller 9 and seller 10 listing.
```

Success means the agent gathers both sellers, reasons about the difference, and
writes a real comparison without a hardcoded seller-comparison response tool.
