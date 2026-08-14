#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

INFISICAL_CLI_IMAGE=${INFISICAL_CLI_IMAGE:-infisical/cli:0.43.113}
INFISICAL_ENV=${INFISICAL_ENV:-dev}
INFISICAL_PATH=${INFISICAL_PATH:-/}
AUTH_FILE=$PROJECT_ROOT/.env.infisical-auth
ENV_FILE=$PROJECT_ROOT/.env.infisical
TEMP_FILE=

cleanup() {
	if [ -n "$TEMP_FILE" ]; then
		rm -f "$TEMP_FILE"
	fi
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ ! -f "$PROJECT_ROOT/.infisical.json" ]; then
	echo "❌ Missing .infisical.json. This clone is not linked to the team Infisical project." >&2
	exit 1
fi

command -v docker >/dev/null 2>&1 || {
	echo "❌ Docker is not installed or not available in this shell." >&2
	exit 1
}

docker info >/dev/null 2>&1 || {
	echo "❌ The Docker daemon is not reachable. Start Docker and try again." >&2
	exit 1
}

PROJECT_ID=$(
	sed -n 's/^[[:space:]]*"workspaceId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
		"$PROJECT_ROOT/.infisical.json"
)

if [ -z "$PROJECT_ID" ]; then
	echo "❌ Could not read workspaceId from .infisical.json." >&2
	exit 1
fi

rm -f "$ENV_FILE"
"$SCRIPT_DIR/check-infisical-auth.sh"

umask 077
TEMP_FILE=$(mktemp "$PROJECT_ROOT/.env.infisical.tmp.XXXXXX") || {
	echo "❌ Could not create the temporary Infisical environment file." >&2
	exit 1
}
chmod 600 "$TEMP_FILE"

#
if ! docker run --rm \
	--env-file "$AUTH_FILE" \
	--env INFISICAL_DISABLE_UPDATE_CHECK=true \
	"$INFISICAL_CLI_IMAGE" export \
		--projectId="$PROJECT_ID" \
		--env="$INFISICAL_ENV" \
		--path="$INFISICAL_PATH" \
		--format=dotenv \
		--silent >"$TEMP_FILE"; then
	echo "❌ Infisical secret export failed. Check the token and its project access." >&2
	exit 1
fi

if [ ! -s "$TEMP_FILE" ]; then
	echo "❌ Infisical returned an empty secret export." >&2
	exit 1
fi

chmod 600 "$TEMP_FILE"
mv -f "$TEMP_FILE" "$ENV_FILE"
trap - EXIT HUP INT TERM

echo "✅ Infisical secrets were exported to a protected temporary environment file."



#for this file, the roles is to fetch, which is talk to infiiscal and write a temp dotenv
# the execution only happen in this @with-infisical-env.sh

# Fetch only: talk to Infisical and write a temp dotenv.
# Orchestration is scripts/with-infisical-env.sh (line 27). This comment is not a link.