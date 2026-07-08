# Transcendence Public API

A secured, rate-limited REST API for programmatic access to marketplace
listings. Authenticate with an API key you generate from your account; every
request is rate-limited per key and recorded to an audit log you can review.

## Base URL

```
https://localhost/api/public/v1
```

(Behind nginx TLS. The Go backend serves it on `:8080` internally.)

---

## Authentication

All public endpoints require an **API key** sent in the `X-API-Key` header:

```
X-API-Key: sk_live_<your-api-key>xxxxxxxx
```

- The key identifies **which user** the request acts on behalf of.
- Only a SHA-256 **hash** of the key is stored server-side — the plaintext is
  shown exactly once, at creation, and can never be retrieved again.
- A missing key → `401`. An unknown key → `401`. A revoked key → `403`.

### Managing your keys (JWT-authenticated, via the web app / user session)

These live under `/api/v1` and require your normal login token
(`Authorization: Bearer <JWT>`), not an API key:

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/api-keys` | Generate a new key. Body: `{"name":"My Bot"}`. Returns the plaintext key **once**. |
| GET | `/api/v1/api-keys` | List your keys — metadata only (id, name, active, rateLimit, createdAt, lastUsedAt). Never returns the secret. |
| DELETE | `/api/v1/api-keys/:id` | Revoke a key (sets `is_active=false`; row kept so its logs stay attributable). |
| GET | `/api/v1/api-keys/logs?limit=100` | Your API request audit log (see Safety / audit log below). |

**Create key example:**
```bash
curl -X POST https://localhost/api/v1/api-keys \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Inventory Bot"}'
```
```json
{
  "id": 1,
  "name": "My Inventory Bot",
  "apiKey": "sk_live_7ba8b2f9...c3ce5aa8",
  "warning": "Copy this key now — it will not be shown again."
}
```

---

## Rate limiting

Each key has a `rate_limit` (default **100 requests/minute**). Requests are
counted in a fixed one-minute window per key. Exceeding it returns:

```
HTTP 429 Too Many Requests
{ "error": "Rate limit exceeded" }
```

The window resets at the start of the next minute.

---

## Safety / audit log

Every request made with an API key is recorded to `api_request_logs`:
the key used, the acting user, HTTP method, path, response status, caller IP,
and timestamp. Review it any time with `GET /api/v1/api-keys/logs`:

```json
{
  "logs": [
    {
      "id": 1,
      "title": "Laptop",
      "description": "Gaming laptop",
      "price": 1200.00,
      "currency": "USD",
      "category": "electronics",
      "seller": {
        "id": 5,
        "username": "seller_name",
        "rating": 4.5
      },
      "images": [
        {
          "id": 1,
          "url": "https://...",
          "is_primary": true
        }
      ],
      "views_count": 156,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

#### POST /api/v1/listings
Create new listing.

**Authorization Required**

**Request Body:**
```json
{
  "title": "Laptop",
  "description": "Gaming laptop for sale",
  "category": "electronics",
  "price": 1200.00,
  "currency": "USD"
}
```

**Response:** `201 Created`

#### GET /api/v1/listings/:id
Get listing details.

#### PUT /api/v1/listings/:id
Update listing.

**Authorization Required** (Seller only)

#### DELETE /api/v1/listings/:id
Delete listing.

**Authorization Required** (Seller only)

### Messages

#### POST /api/v1/messages
Send a message.

**Authorization Required**

**Request Body:**
```json
{
  "receiver_id": 2,
  "content": "Are you interested in selling?"
}
```

#### GET /api/v1/messages
Get user messages.

**Query Parameters:**
- `user_id`: Filter by user
- `unread_only`: true/false

#### PUT /api/v1/messages/:id/read
Mark message as read.

### Reviews

#### POST /api/v1/reviews
Create a review.

**Authorization Required**

**Request Body:**
```json
{
  "reviewee_id": 2,
  "listing_id": 1,
  "rating": 5,
  "comment": "Great seller!"
}
```

#### GET /api/v1/reviews/:user_id
Get user reviews.

**Query Parameters:**
- `limit`: Number of reviews
- `offset`: Pagination offset

### Orders

#### POST /api/v1/orders
Create an order.

**Authorization Required**

**Request Body:**
```json
{
  "items": [
    {
      "listingId": 1,
      "quantity": 1
    }
  ],
  "paymentMethod": "meetup"
}
```

#### GET /api/v1/orders
Get user orders.

**Query Parameters:**
- `status`: pending, completed, cancelled, refunded
- `page`: Page number
- `limit`: Items per page

Returns buyer orders with listing and seller display details for purchase
history.

#### GET /api/v1/orders/:id
Get order details.

#### GET /api/v1/seller/orders
Get orders for the authenticated seller.

**Query Parameters:**
- `status`: pending, completed, cancelled, refunded. Defaults to `pending`.

#### PUT /api/v1/orders/:id/complete
Mark a pending order as delivered/completed. Only the seller for that order can
complete it.

#### PUT /api/v1/orders/:id/cancel
Cancel order.

### Analytics

#### GET /api/v1/analytics/dashboard
Get analytics dashboard data.

**Authorization Required** (Seller)

**Response:**
```json
{
  "total_sales": 15000.00,
  "total_orders": 25,
  "average_rating": 4.8,
  "total_views": 3500,
  "monthly_revenue": [
    {
      "month": "2024-01",
      "revenue": 5000.00
    }
  ]
}
```

This lets you spot unexpected usage (unfamiliar IPs, unusual paths, error
spikes) and revoke a key if it looks compromised.

---

## Endpoints (5)

All under `/api/public/v1`, all require `X-API-Key`.

### GET /products
List listings. Optional query params: `limit`, `offset`, `search`, `sort`
(`price-low`|`price-high`|`newest`|`rating`), `minPrice`, `maxPrice`,
`sellerId`, `status`, `weightCategory`, `flexibilityCategory`,
`balanceCategory`.

```bash
curl "https://localhost/api/public/v1/products?limit=2&sort=price-high" \
  -H "X-API-Key: sk_live_..."
```
```json
{ "products": [ { "id": 55, "title": "Yonex Astrox 100ZZ 4U", "price": 950, "..." : "..." } ], "total": 40 }
```

### GET /products/:id
Fetch a single listing by id. `404` if not found.

```bash
curl "https://localhost/api/public/v1/products/55" -H "X-API-Key: sk_live_..."
```

### POST /products
Create a listing. It is **always owned by the key's user** — any `sellerId`
in the body is ignored and overridden with the authenticated user's id.

Body fields: `title` (required), `price` (required, > 0), `description`,
`category`, `condition`, `dealingMethod`, `phoneNumber`, `location`,
`weightCategory`, `flexibilityCategory`, `balanceCategory`, `originalPrice`,
`isNew`, `isFeatured`.

```bash
curl -X POST "https://localhost/api/public/v1/products" \
  -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \
  -d '{"title":"My Racket","price":123,"category":"Rackets"}'
```
Returns `201` with the created listing.

### PUT /products/:id
Update a listing. Only the owner (the key's user) may update it, else `403`.
Body: `title` (required), `price` (required), `status`
(`active`|`sold`|`archived`), plus the same optional fields as POST.

```bash
curl -X PUT "https://localhost/api/public/v1/products/60" \
  -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \
  -d '{"title":"Updated","price":150,"status":"active"}'
```

### DELETE /products/:id
Delete a listing. Only the owner may delete it, else `403`.

```bash
curl -X DELETE "https://localhost/api/public/v1/products/60" -H "X-API-Key: sk_live_..."
```
```json
{ "message": "Product deleted" }
```

---

## Status codes

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created (POST) |
| 400 | Bad request (missing/invalid body fields) |
| 401 | Missing or invalid API key |
| 403 | Key revoked, or you don't own the target listing |
| 404 | Listing not found |
| 429 | Rate limit exceeded |
| 500 | Server error |

---

## Implementation notes

- API-key auth + rate limiting + logging: `backend/myMiddleware/apikey.go`
- Key management handlers: `backend/api_keys.go`
- Route registration: `backend/main.go` (`/api/public/v1` group)
- Tables: `api_keys` (keys), `api_request_logs` (audit log) — see `db/SCHEMA.md`
