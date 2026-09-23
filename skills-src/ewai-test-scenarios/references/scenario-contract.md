# Persona test-scenario contract

Read this reference when preparing a candidate pack, reviewing validation errors, implementing accepted tests, or interpreting workspace status.

## Authority layers

| Layer | May do | Must not do |
| --- | --- | --- |
| Authoritative source | Define an accepted outcome, constraint, journey, criterion, standard, claim, or test obligation | Be silently replaced by persona output |
| Contextual impact evidence | Identify an observed or inferred area worth challenging | Authorise expected product behaviour by itself |
| Persona contribution | Expose a concern, edge case, ambiguity, or hypothesis | Act as stakeholder fact, approval, or completed evidence |
| Human decision | Accept, reject, block, supersede, or route a scenario | Be inferred from model fluency |
| Test evidence | Demonstrate the accepted observable result through the named route | Rewrite the oracle to make current code pass |

## Preparation contract

`ewai test-scenarios prepare <slug> --focus "..." --project . --json` returns `ewai.persona-test-brief/v1` with:

- `sourceDigest` for the bounded project evidence;
- `authoritativeSources[]` containing stable IDs, kind, label, safe path, digest, and excerpt;
- `contextualEvidence[]` for non-authoritative impact context;
- `activePersonas[]` containing only ID, name, tier, category, bounded description, matched signals, and engagement reason;
- installed availability for core, premium, personal, and project tiers;
- unresolved questions, recording enums, and the human-authority boundary.

Preparation is read-only. It never invokes a network, Git, an LLM, or premium synchronisation.

## Candidate schema

Use this shape:

```json
{
  "schema": "ewai.persona-test-scenarios/v1",
  "slug": "customer-access",
  "focus": "permission and recovery",
  "preparedSourceDigest": "<digest from preparation>",
  "scenarios": [
    {
      "id": "PTS-001",
      "title": "Authorised delegate completes the request",
      "type": "happy-path",
      "sourceRefs": ["intent:journey:J-001", "intent:acceptance:AC-001"],
      "personaContributions": [
        {
          "personaId": "project.product-owner",
          "concern": "Prove the intended outcome and permission boundary."
        }
      ],
      "preconditions": ["An authenticated delegate may request access."],
      "actions": ["Submit a valid access request."],
      "expectedResults": ["The request is accepted and a clear success outcome is displayed."],
      "evidenceRoute": "automated",
      "automation": "automated",
      "plannedTest": {
        "file": "tests/access.test.mjs",
        "name": "authorised delegate completes access request"
      },
      "owner": "Delivery team",
      "status": "accepted"
    }
  ],
  "gaps": []
}
```

Scenario IDs use `PTS-###` and remain stable. Supported types are `happy-path`, `alternate`, `error`, `permissions`, `accessibility`, `security-privacy`, `operations`, `recovery`, `data`, `misuse`, `adversarial`, and `regression`.

Supported status values are `accepted`, `blocked`, `superseded`, and `hypothesis`. An accepted scenario needs at least one known authoritative source reference. A blocked or hypothesis item may preserve a question without presenting it as accepted behaviour.

Evidence routes are `automated`, `manual-qa`, `specialist-assurance`, and `representative-user`. Automation values are `automated`, `manual`, and `hybrid`. Automated and hybrid scenarios require a safe repository-relative planned test file and named test.

## Evidence and status

Recording writes authoritative `test-scenarios.json` and readable `test-scenarios.md` under the delivery root. The JSON retains the content digest and the Markdown digest. Identical input is idempotent; conflicting accepted evidence is not overwritten.

Status means:

- `missing`: no reviewed pack exists;
- `recorded`: the pair and current sources match;
- `stale`: an authoritative source changed after review;
- `invalid`: the pair, schema, slug, content digest, or Markdown digest does not match.

JSON is authoritative. Never parse or manually edit Markdown to repair scenario state.

New briefs and records carry `sourceDigestVersion: intent-content-v2`. Intent fingerprints cover the complete body and all parsed metadata except the five workflow fields `status`, `delivery_status`, `current_phase`, `delivery_state_path` and `updated_at`. Do not treat excerpts as the fingerprint boundary. Other evidence retains whole-file fingerprints, so genuine source changes still require review. Unsupported digest versions fail closed.

Require at least one recognised intent source (captured Problem, Desired outcome or Constraints, or a listed Journey or Acceptance criterion), even when planning documents exist. Without it, preparation and recording fail closed and historical packs cannot claim current intent coverage. Content fingerprints accept only plain mappings, arrays and JSON scalar metadata; reject typed YAML dates, sets, ordered maps, binary values, non-finite numbers and cyclic aliases instead of silently erasing their meaning. Ordinary quoted date strings and repeated non-cyclic aliases remain supported. Do not convert unsupported sources or rewrite accepted evidence without the appropriate owner review.

Legacy unversioned pairs remain readable with their original whole-file checks. An exact replay through `record`, while those sources are still current, may add the immutable `test-scenarios.source-baseline.json` compatibility receipt. It is bound to the original record digest and reviewed sources; both accepted evidence files remain byte-identical. Preparation and status remain read-only. Never bypass an already-stale legacy record, replace its pair, or edit the receipt manually. Keep the receipt alongside its pair; malformed, unsafe or mismatched receipt evidence is invalid. This is a fingerprint compatibility operation, not a revised-scenario approval or a way to accept changed requirements.

## Human evidence boundary

Manual QA remains an explicit named human gate. Specialist assurance requires an accountable practitioner. Representative-user validation requires real representative participants. Persona simulation may improve the question set but may not complete any of those routes.
