#!/bin/sh
# entrypoint.sh
# Concept: instead of using cron (extra moving part, harder to debug inside
# a container), we use a simple infinite loop: run backup, sleep, repeat.
# Easy to read, easy to explain in an evaluation, easy to debug (just check
# this container's logs).

set -e

INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-21600}"  # default: every 6 hours

echo "[entrypoint] Backup service starting. Interval: ${INTERVAL_SECONDS}s"

# Run one backup immediately on startup, so you don't wait 6 hours to see
# it working for the first time.
./backup.sh

while true; do
  sleep "$INTERVAL_SECONDS"
  ./backup.sh
done
