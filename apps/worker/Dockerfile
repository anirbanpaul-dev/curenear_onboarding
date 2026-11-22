# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/config/package.json packages/config/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @curenear/worker... --filter @curenear/db...

COPY packages packages
COPY apps/worker apps/worker
RUN pnpm --filter @curenear/db generate

FROM node:22-bookworm-slim AS worker
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps --chown=node:node /app ./
USER node

# The worker has no HTTP port. Its liveness indicator is the JSON log line
# `worker_started` plus the per-run `job_run` logs; see the deployment guide.
CMD ["pnpm", "--filter", "@curenear/worker", "start"]
