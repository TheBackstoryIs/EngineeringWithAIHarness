# Evidence-depth contract

## Authority model

| Concern | Authority |
|---|---|
| Repository state | Fresh EWAI Source Map; observed or inferred only |
| Business purpose and intended behaviour | Attributed owner declaration or confirmation |
| Investigation lenses | Contextual personas; advisory only |
| Selected depth | Named accountable reviewer |
| Stable gap identity | Deterministic structured condition and evidence references |
| Gap grouping | Explicit named review; separate from gap identity |
| Build, Manual QA, deployment, release | Existing EWAI gates; never an evidence-depth run |

## Preparation input

The normalized preparation records:

- project fingerprint;
- fresh Source Map run, digest, profile digest, and coverage;
- contract, pack, and provider capability revisions;
- explicit exclusions;
- predecessor run when applicable;
- bounded active persona identifiers, tiers, and reason codes;
- bounded evidence identifiers, authority, kind, and digests;
- exactly seven dimension recommendations, drivers, evidence references, and coverage;
- deterministic gap conditions;
- a proposed grouping strategy, which does not modify gap identity.

Do not include prompt text, generated answer text, transcript or source bodies, absolute paths, secrets, raw premium persona content, or unbounded model output.

## Owner evidence input

An optional preparation input file has this form:

```json
{
  "focus": "security and recovery",
  "ownerEvidence": [
    {
      "id": "owner:security-boundary",
      "dimension": "security",
      "authority": "confirmed",
      "evidenceDigest": "sha256:bounded-evidence-identifier",
      "answerCode": "internal-users-only",
      "reasonCode": "named-owner-review",
      "contradiction": "none"
    }
  ]
}
```

Allowed authority values are `declared` and `confirmed`. Allowed contradiction values are `none`, `declared-versus-observed`, `observed-versus-observed`, `declared-versus-declared`, and `unresolved`.

## Review input

A review must bind to one exact preparation digest, name the reviewer, cover every dimension exactly once, and assign every eligible gap exactly once.

```json
{
  "schema": "ewai.evidence-depth-review/v1",
  "expectedPreparationDigest": "sha256:...",
  "reviewedBy": "Named owner",
  "dimensions": [
    {
      "id": "architecture",
      "selectedDepth": "deep",
      "rationale": ""
    }
  ],
  "grouping": {
    "strategy": "user-outcome",
    "assignments": [
      {
        "gapId": "GAP-ARC-...",
        "groupId": "platform-boundary",
        "disposition": "owned"
      }
    ]
  }
}
```

Repeat the dimension object for architecture, data, security, product, delivery, governance, and operations. Allowed depths are `bounded`, `standard`, and `deep`. Reducing a recommendation requires a substantive rationale. Allowed grouping dispositions are `owned`, `shared`, `deferred`, and `excluded`.

## Stable identity

Exclude timestamps, filesystem roots, ordering differences, and generated prose from preparation identity. Include the project and Source Map fingerprints, contract and pack versions, provider capability revision, exclusions, persona identities, evidence identities, dimension structure, coverage, and structured gaps.

A stable gap ID is derived from:

- dimension;
- condition;
- current-state code;
- intended-state code;
- sorted evidence references.

Owner assignment, contradiction state, disposition, and later grouping are reviewable state around the gap; grouping never replaces or renames the gap.

## Comparison order

Compare fingerprints in this order:

1. governed inputs;
2. evidence;
3. personas;
4. owner-selected depth;
5. coverage;
6. stable gaps;
7. grouping.

A changed grouping with unchanged gaps is explainable. A changed coverage or gap fingerprint without a material upstream change is unexplained variance and makes the comparison non-reproducible.

## Failure and recovery states

| State | Required action |
|---|---|
| `source-map-missing` | Run `ewai index refresh --project <path> --json` |
| `source-map-stale` | Refresh the Source Map and prepare again |
| `not-prepared` | Prepare a run after confirming evidence inputs |
| stale preparation digest | Read the latest workspace and repeat named review |
| missing depth decision | Add exactly one decision for every dimension |
| reduced depth without rationale | Capture accountable rationale or restore the recommendation |
| unassigned gap | Assign an explicit group and disposition |
| unexplained comparison variance | Restore missing evidence context or retain the run as non-reproducible |

Never recover by silently dropping a failed, excluded, contradictory, or unknown surface.
