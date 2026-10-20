# Codex CLI experiment (W5)

## Runner container boundary

`CodexContainerSandbox` in `codex-container.ts` is a separate runner-side adapter.
`CodexCliExperiment` below retains its synthetic-only contract. Neither adapter is
automatically registered in the application. A host must pass the live acceptance
gate below before it is offered as a production runner. The current development
host is macOS: fixture tests passed, but Linux kernel conformance and authenticated
live generation have **not** been verified here.

Supported host: a non-root Linux user, local Podman 6, cgroup v2 with delegated CPU,
memory and PID controllers, user namespaces, and the runtime's seccomp support.
macOS/Windows/remote Podman, rootful Docker, missing controllers, and unsupported
runtime versions fail closed. The operator must trust the local Podman executable,
its OCI runtime/configuration, and the container image. This is container isolation
on the host kernel, not a VM boundary against kernel vulnerabilities.

The operator preloads an image by digest and supplies its exact
`registry/path@sha256:...` reference. Execution never pulls an image or installs
anything. `container/Containerfile` is a minimal build recipe; provide a trusted
digest-pinned Node base as `NODE_IMAGE`, inspect/build the image separately, preload
it in rootless Podman, and configure the resulting immutable digest. The image must
contain `/usr/local/bin/node` and `/usr/local/bin/codex` version 0.163.0. Updating the
CLI, runtime major, or image requires repeating acceptance checks.

Every invocation creates a fresh container with a read-only root, private user,
mount, PID, network, IPC, UTS and cgroup namespaces, no capabilities, no new
privileges, seccomp, no image volumes/healthchecks/restarts, no host environment,
and no container logs. Its writable workspace/state/temp paths are separate 64 MiB
`noexec,nosuid,nodev` tmpfs mounts. Limits are 512 MiB RAM, no swap, one CPU, 64 PIDs,
256 file descriptors, 16 MiB per file and a container-monitor wall timeout. The
runner additionally bounds stdout/stderr, deadlines, idle time and cancellation.
No checkout, attachment directory, host HOME or container-runtime socket is mounted.

Before starting the container, inspect rejects extra or writable host mounts and
unsafe namespace modes. Inside that same container, before starting Codex, the
trusted read-only bootstrap verifies actual namespace identities against the host,
all capability sets, no-new-privileges, seccomp, network interfaces, kernel cgroup
limits, the active mount list, read-only root and bounded tmpfs. Default host-secret
mounts outside the fixed list are rejected. It attempts a root write and a read of an
unmounted host marker. A prior successful check or a matching CLI version never
substitutes for these live checks.

The container has `network=none`. A runner-owned Unix socket and an in-container
loopback bridge supply an HTTPS CONNECT proxy. `egressHosts` is an explicit
operator-controlled allowlist of exact lowercase vendor DNS names, never model
input. Only port 443 is accepted; DNS resolves once per tunnel to public IPv4
addresses, all mixed/private/reserved answers are denied, and the selected numeric
address is used for connection. IPv6-only providers fail closed. Plain HTTP,
wildcards and direct container network access are unavailable. The relay limits
connections, bytes and idle time. Configure the endpoints required by the chosen
auth mode; commonly relevant endpoints include `api.openai.com`, `chatgpt.com` and
`auth.openai.com`, but this is not a permanent or verified-complete list. A new
endpoint must be reviewed and explicitly added. TLS stays end-to-end between CLI
and vendor; the relay restricts destination addresses, does not inspect encrypted
content, and cannot prevent data transfer to allowed vendor/CDN infrastructure.

Authentication profiles remain on the runner. Each profile must be its own
owner-only directory containing only a regular, singly-linked, owner-only
`auth.json`; `~/.codex`, symlinks, config and plugins are rejected. The runner never
reads/returns/uploads the credential. Only that one file is mounted read-only into
temporary CLI state. Login and refresh are separate operator activities outside
execution. An expired profile may need local reauthentication; execution cannot
persist refreshed credentials into the host profile. The CLI necessarily reads
its own credential inside the sandbox; this does not hide it from a compromised
CLI/image or grant isolation between processes in one invocation.

