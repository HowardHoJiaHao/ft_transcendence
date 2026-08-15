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

if [ "${REQUIRE_STRIPE:-0}" = "1" ]; then
	required_variables="$required_variables
STRIPE_SECRET_KEY
STRIPE_TEST_CONNECTED_ACCOUNT_ID
STRIPE_TEST_SELLER_EMAIL
STRIPE_SUCCESS_URL
STRIPE_CANCEL_URL"
elif [ "${REQUIRE_STRIPE_CLI:-0}" = "1" ]; then
	required_variables="$required_variables
STRIPE_SECRET_KEY"
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

if [ -n "${STRIPE_SECRET_KEY-}" ]; then
	case "$STRIPE_SECRET_KEY" in
		sk_test_*)
			;;
		*)
			echo "❌ Invalid Infisical secret: STRIPE_SECRET_KEY must start with sk_test_."
			exit 1
			;;
	esac
fi

if [ -n "${STRIPE_TEST_CONNECTED_ACCOUNT_ID-}" ]; then
	case "$STRIPE_TEST_CONNECTED_ACCOUNT_ID" in
		acct_*)
			;;
		*)
			echo "❌ Invalid Infisical value: STRIPE_TEST_CONNECTED_ACCOUNT_ID must start with acct_."
			exit 1
			;;
	esac
fi

if [ -n "${STRIPE_WEBHOOK_SECRET-}" ]; then
	case "$STRIPE_WEBHOOK_SECRET" in
		whsec_*)
			;;
		*)
			echo "❌ Invalid Infisical secret: STRIPE_WEBHOOK_SECRET must start with whsec_."
			exit 1
			;;
	esac
fi

if [ -n "${STRIPE_TEST_SELLER_EMAIL-}" ]; then
	case "$STRIPE_TEST_SELLER_EMAIL" in
		*[[:space:]]*|*@*@*)
			echo "❌ Invalid Infisical value: STRIPE_TEST_SELLER_EMAIL must be an email-like value."
			exit 1
			;;
		?*@?*.?*)
			;;
		*)
			echo "❌ Invalid Infisical value: STRIPE_TEST_SELLER_EMAIL must be an email-like value."
			exit 1
			;;
	esac
fi

for stripe_url_name in STRIPE_SUCCESS_URL STRIPE_CANCEL_URL; do
	eval "stripe_url=\${$stripe_url_name-}"
	if [ -n "$stripe_url" ]; then
		case "$stripe_url" in
			https://*)
				;;
			*)
				echo "❌ Invalid Infisical value: $stripe_url_name must be an HTTPS URL."
				exit 1
				;;
		esac
	fi
done

echo "✅ Required Infisical secrets are available and valid."

#this is about 