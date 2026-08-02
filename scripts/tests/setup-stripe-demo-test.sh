#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

# shellcheck source=../stripe-listener-lib.sh
. "$PROJECT_ROOT/scripts/stripe-listener-lib.sh"

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

assert_extracts() {
	expected=$1
	input=$2
	actual=$(printf '%b' "$input" | stripe_extract_listener_secret) ||
		fail "expected listener secret extraction to succeed"
	[ "$actual" = "$expected" ] ||
		fail "secret extraction returned an unexpected value"
}

assert_extract_status() {
	expected_status=$1
	input=$2
	actual_status=0
	printf '%b' "$input" | stripe_extract_listener_secret >/dev/null ||
		actual_status=$?
	[ "$actual_status" -eq "$expected_status" ] ||
		fail "expected extraction status $expected_status, got $actual_status"
}

assert_extracts \
	"whsec_abc123" \
	"> Ready! Your webhook signing secret is whsec_abc123 (^C to quit)\n"
assert_extracts \
	"whsec_CRLF987" \
	"  > Ready! Your webhook signing secret is   whsec_CRLF987   (^C to quit)\r\n"
assert_extract_status 3 \
	"> Ready! Your webhook signing secret is invalid_secret (^C to quit)\n"
assert_extract_status 2 \
	"Stripe listener is still connecting\n"

test_root=$(mktemp -d)
cleanup_test() {
	rm -rf "$test_root"
}
trap cleanup_test EXIT HUP INT TERM

fake_docker=$test_root/docker
cat >"$fake_docker" <<'EOF'
#!/bin/sh
set -eu

arguments=$*
case "$arguments" in
	*"compose "*"logs --no-color stripe-cli"*)
		printf '%b\n' "${FAKE_LISTENER_OUTPUT-}"
		;;
	*"compose "*"ps -q stripe-cli"*)
		printf '%s\n' "listener-container"
		;;
	*"compose "*"ps -q backend"*)
		printf '%s\n' "backend-container"
		;;
	*"compose "*"config --services"*)
		printf '%s\n' db stripe-cli backend frontend
		;;
	*"compose "*"up -d "*"stripe-cli"*)
		exit "${FAKE_LISTENER_START_STATUS:-0}"
		;;
	*"compose "*"up -d "*"--wait --wait-timeout 180"*)
		exit "${FAKE_REMAINING_UP_STATUS:-0}"
		;;
	*"compose "*)
		exit "${FAKE_COMPOSE_STATUS:-0}"
		;;
	*"inspect --format {{.State.Running}} listener-container"*)
		printf '%s\n' "${FAKE_LISTENER_RUNNING:-true}"
		;;
	*"inspect --format {{range .Config.Env}}{{println .}}{{end}} backend-container"*)
		printf 'STRIPE_WEBHOOK_SECRET=%s\n' "${FAKE_SECRET-}"
		;;
	*)
		echo "unexpected fake docker arguments: $arguments" >&2
		exit 90
		;;
esac
EOF
chmod 755 "$fake_docker"

new_env_file() {
	env_file=$test_root/stripe-env-$1
	printf '%s\n' \
		'STRIPE_SECRET_KEY=sk_test_fake' \
		'STRIPE_TEST_CONNECTED_ACCOUNT_ID=acct_fake' \
		'STRIPE_TEST_SELLER_EMAIL=demo@example.com' \
		'STRIPE_SUCCESS_URL=https://localhost:8443/cart' \
		'STRIPE_CANCEL_URL=https://localhost:8443/cart' >"$env_file"
	chmod 600 "$env_file"
	printf '%s\n' "$env_file"
}

success_env=$(new_env_file success)
success_output=$(
	FAKE_SECRET=whsec_success123 \
	FAKE_LISTENER_OUTPUT="> Ready! Your webhook signing secret is whsec_success123 (^C to quit)\r\n" \
	FAKE_LISTENER_RUNNING=true \
	STRIPE_ENV_FILE="$success_env" \
	STRIPE_SETUP_DOCKER_BIN="$fake_docker" \
	STRIPE_LISTENER_TIMEOUT=1 \
		"$PROJECT_ROOT/scripts/setup-stripe-demo.sh" setup
)
case "$success_output" in
	*whsec_success123*)
		fail "successful setup displayed the complete signing secret"
		;;
esac
[ ! -e "$success_env" ] || fail "successful setup did not clean its temporary env file"
if find "$test_root" -name 'stripe-env-success.stripe.*' -print | grep -q .; then
	fail "successful setup left a temporary rewrite file"
fi

failure_env=$(new_env_file failure)
if FAKE_SECRET=whsec_unused \
	FAKE_LISTENER_OUTPUT="Stripe authentication failed\n" \
	FAKE_LISTENER_RUNNING=false \
	STRIPE_ENV_FILE="$failure_env" \
	STRIPE_SETUP_DOCKER_BIN="$fake_docker" \
	STRIPE_LISTENER_TIMEOUT=1 \
	"$PROJECT_ROOT/scripts/setup-stripe-demo.sh" setup >/dev/null 2>&1; then
	fail "listener command failure was unexpectedly accepted"
fi
[ ! -e "$failure_env" ] || fail "failed setup did not clean its temporary env file"

missing_readiness_env=$(new_env_file missing-readiness)
if FAKE_SECRET=whsec_unused \
	FAKE_LISTENER_OUTPUT="Stripe listener is still connecting\n" \
	FAKE_LISTENER_RUNNING=true \
	STRIPE_ENV_FILE="$missing_readiness_env" \
	STRIPE_SETUP_DOCKER_BIN="$fake_docker" \
	STRIPE_LISTENER_TIMEOUT=1 \
	"$PROJECT_ROOT/scripts/setup-stripe-demo.sh" setup >/dev/null 2>&1; then
	fail "missing listener readiness output was unexpectedly accepted"
fi
[ ! -e "$missing_readiness_env" ] ||
	fail "readiness timeout did not clean its temporary env file"

command_failure_env=$(new_env_file command-failure)
if FAKE_LISTENER_START_STATUS=17 \
	STRIPE_ENV_FILE="$command_failure_env" \
	STRIPE_SETUP_DOCKER_BIN="$fake_docker" \
	STRIPE_LISTENER_TIMEOUT=1 \
	"$PROJECT_ROOT/scripts/setup-stripe-demo.sh" setup >/dev/null 2>&1; then
	fail "listener start command failure was unexpectedly accepted"
fi
[ ! -e "$command_failure_env" ] ||
	fail "listener command failure did not clean its temporary env file"

backend_failure_env=$(new_env_file backend-failure)
if FAKE_SECRET=whsec_backendfailure \
	FAKE_LISTENER_OUTPUT="> Ready! Your webhook signing secret is whsec_backendfailure (^C to quit)\n" \
	FAKE_LISTENER_RUNNING=true \
	FAKE_REMAINING_UP_STATUS=19 \
	STRIPE_ENV_FILE="$backend_failure_env" \
	STRIPE_SETUP_DOCKER_BIN="$fake_docker" \
	STRIPE_LISTENER_TIMEOUT=1 \
	"$PROJECT_ROOT/scripts/setup-stripe-demo.sh" setup >/dev/null 2>&1; then
	fail "backend startup failure was unexpectedly accepted"
fi
[ ! -e "$backend_failure_env" ] ||
	fail "backend startup failure did not clean its temporary env file"
if find "$test_root" -name 'stripe-env-backend-failure.stripe.*' -print | grep -q .; then
	fail "backend startup failure left a temporary rewrite file"
fi

echo "Stripe setup script tests passed."
