# Guided Phase Evidence Drafting

The dashboard's **Contributions** view lets business and technical colleagues add what they know to an active delivery. They can record evidence, questions and decisions, then hand the discussion to the next owner. Contributions remain attributed to the people who made them; adding evidence doesn't approve Build or complete a delivery phase.

## What it is for

Use Contributions during these participant-facing moments:

| Governed moment | Typical contribution |
| --- | --- |
| Reconcile | Observable current behaviour, inherited constraints, protected outcomes and unresolved history |
| Plan | Outcomes, scope, dependencies, trade-offs, acceptance and named decisions |
| Test Plan | Journeys, evidence oracles, environments, technical coverage and recovery |
| Delivery preparation | Readiness, operations, communications, recovery, acceptance evidence and residual decisions |
| Manual QA preparation | Representative journeys, devices, accessibility, observations, limitations and named acceptance route |

Build execution, Standards Sweep, external validation, security disposition, phase completion and Retro keep their specialised governed workflows.

## Open Contributions

Work on the computer running the project dashboard, or with its owner through screen sharing. Sending a colleague the loopback URL doesn't give them remote access. Team Hub publishes bounded read-only summaries; it doesn't turn Contributions into a remotely editable shared workspace.

1. Run the normal EWAI check-in and open the local dashboard URL.
2. If **Contributions** isn't in the sidebar, enable it in **Configuration** and save. See [dashboard configuration](operations/dashboard-configuration.md).
3. Open **Contributions**.
4. Choose an active delivery.
5. Check the phase, shared revision, digest and integrity state before contributing.

An unsupported, completed or inconsistent phase is read-only. Follow its Companion route or the guarded delivery workflow instead of trying to bypass it.

## Work in the right owner context

The context bridge has three views:

- **Business-facing owner** foregrounds outcomes, stakeholders, trade-offs, acceptance, communications and business decisions.
- **Technical owner** foregrounds repository evidence, constraints, dependencies, standards, architecture, testing, operations and recovery.
- **Shared review** presents both perspectives with their original attribution and keeps disagreement visible.

Enter the real participant's name. Context selection is not authentication and does not prove expertise or authority. If the same person holds two responsibilities, use separate context records so the change in responsibility remains explicit.

Changing context retains the same evidence, revision history, sources, decisions and questions. It also recomputes the active persona ensemble and announces which perspectives joined or left.

## Record evidence with provenance

Choose the current evidence topic, then classify each contribution:

| Class | Use it for |
| --- | --- |
| `repository-fact` | Observable source, configuration, tests, history or generated Source Map evidence |
| `participant-statement` | A statement attributed to a real named participant |
| `imported-source` | A bounded claim from an identified document, transcript or external artefact |
| `persona-hypothesis` | A question or hypothesis raised through an advisory persona lens |
| `named-decision` | A decision attributed to a real accountable person |
| `unresolved-question` | A question whose evidence or owner remains open |

Add a source wherever possible. Record open questions and limitations instead of making the draft look artificially complete. Earlier evidence is append-oriented: qualify or resolve it in a later revision rather than silently changing its contributor or provenance.

## Understand active personas

Contributions continually shows each engaged persona's name, tier, matched signals and engagement reason.

- Project and core personas plus standard host-model reasoning provide a complete baseline.
- Relevant installed premium, personal and project-local personas can add specialist depth.
- Missing premium personas are visible but never block a field, action, review or confirmation.
- Contributions never downloads, synchronises, imitates or returns the full private body of a premium persona.

Personas are lenses, not participants. They do not provide stakeholder evidence, identity, delegation authority, specialist assurance, validation, acceptance or approval.

## Hand responsibility to another owner

Choose **Prepare hand-off** when responsibility is genuinely moving. The preview binds:

- source and destination owners;
- source and destination contexts;
- reason for the transition;
- questions for the incoming owner;
- current revision and digest.

The incoming owner continues the same thread. A hand-off does not copy the draft or change the governed phase.

## Request host-AI review

Choose **Request host review**, then return to your EWAI conversation to confirm that you'd like the queued review picked up. The host can challenge missing evidence, provenance, contradictions and unresolved questions, then return suggestions to the discussion. Queuing or completing that review doesn't confirm your evidence or progress delivery.

Only a bounded summary and safe metadata enter the hand-off queue, not your contribution body, credentials or private persona definitions. The [Contributions API reference](reference/contributions-api.md) describes the payload and its `authority: none` boundary for integration authors.

## Confirm contribution evidence

Use shared review before confirmation. Check named owners, original attribution, sources, hand-off history, conflicts, open questions, limitations, active personas, revision and digest.

Choose **Confirm evidence**, enter the real confirmer's name and accept the exact consequence. EWAI writes collision-safe paired files under:

```text
SPECS/6.Build/<slug>/phase-contributions/<profile>/
├── contribution-<timestamp>-r<revision>-<digest>.md
└── contribution-<timestamp>-r<revision>-<digest>.json
```

Existing bundles are never overwritten. The JSON records the delivery and profile digests, evidence classes, owners, hand-offs, conflicts, limitations, active safe persona metadata and assurance boundary. The Markdown is a readable equivalent.

The bundle is supporting evidence only. It doesn't automatically become the required Plan, Test Plan, Delivery or Manual QA document. Ask EWAI to reconcile the confirmed contributions into the relevant phase work, then review the result. The phase still needs its required documents and passing gate.

## Discard and recover

- **Discard draft** removes only the disposable file under `.ewai-pipeline/runtime/phase-contributions/`. Confirmed bundles remain.
- A **stale revision** means another save or hand-off won. Preserve your unsaved text, reload and add it to the current revision.
- A **changed phase, source or profile** pauses mutation. Review the governed change before deciding whether the old contribution still applies.
- An **integrity blocker** leaves Contributions read-only. Reconcile the Markdown intent, adjacent JSON, delivery state and SQLite projection through the normal EWAI workflow.
- A **missing premium library** needs no recovery. Continue with the complete standard and project/core baseline.

## Loopback API for implementers

The [Contributions API reference](reference/contributions-api.md) preserves the six routes, revision checks and server-owned context rules. You don't need these HTTP details to contribute through the dashboard or host.

## Assurance boundary

Contribution evidence can still be incomplete or wrong. Personas and model output can miss issues. A named human must review attribution, sources, limitations, disagreements and applicability before incorporating it into governed phase material.

If the contribution concerns security, use the separate [security validation workflow](security-validation-guide.md). Confirming a contribution doesn't satisfy that review or its release conditions.
