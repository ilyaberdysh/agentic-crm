# Production images (validated and optionally published by .github/workflows/containers.yml):
#   --target app  Node runtime for api / collab / worker / seed (TypeScript sources run with tsx, as `pnpm start` does)
#   --target web  Caddy serving the built SPA and proxying /trpc /api /v2 /realtime /collab and S3 to the services
# See docs/container-images.md for signing, verification, and digest-pinned deployment.

FROM node:24.22.0-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4 AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
WORKDIR /app

# Dependencies: only manifests, so a source change keeps this layer cached.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/collab/package.json apps/collab/
COPY apps/runner/package.json apps/runner/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/editor/package.json packages/editor/
COPY packages/formula/package.json packages/formula/
COPY packages/realtime/package.json packages/realtime/
COPY packages/ui/package.json packages/ui/
# `pnpm licenses` needs package index metadata from the content-addressed store,
# so generate the inventory in the same cache-mounted step as installation.
COPY scripts/publication scripts/publication
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile \
    && node scripts/publication/licenses.mjs /usr/share/licenses/agentic-crm \
    && chmod -R a+rX /usr/share/licenses/agentic-crm

FROM deps AS source
COPY . .
# The app ships this complete dependency tree (including development tools), and
# the web bundles a subset. Retain the conservative full inventory and original
# upstream license texts in both distributions; unresolved declarations fail the build.
COPY LICENSE NOTICE /usr/share/licenses/agentic-crm/

FROM source AS web-build
RUN pnpm --filter @agentic-crm/web build

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS web
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
COPY --from=source /usr/share/licenses/agentic-crm /usr/share/licenses/agentic-crm
# Make the bundled font/icon and dependency terms available with the served SPA.
COPY --from=source /usr/share/licenses/agentic-crm /srv/legal
EXPOSE 80

FROM source AS app
ENV NODE_ENV=production AGENTIC_CRM_DOTENV=0 API_HOST=0.0.0.0 COLLAB_HOST=0.0.0.0
USER node
# Overridden per service: collab / worker run `pnpm --filter @agentic-crm/<app> start`.
CMD ["pnpm", "--filter", "@agentic-crm/api", "start"]
