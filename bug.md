# Bug Findings

Date: 2026-07-07
Last checked: 2026-07-09

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

Static re-check on 2026-07-09 found that bugs 1-8 still existed in the current
code. Bugs 1, 2, 3, 4, and 5 have since been fixed. Bugs 6, 7, and 8 are
intentionally deferred for now. Bug 9 is no longer current because
checkout/order creation has since been implemented.

| Rank | Severity | Status | Difficulty | Bug | Main Area |
| --- | --- | --- | --- | --- | --- |
| 1 | High | Fixed | Simple | Listing creation can spoof another seller | Backend auth / products |
| 2 | High | Fixed | Very simple | Login scans user columns in the wrong order | Backend auth / repository |
| 3 | High | Fixed | Medium / complicated | AI authenticated tools still use old `token_<id>` auth | Backend AI proxy / AI service |
| 4 | High | Fixed | Simple | Uploaded `/static/...` files are not proxied by nginx | Backend static files / nginx |
| 5 | Medium | Fixed | Simple | Missing `JWT_SECRET` is silently accepted | Backend auth config |
| 6 | Medium | Deferred | Simple | WebSocket URL is hardcoded to `wss://localhost` | Frontend chat |
| 7 | Medium | Deferred | Simple / medium | WebSocket writer can concatenate multiple JSON messages into one frame | Backend chat |
| 8 | Medium | Deferred | Complicated | Profile email/phone OTP is enforced only in frontend flow | Profile security |
| 9 | Low | Fixed / no longer current | Done | Checkout button has no behavior and there is no order creation route | Cart/orders |

## Suggested Fix Order

No active fix is currently selected. Bugs 6, 7, and 8 are deferred.

Deferred:

- Fix WebSocket URL (`#6`): current MVP demo setup works; revisit before
  deployment or broader non-local network testing.
- Fix WebSocket writer batching (`#7`): rare/timing-based chat reliability bug;
  deferred for now. Ask Mohammad to review this later.
- Enforce OTP on backend for email/phone updates (`#8`): larger security flow
  change; intentionally deferred for now.

## 1. Listing Creation Can Spoof Another Seller

Severity: High
Status: Fixed
Difficulty: Simple

Fixed on 2026-07-09:

- `backend/products.go` now reads the seller ID from `c.Get("userId")`, which
  is set by JWT middleware, instead of using `sellerId` from the request body.
- `backend/products.go` now fetches the seller name from the `users` table.
- `frontend/src/app/(user)/sell/page.tsx` no longer sends `sellerId` or
  `sellerName` when creating a listing.

Current evidence:

- `backend/products.go:48` no longer accepts `sellerId` or `sellerName` in
  `CreateProductRequest`.
- `backend/products.go:329` reads `sellerID` from `c.Get("userId")`.
- `backend/products.go:348` fetches the seller name from the `users` table.
- `backend/products.go:389` inserts the authenticated `sellerID`.
- `frontend/src/app/(user)/sell/page.tsx:266` creates listings without sending
  `sellerId` or `sellerName`.

Why this was a bug:

The route was protected by JWT middleware, but the authenticated user ID was not
used when creating the listing. Any authenticated user could alter the JSON body
and create an ad that belonged to a different user ID.

Original trigger before fix:

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

Expected/current result:

The backend should ignore `sellerId` from the request body and use the
authenticated JWT user ID.

Fixed result:

The backend inserts the seller ID from the authenticated JWT context. A forged
`sellerId` in the request body is ignored.

Impact:

Users can impersonate other sellers, pollute another seller's profile, and
create moderation/accountability problems.

Implemented fix:

In `createProduct`, read `userID := c.Get("userId").(int)` and use that as the
seller ID. Fetch seller name from the users table or trust only server-side user
data.

## 2. Login Scans User Columns In The Wrong Order

Severity: High
Status: Fixed
Difficulty: Very simple

Fixed on 2026-07-09:

- `backend/modules/user/repository.go` now selects login columns in the same
  order that `Scan` expects: `phone_no`, `date_of_birth`, `gender`,
  `avatar_url`, then avatar/bio/2FA metadata.

Current evidence:

- `backend/modules/user/repository.go:41` selects:
  `phone_no, date_of_birth, gender, avatar_url, avatar_data,
  avatar_mime_type, bio, requires_2fa, created_at`.
- `backend/modules/user/repository.go:43` scans those fields into:
  `PhoneNo, DateOfBirth, Gender, avatarURL, avatarData, avatarMime, bio,
  Requires2FA, CreatedAt`.

Why this was a bug:

