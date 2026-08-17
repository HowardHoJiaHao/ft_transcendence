# AGENTS.md

Working notes for humans and coding agents on **Racketdiction Marketplace** (`ft_transcendence`).

This is a 42-curriculum “Surprise” project: a real badminton / racket marketplace, not a Pong clone. The product name in the UI and AI prompt is **RacketDiction**. Prices are **Malaysian Ringgit (RM)**.

---

## What this project is

Buyers browse second-hand rackets and gear, chat with sellers, check out (meetup or Stripe), and use **RacketBot** (RAG + tools + an ML spec predictor). Sellers list items, attach files, import CSV, fulfill orders, and see a dashboard. Admins/moderators manage users. A public developer API is keyed and rate-limited.

Curriculum modules this stack is built to satisfy: web frameworks, real-time (WebSockets), user management, cybersecurity / WAF, AI, DevOps / observability, data/analytics, accessibility (i18n).

Team (from README): hwai-keo (PO, AI + seller), mbani-ya (PM, buyer + security), hho-jia- (tech lead, dashboard + public API + i18n), muhabin- and abin-moh (DevOps / architecture).

---

## Request path (always)

```
browser
  → WAF (OWASP CRS + ModSecurity)     published ports: 8088 HTTP / 8443 HTTPS
  → nginx (internal, :8081)           routes /api* and WS to backend, else frontend
  → frontend :3000  |  backend :8080
                      → PostgreSQL + pgvector :5432
                      → FastAPI AI :8000  (RacketBot only)
```

- Only the **WAF** publishes host ports for the app. Backend, frontend, nginx, and AI are on the compose network.
- Observability UIs (Grafana, Prometheus, Loki, Alertmanager, cAdvisor) bind **127.0.0.1** only.
- Local TLS is self-signed. Use `https://localhost:8443` (`WAF_HTTPS_PORT`) and `-k` with curl.
- HTTP on `8088` should redirect to HTTPS.
- Rootless Docker cannot bind ports &lt; 1024; do not assume `:443`.

Frontend API calls are **same-origin** through the WAF. `NEXT_PUBLIC_API_URL` defaults to empty on purpose. Do not point the browser at `backend:8080`.

---

## Directory map

| Path | Role |
|---|---|
| `frontend/` | Next.js 15 App Router, React 19, TypeScript, Tailwind v4 |
| `backend/` | Go 1.25 + Echo. Marketplace, auth, orders, Stripe, admin, AI proxy |
| `backend/modules/user/` | Auth, profile, friends, chat hub, notifications |
| `backend/myMiddleware/` | JWT and API-key middleware |
| `ai_service/` | FastAPI RacketBot: agent, tools, RAG, recommender, training worker |
| `ai_service/faq_docs/` | Markdown knowledge ingested into `knowledge_chunks` |
| `db/init.sql` | Schema + seed. Source of truth for a **fresh** volume |
| `db/SCHEMA.md` | Column-level notes, including unused tables |
| `nginx/` | Internal reverse proxy |
| `waf/racketbot-before.conf` | Narrow CRS exclusions (RacketBot history + Google OAuth `scope`) |
| `monitoring/` | Prometheus, Grafana, Loki, Promtail, Alertmanager, blackbox |
| `backup/` | Scheduled `pg_dump` |
| `storage/` | Host bind for listing files + avatars (`./storage` → `/app/storage`) |
| `docs/AI/` | Recommender PRD, dummy CSV, Colab trainer |
| `API_DOCUMENTATION.md` | Public key API + internal JWT API |
| `scripts/` | Infisical injection, Stripe demo setup, WAF tests |
| `Makefile` | How humans start the stack |

---

## Backend (Go)

Module name: `transcendence`. Entrypoint: `backend/main.go`.

Two HTTP surfaces:

1. **Internal (browser)** — `/api/v1/...`, JWT `Authorization: Bearer`.
2. **Public developer API** — `/api/public/v1/products` CRUD, `X-API-Key`, rate limit (default 100/min), audit log. Scoped to the key owner. Bulk CSV import is **not** on this surface; it stays on `POST /api/v1/products/import`.

Notable routes (not exhaustive):

- Public: products list/detail, files content, reviews, `POST /api/v1/ai/chat`, Stripe webhook, `/health`, `/metrics`.
- JWT: product write, file upload, orders, seller dashboard, API keys, reviews, recommendation survey.
- User module registers auth, profile, friends, chat (`/api/v1/ws`), notifications, admin.

