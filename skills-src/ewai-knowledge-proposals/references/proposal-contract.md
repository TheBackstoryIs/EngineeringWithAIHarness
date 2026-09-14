# Knowledge proposal contract

## Bundle envelope

Submit one `ewai.knowledge-proposal-bundle/v1` object:

```json
{
  "schema": "ewai.knowledge-proposal-bundle/v1",
  "sourceRef": "retrospective:sprint-24",
  "sourceDigest": "64-lowercase-hex-characters",
  "proposals": []
}
```

Every proposal ID uses `KNP-###` with at least three digits. IDs and destinations are unique within the bundle. The source reference, digest and anchor IDs must exactly match preparation.

## Proposal fields

Each proposal contains only `id`, `kind`, `title`, `destination`, `evidenceAnchors`, `rationale`, `uncertainty`, `relationships` and `proposedMarkdown`. Use one to 30 prepared anchors. Begin Markdown with one H1 and include `## Provenance` with the exact source reference and every anchor.

Do not include raw source excerpts, prompts, chain-of-thought, executable content, credentials, approval claims or extra fields.

## Closed taxonomy and destination roots

| Kind | Destination root below the configured SPECS root |
| --- | --- |
| `project-persona` | `1.Scope/personas/project/` |
| `system` | `1.Scope/domain/systems/` |
| `process` | `1.Scope/domain/processes/` |
| `data-concept` | `1.Scope/domain/data/` |
| `journey` | `2.Purpose/journeys/` |
| `requirement` | `2.Purpose/requirements/pending/` |
| `feature-candidate` | `2.Purpose/explorations/feature-candidates/` |
| `risk` | `3.Evidence/risk/` |
| `policy` | `4.Constraints/compliance/policies/` |
| `constraint` | `4.Constraints/` |
| `standard` | `4.Constraints/standards/` |
| `decision` | `5.Strategy/decisions/` |
| `pattern` | `5.Strategy/patterns/` |
| `anti-pattern` | `5.Strategy/anti-patterns/` |
| `runbook` | `5.Strategy/runbooks/` |
| `sop` | `5.Strategy/sops/` |

The filename is safe lowercase kebab-case Markdown. A model cannot nominate `6.Build`, runtime state, an absolute path or another project.

## Review contract

Every proposal receives exactly one `accepted`, `rejected`, `amended` or `deferred` disposition. Rejected and deferred decisions require rationale. Amended decisions require rationale, replacement title and complete replacement Markdown with source provenance.

Review is stored beside the immutable bundle below `SPECS/3.Evidence/knowledge-proposals/<bundle-id>/`. It does not write the proposed destination.

## Materialisation states

- `additive`: destination is absent and may be created after separate named approval.
- `already-current`: destination is byte-identical and no write is needed.
- `conflict`: destination differs, is a symlink or is not a regular file; preserve it unchanged.

Materialisation revalidates `sourceDigest`, bundle digest and review digest. The immutable ledger is persisted before `ewai.knowledge-proposals.materialised` is published. Lifecycle handlers receive identifiers, digests, counts and timestamps only and cannot alter canonical truth.
