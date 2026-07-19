# PRD: RacketBot AI Tool-Calling Improvement

## Problem

RacketBot can answer public FAQ/RAG questions such as "How do I contact a seller?"
but does not reliably choose protected account/order tools for questions such as
"what is my username?" or "can you show me my order?".

The preferred product behavior is AI-driven tool selection, not deterministic
keyword routing.

## Goals

- Improve the agent's ability to choose existing tools by strengthening system
  instructions and tool descriptions.
- Keep public FAQ, recommendation, and listing search behavior working without
  login.
- Use protected tools for private user/profile/order data only when the user is
  logged in and the backend auth context is available.
- Add one public seller-listing tool so the AI can answer "what else is this
  seller selling?" style questions.

## Non-Goals

- Do not add deterministic keyword routing for private profile/order prompts.
- Do not add `get_listing_images`.
- Do not add seller-dashboard tools yet.
- Do not allow the bot to modify users, listings, orders, payments, passwords,
  or prices.
- Do not expose private user or order data without backend authorization.

## Desired Behavior

Logged out:

- "what is my username?" should lead the AI to use the profile tool, which tells
  the user they must log in.
- "show my orders" should lead the AI to use the orders tool, which tells the
  user they must log in.
- "show Howard order" must not reveal private order data.

Logged in:

- "what is my username?" should lead the AI to call `get_user_profile`.
- "show my profile" should lead the AI to call `get_user_profile`.
- "can you show me my order?" should lead the AI to call `get_my_orders`.
- "show order 3" should lead the AI to call `get_order_status`.

Public marketplace:

- "How do I contact a seller?" should continue using FAQ/RAG.
- "What else is seller 2 selling?" should use `get_seller_listings`.

## Tooling Changes

- Strengthen the system prompt in `agent.py` to explain when profile/order tools
  must be used.
- Expand docstrings for `get_user_profile`, `get_my_orders`, and
  `get_order_status` with natural-language examples.
- Add `get_seller_listings(seller_id, limit)` using the existing public products
  API.
- Register `get_seller_listings` in the agent tool list and tool resolver.

## Success Criteria

- The AI model has enough tool descriptions and system instruction context to
  select protected tools without hardcoded private-intent routing.
- Guest requests for private data receive a login-required response.
- Logged-in requests for own profile/orders use the real JWT-backed tool path.
- Public FAQ/listing search behavior does not regress.
