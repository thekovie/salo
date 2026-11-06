# syntax=docker/dockerfile:1

# ---- base: Node 22 LTS with pnpm (version pinned by package.json "packageManager") ----
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ---- deps: install from the lockfile only ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ---- build: the standalone Next.js server ----
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- runtime: small image, non-root user, app files root-owned and read-only to it ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Applied at startup (src/instrumentation-node.ts), relative to the working directory.
COPY --from=build /app/drizzle ./drizzle
# Fonts for link-preview images (read at request time).
COPY --from=build /app/assets ./assets

USER node
EXPOSE 3000

# No curl in the slim image: Node's own fetch against the public health endpoint (database reachable = healthy).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Next's standalone server drains in-flight requests on SIGTERM (graceful shutdown on redeploy).
CMD ["node", "server.js"]
