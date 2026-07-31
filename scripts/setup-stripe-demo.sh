#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE=${STRIPE_ENV_FILE:-$PROJECT_ROOT/.env.infisical}
DOCKER_BIN=${STRIPE_SETUP_DOCKER_BIN:-docker}
LISTENER_TIMEOUT=${STRIPE_LISTENER_TIMEOUT:-60}
MODE=${1:-setup}
NEXT_ENV_FILE=

# shellcheck source=./stripe-listener-lib.sh
. "$SCRIPT_DIR/stripe-listener-lib.sh"

cleanup() {
	if [ -n "$NEXT_ENV_FILE" ]; then
		rm -f "$NEXT_ENV_FILE"
	fi
	rm -f "$ENV_FILE"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

compose() {
	"$DOCKER_BIN" compose --env-file "$ENV_FILE" --profile stripe "$@"
}

container_is_running() {
	[ "$("$DOCKER_BIN" inspect --format '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]
}

if [ ! -f "$ENV_FILE" ]; then
	echo "❌ Missing protected temporary Infisical environment file." >&2
	exit 1
fi
chmod 600 "$ENV_FILE"

case "$MODE" in
	setup|restart)
		remaining_up_options="--build --force-recreate"
		;;
	up)
		remaining_up_options="--force-recreate"
		;;
	*)
		echo "Usage: $0 [setup|up|restart]" >&2
		exit 2
		;;
esac

echo "Starting PostgreSQL and the persistent Stripe listener..."
if ! compose up -d db; then
	echo "❌ PostgreSQL failed to start." >&2
	exit 1
fi
# Prevent an already-running backend from receiving signatures from a newly
# created listener before it has the newly generated verification secret.
compose stop backend >/dev/null 2>&1 || true
if ! compose up -d --force-recreate stripe-cli; then
	echo "❌ Stripe listener command failed to start." >&2
	exit 1
fi

listener_id=$(compose ps -q stripe-cli)
if [ -z "$listener_id" ]; then
	echo "❌ Stripe listener container was not created." >&2
	exit 1
fi

listener_secret=
attempt=0
while [ "$attempt" -lt "$LISTENER_TIMEOUT" ]; do
	listener_logs=$(compose logs --no-color stripe-cli 2>/dev/null || true)
	extract_status=0
	if listener_secret=$(printf '%s\n' "$listener_logs" | stripe_extract_listener_secret); then
		break
	else
		extract_status=$?
	fi

	if [ "$extract_status" -eq 3 ]; then
		echo "❌ Stripe listener became ready but returned an invalid signing secret." >&2
		exit 1
	fi
	if ! container_is_running "$listener_id"; then
		echo "❌ Stripe listener exited before readiness; check Stripe authentication and listener arguments." >&2
		exit 1
	fi
	attempt=$((attempt + 1))
	sleep 1
done

if [ -z "$listener_secret" ]; then
	echo "❌ Stripe listener readiness output was not found within ${LISTENER_TIMEOUT}s." >&2
	exit 1
fi
if ! stripe_secret_is_valid "$listener_secret"; then
	echo "❌ Stripe listener signing secret is invalid." >&2
	exit 1
fi

NEXT_ENV_FILE=$(mktemp "${ENV_FILE}.stripe.XXXXXX")
chmod 600 "$NEXT_ENV_FILE"
sed '/^STRIPE_WEBHOOK_SECRET=/d' "$ENV_FILE" >"$NEXT_ENV_FILE"
printf '\nSTRIPE_WEBHOOK_SECRET=%s\n' "$listener_secret" >>"$NEXT_ENV_FILE"
mv -f "$NEXT_ENV_FILE" "$ENV_FILE"
NEXT_ENV_FILE=
chmod 600 "$ENV_FILE"

remaining_services=$(
	compose config --services |
		sed -e '/^db$/d' -e '/^stripe-cli$/d'
)
if [ -z "$remaining_services" ]; then
	echo "❌ No application services were resolved from Docker Compose." >&2
	exit 1
fi

echo "Starting the backend and remaining services with the generated webhook secret..."
# Service names come from Docker Compose and are intentionally word-split.
# shellcheck disable=SC2086
if ! compose up -d $remaining_up_options --wait --wait-timeout 180 $remaining_services; then
	echo "❌ Application services failed to become healthy with the generated Stripe secret." >&2
	exit 1
fi

running_listener_id=$(compose ps -q stripe-cli)
if [ "$running_listener_id" != "$listener_id" ] ||
	! container_is_running "$running_listener_id"; then
	echo "❌ The original Stripe listener is no longer running." >&2
	exit 1
fi

backend_id=$(compose ps -q backend)
if [ -z "$backend_id" ]; then
	echo "❌ Backend container was not created." >&2
	exit 1
fi
backend_secret=$(
	"$DOCKER_BIN" inspect \
		--format '{{range .Config.Env}}{{println .}}{{end}}' "$backend_id" |
		sed -n 's/^STRIPE_WEBHOOK_SECRET=//p' |
		tail -n 1
)
if [ "$backend_secret" != "$listener_secret" ]; then
	echo "❌ Backend did not receive the active listener's signing secret." >&2
	exit 1
fi

echo "✅ Stripe listener and backend share the generated signing secret."
echo "✅ Persistent Stripe webhook forwarding is running."
