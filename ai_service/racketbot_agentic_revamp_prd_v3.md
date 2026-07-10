# PRD v3: RacketBot Agentic LLM Revamp

Date: 2026-07-10
Status: Ready for implementation
Supersedes: `racketbot_agentic_revamp_prd_v2.md`
Related: `racketbot_rag_ml_revamp_prd.md`

## 0. Decision Summary

RacketBot will use one stateless native tool-calling agent loop built with a
currently supported LangChain/LangGraph API.

The final happy path will not use keyword intent routing, regex-extracted tool
calls, comparison-specific handlers, or formatter LLMs. The model decides what
facts it needs, calls generic read-only tools, evaluates their structured
results, and writes the final answer.

Deterministic application code remains only where model judgment is not
appropriate:

- JWT authentication and backend authorization.
- Tool argument and result validation.
- Read-only tool boundaries and field allowlists.
- Request, time, and tool-iteration limits.
- Output leak checks.
- Provider and dependency failure handling.

Core principle:

```text
Tools provide evidence, calculations, predictions, and live facts.
The LLM plans, evaluates, synthesizes, and explains.
```

## 1. Problem

The current RacketBot behaves like several scripted chatbots surrounding an
unreliable prompt-parsed agent.

Current behavior includes:

- Keyword branches deciding whether a request is a greeting, FAQ, beginner
  recommendation, listing search, seller lookup, profile request, or order
  request.
- A deprecated structured-chat ReAct agent that emits tool instructions as
  ordinary generated text rather than native function calls.
- XML and JSON rescue parsing for malformed pseudo-tool calls.
- Tools that return final user-facing prose instead of structured facts.
- Separate formatter LLM calls that re-humanize tool prose.
- One global agent executor with mutable conversation memory that is cleared
  and repopulated for each request, creating a concurrency risk.
- RAG responses that may expose retrieved FAQ chunks almost verbatim instead
  of answering the question.
- An ML recommendation tool that combines prediction, search relaxation,
  explanation, and response formatting in one opaque operation.

This architecture is rigid because each new type of user wording or question
creates pressure for another keyword rule, tool, formatter, or fallback.

## 2. Product Vision

RacketBot is an agentic, buyer-first assistant for the RacketDiction badminton
marketplace. It may explain public platform how-to information, including basic
listing creation guidance, but it does not troubleshoot private seller accounts,
operate seller dashboards, or perform seller actions.

It should be able to:

1. Understand varied natural-language questions without keyword intent routes.
2. Decide what live data, retrieved knowledge, or ML prediction is needed.
3. Call one or several tools, including the same tool more than once.
4. Notice missing or failed evidence and decide whether another safe tool call
   would help.
5. Evaluate suitability, value, tradeoffs, completeness, and alternatives.
6. Explain conclusions in concise Malaysian-friendly language.
7. Clearly distinguish known facts, model predictions, recommendations, and
   uncertainty.
8. Refuse or limit private-data access based on backend authorization results.

The agent must support more than numerical comparison. Depending on available
evidence, it may:

- Explain how racket specifications affect play.
- Assess whether a listing fits a user's needs.
- Identify which stated requirements are satisfied or missed.
- Recommend alternatives when no exact match exists.
- Identify missing listing information the buyer should ask about.
- Combine RAG knowledge, an ML prediction, and current marketplace results.
- Explain why an answer cannot be reliable when evidence is unavailable.

## 3. Goals

- Replace prompt-parsed pseudo-tool calls with native function calling.
- Replace keyword intent routing with one model-directed agent loop.
- Use a currently supported LangChain/LangGraph agent API.
- Build messages and execution state per request; no shared mutable memory.
- Convert all agent tools to typed, structured result envelopes.
- Allow multi-tool and repeated-tool behavior.
- Make RAG a knowledge evidence tool, not a final-answer path.
- Make the ML recommender a prediction tool, not a final-answer path.
- Preserve the structured frontend recommendation assessment.
- Keep backend authorization as the security boundary.
- Use one small, honest provider-unavailable fallback.
- Add reproducible agent, tool, concurrency, authorization, and grounding tests.

