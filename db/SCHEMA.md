# Database Schema Reference

PostgreSQL 15 + pgvector. Source of truth is the live schema (`\d` on each
table) plus what actually reads/writes each column in the Go backend and
Python AI service — not just what `db/init.sql` declares. Where a
table/column is unused by any code, it's marked **(unused)**.

The `otps` table is not in `db/init.sql` — it's created by GORM's
`AutoMigrate` in `backend/modules/user`.

---

## users

Account records for every person on the platform.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Primary key, referenced by nearly every other table |
| `username` | varchar(255) unique | Login identity / display name |
| `email` | varchar(255) unique | Login identity, contact |
| `password_hash` | varchar(255) | bcrypt hash, checked at login — never the raw password |
| `first_name`, `last_name` | varchar(50) | Display name |
| `phone_no` | varchar(30) | Contact number, edited via `/profile/change-phoneNo` |
| `address` | varchar(255) | Delivery address, one per account, edited on the profile page. Reaches only its owner (`GET /api/v1/me`) and the seller of an order that buyer placed (`GET /api/v1/seller/orders`, scoped to `o.seller_id = <caller>`) |
| `date_of_birth` | date | Profile field |
| `gender` | varchar(10) | Profile field, CHECK constrained to `Male`/`Female` |
| `avatar_url` | varchar(255) | Link-based avatar (e.g. external URL) |
| `avatar_data` | bytea | Alternative: raw avatar image bytes stored in-row |
| `avatar_mime_type` | varchar(50) | Required if `avatar_data` is set |
| `bio` | text | Free-text profile blurb |
| `is_verified` | boolean | Set true after email/OTP verification |
| `requires_2fa` | boolean | Gates the OTP step in `Login()` — see `backend/modules/user/auth/handler.go` |
| `oauth_id`, `oauth_provider` | varchar | Google OAuth identity. Unique together via the partial index `idx_users_oauth_identity` (only when both are non-NULL), so a Google account maps to exactly one user |
| `created_at`, `updated_at` | timestamp | Audit timestamps |

---

## listings

