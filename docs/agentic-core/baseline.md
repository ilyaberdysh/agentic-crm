# Agentic Core v1 baseline

Base: `main` at `66462be736d4345c3e6ce32002ec2f409f7fd551`.

Environment: Node `v26.5.0`, pnpm `11.11.0`, Turbo `2.11.7`.

| Check | Result | Evidence |
|---|---|---|
| `pnpm lint` | pass | 0.67s; Biome checked 1,607 files |
| `pnpm typecheck` | pass | 11.03s; Turbo 12/12 successful, 5 cached |
| credential-free unit tests | pass | 10.63s; 1,261 tests across six workspaces |

The credential-free test command was:

```sh
pnpm --filter @agentic-crm/config --filter @agentic-crm/contracts \
  --filter @agentic-crm/formula --filter @agentic-crm/realtime \
  --filter @agentic-crm/editor --filter @agentic-crm/web test
```

API, domain, collab, and worker suites were not run in W0 because their global setup
recreates and migrates suite databases. Playwright was also deferred. Those checks are
required when their owned paths enter the implementation wave. Non-fatal Node
experimental localStorage warnings appeared in editor and web tests.
