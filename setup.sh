#!/bin/sh

set -eu

echo "ℹ️  setup.sh now uses the canonical Infisical + WAF workflow: make setup"
exec make setup "$@"
