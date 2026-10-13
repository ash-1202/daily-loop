#!/usr/bin/env bash
# Daily chart cards + challenges for the next 7 days.
# Installed at /opt/daily-loop/generate.sh, run by root's cron at 13:00 UTC = 18:30 IST, after the
# market has closed and the day's prices are final. Runs inside the live app container, so it
# always uses the deployed version of the code. Safe to run any number of times.
set -euo pipefail

DIR=/opt/daily-loop
LOG=$DIR/generate.log
cd "$DIR"

{
  echo "== $(date -Is)"
  IMAGE_TAG=$(cat current_tag) docker compose -f docker-compose.prod.yml \
    exec -T daily-loop-app node apps/api/dist/generate.js
} >> "$LOG" 2>&1 || echo "$(date -Is) GENERATION FAILED (see above)" >> "$LOG"

# Keep the log small.
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