## 4. Non-Goals

- No raw SQL tool.
- No arbitrary HTTP or database access for the model.
- No write tools for users, listings, orders, messages, payments, or prices.
- No agent-controlled authentication or authorization decisions.
- No keyword router as a second happy-path chatbot.
- No dedicated `compare_two_sellers`, `answer_beginner_question`, or
  `explain_answer` tool.
- No seller reputation scoring until the product has a defined seller-level
  data contract and reliable supporting inputs.
- No claim that a seller, listing, recommendation, or transaction is guaranteed
  safe.
- No exposed chain-of-thought or private reasoning trace.
- No requirement for true token streaming in this revamp.
- No multi-agent planner/critic architecture for the initial release.

## 5. Architecture

```text
Next.js chat UI
  |
  | message + recent history + optional recommendationProfile
  | optional Authorization: Bearer <JWT>
  v
Go AI proxy
  - validates optional JWT
  - derives user identity from JWT claims
  - forwards trusted auth context to the AI service
  v
FastAPI /chat
  - creates request-local message state
  - sets request-local auth context
  - invokes one native tool-calling agent
  v
LangChain/LangGraph agent loop
  - model chooses tool calls or final answer
  - executor validates and runs allowed read-only tools
  - structured tool results are appended as observations
  - loop stops on final answer or total budget
  v
Deterministic output validator
  - answer present
  - no raw tool syntax/envelope dump
  - no obvious unauthorized private-data leak
  - optional rewrite-only retry
  v
SSE response
```

## 6. Framework and Dependency Decision

Use LangGraph through a currently supported LangChain/LangGraph agent API.
Do not copy the exact deprecated API name from an older example without
checking the installed version.

Implementation requirements:

1. Upgrade and pin a mutually compatible set of `langchain`,
   `langchain-core`, `langchain-openai`, and LangGraph dependencies.
2. Use the supported agent constructor for those pinned versions.
3. Confirm that the resulting client sends OpenAI-compatible `tools` and
   receives native `tool_calls` through OpenRouter.
4. Record the chosen package versions and model ID in configuration.
5. Do not reuse `initialize_agent`,
   `STRUCTURED_CHAT_ZERO_SHOT_REACT_DESCRIPTION`, or
   `ConversationBufferWindowMemory`.

LangGraph is used for the bounded tool-calling loop, not to introduce five
separate LLM roles. Planner, collector, sufficiency decision, reasoning, and
composition occur naturally across the model's loop turns.

## 7. Request Lifecycle

### 7.1 Normal Message

FastAPI constructs a new message list for each request:

```text
System message
Recent validated conversation history
Current user message
```

No request clears, mutates, or reuses another request's conversation memory.

### 7.2 Structured Recommendation Assessment

The frontend currently sends a completed `recommendationProfile` with:

- `age_group`
- `gender`
- `experience_level`
- `play_style`
- `budget_range`

This is a structured UI event, not keyword intent routing. The AI service:

1. Validates the controlled profile values.
2. Includes the profile as trusted request context for the agent.
3. Instructs the agent to use `predict_racket_specs` for the completed
   assessment.
4. Lets the agent retrieve relevant racket knowledge and search current
   listings before composing the recommendation.

The profile path must no longer bypass the agent to return tool-generated final
prose.

### 7.3 Agent Loop

Example comparison:

```text
User: Compare the listings from seller 9 and seller 10.

Model turn 1:
  tool_call get_seller_listings(seller_id=9)
  tool_call get_seller_listings(seller_id=10)

Executor:
  validates both calls
  executes them concurrently when supported
  appends both structured observations

Model turn 2:
  evaluates all returned listings
  states scope and missing information
  produces the final answer
```

Sequential calls are also valid. Parallel calls are an optimization, not a
correctness requirement.

## 8. Execution Budgets

Use one total request budget rather than resetting limits during validation.

Initial limits:

- Maximum 5 model tool-selection iterations.
- Maximum 8 total tool executions.
- Maximum 20 seconds agent wall time, configurable by environment.
- Maximum 1 final-answer rewrite.
- The rewrite uses already collected evidence and cannot call more tools.

