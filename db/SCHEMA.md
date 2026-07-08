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
| `date_of_birth` | date | Profile field |
| `gender` | varchar(10) | Profile field, CHECK constrained to `Male`/`Female` |
| `avatar_url` | varchar(255) | Link-based avatar (e.g. external URL) |
| `avatar_data` | bytea | Alternative: raw avatar image bytes stored in-row |
| `avatar_mime_type` | varchar(50) | Required if `avatar_data` is set |
| `bio` | text | Free-text profile blurb |
| `is_verified` | boolean | Set true after email/OTP verification |
| `requires_2fa` | boolean | Gates the OTP step in `Login()` — see `backend/modules/user/auth/handler.go` |
| `oauth_id`, `oauth_provider` | varchar | **(unused)** — no OAuth handler exists in the codebase |
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
| `status` | varchar(20), default `'active'` | `active` / `sold` / `archived` — drives My Shop tabs and the seller dashboard funnel |
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

Purchase records — one row per transaction against a listing.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Order ID |
| `buyer_id` | int FK → users | Who bought it |
| `seller_id` | int FK → users | Who sold it (denormalized copy of the listing's seller) |
| `listing_id` | int FK → listings | What was bought |
| `quantity` | int, default 1 | Units in this order — generic e-commerce field; doesn't really apply since each listing is a unique single item |
| `total_price` | numeric(10,2) | Amount charged for this order |
| `status` | varchar(20), default `'pending'` | `pending` / `completed` / `cancelled` / `refunded` — the seller dashboard only counts `completed` as real revenue |
| `payment_method` | varchar(50) | Free text, e.g. "cash", "card" |
| `created_at`, `updated_at` | timestamp | `created_at` anchors the monthly revenue chart and time-to-sell calc |

**Note:** no live checkout/purchase handler exists in the Go backend — only
`getOrders`/`getOrderByID` (read). Rows here currently come from seed data,
not a real "Buy Now" flow.

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

Legacy/duplicate event log. **Fully unused** — superseded by
`analytics_events` below; left over from a merge. Candidate for dropping
once the team agrees.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Row ID |
| `event_type` | varchar(50) | e.g. would hold `"listing_viewed"` |
| `listing_id` | int FK → listings | Which listing the event relates to |
| `created_at` | timestamp | Audit timestamp |

---

## analytics_events

The event log that's **actually wired up**. Every non-seller view of a
product detail page inserts a row here via `recordListingView()` in
`backend/products.go`.

| Column | Type | Use |
|---|---|---|
| `id` | serial PK | Row ID |
| `user_id` | int FK → users, nullable | Who triggered the event; null if the viewer wasn't authenticated |
| `event_type` | varchar(50) | e.g. `'listing_viewed'` |
| `event_data` | json | Free-form extra context — not populated by current code |
| `listing_id` | int, indexed | Which listing the event relates to — added this project session specifically to power the seller dashboard's "views in last 30 days" |
| `created_at` | timestamp | Filtered on for the 30-day view-count window |

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

**Fully wired and live:** `users`, `listings`, `orders` (read-only, no
checkout flow yet), `messages`, `friendships`, `otps`, `faq_embeddings`,
`analytics_events`

**Schema exists, nothing uses it yet:** `listing_images` (images tracked by
filename convention instead), `reviews`, `analytics` (dead duplicate of
`analytics_events`)

**Public API (added this session):** `api_keys` + `api_request_logs` — see
`API_DOCUMENTATION.md`

**Columns that exist but nothing reads/writes them:** `users.oauth_id` /
`users.oauth_provider`, `listings.currency` (hardcoded `'RM'` everywhere)
