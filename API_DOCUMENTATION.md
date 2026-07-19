# Transcendence API Documentation

Two APIs live in this project:

1. **Public Developer API** — for external developers/scripts. Authenticated
   with an **API key** (`X-API-Key` header), rate limited per key, and every
   request is recorded to an audit log.
2. **Internal app API** — what the website's own frontend uses. Authenticated
   with a **JWT** from login (`Authorization: Bearer <token>`).

Everything goes through nginx over HTTPS:

```
Base URL (public API):  https://localhost/api/public/v1
Base URL (internal):    https://localhost/api/v1
```

> Local TLS uses a self-signed certificate — add `-k` to curl examples.

---

# Part 1 — Public Developer API

## Quickstart (3 steps)

1. **Get a key.** Log in on the website → **My Shop → Developer API →
   Create Secret Key**. Copy the key immediately — it is shown **once** and
   can never be displayed again (only its SHA-256 hash is stored).
2. **Send it on every request** as a header:
   ```
   X-API-Key: sk_live_<your-api-key>
   ```
3. **Call the endpoints below.** The key identifies your account: write
   operations act as you, and you can only modify your own listings.

## Rate limiting

Each key allows **100 requests per minute** by default (per-key `rate_limit`).
Exceeding it returns `429 Too Many Requests` until the next minute window.

## Audit log (safety)

Every request made with a key is recorded: method, path, response status,
caller IP, and timestamp. Review it in the **Request Log** tab of the
Developer API page, or via `GET /api/v1/api-keys/logs`. If you see unfamiliar
activity, revoke the key — it stops working immediately.

## Endpoints

### 1. GET /api/public/v1/products — list listings

Optional query parameters:

| Param | Meaning |
|---|---|
| `limit`, `offset` | pagination (limit max 100, default 20) |
| `search` | title contains |
| `sort` | `price-low` \| `price-high` \| `newest` \| `rating` |
| `minPrice`, `maxPrice` | price range |
| `sellerId` | only this seller's listings |
| `status` | `active` \| `sold` \| `archived` |
| `weightCategory`, `flexibilityCategory`, `balanceCategory` | racket specs |

```bash
curl -k "https://localhost/api/public/v1/products?limit=2&sort=price-high" \
  -H "X-API-Key: sk_live_..."
```
```json
{
  "products": [
    { "id": 55, "title": "Yonex Astrox 100ZZ 4U", "price": 950, "category": "Rackets", "status": "active", "...": "..." }
  ],
  "total": 40
}
```

JavaScript:
```js
const res = await fetch('https://localhost/api/public/v1/products?limit=2', {
  headers: { 'X-API-Key': 'sk_live_...' },
});
const { products, total } = await res.json();
```

### 2. GET /api/public/v1/products/:id — one listing

```bash
curl -k https://localhost/api/public/v1/products/55 -H "X-API-Key: sk_live_..."
```
Returns the listing object, or `404` if it doesn't exist.

### 3. POST /api/public/v1/products — create a listing

The listing is **always owned by the key's account** — any `sellerId` in the
body is ignored and replaced with yours.

**Required:**

| Field | Type | Constraint |
|---|---|---|
| `title` | string | non-empty |
| `price` | number | must be `> 0` |

**Free text — not validated by the API, but these are the values the site's own UI uses (default shown if omitted):**

| Field | Default | Values used by the site |
|---|---|---|
| `category` | `"Others"` | `Rackets`, `Footwear`, `Apparel`, `Strings`, `Accessories`, `Bags`, `Others` |
| `condition` | `"Second-hand (Used)"` | `New`, `Second-hand (Used)` |
| `dealingMethod` | `"Meet Up"` | `Meet Up`, `Delivery` |
| `weightCategory` | `"4U"` | `1U`–`8U` (badminton racket weight class) |
| `flexibilityCategory` | `"Medium Flex"` | `Stiff Shaft`, `Medium Flex`, `High Flexibility` |
| `balanceCategory` | `"Even Balance"` | `Head Heavy`, `Even Balance`, `Head Light` |
| `phoneNumber` | `""` | any string |
| `location` | `"Malaysia"` | any string |
| `description` | `""` | any string |

