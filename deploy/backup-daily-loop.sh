#!/usr/bin/env bash
# Nightly daily-loop Postgres backup (same approach as ChaiHouse's backup.sh).
# Installed at /opt/daily-loop/backup.sh, run by root's cron at 03:15 UTC. Keeps 14 daily dumps.
set -euo pipefail

DIR=/opt/daily-loop
BACKUPS=$DIR/backups
KEEP_DAYS=14
STAMP=$(date +%Y%m%d-%H%M%S)
OUT=$BACKUPS/daily-loop-$STAMP.sql.gz

mkdir -p "$BACKUPS"
cd "$DIR"

# Dump through the running container, so no Postgres tools are needed on the host.
# IMAGE_TAG is required by the compose file but irrelevant for exec on the db service.
if ! IMAGE_TAG=$(cat current_tag) docker compose -f docker-compose.prod.yml exec -T db \
      pg_dump -U daily_loop -d daily_loop --clean --if-exists \
   | gzip > "$OUT"; then
  echo "$(date -Is) BACKUP FAILED" >> "$DIR/backup.log"
  rm -f "$OUT"
  exit 1
fi

SIZE=$(stat -c %s "$OUT")
# A dump under 1 KB means something went wrong (empty or truncated).
if [ "$SIZE" -lt 1024 ]; then
  echo "$(date -Is) BACKUP SUSPICIOUS: only ${SIZE}B" >> "$DIR/backup.log"
fi

find "$BACKUPS" -name 'daily-loop-*.sql.gz' -mtime +$KEEP_DAYS -delete
echo "$(date -Is) ok ${SIZE}B $(basename "$OUT")" >> "$DIR/backup.log"
