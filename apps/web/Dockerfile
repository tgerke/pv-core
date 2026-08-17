# Build context is the repo root. Multi-stage: pnpm builds the static
# bundle, nginx serves it. The runtime image contains no Node toolchain and
# no dev server.
FROM docker.io/library/node:22-slim AS build

RUN npm install -g pnpm@11.9.0
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @pv-core/web...

COPY apps/web apps/web
RUN pnpm --filter @pv-core/web build

FROM docker.io/library/nginx:1.27-alpine

# The SPA calls same-origin /api/* and nginx proxies it here, replicating the
# Vite dev proxy (which strips the /api prefix). The nginx entrypoint
# substitutes this into the config template at startup.
ENV API_PROXY_TARGET=http://api:8789

# Runtime SPA auth config served at /env.js. Defaults keep dev-token mode;
# an OIDC deployment overrides these at run time — the image itself stays
# IdP-agnostic. They must be defined here (even when empty) so the nginx
# entrypoint's envsubst recognizes them.
ENV PV_WEB_AUTH_MODE=dev
ENV PV_WEB_OIDC_ISSUER=""
ENV PV_WEB_OIDC_CLIENT_ID=""
ENV PV_WEB_OIDC_SCOPE="openid email profile"

COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 5176
