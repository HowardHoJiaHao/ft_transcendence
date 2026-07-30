#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE=$PROJECT_ROOT/.env.infisical

if [ ! -f "$ENV_FILE" ]; then
	echo "❌ Missing temporary Infisical environment file." >&2
	exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

echo "Checking the Stripe CLI webhook signing secret..."
listener_secret=$(
	docker compose --env-file "$ENV_FILE" --profile stripe \
		run --rm --no-deps stripe-cli listen --print-secret |
		tr -d '\r' |
		sed -n 's/.*\(whsec_[[:alnum:]_]*\).*/\1/p' |
		tail -n 1
)

if [ -z "$listener_secret" ]; then
	echo "❌ Stripe CLI did not return a webhook signing secret." >&2
	exit 1
fi

if [ "$listener_secret" != "$STRIPE_WEBHOOK_SECRET" ]; then
	echo "❌ STRIPE_WEBHOOK_SECRET does not match the Stripe CLI listener." >&2
	echo "Run 'make stripe-listen', update the displayed whsec_ value in Infisical, then retry." >&2
	exit 1
fi

echo "✅ Stripe webhook signing secret matches Infisical."
docker compose --env-file "$ENV_FILE" --profile stripe \
	up -d --build --force-recreate --wait --wait-timeout 180