Synthetic requests have no CRM access. CRM-derived prompts require
`crmAccess: 'scoped-mcp'`, an active runner/workspace/task/lease scope, and a
runner-owned Unix MCP relay carrying the identical scope. Only the socket is
mounted. The trusted runner must authenticate its enrollment and lease, construct
this request, and run the relay's `/mcp` transport through the existing policy
broker. Every capability call must derive actor/scope/grant on the server, enforce
lease expiry/revocation and policy, and preserve atomic CRM writes. The scope
comparison and socket ownership check here are **not** server authentication.
Never deserialize the execution contract directly from a model or public API.
This module does not implement enrollment, lease validation or the authenticated
MCP relay itself. The standalone [`apps/runner`](../../../../../apps/runner/README.md)
daemon constructs this scope from authenticated claims, renews the exact lease,
and exposes a private relay restricted to the server-issued execution descriptor.
Live authenticated acceptance is still required; supplying an arbitrary local
socket does not complete it.

Native CLI tools remain disabled by the pinned manifest. Scoped CRM requests can
use only the configured `crm` MCP server; raw tool arguments/results never become
domain writes from the event stream. Event rejection is a protocol safeguard; the
container boundary and policy broker enforce host/CRM authority. Arbitrary native
tool denial is not inferred from a fixture event. Cost remains explicitly unknown.

The runner forcibly removes the named container and confirms it is absent before
publishing completion, including after timeout/cancellation. The monitor timeout
survives an attached CLI process dying. Unconfirmed cleanup returns
`sandbox_cleanup_failed`; the runner must stop accepting work and investigate.
Relays are closed even when removal fails, revoking network/MCP paths. Temporary
state and output are not kept on the host. A runner crash still requires orphan
container cleanup by its owner; the monitor supplies the hard execution timeout.

Run credential-free tests (one live test is explicitly skipped unless configured):

```sh
pnpm --filter @agentic-crm/domain exec vitest run --config vitest.execution.config.ts
```

On the supported Linux runner, point the acceptance gate at its real runtime and
preloaded image. No profile or provider call is needed:

```sh
CRM_CODEX_SANDBOX_PODMAN=/usr/bin/podman \
CRM_CODEX_SANDBOX_IMAGE='registry.example/crm/codex@sha256:<reviewed-digest>' \
pnpm --filter @agentic-crm/domain exec vitest run --config vitest.execution.config.ts test/ai-container-live.test.ts
```

