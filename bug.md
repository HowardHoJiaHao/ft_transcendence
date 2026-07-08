# Bug Findings

Date: 2026-07-07

This file documents the bugs found during a lightweight project scan of the
Next.js frontend, Go Echo backend, FastAPI AI service, PostgreSQL schema,
Docker Compose, and nginx configuration.

## Severity Scale

- Critical: Can compromise accounts/data, cause broad production outage, or
  destroy data.
- High: Security or core workflow bug with clear user impact.
- Medium: Important feature breakage, deployment breakage, or weak security
  boundary.
- Low: Minor user-facing issue, unfinished workflow, or maintenance risk.

## Ranked Summary

| Rank | Severity | Bug | Main Area |
| --- | --- | --- | --- |
| 1 | High | Listing creation can spoof another seller | Backend auth / products |
| 2 | High | Login scans user columns in the wrong order | Backend auth / repository |
| 3 | High | AI authenticated tools still use old `token_<id>` auth | Backend AI proxy / AI service |
| 4 | High | Uploaded `/static/...` files are not proxied by nginx | Backend static files / nginx |
| 5 | Medium | Missing `JWT_SECRET` is silently accepted | Backend auth config |
| 6 | Medium | WebSocket URL is hardcoded to `wss://localhost` | Frontend chat |
| 7 | Medium | WebSocket writer can concatenate multiple JSON messages into one frame | Backend chat |
| 8 | Medium | Profile email/phone OTP is enforced only in frontend flow | Profile security |
| 9 | Low | Checkout button has no behavior and there is no order creation route | Cart/orders |

## 1. Listing Creation Can Spoof Another Seller

Severity: High

Evidence:

- `backend/products.go:294` binds `CreateProductRequest` directly from the
  request body.
- `backend/products.go:298` only checks that `req.SellerID > 0`.
- `backend/products.go:341` inserts `req.SellerID` into `listings.seller_id`.
- `frontend/src/app/(user)/sell/page.tsx:257` sends `sellerId: user.id` from
  client state.
- Update/delete/upload paths correctly use `c.Get("userId")`, but create does
  not.

Why this is a bug:

The route is protected by JWT middleware, but the authenticated user ID is not
used when creating the listing. Any authenticated user can alter the JSON body
and create an ad that belongs to a different user ID.

How to trigger:

1. Login as user A and copy the JWT from browser local storage.
2. Pick another existing user ID, for example user B with ID `2`.
3. Send a direct request to create a listing with `sellerId: 2`:

```bash
curl -k -X POST https://localhost/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_FOR_USER_A>" \
  -d '{
    "sellerId": 2,
    "sellerName": "Spoofed Seller",
    "title": "Spoofed Listing",
    "description": "Created by user A but owned by user B",
    "price": 99,
    "category": "Rackets",
    "condition": "Second-hand (Used)",
    "dealingMethod": "Meet Up",
    "location": "Malaysia"
  }'
```

Expected result:

The backend should ignore `sellerId` from the request body and use the
authenticated JWT user ID.

Actual result:

The backend inserts the client-provided `sellerId`.

Impact:

Users can impersonate other sellers, pollute another seller's profile, and
create moderation/accountability problems.

Suggested fix:

In `createProduct`, read `userID := c.Get("userId").(int)` and use that as the
seller ID. Fetch seller name from the users table or trust only server-side user
data.

## 2. Login Scans User Columns In The Wrong Order

Severity: High

Evidence:

- `backend/modules/user/repository.go:41` selects:
  `avatar_url, phone_no, date_of_birth, gender, avatar_data, avatar_mime_type,
  bio, requires_2fa, created_at`.
- `backend/modules/user/repository.go:43` scans those selected fields into:
  `PhoneNo, DateOfBirth, Gender, avatarURL, avatarData, avatarMime, bio,
  Requires2FA, CreatedAt`.

Why this is a bug:

The selected columns and scan destinations do not match. For example,
`avatar_url` is scanned into `PhoneNo`, `phone_no` is scanned into
`DateOfBirth`, and `gender` is scanned into `avatarURL`.

How to trigger:

1. Register or update a user so `phone_no` or `date_of_birth` is non-null.
2. Try to login with that user's email and password.
3. Watch the backend log and login response.

Possible direct SQL setup:

```sql
UPDATE users
SET phone_no = '01212345678', date_of_birth = '2000-01-01', gender = 'Male'
WHERE email = '<USER_EMAIL>';
```

Expected result:

Login should compare the password and return a valid user object.

Actual result:

The SQL scan can fail because values are scanned into incompatible fields, or it
can return corrupted user data if the types happen to scan.

Impact:

Login can fail for users with profile fields populated, especially phone number
or date of birth. Returned profile data may also be wrong.

Suggested fix:

Make the SELECT order match the Scan order, or preferably scan into named model
fields using a safer abstraction. Also add a login test for users with
`phone_no`, `date_of_birth`, `gender`, and `avatar_url`.