On the iteration or execution limit, the agent should answer using the evidence
already gathered and clearly state the limitation. It must not continue in an
unbounded loop.

## 9. System Prompt Requirements

The system prompt should define behavior, not keyword routing.

Keep:

- RacketBot identity and buyer-first scope: buyer assistance and public
  marketplace how-to are supported; private seller operations are not.
- Malaysian Ringgit and marketplace terminology.
- Concise Malaysian-friendly tone.
- Chat-friendly cards and bullets; no Markdown tables.
- Product links as `/products/{id}`.
- Grounding and privacy requirements.
- Clear separation of facts, predictions, recommendations, and uncertainty.

Required reasoning behavior:

- Use tools whenever current marketplace, private account, order, seller,
  listing, RAG, or ML information is required.
- For a requested comparison, obtain evidence for every requested entity before
  concluding.
- For recommendations, explain which user needs are satisfied and which are
  tradeoffs.
- When using ML output, call it a prediction or recommendation, not a fact.
- When using retrieved knowledge, synthesize it; do not copy raw chunks.
- Do not invent listings, prices, specifications, platform features, sources,
  model confidence, or seller attributes.
- If information is absent, say what is missing.
- Ask a follow-up only when a useful answer cannot be produced with a clearly
  stated assumption.

Do not include instructions such as `if message contains X, call tool Y`.
Tool selection should be driven by tool schemas, descriptions, context, and the
model's native function-calling capability.

## 10. Core Tool Set

### 10.1 `search_listings`

Purpose: retrieve current marketplace listings using optional filters.

Inputs may include query, racket specifications, price range, sort, limit, and
`racket_only`.

It performs one search per call. It does not automatically broaden the query or
write recommendation prose. If no exact result exists, the agent decides whether
another broader call is useful.

### 10.2 `get_listing_detail`

Purpose: retrieve allowlisted public facts for one listing.

### 10.3 `get_seller_profile`

Purpose: retrieve public fields already supported by the user profile endpoint,
such as username, public name, public bio, and verification state where
available.

It must not invent or aggregate seller ratings, sales performance, reputation,
or trust scores.

### 10.4 `get_seller_listings`

Purpose: retrieve active public listings belonging to a seller.

Any rating included in a listing is treated according to the backend listing
contract. It must not be relabelled as an independently calculated seller
reputation score.

### 10.5 `get_my_profile`

Purpose: retrieve allowlisted fields for the JWT-authenticated user.

Errors include `AUTH_REQUIRED` and backend authorization failures.

### 10.6 `get_my_orders`

Purpose: retrieve recent orders owned by the JWT-authenticated buyer.

### 10.7 `get_order_detail`

Purpose: retrieve a specific order only when the backend authorizes the current
JWT owner.

Errors distinguish `AUTH_REQUIRED`, `FORBIDDEN`, and `NOT_FOUND` where the
backend response permits that distinction.

### 10.8 `retrieve_knowledge`

Purpose: retrieve structured RAG evidence covering platform behavior, safety,
buying guidance, and racket specifications.

It returns chunks and source metadata, never a final answer. Its design is
specified in `racketbot_rag_ml_revamp_prd.md`.

### 10.9 `predict_racket_specs`

Purpose: execute the existing ML recommender against a validated structured
assessment profile.

It returns predicted specifications and supported confidence metadata, never
marketplace search results or final prose. Its design is specified in
`racketbot_rag_ml_revamp_prd.md`.

## 11. Possible Later Analytical Tools

Only add these after their required backend data and evaluation logic exist:

- `get_market_price_stats(filters)` for sample size, median, quartiles, and
  range.
- `get_listing_quality_signals(listing_id)` for missing specifications,
  description, condition, and photo count.
- `find_similar_listings(listing_id, constraints)` for alternatives.
- `evaluate_racket_fit(profile, listing_ids)` when backed by a validated model
  or transparent scoring contract.

These tools return evidence or calculations. They do not return final answers.

