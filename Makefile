.PHONY: help check-docker check-curl check-tools check-infisical-project check-secrets check-stripe-secrets test-stripe-setup build up down restart logs logs-waf logs-stripe logs-backend logs-frontend logs-db ps clean prune reset shell-backend shell-frontend shell-db db-connect db-migrate health-check test-waf infisical-auth-init infisical-auth-check infisical-auth-clear setup setup-backend setup-frontend build-up

INFISICAL_ENV ?= dev
INFISICAL_PATH ?= /
INFISICAL_CLI_IMAGE ?= infisical/cli:0.43.113
REQUIRE_BREVO ?= 0
REQUIRE_STRIPE ?= 0
REQUIRE_STRIPE_CLI ?= 0
DB_USER ?= transcendence
DB_NAME ?= transcendence

WITH_DOCKER_LOG_PATHS := ./scripts/with-docker-log-paths.sh
COMPOSE := $(WITH_DOCKER_LOG_PATHS) docker compose
INFISICAL_SETTINGS := INFISICAL_CLI_IMAGE="$(INFISICAL_CLI_IMAGE)" INFISICAL_ENV="$(INFISICAL_ENV)" INFISICAL_PATH="$(INFISICAL_PATH)"
WITH_INFISICAL := $(INFISICAL_SETTINGS) REQUIRE_BREVO="$(REQUIRE_BREVO)" REQUIRE_STRIPE="$(REQUIRE_STRIPE)" REQUIRE_STRIPE_CLI="$(REQUIRE_STRIPE_CLI)" ./scripts/with-infisical-env.sh

help:
	@echo "Transcendence Marketplace - Available Commands"
	@echo "=============================================="
	@echo "make setup            - Build and start the full stack plus Stripe webhook forwarding"
	@echo "make up               - Start the full stack plus Stripe webhook forwarding"
	@echo "make restart          - Rebuild the full stack plus Stripe webhook forwarding"
	@echo "make build            - Build local application images (no secrets required)"
	@echo "make down             - Stop local containers (no Infisical access required)"
	@echo "make logs             - Follow all container logs"
	@echo "make logs-waf         - Follow ModSecurity and OWASP CRS logs"
	@echo "make logs-stripe      - Follow the persistent Stripe webhook listener"
	@echo "make logs-backend     - Follow backend logs"
	@echo "make logs-frontend    - Follow frontend logs"
	@echo "make logs-db          - Follow PostgreSQL logs"
	@echo "make ps               - Show container status and published ports"
	@echo "make health-check     - Test the WAF and backend through HTTPS"
	@echo "make test-waf         - Run normal, redirect, SQLi, and XSS checks"
	@echo "make check-secrets    - Fetch and validate the Infisical dev secrets"
	@echo "make check-stripe-secrets - Validate Stripe sandbox configuration and demo seller email"
	@echo "make test-stripe-setup - Test listener secret parsing and cleanup"
	@echo "make infisical-auth-init  - Create the local Infisical token file"
	@echo "make infisical-auth-check - Validate the local Infisical token file"
	@echo "make infisical-auth-clear - Delete only the local Infisical token file"
	@echo "make db-connect       - Open psql inside the PostgreSQL container"
	@echo "make db-migrate       - Apply db/init.sql to the running database"
	@echo "make clean            - DESTRUCTIVE: remove this project's containers and database volume"
	@echo "make prune            - DESTRUCTIVE: stop every container on this machine, then prune images/volumes"
	@echo "make reset            - DESTRUCTIVE: remove data and recreate the full stack"

check-docker:
	@command -v docker >/dev/null 2>&1 || \
		{ echo "❌ Docker is not installed or not available in this shell."; exit 1; }
	@docker compose version >/dev/null 2>&1 || \
		{ echo "❌ Docker Compose v2 is unavailable in this shell. Start Docker Desktop and enable WSL integration if applicable."; exit 1; }
	@docker info >/dev/null 2>&1 || \
		{ echo "❌ The Docker daemon is not reachable. Start Docker and enable WSL integration if applicable."; exit 1; }

check-curl:
	@command -v curl >/dev/null 2>&1 || \
		{ echo "❌ curl is not installed."; exit 1; }

check-tools: check-docker

check-infisical-project:
	@test -f .infisical.json || \
		{ echo "❌ This clone is not linked to Infisical. Restore the team .infisical.json file."; exit 1; }

check-secrets: check-tools check-infisical-project
	@$(WITH_INFISICAL) true

check-stripe-secrets:
	@$(MAKE) --no-print-directory check-secrets REQUIRE_STRIPE=1

setup: check-tools check-infisical-project
	@$(INFISICAL_SETTINGS) REQUIRE_BREVO="$(REQUIRE_BREVO)" REQUIRE_STRIPE="1" REQUIRE_STRIPE_CLI="0" ./scripts/with-infisical-env.sh \
		$(WITH_DOCKER_LOG_PATHS) ./scripts/setup-stripe-demo.sh setup
	@echo ""
	@echo "✅ Full project and Stripe webhook setup complete."
	@echo "Application: https://localhost:$${WAF_HTTPS_PORT:-8443}"
	@echo "Containers:  make ps"
	@echo "Stripe logs: make logs-stripe"
	@echo "WAF logs:    make logs-waf"
	@echo "WAF test:    make test-waf"

