#!/bin/sh

set -u

BASE_URL=${BASE_URL:-https://localhost}
HTTP_URL=${HTTP_URL:-http://localhost}
CURL_TIMEOUT=${CURL_TIMEOUT:-10}
WAIT_ATTEMPTS=${WAIT_ATTEMPTS:-30}

request_status()
{
	url=$1
	status=$(curl -ksS --max-time "$CURL_TIMEOUT" -o /dev/null -w "%{http_code}" "$url") || status=000
	printf '%s' "$status"
}

wait_for_waf()
{
	attempt=1
	while [ "$attempt" -le "$WAIT_ATTEMPTS" ]; do
		status=$(request_status "$BASE_URL/healthz")
		if [ "$status" = "200" ]; then
			echo "✅ WAF health endpoint is ready."
			return 0
		fi
		attempt=$((attempt + 1))
		sleep 2
	done

	echo "❌ WAF did not become ready after $WAIT_ATTEMPTS attempts."
	return 1
}

test_status()
{
	description=$1
	expected=$2
	url=$3
	actual=$(request_status "$url")

	printf '%-35s expected=%s actual=%s\n' "$description" "$expected" "$actual"
	[ "$actual" = "$expected" ]
}

test_redirect()
{
	actual=$(curl -sS --max-time "$CURL_TIMEOUT" -o /dev/null -w "%{http_code}" "$HTTP_URL/") || actual=000
	printf '%-35s expected=301/308 actual=%s\n' "HTTP to HTTPS redirect" "$actual"
	[ "$actual" = "301" ] || [ "$actual" = "308" ]
}

wait_for_waf || exit 1

failed=0

test_redirect || failed=1
test_status \
	"Normal backend request" \
	"200" \
	"$BASE_URL/api/v1/status" || failed=1
test_status \
	"SQL injection request" \
	"403" \
	"$BASE_URL/api/v1/products?id=1%27%20OR%201%3D1%2D%2D" || failed=1
test_status \
	"XSS request" \
	"403" \
	"$BASE_URL/?q=%3Cscript%3Ealert%281%29%3C%2Fscript%3E" || failed=1

if [ "$failed" -ne 0 ]; then
	echo "❌ One or more WAF tests failed."
	exit 1
fi

echo "✅ WAF tests passed. Use 'make logs-waf' to inspect the CRS rule matches."
