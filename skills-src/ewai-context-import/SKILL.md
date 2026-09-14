---
name: ewai-context-import
description: Register and interpret a user-supplied folder of emails, meeting transcripts, documents, research, requirements, presentations, spreadsheets, images, recordings, and other project material as evidence-backed EWAI context. Use during new-project setup, before or during Archaeology, when importing discovery material, when reconstructing decisions and rationale, or when project actors and suitable analysis personas need to be identified from source evidence.
---

# EWAI Context Import

Enrich project understanding without turning raw correspondence into unreviewed project truth. Keep supplied material in place, preserve provenance, and route only reviewed knowledge into SPECS.

## Offer context enrichment naturally

During setup, after the initial human project briefing and before detailed discovery or Archaeology, ask:

> Do you have a folder of emails, meeting transcripts, documents, research, requirements, or other project material you would like EWAI to learn from?

Make the import optional. Do not imply that a project is incomplete without one. Existing projects may add or refresh context sources at any time.

## Establish permission and boundaries

Ask one focused question at a time and establish:

1. the folder path and a human-readable label;
2. whether the user is authorised to let EWAI read it;
3. exclusions such as private correspondence, HR, legal privilege, credentials, unrelated clients, or personal material;
4. classification: `public`, `internal`, `confidential`, or `restricted`;
5. whether content may be processed by the current AI provider: `allowed`, `denied`, or `unknown`;
6. whether OCR or transcription may be used when required.

If cloud processing is denied or unknown, do not open source content in a hosted AI session. A local inventory may still be registered, but explain the limitation and ask the user to select an approved local-processing route. Never weaken the classification to make the import convenient.

After explicit consent, register the folder with the internal control-plane command:

```bash
ewai context register <folder> --project <path> --label <label> --classification <classification> --cloud-processing <policy> --yes --json
```

Add `--exclude <relative-path>` for each approved exclusion. Keep the command and JSON internal unless registration fails. Registration inventories supported material without copying raw content into SPECS. Absolute paths and filenames remain in the gitignored `.ewai-pipeline/` manifest; the committed registry contains sanitized counts, types, policy, and an inventory fingerprint. This fingerprint detects inventory drift; it is not represented as a hash of every file's content.

## Perform bounded reconnaissance

Read [the context import contract](references/context-import-contract.md) before opening content.

Start with filenames, dates, formats, headings, participants, thread structure, and a small representative sample. Report what kinds of context appear to exist and ask before expanding into unexpectedly sensitive or out-of-scope material. Do not execute attachments, macros, links, scripts, or embedded active content.

Work in bounded batches. Keep progress human:

- `Reviewing the material you supplied…`
- `I found three decision-heavy meeting threads and two requirement documents.`
- `I found four recurring project roles · two need your clarification.`
- `There are conflicting accounts of the delivery approach.`

## Route personas before deep interpretation

After initial reconnaissance, run `ewai persona index --project <path> --json`. Use its compact metadata—identifier, description, category, tier, tags, and capabilities—to compare the perspectives required by the material with the core, premium, personal, and project personas actually available.

Prepare a small ensemble rather than loading every persona:

- one lead suited to the dominant question;
- domain or functional perspectives evidenced by the material;
- user or operator perspectives;
- assurance, security, accessibility, data, or adversarial reviewers where relevant;
- the SPECS Knowledge Curator for final routing.

Tell the user:

- which available personas would materially improve the import and why;
- which will lead or review each pass;
- where the current library has a meaningful perspective gap;
- whether a project-specific persona should be created from evidenced actors.

Switch persona lenses between bounded passes as the evidence changes. Do not blend every persona into one generic answer. Record routing in `persona-routing.yaml`, including the persona, purpose, evidence that made it relevant, pass, contribution, and unresolved gap.

An installed advisory persona is a reasoning aid, not evidence about this project's users. When source material reveals a real role, actor, environment, responsibility, frustration, goal, or decision authority, propose a project persona under the import bundle's `proposals/SPECS/1.Scope/personas/project/`. Attribute it to evidence, avoid unnecessary personal identifiers, distinguish role from individual, and obtain human approval before promotion.

## Extract evidence, not just summaries

Classify each candidate finding as:

- `stated`: a source says it, without evidence of agreement;
- `proposed`: someone suggested an option or action;
- `agreed`: participants explicitly reached agreement;
- `decided`: an accountable decision and outcome are recorded;
- `implemented`: repository or operational evidence shows the outcome exists;
- `superseded`: later evidence replaced it;
- `contradicted`: credible sources disagree;
- `inferred`: interpretation still requires confirmation;
- `unknown`: evidence is insufficient.

Extract project language, actors, intents, journeys, workflows, requirements, constraints, options, decisions, rationale, risks, incidents, dependencies, actions, unresolved questions, and success measures. Cite a source identifier plus page, paragraph, timestamp, message, slide, sheet, or other stable locator for every material claim.

## Create the review bundle

Build on the registration bundle at `SPECS/3.Evidence/context-imports/<date>-<slug>/`:

```text
├── source-registration.yaml
├── report.md
├── evidence-ledger.yaml
├── persona-routing.yaml
├── actors-and-persona-candidates.md
├── decisions-and-options.md
├── open-questions.md
└── proposals/SPECS/
```

Mirror proposed records into their eventual SPECS destination. Keep raw source content outside SPECS. Use short necessary excerpts only when permitted; prefer paraphrase plus a precise locator.

## Review and curate

Present related findings in small groups. Ask the accountable human to accept, correct, reject, or defer them. Use the SPECS Knowledge Curator to promote accepted records, preserve links back to the context-import evidence, and reconcile conflicts with existing project knowledge.

Do not claim that a discussion was a decision, that a participant represented all users, or that a repeated practice was an approved standard. Do not create a persona from protected characteristics or private correspondence without an appropriate and explicit purpose.

## Completion boundary

Complete the import only when registered sources and exclusions are visible, processing policy was honoured, material findings are traceable, persona routing and gaps are recorded, project-actor candidates are reviewed, contradictions remain visible, and accepted knowledge has been curated into SPECS.

Stop before implementation. Create or enrich an intent for work discovered by the import.
