# Product Requirements Document: Stripe Connect Sandbox Checkout

Status: Proposed  
Product: Transcendence Marketplace  
Scope: Minimal Stripe Connect sandbox payment flow  
Currency: MYR  
Last reviewed: 31 July 2026

## 1. Decision and feasibility

This feature is workable in the current repository.

The existing architecture already provides the main foundations:

- `POST /api/v1/orders` is JWT-protected and creates one order per cart item.
- Listing ownership, availability, price, and stock are read from PostgreSQL.
- Listing rows are locked with `SELECT ... FOR UPDATE` before stock is reduced.
- Orders and stock updates already share a database transaction.
- The notification service supports creating notifications in a transaction and
  publishing them after commit.
- The frontend already submits listing IDs, quantities, and a payment method to
  the order endpoint using same-origin routing.
- `/api/` already routes through the WAF and internal Nginx service to the Go
  backend.
- Infisical already exports temporary environment files for Docker Compose.
- Backend tests already use `go-sqlmock`, and cart behavior is covered by
  Vitest.

The implementation must include the following refinements to make the proposed
flow safe and recoverable:

1. A Stripe checkout attempt needs a client-generated UUID,
   `checkoutRequestId`. Reusing it after a lost response must return or recover
   the same payment attempt instead of creating duplicate orders and reserving
   stock twice. It carries no price, seller, account, or fee data.
2. Checkout Session creation must use a persisted Stripe idempotency key.
   Ambiguous network or Stripe `5xx` failures must be retried with the same key;
   they must not immediately release stock because Stripe might have created a
   payable Session.
3. Stock compensation is automatic only after a definitive Session-creation
   failure. An ambiguous attempt remains recoverable through a retry using the
   same `checkoutRequestId`.
4. Session metadata and PaymentIntent metadata must both identify the internal
   payment. `payment_intent.payment_failed` cannot otherwise be mapped reliably.
5. A failed card attempt keeps stock reserved until the Checkout Session is
   successfully paid or expires. Checkout permits the customer to retry a card,
   so the `failed` payment state is non-terminal for this MVP.
6. The Dockerized Stripe CLI must be a Compose profile/service or use the
   Compose-resolved network. It must not assume the bridge is literally named
   `transcendence-network`, because Compose normally prefixes network names.
7. Existing seeded `orders.payment_method` values such as `cash` and `card`
   must remain readable. The new API accepts only `meetup` and `stripe`, but a
   new database constraint must not invalidate legacy rows.

These refinements do not change the intended user experience or add a second
checkout endpoint.

## 2. Product summary

Add a test-mode-only Stripe-hosted Checkout option to the existing marketplace.
A buyer may continue checking out with Meet up / COD, or choose a Stripe
sandbox card payment when every cart item belongs to the one configured Stripe
demo seller.

The platform creates a Stripe Connect destination charge in MYR and retains a
10% application fee. Stripe transfers the remainder to one preconfigured test
connected account. The browser never receives a secret key and never decides
the price, seller, destination account, or fee.

The verified Stripe webhook is the payment authority. Returning to a success
URL does not mark a payment as paid.

## 3. Goals

- Preserve the existing Meet up / COD checkout without behavioral regressions.
- Add one Stripe-hosted, card-only sandbox checkout path.
- Use Stripe Connect destination charges for one prepared demo seller.
- Calculate prices and fees from PostgreSQL using exact MYR minor units.
- Keep order fulfilment state separate from payment state.
- Reserve stock before redirecting to Stripe.
- Release reserved stock exactly once when an unpaid Session expires or a
  Session cannot definitively be created.
- Notify the seller only after Stripe confirms that payment is paid.
- Make checkout creation and webhook processing idempotent.
- Keep secrets in Infisical and backend runtime configuration.
- Provide a reproducible local webhook workflow with a Dockerized Stripe CLI.

## 4. Non-goals

- Live-mode or production payments
- Real-money testing
- Dynamic seller onboarding
- More than one Stripe-enabled seller
- Multi-seller Stripe checkout
- Subscriptions
- Saved cards
- Embedded Checkout, Stripe Elements, or a custom card form
- Refund initiation or dispute management UI
- Partial payment, partial capture, or split tender
- Shipping, tax, discount, or promotion-code calculation
- Marketplace-wide payment-method migration
- Refactoring unrelated order, marketplace, auth, chat, AI, monitoring, admin,
  or WAF code