Auth details that bite:

- JWT secret comes from env (`JWT_SECRET`); process refuses to start if it is invalid.
- RacketBot is public, but if a Bearer token is sent it must be a valid **member** token. Admin tokens get 403 on that path.
- Roles: `user` / `moderator` / `admin`. Account status: `active` / `suspended` / `deleted`.
- `otps` is created by GORM `AutoMigrate`, not by `db/init.sql`.
- Google OAuth callback needs the WAF exclusion for `scope`.

Uploads:

- Files live under `storage/listings` and `storage/avatars`.
- Metadata in `listing_files`. Bytes are **not** served as a directory listing.
- Content goes out through `/api/v1/files/:fileId/content` and `/api/v1/users/:id/avatar`.
- Caps: 6 images (10 MB) + 2 PDFs (5 MB) per listing; request body up to 72 MB (matches WAF).
- `listing_images` is effectively unused; do not add new code that writes only there.

ORM: GORM + pgx. Some paths still use `*sql.DB`. `backend/db.go` applies extra migrations on existing volumes (e.g. `stock_quantity`, `orders.payment_id`, listing status values). Changing `init.sql` does **not** migrate an already-initialized `postgres_data` volume.

---

## Domain rules (easy to get wrong)

**Listings** are single second-hand lots, not an infinite catalog.

- Checkout requires buying the **whole remaining lot** (`quantity` must equal `stock_quantity`).
- Status: `active` / `pending` / `sold` / `archived`. `pending` = reserved at checkout; `sold` after seller confirms.
- Dashboard may still *display* `pending` if a non-archived listing has a pending order.

**Orders** are **one row per listing**, not one row per cart.

- `POST /api/v1/orders` loops items. Three cart lines → three `orders.id` values.
- Meetup carts may mix sellers. Each seller only sees their own rows.
- Stripe lines that belong to one checkout share `payment_id`.
- Meetup: `payment_method=meetup`, `payment_id` null.
- Seller marks complete with `PUT /orders/:id/complete`. Only `completed` counts as dashboard revenue.

**Payments** are Stripe Connect destination charges + a platform fee. Webhook events are idempotent via `stripe_webhook_events`. Local forwarding is the `stripe-cli` compose profile (`make setup` / `make up`).

---

## Frontend (Next.js)

App Router under `frontend/src/app/`.

- `/` — marketplace home
- `/products/[id]` — listing
- `/(user)/login`, `/cart`, `/chat`, `/friends`, `/sell`, `/profile/*`, `/user/[id]`
- `/admin/login`, `/admin/users`
- `/privacy`, `/terms`

Shared state: `AuthContext`, `CartContext`, `LanguageContext`, `NotificationContext`, `WebSocketContext`. One authenticated WebSocket carries chat **and** notifications (no second socket).

i18n: `frontend/src/i18n/messages/{en,ms,zh}.json`. `en.json` is the reference. New UI strings must be added to **all three** files. Keep `{placeholders}`. See `frontend/TRANSLATION_GUIDE.md`.

RacketBot UI: `frontend/src/components/AIFloatingChat/`. Guided “Recommend Me a Racket” assessment collects a structured profile and posts it with the chat request.

---

## AI service (Python)

Container: `ai` (`ai_service/Dockerfile`, context = repo root). FastAPI in `ai_service/main.py`.

```
Browser → POST /api/v1/ai/chat (Go proxy, optional JWT)
       → POST http://ai:8000/chat  (SSE)
```

- DeepSeek: chat / tool calling (`DEEPSEEK_*`).
- OpenRouter: embeddings (`OPENROUTER_*`).
- History sent to the model is the last **10** messages. WAF exclusions exist for those JSON field names — if you lengthen history, update `waf/racketbot-before.conf` or CRS will 403.

Tools (`ai_service/tools.py`) are **read-only**. They call the Go backend with the forwarded JWT:

- Public: `search_listings`, `get_listing_detail`, `get_seller_profile`, `get_seller_listings`, `retrieve_knowledge`
- Authed: `get_my_profile`, `get_my_orders`, `get_order_detail`
- ML: `predict_racket_specs` (only after a completed assessment)

RacketBot must **not** create listings, change orders, or act as a seller. The system prompt in `ai_service/agent.py` is the contract.