`get_seller_signals` is explicitly excluded until seller-level inputs, outputs,
and product semantics are implemented and validated.

## 12. Tool Result Contract

All tools return a common JSON-serializable envelope:

```json
{
  "ok": true,
  "tool": "get_listing_detail",
  "data": {},
  "meta": {
    "source": "backend",
    "permission": "public"
  },
  "error": null
}
```

Error example:

```json
{
  "ok": false,
  "tool": "get_order_detail",
  "data": null,
  "meta": {
    "source": "backend",
    "permission": "private"
  },
  "error": {
    "code": "FORBIDDEN",
    "message": "The authenticated user cannot view this order."
  }
}
```

Rules:

- Use stable typed error codes.
- Keep numeric values numeric.
- Use backend field allowlists instead of passing complete database objects.
- Do not include password, token, internal security, or unrelated personal
  fields.
- Do not include preformatted user-facing cards or recommendations.
- Include enough metadata to distinguish live backend facts, RAG evidence, and
  ML predictions.

## 13. Explanation Design

There is no generic `explain_answer` tool.

The agent explains by combining:

```text
Live facts from marketplace tools
+ domain evidence from retrieve_knowledge
+ prediction evidence from predict_racket_specs
+ the user's stated needs and constraints
```

A good recommendation states:

- What was observed.
- What was predicted, if ML was used.
- Why the evidence matters for this user.
- Which requirements match.
- Which tradeoffs or missing facts remain.
- How confident the answer can reasonably be.

The agent must not expose private chain-of-thought. It provides a concise,
user-facing rationale grounded in tool evidence.

## 14. Security and Privacy

- The Go proxy validates the optional frontend JWT and derives the user ID from
  its claims.
- The AI service forwards the Bearer token to protected Go endpoints.
- Go middleware and handlers remain the authorization boundary.
- The model never receives database credentials or a SQL tool.
- User-supplied IDs do not grant access to private resources.
- Public and private tool schemas use explicit field allowlists.
- Tool descriptions cannot override backend authorization.
- Retrieved documents and listing descriptions are untrusted content, not
  system instructions.
- Logs must not contain bearer tokens, full private tool results, or sensitive
  profile fields.

## 15. Output Validator

The validator is not another chatbot and does not decide intent.

It checks:

1. Final answer is non-empty.
2. Final answer does not contain `<tool_call>`, tool-call JSON, or a raw result
   envelope dump.
3. Logged-out responses do not contain obvious email or phone leakage.
4. Product IDs and URLs in structured answer data are well formed where such
   validation is available.

If the answer fails a presentation check, request one rewrite using already
collected evidence. The rewrite cannot execute tools. If it fails again, return
the simple provider/response failure message.

Authorization must never depend on this validator.

## 16. Fallback Philosophy

The fallback is intentionally not a second deterministic chatbot.

If the LLM provider is unavailable:

```text
Sorry Boss, RacketBot is temporarily unavailable. Please try again shortly.
```

If a live marketplace tool fails while the LLM remains available, the tool
returns `BACKEND_ERROR` or `TIMEOUT`. The agent may explain that it cannot make a
current listing recommendation and may offer general knowledge only when that
knowledge is available.

Do not:

- Run keyword intent answers during normal or fallback processing.
- Copy FAQ chunks directly to the user.
- Dump raw listing facts as a substitute for model reasoning.
- Pretend to have evaluated current data when the required tool failed.

## 17. Migration Plan

### Phase 0: Dependency and Native Tool-Calling Proof

- Choose and pin compatible modern LangChain/LangGraph packages.
- Verify the configured OpenRouter model returns native `tool_calls`.
- Test one call, multiple calls, no-tool answer, invalid arguments, and a tool
  error.
- Verify the model can request two seller-listing tools for a comparison-shaped
  prompt. Sequential calls are acceptable.

Do not proceed until native tool calls work without XML or JSON rescue parsing.

### Phase 1: Structured Tools

- Introduce the common result envelope and typed errors.
- Convert core tools to structured facts.
- Add unit tests with mocked backend responses.
- Add public/private field allowlists.
- Implement the RAG and ML contracts from the related PRD.