The product catalog — one row per item a seller has posted. Despite the
table name, this **is** "products" (see `docs/prd-seller-analytics-dashboard.md`
§ for the listings-vs-orders distinction). Each listing is a single
secondhand item, sold at most once.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Product ID, used in `/products/:id` URLs |
| `seller_id` | int FK → users | Who's selling it; cascades delete with the seller |
| `title`, `description` | varchar/text | The ad copy |
| `weight_category`, `flexibility_category`, `balance_category` | varchar(100) | Badminton-racket spec fields (e.g. "3U", "Stiff Shaft", "Head Heavy") — used as filter facets on browse |
| `category` | varchar(100), default `'Others'` | Broad category (Rackets/Footwear/Apparel/etc.) — drives the Analytics dashboard's category breakdown |
| `condition` | varchar(50), default `'Second-hand (Used)'` | Item condition |
| `dealing_method` | varchar(100), default `'Meet Up'` | How buyer/seller exchange the item |
| `phone_number` | varchar(20) | Contact number specific to this listing (separate from the seller's account phone) |
| `price` | numeric(10,2) | Current asking price |
| `original_price` | numeric(10,2) | Shown crossed-out for "was RM X" discount display |
| `currency` | varchar(10), default `'RM'` | Not used for actual multi-currency logic anywhere |
| `location` | varchar(100) | Where the item is |
| `image` | varchar(255) | Primary/cover image path |
| `seller_name` | varchar(255) | Denormalized copy of the seller's name |
| `rating`, `reviews` | numeric/int | Cached average rating + count shown on the card — **not** computed from the `reviews` table; static/seed values |
| `is_new` | boolean | "Brand new" badge |
| `is_featured` | boolean | Promotes to featured/homepage sections |
| `stock_quantity` | int NOT NULL, default 1, CHECK `>= 0` | Units available — the lot size. **Both** checkout paths require the buyer to take the whole lot (`item.Quantity != stockQuantity` → 409 "This listing must be bought in full") and zero it; a seller wanting to sell smaller amounts splits the lot into separate listings. Added to existing volumes by a `backend/db.go` migration, so it is not in every old dump |
| `status` | varchar(20), default `'active'` | `active` / `pending` / `sold` / `archived` — all four are real stored values (CHECK `listings_status_allowed`; existing volumes get the fourth value via the migration at `backend/db.go` that drops the old three-value `listings_status_check`). Drives My Shop tabs and the seller dashboard funnel. `pending` is written at checkout — the item is reserved but not yet handed over — and becomes `sold` only when the seller confirms. **Also computed at display time:** `getSellerDashboardItems` in `backend/seller_dashboard.go` still overrides the stored value with `pending` for any non-archived listing that has an order in `orders.status='pending'`, so a listing that sold part of its stock and still owes a handover surfaces as needing action |
| `views_count` | int, default 0 | Page-view counter, incremented by `recordListingView()` in `backend/products.go` on each `GET /products/:id` (skipped if the viewer is the seller) |
| `created_at`, `updated_at` | timestamp | Audit timestamps; `created_at` is also "date posted" and the anchor for days-listed/time-to-sell calculations |

---

## listing_images

Meant to hold multiple photos per listing. **Effectively unused** —
`uploadListingImages()` in `backend/products.go` writes files straight to
`static/listings/{listingId}_{index}.ext` on disk and only updates
`listings.image`; it never inserts a row here.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Row ID |
| `listing_id` | int FK → listings | Which listing this image belongs to |
| `image_url` | varchar(255) | Path/URL to the image |
| `image_data` | bytea | Alternative: raw bytes stored in-row |
| `mime_type` | varchar(50) | Required if `image_data` is set (CHECK constraint) |
| `is_primary` | boolean | Marks the cover image among several |
| `uploaded_at` | timestamp | Audit timestamp |

---

## orders

Purchase records — **one row per listing bought**, not one row per checkout.
See "One checkout creates many order rows" below before assuming an order can
span several listings.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Order ID. Unique per *line*, so a 3-item cart produces 3 different ids |
| `buyer_id` | int FK → users, CASCADE | Who bought it |
| `seller_id` | int FK → users, CASCADE | Who sold it (denormalized copy of the listing's seller, so dashboard queries don't have to join `listings`) |
| `listing_id` | int FK → listings, **RESTRICT** | What was bought — exactly one listing per row. RESTRICT, not CASCADE: an order is financial history for both parties, so deleting a listing must not erase a buyer's purchase record or the revenue the seller dashboard reports |
| `quantity` | int, default 1 | Units in this order, taken out of `listings.stock_quantity` at checkout |
| `total_price` | numeric(10,2) | Amount charged for this line (unit price × quantity) |
| `status` | varchar(20), default `'pending'` | `pending` / `completed` / `cancelled` / `refunded`. `pending` = created at checkout, awaiting the seller marking it complete (`PUT /orders/:id/complete`); only `completed` counts as real revenue on the seller dashboard, and only `pending` counts toward the dashboard's "Pending Orders" tile |
| `payment_method` | varchar(50) | `"meetup"` (the default when the request omits it) or `"stripe"`; `createOrders` rejects anything else |
| `payment_id` | bigint FK → payments, RESTRICT | Set only on the Stripe path. **This is the grouping key** — every line of one Stripe checkout shares it. NULL for meetup orders. Added by a `backend/db.go` migration, not present in `db/init.sql`; indexed by `idx_orders_payment_id` |
| `created_at`, `updated_at` | timestamp | `created_at` anchors the monthly revenue chart and time-to-sell calc |

### One checkout creates many order rows

`POST /api/v1/orders` takes an `items` array, and the insert sits **inside a
loop over that array** (`backend/orders.go`). One listing per row, one row per
item, each with its own `id`. There is no `order_items` table and no
"parent order" row.

A cart of three listings from buyer 42, paid by meetup:

| id | buyer_id | seller_id | listing_id | quantity | total_price | status | payment_method | payment_id |
|---|---|---|---|---|---|---|---|---|
| 1001 | 42 | 7 | 10 | 1 | 50.00 | pending | meetup | NULL |
| 1002 | 42 | 7 | 17 | 1 | 120.00 | pending | meetup | NULL |
| 1003 | 42 | 9 | 23 | 1 | 80.00 | pending | meetup | NULL |

Three ids, not one. Note `seller_id` differs on the last row — a meetup cart
may mix sellers, and each seller only ever sees their own line.

The same cart paid by Stripe, which requires a single seller ("Stripe checkout
supports items from one seller only", 409), so listing 23 has to be a separate
checkout:

| id | buyer_id | seller_id | listing_id | quantity | total_price | status | payment_method | payment_id |
|---|---|---|---|---|---|---|---|---|
| 1004 | 42 | 7 | 10 | 1 | 50.00 | pending | stripe | 900 |
| 1005 | 42 | 7 | 17 | 1 | 120.00 | pending | stripe | 900 |

Still two ids — but both carry `payment_id = 900`, so `WHERE payment_id = 900`
reconstructs the basket. Meetup orders have no such key; the only thing tying
1001–1003 together is the same `buyer_id` and a `created_at` from the same
transaction.

Consequences worth remembering:

- **Completion is per line.** `PUT /orders/1001/complete` flips only 1001;
  1002 stays `pending`. A buyer can end up with one line completed, one
  cancelled, and one still pending out of a single checkout.
- **The same `listing_id` cannot appear twice in one checkout** — `createOrders`
  rejects a duplicate with 400 "duplicate listingId in checkout". Repeat units
  go in `quantity`, not in a second item.
- Revenue sums add up lines, never orders: `SUM(total_price) WHERE status='completed'`.

### Checkout flow

`POST /api/v1/orders` (`createOrders`) validates the items, then branches on
`payment_method`:

- **meetup** — opens one transaction, and per item locks the listing
  (`SELECT ... FOR UPDATE`), rejects self-purchase (403) and non-`active`
  listings (409), requires the buyer to take the **entire stock** (409 "This
  listing must be bought in full"), inserts the order as `pending`, then sets
  the listing to `stock_quantity = 0, status = 'pending'` — reserved, *not*
  sold.
- **stripe** — delegates to `stripePayments.CreateCheckout`
  (`backend/stripe_payments.go`), which inserts a `payments` row first, then
  one order per item carrying that `payment_id`. It enforces the same whole-lot
  rule and leaves the listing at `stock_quantity = 0, status = 'pending'`, so
  both paths reach an identical listing state. It additionally requires every
  item to come from one seller (409). If the Checkout Session then fails,
  `releaseReservedStock` returns the units and flips the listing back to
  `active`.

Either way the seller confirms with `PUT /api/v1/orders/:id/complete`
(`completeOrder`), which flips that one order to `completed`.

### Why `orders.status` exists separately from `listings.status`

They overlap on the word `pending` but track two different things, and
**one listing can have many orders**:

- `listings.status` (`active`/`pending`/`sold`/`archived`) answers *"is this
  item still for sale?"* — necessarily one value per listing.
- `orders.status` (`pending`/`completed`/`cancelled`/`refunded`) answers
  *"what happened to this specific transaction?"* — one value **per order**,
  and a listing accumulates several over time.

Since listings sell whole, a listing has at most one *completed* order — but
it still accumulates order rows, because cancelling frees it to be sold again.

That ceiling of one is enforced, not just conventional: `updateProduct`
(`backend/products.go`) refuses to edit a `sold` listing, and refuses to move
any listing back to `active` once it has a completed order — including the
archive-then-Republish route round it. A seller with another of the same item
posts a new listing, so the second sale gets its own row and its own history.

| When | Event | `orders` rows | `listings.status` |
|---|---|---|---|
| Jan 2 | seller posts it | *(none)* | `active` |
| Jan 5 | buyer A checks out | 1001 `pending` | `pending` |
| Jan 7 | buyer A cancels | 1001 **`cancelled`** | `active` |
| Jan 9 | buyer B checks out | 1001 `cancelled`, 1002 `pending` | `pending` |
| Jan 14 | seller confirms | 1001 `cancelled`, 1002 **`completed`** | `sold` |

One listing value at the end, two order values. There is nowhere on the
listing for `cancelled` to live — `listings.status` says `sold`, which is
true, but it cannot also record that a buyer backed out first. That history
matters: buyer A needs the cancelled order in their purchase list, and the
seller needs to tell a clean sale from a second attempt.

The deeper split: **`listings.status` is state, `orders.status` is history.**
The listing column only ever describes *now* and is overwritten four times
above — it has no memory. Each order row is permanent; nothing ever rewrites
1001. `orders.status` is also the only place `cancelled` and `refunded` can be
represented at all; those are outcomes of one transaction, not states an item
can be in. Conversely `archived` is a seller's shelf decision with no buyer
involved, so it is meaningless as a transaction outcome.

This is also why `getSellerDashboardItems` counts **pending orders**
(`COUNT(*) FROM orders WHERE listing_id = ... AND status = 'pending'`) rather
than trusting `listings.status` alone. `listings.status` can only say
"something is pending on this item"; the per-transaction truth — how many, and
which ones — lives only in the `orders` table, so the dashboard derives the
override fresh on every request.

---

## reviews

Buyer feedback on sellers/listings. **Currently unused** — no Go handler
reads or writes this table. The `rating`/`reviews` count shown on listings
comes from the cached columns on `listings`, not from aggregating this table.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Row ID |
| `reviewer_id` | int FK → users | Who wrote the review |
| `reviewee_id` | int FK → users | Who's being reviewed (the seller) |
| `listing_id` | int FK → listings, nullable | Optionally ties the review to a listing; set NULL if the listing is deleted |
| `rating` | int, CHECK 1–5 | Star rating |
| `comment` | text | Review body |
| `created_at` | timestamp | Audit timestamp |

---

## messages

Direct chat/DM content. Actively used by `backend/modules/user/chat/` —
backs the real-time WebSocket chat feature.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Row ID |
| `sender_id`, `receiver_id` | int FK → users | The two participants |
| `content` | text | Message text |
| `is_read` | boolean | Read-receipt flag |
| `created_at` | timestamp | Ordering + timestamp display |

Indexed on `(sender_id, receiver_id)` and `(receiver_id, is_read)` for fast
conversation/unread-count lookups.

---

## friendships

The friend graph. Actively used by `backend/modules/user/friends/`.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Row ID |
| `user_id1`, `user_id2` | int FK → users | The pair; `UNIQUE(user_id1, user_id2)` prevents duplicate pairs |
| `status` | varchar(20), default `'pending'` | `pending` / `accepted` / `blocked` |
| `created_at` | timestamp | Audit timestamp |

---

## api_keys

Powers the public developer API (secured, rate-limited access to marketplace
data). **Actively used** — `backend/myMiddleware/apikey.go` validates keys and
`backend/api_keys.go` manages them. See `API_DOCUMENTATION.md`.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Row ID |
| `user_id` | int FK → users | Whose key this is; the public API acts on behalf of this user |
| `key_hash` | varchar(255) unique | **SHA-256 hash** of the API key — the raw key is never stored, only shown once at creation (same principle as `password_hash`) |
| `name` | varchar(255) | User-given label, e.g. "My Inventory Bot" |
| `is_active` | boolean, default true | Revoked keys set this false (row kept so logs stay attributable); revoked key → 403 |
| `rate_limit` | int, default 100 | Requests/minute allowed for this key (fixed-window limiter in the middleware) |
| `created_at` | timestamp | When the key was generated |
| `last_used_at` | timestamp | Updated on each authenticated request |

---

## api_request_logs

Audit trail for the public API — one row per request made with an API key.
Written by the API-key middleware, read by `GET /api/v1/api-keys/logs`. Not in
the original `db/init.sql`; created there now plus via runtime migration in
`backend/db.go`.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Row ID |
| `api_key_id` | int | Which key made the request |
| `user_id` | int | The acting user (owner of the key) |
| `method` | varchar(10) | HTTP method (GET/POST/PUT/DELETE) |
| `path` | varchar(255) | Request path, e.g. `/api/public/v1/products` |
| `status` | int | HTTP response status returned |
| `ip_address` | varchar(64) | Caller IP (for spotting unfamiliar usage) |
| `created_at` | timestamp | When the request happened; indexed with `api_key_id` |

---

## analytics

Legacy event log. **Fully unused** — left over from a merge. Its sibling
`analytics_events` has been dropped; this one is a candidate for the same
once the team agrees.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Row ID |
| `event_type` | varchar(50) | e.g. would hold `"listing_viewed"` |
| `listing_id` | int FK → listings | Which listing the event relates to |
| `created_at` | timestamp | Audit timestamp |

---

## faq_embeddings

Vector store for the AI FAQ chatbot's RAG retrieval. Used exclusively by
`ai_service/` (Python/FastAPI) — never touched by the Go backend.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Row ID |
| `source_file` | varchar(255) | Which FAQ markdown file this chunk came from (e.g. `how_to_sell.md`) |
| `chunk_text` | text | The actual text chunk that was embedded |
| `embedding` | vector(1536) | The embedding vector, indexed with `ivfflat` for cosine-similarity search |
| `created_at` | timestamp | Audit timestamp |

---

## otps

One-time passcodes for email verification / login 2FA. Not declared in
`db/init.sql` — created automatically by GORM's `AutoMigrate` call in
`backend/modules/user`. Actively used by the auth module.

| Column | Type | Use |
|---|---|---|
| `email` | varchar(255), PK | Ties the OTP to an email address (not a user ID) |
| `code` | char(6) | The 6-digit code sent to the user |
| `expiry_date` | timestamptz | When the code stops being valid |
| `used` | boolean, default false | Prevents replay of an already-consumed code |
| `temp_token` | varchar(255) | Temporary token issued alongside the OTP, used by the frontend to prove "I verified this OTP" in the follow-up `verify-otp` call |

---

## Quick reference — used vs. unused

**Fully wired and live:** `users`, `listings`, `orders` (real checkout via
`POST /orders` + `PUT /orders/:id/complete`), `messages`, `friendships`,
`otps`, `faq_embeddings`

**Schema exists, nothing uses it yet:** `listing_images` (images tracked by
filename convention instead), `reviews`, `analytics` (dead event log)

**Public API (added this session):** `api_keys` + `api_request_logs` — see
`API_DOCUMENTATION.md`

**Columns that exist but nothing reads/writes them:** `listings.currency`
(hardcoded `'RM'` everywhere). `users.oauth_id` / `users.oauth_provider` are
no longer in this list — Google OAuth now writes them (`backend/modules/user/repository.go`,
read back in `backend/admin.go`), with a partial unique index on the pair.
