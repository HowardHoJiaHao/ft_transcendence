#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

ENV_FILE=$PROJECT_ROOT/.env.infisical #temp secrets path
LOCAL_ENV_FILE=$PROJECT_ROOT/.env #optional local backup of the secrets
SECRETS=${SECRETS:-infisical} #infisical (fall back to .env) or env (.env only)
REQUIRE_BREVO=${REQUIRE_BREVO:-0} #other checks
REQUIRE_STRIPE=${REQUIRE_STRIPE:-0}
REQUIRE_STRIPE_CLI=${REQUIRE_STRIPE_CLI:-0}
#delete after use, for temp env file
cleanup() {
	rm -f "$ENV_FILE"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
#command for makefile
if [ "$#" -eq 0 ]; then
	echo "Usage: $0 command [argument ...]" >&2
	exit 2
fi
#copy .env to the temp path; the scripts after this delete the temp file, never .env
use_local_env() {
	umask 077
	tr -d '\r' <"$LOCAL_ENV_FILE" >"$ENV_FILE"
	chmod 600 "$ENV_FILE"
	echo "✅ Using secrets from the local .env file."
}
#fetch secret
case "$SECRETS" in
	infisical)
		if ! "$SCRIPT_DIR/infisical-export.sh"; then
			if [ ! -f "$LOCAL_ENV_FILE" ]; then
				exit 1
			fi
			echo "⚠️  Infisical is unavailable; falling back to the local .env file." >&2
			use_local_env
		fi
		;;
	env)
		if [ ! -f "$LOCAL_ENV_FILE" ]; then
			echo "❌ SECRETS=env but .env is missing. Run: make env-backup, or copy .env.example to .env." >&2
			exit 1
		fi
		use_local_env
		;;
	*)
		echo "❌ Unknown SECRETS=$SECRETS (use infisical or env)." >&2
		exit 2
		;;
esac

# Infisical's dotenv formatter quotes values. Load the generated file only in a
# validation subshell so the secrets do not remain in the launcher environment.
(
	set -a
	# shellcheck disable=SC1090
	. "$ENV_FILE"
	set +a
	REQUIRE_BREVO="$REQUIRE_BREVO" \
		REQUIRE_STRIPE="$REQUIRE_STRIPE" \
		REQUIRE_STRIPE_CLI="$REQUIRE_STRIPE_CLI" \
		"$SCRIPT_DIR/check-secrets.sh"
)
#run command
cd "$PROJECT_ROOT"
"$@"

#this is about the execution
#action : fetch secret, check names, run command that i passed, delete .env.inifisical