## 3. AI Authenticated Tools Still Use Old `token_<id>` Auth

Severity: High

Evidence:

- `backend/ai_chat.go:37` calls `extractUserID(c)`.
- `backend/products.go:644` documents and implements `extractUserID` for
  `Bearer token_<id>`.
- `backend/myMiddleware/auth.go:18` and `auth.ValidateToken` now validate JWTs.
- `ai_service/tools.py:272` sends `Authorization: Bearer token_<uid>`.
- Frontend stores real JWTs after login in
  `frontend/src/app/(user)/login/page.tsx:122`.

Why this is a bug:

The main application migrated to JWTs, but the AI proxy and AI service tools
still use the old demo token format. As a result, logged-in AI requests are
treated as anonymous by the Go proxy, and protected backend calls from the AI
service are rejected.

How to trigger:

1. Login as a real user.
2. Open the RacketBot floating chat.
3. Ask a protected question such as:
   "Show my profile" or "Show my orders".
4. Observe that the request does not authenticate correctly.

Expected result:

The AI proxy should validate the JWT and forward a valid auth context to the AI
service or protected backend calls.

Actual result:

The proxy expects `token_<id>`, fails to extract the user ID from the JWT, and
the AI service later sends invalid `Bearer token_<id>` headers.

Impact:

AI profile/order features are broken for real logged-in users. This also creates
confusing duplicate auth behavior in the codebase.

Suggested fix:

Replace `extractUserID` with JWT validation or reuse `myMiddleware.JWTAuth()` on
AI routes that need auth. Do not synthesize `Bearer token_<id>` in the AI
service. Forward the user's real JWT where needed, or expose server-side
internal endpoints with explicit service auth.

## 4. Uploaded `/static/...` Files Are Not Proxied By Nginx

Severity: High

Evidence:

- `backend/main.go:96` serves `e.Static("/static", "static")`.
- `backend/products.go:529` returns listing image URLs like
  `/static/listings/<file>`.
- `backend/modules/user/profile/service.go:62` returns avatar URLs like
  `/static/avatars/<file>`.
- `nginx/conf/default.conf:36` proxies `/api/` to backend.
- `nginx/conf/default.conf:56` proxies `/uploads/`.
- `nginx/conf/default.conf:63` proxies `/avatars/`.
- There is no nginx `location /static/` block.

Why this is a bug:

When users access the app through nginx at `https://localhost`, browser requests
for `/static/listings/...` and `/static/avatars/...` go to the frontend upstream,
not the backend static file server.

How to trigger:

1. Start the app through Docker/nginx.
2. Login and upload a listing photo or profile avatar.
3. Open the returned image URL, for example:

```text
https://localhost/static/listings/<listing_id>_0.jpg
```

Expected result:

The uploaded image should be served by the backend.

Actual result:

The request is routed to the frontend because nginx has no `/static/` backend
proxy rule. The image may show as broken or return a frontend 404.

Impact:

Uploaded avatars and listing images can disappear from the UI in the normal
nginx deployment path.

Suggested fix:

Add an nginx route:

```nginx
location /static/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
}
```

Also ensure the backend Docker image creates both `/app/static/avatars` and
`/app/static/listings`.

## 5. Missing `JWT_SECRET` Is Silently Accepted

Severity: Medium

Evidence:

- `backend/modules/user/auth/service.go:30` initializes:
  `jwtSecret = []byte(os.Getenv("JWT_SECRET"))`.
- No startup code rejects an empty secret.

Why this is a bug:

If `JWT_SECRET` is missing, tokens may be signed and validated with an empty
secret. That is an insecure configuration and can be hard to notice.

How to trigger:

1. Start backend without `JWT_SECRET` in `.env`.
2. Login successfully.
3. Backend still issues a JWT.

Expected result:

The backend should fail startup with a clear error if `JWT_SECRET` is empty or
too weak.

Actual result:

The backend continues running with an empty secret.

Impact:

Auth security depends on environment setup. A missing secret can weaken token
integrity across the whole API.

Suggested fix:

Read and validate `JWT_SECRET` during startup, not silently in package `init`.
Fail fast if empty or below a minimum length.

## 6. WebSocket URL Is Hardcoded To `wss://localhost`

Severity: Medium

Evidence:

- `frontend/src/hooks/useWebSocket.ts:14` creates:
  `new WebSocket("wss://localhost/api/v1/ws?token=${token}")`.

Why this is a bug:

The WebSocket connection ignores the current host, protocol, port, and
deployment config.

How to trigger:

1. Run the frontend somewhere other than `https://localhost`, for example:
   `http://localhost:3000`, a LAN IP, or a deployed domain.
2. Login.
3. Open chat or any component depending on online status.
4. Check browser devtools network/console.

Expected result:

The frontend should connect to the matching backend WebSocket endpoint for the
current deployment.

