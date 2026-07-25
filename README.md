# Transcendence Marketplace

A full-stack badminton and racket marketplace built with Next.js, Go Echo,
FastAPI, PostgreSQL with pgvector, and Docker Compose.

The local stack is protected by an OWASP CRS Web Application Firewall. Runtime
secrets are retrieved from Infisical Cloud and injected into Docker Compose by
the official Dockerized Infisical CLI.

## Architecture

```text
Browser
  -> WAF (Nginx + ModSecurity + OWASP CRS)
  -> internal Nginx router
  -> frontend:3000 or backend:8080
                         -> db:5432
                         -> ai:8000
```

Only the WAF publishes host ports:

- HTTP: <http://localhost>
- HTTPS: <https://localhost>

The development HTTPS certificate is self-signed, so browsers and `curl` will
require an explicit local trust exception.

## Prerequisites

- Docker with Docker Compose v2
- Make
- curl
- Git
- A project-scoped Infisical programmatic access token

No local Infisical CLI installation or `sudo` access is required.

## One-time Infisical authentication setup

From the repository root:

```bash
make infisical-auth-init
nano .env.infisical-auth
chmod 600 .env.infisical-auth
```

Set `INFISICAL_TOKEN` in `.env.infisical-auth`. The token should be read-only
and scoped to this project and its `dev` environment. Normal startup is fully
non-interactive and never invokes Infisical login. The committed
`.infisical.json` contains only the project reference.

Required Infisical secrets at path `/`:

```text
DB_PASSWORD
JWT_SECRET
ADMIN_PASSWORD_HASH
DEEPSEEK_API_KEY
OPENROUTER_API_KEY
```

Requirements:

- `JWT_SECRET` must contain at least 32 characters.
- `ADMIN_PASSWORD_HASH` must be a bcrypt hash.
- `DB_PASSWORD` must match the password in an existing PostgreSQL volume.
- `BREVO_API_KEY` is required when demonstrating 2FA or password-change email.

Do not put real secret values in `.env.example` or tracked documentation.

## Start the application

```bash
make setup
```

`make setup` checks Docker and Compose, exports fresh `dev` secrets through the
Dockerized CLI, validates them, and starts the complete stack. The generated
`.env.infisical` file has mode `600` and is removed as soon as Compose finishes
creating and starting the containers.

To require the optional Brevo credential as part of startup validation:

```bash
make setup REQUIRE_BREVO=1
```

Verify the running stack:

```bash
make ps
make health-check
make test-waf
```

## Existing PostgreSQL volumes

The `POSTGRES_PASSWORD` environment value initializes a new PostgreSQL volume;
it does not change the password in an existing `postgres_data` volume.

For an existing development volume, either:

1. use its current password as the initial Infisical `DB_PASSWORD`; or
2. connect with `make db-connect`, run `\password transcendence` interactively,
   and then set the same new value in Infisical.

Do not use `make clean` or `make reset` as a password migration unless deleting
all local database data is intentional.

## Common commands

```text
make help             Show all supported commands
make setup            Build and start the full Infisical + WAF stack
make up               Start the stack with Infisical secrets
make restart          Recreate containers with freshly retrieved secrets
make check-secrets    Fetch and validate required secrets
make infisical-auth-init  Create the local token file
make infisical-auth-check Validate the local token file
make infisical-auth-clear Delete only the local token file
make build            Build application images without retrieving secrets
make down             Stop containers without requiring Infisical
make ps               Show container status and published ports
make logs             Follow all logs
make logs-waf         Follow ModSecurity and CRS audit output
make logs-backend     Follow Go backend logs
make logs-frontend    Follow Next.js logs
make logs-db          Follow PostgreSQL logs
make health-check     Check WAF and backend reachability
make test-waf         Run HTTP redirect, normal, SQLi, and XSS tests
make db-connect       Open psql in the database container
make db-migrate       Apply db/init.sql
```

`make clean` and `make reset` delete the PostgreSQL volume and all local
database data.

## WAF demonstration

Run:

```bash
make test-waf
```

The expected result is:

```text
HTTP to HTTPS redirect              301 or 308
Normal backend request              200
SQL injection request               403
XSS request                         403
```

Then inspect the rule matches:

```bash
make logs-waf
```

The committed WAF configuration uses blocking mode and CRS paranoia level 1.
Do not disable ModSecurity for all of `/api/`. If a legitimate request is
blocked, identify the rule and add the narrowest route- or parameter-specific
exclusion.

## Application validation

After changing the stack, test:

- frontend loading and login;
- product listing and CRUD operations;
- avatar upload;
- up to six listing images of 10 MiB each;
- WebSocket chat;
- progressively streamed AI responses;
- administrator login and user management.

Service-specific checks:

```bash
cd backend
go test ./...
go build ./...
```

```bash
cd frontend
npm run build
```

```bash
cd ai_service
python -m py_compile *.py
python -m unittest discover -s tests -v
```

## Troubleshooting

### This clone is not linked to Infisical

Restore the team-owned `.infisical.json` file from the repository. It contains
the Infisical project reference but no secret values.

### Infisical secret validation fails

Run `make infisical-auth-check`, confirm that the token has project access, and
check that the required names exist in environment `dev` at path `/`. The
validation scripts never print the token or secret values.

### Database authentication fails after migration

The Infisical value probably differs from the password stored in the existing
PostgreSQL volume. Follow the existing-volume procedure above. Do not delete the
volume if its data must be retained.

### A legitimate request returns 403

Inspect:

```bash
make logs-waf
```

Record the CRS rule ID, verify the request is legitimate, and add only a narrow
exclusion. Retest both the application flow and `make test-waf`.

### Docker is unavailable in WSL

Start Docker Desktop and enable integration for the active WSL distribution,
then rerun `make setup`.

## Detailed cybersecurity requirements

See [docs/prd-cybersecurity-waf-infisical.md](docs/prd-cybersecurity-waf-infisical.md).

## License

42 Project - Transcendence
