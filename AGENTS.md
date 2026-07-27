# AGENTS.md

## Project Overview

This is a full-stack marketplace app for badminton/racket listings.

Main services:
- `frontend/`: Next.js app using React, TypeScript, App Router, and CSS modules.
- `backend/`: Go Echo API server using PostgreSQL through pgx/GORM.
- `ai_service/`: FastAPI RacketBot service using LangChain/LangGraph, DeepSeek
  for chat and tool calling, OpenRouter for RAG embeddings, PostgreSQL, and
  pgvector.
- `db/`: PostgreSQL schema and seed data.
- `nginx/`: Internal reverse proxy for frontend/backend routing on port `8081`.
- `waf` Compose service: public Nginx, ModSecurity, and OWASP CRS entry point.
- `monitoring/`: Prometheus, Alertmanager, Grafana, Loki, Promtail, blackbox
  probes, exporters, dashboards, and a Discord alert relay.
- `backup/`: Scheduled PostgreSQL dumps, retention, and backup metrics.
- `docker-compose.yml`: Main local orchestration.

The active database is PostgreSQL with pgvector, not MySQL. Some older docs still mention MySQL; prefer `docker-compose.yml`, `Makefile`, `db/init.sql`, and source code as the source of truth.

Active product areas include authentication (password, OTP, and Google OAuth),
profiles and avatars, friends and WebSocket chat, marketplace listings and image
uploads, cart/orders, seller analytics and fulfillment, bulk CSV listing imports,
administrator account controls, developer API keys, and the RacketBot assistant.
Operational coverage includes WAF rules, health and Prometheus endpoints,
centralized logs, alerting, container metrics, blackbox probes, and scheduled
database backups.

## First Things To Read

Before making changes, inspect the relevant files:

- Project commands: `Makefile`
- Runtime services: `docker-compose.yml`
- Backend entrypoint: `backend/main.go`
- Database schema: `db/init.sql`
- Frontend root app: `frontend/src/app/layout.tsx`, `frontend/src/app/page.tsx`
- Auth state: `frontend/src/context/AuthContext.tsx`
- Other shared frontend state: `frontend/src/context/CartContext.tsx`,
  `frontend/src/context/LanguageContext.tsx`, and
  `frontend/src/context/WebSocketContext.tsx`
- AI proxy: `backend/ai_chat.go`
- Marketplace, order, seller, admin, and developer API handlers:
  `backend/products.go`, `backend/products_import.go`, `backend/orders.go`,
  `backend/seller_dashboard.go`, `backend/admin.go`, and `backend/api_keys.go`
- User auth, profiles, friends, and chat: `backend/modules/user/`
- JWT and API-key middleware: `backend/myMiddleware/`
- AI service entrypoint and request lifecycle: `ai_service/main.py`
- AI agent, tools, RAG, embeddings, and ML: `ai_service/agent.py`,
  `ai_service/tools.py`, `ai_service/rag.py`, `ai_service/embeddings.py`, and
  `ai_service/recommender.py`
- Edge routing and security: `nginx/conf/default.conf`,
  `waf/racketbot-before.conf`, and `scripts/test-waf.sh`
- Monitoring and alerting: `monitoring/prometheus/prometheus.yml`,
  `monitoring/alertmanager/alertmanager.yml`, and the other configuration under
  `monitoring/`
- Backup runtime: `backup/Dockerfile` and `backup/backup.sh`
- Continuous integration: `.github/workflows/ci.yml`

Use `rg` / `rg --files` for searching.

## Common Commands

From the repo root:

```bash
make build
make up
make build-up
make down
make ps
make logs
make logs-backend
make logs-frontend
make logs-db
make shell-backend
make shell-frontend
make shell-db
make db-connect
make db-migrate
make health-check
make logs-waf
make test-waf
make check-secrets
make infisical-auth-init
make infisical-auth-check
make infisical-auth-clear
```

Service URLs:
- Public application through the WAF: `https://localhost:8443`
- Public HTTP redirect entry point: `http://localhost:8088`
- Frontend container service: `frontend:3000`
- Backend container service: `backend:8080`
- Internal Nginx router: `nginx:8081`
- AI container service: `ai:8000`
- PostgreSQL container service: `db:5432`
- Host-only operations endpoints include Prometheus on `9090`, Grafana on
  `3001`, Alertmanager on `9093`, Loki on `3100`, and exporters on their
  Compose-configured loopback ports.

Only the WAF publishes the application entry points. The default host ports are
`8088` and `8443`, configurable with `WAF_HTTP_PORT` and `WAF_HTTPS_PORT`.