The selected columns and scan destinations did not match. For example,
`avatar_url` was scanned into `PhoneNo`, `phone_no` was scanned into
`DateOfBirth`, and `gender` was scanned into `avatarURL`.

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

Expected/current result:

Login should compare the password and return a valid user object.

Fixed result:

The SQL scan receives each value in the matching destination field, so populated
profile fields no longer corrupt the login user object.

Original impact:

Login could fail for users with profile fields populated, especially phone
number or date of birth. Returned profile data could also be wrong.

Implemented fix:

The SELECT order now matches the Scan order. A future regression test should
cover login for users with `phone_no`, `date_of_birth`, `gender`, and
`avatar_url`.

## 3. AI Authenticated Tools Still Use Old `token_<id>` Auth

Severity: High
Status: Fixed
Difficulty: Medium / complicated

Fixed on 2026-07-09:

- `frontend/src/components/AIFloatingChat/AIFloatingChat.tsx` no longer falls
  back to a fake `token_<id>` value.
- `backend/ai_chat.go` now validates an optional real JWT when the frontend
  sends an `Authorization` header.
- `backend/ai_chat.go` forwards the verified user ID and real JWT to the Python
  AI service.
- `ai_service/main.py` stores the forwarded JWT in request context.
- `ai_service/tools.py` uses the forwarded real JWT for protected backend calls
  instead of synthesizing `Bearer token_<uid>`.

Current evidence:

- `frontend/src/components/AIFloatingChat/AIFloatingChat.tsx:122` reads only
  the real token from local storage.
- `backend/ai_chat.go:29` validates optional JWT auth for AI requests.
- `backend/ai_chat.go:68` forwards the verified token to the AI service.
- `ai_service/main.py:60` accepts the forwarded `authToken`.
- `ai_service/tools.py:274` reads the forwarded token when building backend
  auth headers.

Why this was a bug:

The main application migrated to JWTs, but the AI proxy and AI service tools
still used the old demo token format. As a result, logged-in AI requests could
be treated as anonymous by the Go proxy, and protected backend calls from the AI
service could be rejected.

How to trigger:

1. Login as a real user.
2. Open the RacketBot floating chat.
3. Ask a protected question such as:
   "Show my profile" or "Show my orders".
4. Observe that the request does not authenticate correctly.

Expected/current result:

The AI proxy should validate the JWT and forward a valid auth context to the AI
service or protected backend calls.

Fixed result:

The proxy validates a real JWT if one is supplied, keeps guest AI chat available
without auth, and lets the AI service reuse the real JWT for protected backend
calls.

Follow-up check on 2026-07-09:

- The "what is my username?" symptom still appeared because the OpenRouter
  provider returned HTTP 429 before the agent could choose a tool.
- `ai_service/main.py` now falls back to the protected profile/order tools for
  private profile/order questions when the LLM provider fails.
- Anonymous tests now return "You must be logged in..." instead of the generic
  capability message. Logged-in browser requests should use the real forwarded
  JWT and return that user's own profile/orders.

Original impact:

AI profile/order features could be broken for real logged-in users. This also
created confusing duplicate auth behavior in the codebase.

Implemented fix:

Replace `extractUserID` with JWT validation or reuse `myMiddleware.JWTAuth()` on
AI routes that need auth. Do not synthesize `Bearer token_<id>` in the AI
service. Forward the user's real JWT where needed, or expose server-side
internal endpoints with explicit service auth.

## 4. Uploaded `/static/...` Files Are Not Proxied By Nginx

Severity: High
Status: Fixed
Difficulty: Simple

Fixed on 2026-07-09:

- `nginx/conf/default.conf` now routes `/static/` requests to the backend.
- `backend/Dockerfile` now creates both `/app/static/avatars` and
  `/app/static/listings`.

Current evidence:

- `backend/main.go:103` serves `e.Static("/static", "static")`.
- `backend/products.go:581` returns listing image URLs like
  `/static/listings/<file>`.
- `backend/modules/user/profile/service.go:62` returns avatar URLs like
  `/static/avatars/<file>`.
- `nginx/conf/default.conf:36` proxies `/api/` to backend.
- `nginx/conf/default.conf:56` proxies `/uploads/`.
- `nginx/conf/default.conf:63` proxies `/avatars/`.
- `nginx/conf/default.conf:70` proxies `/static/` to backend.
- `backend/Dockerfile:33` creates both static upload directories.

Why this was a bug:

When users access the app through nginx at `https://localhost`, browser requests
for `/static/listings/...` and `/static/avatars/...` went to the frontend
upstream, not the backend static file server.

Original trigger before fix:

1. Start the app through Docker/nginx.
2. Login and upload a listing photo or profile avatar.
3. Open the returned image URL, for example:

```text
https://localhost/static/listings/<listing_id>_0.jpg
```

Expected/current result:

The uploaded image should be served by the backend.

Fixed result:

The request is routed to the backend through the new `/static/` nginx location.

Original impact:

Uploaded avatars and listing images could disappear from the UI in the normal
nginx deployment path.

Implemented fix:

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
Status: Fixed
Difficulty: Simple

Fixed on 2026-07-09:

- `backend/modules/user/auth/service.go` now validates `JWT_SECRET` through
  `ConfigureJWTSecretFromEnv`.
- `backend/main.go` now fails startup if the auth configuration is invalid.
- Token generation and validation now also reject an unconfigured or too-short
  JWT secret.

Current evidence:

- `backend/modules/user/auth/service.go:28` defines a minimum secret length.
- `backend/modules/user/auth/service.go:34` rejects an empty `JWT_SECRET`.
- `backend/modules/user/auth/service.go:37` rejects a short `JWT_SECRET`.
- `backend/main.go:26` calls the validation before initializing services.

Why this was a bug:

If `JWT_SECRET` was missing, tokens could be signed and validated with an empty
secret. That was an insecure configuration and could be hard to notice.

Original trigger before fix:

1. Start backend without `JWT_SECRET` in `.env`.
2. Login successfully.
3. Backend still issues a JWT.

Expected/current result:

The backend should fail startup with a clear error if `JWT_SECRET` is empty or
too weak.

Fixed result:

The backend exits during startup with a clear auth configuration error.

Original impact:

Auth security depended on environment setup. A missing secret could weaken token
integrity across the whole API.

Implemented fix:

Read and validate `JWT_SECRET` during startup. Fail fast if empty or below the
minimum length.

## 6. WebSocket URL Is Hardcoded To `wss://localhost`

Severity: Medium
Status: Deferred
Difficulty: Simple

Deferred on 2026-07-09:

- Current MVP demo setup works with the existing localhost/nginx flow.
- Revisit before deployment, LAN/IP-based demos, tunnels, or any setup where the
  browser opens the app from a host other than `localhost`.

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
Status: Deferred
Difficulty: Simple / medium

Deferred on 2026-07-09:

- This is a rare/timing-based realtime chat reliability bug and is hard to
  trigger manually.
- Current MVP priority is higher-impact issues.
- Ask Mohammad to review this WebSocket writer behavior later.

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
Status: Deferred
Difficulty: Complicated

Deferred on 2026-07-09:

- This is a larger backend security flow change.
- Intentionally deferred for now.

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
Status: Fixed / no longer current
Difficulty: Done

Current verification:

Static re-check on 2026-07-09 shows this finding is no longer current.

Evidence:

- `frontend/src/app/(user)/cart/page.tsx:43` defines `handleCheckout`.
- `frontend/src/app/(user)/cart/page.tsx:58` posts checkout requests to
  `/api/v1/orders`.
- `frontend/src/app/(user)/cart/page.tsx:234` wires the Checkout button to
  `handleCheckout`.
- `backend/main.go:65` registers `POST /orders`.
- `backend/orders.go:52` implements `createOrders`.

Current behavior from code inspection:

The cart now sends checkout items to the backend, and the backend creates orders
transactionally, validates stock, prevents users from buying their own listing,
and updates listing stock/status.

Remaining optional check:

Run the app and test checkout through the browser to confirm the full flow works
with live database seed data, cart state, and nginx routing.

## Validation Notes

Commands run after fixing bugs 1, 2, 3, 4, and 5:

```bash
cd frontend
npm run build
```

Result: passed after bug 1 and bug 3 frontend cleanup.

```bash
cd ai_service
python3 -m py_compile main.py tools.py
```

Result: passed after bug 3 AI auth changes.

```bash
git diff --check
docker compose config
```

Result: passed after bug 4 nginx/Dockerfile changes and bug 5 startup config
changes.

```bash
cd backend
go test ./...
```

Result: not run successfully because `go` is not installed in this environment.

```bash
nginx -t
```

Result: not run because `nginx` is not installed in this environment.

Commands run during the 2026-07-09 static re-check:

```bash
git status --short
sed -n '1,240p' bug.md
sed -n '241,520p' bug.md
rg -n "sellerId|sellerID|SellerID|createProduct|POST\\(\\\"/products\\\"|JWT_SECRET|token_<|wss://localhost|NextWriter|/static/|/api/v1/orders|handleCheckout|users/update|POST\\(\\\"/orders\\\"" backend frontend ai_service nginx -S
```

Result: documentation-only re-check. No application build, backend test, or
browser runtime reproduction was run for this update.

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
