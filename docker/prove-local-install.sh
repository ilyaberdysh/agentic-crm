#!/usr/bin/env bash
# Prove a committed source revision installs on this Docker host. The archived
# source, images, containers, networks and volumes are all local to this run.
set -euo pipefail
umask 077

if [[ $# -gt 1 ]]; then
  echo 'Usage: bash docker/prove-local-install.sh [commit]' >&2
  exit 2
fi
for tool in git tar docker openssl python3; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
docker info >/dev/null
docker compose version >/dev/null

repo_root=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
commit=$(git -C "$repo_root" rev-parse --verify "${1:-HEAD}^{commit}")
project="crm-proof-$(openssl rand -hex 8)"
app_image="agentic-crm-proof-app:$project"
web_image="agentic-crm-proof-web:$project"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/crm-install-proof.XXXXXXXX")
snapshot="$scratch/source"
env_file="$scratch/compose.env"
owned=0
images_owned=0

compose() {
  env -u APP_IMAGE -u WEB_IMAGE -u PROOF_PORT -u SERVICE_URL_WEB \
    -u SERVICE_USER_POSTGRES -u SERVICE_PASSWORD_POSTGRES -u SERVICE_PASSWORD_64_AUTH \
    -u AGENTIC_CRM_ENCRYPTION_KEY -u SERVICE_USER_S3 -u SERVICE_PASSWORD_S3 \
    -u AGENTIC_CRM_LLM -u ANTHROPIC_API_KEY -u GOOGLE_CLIENT_ID -u GOOGLE_CLIENT_SECRET \
    -u GOOGLE_REDIRECT_URI -u GOOGLE_MAIL_SYNC_DAYS \
    docker compose --project-name "$project" --env-file "$env_file" \
    -f "$snapshot/docker/compose.coolify.yml" -f "$snapshot/docker/compose.local-proof.yml" "$@"
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  if (( owned )); then
    if (( status != 0 )); then
      echo 'Install proof failed; recent service logs:' >&2
      compose ps >&2
      compose logs --no-color --tail 80 >&2
    fi
    compose down --volumes --remove-orphans >/dev/null || status=1
  fi
  if (( images_owned )); then
    docker image rm "$app_image" "$web_image" >/dev/null 2>&1 || status=1
  fi
  # scratch is a fresh mktemp directory, never a checkout or a Docker volume.
  case "$scratch" in
    "${TMPDIR:-/tmp}"/crm-install-proof.*) rm -rf -- "$scratch" ;;
    *) echo "Refusing to remove unexpected temporary path: $scratch" >&2; status=1 ;;
  esac
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$snapshot"
echo "Archiving committed source $commit"
git -C "$repo_root" archive --format=tar "$commit" | tar -xf - -C "$snapshot"
# The strict process umask protects the generated environment file, but source
# copied into the image must remain traversable by the non-root `node` user.
chmod -R a+rX "$snapshot"
[[ -f "$snapshot/docker/compose.local-proof.yml" ]] || {
  echo 'The selected commit does not contain the local proof files.' >&2
  exit 1
}

# Fail closed even in the extraordinarily unlikely event of a project-name
# collision: down --volumes must never address somebody else's project.
if [[ -n $(docker ps -aq --filter "label=com.docker.compose.project=$project") ||
      -n $(docker volume ls -q --filter "label=com.docker.compose.project=$project") ||
      -n $(docker network ls -q --filter "label=com.docker.compose.project=$project") ]]; then
  echo "Compose project already exists: $project" >&2
  exit 1
fi
if docker image inspect "$app_image" >/dev/null 2>&1 || docker image inspect "$web_image" >/dev/null 2>&1; then
  echo 'A local proof image tag already exists; refusing to overwrite it.' >&2
  exit 1
fi

proof_port=$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)
{
  printf 'APP_IMAGE=%s\nWEB_IMAGE=%s\nPROOF_PORT=%s\n' "$app_image" "$web_image" "$proof_port"
  printf 'SERVICE_URL_WEB=http://127.0.0.1:%s\n' "$proof_port"
  printf 'SERVICE_USER_POSTGRES=crmproof\nSERVICE_PASSWORD_POSTGRES=%s\n' "$(openssl rand -hex 24)"
  printf 'SERVICE_PASSWORD_64_AUTH=%s\n' "$(openssl rand -hex 32)"
  printf 'AGENTIC_CRM_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)"
  printf 'SERVICE_USER_S3=crmproof\nSERVICE_PASSWORD_S3=%s\n' "$(openssl rand -hex 24)"
  printf 'AGENTIC_CRM_LLM=fake\n'
} > "$env_file"
compose config --quiet

