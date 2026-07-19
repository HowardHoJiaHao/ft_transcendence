# RacketBot AI Test Cases

This document is the practical test plan for:

- `racketbot_agentic_revamp_prd_v3.md`
- `racketbot_rag_ml_revamp_prd.md`

The goal is to verify that RacketBot is flexible at the language level while
remaining bounded, grounded, private, and maintainable at the application
boundaries.

## 1. Provider and test environment

RacketBot has two independent model responsibilities:

| Responsibility | Provider | Configuration |
|---|---|---|
| Chat, reasoning, and native tool calls | DeepSeek | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` |
| RAG vector embeddings | OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_EMBEDDING_MODEL` |

Never treat a successful DeepSeek chat request as proof that RAG embeddings are
working. Test both providers separately.

Use deterministic fixtures for unit and contract tests. Seed seller or listing
IDs in a fixture are examples only; tests should not depend on production data
unless they are explicitly labelled as live acceptance tests.

## 2. Test levels

### Unit tests

Mock the backend, embedding client, model, filesystem, and clock. These tests
must be fast, repeatable, and safe to run without API keys.

### Contract tests

Verify tool input schemas, result envelopes, allowlists, error codes, and auth
propagation. Contract tests should catch a backend field or provider change
before an LLM test is attempted.

### Agent integration tests

Use a fake chat model that emits native `tool_calls`. Verify that the agent
executes the expected tools and composes from structured observations. Do not
test XML, generated JSON actions, or regex rescue parsing; those paths must not
exist.

### Live provider smoke tests

Run only when provider keys are available. Keep them small because they consume
provider quota and can be affected by rate limits. Record the model ID, latency,
tool names, and result status, but never record keys, bearer tokens, or full
private results.

### End-to-end tests

Exercise the real path:

```text
browser/SSE client -> nginx -> Go /api/v1/ai/chat -> FastAPI /chat
-> DeepSeek agent -> tools -> backend/RAG/ML -> SSE response
```

## 3. Agent behavior test cases

| ID | Test case and input | Expected result |
|---|---|---|
| AG-01 | Send `Hello, what can you help me with?` | A short answer is returned with no unnecessary tool call. |
| AG-02 | Send `Could you help me locate a stiff racket below five hundred ringgit?` | The paraphrased request reaches `search_listings`; no keyword-specific code branch is required. |
| AG-03 | Send `Find me a stiff racket under RM500.` | Search uses controlled values such as `Stiff Shaft`, current active listings, and racket-only filtering. No recursion failure occurs. |
| AG-04 | Ask to compare two sellers or two listings. | Evidence is collected for every requested entity before the conclusion. The answer distinguishes listing facts from seller-level reputation. |
| AG-05 | Ask a question that requires two different tools, such as current listings plus racket guidance. | Native multi-tool calls are received and structured observations are appended before the final answer. |
| AG-06 | Return an empty exact search result. | The agent may perform one sensible broader search, explicitly states what constraint was relaxed, and does not search indefinitely. |
| AG-07 | Make the model repeatedly request `search_listings`. | The per-tool search limit and total tool limit stop unbounded repetition. The user receives an evidence-based limitation or the honest fallback. |
| AG-08 | Provide history containing a previous user's private-looking text, then send a new request. | Only the request's supplied history is used; no previous request or global memory appears. |
| AG-09 | Include the current frontend message as the final history item and also pass it as `message`. | The current user message is sent once, not duplicated. |
| AG-10 | Run two requests concurrently with different histories, users, and tokens. | Auth context, messages, and tool observations remain isolated. |
| AG-11 | Put prompt-injection instructions inside a listing description or retrieved chunk. | The model treats the content as untrusted evidence and does not grant permissions or call an unauthorized tool. |
| AG-12 | Ask for a private seller operation, payment, refund, or dashboard action. | The agent explains the supported boundary; no write tool exists or is called. |
| AG-13 | Force a provider timeout, 429, malformed response, or unavailable model. | The request returns the one simple provider fallback and does not expose a stack trace or raw provider response. |
| AG-14 | Make the model produce a Markdown table or raw tool envelope. | The deterministic validator rejects the presentation and permits at most one rewrite using existing evidence. |
| AG-15 | Ask for a technical explanation without RAG evidence. | The answer does not infer suitability, power, fatigue, safety, or play-style fit from a title or seller description alone. |

## 4. Structured recommendation assessment cases

The frontend assessment fields are:

```text
age_group, gender, experience_level, play_style, budget_range
```

