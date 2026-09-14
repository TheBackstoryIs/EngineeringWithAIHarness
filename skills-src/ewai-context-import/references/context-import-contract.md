# EWAI context import contract

Use this contract when registering, interpreting, citing, and promoting user-supplied project material.

## Source boundary

- Treat the supplied folder as read-only.
- Keep absolute paths, filenames, and the detailed inventory in `.ewai-pipeline/context/sources/`.
- Keep raw documents, messages, attachments, recordings, and extracted full text outside committed SPECS.
- Put sanitized source metadata and reviewed derived knowledge in SPECS.
- Do not follow symbolic links or traverse into a project contained by the supplied folder.
- Do not execute files, macros, scripts, links, installers, or embedded active content.

Registration recognises common text, Markdown, email, calendar, PDF, office-document, presentation, spreadsheet, structured-data, image, audio, and video extensions. Recognition means inventory eligibility, not guaranteed extraction. Record unsupported, encrypted, corrupt, inaccessible, or tool-dependent material as a visible limitation.

## Processing policy

| Policy | Hosted AI may open content? | Permitted action |
|---|---:|---|
| `allowed` | Yes, within approved scope | Register, inspect, interpret, and cite |
| `denied` | No | Register local metadata only; require approved local processing for content |
| `unknown` | No | Clarify policy before content access |

OCR, transcription, email parsing, archive expansion, or conversion can disclose more content than filenames suggest. Ask before using them. Do not upload source material to a third-party conversion service without separate explicit approval.

## Evidence locator

Use the most stable locator available:

```yaml
- id: CTX-001
  claim: Operational alerts require an acknowledgement path.
  state: agreed
  confidence: high
  sources:
    - source_id: context.early-material.abc123
      document: SRC-007
      locator: "meeting 2025-04-12, 00:18:42-00:20:10"
      speaker_role: Operations lead
  contradictions: []
  review_owner: Product owner
  review_status: pending
```

Use source-local aliases such as `SRC-007` when filenames are sensitive. Keep the alias-to-path mapping only in the private manifest or another gitignored index.

## Decision semantics

| State | Minimum evidence |
|---|---|
| `stated` | A source contains the claim |
| `proposed` | A participant or document presents an option |
| `agreed` | Explicit agreement is recorded, but accountable authority may still be unclear |
| `decided` | The decision, accountable authority, and selected outcome are evidenced |
| `implemented` | Live repository or operational evidence corroborates the outcome |
| `superseded` | Later evidence explicitly replaces the earlier position |
| `contradicted` | Credible sources support incompatible accounts |
| `inferred` | Interpretation joins evidence not explicit in a source |
| `unknown` | Available evidence cannot support a stronger state |

An action item is not necessarily a decision. Silence is not agreement. Meeting attendance is not approval. A later implementation can corroborate the outcome but may not prove the original rationale.

## Persona routing record

Record the selected analysis ensemble:

```yaml
schema: ewai.context-persona-routing/v1
passes:
  - id: decisions
    question: Which architectural choices and trade-offs are evidenced?
    lead: premium.architecture-decision-mentor
    reviewers: [ewai.core.archaeologist]
    selection_evidence: [CTX-004, CTX-009]
    contribution: pending
    gaps: []
project_persona_candidates:
  - id: incident-commander
    evidence: [CTX-012, CTX-018]
    status: proposed
```

Use the installed persona index for selection. Metadata may be used to choose a persona; do not copy premium persona content into project records. Record a missing perspective rather than inventing an unavailable persona's expertise.

## Project actor and persona rules

- Prefer a role or context archetype over a named individual.
- Separate observed responsibilities from inferred goals or personality.
- Attribute frustrations, needs, and workarounds to source evidence.
- Represent conflicting experiences rather than averaging them away.
- Treat project personas as hypotheses until real stakeholders review them.
- Keep protected characteristics out unless they are relevant, lawful, necessary, and appropriately governed.
- Promote accepted candidates to `SPECS/1.Scope/personas/project/` and update the project persona registry.

## Promotion destinations

| Finding | Proposed destination |
|---|---|
| Actor, term, boundary, interface, research summary | `SPECS/1.Scope/` |
| Intent, journey, workflow, requirement, discussion | `SPECS/2.Purpose/` |
| Source evidence, risk, incident, contradiction | `SPECS/3.Evidence/` |
| Confirmed non-negotiable rule | `SPECS/4.Constraints/` |
| ADR, option, architecture, pattern, SOP, runbook | `SPECS/5.Strategy/` |
| Historical or active delivery evidence | `SPECS/6.Build/` |

Require human review before promotion. Require a qualified owner for legal, regulatory, security, privacy, accessibility, employment, or other specialist claims.