Recommender: MultiOutput Random Forest in `ai_service/ml_models/` (seed copied to `/app/model_seed`). Predicts **specs** (`weight` / `flexibility` / `balance`), not listing IDs. Live inventory is searched afterward. Runtime models persist in the `recommender_models` named volume. Training worker + tables: `recommendation_training_feedback`, `ml_training_runs`.

RAG: `faq_docs/` → embeddings in `knowledge_chunks` (pgvector) + generated `search_vector`. Ingest runs on startup unless `RAG_INGEST_ON_STARTUP` is off.

---

## Database

PostgreSQL 15 + **pgvector**. Almost everything FKs to `users`.

Groups: identity, marketplace (`listings`, files, reviews), transactions (`orders`, `payments`, webhooks), social (friends, messages, notifications), developer API keys, AI/ML (feedback, training runs, knowledge).

Authoritative fresh schema: `db/init.sql`. Human notes: `db/SCHEMA.md`. Live columns: `make db-connect` then `\d+ <table>`.

---

## DevOps, secrets, volumes

**Start the stack with Make, not raw compose**, so Infisical secrets are injected:

```
make infisical-auth-init    # once; edit .env.infisical-auth (mode 600, never commit)
make setup                  # build + up + Stripe webhook helper
make up / make restart / make down
make logs / make logs-waf / make logs-stripe
make health-check / make test-waf
make db-connect
```

App URL: `https://localhost:8443`. Grafana: `http://127.0.0.1:3001`.

Secrets come from Infisical Cloud via `scripts/with-infisical-env.sh`. There should be no committed `.env` with real keys.

**Bind mounts (keep):** read-only monitoring/WAF/DB-init config; `./storage` and `./backups`; cAdvisor/Promtail host paths.

**Named volumes (keep):** `postgres_data`, `recommender_models`, `prometheus_data`, `alertmanager_data`, `grafana_data`, `loki_data`, `backup_metrics`.

**Do not bind-mount app source** (`./backend`, `./frontend`, `./ai_service`) into running services. Code is `COPY`’d into images.

**Do not bind-mount** `monitoring/alertmanager/discord_webhook_bridge.py` as if it were config — that is application code; bake it with `COPY`.

Do not give `backend` / `frontend` / `ai` / `nginx` the Docker socket or host `/`.

---

## Tests and CI

`.github/workflows/ci.yml` on push/PR:

| Job | Command |
|---|---|
| Frontend | `cd frontend && npm ci && npm test && npm run build` (Node 22.22.2, Vitest) |
| Backend | `gofmt -l .`, `go mod verify`, `go vet ./...`, `go test -race ./...`, `go build -mod=readonly` |
| AI | `pip install -r requirements.txt`, `compileall`, `python -m unittest discover -s tests -v` |
| Database | apply `db/init.sql` on `pgvector/pgvector:pg15`, assert tables/columns/indexes/seed |
| Backend smoke | live `/health`, products, metrics, 401 on protected routes, admin login |
| Containers | compose config, bring up db/backend/frontend/nginx/waf, HTTPS + WAF SQLi/XSS 403 |

Match that locally before claiming a change is done.

---

## Conventions for changes

- Keep the WAF in front. New public routes must survive CRS or get a **narrow** exclusion in `waf/racketbot-before.conf`, not a global rule-off.
- Prefer handlers that decide what to serve over exposing directories.
- Listing file paths must stay generated names (`storage_name`), never the uploader’s filename as a path.
- New user-facing strings: update `en.json`, `ms.json`, and `zh.json`.
- Schema: edit `db/init.sql` **and** any `backend/db.go` migration needed for existing volumes; update `db/SCHEMA.md` if the meaning of a column changes.
- Do not invent marketplace data in RacketBot; tools must hit the backend.
- Do not log or commit secrets, Infisical tokens, or Stripe `whsec_` values (`make logs` already redacts webhook secrets).
- Destructive Make targets: `clean`, `prune`, `reset` — do not run unless the user asked.

---

## What not to assume

- This is **not** the classic 42 Pong/ft_transcendence game. There is no game server.
- `listing_images` existing in SQL does not mean the app uses it.
- One checkout ≠ one `orders` row.
- A rebuilt image does not wipe named volumes. `init.sql` runs only on first Postgres init.
- Frontend Docker build compiles `NEXT_PUBLIC_*` in; empty API URL is intentional.
- Admin JWT is not a member JWT for RacketBot or buyer order routes.
