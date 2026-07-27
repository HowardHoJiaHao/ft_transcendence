#!/bin/sh
# backup.sh
# Concept: pg_dump takes a full snapshot of the database into one file.
# We keep the last N days, deleting older ones, so disk doesn't fill up forever.

set -e

BACKUP_DIR="/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="${BACKUP_DIR}/transcendence_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting backup at $(date)"

# PGPASSWORD env var lets pg_dump authenticate without a password prompt
export PGPASSWORD="$DB_PASSWORD"

pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" | gzip > "$FILENAME"

METRICS_DIR="/metrics"
METRICS_FILE="${METRICS_DIR}/backup.prom"

if [ -s "$FILENAME" ]; then
  echo "[backup] Success: $FILENAME ($(du -h "$FILENAME" | cut -f1))"
  # Write a Prometheus textfile metric: node-exporter picks this up automatically.
  # This is the standard, reliable way to monitor "did my scheduled job run" -
  # independent of container names/IDs (which cAdvisor doesn't expose consistently
  # on all Docker setups, e.g. Docker Desktop on Mac).
  mkdir -p "$METRICS_DIR"
  cat > "${METRICS_FILE}.tmp" <<EOF
# HELP backup_last_success_timestamp_seconds Unix timestamp of the last successful backup
# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds $(date +%s)
# HELP backup_last_success_size_bytes Size in bytes of the last successful backup file
# TYPE backup_last_success_size_bytes gauge
backup_last_success_size_bytes $(stat -c%s "$FILENAME" 2>/dev/null || stat -f%z "$FILENAME")
EOF
  mv "${METRICS_FILE}.tmp" "$METRICS_FILE"   # atomic write, avoids node-exporter reading a half-written file
else
  echo "[backup] FAILED: backup file is empty or missing"
  exit 1
fi

# Delete backups older than retention period
find "$BACKUP_DIR" -name "transcendence_*.sql.gz" -mtime "+${RETENTION_DAYS}" -exec rm {} \;
echo "[backup] Cleaned up backups older than ${RETENTION_DAYS} days"

echo "[backup] Current backups:"
ls -lh "$BACKUP_DIR"
