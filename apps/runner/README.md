# Paired runner daemon

This standalone process connects outbound to one CRM API and runs without database,
S3, hosted provider, or workspace-session credentials. Node 24.11+ and the repository's
pinned pnpm dependencies are required. Local model dispatch works independently of
Codex. Codex requires the supported Linux/rootless Podman host, preloaded digest-pinned
image and isolated authentication profile described in
[the sandbox guide](../../packages/domain/src/ai/execution/README.md).

Create an operator-owned configuration file outside the repository:

```json
{
  "apiOrigin": "https://crm.example.com",
  "stateDirectory": "/home/runner/.local/state/agentic-crm",
  "name": "linux-runner",
  "pollMs": 2000,
  "localEndpoints": ["http://127.0.0.1:1234/v1"],
  "sandbox": {
    "runtimeExecutable": "/usr/bin/podman",
    "image": "registry.example.com/crm/codex@sha256:<64-character-reviewed-digest>",
    "egressHosts": ["api.openai.com", "chatgpt.com", "auth.openai.com"],
    "profile": {
      "id": "00000000-0000-4000-8000-000000000001",
      "label": "Dedicated Codex login",
      "directory": "/home/runner/.local/share/crm-codex-profile"
    }
  }
}
```

Omit `sandbox` for a local-model-only runner. Omit or empty `localEndpoints` to
disable local dispatch. Each local endpoint must be explicitly enabled by the host
operator, including its port and base path. `localhost` is pinned to `127.0.0.1`;
IPv6 loopback can be specified as `[::1]`. Requests cannot follow redirects. Local
services must accept unauthenticated OpenAI-compatible Chat Completions requests;
the daemon sends no runner bearer or CLI credentials to them. The daemon currently
returns text completions and usage; it does not execute local-model tool calls.

From a workspace admin session, create an enrollment with
`POST /api/agentic/runners/enrollments`, then save the returned token in a private
file outside the repository (mode `0600`). Pair once, then remove that token file:

```sh
pnpm --filter @agentic-crm/runner start enroll /absolute/runner.json /absolute/enrollment-token
pnpm --filter @agentic-crm/runner start check /absolute/runner.json
pnpm --filter @agentic-crm/runner start run /absolute/runner.json
```

`check` performs real, credential-free container conformance on the current host.
Before enabling CRM tasks, also complete the authenticated live acceptance checks
in the sandbox guide. Fixture tests alone do not certify a host or image. Every
execution repeats the container boundary checks; pairing does not attest isolation.
The daemon never builds/pulls an image, performs login, or refreshes host credentials.

The state directory must be a canonical absolute path with owner-only permissions
(`0700`). `identity.json` stores the one-time returned bearer with mode `0600`, is
bound to the API origin, and must not be copied into source control or logs. Enrollment
refuses to overwrite it. If enrollment fails or the response is lost, the reserved
file may be empty: inspect/revoke the runner from the admin session, remove that exact
file locally, and enroll again with a new token. Never retry by overwriting a live identity.

The daemon serially claims one task and one local invocation per polling turn, sends
heartbeats every 15 seconds, and cancels work when the lease cannot be renewed or its
confirmed expiry is reached. `SIGINT`/`SIGTERM` cancels active work and waits for the
sandbox's confirmed cleanup. A cleanup failure or rejected runner authentication
stops the daemon; use a service manager with a deliberate restart policy and investigate
orphan containers before restarting after `sandbox_cleanup_failed`.

Each task gets a new private Unix MCP socket. The bridge translates CLI MCP initialization
and list/call requests to the hosted stateless MCP transport. Only `crm.task.create`
with the exact server-issued descriptor can cross it. Bearer/grant headers are injected
by the daemon and never appear in prompts or model arguments. If a response is lost,
one automatic retry uses the same descriptor and grant. An attempted call without a
confirmed receipt is left for authoritative server reconciliation; the runner never
declares it successful or substitutes a new receipt. Receipt success settles linked
tasks on the server. Successful effect-free planning uses `/complete`; failed planning
uses `/fail`; an unattempted linked action uses `/release`. Planning text is transient.

Logs contain fixed lifecycle codes only, excluding prompts, model output, upstream
bodies, tokens, URLs and profile paths. API HTTP is allowed only on loopback for local
development; remote API connections require HTTPS. The API rechecks member, runner,
grant, lease, approval and evidence authority for every capability invocation.

Credential-free checks:

```sh
pnpm --filter @agentic-crm/runner test
pnpm --filter @agentic-crm/runner typecheck
pnpm exec biome check apps/runner
```
