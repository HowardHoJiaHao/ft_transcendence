# Transcendence API Documentation

Two APIs live in this project:

1. **Public Developer API** — for external developers/scripts. Authenticated
   with an **API key** (`X-API-Key` header), rate limited per key, and every
   request is recorded to an audit log.
2. **Internal app API** — what the website's own frontend uses. Authenticated
   with a **JWT** from login (`Authorization: Bearer <token>`).

Everything goes through the WAF, then nginx, over HTTPS:

```
Base URL (public API):  https://localhost:8443/api/public/v1
Base URL (internal):    https://localhost:8443/api/v1
```

> The port is `WAF_HTTPS_PORT`, which defaults to `8443` — rootless Docker cannot
> bind privileged ports, so there is no plain `https://localhost`.
>
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
| `limit` | page size, 1–100. Defaults to 20; higher values are clamped to 100 |
| `sort` | `price-low` \| `price-high` \| `newest` |
| `status` | `active` \| `sold` \| `archived` |

These three are the whole list. Any other parameter is refused with `400` naming
it, rather than being silently ignored — a dropped filter would return a result
set that does not match what was asked for.

```json
{ "error": "unsupported query parameter(s): offset, search; this API accepts limit, sort and status" }
```

There is no `sellerId`: every response is scoped to the account the key belongs
to, and that is not the caller's to override. There is no `offset` either, so
`limit` adjusts the page size but cannot page beyond the first 100 listings.

```bash
curl -k "https://localhost:8443/api/public/v1/products?limit=2&sort=price-high" \
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
const res = await fetch('https://localhost:8443/api/public/v1/products?limit=2', {
  headers: { 'X-API-Key': 'sk_live_...' },
});
const { products, total } = await res.json();
```

### 2. GET /api/public/v1/products/:id — one listing

```bash
curl -k https://localhost:8443/api/public/v1/products/55 -H "X-API-Key: sk_live_..."
```
Returns the listing object, or `404` if it doesn't exist.

### 3. POST /api/public/v1/products — create a listing

The listing is **always owned by the key's account** — any `sellerId` or
`sellerName` in the body is ignored and replaced with yours.

**Unknown fields are rejected, not ignored.** A body containing a field this
endpoint does not accept returns `400` naming it, so a typo fails loudly instead
of silently doing nothing:

```json
{ "error": "invalid field: pirce" }
```

The required set is exactly the one the Post an Ad form enforces — four fields.
Everything the form pre-selects for you is defaulted here to the same value.

**Required:**

| Field | Type | Constraint |
|---|---|---|
| `title` | string | non-empty |
| `price` | number | must be `> 0` |
| `dealingMethod` | string | non-empty. Site uses `Meet Up`, `Mailing or Delivery`, or both comma-joined |

**Value ceilings**, enforced identically on create, update, the developer API and
CSV import, with matching `CHECK` constraints in the database:

| Field | Range |
|---|---|
| `title` | 1–70 characters |
| `description` | 0–4000 characters |
| `price` | greater than 0, at most 100000 |
| `originalPrice` | greater than 0 when set, at most 100000 |
| `stockQuantity` | 1–100 on create; 0–100 on update, where `0` means out of stock |

**Keys expire after 30 days.** `expiresAt` is returned when a key is created and
by `GET /api/v1/api-keys`. An expired key returns
`401 API key has expired. Create a new one from the Developer API page.` — mint a
replacement before the old one lapses.

**Every call is logged, including rejected ones.** Each request writes a row to
`api_request_logs` with an `outcome` of `success`, `missing_key`, `invalid_key`,
`revoked_key`, `expired_key` or `rate_limited`, alongside the caller's IP and
user agent. Rejections against your own keys appear in `GET /api/v1/api-keys/logs`.

**Taken from your account, not from the request:** `location`, `state` and
`phoneNumber` are read from the authenticated seller's profile. Sending them is
ignored. If your profile is missing a phone number or a complete Malaysian
address, creating a listing returns
`400 Add your phone number and address to your profile before posting an ad`.

**Defaulted — omit them and you get what the form pre-selects:**

