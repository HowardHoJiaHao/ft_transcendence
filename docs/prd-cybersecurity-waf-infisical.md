# PRD: Cybersecurity MVP with ModSecurity, OWASP CRS, and Infisical

## Document status

- Status: Local implementation applied; runtime acceptance pending
- Target: Local Docker Compose evaluation environment
- Canonical startup command: `make setup`
- Production readiness: Explicitly out of scope
- Replaces: The earlier cybersecurity implementation proposal

The repository-side implementation is present. Final acceptance still requires
a team-owned Infisical project, a generated `.infisical.json`, populated `dev`
secrets, Docker availability, and execution of the runtime test plan.

## 1. Summary

Add two demonstrable cybersecurity capabilities to the marketplace:

1. A public Web Application Firewall (WAF) using Nginx, ModSecurity, and the
   OWASP Core Rule Set (CRS).
2. Centralized secret storage in Infisical Cloud, with the Infisical CLI
   injecting secrets into Docker Compose at startup.

The final public request path is:

```text
Browser
  -> WAF (Nginx + ModSecurity + OWASP CRS)
  -> internal Nginx router
  -> frontend or backend
```

The application remains a local academic MVP. The work must preserve the
existing frontend, API, uploads, WebSocket chat, and AI chat flows.

## 2. Goals

- Make the WAF the only service that publishes host ports.
- Inspect and block selected SQL-injection and XSS requests.
- Keep normal marketplace traffic working at CRS paranoia level 1.
- Store real application secrets in Infisical instead of a required local
  `.env` file.
- Fail startup clearly when tools, Infisical configuration, authentication, or
  required secrets are missing.
- Start and rebuild the complete application with `make setup`.
- Keep the implementation understandable and reproducible for evaluation.

## 3. Non-goals

- Production deployment or public certificates.
- High availability, autoscaling, DDoS protection, or bot management.
- Automatic secret rotation or dynamic database credentials.
- Per-container Infisical machine identities.
- A self-hosted Infisical server.
- Enterprise secret isolation. Secrets passed as container environment
  variables remain visible to users with Docker administration access.
- SIEM integration, malware scanning, or extensive penetration testing.
- Broad CRS exclusions or custom attack-signature development.

## 4. Verified current codebase context

The current Compose project has five services:

```text
db
backend
frontend
ai
nginx
```

Relevant current behavior:

- PostgreSQL uses the `postgres_data` named volume.
- The backend reads configuration with `os.Getenv` and requires a JWT secret of
  at least 32 characters.
- The backend reaches the AI service at `http://ai:8000` by default.
- The AI service reaches the backend at `http://backend:8080` by default.
- Frontend and backend use Docker `expose`, not host-published ports.
- PostgreSQL publishes `5432`, the AI service publishes `8000`, and the current
  Nginx publishes `80` and `443`.
- The current Nginx performs TLS termination and path-based routing.
- Product uploads allow up to six images, each up to 10 MiB.
- AI responses use Server-Sent Events (SSE).
- Chat uses WebSockets at `/api/v1/ws`.
- Several browser requests are already same-origin `/api/...` requests, but the
  Next.js configuration can still compile `http://localhost:8080` into the
  browser bundle.
- `ai_service/rag.py` still contains a known database-password fallback.

This architecture can support the MVP, but the implementation must account for
frontend build-time variables, existing database volumes, upload sizes, SSE,
and WebSockets.

## 5. Target architecture

```text
                              Browser
                                 |
                       HTTP 80 / HTTPS 443
                                 |
                                 v
                 +-------------------------------+
                 | waf                           |
                 | Nginx + ModSecurity + CRS     |
                 | TLS termination and blocking  |
                 +---------------+---------------+
                                 |
                         http://nginx:8081
                                 |
                                 v
                 +-------------------------------+
                 | nginx                         |
                 | Internal path router          |
                 +---------+---------------------+
                           |                  |
                           v                  v
                    frontend:3000       backend:8080
                                              |
                                      +-------+-------+
                                      |               |
                                      v               v
                                   db:5432         ai:8000

Infisical Cloud -> Infisical CLI -> Docker Compose environment interpolation
```

