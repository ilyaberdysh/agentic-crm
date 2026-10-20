## What changed

Describe the user-visible result and the smallest useful scope of this pull request.

## Why

Link the issue or explain the concrete problem this solves.

## Verification

- [ ] Added or updated relevant tests
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`

## Agent trust boundary

If this changes how an agent reads or mutates CRM state, describe:

- the principal and capability;
- persisted evidence and provenance;
- policy and approval behavior;
- retry/idempotency behavior;
- the durable receipt.

Write `Not applicable` if no agent trust boundary changes.

## Security and data

- [ ] No credentials, generated passwords, customer data, or private research artifacts are included
- [ ] Any migration is forward-only and workspace-scoped
- [ ] Any new dependency is necessary and its license is compatible

## Deferred work

List follow-ups explicitly, or write `None`.