Browser traffic should normally use same-origin paths such as `/api/v1/...` so
it passes through the WAF and internal Nginx router. `NEXT_PUBLIC_API_URL` is an
optional frontend override and defaults to an empty string. Check existing usage
before introducing or relying on any additional public API-base variable.

`make setup`, `make up`, and `make restart` use the official Dockerized
Infisical CLI, the repository `.infisical.json`, and a local
`.env.infisical-auth` containing `INFISICAL_TOKEN`. Startup is non-interactive
and does not require a host-installed Infisical CLI, a saved browser session,
or `sudo`. Read-only lifecycle commands such as `make ps` and `make logs` do
not require Infisical. Never restore a known database-password fallback.

### MVP Admin Access

- Admin login page: `https://localhost:8443/admin/login`.
- Local MVP administrator username: `wongdakfat`.
- The test password is configured locally in `.env` as `ADMIN_PASSWORD_HASH`;
  do not copy it into tracked files or commits.
- The admin dashboard at `/admin/users` can search/filter users, suspend or
  restore accounts, and display marketplace summary counts.

## Validation

Use the narrowest relevant checks after changes.

Frontend:
```bash
cd frontend
npm test
npm run build
```

The frontend test suite covers authentication state and login/OTP behavior, cart
state and checkout, localization, and bulk-import CSV parsing. Run `npm run lint`
only when the project has a non-interactive ESLint configuration; `npm run build`
performs the current production type/build check.

Backend:
```bash
cd backend
test -z "$(gofmt -l .)"
go mod verify
go vet ./...
go test -race ./...
go build -mod=readonly ./...
```

The backend suite includes JWT/admin/API-key boundaries, account state,
password/OTP behavior, avatar validation, friends/chat/WebSocket rejection
paths, trusted AI identity forwarding, listing ownership, CSV imports, and
transactional order/stock behavior.

AI service:
```bash
cd ai_service
python -m pip check
python -m compileall -q .
python -m unittest discover -s tests -v
```

The AI tests must remain local and deterministic. They cover request isolation,
response validation, trusted authorization context, structured tool behavior,
RAG fallback and batching, and the recommender artifact contract without making
live DeepSeek, OpenRouter, or backend calls.

Docker-level:
```bash
docker compose config --quiet
make build
make up
make ps
make health-check
make test-waf
```

Full startup uses Infisical-managed secrets. Do not replace it with committed CI
credentials or a database-password fallback.

If a command cannot run because dependencies or services are unavailable, report that clearly.

## Continuous Integration

`.github/workflows/ci.yml` is organized from fast, focused checks to broader
runtime checks:

- `Frontend`: locked install, Vitest feature tests, production build, and
  TypeScript checking.
- `Backend`: formatting, module verification, `go vet`, race-enabled feature and
  security tests with a coverage report, and a read-only module build.
- `AI service`: locked dependency installation, `pip check`, recursive bytecode
  compilation, and deterministic unit tests.
- `PostgreSQL and pgvector schema`: applies `db/init.sql` to a fresh pgvector
  database and asserts the tables, columns, indexes, generated search data,
  vector columns, and seed data required across product areas.
- `Backend API and PostgreSQL smoke test`: starts the real backend against a
  fresh database and checks health, metrics, marketplace reads, admin login and
  summary, member/admin role separation, and API-key enforcement.
- `Containers, reverse proxy, and WAF`: builds every custom application/backup
  image, starts the core marketplace path, and checks HTTPS routing, redirects,
  public endpoints, protected endpoints, and SQLi/XSS blocking.

CI uses disposable local credentials and must not contact DeepSeek, OpenRouter,
Google OAuth, Brevo, Infisical, or Discord. Keep provider-dependent behavior
mocked in unit tests. When adding a feature, extend the closest unit suite first;
add database or runtime smoke coverage only for cross-service contracts that a
unit test cannot prove.

## Coding Conventions

### General

- Keep changes small and focused.
- Do not rewrite unrelated code.
- Do not delete user work or reset git state unless explicitly asked.
- Prefer existing patterns over new abstractions.
- Keep environment secrets out of commits.
- Be careful with `.env`, uploads, avatars, static files, and generated logs.

### Frontend

- Uses Next.js App Router under `frontend/src/app`.
- The current application uses Next.js 15 and React 19; check
  `frontend/package.json` rather than assuming framework versions.
- Many components are client components; add `'use client'` only when hooks/browser APIs are needed.
- Styling uses CSS modules next to components/pages.
- Shared state lives in `frontend/src/context`.
- Prefer same-origin `/api/...` calls. If an override is needed, follow
  `frontend/next.config.js` and `frontend/.env.example`.