The final Compose project has six services:

| Service | Responsibility | Host-published ports |
| --- | --- | --- |
| `waf` | Public TLS endpoint and request inspection | `80`, `443` |
| `nginx` | Internal path router | None |
| `frontend` | Next.js application | None |
| `backend` | Go API | None |
| `ai` | FastAPI AI service | None |
| `db` | PostgreSQL with pgvector | None |

Docker `expose` entries may remain because they document internal ports; they
do not publish those ports to the host.

## 6. Product decisions

### 6.1 WAF image

Use the official CRS Nginx image and pin the tested LTS release:

```yaml
image: owasp/modsecurity-crs:4.25.0-nginx-lts
```

Do not use the rolling `:nginx` tag for the evaluation baseline. A later patch
or digest may be selected only after the full regression test passes, and the
selected value must remain pinned in Compose.

### 6.2 WAF operating mode

The committed final configuration uses blocking mode:

```yaml
MODSEC_RULE_ENGINE: "On"
BLOCKING_PARANOIA: "1"
DETECTION_PARANOIA: "1"
MODSEC_AUDIT_ENGINE: "RelevantOnly"
REPORTING_LEVEL: "2"
```

`DetectionOnly` may be used temporarily on an implementation branch while
finding false positives, but it is not an accepted final configuration.

### 6.3 Allowed HTTP methods

Configure all methods currently used by the application:

```yaml
ALLOWED_METHODS: "GET HEAD POST PUT PATCH DELETE OPTIONS"
```

### 6.4 Upload limits

The application permits six 10 MiB listing images in one multipart request.
Both proxy layers and ModSecurity must therefore accept at least 60 MiB plus
multipart overhead.

Use:

```yaml
MODSEC_REQ_BODY_LIMIT: "73400320"
MAX_FILE_SIZE: "10485760"
COMBINED_FILE_SIZES: "62914560"
```

and configure the internal Nginx server with:

```nginx
client_max_body_size 70m;
```

The limit must not be raised to unlimited without documenting why. The backend
continues enforcing MIME type, file count, and per-file size.

### 6.5 Browser API origin

The Docker deployment uses same-origin browser requests:

```text
/api/...
```

The frontend must not compile `http://localhost:8080` as its production Docker
fallback because port `8080` is not publicly available in the target
architecture.

Preferred implementation:

- make the default browser API base an empty string;
- keep active browser calls relative to the current origin;
- construct the WebSocket URL from `window.location` so it uses `wss` on HTTPS
  and `ws` on HTTP.

If `NEXT_PUBLIC_API_URL` remains supported for non-Docker development, it must
be treated as a build-time variable and must not be described as runtime secret
injection.

### 6.6 Database password migration

Changing `POSTGRES_PASSWORD` does not change the password inside an existing
PostgreSQL data volume. Before the first Infisical-based startup, each existing
environment must choose one of these paths:

1. Store the password already used by its `postgres_data` volume as the initial
   Infisical `DB_PASSWORD`; or
2. While the old credentials still work, run a documented `ALTER ROLE` command
   and then update Infisical to the same new value.

Deleting `postgres_data` is a destructive fallback for disposable local data,
not the default migration. Any command that deletes the volume must retain an
explicit warning.

### 6.7 Secret injection boundary

Infisical runs on the developer host. It launches Docker Compose as its child
process. Compose explicitly maps only the required values into each container.
The Go and Python applications do not call Infisical directly.

## 7. WAF requirements

Add the `waf` service to `docker-compose.yml` with the following baseline:

```yaml
waf:
  image: owasp/modsecurity-crs:4.25.0-nginx-lts
  container_name: transcendence-waf
  ports:
    - "80:8080"
    - "443:8443"
  environment:
    BACKEND: http://nginx:8081
    SERVER_NAME: localhost
    NGINX_ALWAYS_TLS_REDIRECT: "on"
    MODSEC_RULE_ENGINE: "On"
    MODSEC_AUDIT_ENGINE: "RelevantOnly"
    BLOCKING_PARANOIA: "1"
    DETECTION_PARANOIA: "1"
    REPORTING_LEVEL: "2"
    ALLOWED_METHODS: "GET HEAD POST PUT PATCH DELETE OPTIONS"
    MODSEC_REQ_BODY_LIMIT: "73400320"
    MAX_FILE_SIZE: "10485760"
    COMBINED_FILE_SIZES: "62914560"
  depends_on:
    - nginx
  networks:
    - transcendence-network
```

The official image supplies:

- HTTP on container port `8080`;
- HTTPS on container port `8443`;
- a local self-signed certificate;
- `/healthz`;
- WebSocket upgrade forwarding;
- disabled proxy buffering for streamed upstream responses;
- ModSecurity and the bundled CRS rules.

Blocked-request audit logs must be written to container output so they are
visible through:

```bash
make logs-waf
```

WAF logs can contain request metadata. They must not be committed or copied
into tracked demonstration artifacts without review.

## 8. Internal Nginx requirements

The existing Nginx becomes an internal HTTP router on port `8081`. Remove its
certificate generation, public HTTP redirect, SSL server block, and host port
mappings.

It must preserve these routes:

```text
/api/v1/ws       -> backend WebSocket
/api/v1/ai/chat  -> backend SSE endpoint
/api/            -> backend
/uploads/        -> backend
/avatars/        -> backend
/static/         -> backend
/                -> frontend
```

The configuration must:

- listen on `8081` only;
- preserve `Host`, `X-Real-IP`, `X-Forwarded-For`, and
  `X-Forwarded-Proto`;
- use HTTP/1.1 and Upgrade/Connection headers for WebSockets;
- use a long read timeout for WebSockets;
- disable proxy buffering and caching for `/api/v1/ai/chat`;
- use a read timeout greater than the backend's 70-second AI client timeout;
- set `client_max_body_size 70m`.

The SSE location must be more specific than the general `/api/` location. A
representative configuration is:

```nginx
location /api/v1/ai/chat {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 75s;
}
```

The Nginx Dockerfile no longer installs OpenSSL or creates a certificate. It
exposes `8081` and runs the standard Nginx foreground command.

## 9. Network exposure requirements

Remove these host mappings:

```text
db:      5432:5432
ai:      8000:8000
nginx:   80:80 and 443:443
```

Do not add host mappings for frontend or backend. After the change,
`docker compose ps` must show published host ports only for `waf`.

Database administration continues through:

```bash
make db-connect
make db-migrate
```

AI communication continues over the Docker network:

```text
backend -> http://ai:8000
ai      -> http://backend:8080
```

## 10. Infisical requirements

### 10.1 Project setup

Use one Infisical Cloud project and one development environment:

```text
Project: ft-transcendence
Environment slug: dev
Secret path: /
```

Each developer performs a one-time login and project link:

```bash
infisical login
infisical init
```

`infisical login -i` may be used in WSL when browser login is inconvenient.
Commit the generated `.infisical.json`; it contains project configuration, not
secret values.

### 10.2 Required secrets

The following values are required for the complete evaluated stack:

```text
DB_PASSWORD
JWT_SECRET
ADMIN_PASSWORD_HASH
DEEPSEEK_API_KEY
OPENROUTER_API_KEY
```

Requirements:

- `JWT_SECRET` is at least 32 characters.
- `ADMIN_PASSWORD_HASH` is a bcrypt hash, not the plaintext MVP fallback.
- `DB_PASSWORD` has no known fallback in Compose or application source.
- Secret validation prints names and validation errors, never values.

`BREVO_API_KEY` is conditionally required when the evaluation demonstrates a
2FA-enabled login or password change. The test plan must either require this
secret or explicitly use an account with `requires_2fa = false`.

