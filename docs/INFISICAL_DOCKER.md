# Non-interactive Dockerized Infisical

The project retrieves runtime secrets with the official
`infisical/cli:0.43.113` Docker image. No host Infisical installation, browser
login, permanent CLI container, or `sudo` access is required.

## Requirements

- Docker with Docker Compose v2
- Make
- The repository's committed `.infisical.json`
- A read-only Infisical programmatic access token scoped to this project and
  its `dev` environment

Anyone who obtains the token can retrieve every secret it is permitted to
access. Store and share it accordingly.

## Initial setup

```bash
git clone <repository-url>
cd ft_transcendance_main
make infisical-auth-init
nano .env.infisical-auth
chmod 600 .env.infisical-auth
make setup
```

The authentication file must contain:

```dotenv
INFISICAL_TOKEN=<your-project-scoped-token>
```

`make infisical-auth-init` copies `.env.infisical-auth.example`, sets mode
`600`, and never overwrites an existing file. It does not ask for or display
the token.

Useful authentication-file commands:

```bash
make infisical-auth-check
make infisical-auth-clear
```

The clear command removes only `.env.infisical-auth`. It does not touch
containers, PostgreSQL volumes, `.infisical.json`, or application data.

## Normal usage

```bash
make setup
make up
make restart
make down
```

`make setup`, `make up`, `make restart`, `make reset`, and
`make check-secrets` are non-interactive. They:

1. Validate `.env.infisical-auth` without printing its token.
2. Read the project ID from `.infisical.json`.
3. Pass the token file to a temporary `infisical/cli:0.43.113` container.
4. Export secrets from environment `dev` and path `/`.
5. Atomically create `.env.infisical` with mode `600`.
6. Validate the exported values with `scripts/check-secrets.sh`.
7. Run the requested Compose command.
8. Remove `.env.infisical` on success, failure, or interruption.

The persistent `.env.infisical-auth` file is never removed by normal startup.
The generated `.env.infisical` file is temporary. Both real files are explicitly
ignored by Git and must never be committed.

## Security boundary

Secrets are passed to Compose only while containers are created or recreated.
They remain in the relevant container environments afterward, so anyone with
sufficient Docker daemon access may inspect them. Docker access is privileged
access.

Infisical is only a launcher. It is not installed in the backend, frontend, AI,
PostgreSQL, Nginx, or WAF images and is not a permanent Compose service.

## Configuration

Defaults can be overridden when necessary:

```bash
make up INFISICAL_ENV=dev INFISICAL_PATH=/
```

```text
INFISICAL_CLI_IMAGE=infisical/cli:0.43.113
INFISICAL_ENV=dev
INFISICAL_PATH=/
```

## Troubleshooting

If the authentication file is missing:

```bash
make infisical-auth-init
```

If authentication validation fails:

```bash
chmod 600 .env.infisical-auth
make infisical-auth-check
```

An invalid or expired token must be replaced in `.env.infisical-auth`. The
startup workflow will fail without opening a browser or prompting for a
password.

The following shared secrets must exist at path `/` in `dev`:

```text
DB_PASSWORD
JWT_SECRET
ADMIN_PASSWORD_HASH
DEEPSEEK_API_KEY
OPENROUTER_API_KEY
```

`BREVO_API_KEY` is additionally required when `REQUIRE_BREVO=1`.