## 5. Users and user stories

### Buyer

- As a buyer, I can keep using Meet up / COD as I do today.
- As a buyer, I can choose Stripe sandbox card payment for eligible cart items.
- As a buyer, I am redirected to Stripe-hosted Checkout rather than entering
  card details in the marketplace.
- As a buyer, I can distinguish awaiting, failed-attempt, paid, expired, and
  refunded payment states from order fulfilment state.
- As a buyer, returning from Stripe does not falsely tell me that an
  unconfirmed payment succeeded.

### Seller

- As the configured demo seller, I see a Stripe order as ready to fulfil only
  after payment is confirmed.
- As a seller, I cannot complete an unpaid Stripe order.
- As a seller, I receive the existing new-order notification only after the
  paid webhook commits.

### Developer

- As a developer, I can start the complete local demo with one command and no
  persistent webhook signing secret.
- As a developer, the detached Stripe CLI listener and backend automatically
  share the secret generated by that exact listener process.
- As a developer, I can test payment behavior without making live charges.

## 6. User experience

### 6.1 Cart

Keep the current cart layout and add a simple payment-method selector:

- Meet up / COD
- Stripe sandbox card payment

Meet up / COD remains selected by default.

When Stripe is selected, the UI must explain that:

- the flow uses Stripe sandbox/test mode;
- only cards are supported;
- the cart must contain items from the configured demo seller only; and
- no real money is charged.

New user-facing copy must be added to all supported locale files:

- `frontend/src/i18n/messages/en.json`
- `frontend/src/i18n/messages/ms.json`
- `frontend/src/i18n/messages/zh.json`

### 6.2 Stripe redirect

After a successful Stripe order response:

1. Require a non-empty `checkoutUrl`.
2. Clear the cart only after the backend has persisted the Session.
3. Redirect using `window.location.assign(checkoutUrl)`.
4. Do not show “payment successful” before webhook confirmation.

If the request or backend fails, preserve the cart and retain the same
`checkoutRequestId` for a deliberate retry of that checkout attempt.

### 6.3 Return states

Use query parameters on the existing cart page unless small dedicated pages
prove simpler:

- Success: `/cart?checkout=stripe-return`
- Cancel: `/cart?checkout=stripe-cancelled`

The configured success URL may include Stripe's
`{CHECKOUT_SESSION_ID}` placeholder for display/reconciliation, but the browser
must not update payment state.

On a Stripe return:

- show “Payment received; confirmation may take a moment” when the purchases
  API reports `paid`;
- otherwise show “We are confirming your payment”;
- switch to or offer the My Purchases view and reload orders from the backend.

On cancel:

- explain that the payment was not confirmed;
- do not call any endpoint that marks the order paid or releases stock;
- explain that stock remains reserved until the Session expires unless the
  backend has already cancelled the attempt.

## 7. API requirements

### 7.1 Existing checkout endpoint

Continue using:

```http
POST /api/v1/orders
Authorization: Bearer <JWT>
Content-Type: application/json
```

Meetup request:

```json
{
  "items": [
    {
      "listingId": 10,
      "quantity": 2
    }
  ],
  "paymentMethod": "meetup"
}
```

Stripe request:

```json
{
  "items": [
    {
      "listingId": 10,
      "quantity": 2
    }
  ],
  "paymentMethod": "stripe",
  "checkoutRequestId": "8f41ea04-716f-4ca2-9cf2-33fd2da0d72f"
}
```

`checkoutRequestId` is required only for Stripe. The frontend creates one UUID
per checkout attempt and reuses it when retrying after a network or ambiguous
server error.

The API must reject unknown JSON payment methods. An omitted payment method
continues to default to `meetup` for backward compatibility.

The request must never accept:

- item prices or totals;
- seller IDs;
- connected-account IDs;
- currency;
- platform-fee amount or percentage; or
- payment status.

### 7.2 Response

Meetup response remains compatible with the current response:

```json
{
  "orders": [],
  "totalPrice": 100.0
}
```

Stripe response adds `checkoutUrl`:

```json
{
  "orders": [],
  "totalPrice": 100.0,
  "checkoutUrl": "https://checkout.stripe.com/..."
}
```