echo 'Building app image from the archived commit'
images_owned=1
# A proof run must not inherit a stale local source layer from an earlier
# Dockerfile revision. The first build refreshes every layer; the web build can
# then reuse only the layers produced from this archived commit.
docker build --no-cache -f "$snapshot/docker/Dockerfile" --target app -t "$app_image" "$snapshot"
echo 'Building web image from the same archived commit'
docker build -f "$snapshot/docker/Dockerfile" --target web -t "$web_image" "$snapshot"

# Compose must use the two distinct images just built, never an ambient registry result.
app_id=$(docker image inspect "$app_image" --format '{{.Id}}')
web_id=$(docker image inspect "$web_image" --format '{{.Id}}')
printf 'Built app image %s and web image %s\n' "$app_id" "$web_id"
[[ "$app_id" != "$web_id" ]] || { echo 'App and web tags unexpectedly resolve to the same image.' >&2; exit 1; }
docker run --rm --entrypoint sh "$app_image" -c \
  'test -f /app/packages/db/src/migrate.ts && test -f /app/apps/api/src/server.ts' || {
    echo 'The app image is missing runtime migration or API sources.' >&2
    docker run --rm --entrypoint sh "$app_image" -c \
      'ls -ld /app /app/packages /app/packages/db /app/apps /app/apps/api 2>&1; ls -l /app/packages/db/src/migrate.ts /app/apps/api/src/server.ts 2>&1' >&2 || true
    exit 1
  }

echo "Starting isolated Compose project $project on 127.0.0.1:$proof_port"
owned=1
compose up -d --wait --wait-timeout 300
compose exec -T api pnpm doctor
compose exec -T -e SEED_USERS='demo@example.com:Demo User' -e SEED_WORKSPACE_SLUG=demo \
  api pnpm seed > "$scratch/seed.log"

PROOF_BASE_URL="http://127.0.0.1:$proof_port" PROOF_SEED_LOG="$scratch/seed.log" python3 - <<'PY'
import http.cookiejar
import json
import os
import re
import urllib.request

base = os.environ['PROOF_BASE_URL']
seed = open(os.environ['PROOF_SEED_LOG'], encoding='utf-8').read()
password = re.search(r'demo@example\.com\s+password: (\S+)', seed)
demo_url = re.search(r'Agent demo \(demo@example\.com\): (\S+)', seed)
counts = re.search(r'8 companies, 16 people, 12 projects, 5 deals \(41 records created by this run\)', seed)
if not (password and demo_url and counts):
    raise SystemExit('Seed output did not contain the expected fresh account, demo URL and records')
if not demo_url.group(1).startswith(base + '/demo/company/'):
    raise SystemExit('Seeded demo URL did not use the local proxy origin')

cookies = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cookies))
def request(path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers=headers or {})
    with client.open(req, timeout=15) as response:
        if response.status != 200:
            raise SystemExit(f'{path}: HTTP {response.status}')
        return response.read(), response.headers

ready, _ = request('/api/health/ready')
if json.loads(ready).get('database') != 'ok':
    raise SystemExit('API readiness did not confirm the database')
index, _ = request('/')
if b'<html' not in index.lower() or b'/assets/' not in index:
    raise SystemExit('Web proxy did not serve the built SPA')
asset = re.search(rb'/(assets/[^"\x27\s<>]+\.(?:js|css))', index)
if not asset:
    raise SystemExit('Built SPA did not reference a JavaScript or CSS asset')
asset_body, _ = request('/' + asset.group(1).decode())
if not asset_body:
    raise SystemExit('Web proxy returned an empty built asset')
signed_in, _ = request('/api/auth/sign-in/email',
    {'email': 'demo@example.com', 'password': password.group(1)},
    {'Content-Type': 'application/json', 'Origin': base})
if json.loads(signed_in).get('user', {}).get('email') != 'demo@example.com':
    raise SystemExit('Seeded account did not sign in')
if not any(cookie.name == 'agentic-crm-session' for cookie in cookies):
    raise SystemExit('Sign-in did not set the application session cookie')
whoami, _ = request('/api/auth/whoami')
if b'demo@example.com' not in whoami:
    raise SystemExit('Session was not accepted by the API')
workspace, _ = request('/trpc/workspaces.current', {},
    {'Content-Type': 'application/json', 'Origin': base, 'x-workspace-slug': 'demo'})
if json.loads(workspace).get('result', {}).get('data', {}).get('membership') is None:
    raise SystemExit('Seeded workspace was not readable through tRPC')
demo_page, _ = request(demo_url.group(1)[len(base):])
if b'<html' not in demo_page.lower():
    raise SystemExit('Seeded Agent demo route did not serve the SPA')
print('PASS: built web, API readiness, 41 seeded records, sign-in, session, workspace and Agent demo route')
PY

echo "PASS: committed revision $commit on this Docker host; isolated project will now be removed"
