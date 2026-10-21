# Installed dependency license inventory

Technical snapshot: 2026-10-21, macOS arm64, pnpm 11.11.0, frozen lockfile SHA-256 `47048b4ec0916d5937a68bd66027dd68575e9aa7cb25e5ea4e1a65a0220d97f3`.

`node scripts/publication/licenses.mjs /path/outside/repository/new-directory` produced a complete JSON inventory and original available notice texts for **458 installed package versions**, including development dependencies. Absolute workstation paths are omitted. Re-run this command on the build platform for a changed lockfile or artifact. This table summarizes that generated inventory; it does not inventory every optional platform in the lockfile, base-image packages, externally installed CLIs, or establish legal compatibility.

| Reported/resolved license expression | Installed package versions |
| --- | ---: |
| MIT | 376 |
| ISC | 34 |
| Apache-2.0 | 21 |
| BSD-3-Clause | 8 |
| BSD-2-Clause | 3 |
| Unlicense | 3 |
| MIT OR Apache-2.0 | 2 |
| MIT-0 | 2 |
| MPL-2.0 | 2 |
| OFL-1.1 | 1 |
| MIT and ISC | 1 |
| CC-BY-4.0 | 1 |
| BlueOak-1.0.0 | 1 |
| CC0-1.0 | 1 |
| 0BSD | 1 |
| (MIT OR CC0-1.0) | 1 |

Upstream expression spelling is retained. `require-like@0.1.2` has no npm license field; its installed `License` file contains MIT terms and the generator accepts that resolution only while its exact SHA-256 matches the reviewed text. This resolves missing metadata for the inventory and does not replace the upstream notice.

Material requiring explicit artifact review includes Inter Variable (`@fontsource-variable/inter@5.3.0`, OFL-1.1), Lucide (`lucide-react@1.51.0`, ISC and bundled Feather MIT notices), `caniuse-lite@1.0.30001815` (CC-BY-4.0), and `lightningcss@1.33.0` and its platform binding (MPL-2.0). Build dependencies may not be present in the final frontend, while the current app image includes development packages. Determine the obligations from what is actually distributed and any modifications; these examples do not limit the review to direct dependencies.

Twelve installed package versions have declarations but no standalone license/notice file detected at their package root or license directory: `@better-auth/utils@0.4.2`, `@better-auth/utils@0.5.0`, `@biomejs/cli-darwin-arm64@2.5.15`, `@esbuild/darwin-arm64@0.28.2`, `@rolldown/binding-darwin-arm64@1.2.13`, `abstract-logging@2.0.1`, `client-only@0.0.1`, `media-query-parser@2.0.2`, `pg-types@2.2.0`, `pgpass@1.0.5`, `saxes@6.0.0`, and `standardwebhooks@1.1.1`. The generated `missingNoticeFiles` list makes this visible. Retrieve and review the exact upstream version's notices where required before distributing those packages; do not treat metadata alone as a complete notice bundle.

See [publication.md](publication.md) for reproducible secret/history scans, fresh-snapshot export and verification, the immutable-image SBOM/vulnerability/license gate, and the separate maintainer review required before binary, container, or hosted distribution. No complete distribution approval is asserted here.