Unset environment variables mean “not tested”, not “passed”. After this gate passes,
verify authenticated synthetic generation, endpoint policy, scope revocation and
the authenticated MCP relay on that runner before enabling CRM work. Reference:
[Podman run](https://docs.podman.io/en/latest/markdown/podman-run.1.html),
[Podman info](https://docs.podman.io/en/v6.1.3/markdown/podman-info.1.html), and
[OpenAI sandbox security](https://developers.openai.com/api/docs/guides/agents-api/environments/security).

## Local synthetic harness

Status: local synthetic-data harness, tested with fake executables. The repository
also contains paired-runner enrollment, scoped execution grants, auth-profile
metadata, authenticated MCP transport, and a rootless Podman sandbox. Those
primitives are connected by the standalone [`apps/runner`](../../../../../apps/runner/README.md)
daemon. An authenticated live generation run on Linux remains a separate acceptance gate.

`contract.ts` is an execution boundary, separate from the inference client. The
only request is synthetic text generation with native tools and CRM access
disabled. Requests cannot supply argv, environment, MCP servers, executable
overrides, resume identifiers, files, or action grants. The adapter is deliberately
absent from central exports and provider selection.

The harness resolves one explicitly configured absolute executable, requires an
existing empty working directory, and spawns argv with `shell: false`. It supplies
a fixed minimal environment and temporary HOME/CODEX_HOME/TMPDIR/XDG locations,
never the calling process's keys, proxies, runtime hooks, MCP configuration, PATH,
or user profile. Prompts travel over stdin. Temporary harness state is removed
after process-group cleanup; the supplied working directory itself is preserved.

An optional `authenticationHome` names a dedicated CLI-owned directory initially
containing only a regular `auth.json`. The harness does not read, copy, return, or
create credentials, and never invokes login. Do not point it at an ordinary Codex
home. Codex may refresh its own authentication file and create local profile state;
subsequent reuse requires a separately reviewed profile lifecycle. Without a
dedicated profile, a real CLI is expected to report `unauthenticated`.

Preflight checks the exact experimental version (0.163.0), required exec flags,
and local login status. Missing/nonexecutable binaries, incompatible versions or
configuration, and unavailable authentication have distinct errors. There is no
PATH search, shell command setting, automatic login, retry, vendor fallback, or
credential diagnostic output. CLI version matching is a compatibility bound, not
an executable authenticity guarantee: the local operator must trust the binary.

The fixed manifest disables shell, image viewing, browser/computer use, web search,
apps, plugins, hooks, subagents, code mode, memories, goals, skill/tool discovery,
and MCP configuration, while requesting read-only sandbox mode and ignoring user
configuration/rules. The parser accepts only session, turn, reasoning, and agent
text events. Tool/artifact events abort execution. Unknown or malformed events,
invalid UTF-8, missing/duplicate terminals, nonzero exit, and signals fail closed.
Completion is published only after stream validation, successful exit, and process
group cleanup. Token counts remain null when absent and subscription cost remains
unknown.

Important limitation: CLI flags and observing/rejecting tool events do not prove
that a tool was prevented before execution. An empty cwd is not a filesystem jail,
read-only mode is not a host-wide network policy, and a process can escape its
group with setsid. The harness process itself can access its auth and provider
network. No native tool authority is granted by the request, but actual denial of
every native tool has not been independently established against a live CLI.
Therefore this harness must remain a manually invoked synthetic-data experiment,
with no CRM input or mutation access and no API/worker integration. The standalone
daemon uses the separate container adapter. B017 tracks live Linux sandbox certification.

One shared deadline and byte budget cover all preflight and execution subprocesses.
First-event and idle timers reset only on parsed complete events during execution;
stderr and partial JSON cannot keep a run alive. Default bounds: first event 15 s,
idle 30 s, total 90 s, combined stdout+stderr 256 KiB, SIGTERM grace 100 ms. Hard
maximums are 120 s first/idle, 300 s total, 1 MiB output, 1 s grace. After grace,
SIGKILL targets the POSIX group even if the leader exited successfully, with at
most another 100 ms for pipe drain. Windows is unsupported. Caller-provided event
callbacks must be synchronous and nonblocking; this local harness does not isolate
its own Node process against a blocked event loop or filesystem I/O.

Credential-free checks, from the repository root:

```sh
pnpm --filter @agentic-crm/domain exec vitest run --config vitest.execution.config.ts
pnpm --filter @agentic-crm/domain typecheck
pnpm exec biome check packages/domain/src/ai/execution packages/domain/test/ai-execution.test.ts packages/domain/test/fixtures/codex-cli.mjs packages/domain/vitest.execution.config.ts
```

The fixtures exercise environment/argv isolation, fragmented UTF-8/JSONL, first
event/idle/total timeout, byte limits, early/mid-run cancellation, descendants,
missing/unauthenticated/incompatible CLI, tool denial, malformed/duplicate output,
disconnect, and redacted failures. They do not prove a live Codex tool surface.

Before any live smoke, independently verify the fixed manifest's native-tool
denial for the exact executable and isolate the host appropriately. Use only a
fresh empty directory and synthetic text such as “Reply with SYNTHETIC_OK”; never
use CRM data, mounted user files, production credentials, or external mutation
tools. A CLI runs locally but can send the prompt to its vendor. Live generation
remains a separate acceptance gate rather than an acceptance claim for these
fixture tests. B017 tracks live Linux conformance and native-tool denial.

The implementation checked the installed CLI help and official OpenAI
[non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) and
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
on 2026-10-19. Documentation and feature flags may change; expanding the pinned
version requires conformance review.