| Field | Default | Values used by the site |
|---|---|---|
| `category` | `"Others"` | `Rackets`, `Grips`, `Shuttlecocks`, `Racket Bags & Covers`, `Strings`, `Shoes`, `Apparel`, `Accessories`, `Others` |
| `condition` | `"Second-hand (Used)"` | `Second-hand (Used)`, `New`, `Refurbished` |
| `weightCategory` | `"4U"` † | `1U`–`8U` (badminton racket weight class) |
| `flexibilityCategory` | `"Medium Flex"` † | `Stiff Shaft`, `Medium Flex`, `High Flexibility` |
| `balanceCategory` | `"Even Balance"` † | `Head Heavy`, `Even Balance`, `Head Light` |
| `description` | `""` | any string |

† **The three racket specs are kept only when `category` is `Rackets`.** On any
other category they are stored as `""`, whatever you send — a Grips listing
stamped `4U` would be fabricated product data that buyers then filter on. So the
defaults in that column apply to rackets; everything else gets empty strings.

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
curl -k -X POST https://localhost:8443/api/public/v1/products \
  -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \
  -d '{"title":"My Racket","price":123,"location":"Kuala Lumpur","dealingMethod":"Meet Up"}'
```

That is the smallest body the API accepts. It produces the same listing as
clicking straight through Post an Ad without touching a dropdown: an `Others`
listing, `Second-hand (Used)`, stock `1` — and **empty** racket specs, because
`Others` is not `Rackets`. Send `"category":"Rackets"` and the same minimal body
comes back `4U` / `Medium Flex` / `Even Balance`.

One thing the API cannot do that the form requires: **attach a photo.** `image`
in the body is discarded — covers are added afterwards with
`POST /api/v1/products/:id/files`, so an API-created listing shows a placeholder
until you upload one.
Returns `201` with the created listing (including its new `id`).

### 4. PUT /api/public/v1/products/:id — update a listing

Only the owner may update (else `403`); `404` if the listing doesn't exist.

**This is a partial patch.** Send only what you want to change — every field you
omit keeps its current value. There is no need to fetch the listing first.

**Exactly six fields are editable here:**

| Field | Type | Constraint |
|---|---|---|
| `title` | string | if sent, must be non-empty |
| `price` | number | if sent, must be `> 0` |
| `description` | string | send `""` to clear it |
| `category` | string | see the POST table for accepted values |
| `location` | string | any string |
| `stockQuantity` | integer | must be `≥ 0`. `0` is allowed and does **not** change the status |

At least one of them must be present, or you get
`400 At least one field must be provided to update`.

**Everything else is rejected with `400 invalid field: <name>`** — including
`condition`, `dealingMethod`, `phoneNumber`, `originalPrice`, `isNew`,
`isFeatured`, `image`, `sellerId`, and the three racket specs. This surface is
deliberately narrower than the web edit form: a key holder should not be able to
rewrite the phone number buyers use to reach the seller.

**`status` is not settable here.** Sending it returns `400 invalid field: status`.
A listing's status belongs to the order flow, and Archive/Republish are web-app
actions — see Part 3.

**Racket specs follow the category rather than being sent.** They keep their
stored values while the resolved category is `Rackets`, and are cleared to `""`
the moment the listing moves to any other category.

**Two states refuse edits with `409`:**

- `pending` — an order is awaiting delivery; complete or cancel it first
- `sold` — the sale is done, and the row is what the seller dashboard derives
  revenue and days-to-sell from. To sell another of the same item, create a new
  listing.

```bash
# Partial update — only the fields you send are changed
curl -k -X PUT https://localhost:8443/api/public/v1/products/60 \
  -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \
  -d '{
    "title": "My Racket (price drop)",
    "price": 99,
    "description": "Lightly used, great condition"
  }'
```

```bash
# Mark it out of stock. The status stays exactly as it was.
curl -k -X PUT https://localhost:8443/api/public/v1/products/60 \
  -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \
  -d '{"stockQuantity":0}'
