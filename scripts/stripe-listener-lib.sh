#!/bin/sh

stripe_secret_is_valid() {
	case "${1-}" in
		whsec_*)
			stripe_secret_suffix=${1#whsec_}
			case "$stripe_secret_suffix" in
				''|*[!A-Za-z0-9]*)
					return 1
					;;
				*)
					return 0
					;;
			esac
			;;
		*)
			return 1
			;;
	esac
}

# Prints the secret only to its caller. Exit status 2 means no readiness line
# was present; status 3 means readiness was present but its secret was invalid.
stripe_extract_listener_secret() {
	stripe_listener_output=$(tr -d '\r')
	if ! printf '%s\n' "$stripe_listener_output" | grep -q 'Ready!'; then
		return 2
	fi

	stripe_extracted_secret=$(
		printf '%s\n' "$stripe_listener_output" |
			sed -n 's/.*webhook signing secret is[[:space:]]*\(whsec_[A-Za-z0-9]*\).*/\1/p' |
			tail -n 1
	)
	if ! stripe_secret_is_valid "$stripe_extracted_secret"; then
		return 3
	fi
	printf '%s\n' "$stripe_extracted_secret"
}