`checkoutUrl` should use `omitempty` or equivalent behavior for meetup.
Responses must include only existing safe order fields, the trusted total, and
the Checkout URL. They must never include secrets or the connected-account ID.

A retry with the same buyer and `checkoutRequestId` must recover or return the
same payment and Session rather than create new order rows.

### 7.3 Controlled errors

- `400 Bad Request`: malformed request, invalid quantity/listing ID, duplicate
  listing, unsupported payment method, or missing/invalid Stripe request UUID
- `401 Unauthorized`: missing or invalid JWT
- `403 Forbidden`: buyer attempts to buy their own listing
- `404 Not Found`: listing does not exist
- `409 Conflict`: inactive listing, insufficient stock, multi-seller Stripe
  cart, seller not enabled for the demo, or unpaid Stripe order completion
- `503 Service Unavailable`: Stripe configuration missing or an ambiguous
  Stripe attempt requires a safe retry
- `502 Bad Gateway`: definitive Stripe API failure after successful
  compensation

Errors must be safe and actionable without exposing provider payloads or
credentials.

## 8. Checkout behavior

### 8.1 Shared validation

Before creating any order:

- obtain `buyer_id` only from the JWT context;
- require at least one cart item;
- require positive integer listing IDs and quantities;
- reject duplicate listing IDs;
- accept only `meetup` and `stripe`;
- load and lock each listing from PostgreSQL;
- reject own-listing purchases;
- require listing status `active`;
- require sufficient stock; and
- derive seller, title, price, and stock from the locked database row.

### 8.2 Meet up / COD

Preserve current behavior:

- create one pending order per item;
- persist `payment_method = 'meetup'`;
- reduce stock immediately;
- mark a listing sold when stock reaches zero;
- create seller notification rows in the transaction;
- commit once;
- publish notifications after commit; and
- return `201` with orders and trusted total.

Existing legacy rows with `cash`, `card`, or null payment methods remain
readable. The public order-creation API does not accept those legacy values.

### 8.3 Stripe eligibility

For `paymentMethod = 'stripe'`:

- require all locked listings to have one seller;
- load that seller's email from the corresponding `users` row;
- require the trimmed database email to equal `STRIPE_TEST_SELLER_EMAIL`
  using a case-insensitive comparison;
- use only `STRIPE_TEST_CONNECTED_ACCOUNT_ID` as the destination;
- require complete sandbox configuration before reserving stock;
- reject a multi-seller cart before creating any orders; and
- never create or publish seller notifications during initial order creation.

### 8.4 Exact monetary calculation

The Stripe path must not use `float64` to calculate a charge or fee.

For each listing, derive exact minor units from PostgreSQL
`DECIMAL(10,2)`, for example with:

```sql
ROUND(price * 100)::BIGINT
```

Calculate:

```text
line_total_minor = unit_amount_minor * quantity
amount_minor = sum(line_total_minor)
platform_fee_minor = (amount_minor + 5) / 10
```

The fee formula defines 10% with half-up rounding to the nearest sen for
positive integer amounts. Database constraints must ensure:

- `amount_minor > 0`;
- `platform_fee_minor >= 0`; and
- `platform_fee_minor <= amount_minor`.

The existing decimal/JSON order totals may remain for response compatibility,
but Stripe parameters and persisted payment totals must come from the exact
minor-unit path.

### 8.5 Reservation transaction

Within one database transaction:

1. Lock all requested listing rows in stable listing-ID order to reduce
   deadlock risk.
2. Validate the cart and Stripe seller.
3. Insert one payment with status `initializing`, exact amounts, the
   `checkoutRequestId`, and a unique persisted Stripe idempotency key.
4. Insert one pending order per cart item linked to the payment.
5. Reduce stock and update sold/active listing status using existing behavior.
6. Commit without creating seller notifications.

Concurrent requests with the same `checkoutRequestId` must be serialized by a
unique database constraint and return/recover the existing attempt.

### 8.6 Checkout Session creation

After the reservation commits, create one Stripe Checkout Session through a
small injected Stripe client interface.

Required Session parameters:

- test-mode secret key only;
- mode `payment`;
- `payment_method_types = ['card']`;
- currency `myr`;
- server-derived line-item names, unit amounts, and quantities;
- configured success and cancel URLs;
- an explicit expiration between 30 minutes and 24 hours, with 30 minutes
  preferred for the MVP;
