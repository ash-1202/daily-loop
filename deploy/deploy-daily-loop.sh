#!/usr/bin/env bash
# Deploys one daily-loop image (by git commit sha) and rolls back automatically if it fails.
# Installed as /usr/local/bin/deploy-daily-loop (root-owned). GitHub Actions reaches it only
# through daily-loop-ssh-gate, which allows nothing else.
#
#   deploy-daily-loop <40-char commit sha>
#
# Steps: pull image → start db → migrate → seed → start app → wait healthy → record tag.
# Any failure after the app was replaced → start the previous tag again and exit non-zero.
# Only the "daily-loop" compose project is touched; ChaiHouse containers are never restarted.
set -euo pipefail

APP_DIR=${DAILY_LOOP_DIR:-/opt/daily-loop}
IMAGE_REPO=ghcr.io/ash-1202/daily-loop
HEALTH_URL=http://127.0.0.1:3200/api/health
KEEP_IMAGES=3

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
die() { log "ERROR: $*"; exit 1; }

TAG=${1:-}
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || die "usage: deploy-daily-loop <40-char commit sha>"

cd "$APP_DIR"
[ -f .env ] || die "$APP_DIR/.env is missing (POSTGRES_PASSWORD)"

# One deploy at a time, even if two are triggered.
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || die "another deploy is running"

compose() { IMAGE_TAG="$1" docker compose -f docker-compose.prod.yml "${@:2}"; }

PREVIOUS=$(cat current_tag 2>/dev/null || true)
log "deploying $TAG (previous: ${PREVIOUS:-none})"

# 1. Get the image before touching anything that's running.
[ "${SKIP_PULL:-0}" = 1 ] || compose "$TAG" pull --quiet daily-loop-app

# 2. Database up (no-op if already running), then migrations and seed with the NEW code.
#    Migrations are additive only, so the old app keeps working if we roll back below.
# --remove-orphans: removes containers of services no longer in the compose file (e.g. renamed),
#   so two Postgres containers can never run on the same data volume. Only this project is affected.
compose "$TAG" up -d --wait --remove-orphans daily-loop-db
compose "$TAG" run --rm --no-deps daily-loop-app node apps/api/dist/migrate.js
compose "$TAG" run --rm --no-deps daily-loop-app node apps/api/dist/seed.js
# Chart cards + challenges for the next 7 days. Market data trouble must never block a release:
# the app builds a missing day on demand (chart slot → a market word).
compose "$TAG" run --rm --no-deps daily-loop-app node apps/api/dist/generate.js \
  || log "challenge generation failed (non-fatal)"

# 3. Replace the app container and wait for its Docker healthcheck.
rollback() {
  if [ -n "$PREVIOUS" ]; then
    log "rolling back to $PREVIOUS"
    if compose "$PREVIOUS" up -d --wait --wait-timeout 90 daily-loop-app; then
      log "rollback complete"
    else
      log "ROLLBACK FAILED: check 'docker compose -p daily-loop ps'"
    fi
  else
    log "no previous version to roll back to"
  fi
  exit 1
}

compose "$TAG" up -d --wait --wait-timeout 90 daily-loop-app || { log "new version not healthy"; rollback; }

# 4. Confirm from the outside of the container: right version, database reachable.
HEALTH=$(curl -fsS --max-time 5 "$HEALTH_URL" || true)
echo "$HEALTH" | grep -q "\"version\":\"$TAG\"" || { log "health check failed: $HEALTH"; rollback; }
echo "$HEALTH" | grep -q '"db":"up"' || { log "database not reachable: $HEALTH"; rollback; }

# 5. Record versions for the next deploy's rollback.
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$TAG" ]; then echo "$PREVIOUS" > previous_tag; fi
echo "$TAG" > current_tag
log "deployed $TAG"

# 6. Keep the newest $KEEP_IMAGES daily-loop images (for rollback); remove older ones.
#    Only this repository's images are listed, so ChaiHouse images are never touched.
docker image ls "$IMAGE_REPO" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
  | sort -r | tail -n +$((KEEP_IMAGES + 1)) | cut -f2 \
  | xargs -r docker image rm >/dev/null 2>&1 || true
