# Meeting evidence implementer guide

Meeting evidence is a project-local capability built around one domain contract and four adapters: CLI, MCP, loopback HTTP and the Mind Palace UI. The adapters do not implement their own review or promotion rules.

Meeting-platform connectors, recording, transcription, diarisation, OCR and provider-specific model calls aren't part of this implementation.

## Architecture

`src/meeting-evidence.mjs` owns:

- safe registration and private source records;
- digest freshness and processing policy;
- contextual persona selection across project, core, installed premium and personal libraries;
- the host extraction contract;
- candidate, anchor and named-disposition validation;
- digest-bound review records;
- paired evidence persistence, recovery and idempotency;
- the safe public workspace projection;
- post-persistence publication of `ewai.meeting-evidence.promoted`.

The configured project root comes from EWAI. Browser and MCP callers cannot send an alternative root.

## Storage model

Private, gitignored runtime records live below:

```text
.ewai-pipeline/meeting-evidence/
├── sources/<source-id>.json
├── reviews/<source-id>.json
└── transactions/<source-id>.json
```

The private source record is the only EWAI artefact containing the absolute file path. File mode is `0600`. The raw transcript remains at the user-supplied location and is never copied into the runtime database or SPECS.

Promoted evidence is public project truth:

```text
<configured SPECS root>/3.Evidence/meeting-evidence/<source-id>/
├── evidence.json
└── evidence.md
```

Both files must exist. The JSON records source and review digests, named review and promotion, accepted/amended candidates, evidence digest and Markdown digest. Markdown includes the authority and security notices.

## Domain operations

| Function | Mutates | Boundary |
| --- | --- | --- |
| `registerMeetingSource` | Private source record | Explicit confirmation, regular supported file, no symlink/traversal, limits and policy |
| `prepareMeetingExtraction` | Nothing | Current digest; denied/unknown processing returns manual-local route |
| `recordMeetingReview` | Private review record | Strict allowlist, anchors in range, every candidate disposed exactly once, named reviewer |
| `promoteMeetingEvidence` | Paired SPECS evidence and safe lifecycle event | Exact confirmation, named approver, current source/review digests, accepted/amended evidence only |
| `readMeetingEvidenceWorkspace` | Nothing | Safe source, candidate, disposition, receipt and active-persona projection |

An interrupted JSON-first write removes both targets and its staging journal. A later identical approved request is idempotent even when the retry time differs. A materially different source, review, approver or evidence set conflicts rather than overwriting the existing record.

## CLI

```bash
ewai meeting register FILE --yes [--label NAME] [--classification CLASS] [--cloud-processing POLICY] --project . --json
ewai meeting prepare SOURCE_ID [--focus TEXT] --project . --json
ewai meeting review SOURCE_ID --input FILE --reviewed-by NAME --project . --json
ewai meeting promote SOURCE_ID --yes --approved-by NAME --project . --json
ewai meeting status [SOURCE_ID] [--focus TEXT] --project . --json
```

Review input must resolve inside the project. JSON errors include the mandatory assurance notice and must not echo raw source content or a private path.

## MCP

The stdio server exposes:

- `ewai_meeting_status` as read-only;
- `ewai_meeting_register` as a confirmed non-destructive mutation;
- `ewai_meeting_prepare` as read-only;
- `ewai_meeting_review` as a non-destructive mutation;
- `ewai_meeting_promote` as a confirmed non-destructive mutation.

Schemas constrain classifications, processing policy, candidates, anchors and dispositions before the domain validates them again. No tool accepts a project-root argument.

## HTTP and UI

The loopback server provides:

- `GET /api/meeting-evidence?source=<id>`;
- `POST /api/meeting-evidence/<id>/prepare`;
- `POST /api/meeting-evidence/<id>/promote`.

The server uses its configured root and rejects unknown query/body fields. Promotion revalidates confirmation and the named approver. Error responses include the exact mandatory assurance notice.

Meeting evidence is a secondary mode inside Mind Palace, not a primary-navigation item. The browser escapes all safe fields. It has no upload control, review authoring, raw source preview, connector, transcription control, downstream canonical authoring or release action. At 960px the ledger and context rail stack; at 600px candidates and receipts become a single reading column. Existing focus-visible and reduced-motion rules apply.

## Persona contract

The standard host model and the installed project/core ensemble are sufficient. Premium and personal personas are optional enrichment only when already installed and contextually relevant. The active persona projection exposes name, tier, matched signals and engagement reason, never managed persona bodies.

Preparation selects a fresh ensemble for its source and focus. Implementers must replace, not accumulate, that set when context changes. No persona can establish a fact, complete named review, approve promotion or satisfy Manual QA.

## Lifecycle integration

After both evidence files exist, EWAI safely publishes `ewai.meeting-evidence.promoted` with only:

- `sourceId`;
- `evidenceDigest`;
- `candidateCount`;
- `approvedAt`.

The event references the two project-relative evidence paths. It contains no transcript text, source path, reviewer prompt or raw model output. Handler failure cannot veto, delete or roll back canonical evidence; delivery can be inspected and retried through the generic lifecycle-hook system.

## Extension boundary

External systems should subscribe through generic lifecycle hooks or call the published CLI/MCP contract. Do not add a vendor-specific connector to the domain module. If a future importer supplies transcripts, it must first materialise a supported local file and obtain the same explicit registration and processing decision.

Keep future candidate schema revisions versioned and fail closed on unknown fields. Add tests for redaction, drift, transaction interruption, retry behaviour, annotations, project-root isolation and responsive no-preview behaviour.

Registration and validation aren't evidence that a transcript's claims are true. Integrations must preserve source permissions, complete named review and separate promotion approval rather than treating generated candidates as accepted project knowledge.

## Contract sources

- `src/meeting-evidence.mjs`
- `config/meeting-evidence-candidate.schema.json`
- `src/runtime/lifecycle-hooks.mjs`
- `src/runtime/mcp-server.mjs`
- `src/runtime/dashboard-server.mjs`
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `tests/meeting-evidence.test.mjs`
- `tests/meeting-evidence-cli.test.mjs`
- `tests/lifecycle-hook-emissions.test.mjs`
- `tests/runtime.test.mjs`