- Preserve existing route groups such as `frontend/src/app/(user)/...`.
- User-facing text is localized through `frontend/src/i18n/messages/`; update
  all supported locale files when adding translated UI copy.

### Backend

- Go module name is `transcendence`.
- Echo is the HTTP framework.
- User features are organized under `backend/modules/user`.
- Auth middleware is under `backend/myMiddleware`.
- Product/order handlers currently live near root backend files.
- Protected routes should use `myMiddleware.JWTAuth()`.
- The developer API under `/api/public/v1` uses `X-API-Key` authentication,
  per-key rate limiting, and request logging. Keep its middleware and audit
  behavior intact when changing public API routes.
- Admin authorization is separate from ordinary user JWT authorization; preserve
  that boundary when editing `/api/v1/admin` routes.
- Database access uses PostgreSQL; do not introduce MySQL-specific SQL or drivers.
- Listing and avatar files are persisted through the mounted `uploads/`,
  `avatar/`, and `static/` paths. Validate file type, size, ownership, and path
  handling when changing uploads.

### Database

- Schema is initialized from `db/init.sql`.
- `backend/db.go` also runs small idempotent startup migrations for existing
  databases. Schema changes must account for both fresh and already-created
  PostgreSQL volumes.
- PostgreSQL and pgvector are expected.
- Be careful when editing seed data. Some inserts use `ON CONFLICT DO NOTHING`,
  while analytics/order demo inserts are not globally idempotent.
- If schema changes affect backend models or frontend fields, update all layers together.

### Edge, Monitoring, and Backups

- Browser traffic flows through WAF -> internal Nginx -> frontend/backend.
  Preserve WebSocket upgrade headers and streaming settings for chat routes.
- Keep ModSecurity exclusions narrow and scoped to a route/field. Run
  `make test-waf` after changing WAF, proxy, upload, or request-body behavior.
- `/health` checks backend-to-database connectivity; `/metrics` is the
  Prometheus scrape endpoint. Do not turn either into a superficial process-only
  check.
- Monitoring configuration under `monitoring/` is mounted read-only into its
  services. Keep scrape targets and service names aligned with Compose.
- Database backup changes must preserve retention cleanup, restore-compatible
  PostgreSQL output, and the textfile metric consumed by node-exporter.

### AI Service

- The FastAPI `/chat` path builds request-local state and invokes one stateless
  native tool-calling agent; do not add keyword intent routing or shared chat
  memory to the normal path.
- Knowledge ingestion starts in the background during AI-service startup. A
  failed refresh must not make the HTTP service unavailable or replace the last
  active knowledge version.
- `backend/ai_chat.go` validates optional JWTs, derives the trusted user ID,
  and streams the AI response. The Go backend remains the authorization boundary.
- DeepSeek is the chat/tool-calling provider. Configure it with
  `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_MODEL`.
- OpenRouter is the vector-embedding provider for RAG. Configure it separately
  with `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, and
  `OPENROUTER_EMBEDDING_MODEL`. Do not interchange the two provider keys.
- RAG/embedding logic is split across `rag.py` and `embeddings.py`; the agent,
  structured read-only tools, and ML recommender live in `agent.py`, `tools.py`,
  and `recommender.py`.
- RAG uses the versioned `knowledge_chunks` pgvector table. Preserve the active
  version if ingestion or an embedding provider fails.
- Structured tools are read-only and receive request-scoped authorization
  context. Do not move trusted identity parsing into the AI service or allow a
  model-provided user ID to become an authorization source.
- Avoid hardcoding API keys or model credentials.
- AI service depends on PostgreSQL and pgvector.

## Documentation Notes

Existing docs are useful but may be stale:
- `README.md`, `DEVELOPMENT.md`, and `ARCHITECTURE.md` contain some MySQL references.
- Trust active code/config over old documentation when they conflict.
- If changing behavior, update docs only when the request includes documentation or the mismatch would confuse future work.
- Keep this file as an agent orientation guide, not a full architecture manual.
  Update it when service boundaries, provider responsibilities, critical
  commands, security behavior, or major subsystem ownership changes; ordinary
  bug fixes and individual endpoints usually do not require an update.

## Git / Safety Rules

- Check `git status --short` before editing.
- Do not revert unrelated changes.
- Do not run destructive commands such as `git reset --hard`, `git checkout --`, or volume/data deletion unless explicitly requested.
- `make clean`, `make reset`, and `docker compose down -v` can delete local containers/volumes/data; ask before running them.

## How To Respond

When working as an agent:
- Briefly state what you inspected.
- Make the smallest reasonable change.
- Report the exact validation commands run.
- If validation was skipped or failed due to environment limits, say so.
