#!/bin/sh

set -u

required_variables="
DB_PASSWORD
JWT_SECRET
ADMIN_PASSWORD_HASH
DEEPSEEK_API_KEY
OPENROUTER_API_KEY
"

if [ "${REQUIRE_BREVO:-0}" = "1" ]; then
	required_variables="$required_variables
BREVO_API_KEY"
fi

missing=0

for variable in $required_variables; do
	eval "value=\${$variable-}"
	if [ -z "$value" ]; then
		echo "❌ Missing required Infisical secret: $variable"
		missing=1
	fi
done

if [ "$missing" -ne 0 ]; then
	exit 1
fi

if [ "${#JWT_SECRET}" -lt 32 ]; then
	echo "❌ Invalid Infisical secret: JWT_SECRET must be at least 32 characters."
	exit 1
fi

case "$ADMIN_PASSWORD_HASH" in
	'$2a$'*|'$2b$'*|'$2y$'*)
		;;
	*)
		echo "❌ Invalid Infisical secret: ADMIN_PASSWORD_HASH must be a bcrypt hash."
		exit 1
		;;
esac

echo "✅ Required Infisical secrets are available and valid."