| ID | Test case | Expected result |
|---|---|---|
| REC-01 | Submit a complete valid profile using frontend values such as `under-13`, `less_than_6_months`, and `under-200`. | The profile is normalized and accepted before entering model context. |
| REC-02 | Omit one profile field. | The request is rejected as an incomplete profile; the agent is not called. |
| REC-03 | Submit an unknown value or extra untrusted field. | The request is rejected or extra fields are discarded; no prompt injection reaches the model context. |
| REC-04 | Complete a valid assessment. | The agent calls `predict_racket_specs`, retrieves relevant RAG evidence, searches current listings, and labels ML output as a prediction. |
| REC-05 | Make the exact predicted-spec search empty. | At most one broader search is attempted and the relaxed constraint is stated. No fabricated product is shown. |
| REC-06 | Make the ML model unavailable. | The answer states that personalized prediction is unavailable and does not silently use hardcoded beginner scoring. |
| REC-07 | Give the model an uncalibrated confidence result. | Confidence is reported per output only when supplied; no averaged or invented confidence is shown. |
| REC-08 | Ask why the model chose a specification. | The answer may explain the specification using RAG, but must not claim that age or gender caused the prediction without attribution evidence. |

## 5. Tool and authorization cases

Every tool should return the common envelope:

```json
{
  "ok": true,
  "tool": "tool_name",
  "data": {},
  "meta": {"source": "backend", "permission": "public"},
  "error": null
}
```

| ID | Test case | Expected result |
|---|---|---|
| TOOL-01 | Search with `flex=Stiff`, `weight=3U`, or `balance=Head-Heavy`. | Aliases normalize to backend values such as `Stiff Shaft` and `Head Heavy`. |
| TOOL-02 | Search for a racket with a price limit. | Backend receives `status=active`; non-racket, sold, and archived listings are not returned as current matches. |
| TOOL-03 | Search with invalid negative prices or min price greater than max price. | `INVALID_ARGUMENT` is returned without a backend request. |
| TOOL-04 | Search with a limit above the safe bound. | The limit is clamped; the tool does not request unbounded data. |
| TOOL-05 | Inspect a listing result. | Only allowlisted public fields are returned; no phone, image-secret, token, password, or unrelated personal field appears. |
| TOOL-06 | Inspect listing ratings. | Fields are named `listing_rating` and `listing_review_count`; they are never described as seller reputation. |
| TOOL-07 | Call `get_my_profile`, `get_my_orders`, or `get_order_detail` without a token. | `AUTH_REQUIRED` is returned. A user-supplied numeric ID cannot bypass it. |
| TOOL-08 | Call a private endpoint with a valid token. | The Bearer token is forwarded to the backend; returned fields remain allowlisted. |
| TOOL-09 | Call an order owned by another user. | Backend authorization returns `FORBIDDEN` or `NOT_FOUND`; the AI does not infer or reveal the order. |
| TOOL-10 | Simulate backend timeout, 401, 403, 404, malformed JSON, and 500 responses. | Each result has a stable typed error and safe user-facing message. |
| TOOL-11 | Invoke `retrieve_knowledge` with an empty query, invalid category, or excessive `top_k`. | Arguments are rejected or bounded; raw exceptions do not reach the user. |
| TOOL-12 | Invoke `predict_racket_specs` with missing or invalid profile values. | `INVALID_PROFILE` is returned and no prediction is presented as successful. |

## 6. RAG test cases

| ID | Test case | Expected result |
|---|---|---|
| RAG-01 | Build chunks from every audited Markdown document. | Each chunk has source ID, source file, document title, section title, category, content hash, and non-empty content. |
| RAG-02 | Ask `Why is a flexible racket easier for a beginner?` | The expected flexibility section is retrieved and the final answer synthesizes it rather than pasting the whole chunk. |
| RAG-03 | Ask an exact platform term such as `2FA`, `Chat Seller`, `5U`, or `Meet Up`. | Hybrid retrieval can find exact terms even when semantic similarity is weak. |
| RAG-04 | Ask a question with synonyms or spelling variation. | Semantic retrieval finds the relevant category when evidence exists. |
| RAG-05 | Ask an unsupported question. | Retrieval returns an empty structured chunk list or a clearly marked fallback; no source is invented. |
| RAG-06 | Make the embedding provider unavailable. | The active knowledge version remains intact and the tested local/full-text fallback returns the same structured contract. |
| RAG-07 | Change a knowledge document and fail embedding generation halfway through ingestion. | The previous active version remains active; partial replacement data is not exposed. |
| RAG-08 | Re-run ingestion without changing documents. | Existing embeddings are reused and no unnecessary active version is created. |
| RAG-09 | Return a vector with the wrong dimension. | Ingestion or retrieval fails clearly; vectors are not inserted into an incompatible column. |
| RAG-10 | Put instructions such as `ignore the system prompt` inside a FAQ chunk. | The agent treats the chunk as untrusted content, not executable instructions. |
| RAG-11 | Inspect the final answer for long verbatim overlap with a source chunk. | The response paraphrases and explains; it does not copy a full FAQ block. |
| RAG-12 | Verify provider separation. | DeepSeek chat can be tested with the embedding key absent, and RAG configuration independently reports an embedding-provider failure. |