- `payment_intent_data.application_fee_amount` equal to the persisted 10% fee;
- `payment_intent_data.transfer_data.destination` equal to the configured
  connected account;
- Session metadata containing at least `payment_id`, `buyer_id`, and
  `seller_id`;
- PaymentIntent metadata containing the same identifiers;
- `client_reference_id` set to the internal payment ID where supported; and
- the persisted idempotency key supplied as Stripe request options.

Internal order IDs may be included as compact diagnostic metadata only when
they fit Stripe metadata limits. Webhook behavior must query linked orders by
`payment_id` and must not depend on a comma-separated order list.

After successful creation, atomically persist:

- Checkout Session ID;
- Checkout URL;
- Session expiration time; and
- payment status `pending`.

Then return the Checkout URL to the buyer.

### 8.7 Session-creation failure policy

Stripe errors must be classified:

- Definitive failures, such as invalid configuration or rejected parameters:
  run the stock-release transaction, cancel linked orders, mark the payment
  `cancelled`, set `stock_released = true`, and return a controlled error.
- Ambiguous failures, such as a connection loss or provider `5xx`: do not
  release stock. Keep the payment `initializing` and return a retryable error.
  A retry with the same `checkoutRequestId` must call Stripe with the same
  idempotency key and recover the original result.

If Stripe returns a Session but persisting it fails, attempt to expire that
Session. Do not release stock unless Session expiration is confirmed or later
confirmed by a verified webhook. Log only safe IDs and error categories for
manual reconciliation.

The stock-release operation must lock the payment row and exit without side
effects when `stock_released` is already true.

## 9. Payment and order state

Order status remains fulfilment state:

```text
pending -> completed
pending -> cancelled
completed -> refunded
```

Payment status is separate:

```text
initializing -> pending
initializing -> cancelled
pending -> paid
pending -> failed
pending -> expired
failed -> paid
failed -> expired
paid -> refunded
```

For this MVP, `failed` means the last card attempt failed; it is not terminal.
Stock remains reserved because the buyer can retry inside the same Checkout
Session. Session expiry moves `pending` or `failed` to `expired`, cancels the
orders, and releases stock.

Meetup orders have no payment row and return a null/omitted payment status,
which the UI treats as not applicable.

## 10. Database requirements

Use a nullable `orders.payment_id` foreign key because it is the smallest clean
association for the repository: multiple order rows can reference one payment,
while meetup and legacy orders remain null.

### 10.1 `payments`

Add an idempotent table containing:

- `id BIGSERIAL PRIMARY KEY`
- `checkout_request_id UUID NOT NULL UNIQUE`
- `stripe_idempotency_key VARCHAR(255) NOT NULL UNIQUE`
- `buyer_id INT NOT NULL REFERENCES users(id)`
- `seller_id INT NOT NULL REFERENCES users(id)`
- `provider VARCHAR(20) NOT NULL`
- `currency CHAR(3) NOT NULL`
- `amount_minor BIGINT NOT NULL`
- `platform_fee_minor BIGINT NOT NULL`
- `status VARCHAR(20) NOT NULL`
- `stripe_checkout_session_id TEXT`
- `stripe_checkout_url TEXT`
- `stripe_payment_intent_id TEXT`
- `session_expires_at TIMESTAMP`
- `stock_released BOOLEAN NOT NULL DEFAULT FALSE`
- `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`

Constraints:

- provider is `stripe` for this MVP;
- currency is `myr`;
- status is one of `initializing`, `pending`, `paid`, `failed`, `cancelled`,
  `expired`, or `refunded`;
- amount and fee constraints described above;
- Checkout Session ID is unique when present; and
- PaymentIntent ID is unique when present.

Indexes:

- `(buyer_id, created_at DESC)`
- `(seller_id, status, created_at DESC)`
- partial unique indexes for non-null Stripe object IDs where appropriate

### 10.2 `orders`

