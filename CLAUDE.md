# Transcendence

42 School marketplace project. Full-stack app: browse/list products, chat, friends, JWT auth, plus an AI FAQ chatbot (RAG).

**Note:** Root docs `README.md`, `ARCHITECTURE.md`, `PROJECT_SUMMARY.md` describe an early scaffold (MySQL, no AI service, no nginx) and are stale. Trust `docker-compose.yml` and the code over them.

## Architecture

5 Docker services (`docker-compose.yml`):

- **nginx** — reverse proxy / TLS termination, ports 80/443, in front of frontend + backend
- **frontend** — Next.js (App Router) + React + TypeScript, port 3000
- **backend** — Go + Echo framework, port 8080
- **ai** — Python FastAPI + LangChain RAG service, port 8000, talks to backend and db
- **db** — PostgreSQL 15 with pgvector extension, port 5432

## Repo layout

- `backend/main.go` — route registration and module wiring
- `backend/modules/user/{auth,profile,friends,chat}/` — each module split into `handler.go` / `service.go` / `repository.go` / `models.go`
- `backend/myMiddleware/` — shared middleware (JWT auth, etc.)
- `frontend/src/app/(user)/...` — route groups: login, chat, friends, sell, cart, profile, user
- `frontend/src/app/products/[id]` — product detail page
- `ai_service/` — FastAPI app (`main.py`), RAG logic (`rag.py`, `embeddings.py`), FAQ source docs (`faq_docs/`)
- `rubbish/` — abandoned/duplicate drafts (old auth, avatar, 2FA code) — not in use, don't resurrect without checking with the user
- `db/init.sql` — schema init for Postgres

## Commands

```bash
make up / make down / make restart      # docker compose lifecycle
make logs / make logs-backend / make logs-frontend / make logs-db
make shell-backend / make shell-frontend / make shell-db
make db-connect                          # psql into the db container
make build / make build-up / make clean
```

Local dev without Docker:
```bash
cd backend && go run main.go
cd frontend && npm run dev   # also: npm run build, npm run lint
```

Env vars live in root `.env` (from `.env.example`) and are passed into containers via `docker-compose.yml`; backend also has `backend/.env.example`, frontend has `frontend/.env.example`.