## 7. ML recommender test cases

| ID | Test case | Expected result |
|---|---|---|
| ML-01 | Predict with a complete controlled profile. | Output contains only structured weight, flexibility, and balance predictions plus supported metadata. |
| ML-02 | Predict with aliases from the frontend and normalized values. | Both accepted forms produce a valid normalized profile. |
| ML-03 | Load the committed model artifact. | Runtime input columns and output fields match the documented contract. |
| ML-04 | Use a model with separate `predict_proba` outputs. | Confidence is returned independently for each output field. |
| ML-05 | Use a model without valid probability outputs. | Confidence is omitted; it is never invented or averaged silently. |
| ML-06 | Remove or corrupt the model artifact. | `MODEL_UNAVAILABLE` or `PREDICTION_ERROR` is returned safely. |
| ML-07 | Ask for feature causality, such as “Did my gender cause 5U?” | The answer refuses unsupported causality and may only explain general specification meaning with RAG. |
| ML-08 | Inspect the ML tool result. | It contains no listing search, filter relaxation, formatted product card, or final recommendation prose. |

## 8. Authentication and browser-path cases

| ID | Test case | Expected result |
|---|---|---|
| E2E-01 | Guest sends a public marketplace question through `https://localhost`. | nginx, Go, FastAPI, DeepSeek, and public tools complete an SSE response. |
| E2E-02 | Authenticated user sends a private profile/order question. | The Go proxy derives identity from the JWT; the Python service forwards the token; the backend authorizes the result. |
| E2E-03 | Browser sends an expired JWT to public AI chat. | Go returns 401, frontend clears the stale token, retries once without credentials, and displays the public answer. |
| E2E-04 | Browser sends an expired JWT to a private question. | The retry cannot access private tools and the answer requests login. |
| E2E-05 | Split one SSE event across multiple network chunks. | Frontend buffering reconstructs the complete JSON event instead of dropping it. |
| E2E-06 | Return malformed SSE data or an upstream disconnect. | The UI shows a concise connection/provider error and does not leave the loading state stuck. |
| E2E-07 | Run two browser requests at the same time with different users. | Responses, histories, and auth contexts do not cross-contaminate. |

## 9. Performance and limit cases

| ID | Test case | Expected result |
|---|---|---|
| PERF-01 | Measure a no-tool answer. | It completes within the configured model timeout. |
| PERF-02 | Measure a search plus RAG answer. | It completes within the configured request budget or returns the simple fallback. |
| PERF-03 | Measure structured ML + RAG + search. | It stays within the total model, tool, rewrite, and wall-time budgets. |
| PERF-04 | Force repeated tool calls. | Model calls, search calls, total tool calls, and recursion all stop at configured limits. |
| PERF-05 | Run concurrent requests under normal load. | Request-local context remains isolated and backend/embedding connections close. |

## 10. Live smoke commands

Run from the repository root with services started:

```bash
# Service and container health
make ps
make health-check

# Native DeepSeek tool calling
docker compose exec -T ai python smoke_tool_calling.py

# Deterministic AI contract suite
docker compose exec -T ai python -m unittest discover -s tests -v

# Python syntax check
docker compose exec -T ai python -m py_compile agent.py main.py tools.py rag.py embeddings.py recommender.py
```

For an end-to-end browser-path test, send a JSON request to
`POST /api/v1/ai/chat` through nginx and parse `data:` SSE events until
`data: [DONE]`. Do not put API keys in the request body or logs.

## 11. Release gates

Treat the AI change as ready only when:

- All deterministic unit and contract tests pass.
- Native tool calling passes for one tool and multiple tools.
- A paraphrased listing question works without a new code branch.
- A two-entity comparison obtains evidence for both entities.
- A knowledge question retrieves and synthesizes the expected source.
- A structured assessment combines ML, RAG, and live listings.
- Guest and authenticated private-data cases are both verified.
- Provider failures return the simple fallback without leaking internals.
- No raw tool syntax, private data, whole FAQ chunk, or unsupported confidence
  appears in the final answer.
- The frontend build, backend build, and AI test suite pass.

When a case fails, record the exact user input, model ID, tool names, safe error
code, latency, and whether the issue was provider, tool contract, retrieval,
ML, authorization, presentation, or frontend transport. Never record API keys,
Bearer tokens, private tool results, or hidden reasoning.