Do not require currently unused values such as `BREVO_SMTP_KEY` or Google OAuth
credentials unless the corresponding application functionality is added and
tested.

### 10.3 Non-secret configuration

These values may remain in Compose:

```text
ENVIRONMENT=development
NODE_ENV=development
SERVER_PORT=8080
DB_HOST=db
DB_PORT=5432
DB_NAME=transcendence
DB_USER=transcendence
ADMIN_USERNAME
AI_SERVICE_URL=http://ai:8000
BACKEND_URL=http://backend:8080
DEEPSEEK_BASE_URL
DEEPSEEK_MODEL
OPENROUTER_BASE_URL
OPENROUTER_EMBEDDING_MODEL
```

### 10.4 Compose mappings

Remove the backend `env_file: .env` entry. Map every value explicitly into only
the containers that use it.

Remove `${DB_PASSWORD:-transcendence_pass}` from Compose and remove the same
fallback from `ai_service/rag.py`. Missing required values must never silently
select a known password.

The application must start without a root `.env` file after Infisical setup.
Compose may still use its normal `.env` behavior for non-secret local overrides,
but the documented secure workflow does not depend on that file.

## 11. Makefile requirements

### 11.1 Preflight

`make setup` checks:

- `docker` exists;
- Docker Compose is available;
- the Docker daemon is reachable;
- `infisical` exists;
- `curl` exists;
- `.infisical.json` exists;
- Infisical authentication and project access work;
- required secrets exist and pass basic format checks.

Failures must include the next corrective command, such as:

```text
Run: make infisical-init
```

### 11.2 Startup

Secret validation and Compose startup must run under the same Infisical-injected
process:

```text
infisical run --env=dev --path=/ -- sh -c \
  './scripts/check-secrets.sh && docker compose up -d --build --wait --wait-timeout 180'
```

If the installed Compose version does not support `--wait`, the Makefile must
poll the WAF and backend-through-WAF health endpoints before reporting success.

### 11.3 Lifecycle commands

Required behavior:

| Target | Infisical required? | Behavior |
| --- | --- | --- |
| `setup` | Yes | Validate, build, create, and wait for the full stack |
| `up` | Yes | Validate, create, and wait without forcing a build |
| `restart` | Yes | Recreate containers with freshly retrieved secrets |
| `build` | No | Build images; builds must not require runtime secrets |
| `down` | No | Stop local containers even if Infisical is unavailable |
| `logs` | No | Show local logs |
| `logs-waf` | No | Show WAF and audit output |
| `ps` | No | Show local container status |
| `health-check` | No | Test the running stack through the WAF |
| `test-waf` | No | Run deterministic WAF checks |
| `infisical-init` | Yes, CLI only | Log in and link the project |

`restart` should use
`docker compose up -d --build --force-recreate --wait --wait-timeout 180`
inside Infisical rather than requiring a preceding `down`.

Keep `clean` and `reset` visibly documented as destructive because they can
delete the PostgreSQL volume.

## 12. Repository changes

### 12.1 Required modified files

```text
docker-compose.yml
Makefile
.env.example
.gitignore
README.md
AGENTS.md
setup.sh
nginx/Dockerfile
nginx/conf/default.conf
backend/.env.example
backend/main.go
frontend/next.config.js
frontend/.env.example
frontend/src/app/(user)/sell/page.tsx
frontend/src/components/AIFloatingChat/AIFloatingChat.tsx
frontend/src/hooks/useWebSocket.ts
ai_service/rag.py
```

Other frontend files may be changed only if an active absolute backend URL is
found during implementation testing.

Security-related documentation containing the old known database password must
be updated so it does not instruct developers to restore the insecure
fallback. At minimum, review:

```text
DEVELOPMENT.md
PROJECT_SUMMARY.md
SETUP_COMPLETE.md
```

### 12.2 Required new files

```text
.infisical.json
scripts/check-secrets.sh
scripts/test-waf.sh
```

An optional narrow CRS exclusion file may be added only after a reproducible
false positive is observed:

```text
nginx/modsecurity/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf
```

