# Source and asset provenance

## Status: source disposition recorded; clean-snapshot publication pending

A separate automated technical review of PR #9 was performed on 2026-10-20 by Codex. Its evidence and limits are recorded below. It does not establish authorship, grant redistribution rights, or constitute legal advice. The maintainer disposition below resolves the authorship and source-use decisions for this repository; the repository remains private until the replacement work and final public-ref scan are complete.

The repository's former development history and research corpus are not included in this source export. The export must not be described as clean-room or independently cleared. The Apache-2.0 declaration in [LICENSE](LICENSE) applies to contributions the maintainers have authority to license. Third-party dependencies and their notices remain governed by their own licenses.

## Maintainer attestation and disposition

On 2026-10-20, GitHub maintainer `@ilyaberdysh` recorded the following disposition for the source export reviewed in PR #9:

- Agentic CRM is an independently implemented product. Product observation and lawful reverse engineering were used to understand externally visible behavior; original Attio source code, SVGs, images, fonts, and other proprietary assets were not copied into this repository.
- The CRM implementation, UI components, custom glyphs, and screenshots were authored for this project. The maintainer has authority to publish those contributions under Apache-2.0.
- The UI token values are intentionally retained. The maintainer states that the UI was implemented by the project team through a lawful process and authorizes distribution of the resulting implementation. This is a maintainer disposition, not a claim that an automated audit independently proved the origin of every numeric token.
- The historical generated public-API snapshot is being removed and replaced by a product-owned contract derived from Agentic CRM's implemented routes and schemas. The replacement must pass route-parity, schema, and drift checks before this disposition is marked complete.
- Product identity, example data, and the remaining custom artwork are approved for publication as Agentic CRM. Deployment operators remain responsible for supplying their own privacy, terms, acceptable-use, and security-reporting URLs.

This attestation records the maintainer's factual assertions and publication decision. It is not an external legal opinion.

## Technical review scope and results

The baseline implementation head reviewed here was `234f4dd106caa989d4373b21afb077a80c9650e5`, containing 1,754 tracked files and 21 commits from export root `8f431bf9a35214aa2d34b3c268f1079e19a8356b`. Later replacement work is reviewed and verified separately before publication.

| Check | Evidence and result | Limit |
| --- | --- | --- |
| Export history | A fresh read-only audit found 26 advertised branch and pull-request refs: 38 reachable commits, all descending from the same export root. No release tags were advertised. GitHub returned zero Actions artifacts and zero releases. Two dependency caches for PR #9 existed at review time. | The removed API snapshot remains reachable through repository history and read-only pull-request refs. This repository must remain private; publication requires a reviewed clean snapshot in a fresh repository. GitHub issues, PR discussion, Actions logs, cache contents, and unadvertised server objects were not audited. |
| Secret scan | Gitleaks 8.30.1, default rules, `--redact=100 --ignore-gitleaks-allow --log-opts='--all'`, scanned all fetched refs: 29 non-merge commits and approximately 14.24 MB. It reported one `generic-api-key` candidate: the public SHA-256 provenance checksum on line 38 of this document, introduced in `243e300`; inspection confirmed it is a content fingerprint, not a credential. No other findings were reported. | A detector match can be a false positive, and pattern scanning is not proof that every secret or private datum is absent. No scan of the private recovery archive is represented by this result. |
| Private file inventory | Tracked export paths and history were checked for research trees, non-example environment files, HAR captures, credential/key files, database dumps, archives, and bundled media. The current tree contains `.env.example` and two JPEG screenshots; no other binary assets were identified by `file`. | Generated source still embeds material derived from omitted inputs. Removing the inputs does not resolve its rights. |
| Screenshots | Both `docs/assets/agentic-core-{review,receipt}.jpg` were visually inspected. They show the Agent tab, seeded Northwind Robotics records, and an `example.com` domain; no customer correspondence or credential is visibly present. | The images also render the retained UI tokens and a `mymeet` workspace label. Their publication follows the maintainer disposition and final privacy review below. |
| Community files | LICENSE, NOTICE, CONTRIBUTING, SECURITY, Code of Conduct, issue templates, and PR template are present. Root package metadata declares Apache-2.0; workspace packages are private. Support points to this repository's issue tracker, while policy URLs are deployment-defined. The private-reporting API returned HTTP 404 for the private repository. | A working private reporting route and the deployment policy links require maintainer confirmation; the API response does not establish that the advertised reporting route works. |
| Earlier source | Maintainer-supplied recovery history was inspected in a temporary bare repository, without checking it out or changing this repository's refs. | Historical process notes are evidence of origin, not proof of permission or an author attestation. Recovered research was not added to this export. |
| Archived fork comparison | The earlier source branch has a separate root from the archived Twenty fork. Exact-blob comparison of the reviewed export against that fork found only the standard one-line Vite type-reference declaration in `packages/ui/gallery/src/env.d.ts`. | This rules out other byte-identical blobs in that comparison only; it does not rule out adapted code or establish a license conclusion. |

