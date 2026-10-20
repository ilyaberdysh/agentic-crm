# Paired runner protocol

The standalone outbound daemon lives in [`apps/runner`](../apps/runner/README.md).
Its operator guide covers pairing, private credential storage, local endpoint
allowlists, Codex configuration, shutdown and the live acceptance gates.

An operator pairs a runner from a workspace admin session. `POST /api/agentic/runners/enrollments` returns a ten-minute, single-use enrollment token. The runner calls `POST /api/agentic/runners/enroll` with that token, a runner UUID and optional CLI auth profile metadata (`id`, `provider`, `label`). Enrollment returns the runner bearer token once. The server stores only token hashes; the CLI login files and API credentials stay on the runner host. The operator can list and revoke runners through the admin-session routes.

The runner connects outbound to the API. Every request after enrollment sends `Authorization: Bearer <runner token>`. The API derives the workspace from the token only to select the tenant transaction, then verifies its hash, revocation state and delegated member in that transaction. A removed or suspended member invalidates the runner. Workspace admins can call `POST /api/agentic/runners/:id/revoke` to invalidate the bearer and grants.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/agentic/runners/claim` | Claim due tasks. A task linked to an approved action receives a short-lived grant token and a server-derived execution descriptor. |
| `POST /api/agentic/runners/heartbeat` | Extend an exact task lease and its matching grant. |
| `POST /api/agentic/runners/complete` | Finish effect-free planning work. |
| `POST /api/agentic/runners/fail` | Mark a leased task terminally failed. |
| `POST /api/agentic/runners/release` | Return a lease to the queue and revoke its grant. |
| `POST /api/agentic/runners/recover` | Recover expired leases in this workspace. |
| `POST /api/agentic/runners/resume` | Re-evaluate one blocked task from authoritative action state. |

The sole remote MCP endpoint is `POST /api/agentic/mcp` using stateless Streamable HTTP, protocol `2026-07-28`. It supports `server/discover`, `tools/list` and `tools/call`. Its only tool is `crm.task.create`. The runner's local MCP proxy sends the bearer token and the current task grant as `X-Agentic-Task-Grant`; neither token belongs in model context or tool arguments. For a linked task, the claim response's `execution` descriptor contains `id`, `receiptId`, `actionId`, `proposalDigest` and `expectedVersion`, all derived or minted by the server. Pass that descriptor as the tool arguments without adding task fields, actor, workspace, grant or outcome. The server checks the current approval and evidence before atomic CRM task creation and receipt recording. Success settles the queue task, so no separate task completion call follows. If the MCP response is lost, retry the identical descriptor and grant: the immutable receipt is returned without a second CRM task. A changed attempt or receipt ID is rejected.

Task grants are tied to one runner, task, action, record and lease generation. They expire within five minutes, and lease expiry, release, runner revocation or member removal makes them unusable. A heartbeat can extend a current grant only while the same task lease remains live. A blocked action with unknown outcome stays blocked until a human resolves its state; a runner cannot declare it successful.

## Local model dispatch

A signed-in workspace member saves a personal local model target with a paired runner ID and a loopback OpenAI-compatible endpoint. Calling `agentic.models.invoke` returns `kind: "runner-required"` and an invocation ID. The API encrypts the pending prompt with a binding to workspace, invocation, runner, target and target version; it never fetches the loopback endpoint itself or returns the prompt in the member-facing response.

| Endpoint | Runner action |
| --- | --- |
| `POST /api/agentic/models/runner/claim` | Poll with `{ "limit": 1 }`. The response contains only this bearer token's leased invocations, including endpoint, request and `leaseGeneration`. |
| `POST /api/agentic/models/runner/heartbeat` | Send `invocationId` and `leaseGeneration` before the 60-second lease expires while the local call runs. |
| `POST /api/agentic/models/runner/complete` | Send the same IDs, `outcome`, optional usage and failure code, and a bounded `text` response when completed. |

Expired leases can be claimed again with a higher generation. Completion from an older generation is rejected. The response is encrypted at rest, and the original prompt ciphertext is removed when the invocation settles. The invoking member polls `agentic.models.result` with the invocation ID to read status, text and usage; other members cannot read it. Missing token or price data remains explicitly unknown rather than becoming zero. Runner authentication and current member binding are rechecked for claim, heartbeat and completion.

An administrator can call `agentic.reconcileExecuting` with only an action ID when a legacy split execution is stranded. The server records `OUTCOME_UNKNOWN` and an immutable receipt; the caller cannot choose success or failure. The audit actor records the operator member ID.

The server does not run a CLI process. A runner process must enforce its own execution isolation and keep each CLI authentication profile separate. The API cannot verify or claim sandboxing merely because a runner enrolled.
