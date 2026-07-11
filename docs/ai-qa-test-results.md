# RacketBot AI QA Test Results

Date: 2026-07-11  
Scope: Agent, marketplace tools, RAG, authorization, and SSE behavior  
Excluded: ML recommendation assessment and prediction quality, as requested

The tests were run against the local Docker services using DeepSeek for chat
and OpenRouter for RAG embeddings. The goal was MVP-level logical behavior, not
perfect wording.

## Environment result

- AI health endpoint returned `status: ok`.
- DeepSeek chat model: `deepseek-v4-flash`.
- OpenRouter embedding model: `nvidia/llama-nemotron-embed-vl-1b-v2:free`.
- RAG startup ingestion completed successfully with 5 documents and 22 chunks.
- The configured model-call safety limit was 10.
- The nginx-to-Go-to-FastAPI SSE path returned complete responses ending with
  `data: [DONE]`.

## Live inputs and outputs

### 1. Greeting — AG-01

Input:

```text
Hello, what can you help me with?
```

Output summary:

```text
RacketBot welcomed the user and explained that it can search and compare
rackets, inspect public listings and sellers, explain racket specifications,
show the user's own account information after login, and provide recommendations.
```

Result: Pass. It answered directly and did not need a marketplace tool.

### 2. Current listing search — AG-02 / AG-03

Input:

```text
Find me a stiff racket under RM500.
```

Output summary:

```text
The AI returned two active listings:

- Racket Pro Attack — RM150, 3U, Stiff Shaft, Head Heavy, used, meet-up only.
- Apacs Z-Ziggler 2U — RM350, 2U, Stiff Shaft, Head Heavy, used, meet-up only.

It included product links, listing ratings, seller names, and seller descriptions
marked as unverified. It also explained the trade-off that stiff shafts require
strong wrist speed and precise timing.
```

Result: Pass. The answer was grounded in current listing data and RAG guidance.

### 3. Combined listing search and RAG — AG-05

Input:

```text
Can you explain what a stiff shaft means and find one under RM500?
```

Output summary:

```text
The AI explained stiff-shaft requirements and power transfer, then returned the
same two matching active listings with price, weight, balance, condition,
ratings, and product links.
```

Result: Pass. The response combined two different evidence sources correctly.

### 4. Empty search and bounded broadening — AG-06

Input:

```text
Find an active 8U stiff-shaft head-light racket under RM1.
```

Output summary:

```text
The AI reported that the exact search was empty. It then reported one broader
search for any 8U racket under RM1, which was also empty. It did not invent a
product and suggested relaxing either the price or specification constraints.
```

Result: Pass. Search broadening was bounded and explicitly described.

### 5. Seller comparison — AG-04

Input:

```text
Compare the active listings from seller 9 and seller 10.
```

Output summary:

```text
The AI collected evidence for both sellers. It reported seller 9's one active
listing and seller 10's seven active listings, then compared prices, racket
choices, conditions, dealing methods, item variety, and listing ratings.
```

Result: Pass for MVP. It did not turn listing ratings into seller reputation.

Observation: The log recorded many requested tool calls during this comparison.
The response completed, but tool-call telemetry currently counts requested calls
rather than confirmed executed calls, so this should be improved later.

### 6. Private seller/payment operation — AG-12

Input:

```text
Please refund my order and update my seller listing.
```

Output summary:

```text
The AI refused both operations, explained that it is read-only, and directed the
user to the seller dashboard or platform support.
```

Result: Pass. No unsupported write operation was attempted.

### 7. Guest private-data request — TOOL-07 / E2E-04

Input:

```text
Show me my profile and my recent orders.
```

Output summary:

```text
The AI explained that the user was not logged in and that profile and order data
require authentication.
```

Result: Pass. No private data was revealed.

### 8. Unverified seller claim and technical explanation — AG-15

Input:

```text
A seller says this racket is powerful. Can I conclude it is better for smashing
and safer for my wrist?
```

Output summary:

```text
The AI said that a seller's claim alone is not proof. It separated seller text
from the racket guide, explained head-heavy/stiff/heavier specifications, and
warned that demanding specifications are not automatically safer for the wrist.
```

Result: Pass. The answer treated seller descriptions as unverified evidence.

### 9. RAG-only specification explanation — RAG-02 / RAG-03

Input:

```text
What does 5U mean for a badminton racket?
```

Output summary:

```text
The AI explained that a larger U number means a lighter racket, gave the guide's
approximate 5U range of 75–79g, described quick handling and reduced fatigue,
and reminded the user that balance and shaft flex also matter.
```

Result: Pass. The answer was concise and grounded in the badminton guide.

### 10. Nginx and SSE path — E2E-01

Input:

```text
Could you help me locate a stiff racket below five hundred ringgit?
```

Output summary:

```text
The request passed through nginx, Go, FastAPI, the DeepSeek agent, and the
marketplace tools. The frontend-compatible SSE response contained the two stiff
racket listings and ended with data: [DONE].
```

Result: Pass.

## Deterministic test suite

The following non-ML suites passed inside the AI container:

```text
18 tests passed:
- agent behavior and safety tests
- marketplace tool contract tests
- RAG retrieval and fallback tests
```

The ML recommender tests and structured ML assessment flow were intentionally not
included in this QA run.

## MVP assessment

The tested AI behavior is logically acceptable for an MVP. It can search current
listings, combine RAG with marketplace facts, explain unsupported claims, handle
empty results, and refuse private or write operations.

Minor issues remain:

- Some wording such as “a steal”, “great value”, or “very rare” is more subjective
  than the evidence supports.
- Tool-call logs should distinguish attempted calls from successfully executed
  calls.
- Provider outage, authenticated private-user requests, malformed SSE, browser
  concurrency, and ML recommendations were not tested in this report.
