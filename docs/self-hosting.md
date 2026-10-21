# Self-hosting

Agentic CRM is an early preview. The repository currently provides a source-based local setup and a production-oriented Compose file designed for the maintainer's Coolify deployment. It does not yet provide a supported turnkey installer, managed upgrade service, or automated backup system. Treat this guide as an operator runbook for the checked-in workflows, not a production support promise.

## Local install on macOS or Linux

The source workflow needs Node.js 24.11 or newer, Corepack with pnpm 11.11.0, and Docker Desktop/Engine with the Compose plugin. From a fresh checkout:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm db:up
SEED_USERS='demo@example.com:Demo User' SEED_WORKSPACE_SLUG=demo pnpm seed
AGENTIC_CRM_LLM=fake pnpm dev
```

Open `http://localhost:5173`. `pnpm seed` prints a generated password for a newly created demo user and the Agent demo URL. Save the password privately; it is not printed again for an existing account. The fake model makes the seeded proposal deterministic and does not require an AI provider key.

The development Compose file publishes PostgreSQL on host port `5450` and SeaweedFS S3 on `8333`; its credentials and database are development-only. It does not configure an internet-facing deployment. `pnpm db:down` stops the services but preserves their named volumes. `docker compose -f docker/compose.dev.yml down -v` removes those volumes and permanently deletes the local database and object data.

To reproduce the maintainer's packaging proof from one committed revision, run:

```sh
bash docker/prove-local-install.sh HEAD
```

The script exports only that commit, builds fresh app and web images, starts an isolated loopback-only Compose project, runs `pnpm doctor`, seeds fictional data, and verifies the web build, API readiness, sign-in, session, workspace, and Agent demo route. It then removes only its uniquely named containers, volumes, network, images, and temporary source tree. The launch-candidate proof was completed on macOS with Docker Desktop on 2026-10-21; it is not a Linux-host certification.

## Current production Compose shape

`docker/compose.coolify.yml` runs web, API, collaboration, worker, PostgreSQL, and SeaweedFS services. It is currently wired for Coolify-provided `SERVICE_*` variables and GHCR images. The app image must be built for `linux/amd64`; the checked-in image recipe is `docker/Dockerfile`. Image build commands and the required runtime settings are documented in comments at the top of the Compose file and in `.env.example`.

For a self-managed Docker Compose host, the operator must provide the variables referenced by the Compose file (`APP_IMAGE`, `WEB_IMAGE`, `SERVICE_USER_POSTGRES`, `SERVICE_PASSWORD_POSTGRES`, `SERVICE_PASSWORD_64_AUTH`, `AGENTIC_CRM_ENCRYPTION_KEY`, `SERVICE_URL_WEB`, `SERVICE_USER_S3`, and `SERVICE_PASSWORD_S3`; provider settings are optional). Put them in a deployment-only env file next to the compose project, keep it out of source control, and restrict its permissions. `SERVICE_URL_WEB` must be the externally reachable HTTPS origin for the web service. The proxy serves the UI and forwards API, collaboration, and S3 paths through that same origin; the service ports should not be exposed directly to the public internet.

Before starting an instance, set `APP_IMAGE` and `WEB_IMAGE` to full `image@sha256:<digest>` references from the same verified workflow run. The Compose file has no mutable-tag fallback. Follow [Container image publication and verification](container-images.md) before changing either digest. Published image availability and a generic non-Coolify installer are not yet promised by this repository. For deployment, migration, and auth changes, review the current Compose file and changelog before applying them.

The API container runs forward-only migrations at startup. Do not edit an applied migration; add a new migration. Set `AUTH_SIGNUP_ENABLED=false` for an invite-controlled deployment. `AUTH_SECRET` must be unique, stable, and at least 32 characters. In production `AGENTIC_CRM_ENCRYPTION_KEY` is required by `pnpm doctor`; generate 32 random bytes and retain the key with the backups, because losing or changing it makes saved provider credentials unreadable. Pass this key to the API, worker, and collaboration services. Google OAuth is optional: pass `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` together, and register `GOOGLE_REDIRECT_URI` (or the default derived from `API_PUBLIC_URL`) with Google. `GOOGLE_MAIL_SYNC_DAYS` optionally limits the first sync window. Keep `ANTHROPIC_API_KEY` and `AGENTIC_CRM_LLM` available to the API as configured. These names and semantics are listed in `.env.example`.

After the production API container is healthy, run the read-only doctor inside it so it uses the deployed environment and can reach the internal Postgres and S3 service names:

```sh
docker compose -f docker/compose.coolify.yml exec -T api pnpm doctor
```

