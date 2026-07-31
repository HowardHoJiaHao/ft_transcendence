#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

ENV_FILE=$PROJECT_ROOT/.env.infisical
REQUIRE_BREVO=${REQUIRE_BREVO:-0}
REQUIRE_STRIPE=${REQUIRE_STRIPE:-0}
REQUIRE_STRIPE_CLI=${REQUIRE_STRIPE_CLI:-0}

cleanup() {
	rm -f "$ENV_FILE"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$#" -eq 0 ]; then
	echo "Usage: $0 command [argument ...]" >&2
	exit 2
fi

"$SCRIPT_DIR/infisical-export.sh"

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

cd "$PROJECT_ROOT"
"$@"
