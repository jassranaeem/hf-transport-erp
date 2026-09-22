# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# install deps (with dev deps, needed for the build)
COPY package.json package-lock.json ./
RUN npm ci

# build client (dist/) + server bundle (dist/server.cjs)
COPY . .
RUN npm run build

# prune to production deps only
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# non-root user
RUN useradd --system --uid 1001 --create-home appuser

COPY --from=build --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appuser /app/dist ./dist
COPY --from=build --chown=appuser:appuser /app/drizzle ./drizzle
COPY --from=build --chown=appuser:appuser /app/package.json ./package.json

# DMS upload target (mount a volume here to persist it)
RUN mkdir -p /app/uploads && chown appuser:appuser /app/uploads
VOLUME ["/app/uploads"]

USER appuser
EXPOSE 3000

# lightweight liveness check
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
