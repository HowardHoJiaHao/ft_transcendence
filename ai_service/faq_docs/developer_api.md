# Developer API Keys and Public Listing API

Signed-in members can create API keys to manage **their own** listings from a script. This is the Developer API under `/api/public/v1`. It is not a scrape of the whole marketplace and it is not an admin API.

Open **Profile menu → Developer API** (`/profile/developer-api`).

## 1. What a key is allowed to do

With a valid `X-API-Key` you can:

* **List your listings** — `GET /api/public/v1/products`
* **Fetch one of your listings** — `GET /api/public/v1/products/:id`
* **Create a listing** on your account — `POST /api/public/v1/products`
* **Update a listing you own** — `PUT /api/public/v1/products/:id`
* **Delete a listing you own** — `DELETE /api/public/v1/products/:id`

The key is scoped to the account that created it. You cannot read or edit someone else’s ads. Any `sellerId` you send on create is ignored and replaced with yours.

Browser users still use the ordinary `/api/v1` routes with a login token. Do not put an API key into RacketBot or into listing descriptions.

## 2. Create, copy, revoke

On the Developer API page:

1. Open **Create Secret Key** and give the key a name (for example `Inventory bot`).
2. The **plaintext key is shown once**. Copy it immediately. The server stores only a hash; you cannot view the secret again.
3. Keys look like `sk_live_…`. Treat that string like a password.
4. **Revoke** stops the key on the next request (public calls then return 403). The row remains so old request logs still make sense.

If a key leaks (committed to git, pasted in chat, left in a screenshot), revoke it and create a new one.

## 2a. Keys expire after 30 days

Every key is valid for **30 days from the moment it is created**. This is not optional and it cannot be extended — a leaked key stops working on its own.

* The keys table shows an **Expires** date and flags the key as **Expired** once that date passes.
* An expired key returns **401** with `API key has expired. Create a new one from the Developer API page.`
* Nothing is renewed automatically. Create a fresh key before the old one lapses and swap it into your script.
* Expiry is checked on every request, so an expired key stops working the moment it lapses, mid-run included.

## 3. How to call it

Send the key on every public request:

```
X-API-Key: sk_live_...
```

Example (list your products):

```
GET /api/public/v1/products?limit=20&sort=newest
X-API-Key: sk_live_...
```

Useful query parameters on the list endpoint:

* `limit` — 1–100, default 20
* `sort` — `price-low` | `price-high` | `newest`
* `status` — `active` | `sold` | `archived`
* Any other query name is rejected with 400

Through the public WAF the same-origin path is `/api/public/v1/...`. Local HTTPS is typically `https://localhost:8443` with a self-signed certificate (`curl -k` in development only).

## 4. Create and update rules (same idea as the Sell form)

Create requires **title**, **price**, **location**, and **dealingMethod**.

`dealingMethod` must be one of:

* `Meet Up`
* `Mailing or Delivery`
* `Meet Up, Mailing or Delivery`

Optional fields include category, condition, racket specs, description, phone, original price, and stock. Defaults match the website (for example category `Others`, condition `Second-hand (Used)`, stock `1`).

Racket specs (`weightCategory`, `flexibilityCategory`, `balanceCategory`) are stored only when category is `Rackets`. On any other category they are stored empty.

Images: a create body may mention `image`, but that field is discarded. Upload photos afterwards with the normal authenticated file route `POST /api/v1/products/:id/files` (JWT), or add them in My Shop.

Updates are partial: send only the fields you want to change. Status is not editable here. Pending or sold listings cannot be edited (409). Delete is allowed on active or archived listings only, and is permanent.

## 5. Rate limits and errors

* Each key has a per-minute limit (shown on the keys table, commonly 100/min).
* Over the limit you get **429**. Wait for the next minute window. Do not rotate keys just to dodge the limiter.
* Common statuses:
  * 200 / 201 — success
  * 400 — missing or invalid field
  * 401 — missing, invalid, or expired key
  * 403 — revoked key, or you do not own the listing
  * 404 — not found
  * 409 — listing pending/sold, or it still has orders
  * 429 — rate limit
  * 500 — server error

## 6. Request log

The **Request Log** tab shows recent calls made with your keys: method, path, status, caller IP, time. Use it to see whether a bot is failing validation or whether a leaked key is being used.

Key management itself (`POST/GET/DELETE /api/v1/api-keys`) uses your **login JWT**, not `X-API-Key`.

## 7. Rules of use

* Keep the key secret. Do not commit it.
* Stay inside the published limits.
* Automated access **outside** this API (scraping search pages, attacking the WAF) is not allowed.
* You are responsible for everything done with your key.
* Staff may revoke a key that is abused.
