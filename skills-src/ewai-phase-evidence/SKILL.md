---
name: ewai-phase-evidence
description: Guide named business-facing and technical owners through one revision-safe EWAI phase contribution thread with explicit provenance, active persona lenses, owner hand-offs, shared review and immutable supporting evidence. Use when a user asks to open or use Phase Studio, contribute non-technical or technical evidence to Reconcile, Plan, Test Plan, Delivery preparation or Manual QA preparation, review a queued phase contribution, change owner context, prepare a responsibility hand-off, or confirm a phase contribution bundle without changing delivery authority.
---

# EWAI Phase Evidence

Use the project-local Phase Studio and its governed contribution contract. Keep one shared, attributed thread. Do not create a parallel phase document or infer approval from participation.

## Establish the boundary

1. Perform the required EWAI check-in and use the configured project and SPECS root.
2. Read the current intent, delivery state and execution integrity before making a substantive claim. Refresh the EWAI Source Map first when repository evidence is material and the index is missing or stale.
3. Continue only when Phase Studio reports a supported, running profile: Reconcile, Plan, Test Plan, Delivery preparation or Manual QA preparation.
4. Treat `business`, `technical` and `shared-review` as contribution contexts, never identity, access or permission.
5. Name the real person holding each context. Keep that accountable person separate from every persona lens.

Do not use this skill to complete a phase, approve Build, accept Manual QA, dispose of security findings, accept risk, deploy, certify or release. Route governed delivery progression through `$ewai-deliver` and its durable human gates.

## Build one evidence thread

1. Select the current server-owned evidence topic.
2. Ask the standard host-model questions for the phase and owner context.
3. Engage the small active persona ensemble shown by Phase Studio. Project and core personas plus ordinary host-model reasoning provide a complete baseline. Use premium, personal and project-local personas only when already installed and relevant. Never imitate, download or synchronise a missing persona.
4. Record each contribution with:
   - topic;
   - real contributor and owner context;
   - one evidence class: `repository-fact`, `participant-statement`, `imported-source`, `persona-hypothesis`, `named-decision` or `unresolved-question`;
   - bounded statement;
   - source or provenance;
   - unresolved questions, conflicts and limitations where applicable.
5. Preserve earlier attribution. Correct or qualify a claim through a new revision or named resolution; do not silently rewrite who said what.

Personas are advisory lenses. Their output is not participant evidence, validation, legal or specialist assurance, acceptance or approval.

## Change responsibility safely

When focus changes without responsibility moving, switch owner context and save the new revision. Confirm the real named owner and explain which personas joined or left.

When responsibility moves, prepare an owner hand-off containing:

- named source and destination owners;
- distinct source and destination contexts;
- reason for the transition;
- questions for the incoming owner;
- current revision and SHA-256 digest.

Verify the preview before submission. Resume the same draft after the hand-off. Never copy it into a second competing thread.

## Review without flattening disagreement

Use shared review to show business and technical evidence with original attribution. Preserve unresolved differences and named decision ownership.

For a queued `review-contribution` hand-off:

1. Verify `authority: none`, intent, phase, revision and digest.
2. Read only the matching project-local draft needed for the review. Do not expose raw premium persona definitions, credentials or unrestricted repository content.
3. Challenge provenance, missing perspectives, contradictions, acceptance evidence and deliberately unresolved items.
4. Return proposed changes as advisory feedback. Do not confirm the bundle or alter delivery state on the user's behalf.

## Confirm supporting evidence

Before named confirmation, show:

- current phase, revision and digest;
- named owners and hand-off history;
- all evidence classes and sources;
- conflicts, resolutions, open questions and limitations;
- active persona metadata and its advisory status;
- exact project-relative Markdown and JSON destinations.

Confirmation creates paired immutable evidence beneath `SPECS/6.Build/<slug>/phase-contributions/<profile>/`. It remains supporting evidence. The orchestrator must separately reconcile relevant contributions into the required phase artefact and pass the normal deterministic gate, standards sweep, configured independent validation and human approvals.

## Recover safely

- On a stale revision, changed phase, source drift or profile drift, preserve the participant's unsaved text, reload current state and reconcile deliberately.
- Discard only the disposable runtime draft after explicit confirmation. Never delete confirmed bundles.
- If state integrity is blocked or the phase is unsupported/completed, remain read-only and route the user to Companion or `$ewai-deliver`.
- If premium personas are absent, state that optional enrichment is unavailable and continue with the complete baseline.
