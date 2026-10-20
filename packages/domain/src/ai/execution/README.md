# Codex CLI experiment (W5)

Status: local synthetic-data harness, tested with fake executables. No application
registration, paired runner, production sandbox, credential management, or CRM
capability is implemented. No authenticated live generation has been verified.

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
Therefore this must remain a manually invoked synthetic-data experiment, with no
CRM input or mutation access and no API/worker integration. B005 tracks the
separate enrollment, executable attestation, and enforceable sandbox gate.

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
tools. A CLI runs locally but can send the prompt to its vendor. Live generation,
runner trust, sandbox conformance, profile lifecycle, and policy-broker integration
remain explicit future work rather than acceptance claims for these fixture tests.

The implementation checked the installed CLI help and official OpenAI
[non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) and
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
on 2026-10-19. Documentation and feature flags may change; expanding the pinned
version requires conformance review.
