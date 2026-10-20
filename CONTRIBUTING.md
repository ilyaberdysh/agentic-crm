# Contributing to Agentic CRM

Agentic CRM is in early development. Focused fixes, tests, documentation, and well-supported product proposals are welcome. Large features should start with an issue so contributors do not spend time on work that conflicts with the current trust model or roadmap.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are submitted under the repository's [Apache-2.0 license](LICENSE).

## Before you start

- Open an issue or short design note before a large change.
- Keep model reasoning separate from authority to mutate CRM data.
- Extend curated capabilities and policy checks instead of giving agents raw database or ambient application access.
- Put useful deferred work in `docs/agentic-core/backlog.yaml`; do not solve hypothetical edge cases in the implementation.

## Local setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm db:up
SEED_USERS='demo@example.com:Demo User' SEED_WORKSPACE_SLUG=demo pnpm seed
AGENTIC_CRM_LLM=fake pnpm dev
```

Requirements: Node.js 24.11+, pnpm 11.11.0, and Docker with Compose.

The repository's GitHub Actions workflow runs the same lint, typecheck, test, and build commands on pull requests. A green workflow is necessary, but maintainers may request focused integration or browser verification for changes that affect user flows.

## Checks

Run the narrowest relevant test while developing, then run the repository gates before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Database-backed tests use checkout-specific databases on the local Postgres instance. Do not point test commands at a shared development or production database.

## Pull requests

- Keep each commit coherent and include the tests that prove its behavior.
- Explain the user-visible result and any trust-boundary change.
- Call out deferred work explicitly instead of hiding it in comments.
- Do not bump versions, create release tags, or attach an implementation PR to a release number. Release preparation is a separate workflow.
- Never commit `.env`, provider credentials, generated passwords, browser auth state, or customer data.
- Do not add copied product code, private research material, or assets without clear redistribution rights.

## Agentic Core review checklist

Changes that let an agent affect CRM state must answer all of these:

1. Which explicit principal and capability are involved?
2. What evidence is persisted, and can the user inspect its source?
3. Which policy is re-evaluated immediately before execution?
4. Does the user review the exact version that will execute?
5. Is the side effect idempotent or otherwise safe to retry?
6. Is there a durable, non-secret receipt for the outcome?
7. Can the queue explain why the work is waiting and what happens next?

If those answers are unclear, the change is not ready to merge.
