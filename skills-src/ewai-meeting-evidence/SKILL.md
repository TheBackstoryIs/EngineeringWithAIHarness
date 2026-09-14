---
name: ewai-meeting-evidence
description: Register a local meeting transcript or minutes file, prepare a privacy-aware extraction contract with contextually selected personas, create source-anchored evidence candidates, record complete named review, and promote accepted evidence only. Use when a user asks EWAI to learn from meeting minutes, VTT or SRT captions, plain-text transcripts, call notes, or a supplied transcript while preserving provenance and human authority.
---

# EWAI Meeting Evidence

Turn a registered meeting source into concise, reviewed project evidence. Read [the candidate contract](references/candidate-contract.md) before inspecting an allowed source or constructing a bundle.

This skill does not transcribe recordings, connect to meeting platforms, copy raw material into SPECS, or author downstream project truth automatically. Refined is a separate product and is explicitly out of scope.

## Register with explicit permission

Establish the file, label, classification and cloud-processing policy. Confirm that the user is authorised to process the material and has considered privileged, HR, credential, unrelated-client and personal content.

Register only after explicit confirmation:

```bash
ewai meeting register <file> \
  --project . \
  --label "Product sync" \
  --classification internal \
  --cloud-processing allowed \
  --yes \
  --json
```

Supported sources are Markdown, text, VTT and SRT files within the deterministic size and line limits. Registration stores the absolute path only in the gitignored private runtime record. Never reproduce that path, participant details or raw source text in public responses.

If cloud processing is denied or unknown, do not open, inspect or read the source in a hosted session. Run preparation to report the `manual-local-handoff` route, then stop source inspection and help the user choose an approved local process. Do not weaken the policy.

## Prepare before extraction

Run:

```bash
ewai meeting prepare <source-id> --project . --json
```

Preparation verifies freshness and returns safe source facts, the processing decision, the exact candidate contract and the active persona ensemble. It does not invoke a model.

The standard host model with project and core personas is the complete baseline. Premium personas participate only when installed and contextually relevant; installed personal personas can also add optional specialist depth. Never sync, download, update, imitate or expose a premium persona as part of this skill.

Before semantic work, show every active persona name, tier, matched signal and engagement reason. Use only the returned ensemble. When the source or focus changes, prepare again and swap the ensemble; do not accumulate stale personas. Personas advise interpretation and coverage. They do not provide source evidence, stakeholder consent, review, approval or release authority.

## Extract candidates in bounded passes

Use the source only when `processing.permitted` is true. Work linearly or in bounded line ranges so anchors remain stable. Apply different returned persona lenses to relevant passes, keeping their concerns distinct.

For every candidate:

1. Assign a stable `MEC-###` ID and an allowed type.
2. Put only a concise source-grounded paraphrase in `observedStatement`.
3. Put analysis, consequence or uncertainty in `interpretation`.
4. Cite one or more exact `lineAnchors` within the registered line count.
5. Use only `low`, `medium` or `high` confidence.

Do not include transcript excerpts, prompts, private paths, participant identifiers or raw model output. Do not infer consensus, authority or implementation merely because a topic was discussed.

## Obtain complete named review

Present manageable candidate groups to an accountable person. They must mark every candidate exactly once as `accepted`, `rejected`, `amended` or `deferred`. An amendment requires replacement text and a rationale.

Create a project-relative JSON review input following the reference contract, then record it:

```bash
ewai meeting review <source-id> \
  --input <project-relative-review.json> \
  --reviewed-by "Named reviewer" \
  --project . \
  --json
```

A named review is durable but remains private runtime state until separately promoted. Never manufacture a reviewer name or treat persona agreement as review.

## Promote evidence separately

Inspect current status first:

```bash
ewai meeting status <source-id> --project . --json
```

After the person confirms the reviewed bundle and understands the authority boundary, promote accepted and amended candidates only:

```bash
ewai meeting promote <source-id> \
  --project . \
  --yes \
  --approved-by "Named approver" \
  --json
```

Promotion is evidence-only. It writes the paired `evidence.json` and `evidence.md` under the configured SPECS root at `3.Evidence/meeting-evidence/<source-id>/`. It does not create or change an intent, task, requirement, process, policy, persona, architecture decision, approval, accepted risk, Build state, Manual QA, deployment or release.

## Recover and stop safely

- If source freshness is not `current`, stop and register or review the current source.
- If cloud processing is denied or unknown, use the manual local route and do not inspect content.
- If bundle validation fails, fix the candidate file; do not bypass the schema.
- If review is incomplete or conflicting, return it to the named reviewer.
- If promotion finds drift, an incomplete pair or conflicting evidence, preserve the records and investigate.
- An identical promotion retry is idempotent; do not edit promoted files to force a different result.
- If evidence suggests downstream work, create or enrich an intent only through the normal separately approved workflow.

Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.