```
```json
{ "id": 60, "title": "My Racket (price drop)", "price": 99, "status": "active", "stockQuantity": 0, "...": "..." }
```

### 5. DELETE /api/public/v1/products/:id — delete a listing

Only the owner may delete (else `403`); `404` if it doesn't exist. No request
body. Permanent — there is no undo, and the listing's uploaded files are removed
with it.

**Three `409`s protect history:**

- `pending` or `sold` status — only `active` and `archived` listings are
  deletable
- the listing has **any** orders — those are the buyer's financial record too, so
  the listing is refused rather than taking the order rows down with it
  (`This listing has orders and cannot be deleted.`)

Archive instead when you simply want a listing off the marketplace.

```bash
curl -k -X DELETE https://localhost:8443/api/public/v1/products/60 \
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
| 400 | Bad request — missing/invalid fields, or a field this endpoint does not accept (`invalid field: <name>`) |
| 401 | Missing or invalid API key |
| 403 | Key revoked, or you don't own the target listing |
| 404 | Not found |
| 409 | Conflict — the listing is `pending` or `sold`, or still has orders |
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
curl -k -X POST https://localhost:8443/api/v1/auth/login \
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
curl -k -X POST https://localhost:8443/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"..."}'

# 2) create a key with it
curl -k -X POST https://localhost:8443/api/v1/api-keys \
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
| GET | `/api/v1/products` (full filter set — search, offset, price range, racket specs) | none |
| GET | `/api/v1/products/:id` | none (counts a view) |
| POST | `/api/v1/products` | JWT — owned by the caller |
| PUT | `/api/v1/products/:id` | JWT — owner only |
| DELETE | `/api/v1/products/:id` | JWT — owner only |
| POST | `/api/v1/products/import` | JWT — bulk create, max 500 rows, all-or-nothing |

Unlike the API-key `PUT`, the internal one is a **whole-form replace**: the edit
form submits every field it lets a seller change, and all of them are written.
`status` is accepted here but constrained to `active` or `archived` — that is
what My Shop's Archive and Republish buttons use. `sold`, `pending` and
`completed` belong to the order flow and are refused with `400`. Republishing a
listing that already has orders is refused with `409`, and republishing one with
zero stock stores it as `sold`.

`POST /products/import` takes `{"items":[…]}`, each item shaped like a `POST
/products` body. It requires the same four fields and applies the same defaults,
so a blank spreadsheet cell behaves exactly like an omitted JSON field. One bad
row fails the whole batch: `400` with `{"imported":0,"errors":[{row,field,message}]}`.

### Listing files
| Method | Endpoint | Auth |
|---|---|---|
| GET | `/api/v1/products/:id/files` | none — metadata list |
| GET | `/api/v1/files/:fileId/content` | none — streams the bytes |
| POST | `/api/v1/products/:id/files` | JWT — owner only, multipart |
| DELETE | `/api/v1/products/:id/files/:fileId` | JWT — owner only |
| GET | `/api/v1/users/:id/avatar` | none — streams the avatar |

Limits: 72 MB per request, 10 MB per image, 5 MB per document, max 6 images and
2 documents per listing. Files are stored as UUID filenames under
`storage/listings/<listingID>/` and `storage/avatars/<userID>/`, and are only
ever reachable through the two GET handlers above — nothing is served as a
directory.

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
| GET | `/api/v1/seller/dashboard/items` | Per-listing stats (days listed, sold, revenue) |
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
| Bulk import (validate all, insert in one transaction) | `backend/products_import.go` |
| Listing file upload / serve / delete | `backend/listing_files.go` |
| Tables (`api_keys`, `api_request_logs`, `listing_files`, …) | `db/init.sql`, reference in `db/SCHEMA.md` |
| Developer API UI (create key / docs / logs) | `frontend/src/app/(user)/profile/developer-api/` |
| Bulk import UI (CSV parse, preview, upload) | `frontend/src/components/BulkImport/`, `frontend/src/lib/csv.ts` |

The two `PUT /products/:id` routes deliberately use **different handlers** in
`products.go`: `updateProduct` for the JWT form (whole-form replace) and
`updateProductForAPIKey` for the developer API (six-field patch). They share
`updateTarget` and `loadListingForUpdate` for the existence, ownership and
status guards, so the two surfaces cannot drift on authorization.