### Phase 2: Stateless Agent Loop

- Build the supported LangChain/LangGraph agent.
- Construct request-local messages from system prompt, recent history, and the
  current request.
- Add total iteration, execution, time, and rewrite budgets.
- Preserve request-local auth propagation.

### Phase 3: Vertical Slices

Validate at least:

1. Two-seller or two-listing comparison using deterministic test fixtures.
2. Beginner recommendation using RAG plus listing search.
3. Structured assessment using ML prediction, RAG, and listing search.
4. Logged-in profile and order access.
5. Logged-out and forbidden private-data requests.

Test fixtures may use any valid sellers. Example IDs in documentation are not a
required database seed.

### Phase 4: Replace the Happy Path

- Route `/chat` through the new agent.
- Remove keyword pre-routing from the normal request path.
- Remove formatter LLM entry points.
- Remove pseudo-tool-call and JSON rescue parsing.
- Remove shared conversation memory.
- Retain only the simple infrastructure fallback.

### Phase 5: Validator and Observability

- Add the bounded output validator.
- Log tool names, safe arguments, execution time, result status, model turns,
  validator result, and fallback use.
- Redact tokens and private results.

### Phase 6: Evidence-Driven Enhancements

- Review real anonymized transcripts and failure categories.
- Add an analytical tool only when several observed questions need the same
  missing calculation or evidence.
- Add an LLM critic only if measured grounding failures remain after tool,
  prompt, retrieval, and test improvements.

## 18. Testing Requirements

### Native Tool Calling

- Real `tool_calls` are received; no parsing generated XML or action JSON.
- One prompt can lead to multiple tool executions.
- Invalid tool arguments produce a structured validation error.

### Agent Flexibility

- Paraphrased listing and recommendation questions require no new code branch.
- A comparison retrieves all requested entities.
- An empty search can lead the agent to perform one sensible broader search.
- A follow-up question uses only the history included in that request.

### Concurrency

- Two interleaved requests with different histories and users do not share
  messages, auth context, or tool observations.

### RAG and ML

- RAG answers synthesize evidence instead of copying raw chunks.
- ML output is labelled as prediction and can be combined with RAG and live
  listings.
- Missing ML confidence is not invented.

### Security

- Logged-out private requests receive `AUTH_REQUIRED` behavior.
- User A cannot retrieve User B's order by supplying an order ID.
- Prompt injection inside a listing or retrieved document cannot create a new
  tool permission or override the system prompt.

### Limits and Failure

- No request exceeds the total configured tool and iteration budgets.
- A rewrite cannot call additional tools.
- Provider failure returns only the simple fallback.

## 19. Acceptance Criteria

- Zero keyword intent branches in the final `/chat` happy path.
- Zero pseudo-tool-call XML handling or generated action-JSON rescue parsing.
- Zero shared mutable conversation memory across requests.
- Core tools return typed structured envelopes rather than final prose.
- The agent can perform single-tool, multi-tool, repeated-tool, RAG-assisted,
  and ML-assisted answers.
- The agent explains recommendations using evidence and states tradeoffs.
- Private tools rely on backend JWT authorization.
- RAG chunks are not exposed as the answer.
- ML prediction is not bundled with hardcoded explanation and formatted listing
  output.
- Provider fallback is one simple honest message, not a second chatbot.
- Required unit, integration, concurrency, authorization, and agent behavior
  tests pass.

## 20. First Milestone

Deliver one production-shaped vertical slice using test fixtures:

```text
User asks to compare two sellers' listings.
Agent selects get_seller_listings for both sellers.
Tools return structured data.
Agent evaluates the available listings and missing facts.
Agent writes a grounded comparison.
Validator passes the final answer.
```

Then deliver the second vertical slice:

```text
User completes the recommendation assessment.
Agent calls predict_racket_specs.
Agent retrieves knowledge explaining the predicted specifications.
Agent searches current listings.
Agent explains matches, tradeoffs, confidence, and missing evidence.
```
