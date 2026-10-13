# syntax=docker/dockerfile:1
#
# One image serves the whole app: the Fastify API plus the built web app (same domain).
# Built in GitHub Actions and pulled by the server; the server never compiles anything.
#
#   docker build --build-arg APP_VERSION=$(git rev-parse HEAD) -t daily-loop .

ARG NODE_IMAGE=node:22-alpine

# ---- 1. Install every dependency (cached until a package.json or the lockfile changes) ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

# ---- 2. Build the API (tsup bundle) and the web app (Vite) ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- 3. Runtime dependencies only: what the API bundle imports at run time ----
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace @daily-loop/api --no-audit --no-fund

# ---- 4. The image that runs ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    API_PORT=3000 \
    STATIC_DIR=/app/apps/web/dist
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
# Read at run time by the migrate and seed scripts (paths relative to the repo root = /app).
COPY db/migrations ./db/migrations
COPY datasets ./datasets

# Set last so a new commit doesn't invalidate the layers above.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.source="https://github.com/ash-1202/daily-loop" \
      org.opencontainers.image.description="Market Daily 5: daily financial-literacy challenge" \
      org.opencontainers.image.revision="${APP_VERSION}"

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
