# Build context is the repo root. The api runs via tsx — no build step.
# Because @pv-core/db and tools/ ship in this image, it doubles as the
# operational one-shot runner: migrate, seed, import-meddra, and the digest
# cron all run from it. The long-running api process itself still connects
# only as the DML-only pv_app role.
FROM docker.io/library/node:22-slim

RUN npm install -g pnpm@11.9.0
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
# pv-core is the root package: its devDependencies (tsx, nodemailer) run
# the tools/ CLIs.
RUN pnpm install --frozen-lockfile --filter @pv-core/api... --filter pv-core

COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/api apps/api
COPY tools tools

EXPOSE 8789
CMD ["pnpm", "--filter", "@pv-core/api", "start"]
