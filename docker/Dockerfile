# Production images (built on the developer's Mac, pushed to GHCR; see docker/compose.coolify.yml):
#   --target app  Node runtime for api / collab / worker / seed (TypeScript sources run with tsx, as `pnpm start` does)
#   --target web  Caddy serving the built SPA and proxying /trpc /api /v2 /realtime /collab and S3 to the services
# docker buildx build --platform linux/amd64 -f docker/Dockerfile --target app -t ghcr.io/…/agentic-crm-app:<tag> .

FROM node:24.16.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
WORKDIR /app

# Dependencies: only manifests, so a source change keeps this layer cached.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/collab/package.json apps/collab/
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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS web-build
RUN pnpm --filter @agentic-crm/web build

FROM caddy:2.11.6-alpine AS web
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
EXPOSE 80

FROM source AS app
ENV NODE_ENV=production AGENTIC_CRM_DOTENV=0 API_HOST=0.0.0.0 COLLAB_HOST=0.0.0.0
USER node
# Overridden per service: collab / worker run `pnpm --filter @agentic-crm/<app> start`.
CMD ["pnpm", "--filter", "@agentic-crm/api", "start"]
