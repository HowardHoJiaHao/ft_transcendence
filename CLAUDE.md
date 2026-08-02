# Transcendence

42 School project: a badminton/racket marketplace. Browse and list products, cart
and orders, seller analytics and fulfillment, bulk CSV listing import, friends and
WebSocket chat, JWT + OTP + Google OAuth auth, admin account controls, a developer
API with API keys, and RacketBot — an AI assistant (RAG + tool calling).

`AGENTS.md` is the long-form agent guide (coding conventions per subsystem,
security boundaries, validation rules). Read it before non-trivial changes; this
file is the short orientation.

**Stale docs:** the root `README.md`, `ARCHITECTURE.md`, `PROJECT_SUMMARY.md`,
`DEVELOPMENT.md`, `DOCKER_GUIDE.md`, `FILE_STRUCTURE.md`, `INDEX.md`,
`00_START_HERE.md`, and `SETUP_COMPLETE.md` describe an early scaffold (MySQL,
no AI service, no nginx/WAF). Trust `docker-compose.yml`, `Makefile`,
`db/init.sql`, and the code over them.

## Architecture

Request path: **WAF → internal nginx → frontend / backend**. Only the WAF
publishes application ports; everything else is `expose`d on the Compose network
or bound to loopback.

Application services (`docker-compose.yml`):

- **waf** — public entry point: nginx + ModSecurity + OWASP CRS, host ports
  `${WAF_HTTP_PORT:-8088}` / `${WAF_HTTPS_PORT:-8443}`, forces HTTPS
- **nginx** — internal reverse proxy on `8081`, routes to frontend + backend
- **frontend** — Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4, `3000`
- **backend** — Go 1.25 + Echo, `8080`, PostgreSQL via pgx + GORM
- **ai** — Python FastAPI + LangChain/LangGraph, `8000`; DeepSeek for chat/tool
  calling, OpenRouter for RAG embeddings
- **db** — PostgreSQL 15 + pgvector, `127.0.0.1:5432`

Ops services (all loopback-bound): **prometheus** `9090`, **grafana** `3001`,
**alertmanager** `9093` (+ **discord-webhook-relay** `5001`), **loki** `3100` /
**promtail** for logs, **node-exporter** `9100`, **cadvisor** `8081`,
**postgres-exporter** `9187`, **blackbox-exporter** `9115`, and **db-backup**
(scheduled `pg_dump` with retention + a textfile metric).

Backend exposes `/health` (real backend→DB check) and `/metrics` (Prometheus).

## Repo layout

- `backend/main.go` — route registration and module wiring
- `backend/*.go` — marketplace and platform handlers at package root:
  `products.go`, `products_import.go`, `orders.go`, `seller_dashboard.go`,
  `admin.go`, `api_keys.go`, `ai_chat.go` (AI proxy + authorization boundary),
  `db.go` (connection + idempotent startup migrations)
- `backend/modules/user/{auth,profile,friends,chat}/` — `handler.go` /
  `service.go` / `repository.go` / `models.go` (chat also has `hub.go`)
- `backend/myMiddleware/` — `auth.go` (JWT), `apikey.go` (`X-API-Key` + rate limit)
- Route groups: `/api/v1` public reads, `/api/v1` JWT-protected, `/api/v1/admin`
  (separate admin auth), `/api/public/v1` (developer API, API-key auth + logging)
- `frontend/src/app/(user)/...` — login, auth/callback, chat, friends, sell, cart,
  user/[id], profile (+ change-email/password/phoneNo, developer-api, my-ads,
  my-ads/import)
- `frontend/src/app/admin/{login,users}`, `frontend/src/app/products/[id]`
- `frontend/src/context/` — Auth, Cart, Language, WebSocket; `hooks/`, `lib/csv.ts`,
  `types/`, `i18n/messages/{en,ms,zh}.json`
- `frontend/src/__tests__/` — Vitest + Testing Library
- `ai_service/` — `main.py` (FastAPI), `agent.py`, `tools.py` (read-only,
  request-scoped auth), `rag.py`, `embeddings.py`, `recommender.py`,
  `faq_docs/`, `ml_models/`, `tests/`; PRD markdown files also live here
- `nginx/conf/`, `waf/racketbot-before.conf` (narrow CRS exclusions)
- `monitoring/{prometheus,alertmanager,grafana,loki,promtail}/` — mounted read-only
- `backup/` — dump/restore/retention scripts; `scripts/` — Infisical + WAF test helpers
- `db/init.sql` — schema + seed data
- `docs/` — PRDs and notes for in-flight features
- `rubbish/` — abandoned/duplicate drafts (old auth, avatar, 2FA) — not in use,
  don't resurrect without checking with the user

## Commands

`make setup` / `up` / `restart` / `reset` inject secrets via the Dockerized
Infisical CLI (needs `.infisical.json` + a local `.env.infisical-auth` holding
`INFISICAL_TOKEN`). Read-only commands don't need Infisical.

```bash
make setup              # build + start the full stack with fresh secrets
make up / down / restart / ps
make build              # build images only, no secrets needed
make logs / logs-waf / logs-backend / logs-frontend / logs-db
make shell-backend / shell-frontend / shell-db
make db-connect         # psql into the db container
make db-migrate         # apply db/init.sql to the running database
make health-check       # WAF + backend through HTTPS
make test-waf           # normal, redirect, SQLi, XSS checks
make check-secrets / infisical-auth-init / infisical-auth-check / infisical-auth-clear
make clean / reset      # DESTRUCTIVE: removes containers and the DB volume — ask first
```

App URL once up: `https://localhost:8443` (self-signed; `curl -k`).

## Validation

Run the narrowest relevant checks; `.github/workflows/ci.yml` runs all of them.

```bash
cd frontend && npm test && npm run build     # Vitest, then prod build = type check
cd backend  && gofmt -l . && go vet ./... && go test -race ./... && go build -mod=readonly ./...
cd ai_service && python -m pip check && python -m compileall -q . && python -m unittest discover -s tests
docker compose config --quiet                # then make up && make health-check && make test-waf
```

CI additionally applies `db/init.sql` to a fresh pgvector database and asserts the
schema, runs a backend API smoke test, and boots the container stack to verify
routing, auth gates, and WAF blocking. Tests must stay local and deterministic —
no live DeepSeek, OpenRouter, Google, Brevo, Infisical, or Discord calls.

## Conventions worth knowing up front

- Frontend styling is Tailwind v4 (`globals.css`); the CSS-modules migration is
  done — don't add `.module.css` files.
- Prefer same-origin `/api/...` calls so traffic passes through WAF + nginx.
- Localize user-facing copy in `i18n/messages/` — update **all three** locales.
- The Go backend is the authorization boundary for AI requests; never let a
  model-supplied user ID become an auth source in `ai_service`.
- Schema changes must work on both a fresh `db/init.sql` and an existing volume
  (see the startup migrations in `backend/db.go`).
- Keep `.env`, `uploads/`, `avatar/`, `static/`, and backup artifacts out of commits.