Use:

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id BIGINT;
```

Add the foreign key and index idempotently even when the column already exists:

- `payment_id REFERENCES payments(id) ON DELETE RESTRICT`
- index on `orders(payment_id)`

Do not overload `orders.status` with payment values and do not make
`payment_id` non-null.

### 10.3 `stripe_webhook_events`

Add:

- `stripe_event_id TEXT PRIMARY KEY`
- `event_type TEXT NOT NULL`
- `stripe_object_id TEXT`
- `processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`

The event ID prevents processing a retried Event twice. Payment-row locking,
state checks, and `stock_released` remain necessary because Stripe can produce
distinct Event objects about the same underlying object.

### 10.4 Migration behavior

Schema statements in `db/init.sql` must work for both fresh and existing
PostgreSQL databases:

- use `CREATE TABLE IF NOT EXISTS`;
- use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`;
- add named constraints through guarded `DO $$ ... $$` blocks; and
- use `CREATE INDEX IF NOT EXISTS`.

Add the same payment migration to `backend/db.go` startup migrations so an
existing volume cannot start new payment code against an old schema. Keep
`db/init.sql` as the fresh-database source of truth.

Do not change or duplicate unrelated seed data. Note that the repository's
entire `db/init.sql` currently contains some non-idempotent demo inserts;
payment schema changes must be idempotent even though resolving that broader
seed-data issue is outside this feature.

## 11. Stripe webhook

Register a public route without JWT middleware:

```http
POST /api/v1/webhooks/stripe
```

Register it on the existing public `/api/v1` group. Pass the database and
existing notification service to the focused payment handler; do not place the
logic directly in `main.go`.

### 11.1 Security and transport

- Limit the raw request body to 1 MiB.
- Read the body once without JSON middleware altering it.
- Require the `Stripe-Signature` header.
- Verify the signature with `STRIPE_WEBHOOK_SECRET` using the Stripe SDK.
- Return `400` for an invalid body or signature.
- Return `503` when webhook verification is not configured.
- Never log the secret, signature, full payload, card data, or personal payment
  details.
- Return `2xx` for already-processed events.
- Return non-`2xx` for transient database failures so Stripe retries.
- Ignore unsupported but correctly signed event types with `2xx`.

Every supported event is processed in a database transaction:

1. insert the Stripe event ID as the idempotency guard;
2. lock the mapped payment row;
3. validate provider object IDs, metadata, amount, and currency against the
   database where present;
4. apply an allowed state transition and side effects;
5. commit the event record with the side effects.

Webhook delivery order must not be assumed.

### 11.2 `checkout.session.completed`

- Map the Session through the persisted Session ID and internal payment ID.
- Require `payment_status = 'paid'`.
- Require Session currency and total to equal the persisted payment.
- Lock the payment row.
- If already paid, commit the event and return success without repeating side
  effects.
- Save the PaymentIntent ID.
- Mark the payment `paid`.
- Do not reduce stock again.
- Create one existing `order_new` notification per linked order inside the
  transaction.
- Commit, then publish the created notifications through the existing
  WebSocket publisher.

If the event is completed but not paid, record no paid transition and return a
controlled `2xx`; a later valid payment event may complete it. Never infer paid
state from the return URL.

### 11.3 `checkout.session.expired`

- Map and lock the payment and linked orders.
- Act only when payment status is `initializing`, `pending`, or `failed`.
- Mark the payment `expired`.
- Mark linked pending orders `cancelled`.
- Restore each listing's quantity.
- Change listing status from `sold` to `active` when restored stock is positive.
- Preserve `archived` or other seller-selected states.
- Set `stock_released = true`.
- Do nothing when stock was already released or payment is paid/refunded.

### 11.4 `payment_intent.payment_failed`

- Map through PaymentIntent metadata and verify it against the payment row.
- Save the PaymentIntent ID when safe.
- Move `pending` to `failed`, or leave an existing `failed` state unchanged.
- Keep stock reserved.
- Allow a later paid completion event to move `failed` to `paid`.
- Let `checkout.session.expired` release stock and move `failed` to `expired`.
- Store only a safe provider failure code if a diagnostic field is added; do
  not store or log full card/payment details.

## 12. Existing order and seller behavior

### 12.1 Buyer purchases

Add a backward-compatible `paymentStatus` field to buyer order responses:

- null/omitted for meetup and legacy orders;
- `awaiting_payment` in the API presentation layer for internal
  `initializing` or `pending`;
- `failed`, `paid`, `expired`, or `refunded` otherwise.

Do not rename or remove current JSON fields.

The single-order detail endpoint must apply the same buyer/seller authorization
and include payment status where applicable.