up: check-tools check-infisical-project
	@$(INFISICAL_SETTINGS) REQUIRE_BREVO="$(REQUIRE_BREVO)" REQUIRE_STRIPE="1" REQUIRE_STRIPE_CLI="0" ./scripts/with-infisical-env.sh \
		$(WITH_DOCKER_LOG_PATHS) ./scripts/setup-stripe-demo.sh up

restart: check-tools check-infisical-project
	@$(INFISICAL_SETTINGS) REQUIRE_BREVO="$(REQUIRE_BREVO)" REQUIRE_STRIPE="1" REQUIRE_STRIPE_CLI="0" ./scripts/with-infisical-env.sh \
		$(WITH_DOCKER_LOG_PATHS) ./scripts/setup-stripe-demo.sh restart

build: check-docker
	$(COMPOSE) build

build-up: setup

down: check-docker
	$(COMPOSE) --profile stripe down

logs: check-docker
	@$(COMPOSE) --profile stripe logs -f | \
		awk '{ gsub(/whsec_[[:alnum:]]+/, "whsec_[REDACTED]"); gsub(/token=[^[:space:]&]+/, "token=[REDACTED]"); print; fflush(); }'

logs-waf: check-docker
	$(COMPOSE) logs -f waf

logs-stripe: check-docker
	@$(COMPOSE) --profile stripe logs -f stripe-cli | \
		awk '{ gsub(/whsec_[[:alnum:]]+/, "whsec_[REDACTED]"); gsub(/token=[^[:space:]&]+/, "token=[REDACTED]"); print; fflush(); }'

test-stripe-setup:
	@sh scripts/tests/setup-stripe-demo-test.sh

logs-backend: check-docker
	$(COMPOSE) logs -f backend

logs-frontend: check-docker
	$(COMPOSE) logs -f frontend

logs-db: check-docker
	$(COMPOSE) logs -f db

ps: check-docker
	$(COMPOSE) ps

health-check: check-curl
	@echo "Checking WAF..."
	@curl -ksSf --max-time 10 "https://localhost:$${WAF_HTTPS_PORT:-8443}/healthz" >/dev/null && \
		echo "✅ WAF is responding." || \
		{ echo "❌ WAF is not responding."; exit 1; }
	@echo "Checking backend through WAF..."
	@curl -ksSf --max-time 10 "https://localhost:$${WAF_HTTPS_PORT:-8443}/api/v1/status" >/dev/null && \
		echo "✅ Backend is reachable through the WAF." || \
		{ echo "❌ Backend is not reachable through the WAF."; exit 1; }

test-waf: check-curl
	@BASE_URL="https://localhost:$${WAF_HTTPS_PORT:-8443}" HTTP_URL="http://localhost:$${WAF_HTTP_PORT:-8088}" sh scripts/test-waf.sh

shell-backend: check-docker
	$(COMPOSE) exec backend sh

shell-frontend: check-docker
	$(COMPOSE) exec frontend sh

shell-db: check-docker
	$(COMPOSE) exec db sh

db-connect: check-docker
	$(COMPOSE) exec db psql -U $(DB_USER) -d $(DB_NAME)

db-migrate: check-docker
	$(COMPOSE) exec -T db psql -U $(DB_USER) -d $(DB_NAME) < db/init.sql

infisical-auth-init:
	@if [ -e .env.infisical-auth ]; then \
		echo "❌ .env.infisical-auth already exists; it was not overwritten."; \
		exit 1; \
	else \
		cp .env.infisical-auth.example .env.infisical-auth && \
		chmod 600 .env.infisical-auth && \
		echo "✅ Created .env.infisical-auth with mode 600." && \
		echo "Edit the file and set INFISICAL_TOKEN. Never commit or share it."; \
	fi

infisical-auth-check:
	@./scripts/check-infisical-auth.sh

infisical-auth-clear:
	@rm -f .env.infisical-auth
	@echo "✅ Removed only .env.infisical-auth."

clean: check-docker
	@echo "⚠️  Removing containers and the PostgreSQL data volume. This deletes local database data."
	$(COMPOSE) down -v --rmi local

prune: check-docker
	@echo "⚠️  Stopping and removing EVERY Docker container on this machine,"
	@echo "    then deleting unused images, networks, and volumes (all projects)."
	@ids=$$(docker ps -aq); \
	if [ -n "$$ids" ]; then docker rm -f $$ids; else echo "No containers to remove."; fi
	docker system prune -a --volumes -f

reset: check-tools check-infisical-project
	@echo "⚠️  Removing containers and the PostgreSQL data volume. This deletes local database data."
	@$(WITH_INFISICAL) $(WITH_DOCKER_LOG_PATHS) sh -c 'docker compose --env-file .env.infisical down -v --rmi local && docker compose --env-file .env.infisical up -d --build --wait --wait-timeout 180'

# Legacy aliases now use the secure full-stack workflow so they cannot start a
# dependency chain without the required injected secrets.
setup-backend: setup

setup-frontend: setup