`pnpm doctor` checks essential configuration, database and S3 reachability, and compares the image's committed migration checksums with the database. It does not apply migrations, create the S3 bucket, or test browser access through the public proxy. A checksum mismatch means stop and investigate; migrations are forward-only. A fresh database's initial migration is applied automatically by the API service on startup.

## Updates

1. Read the release notes and inspect changes to `docker/compose.coolify.yml`, `docker/Dockerfile`, `.env.example`, and `packages/db/migrations/` between the current and proposed source revisions.
2. Take and verify a database and object-store backup, and preserve the current image tags and encryption/auth secrets.
3. Build and publish the app and web images from the same source revision and platform. Verify both, then pin their full digest references as `APP_IMAGE` and `WEB_IMAGE` in the deployment environment.
4. Apply the compose update. The API service applies pending migrations before listening; wait for API and web health checks, then test sign-in, a record read/write, file access, and collaboration through the external HTTPS origin.
5. If the new version fails, restore the previous images. A database rollback is not supplied; restore a coordinated pre-upgrade backup into a separate recovery instance first and validate it before redirecting users.

Keep the previous images and backup until the upgrade has been observed successfully. Never point the API at a production database to run `pnpm db:reset`; that command drops schemas.

## Backup and restore

There is no built-in backup scheduler. PostgreSQL and S3-compatible object storage are separate named volumes (`pgdata`, `s3data` in the Compose project), and a usable recovery point must include both plus the encryption key and deployment configuration. Snapshot both stores at a coordinated point; stop API, worker, collaboration, and web writers during a simple file-level backup. Follow the storage provider's documented consistency guarantees for its snapshot method. The project does not verify your backup automatically.

At minimum, schedule PostgreSQL logical backups using the same PostgreSQL major version as the deployed server and test restoration regularly. For a running production Compose stack, an operator can create a compressed custom-format dump with:

```sh
umask 077
docker compose -f docker/compose.coolify.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d crm -Fc' > crm-$(date +%Y%m%d-%H%M%S).dump
```

Store the dump off-host. This command backs up PostgreSQL only; it does not include SeaweedFS files, secrets, or configuration. Back up the complete S3 volume using a snapshot procedure appropriate for your Docker host or storage driver, and verify the resulting snapshot/archive contains the object data. Do not assume copying only the PostgreSQL dump is a complete backup.

Restore into an isolated recovery stack with empty database and object-store volumes first. With a recovery env file containing the Compose variables, create fresh volumes and start only Postgres and S3:

```sh
docker compose -p crm-recovery -f docker/compose.coolify.yml --env-file .env.recovery up -d postgres s3
docker compose -p crm-recovery -f docker/compose.coolify.yml --env-file .env.recovery exec -T postgres \
  sh -c 'pg_restore --no-owner -U "$POSTGRES_USER" -d crm' < crm-backup.dump
```

Restore the matching S3 volume snapshot into the recovery project's fresh volume using the host's documented volume restore procedure, then start the application services with the original `AUTH_SECRET`, encryption key, and compatible image tag. Validate login, file reads, and expected record counts before any traffic is redirected. The `pg_restore` command writes into the target database; never run it against the live volume. Exact object-volume snapshot commands depend on the host/driver, so use that driver's documented restore command and test it before relying on it.

## Troubleshooting

- **`pnpm doctor` reports Node.js:** install Node.js 24.11 or newer, then rerun under that runtime.
- **Configuration failure:** compare required values with `.env.example`. Production rejects default auth/S3 settings and requires an encryption key. Do not paste secrets into issue reports.
- **PostgreSQL is unreachable:** verify `DATABASE_URL`, host reachability, port, credentials, and that the database service is healthy. In the local Compose workflow, host clients use port `5450`.
- **Migrations are unapplied:** verify that this checkout targets the intended database, then back it up and run `pnpm db:migrate` from the matching source revision. A startup migration failure appears in API logs.
- **Migration checksum mismatch:** stop rollout. Do not edit the already-applied SQL file or run reset on persistent data; inspect the migration history and recover with a new forward migration.
- **S3 endpoint is unreachable:** check `S3_ENDPOINT` from the API container's network context. The browser uses `S3_PUBLIC_ENDPOINT`/the public web origin for signed file URLs, so also check the HTTPS proxy route and bucket.
- **Browser sign-in or callbacks fail:** use the same canonical HTTPS origin for `WEB_ORIGIN`, `API_PUBLIC_URL`, `COLLAB_ALLOWED_ORIGINS`, and the browser-facing S3 endpoint as appropriate; check trusted origins, proxy headers, and the Google callback if Google is enabled.
- **Health check fails after an update:** inspect `docker compose -f docker/compose.coolify.yml logs api`, then `worker`, `collab`, `web`, `postgres`, and `s3`. Confirm all images share a source tag and that the API completed migrations.

Report security issues privately using [SECURITY.md](../SECURITY.md).