### 12.2 Seller pending orders

Use the smallest UI-compatible behavior: exclude Stripe orders whose linked
payment is not `paid` from the default seller pending-order query.

Meetup and legacy pending orders remain visible. Paid Stripe orders remain
visible and include `paymentStatus = 'paid'`.

### 12.3 Seller completion

Both completion implementations—the notification path and the test/helper path
without notifications—must enforce:

- meetup and legacy orders can be completed under current rules; and
- a Stripe order can move from pending to completed only when its linked
  payment is `paid`.

An unpaid Stripe order returns `409 Conflict`. The ownership check remains
server-side.

## 13. Configuration and secrets

The backend receives these values through Docker Compose:

- `STRIPE_SECRET_KEY`
- `STRIPE_TEST_CONNECTED_ACCOUNT_ID`
- `STRIPE_TEST_SELLER_EMAIL`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL`
- `STRIPE_CANCEL_URL`

The persistent Infisical values are `STRIPE_SECRET_KEY`,
`STRIPE_TEST_CONNECTED_ACCOUNT_ID`, `STRIPE_TEST_SELLER_EMAIL`,
`STRIPE_SUCCESS_URL`, and `STRIPE_CANCEL_URL`. `STRIPE_WEBHOOK_SECRET` is
runtime-only: local setup extracts it from the running Stripe listener and
injects it through the protected temporary Compose environment file.

Rules:

- never commit values;
- never expose any value through a `NEXT_PUBLIC_*` variable;
- require `STRIPE_SECRET_KEY` to begin with `sk_test_`;
- require connected account ID to begin with `acct_`;
- require webhook secret to begin with `whsec_` when supplied;
- require the configured seller email to be a non-empty email-like value;
- require success and cancel URLs to be valid HTTPS URLs for normal use; and
- fail the Stripe checkout path safely when configuration is incomplete while
  leaving meetup checkout available.

Recommended local values:

```text
STRIPE_SUCCESS_URL=https://localhost:8443/cart?checkout=stripe-return&session_id={CHECKOUT_SESSION_ID}
STRIPE_CANCEL_URL=https://localhost:8443/cart?checkout=stripe-cancelled
```

The port must match the developer's configured `WAF_HTTPS_PORT`.

### 13.1 Secret validation and bootstrap

`make setup`, `make up`, and `make restart` are complete local Stripe workflows.
They require the five persistent Stripe values, generate the runtime webhook
secret from the actual persistent listener, inject it into the backend, and
return control with the listener detached.

Add validation modes:

- `REQUIRE_STRIPE=1`: require and validate the five persistent Stripe variables
  for a full demo startup.
- `STRIPE_WEBHOOK_SECRET`: validate it when present, but never require or
  persist it for local Stripe CLI development.

Suggested targets:

- `make check-stripe-secrets`
- `make logs-stripe`

The fresh-machine workflow is exactly:

1. `make setup`
2. `make logs-stripe` when listener output is needed
3. `make down`

## 14. Dockerized Stripe CLI

Add a pinned `stripe/stripe-cli` image as a Compose service under a development
profile, attached to `transcendence-network`. It starts detached before the
backend, forwards only the required events, and restarts unless explicitly
stopped. It must not depend on backend health because setup needs its signing
secret before creating the backend.

Startup must:

1. start PostgreSQL and the actual persistent listener;
2. wait for that listener's readiness log;
3. parse and validate its `whsec_` value without displaying it;
4. replace any exported webhook-secret value only in the mode-600 temporary
   environment file;
5. create or recreate the backend and remaining services from that file;
6. verify that the original listener container is still running; and
7. inspect the backend container configuration and confirm that it received the
   identical value.

The protected temporary environment file and any rewrite file must be removed
on success, failure, or interruption. Authentication failure, early listener
exit, missing readiness, invalid output, backend health failure, listener
replacement, or backend-secret mismatch must fail setup clearly.

Required forwarded events:

- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.payment_failed`

Do not publish backend port `8080` on the host. Local CLI forwarding uses the
internal HTTP route to avoid self-signed TLS issues.

The public route remains:

```text
https://localhost:8443/api/v1/webhooks/stripe
```

Existing Nginx `/api/` routing already covers the endpoint. Do not add a WAF
exclusion unless a reproducible CRS false positive identifies a specific rule;
any exclusion must be route- and rule-specific.

