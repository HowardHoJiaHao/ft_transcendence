# AGENTS.md

## Project Overview

This is a full-stack marketplace app for badminton/racket listings.

Main services:
- `frontend/`: Next.js app using React, TypeScript, App Router, and CSS modules.
- `backend/`: Go Echo API server using PostgreSQL through pgx/GORM.
- `ai_service/`: FastAPI AI service using LangChain, OpenRouter, PostgreSQL, and pgvector.
- `db/`: PostgreSQL schema and seed data.
- `nginx/`: Reverse proxy for frontend/backend routing.
- `docker-compose.yml`: Main local orchestration.

The active database is PostgreSQL with pgvector, not MySQL. Some older docs still mention MySQL; prefer `docker-compose.yml`, `Makefile`, `db/init.sql`, and source code as the source of truth.

## First Things To Read

Before making changes, inspect the relevant files:

- Project commands: `Makefile`
- Runtime services: `docker-compose.yml`
- Backend entrypoint: `backend/main.go`
- Database schema: `db/init.sql`
- Frontend root app: `frontend/src/app/layout.tsx`, `frontend/src/app/page.tsx`
- Auth state: `frontend/src/context/AuthContext.tsx`
- AI service entrypoint: `ai_service/main.py`

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
make db-connect
make db-migrate
make health-check
```

Service URLs:
- Frontend through nginx: `https://localhost` or `http://localhost`
- Frontend container service: `frontend:3000`
- Backend container service: `backend:8080`
- Backend health: `http://localhost:8080/health` only if exposed directly
- AI service: `http://localhost:8000`
- PostgreSQL: `localhost:5432`

## Validation

Use the narrowest relevant checks after changes.

Frontend:
```bash
cd frontend
npm run build
npm run lint
```

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
- Many components are client components; add `'use client'` only when hooks/browser APIs are needed.
- Styling uses CSS modules next to components/pages.
- Shared state lives in `frontend/src/context`.
- API calls should respect the existing environment variable pattern. Check current usage before adding new env names.
- Preserve existing route groups such as `frontend/src/app/(user)/...`.

### Backend

- Go module name is `transcendence`.
- Echo is the HTTP framework.
- User features are organized under `backend/modules/user`.
- Auth middleware is under `backend/myMiddleware`.
- Product/order handlers currently live near root backend files.
- Protected routes should use `myMiddleware.JWTAuth()`.
- Database access uses PostgreSQL; do not introduce MySQL-specific SQL or drivers.

### Database

- Schema is initialized from `db/init.sql`.
- PostgreSQL and pgvector are expected.
- Be careful when editing seed data because `ON CONFLICT DO NOTHING` is used.
- If schema changes affect backend models or frontend fields, update all layers together.

### AI Service

- FastAPI app is in `ai_service/main.py`.
- RAG/embedding logic is split across `rag.py`, `embeddings.py`, `agent.py`, and `tools.py`.
- Uses OpenRouter environment variables.
- Avoid hardcoding API keys or model credentials.
- AI service depends on PostgreSQL and pgvector.

## Documentation Notes

Existing docs are useful but may be stale:
- `README.md`, `DEVELOPMENT.md`, and `ARCHITECTURE.md` contain some MySQL references.
- Trust active code/config over old documentation when they conflict.
- If changing behavior, update docs only when the request includes documentation or the mismatch would confuse future work.

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
