#!/usr/bin/env bash
# Start the full local stack (db in docker + api, web, collab, worker) with Node 24.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node-24/bin:$PATH"
pnpm db:up >/dev/null
pnpm db:migrate >/dev/null
exec pnpm dev
