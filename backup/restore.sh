#!/bin/sh
# restore.sh
# Concept: a backup you've never tested restoring is not a real backup -
# it's a guess. This script restores a chosen .sql.gz file back into postgres.
#
# Usage (run this from your HOST machine terminal, not inside a container):
#   docker compose exec db sh -c 'echo see monitoring/DISASTER_RECOVERY.md'
#
# This file lives inside the backup container for reference / can be run
# manually via: docker compose exec db-backup sh /scripts/restore.sh <filename>

set -e

BACKUP_DIR="/backups"
FILENAME="$1"

if [ -z "$FILENAME" ]; then
  echo "Usage: restore.sh <backup-filename.sql.gz>"
  echo "Available backups:"
  ls -lh "$BACKUP_DIR"
  exit 1
fi

FULL_PATH="${BACKUP_DIR}/${FILENAME}"
if [ ! -f "$FULL_PATH" ]; then
  echo "ERROR: $FULL_PATH not found"
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"

echo "WARNING: this will REPLACE all current data in '$DB_NAME'."
echo "Restoring from: $FULL_PATH"

# Drop and recreate so we restore into a clean database (avoids duplicate-key
# errors from partially-overlapping data)
psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME}_restoring;"
psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "CREATE DATABASE ${DB_NAME}_restoring;"
gunzip -c "$FULL_PATH" | psql -h "$DB_HOST" -U "$DB_USER" -d "${DB_NAME}_restoring"

echo "[restore] Restored into a NEW database: ${DB_NAME}_restoring"
echo "[restore] Verify it looks correct, then follow the swap steps in"
echo "[restore] monitoring/DISASTER_RECOVERY.md to promote it to the real '$DB_NAME'."