Since these have no server-side validation, sending an unlisted value (e.g.
`"category":"Toys"`) is accepted and stored as-is — it just won't match any
filter chip in the site's own UI.

**Other optional fields:**

| Field | Type | Constraint |
|---|---|---|
| `originalPrice` | number \| null | none |
| `stockQuantity` | integer | defaults to `1`; if provided, must be `≥ 1` |
| `isNew` | boolean | `true` / `false` |
| `isFeatured` | boolean | `true` / `false` |

```bash
curl -k -X POST https://localhost/api/public/v1/products \
  -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \
  -d '{"title":"My Racket","price":123,"category":"Rackets","stockQuantity":1}'
```
Returns `201` with the created listing (including its new `id`).

### 4. PUT /api/public/v1/products/:id — update a listing

Only the owner may update (else `403`); `404` if the listing doesn't exist.

**⚠ This is a full replace, not a partial patch.** Every field you omit is
written as empty/zero — it does **not** keep its previous value. Always
re-send the complete listing (fetch it first with `GET /products/:id` if
you're changing just one field).

**Required:**

| Field | Type | Constraint |
|---|---|---|
| `title` | string | non-empty (`400` otherwise) |
| `price` | number | must be `> 0` (`400` otherwise) |

**Everything else — same fields as POST** (`description`, `category`,
`condition`, `dealingMethod`, `phoneNumber`, `location`, `weightCategory`,
`flexibilityCategory`, `balanceCategory`, `originalPrice`) — free text, not
validated, omitted = saved as empty string.

**Fields with special handling on update:**

| Field | Type | Behavior |
|---|---|---|
| `status` | string | `active` \| `sold` \| `archived`. Omitted/empty → defaults to `active`. **If you set/leave it `active` but `stockQuantity` resolves to `0`, the server auto-corrects it to `sold`.** |
| `stockQuantity` | integer | Omitted → keeps the listing's *current* stock quantity (this one field does NOT reset to empty when omitted). If provided, must be `≥ 0` (`400` if negative). Setting it to `0` triggers the auto-`sold` behavior above. |

```bash
# Full example — price drop, still active, stock untouched
curl -k -X PUT https://localhost/api/public/v1/products/60 \
  -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \
  -d '{
    "title": "My Racket (price drop)",
    "price": 99,
    "description": "Lightly used, great condition",
    "category": "Rackets",
    "condition": "Second-hand (Used)",
    "dealingMethod": "Meet Up",
    "location": "Kuala Lumpur",
    "status": "active"
  }'
```

```bash
# Mark it sold out by zeroing stock — status auto-flips to "sold"
curl -k -X PUT https://localhost/api/public/v1/products/60 \
  -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \
  -d '{"title":"My Racket","price":99,"stockQuantity":0}'
```
```json
{ "id": 60, "title": "My Racket", "price": 99, "status": "sold", "stockQuantity": 0, "...": "..." }
```

### 5. DELETE /api/public/v1/products/:id — delete a listing

Only the owner may delete (else `403`); `404` if it doesn't exist. No request
body. This permanently removes the listing — there is no undo, and any
associated orders reference a listing that no longer exists.

```bash
curl -k -X DELETE https://localhost/api/public/v1/products/60 \
  -H "X-API-Key: sk_live_..."
```
```json
{ "message": "Product deleted" }
```

## Status codes

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created (POST) |
| 400 | Bad request — missing/invalid fields |
| 401 | Missing or invalid API key |
| 403 | Key revoked, or you don't own the target listing |
| 404 | Not found |
| 429 | Rate limit exceeded |
| 500 | Server error |

---

# Part 2 — API key management (JWT)

These use your normal login session, not an API key. The **Developer API**
page in the app is a UI over exactly these endpoints.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/api-keys` | Generate a key. Body: `{"name":"My Bot"}`. Returns the plaintext key **once**. |
| GET | `/api/v1/api-keys` | List your keys — metadata only (never the secret). |
| DELETE | `/api/v1/api-keys/:id` | Revoke a key (kept in DB so its logs stay attributable). |
| GET | `/api/v1/api-keys/logs?limit=100` | Audit log for all your keys (limit 1–500). |

## Getting a JWT to call these endpoints

Every request above needs `Authorization: Bearer <JWT>`. Three ways to get one:

**A. Log in via the API:**
```bash
curl -k -X POST https://localhost/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"..."}'
```
The response's `"token"` field is your JWT.

**B. From the browser console, while already logged into the site (fastest):**
1. Open the site (`https://localhost`) and log in normally.
2. Open DevTools → **Console** tab (F12, or right-click → Inspect).
3. Run:
   ```js
   localStorage.getItem('token')
   ```
4. Copy the printed string (without the surrounding quotes) — that's your JWT.

**C. From DevTools → Network tab:** click any request the site makes to
`/api/v1/...` and check its Request Headers — `Authorization: Bearer ...` is
already attached there by the frontend.

> If you use the **Developer API** page in the app itself (My Shop →
> Developer API), you never need to do this manually — the page reads
> `localStorage.getItem('token')` and attaches it to every call for you. This
> is only needed for calling these endpoints directly with curl/Postman.

```bash
# 1) login to get a JWT (or grab it from the console, method B above)
curl -k -X POST https://localhost/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"..."}'

# 2) create a key with it
curl -k -X POST https://localhost/api/v1/api-keys \
  -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" \
  -d '{"name":"My Inventory Bot"}'
```

---

# Part 3 — Internal app API (JWT) — summary

Used by the website frontend. All `protected` routes need
`Authorization: Bearer <JWT>` from login.

### Auth
| Method | Endpoint | Notes |
|---|---|---|
| POST | `/api/v1/auth/register` | username, email, password |
| POST | `/api/v1/auth/login` | Returns JWT, or `202` + `needOtp` when 2FA is on |
| POST | `/api/v1/auth/verify-otp` | tempToken + otpCode → JWT |
| POST | `/api/v1/auth/resend-otp` | email → new OTP |

### Products
| Method | Endpoint | Auth |
|---|---|---|
| GET | `/api/v1/products` (+ same filters as public API) | none |
| GET | `/api/v1/products/:id` | none (counts a view) |
| GET | `/api/v1/products/:id/images` | none |
| POST | `/api/v1/products` | JWT — owned by the caller |
| PUT | `/api/v1/products/:id` | JWT — owner only |
| DELETE | `/api/v1/products/:id` | JWT — owner only |
| POST | `/api/v1/products/:id/images` | JWT — owner only, multipart `images` |

### Orders
| Method | Endpoint | Notes |
|---|---|---|
| POST | `/api/v1/orders` | Checkout. Body: `{"items":[{"listingId":1,"quantity":1}],"paymentMethod":"..."}` — returns created orders + total |
| GET | `/api/v1/orders` | Buyer's own orders |
| GET | `/api/v1/orders/:id` | One order — buyer or seller only |
| PUT | `/api/v1/orders/:id/complete` | Seller marks a pending order completed |
| GET | `/api/v1/seller/orders?status=pending` | Orders for the authenticated seller |

### Seller analytics dashboard
| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/v1/seller/dashboard/items` | Per-listing stats (views, days listed, sold, stale) |
| GET | `/api/v1/seller/dashboard/summary?months=12` | Revenue, sell-through, monthly + category breakdowns |

### Other
| Method | Endpoint | Notes |
|---|---|---|
| POST | `/api/v1/ai/chat` | AI FAQ chatbot (proxied to the Python RAG service) |
| GET | `/health`, `/api/v1/status` | Health checks |

Plus user profile / friends / chat routes registered by their modules
(`backend/modules/user/...`).

---

## Implementation map

| Piece | File |
|---|---|
| API-key auth + rate limiting + request logging | `backend/myMiddleware/apikey.go` |
| Key management handlers | `backend/api_keys.go` |
| Public + internal route registration | `backend/main.go` |
| Products / orders handlers | `backend/products.go`, `backend/orders.go` |
| Tables (`api_keys`, `api_request_logs`, …) | `db/init.sql`, reference in `db/SCHEMA.md` |
| Developer API UI (create key / docs / logs) | `frontend/src/app/(user)/profile/developer-api/` |