### 12.3 `.env` safety

Keep real environment files ignored. Do not use the earlier test procedure that
renames `.env` to the unignored `.env.disabled` path.

Use a pattern equivalent to:

```gitignore
.env
.env.*
!.env.example
!**/.env.example
```

For the no-`.env` test, move the file outside the repository or confirm startup
in a fresh clone that never had one.

## 13. Functional requirements

### FR-1: One-command startup

After one-time Infisical login and project linking, `make setup` starts the
complete six-service project.

### FR-2: Clear secret failure

Startup stops before creating or recreating application containers when a
required secret is absent or invalid.

### FR-3: No secret-filled `.env` dependency

The complete project starts in a fresh clone without a real `.env` file.

### FR-4: Single public entry point

Only the WAF publishes host ports. Browser, API, upload, WebSocket, and AI-chat
browser requests enter through `http://localhost` or `https://localhost`.

### FR-5: WAF enforcement

ModSecurity and CRS are active in blocking mode at paranoia level 1. Selected
SQL-injection and XSS requests return `403`.

### FR-6: Audit evidence

`make logs-waf` shows the CRS rule match and blocking action for the selected
attack tests.

### FR-7: Existing behavior preserved

The following flows work through the WAF:

- frontend loading;
- member login;
- product list and product details;
- product create, update, and delete;
- API-key protected public product operations;
- avatar upload;
- up to six valid 10 MiB listing images in one request;
- WebSocket connection and message exchange;
- AI chat with progressive SSE output;
- administrator login and user-management actions.

### FR-8: Existing data preserved

Adopting Infisical must not implicitly delete the PostgreSQL volume or make
existing local data inaccessible without a documented password-migration path.

## 14. Automated WAF test requirements

Create `scripts/test-waf.sh`. It must:

1. Wait or retry until `https://localhost/healthz` responds.
2. Verify HTTP redirects to HTTPS.
3. Verify `GET /api/v1/status` returns `200` through HTTPS.
4. Send one URL-encoded SQL-injection payload and require `403`.
5. Send one URL-encoded XSS payload and require `403`.
6. Exit nonzero on any mismatch.
7. Print payload descriptions and HTTP statuses, not secrets.

The script must not assume the first request immediately after `up -d` will
succeed. Payloads may be updated for the pinned CRS version, but the pinned
image and the test payloads must be committed together.

The test target is:

```makefile
test-waf:
	@sh scripts/test-waf.sh
```

Audit-log verification may be a separate command because following or parsing
container logs can be environment-dependent. It remains a mandatory manual
acceptance check.

## 15. Manual regression plan

### 15.1 Infrastructure

```bash
make setup
make ps
make health-check
make test-waf
```

Verify that:

- all six services are running;
- the WAF reports healthy;
- only the WAF publishes ports;
- `https://localhost` loads after accepting the development certificate;
- `/api/v1/status` is reachable only through the WAF entry point.

### 15.2 Secrets

In a clean clone with `.infisical.json` configured:

1. Confirm there is no real `.env`.
2. Run `make setup` successfully.
3. Temporarily rename one required secret in the Infisical development
   environment.
4. Confirm `make setup` stops with a readable missing-secret message.
5. Restore the secret.

Never display secret values during the demonstration.

### 15.3 Application

Test through `https://localhost`:

1. Login and, if enabled, OTP verification.
2. Product browse, create, edit, and delete.
3. Upload six valid images whose combined size is greater than 13 MiB.
4. Upload an avatar.
5. Open WebSocket chat and exchange a message.
6. Send an AI request and confirm incremental streamed output.
7. Log in as the MVP administrator and load the admin user list.

### 15.4 Existing database volume

Test both:

- a fresh PostgreSQL volume initialized with the Infisical password; and
- an existing volume using the documented password-migration path.

## 16. False-positive policy

During integration only:

1. use `DetectionOnly`;
2. exercise every critical application flow;
3. inspect the matched rule ID and request field;
4. verify the request is legitimate;
5. add the narrowest route-, parameter-, and rule-specific exclusion;
6. restore blocking mode;
7. rerun normal and malicious tests.

