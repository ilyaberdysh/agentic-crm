# Source and asset provenance

## Status: public visibility blocked

A separate automated technical review of PR #9 was performed on 2026-10-20 by Codex. Its evidence and limits are recorded below. It does not establish authorship, grant redistribution rights, or constitute independent legal clearance. B018 remains open; keep the repository private until the remaining decisions are recorded.

The repository's former development history and research corpus are not included in this source export. The export must not be described as clean-room or independently cleared. The Apache-2.0 declaration in [LICENSE](LICENSE) does not settle the third-party material identified below.

## Technical review scope and results

The final implementation head reviewed here was `234f4dd106caa989d4373b21afb077a80c9650e5`, containing 1,754 tracked files and 21 commits from export root `8f431bf9a35214aa2d34b3c268f1079e19a8356b`. This evidence refresh is documentation-only; any later source change needs another scan.

| Check | Evidence and result | Limit |
| --- | --- | --- |
| Export history | All 28 advertised branch and pull-request refs were fetched into a fresh temporary bare mirror: 38 reachable commits, all descending from the same export root. No release tags were advertised. GitHub returned zero Actions artifacts and zero releases. Two dependency caches for PR #9 existed at review time. | GitHub issues, PR discussion, Actions logs, cache contents, and unadvertised server objects were not audited. The caches must be expired, deleted, or separately cleared before visibility changes. |
| Secret scan | Gitleaks 8.30.1, default rules, `--redact=100 --ignore-gitleaks-allow --log-opts='--all'`, scanned all fetched refs: 29 non-merge commits and approximately 14.24 MB. It reported one `generic-api-key` candidate: the public SHA-256 provenance checksum on line 38 of this document, introduced in `243e300`; inspection confirmed it is a content fingerprint, not a credential. No other findings were reported. | A detector match can be a false positive, and pattern scanning is not proof that every secret or private datum is absent. No scan of the private recovery archive is represented by this result. |
| Private file inventory | Tracked export paths and history were checked for research trees, non-example environment files, HAR captures, credential/key files, database dumps, archives, and bundled media. The current tree contains `.env.example` and two JPEG screenshots; no other binary assets were identified by `file`. | Generated source still embeds material derived from omitted inputs. Removing the inputs does not resolve its rights. |
| Screenshots | Both `docs/assets/agentic-core-{review,receipt}.jpg` were visually inspected. They show the Agent tab, seeded Northwind Robotics records, and an `example.com` domain; no customer correspondence or credential is visibly present. | The images also render the unresolved UI tokens and a `mymeet` workspace label. Their provenance clearance depends on the UI and branding decisions below. |
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

## Material requiring disposition

| Material | Verified origin or concern | Required disposition before public visibility |
| --- | --- | --- |
| `packages/contracts/src/v2/{api.gen.ts,openapi.gen.json}` and dependent `/v2` contracts | The historical API input's SHA-256 is `98e736fd71dc5b21073a247291802ffbe4dfb655255a5b163419fc917f037a27`, matching the committed source metadata. It identifies Attio API 2.0.0 and contains no `info.license`. The input and generator are absent from the export. | Record the applicable permission or legal basis for distributing the generated schema and retained contract material, with required notices; otherwise replace or remove it and dependent outputs. Public availability alone is not a recorded license grant. |
| `packages/ui/src/tokens/*.gen.ts`, themes, and their consumers | Historical token input SHA-256: `88a3835d0c4919390b34a6cee41d06424dee4a7aa58ac2450aed7ba4ce5335f8`. Its provenance identifies Attio's shipped web JS/CSS, and the removed generator copies token values verbatim. This is a confirmed derivation, rather than an unknown source. | Obtain a documented rights disposition covering values, organization, themes, and resulting UI, or replace them from an independently authored design source. Replacing headers or renaming tokens is insufficient. |
| Other CRM implementation and UI | Historical research included product observations and bundle-derived inventories. Current source comments still reference Attio behavior, omitted plans, and research. The technical audit did not trace every implementation file back through every research input. | Have an independent reviewer assess copied/adapted expression and applicable source-use terms, and record any required replacements. The original author must attest to authorship and permission to license the export, including any employer-owned work. |
| Illustrations, icons, and fonts | Custom glyphs in `packages/ui/src/icons/custom.tsx` and the import illustration claim project authorship in comments. Standard icons come from Lucide and Inter is imported through `@fontsource-variable/inter`; no standalone icon/font files are tracked. | Confirm custom artwork authorship. Retain upstream licenses and attribution when distributing bundled icons/fonts; see [NOTICE](NOTICE). A source comment is not an independent attestation. |
| Product identity and legal links | `apps/web/src/lib/brand.ts` now names Agentic CRM, points support to this repository, and leaves privacy, terms, and acceptable-use URLs deployment-defined. The screenshots still include a `mymeet` workspace label, and galleries contain maintainer contact examples. | The maintainer must confirm the product identity, authority to use the remaining labels and contact examples, and the policies adopted by any public deployment; correct unsupported claims before public visibility. |

Attio's current [Services Agreement](https://attio.com/legal/services-agreement) section 4 and [Acceptable Use Terms](https://attio.com/legal/acceptable-use) section 4 contain restrictions relevant to reverse engineering and derivative works, with legal exceptions. The applicable agreement, permissions, jurisdiction, and any exception must be assessed by a qualified reviewer; this audit makes no finding that a breach occurred. The public pages checked on 2026-10-20 do not establish which terms applied to the original research.

Some legacy comments in generated outputs and checksum-tracked migrations refer to the omitted `research/` tree. Preserve useful origin evidence while resolving the underlying material. Do not edit applied migrations to erase those references: their checksums are part of the migration contract.

## Closure record required for B018

The maintainer must add a dated disposition for each row above, naming the reviewer, reviewed commit, evidence reference, affected paths, and outcome (`permitted with stated obligations`, `replaced`, or `removed`). Confidential legal evidence may remain private, but the repository needs a non-confidential decision summary and any required attribution.

Before changing visibility, all of these must be complete:

- An author/rights-holder attestation covers the original implementation, custom assets, and authority to license the contribution. No such attestation was available for this audit.
- A qualified independent review resolves the API, token, and inherited implementation questions. An automated scan or a maintainer's visibility approval does not replace that disposition.
- Any replacements/removals are implemented, tested, and reviewed, and the final public refs and screenshots are rescanned. Historical copies in any refs intended for publication must also be addressed.
- The maintainer confirms product identity, legal/support links, private reporting, and a final GitHub metadata/log/artifact privacy check.

Binary and container distributions have an additional gate: generate and review the complete license/attribution report for the actual bundled artifact, including transitive dependencies, fonts, images, and CLI/runtime software. That distribution review remains unaudited.