## 15. Implementation boundaries

Prefer focused backend files:

- `backend/stripe_payments.go`
- `backend/stripe_webhooks.go`
- `backend/stripe_payments_test.go`
- `backend/stripe_webhooks_test.go`

Use a small Stripe interface supporting the operations required for tests, such
as:

- create Checkout Session with request options/idempotency key;
- retrieve/recover a Checkout Session if needed; and
- expire a Checkout Session for compensation/reconciliation.

Keep route wiring and dependency construction small in `backend/main.go`.
Update the current order queries rather than creating a parallel order system.

Pin a compatible official Stripe Go SDK in `backend/go.mod` and
`backend/go.sum`. Unit tests must use a fake client and make no network calls.

## 16. Test requirements

### 16.1 Backend unit tests

Follow the existing `go-sqlmock` conventions and cover:

- unsupported payment method;
- omitted payment method still defaults to meetup;
- existing meetup stock, order, response, and notification behavior;
- missing or invalid Stripe checkout request UUID;
- repeat checkout request does not duplicate orders or stock reservation;
- multi-seller Stripe cart rejected;
- matching seller email with any positive database seller ID;
- case-insensitive seller email matching;
- seller email mismatch against `STRIPE_TEST_SELLER_EMAIL`;
- missing or invalid Stripe configuration;
- listing amount loaded from PostgreSQL;
- exact integer MYR conversion;
- quantity multiplication in minor units;
- 10% half-up application-fee calculation;
- Session parameters, destination, metadata, URLs, and card-only mode;
- successful Session persistence and response;
- definitive Stripe failure cancels orders and releases stock once;
- ambiguous Stripe failure retains reservation and supports safe retry;
- failure after Session creation attempts safe Session expiration;
- invalid webhook signature;
- oversized webhook body;
- valid paid completion;
- completion without paid Session status;
- amount, currency, Session ID, or metadata mismatch;
- duplicate completed event;
- paid notification created after webhook and not during checkout;
- valid expiry releases stock once;
- duplicate expiry does not release stock twice;
- failed PaymentIntent retains stock;
- failed then paid state transition;
- failed then expired state transition;
- unpaid Stripe order cannot be completed;
- paid Stripe order can be completed;
- meetup order can still be completed; and
- unpaid Stripe order is excluded from the seller pending list.

### 16.2 Frontend tests

Extend `frontend/src/__tests__/pages/CartPage.test.tsx` while preserving current
meetup tests:

- meetup remains the default;
- selecting Stripe sends `paymentMethod = 'stripe'`;
- Stripe request includes IDs, quantities, and `checkoutRequestId` only;
- request excludes prices, total, seller ID, connected account, currency, and
  fee;
- successful Stripe response clears the cart and redirects;
- missing `checkoutUrl` is an error and preserves the cart;
- backend failure preserves the cart;
- network failure preserves the cart and retry UUID;
- success query state reloads purchases but never marks an order paid;
- cancel query state never marks an order paid;
- payment-status labels render correctly; and
- new localized copy exists in English, Malay, and Chinese.

Mock `window.location.assign` in a JSDOM-compatible way.

### 16.3 Schema and runtime tests

Extend the CI schema assertions to verify:

- `payments`;
- `orders.payment_id` and its foreign key/index;
- `stripe_webhook_events`;
- unique Stripe IDs and checkout request IDs;
- amount, fee, provider, currency, and status constraints; and
- migration success against a fresh pgvector PostgreSQL database.

Provider-dependent tests remain mocked. CI must not call Stripe.

## 17. Validation

Run and report the exact result of:

```bash
cd backend
test -z "$(gofmt -l .)"
go mod verify
go vet ./...
go test -race ./...
go build -mod=readonly ./...
```

```bash
cd frontend
npm test
npm run build
```

```bash
docker compose config --quiet
sh -n scripts/with-infisical-env.sh
sh -n scripts/infisical-export.sh
sh -n scripts/check-secrets.sh
```

Run `shellcheck` on changed shell scripts when it is installed.

After starting the stack:

```bash
make ps
make health-check
make test-waf
```

Do not claim a check passed if it was skipped or failed.

## 18. Manual sandbox acceptance

Prerequisites:

- a Stripe test-mode platform;
- one prepared connected account that can receive the configured destination
  charge;
- the platform and account arrangement supports MYR destination charges;
- a marketplace user and active listings whose email matches
  `STRIPE_TEST_SELLER_EMAIL`; and
- all required Infisical values configured.

Test card:

```text
4242 4242 4242 4242
Any future expiry
Any three-digit CVC
```

Acceptance scenarios:

1. Meetup checkout still creates orders, reduces stock, and immediately
   notifies the seller.
2. A multi-seller Stripe cart is rejected without orders or stock changes.
3. A cart belonging to a non-configured seller is rejected.
4. An eligible Stripe cart reserves stock and redirects to hosted Checkout.
5. Before payment, the seller sees no fulfilment-ready order or notification.
6. Completing the test payment marks the payment paid through the webhook.
7. The seller then sees the pending fulfilment order and notification.
8. Stripe Dashboard shows the MYR destination charge, 10% application fee, and
   transfer to the configured connected account.
9. PostgreSQL shows one payment linked to all checkout order rows.
10. Resending the completed event creates no duplicate notification or state
    change.
11. An expired Session cancels linked orders and restores stock once.
12. Resending the expired event does not restore stock again.
13. A failed card attempt displays failed/awaiting retry, retains stock, and can
    later become paid or expired.
14. The seller cannot complete an unpaid Stripe order but can complete a paid
    one.

## 19. Documentation deliverables

Update developer documentation with:

- all required and optional Infisical variables;
- how to find the configured marketplace seller's email;
- how `make setup` validates and starts persistent webhook forwarding;
- how the generated listener secret reaches the backend without being printed
  or persisted;
- how to inspect the listener with `make logs-stripe`;
- sandbox test-card details;
- how to inspect the payment, fee, and transfer in Stripe;
- how to inspect payment/order state in PostgreSQL;
- stock behavior after cancellation, failed card attempts, and expiry; and
- the limitations listed in this PRD.

Never place actual credentials, account IDs, webhook secrets, or user-specific
secret values in tracked documentation.

## 20. Definition of done

The feature is complete when:

- all functional and security requirements above are implemented;
- meetup behavior remains covered and passing;
- Stripe checkout is server-priced, same-seller, and demo-seller-only;
- Session creation and webhook handling are idempotent;
- exact MYR minor units and fee rounding are tested;
- no seller notification occurs before paid confirmation;
- stock is released exactly once on definitive cancellation or expiry;
- unpaid Stripe orders cannot be fulfilled;
- normal startup generates the webhook secret without a manual bootstrap;
- all required automated validation passes;
- the complete manual sandbox flow passes; and
- documentation contains the reproducible developer workflow and known
  limitations.

## 21. Known MVP limitations

- Only one configured seller can receive Stripe payments.
- Stripe carts cannot contain more than one seller.
- Only MYR card payments in Stripe test mode are supported.
- Stock is reserved while Checkout is open, including after a declined card,
  until payment succeeds or the Session expires.
- The marketplace does not initiate refunds. If a test refund is performed in
  Stripe, refund synchronization requires a future webhook extension unless
  added explicitly to this scope.
- Stripe fees are paid by the platform under destination-charge behavior; the
  10% application fee is not guaranteed to exceed Stripe processing fees.
- Cross-region Connect setups might require
  `payment_intent_data.on_behalf_of`; the prepared platform and connected
  account must be verified before the demo.
- The local HTTPS return URL uses a self-signed certificate and requires the
  browser's local trust exception.
- Truly abandoned `initializing` attempts need operational reconciliation if
  the buyer never retries and Stripe never created a Session. A future cleanup
  worker can automate this; the MVP must at least expose safe IDs in logs and
  preserve stock rather than risk a paid order with released inventory.

## 22. Reference behavior

- Stripe destination charges and application fees:
  <https://docs.stripe.com/connect/destination-charges>
- Checkout Session creation and expiration:
  <https://docs.stripe.com/api/checkout/sessions/create>
- Stripe idempotent requests:
  <https://docs.stripe.com/api/idempotent_requests>
- Webhook signatures, retries, duplicate events, and event ordering:
  <https://docs.stripe.com/webhooks>
- Stripe CLI local forwarding:
  <https://docs.stripe.com/stripe-cli/use-cli>