Do not disable ModSecurity globally for `/api/`, uploads, WebSockets, or AI
traffic. A route-wide exclusion requires a written justification in this
document or README.

## 17. Acceptance criteria

- [ ] `make setup` starts all six services after one-time Infisical setup.
- [ ] A fresh clone starts without a real `.env` file.
- [ ] Missing `.infisical.json`, expired authentication, and missing required
      secrets produce distinct, readable failures.
- [ ] No known database-password fallback remains in active Compose or
      application code.
- [ ] Existing PostgreSQL data survives the credential migration procedure.
- [ ] Only `waf` publishes host ports.
- [ ] The WAF image is pinned to the tested version or digest.
- [ ] HTTPS terminates at the WAF and HTTP redirects to HTTPS.
- [ ] ModSecurity and OWASP CRS run in blocking mode at paranoia level 1.
- [ ] `GET /api/v1/status` returns `200` through the WAF.
- [ ] The selected SQL-injection request returns `403`.
- [ ] The selected XSS request returns `403`.
- [ ] `make logs-waf` shows the corresponding CRS rule matches.
- [ ] Browser code does not call public `localhost:8080` or `localhost:8000`.
- [ ] Valid multipart uploads above 13 MiB and up to the application limit work.
- [ ] WebSocket chat works through both proxy layers.
- [ ] AI SSE output remains progressively streamed.
- [ ] Login, marketplace CRUD, uploads, admin, and AI regression checks pass.
- [ ] `make down`, `make logs`, and `make ps` work when Infisical is unavailable.
- [ ] No secret values or WAF logs containing sensitive data are committed.

## 18. Implementation sequence

### Phase 1: Frontend and secret prerequisites

- Make browser API and WebSocket URLs same-origin.
- Remove the AI service's known database-password fallback.
- Create and share the Infisical project.
- Add and validate required secrets.
- Commit `.infisical.json` after reviewing it for project metadata only.

### Phase 2: Compose secret migration

- Remove backend `env_file`.
- Add explicit backend, AI, and PostgreSQL environment mappings.
- Remove password fallbacks.
- Add secret checks.
- Test a fresh database and the existing-volume migration.

### Phase 3: Network isolation and internal Nginx

- Remove PostgreSQL and AI host ports.
- Convert Nginx to port `8081` without TLS.
- Add upload, SSE, WebSocket, and forwarded-header settings.
- Confirm internal service connectivity.

### Phase 4: WAF

- Add the pinned CRS image.
- Start in `DetectionOnly` during compatibility testing.
- Run the full regression plan.
- Add only proven narrow exclusions.
- Commit blocking mode as `On`.

### Phase 5: Developer workflow and evidence

- Update Makefile targets and preflight messages.
- Add health and WAF test scripts.
- Update README and stale security-related setup documentation.
- Reproduce the full setup from another developer's clean clone.
- Record the exact pinned image and demonstrated payloads.

## 19. Definition of done

The feature is complete only when all acceptance criteria pass on a clean clone
and on one existing developer database volume. The evaluator must be able to:

1. see secret names in Infisical without exposing their values;
2. run `make setup`;
3. see six running services and only WAF host ports;
4. use the normal application;
5. run `make test-waf` and observe `200`, `403`, and `403` results;
6. inspect `make logs-waf` and identify the CRS blocking events;
7. hear a concise explanation of the request and secret flows.

## 20. Reference documentation

- OWASP CRS container image:
  <https://github.com/coreruleset/modsecurity-crs-docker>
- OWASP CRS container installation:
  <https://coreruleset.org/docs/1-getting-started/1-1-crs-installation/>
- Infisical CLI quickstart:
  <https://infisical.com/docs/cli/usage>
- Infisical `run` command:
  <https://infisical.com/docs/cli/commands/run>
- Infisical project configuration:
  <https://infisical.com/docs/cli/project-config>