Actual result:

It always attempts `wss://localhost/api/v1/ws`, which can fail on HTTP dev,
remote hosts, non-local domains, and custom ports.

Impact:

Realtime chat and online status break outside the exact local HTTPS/nginx setup.

Suggested fix:

Build the WebSocket URL from `window.location`:

- `wss` when `window.location.protocol === "https:"`
- `ws` when `window.location.protocol === "http:"`
- host from `window.location.host`

Or centralize it in a `NEXT_PUBLIC_WS_URL` config.

## 7. WebSocket Writer Can Concatenate Multiple JSON Messages Into One Frame

Severity: Medium

Evidence:

- `backend/modules/user/chat/hub.go:230` opens one text writer.
- `backend/modules/user/chat/hub.go:234` writes the first JSON payload.
- `backend/modules/user/chat/hub.go:236` drains queued messages.
- `backend/modules/user/chat/hub.go:238` writes additional JSON payloads into
  the same frame without separators.
- `frontend/src/hooks/useWebSocket.ts:31` expects each `event.data` to be one
  JSON object and calls `JSON.parse(event.data)`.

Why this is a bug:

If multiple messages are queued, the server can send one frame like:

```text
{"type":"private_message",...}{"type":"user_online",...}
```

That is not valid JSON.

How to trigger:

1. Login as multiple users.
2. Create enough chat/online events quickly so more than one message queues for
   the same client before `writePump` flushes.
3. Watch browser console for:

```text
Failed to parse WS message
```

Expected result:

Each WebSocket event should be parseable as one JSON message, or the frontend
should handle a documented batch format.

Actual result:

Multiple JSON objects can be concatenated into one unparseable WebSocket frame.

Impact:

Realtime chat and online status can miss messages under bursty conditions.

Suggested fix:

Send one WebSocket message per queued payload, or wrap queued payloads in a JSON
array and update the frontend parser accordingly.

## 8. Profile Email/Phone OTP Is Enforced Only In Frontend Flow

Severity: Medium

Evidence:

- `frontend/src/app/(user)/profile/page.tsx:110` verifies OTP.
- After OTP success, the frontend routes to `/profile/change-email` or
  `/profile/change-phoneNo`.
- `frontend/src/app/(user)/profile/change-email/page.tsx:28` directly calls
  `/api/v1/users/update` with only JWT auth.
- `frontend/src/app/(user)/profile/change-phoneNo/page.tsx:28` does the same.
- `backend/modules/user/profile/handler.go:59` updates profile fields after JWT
  auth only.

Why this is a bug:

The OTP check is a navigation flow, not a backend authorization requirement.
A user can skip the OTP page and call the update endpoint directly.

How to trigger:

1. Login as a user.
2. Do not complete OTP.
3. Directly open:

```text
https://localhost/profile/change-email
```

or send:

```bash
curl -k -X PUT https://localhost/api/v1/users/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"email":"new-email@example.com"}'
```

Expected result:

Changing email or phone should require a server-verified OTP challenge.

Actual result:

The backend accepts the update with JWT auth only.

Impact:

If a session token is compromised, email/phone changes do not get the intended
extra OTP protection. The UI suggests stronger security than the backend
actually enforces.

Suggested fix:

Create dedicated backend endpoints for email/phone changes that require a valid
recent OTP verification token or challenge ID. Do not allow generic
`/users/update` to modify sensitive contact fields without that proof.

## 9. Checkout Button Has No Behavior And No Order Creation Route

Severity: Low

Evidence:

- `frontend/src/app/(user)/cart/page.tsx:71` renders a Checkout button with no
  `onClick`.
- `backend/main.go:65` and `backend/main.go:66` register only `GET /orders` and
  `GET /orders/:id`.
- `backend/orders.go` contains read handlers only.
- `db/init.sql:108` defines an `orders` table, but no create path uses it.

Why this is a bug:

Cart checkout appears available to users, but it does not create an order or
navigate to a checkout page.

How to trigger:

1. Open a product page.
2. Click "Add to Cart".
3. Go to `/cart`.
4. Click "Checkout".

Expected result:

The app should create an order, start a checkout flow, or clearly show that
checkout is not implemented.

Actual result:

The button does nothing.

Impact:

Users cannot buy items through the cart despite the UI implying they can.

Suggested fix:

Either implement order creation and checkout, or disable/hide the button with a
clear "coming soon" state.

## Validation Notes

Commands run during the scan:

```bash
cd frontend
npm run build
```

Result: passed.

```bash
cd ai_service
python3 -m py_compile main.py rag.py embeddings.py agent.py tools.py recommender.py
```

Result: passed.

```bash
cd backend
go test ./...
```

Result: not run successfully because `go` is not installed in this environment.

```bash
cd frontend
npm run lint
```

Result: did not complete because `next lint` prompted for interactive ESLint
setup.
