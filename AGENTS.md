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
- `docker-compose.yml`: Main local orchestration.

The active database is PostgreSQL with pgvector, not MySQL. Some older docs still mention MySQL; prefer `docker-compose.yml`, `Makefile`, `db/init.sql`, and source code as the source of truth.

Active product areas include authentication (password, OTP, and Google OAuth),
profiles and avatars, friends and WebSocket chat, marketplace listings and image
uploads, cart/orders, seller analytics and fulfillment, bulk CSV listing imports,
administrator account controls, developer API keys, and the RacketBot assistant.

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
make infisical-init
```

Service URLs:
- Frontend through nginx: `https://localhost` or `http://localhost`
- Frontend container service: `frontend:3000`
- Backend container service: `backend:8080`
- Internal Nginx router: `nginx:8081`
- AI container service: `ai:8000`
- PostgreSQL container service: `db:5432`
- Only the WAF publishes host ports `80` and `443`.

Browser traffic should normally use same-origin paths such as `/api/v1/...` so
it passes through the WAF and internal Nginx router. `NEXT_PUBLIC_API_URL` is an
optional frontend override and defaults to an empty string. Check existing usage
before introducing or relying on any additional public API-base variable.

`make setup`, `make up`, and `make restart` require an authenticated Infisical
CLI, a repository `.infisical.json`, and the required `dev` secrets. Read-only
local lifecycle commands such as `make ps` and `make logs` do not require
Infisical. Never restore a known database-password fallback.

### MVP Admin Access

- Admin login page: `https://localhost/admin/login` (or `http://localhost/admin/login`).
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
npm run build
```

Run `npm run lint` only when the project has a non-interactive ESLint
configuration; `npm run build` performs the current production type/build check.

Backend:
```bash
cd backend
go test ./...
go build ./...
```

AI service:
```bash
cd ai_service
python -m py_compile *.py
python -m unittest discover -s tests -v
```

Docker-level:
```bash
make build
make up
make ps
make health-check
```

If a command cannot run because dependencies or services are unavailable, report that clearly.

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
- Be careful when editing seed data because `ON CONFLICT DO NOTHING` is used.
- If schema changes affect backend models or frontend fields, update all layers together.

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
