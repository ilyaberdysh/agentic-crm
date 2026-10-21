# Community launch materials

This page records suggested GitHub storefront copy and a repeatable local demo capture workflow. It does not imply a hosted demo exists; the demo runs on the recorder's machine with fictional seed data.

## GitHub repository metadata

Suggested repository description (within GitHub's 350-character limit):

> Open-source CRM preview where agents propose evidence-backed work and people approve consequential changes. Self-hostable TypeScript app with PostgreSQL, a supervised agent workflow, and a deterministic local demo.

Suggested topics: `crm`, `open-source`, `agentic-ai`, `human-in-the-loop`, `postgresql`, `self-hosted`, `typescript`.

Suggested social preview alt text: “Agentic CRM: evidence, policy, and a human decision before an agent creates a CRM task.” Upload the ready 1280×640 [PNG](assets/social-preview.png) in GitHub's Social preview settings; [the SVG](assets/social-preview.svg) is its editable source. Keep the README hero image and social preview consistent, and use the seeded fictional Northwind Robotics scene rather than real customer data.

## Local demo recording

Use a clean checkout, current supported Node.js, pnpm, and Docker Compose. The `fake` model is deterministic, so no hosted API key or hosted demo is needed. The checked-in capture command uses a dedicated E2E database that is dropped, recreated, migrated, and seeded for every run, preventing a previous approval from leaking into the next recording.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm db:up
SEED_USERS='demo@example.com:Demo User' SEED_WORKSPACE_SLUG=demo pnpm seed
AGENTIC_CRM_LLM=fake pnpm dev
```

Sign in at `http://localhost:5173` with the one-time password printed by seed. Follow the printed Agent demo URL, confirm the Northwind Robotics source quote and proposed task, approve it, and capture the created task and receipt. Frame the browser at a consistent desktop viewport (1280×800 is suitable), hide unrelated windows, and avoid showing terminal output, credentials, personal browser data, or machine notifications. A short capture should explain the evidence → proposal → review → receipt sequence with captions; do not imply that the fake model demonstrates model quality or that other action types are already supervised.

On macOS, record the browser with the built-in Screenshot toolbar (Shift-Command-5) or QuickTime Player's screen recording. On Linux, use the desktop's built-in recorder. Capture a short MP4 master, trim pauses, then export a small looping GIF only if it remains legible at README width. Keep source captures outside the repository until reviewed; commit only optimized, cropped, non-sensitive exports. Recheck that the recording contains no password or other secrets before sharing.

Current asset set:

- Keep the existing `docs/assets/agentic-core-review.jpg` and `agentic-core-receipt.jpg` as static README screenshots.
- `docs/assets/agentic-demo.gif` is the generated README hero. It is a short, silent, sub-1 MB capture of proposal review through receipt; regenerate it with `./apps/web/e2e/capture-demo.sh` after visible flow changes.
- `docs/assets/social-preview.svg` is the editable social-card source and `docs/assets/social-preview.png` is the 1280×640 upload artifact.
- Record metadata for each capture: date, app revision, viewport, seed workflow, and whether any provider integration was active.

Regenerate the GIF from the fresh isolated E2E state with:

```sh
./apps/web/e2e/capture-demo.sh
```
