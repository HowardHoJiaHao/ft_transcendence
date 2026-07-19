# PRD v2: RacketBot Agentic Reasoning Revamp

Date: 2026-07-10
Status: Ready for implementation
Supersedes: `racketbot_agentic_revamp_prd.md` (v1, keep for reference)

## 0. What Changed From v1 (Read This First)

v1 correctly diagnosed the problem and correctly proposed "tools provide
facts, the AI constructs the answer." Two things in v1 were wrong or missing:

1. **v1 missed the root cause.** The current system is rigid because the
   LLM setup cannot do reliable tool calling, so deterministic scaffolding
   grew around it as compensation. Evidence in the code today:
   - `agent.py` uses `AgentType.STRUCTURED_CHAT_ZERO_SHOT_REACT_DESCRIPTION`
     — a deprecated, prompt-parsed agent where the model must emit JSON as
     plain text and LangChain regex-parses it back out.
   - `main.py::_extract_pseudo_tool_call` exists to rescue *malformed XML
     tool calls* the model prints as text.
   - `main.py::_normalize_agent_answer` exists to rescue broken JSON answers.
   - `main.py::_needs_listing_search_fallback` exists to catch answers that
     stop at "let me search...".
   - ~500 lines of keyword routing in `main.py` intercept most messages
     *before* the agent runs, because the agent isn't trusted.

   No orchestrator redesign fixes this. The fix is **native function
   calling**: a model that supports the OpenAI-style `tools` parameter, and
   an agent built on it. This is now Phase 0 — a hard prerequisite.

2. **v1's five-role pipeline (Planner → Collector → Sufficiency → Reasoner
   → Composer) is over-engineered.** A single LLM in a native tool-calling
   loop already does all five jobs implicitly: it decides what data it needs
   (planning), calls tools — possibly several, possibly repeatedly
   (collection), keeps calling until it has enough (sufficiency), then
   writes the answer (reasoning + composition). Building them as five
   explicit LLM stages means 4–6 LLM calls per message (slow, rate-limited
   on free tier) and is itself another form of scripting — a rigid pipeline
   replacing rigid keywords. v2 replaces it with **one tool-calling loop
   plus a small bounded validator**.

Everything else from v1 carries over: the problem statement (§1), tool
design principles, the structured result envelope, the security model, the
fallback philosophy, and the acceptance criteria.

## 1. Problem

Unchanged from v1, summarized:

```text
keyword detected -> choose one tool -> print the tool result
```

Tools return user-facing prose. Keyword routing fights the agent. Every new
question type needs a new branch or a new tool. The bot is a scripted
printer, not an assistant.

Additional problems found in the code that v1 did not list:

- **Concurrency bug:** `main.py` caches one global `agent_executor` whose
  shared `ConversationBufferWindowMemory` is `clear()`ed and refilled per
  request (`agent.py::run_agent_with_history`). Two concurrent users will
  cross-contaminate conversation history. The new design must be stateless
  per request.
- **Tools contain reasoning that belongs to the LLM:**
  `_beginner_score` hardcodes racket judgment; `search_listings` runs its
  own multi-attempt broadened re-searches; `get_profile_based_recommendations`
  composes the entire final user-facing answer inside the tool.
- **Two extra "formatter" LLM entry points** (`format_listing_search_response`,
  `format_beginner_recommendation_response`) exist only because tools return
  prose that then needs re-humanizing. With structured tool output, the
  agent's own final answer is the composer and these are deleted.

## 2. Product Vision

Unchanged from v1. RacketBot should:

1. Understand what the user is asking.
2. Decide what data is needed.
3. Call one or more data tools to gather facts.
4. Reason over the facts.
5. Compose a helpful answer.
6. Validate the answer; retry at most once if it fails.

Core principle: **Tools provide facts. The AI constructs the answer.**

## 3. Goals

- Native function calling replaces prompt-parsed pseudo-tool-calls.
- One agent loop replaces keyword routing as the primary decision engine.
- Tools return structured JSON facts in a common envelope, never prose.
- The agent may call multiple tools (and the same tool multiple times) in
  one answer.
- Fewer tools than today, not more: multi-tool answers come from the loop
  iterating, not from a bigger tool catalog.
- Per-request statelessness (fixes the shared-memory race).
- Strict backend authorization preserved exactly as today.
- Deterministic code only for: auth gating, safety, provider-outage
  fallback, and output validation.

## 4. Non-Goals

Unchanged from v1:

- No raw SQL access for the AI.
- No bypassing backend permissions.
- No write operations (users, listings, orders, payments) in this revamp.
- No hyper-specific tools (`compare_seller_9_and_10`).
- No keyword routing as the primary decision engine.
- Deterministic safety checks stay.

Additionally out of scope for v2:

- True token streaming from the LLM (current word-by-word simulated
  streaming stays; real streaming is a later nice-to-have).
- An LLM-based critic on every message (see §7.3 — deterministic checks
  first, LLM critic is a later phase).

## 5. Target User Experience

Unchanged from v1 — all three examples (seller comparison, buyer
recommendation, private data) still define success. See v1 §5.

The key behavioral difference: "Compare seller 9 and seller 10" is answered
by the agent *choosing* to call `get_seller_listings` twice and composing a
comparison — not by any comparison-specific code path.

## 6. Architecture

```text
Frontend
  |
Backend AI proxy (unchanged)
  - validates optional JWT, forwards auth context
  - never trusts a user-supplied userId for data access
  |
FastAPI /chat (main.py, heavily slimmed)
  - sets auth ContextVars
  - structured recommendationProfile entry point (kept, it's a UI flow)
  - provider-outage fallback (kept, emergency brake only)
  |
Agent loop (ONE LLM with native tool calling)
  - system prompt: persona, capabilities, formatting rules
  - loop: LLM -> tool call(s) -> structured results appended -> LLM ...
  - max 5 tool iterations per message (hard cap)
  - stateless: conversation history rebuilt from request payload each time
  |
Validator (mostly deterministic, cheap)
  - leaked raw JSON / tool syntax in answer?  -> strip or retry
  - private-data leak heuristics              -> block
  - empty/too-short answer                    -> retry once
  - at most ONE retry loop, then fallback
  |
Answer streamed to user
```

### 6.1 Implementation Choice

Use **LangGraph's prebuilt `create_react_agent`** (or, equivalently, a
minimal hand-rolled `llm.bind_tools()` while-loop — either is acceptable;
pick one and keep it simple). Do **not** refactor the existing
`initialize_agent` code — it is deprecated and throwaway.

Requirements:

- Model must support native function calling through the OpenRouter
  `tools` parameter. Verify with a smoke test before building anything
  else (Phase 0). If the current free model fails the smoke test, switch
  to a free/cheap model that passes.
- `handle_parsing_errors`, `_extract_pseudo_tool_call`,
  `_normalize_agent_answer` and all pseudo-tool-call rescue code are
  deleted, not ported.
- Per-request invocation: build the message list (system + history +
  user message) inside the request handler. No shared memory object.

### 6.2 Why Not the v1 Five-Stage Pipeline

| v1 stage        | v2 home                                            |
|-----------------|-----------------------------------------------------|
| Planner         | The tool-calling LLM's own decision, guided by tool descriptions |
| Collector       | The loop's tool-execution step                      |
| Sufficiency     | The LLM choosing "call another tool" vs "answer"    |
| Reasoner        | The LLM's final-answer turn, over structured facts  |
| Composer        | Same turn — the answer *is* the composition         |
| Critic          | Kept, as the bounded Validator (§7.3)               |

One LLM call chain instead of five stages = lower latency, fewer failure
points, fewer rate-limit hits, and genuinely more flexible (the model, not
a pipeline, decides the shape of the work).

## 7. Agent Loop Design

### 7.1 System Prompt

Carries over the RacketBot persona, buyer-only scope, platform facts,
Malaysian-English tone, and chat formatting rules from `agent.py`. Remove
every "if the user asks X, call tool Y" routing instruction — with native
tool calling and good tool descriptions, the model routes itself. Keep:

- Persona, scope ("help buyers only"), platform facts.
- Formatting: card-style blocks, no Markdown tables, product links as
  `/products/{id}`, concise.
- Grounding rule: "Only state facts that appear in tool results. If data
  is missing, say so. Never invent listings, prices, or specs."
- Multi-step encouragement: "For comparisons, fetch data for every entity
  the user mentions before answering."

### 7.2 The Loop

- Max 5 tool iterations per message. On hitting the cap, answer with
  whatever facts were gathered, stating limitations.
- Tool results are appended to the conversation as structured JSON
  (the envelope in §8.3). The model reasons over them in context.
- Parallel tool calls (model requests several at once) are executed
  concurrently when the model emits them — free win with native tool
  calling.

### 7.3 Validator (v1's "Critic", right-sized)

