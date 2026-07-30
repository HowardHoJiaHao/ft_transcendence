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

- HTTP: <http://localhost:8088>
- HTTPS: <https://localhost:8443>

These high-numbered ports work with rootless Docker, which cannot normally
bind ports below 1024. If either port is in use, choose free alternatives when
starting the stack, for example: `WAF_HTTP_PORT=8089 WAF_HTTPS_PORT=8444 make setup`.

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

The full demo startup also requires the six Stripe values documented under
[Stripe Connect sandbox checkout](#stripe-connect-sandbox-checkout). Use
`make up` instead when bootstrapping the Stripe webhook secret for the first
time.

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
Dockerized CLI, validates the complete Stripe demo configuration, confirms that
the Stripe CLI signing secret matches `STRIPE_WEBHOOK_SECRET`, and starts the
complete stack with persistent webhook forwarding. The generated
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
make setup            Build the full demo stack and start Stripe forwarding
make up               Start the core stack for first-time Stripe bootstrap
make restart          Recreate containers with freshly retrieved secrets
make check-secrets    Fetch and validate required secrets
make check-stripe-secrets Validate the complete Stripe demo configuration
make stripe-listen    Run the foreground Stripe listener for initial bootstrap
make infisical-auth-init  Create the local token file
make infisical-auth-check Validate the local token file
make infisical-auth-clear Delete only the local token file
make build            Build application images without retrieving secrets
make down             Stop containers without requiring Infisical
make ps               Show container status and published ports
make logs             Follow all logs
make logs-waf         Follow ModSecurity and CRS audit output
make logs-stripe      Follow the persistent Stripe webhook listener
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

## Stripe Connect sandbox checkout

The core application and Meet up / COD checkout can still run without Stripe by
using `make up`. The demo-oriented `make setup` requires Stripe configuration
and starts the pinned Stripe CLI listener alongside the application. The
sandbox flow supports one configured seller, MYR card payments, Stripe-hosted
Checkout, Connect destination charges, and a 10% application fee.

Store these values in the Infisical `dev` environment at path `/`:

```text
STRIPE_SECRET_KEY
STRIPE_TEST_CONNECTED_ACCOUNT_ID
STRIPE_TEST_SELLER_EMAIL
STRIPE_WEBHOOK_SECRET
STRIPE_SUCCESS_URL
STRIPE_CANCEL_URL
```

Use a test key beginning with `sk_test_`. The connected account ID begins with
`acct_`. Choose the stable email address of the marketplace demo seller with:

```bash
make db-connect
```

```sql
SELECT username, email
FROM users
ORDER BY email;
```

Set `STRIPE_TEST_SELLER_EMAIL` to that address. Checkout compares the configured
address with the listing seller's database email after trimming whitespace and
without case sensitivity, so it remains stable when a fresh PostgreSQL volume
assigns different numeric user IDs.

Recommended local return URLs are:

```text
STRIPE_SUCCESS_URL=https://localhost:8443/cart?checkout=stripe-return&session_id={CHECKOUT_SESSION_ID}
STRIPE_CANCEL_URL=https://localhost:8443/cart?checkout=stripe-cancelled
```

If `WAF_HTTPS_PORT` is customized, use that port in both URLs.

The first local webhook setup has a deliberate two-stage bootstrap:

1. Start the core stack with `make up`, which does not require a webhook secret.
2. Run `make stripe-listen`.
3. Copy the displayed `whsec_...` value into Infisical as
   `STRIPE_WEBHOOK_SECRET`.
4. Run `make setup`.
5. Validate all values at any time with `make check-stripe-secrets`.

During normal demo startup, `make setup` first uses
`stripe listen --print-secret` to ensure the listener and backend share the
same signing secret. It then starts the pinned listener as a persistent Compose
service on the internal network. Follow it with `make logs-stripe`.

`make stripe-listen` remains the foreground bootstrap command used to obtain
the initial `whsec_...` value. Both listener modes forward only the required
events to `http://backend:8080/api/v1/webhooks/stripe`; neither publishes the
backend port nor persists the API key.

Use Stripe's sandbox card:

```text
4242 4242 4242 4242
Any future expiry
Any three-digit CVC
```

After payment, verify the destination charge, 10% application fee, and
connected-account transfer in the Stripe test dashboard. Inspect local state
with:

```bash
make db-connect
```

```sql
SELECT id, status, amount_minor, platform_fee_minor,
       stripe_checkout_session_id, stripe_payment_intent_id, stock_released
FROM payments
ORDER BY id DESC;

SELECT id, payment_id, status, payment_method
FROM orders
ORDER BY id DESC;
```

The verified webhook, not the browser return URL, marks a payment paid. A
declined card leaves stock reserved so the buyer can retry in the same Checkout
Session. An expired Session cancels its pending orders and restores stock
exactly once.

Current limitations: test mode only, one configured seller, one seller per
Stripe cart, MYR cards only, no dynamic onboarding, and no refund initiation or
refund webhook synchronization.

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
