.PHONY: help build up down restart logs logs-backend logs-frontend logs-db ps clean reset shell-backend shell-frontend shell-db db-connect db-migrate health-check setup setup-backend setup-frontend build-up

help:
	@echo "Transcendence Marketplace - Available Commands"
	@echo "=============================================="
	@echo "make build              - Build all Docker images"
	@echo "make build-up           - Build images and start all services"
	@echo "make up                 - Start all services"
	@echo "make down               - Stop all services"
	@echo "make restart            - Restart all services"
	@echo "make logs               - View all service logs"
	@echo "make logs-backend       - View backend logs"
	@echo "make logs-frontend      - View frontend logs"
	@echo "make logs-db            - View database logs"
	@echo "make ps                 - Show running containers"
	@echo "make clean              - Stop and remove all containers & volumes"
	@echo "make reset              - Full reset: clean, build, up, migrate"
	@echo "make shell-backend      - Access backend container shell"
	@echo "make shell-frontend     - Access frontend container shell"
	@echo "make shell-db           - Access database container shell"
	@echo "make db-connect         - Connect to PostgreSQL database"
	@echo "make db-migrate         - Run database migrations"
	@echo "make setup-backend      - build up backend"

build:
	docker compose build
	@echo "✅ Docker images built. Next: 'make up' (or 'make setup' to build+up with URLs)."

build-up: build up
	@echo "✅ Services started. Frontend: http://localhost:3000"

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f

logs-backend:
	docker compose logs -f backend

logs-frontend:
	docker compose logs -f frontend

logs-db:
	docker compose logs -f db

ps:
	docker compose ps

clean:
	docker compose down -v --rmi local

shell-backend:
	docker compose exec backend sh

shell-frontend:
	docker compose exec frontend sh

shell-db:
	docker compose exec db bash

db-connect:
	docker compose exec db psql -U transcendence -d transcendence

db-migrate:
	docker compose exec -T db psql -U transcendence -d transcendence < db/init.sql

health-check:
	@echo "Checking service health..."
	@curl -s http://localhost:8080/health | jq . || echo "Backend not responding"
	@echo ""
	@echo "Frontend: http://localhost:3000"

setup: build up
	@echo "✅ Setup complete!"
	@echo "Frontend:  http://localhost:3000"
	@echo "Backend:   http://localhost:8080"
	@echo "Database:  localhost:5432"

setup-backend:
	docker compose build backend db
	docker compose up -d db backend

setup-frontend:
	docker compose build frontend
	docker compose up -d frontend

reset: clean build up db-migrate
	@echo "resetted"