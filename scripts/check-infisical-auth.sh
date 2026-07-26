#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
AUTH_FILE=$PROJECT_ROOT/.env.infisical-auth

if [ ! -f "$AUTH_FILE" ]; then
	echo "Missing .env.infisical-auth." >&2
	echo "Run: make infisical-auth-init" >&2
	echo "Then place your Infisical token in the file." >&2
	exit 1
fi

if mode=$(stat -c '%a' "$AUTH_FILE" 2>/dev/null); then
	if [ "$mode" != "600" ]; then
		echo "Invalid permissions on .env.infisical-auth. Run: chmod 600 .env.infisical-auth" >&2
		exit 1
	fi
fi

token_state=$(
	awk '
		BEGIN {
			state = "missing"
			count = 0
		}
		{
			line = $0
			sub(/\r$/, "", line)
			if (line !~ /^[[:space:]]*INFISICAL_TOKEN[[:space:]]*=/) {
				next
			}

			sub(/^[[:space:]]*INFISICAL_TOKEN[[:space:]]*=[[:space:]]*/, "", line)
			sub(/[[:space:]]*$/, "", line)
			count++

			if ((line ~ /^".*"$/) || (line ~ /^\047.*\047$/)) {
				line = substr(line, 2, length(line) - 2)
			}

			if (line == "" || line == "CHANGEME" || line == "changeme" || line == "replace-me" || line == "<valid Infisical programmatic access token>") {
				state = "empty"
			} else {
				state = "valid"
			}
		}
		END {
			if (count == 1) {
				print state
			} else {
				print "invalid"
			}
		}
	' "$AUTH_FILE"
)

case "$token_state" in
	valid)
		echo "✅ Infisical token file is present and protected."
		;;
	*)
		echo "Invalid .env.infisical-auth: INFISICAL_TOKEN is missing, empty, or still a placeholder." >&2
		exit 1
		;;
esac
