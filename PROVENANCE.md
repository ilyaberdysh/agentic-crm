# Source and asset provenance

## Status

An independent, file-by-file provenance review has not been completed. This repository is an early public-preview candidate; its current contents must not be described as clean-room or independently verified.

The repository's former development history and research corpus are not included in this source export. As a result, the current Git history does not establish the origin, authorship, or redistribution rights of every file and asset.

## Known review items

- The generated Attio-compatible `/v2` contract files under `packages/contracts/src/v2/` need review against the applicable public API materials and their license terms.
- The generated UI token snapshots under `packages/ui/src/tokens/` need review for source, authorship, and redistribution rights.
- Some legacy comments in generated contract outputs and checksum-tracked database migrations still refer to the omitted `research/` tree. Those comments are not proof that the referenced materials are included or that the surrounding implementation has passed provenance review. Migration files are checksum-tracked and should not be edited casually; generated files should be updated from their authoritative source.
- The source export and visual assets need a complete review for copied or adapted material and redistribution rights.
- Third-party dependency attribution for source use is summarized in [NOTICE](NOTICE). License compliance for binary, container, and hosted distributions remains unaudited.

## Before public release

Maintainers should record the reviewer, date, scope, and disposition for each item above. For any material without clear provenance or redistribution rights, replace it with independently authored material or remove it. Do not mark this review complete based only on the absence of the old research files.

Until that work is complete, keep the repository in preview status and do not claim that its source has been independently cleared.
