# Security policy

Agentic CRM is under active development and has not had a production security audit. Do not use the current branch with sensitive customer data or expose a development deployment to the public internet.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting flow from the repository's **Security** tab. Do not open a public issue with exploit details, credentials, customer data, or proof-of-concept payloads. If private reporting is temporarily unavailable, open a public issue asking for private maintainer contact without including technical details.

Include:

- the affected commit and component;
- the smallest reproducible scenario;
- expected and observed behavior;
- realistic impact;
- any temporary mitigation you verified.

## Sensitive areas

Please treat findings in these paths as high priority:

- provider credentials and encryption;
- model or CLI execution boundaries;
- policy evaluation and action approval;
- public API authorization and workspace isolation;
- queue leases, retries, and duplicate side effects;
- prompt or tool output crossing into CRM mutations;
- file uploads, signed URLs, OAuth tokens, and external integrations.

## Development credentials

The repository contains intentionally weak local-only defaults for Docker development services. They are not production credentials. Production deployments must set unique secrets, encryption keys, database credentials, and provider keys outside the repository.

Never attach real CRM data, API keys, OAuth tokens, generated seed passwords, `.env` files, or CLI authentication profiles to an issue or pull request.

## Supported versions

Agentic CRM has not published a stable release. Security fixes currently target the latest commit on `main`; older snapshots are not supported.