Runs after the agent produces a final answer. Deterministic checks, in
order:

1. **Tool-syntax leak:** answer contains `<tool_call>`, raw envelope JSON,
   or obvious tool-dump formatting -> strip if trivial, else retry.
2. **Private-data leak:** answer contains email/phone patterns when the
   request context is unauthenticated -> block, replace with login prompt.
3. **Emptiness:** answer empty or < 10 words for a data question -> retry.

Retry = one re-invocation of the agent with an appended corrective system
note (e.g. "Your previous answer leaked raw tool output. Rewrite it as a
clean chat answer."). **Maximum one retry**, then the provider fallback
message.

An LLM-based critic (grounding check, "did you compare both sellers?") is
**Phase 5, optional** — add only if real transcripts show grounding
failures the deterministic checks miss.

## 8. Tool Design

### 8.1 Principles

Unchanged from v1: tools return facts, not final answers; generic tools,
not per-question tools; common envelope; typed errors the model can reason
about (`AUTH_REQUIRED`, `NOT_FOUND`, `BACKEND_ERROR`).

### 8.2 Target Tool Set (fewer than today's 10)

| Tool | Notes |
|------|-------|
| `search_listings(filters)` | Strip the internal multi-attempt broadening; return `{listings, filters_used, total}`. If empty, the *agent* decides whether to search broader — that decision is the agentic behavior we want. Keep `racket_only` as a filter. |
| `get_listing_detail(listing_id)` | JSON instead of prose. |
| `get_seller_profile(seller_id)` | Rename of `get_seller_info`; JSON. |
| `get_seller_listings(seller_id, limit)` | JSON. |
| `get_my_profile()` | Rename of `get_user_profile`; JSON; `AUTH_REQUIRED` error when logged out. |
| `get_my_orders()` | JSON; `AUTH_REQUIRED` when logged out. |
| `get_order_detail(order_id)` | Rename of `get_order_status`; JSON; `AUTH_REQUIRED` / `FORBIDDEN`. |
| `retrieve_knowledge(query)` | Rename of `get_faq_policies`. RAG over FAQ docs — platform policies, safety guidance, racket spec knowledge (weight/flex/balance/tension). Returns chunks + sources as data, not a final answer. |
| `predict_racket_specs(profile)` | Wraps the ML model from `get_profile_based_recommendations`, but returns ONLY the predicted specs JSON (`weightCategory`, `flexibilityCategory`, `balanceCategory`, `confidence`). The agent then calls `search_listings` with those specs and composes the recommendation itself. |

**Dissolved (deleted, their jobs move to the agent):**

- `get_beginner_recommendations` + `_beginner_score` — beginner judgment
  comes from `retrieve_knowledge("beginner racket specs")` + the LLM
  reasoning over search results.
- `format_listing_search_response`, `format_beginner_recommendation_response`
  — the agent's final answer is the composer.
- The answer-composition half of `get_profile_based_recommendations`
  (`_profile_reason`, `_fallback_tradeoff_message`,
  `_fetch_profile_matches` relaxation ladder) — the agent handles "no
  exact match, here's the tradeoff" conversationally. The deterministic
  relaxation ladder may be kept temporarily behind the structured
  `recommendationProfile` entry point if quality regresses without it.

### 8.3 Tool Result Envelope

Unchanged from v1:

```json
{
  "ok": true,
  "tool": "get_seller_listings",
  "data": { "seller_id": 9, "listings": [ ... ] },
  "meta": { "source": "backend", "permission": "public" },
  "error": null
}
```

```json
{
  "ok": false,
  "tool": "get_my_orders",
  "data": null,
  "meta": { "permission": "private" },
  "error": { "code": "AUTH_REQUIRED", "message": "User must log in to view orders." }
}
```

Listing objects inside `data` use the v1 §8.1 shape (id, title, price as a
number, weight, flex, balance, category, location, seller_name,
seller_rating, url).

## 9. Security and Permission Model

Unchanged from v1, all rules carry over. Confirmed against current code:

- Auth token flows via ContextVars (`user_id_var`, `auth_token_var`) and is
  forwarded as a Bearer header to the Go backend, which enforces ownership.
  Keep exactly this pattern.
- `user_id_var` is used only as a logged-in gate; data access authority
  comes from the JWT, so a spoofed `userId` without a valid token gets
  nothing from the backend. Preserve this property.
- New: the Validator's private-data leak check (§7.3) runs on every answer.

## 10. Fallback Philosophy

Unchanged from v1: fallbacks are emergency brakes, not the primary brain.
Triggers: provider outage/rate limit, tool timeout, validator double-fail.

Concretely for the migration: `main.py::_fallback_non_llm_answer` and the
deterministic answer functions it calls may be **kept but demoted** — they
run only from the exception handler, never as pre-routing. The keyword
*pre-routing* (`_deterministic_intent_answer` and friends running before
the agent) is deleted from the happy path.

## 11. Migration Plan

### Phase 0: Prove Native Tool Calling (prerequisite, ~half a day)

- Write a 30-line smoke test: current OpenRouter model + `bind_tools` with
  2 dummy tools; verify it emits real `tool_calls`, including two calls for
  a comparison-shaped prompt.
- If the current model fails, pick a free/cheap OpenRouter model that
  passes and pin it in `.env`.
- **Do not proceed until this passes.** Everything downstream assumes it.

### Phase 1: Structured Tool Contracts

- Convert all kept tools (§8.2) to return the JSON envelope.
- Delete prose formatting from tools (`_format_products` etc. removed or
  reduced to dict builders).
- Add typed errors (`AUTH_REQUIRED`, `NOT_FOUND`, `BACKEND_ERROR`).

### Phase 2: New Agent Loop

- Build the LangGraph `create_react_agent` (or minimal `bind_tools` loop)
  with the §7.1 system prompt, max-5-iteration cap, stateless per-request
  message construction.
- Delete: `initialize_agent` usage, `ConversationBufferWindowMemory`,
  `handle_parsing_errors`, `_extract_pseudo_tool_call`,
  `_normalize_agent_answer`, `_strip_pseudo_tool_calls`.

### Phase 3: Delete Keyword Pre-Routing

- Remove from the `/chat` happy path: `_deterministic_intent_answer`,
  `_is_beginner_recommendation` branch, `_should_direct_listing_search`
  branch, `_search_filters_from_message`, `_extract_requested_count`,
  `_fallback_listing_search`, `_needs_listing_search_fallback`,
  `_fallback_private_tool_answer`, `_fallback_seller_tool_answer`, the two
  formatter LLM helpers.
- Keep: `recommendationProfile` structured entry point; exception-handler
  fallback (§10); greeting short-circuit optional (delete preferred — let
  the agent greet).

### Phase 4: Validator

- Implement §7.3 deterministic checks + single retry.

### Phase 5 (optional, evidence-driven): LLM Critic

- Only if transcripts show ungrounded or incomplete comparisons that the
  deterministic validator misses.

### Phase 6: Observability

- Log per message: tools called (name + args), iteration count, validator
  result, retry used, fallback used. Internal logs only, never shown to
  users.

## 12. Acceptance Criteria

Carried over from v1 verbatim (multi-tool reasoning, response quality,
safety, flexibility), plus:

- **No rescue parsing:** zero occurrences of `<tool_call>` handling or
  JSON-rescue regex in the final code.
- **Statelessness:** two interleaved concurrent `/chat` requests with
  different histories produce uncontaminated answers.
- **Iteration cap:** a pathological prompt cannot drive more than 5 tool
  iterations + 1 validator retry.
- **Latency budget:** typical single-tool question ≤ 2 LLM calls; typical
  comparison ≤ 3 LLM calls (loop turns), excluding the optional Phase 5
  critic.

## 13. Example End-To-End Trace

Same target trace as v1 §13, but note the mechanism: both
`get_seller_listings` calls are chosen by the model inside one loop —
there is no planner JSON artifact and no comparison code path.

## 14. Resolved Questions (were open in v1)

- **Follow-up vs assumptions:** answer with stated assumptions
  ("Assuming you want rackets only, Boss..."); ask a follow-up only when
  the answer would be useless without it.
- **Comparison scope:** default to comparing rackets when the user says
  "racket", all items otherwise; the agent states which scope it used.
- **Reasoning traces:** dev logs yes (Phase 6), users never.
- **Mention provider outage:** yes, briefly and honestly, per v1 §10.
- **LangGraph now or refactor first:** LangGraph (or minimal bind_tools
  loop) now; the deprecated agent is throwaway, not a refactor target.

## 15. First Milestone

Phase 0 smoke test, then one vertical slice:

```text
"Compare seller 9 and seller 10 listing"
```

passing end-to-end through the new loop — two tool calls chosen by the
model, structured JSON observations, composed comparison answer, validator
pass — before migrating the remaining tools.