The secret scan can be repeated on a complete local mirror of the proposed public refs with:

```sh
env -u GITLEAKS_CONFIG -u GITLEAKS_CONFIG_TOML \
  gitleaks git --no-banner --no-color --redact=100 \
  --ignore-gitleaks-allow --log-opts='--all' /path/to/export.git
```

Do not upload the private recovery archive, scanner input, or unredacted scan output to the repository or its CI artifacts.

## Material disposition

| Material | Technical evidence | Maintainer disposition |
| --- | --- | --- |
| Historical generated `/v2` contract | The removed snapshot identified Attio API 2.0.0 as its input and recorded source SHA-256 `98e736fd71dc5b21073a247291802ffbe4dfb655255a5b163419fc917f037a27`. | **Replace.** Publish only the Agentic CRM contract generated from the implemented route manifest and product-owned Zod schemas. Verify exact runtime-route parity and deterministic generation. |
| `packages/ui/src/tokens/*.gen.ts`, themes, and their consumers | Historical process records identify shipped web JS/CSS as an observation source and record token-input SHA-256 `88a3835d0c4919390b34a6cee41d06424dee4a7aa58ac2450aed7ba4ce5335f8`. | **Retain under maintainer disposition.** The maintainer attests to lawful reverse engineering, project authorship of the UI implementation, and authority to distribute it. Preserve this provenance record rather than relabelling the token set as independently designed. |
| Other CRM implementation and UI | Historical research included product observations and bundle-derived inventories. The technical audit did not trace every implementation file through every research input. | **Retain under maintainer disposition.** Product-specific source comments are removed where they do not explain a current Agentic CRM invariant; applied migrations remain immutable historical records. |
| Illustrations, icons, and fonts | Custom glyphs and the import illustration are implemented in repository source. Standard icons come from Lucide and Inter is imported through `@fontsource-variable/inter`; no standalone third-party icon/font files are tracked. | **Permitted with stated obligations.** The maintainer attests to authorship of custom artwork. Retain upstream licenses and attribution for bundled Lucide and Inter assets; see [NOTICE](NOTICE). |
| Product identity and legal links | `apps/web/src/lib/brand.ts` names Agentic CRM, points support to this repository, and leaves privacy, terms, and acceptable-use URLs deployment-defined. Screenshots use seeded example records and a maintainer-controlled workspace label. | **Permitted.** The maintainer confirms the product identity and example content. Deployment-specific policy URLs must be configured before operating a public service. |

Some legacy comments in generated outputs and checksum-tracked migrations refer to the omitted `research/` tree. Preserve useful origin evidence while resolving the underlying material. Do not edit applied migrations to erase those references: their checksums are part of the migration contract.

## Remaining technical publication gate

Before changing visibility, all of these must be complete:

- The product-owned API contract replacement is implemented, tested, and reviewed.
- Product-specific source comments are removed except where immutable applied migrations preserve historical checksums or compatibility names are still part of a supported wire protocol.
- A reviewed clean snapshot is created in a fresh repository and scanned for credentials, private research, removed generated snapshots, and unwanted history. The current repository remains private because replacing a file at `HEAD` cannot remove it from GitHub's read-only pull-request refs.
- GitHub metadata, Actions logs/artifacts/caches, screenshots, support routing, and deployment policy links receive a final privacy check.

Binary and container distributions have an additional gate: generate and review the complete license/attribution report for the actual bundled artifact, including transitive dependencies, fonts, images, and CLI/runtime software. That distribution review remains unaudited.
