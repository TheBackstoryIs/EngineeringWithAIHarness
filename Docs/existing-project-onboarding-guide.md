# Existing-project onboarding guide

Use this guide when EWAI is joining a codebase whose behaviour, history, or purpose is not already represented by reliable project knowledge.

Ask EWAI: “Help me set up this existing project. I'll explain what it's for, then we can decide whether to investigate the code and recover missing documentation.” You don't need to prepare an Archaeology bundle yourself. EWAI guides the setup and investigation; you supply the purpose, agree source permissions and review its conclusions. The commands below are available if you want to inspect or repeat individual steps.

## Set up the workspace first

If this project doesn't yet have EWAI configuration, EWAI asks where to keep its SPECS knowledge and initialises that structure after you agree. Check-in follows initialization. If it is already configured, EWAI uses the existing locator; you don't need a second knowledge tree.

You provide a briefing and agree source permissions and context-import choices before an investigation. Those decisions apply whether or not you later choose Archaeology.

If premium personas will be part of the investigation, [finish licence setup and installation](operations/premium-personas-setup.md) before starting it. Core personas remain available without a premium licence.

## The governing principle

Archaeology reconstructs what can be observed. It does not decide why the project ought to exist.

Explain what the project is meant to achieve and check EWAI's summary before deep repository analysis. Current code, abandoned experiments and accidental behaviour aren't automatically evidence of what you want the project to do.

## Agree the briefing and permissions

EWAI asks you about:

- purpose and business context;
- primary users and desired outcomes;
- important journeys and operational responsibilities;
- known constraints and non-goals;
- what is believed to be wrong, incomplete, or obsolete;
- source material that may be examined;
- confidentiality and cloud-processing constraints;
- who can resolve disagreements between evidence and intent.

For an initialized project, you can also run check-in directly:

```bash
ewai checkin --project .
```

Check-in reports the dashboard link, framework version, state integrity, standards policy, validators and persona-library status. Resolve any reported blocker before beginning the investigation.

## Register supporting context safely

If you have transcripts, emails, requirements or research, ask EWAI to register the folder with an explicit classification and processing decision. For direct registration, use:

```bash
ewai context register /path/to/source \
  --project . \
  --yes \
  --label "Project discovery evidence" \
  --classification confidential \
  --cloud-processing denied
```

Registration does not make every statement true. When reviewing the findings, check that EWAI retains the source and distinguishes stated, proposed, agreed, implemented, superseded, contradicted, inferred and unknown material.

## Choose whether to run Archaeology

After you've explained the project and agreed which sources can be used, EWAI offers to investigate the existing code and reconstruct missing documentation. You decide whether that would help now. Archaeology doesn't start without your acceptance.

If you decline, your briefing and permission decisions remain available. You can continue with [Guided Discovery](guided-discovery-facilitator-guide.md) and Doctor without reconstruction; the uninvestigated areas remain recorded as knowledge gaps. Context import is a separate choice, not a requirement to accept Archaeology. You can return to reconstruction later.

The reconnaissance and reconstruction sections below describe what happens if you accept Archaeology. They don't replace the briefing or privacy checks above.

## Run bounded reconnaissance

EWAI first builds a broad map of:

- repositories, languages, frameworks, and deployable units;
- entry points, external integrations, data stores, and queues;
- high-value user and operational workflows;
- tests, schemas, documentation, and decision records;
- ownership boundaries and likely knowledge gaps;
- recent changes and historical seams worth deeper inspection.

This first pass isn't an exhaustive file-by-file summary. Review the map with EWAI to choose where deeper investigation would be useful.

EWAI uses the [Repository Source Map](repository-source-map-guide.md) during reconnaissance. To refresh it and inspect its coverage directly:

```bash
ewai index refresh --project . --json
ewai index coverage --project . --json
ewai index files --outcome analysis_failed --project . --json
```

Every non-excluded regular file remains visible even when EWAI has no deep parser for it. Treat `inventory_only`, `skipped_sensitive`, `skipped_oversized`, and `analysis_failed` as explicit limits on subsequent inference. Technology, stack, organisation, and project profiles may refine analysis, but they do not turn repository evidence into stakeholder truth.

For already-extracted Power Platform or Salesforce projects, review the
[platform export analysis guide](platform-export-analysis-guide.md), confirm the
appropriate technology pack rather than relying on detection alone, and inspect
the partial-platform count before drawing conclusions from Archaeology or Blast
Radius. EWAI does not extract archives or connect to vendor environments.

## Confirm purpose alignment

Before deep reconstruction, EWAI shows how its inferred understanding compares with your briefing. Review each material difference using these classifications:

| Classification | Meaning |
| --- | --- |
| Present | The repository supports the briefing. |
| Partial | Some evidence exists, but the intended outcome is incomplete. |
| Missing | The briefing expects behaviour with no supporting evidence. |
| Conflicting | Current behaviour or history contradicts the briefing. |
| Unknown | Available evidence cannot resolve the question. |

If the code materially conflicts with the intended purpose, decide which interpretation is correct or explicitly bound what remains uncertain before continuing.

## Select personas for investigation

After reconnaissance, EWAI proposes a small group of relevant installed personas for the next investigation passes. You review the selection and reasons before proceeding. Useful perspectives may include product, user, architecture, operations, security, data, accessibility or assurance.

Relevant project and premium personas can participate when available. EWAI shows the choice and reason; you can challenge a missing perspective. An installed persona is an analysis aid, not evidence about a real actor.

The Archaeology workflow retains a persona-routing checkpoint. Its supporting validation commands include:

```bash
ewai archaeology prepare-personas SPECS/3.Evidence/archaeology/<bundle> --project .
ewai archaeology validate-personas SPECS/3.Evidence/archaeology/<bundle> --project .
```

These commands operate on a prepared Archaeology bundle; they do not replace the conversational briefing and reconnaissance.

## Deep reconstruction

The investigation uses separate, bounded passes for:

1. observable user and business behaviour;
2. technology and deployment topology;
3. domain language and data relationships;
4. decisions, constraints, and historical change;
5. standards and recurring implementation patterns;
6. security, privacy, operations, and failure behaviour;
7. risks, contradictions, and unresolved questions.

Check the source paths, tests, commits, documents or human testimony cited for important conclusions. A missing source is a gap to investigate, not proof that the behaviour doesn't exist.

## Review and curate

EWAI validates the investigation bundle and prepares findings for your review before they can become canonical SPECS knowledge. To inspect those steps directly:

```bash
ewai archaeology validate SPECS/3.Evidence/archaeology/<bundle> --project .
ewai archaeology prepare-review SPECS/3.Evidence/archaeology/<bundle> --project .
```

Review the proposed findings and reject, correct or narrow weak inferences. EWAI offers a guided filing walkthrough or you can review and file the material yourself. After the review, an explicit curation approval allows the following operation:

```bash
ewai archaeology curate SPECS/3.Evidence/archaeology/<bundle> \
  --project . \
  --yes \
  --approved-by "Project Owner"

ewai archaeology validate-completion SPECS/3.Evidence/archaeology/<bundle> --project .
```

Approved curation puts reviewed knowledge in its canonical home. Source evidence and investigation history remain under `SPECS/3.Evidence/archaeology/`. Check the proposed destinations before approving; curation isn't permission to overwrite an existing approved record without a separate change decision.

## Decide what happens next

Archaeology may reveal:

- an intent ready for formalisation;
- missing or stale standards;
- architecture decisions that need confirmation;
- project personas grounded in real evidence;
- technical debt with a bounded blast radius;
- an incident or risk requiring separate treatment;
- contradictions that block delivery.

After curation, EWAI offers to discuss upcoming features, interpret a roadmap you supply, or suggest changes grounded in the findings. You choose which ideas to develop. Materially different outcomes belong in separate intents; a large investigation report isn't automatically a single approved build.

When Archaeology identifies a concrete change boundary, use [Blast Radius and Impact Routing](blast-radius-and-impact-routing-guide.md) to examine its bounded repository reach, possible consequences, relevant personas, and human review routes. Keep archaeology findings and the impact assessment distinct: Archaeology reconstructs broader project knowledge, while Blast Radius evaluates a specific proposed change against the current repository map.

## When to pause the investigation

Pause and resolve the issue with the appropriate owner if:

- source material exceeds its approved processing classification;
- credentials, secrets, or personal data appear unexpectedly;
- repository evidence and owner purpose materially disagree;
- generated findings lack traceable evidence;
- a proposed persona is based on stereotype rather than observed actors;
- curation would overwrite an existing approved record without a change decision.

## Onboarding checklist

- [ ] Owner briefing captured before deep analysis.
- [ ] Context classification and processing permission recorded.
- [ ] Archaeology was explicitly accepted or declined.
- [ ] If accepted, the reconnaissance map was reviewed. If declined, known gaps were recorded and Discovery continued without claiming reconstruction.
- [ ] Purpose discrepancies resolved or explicitly bounded.
- [ ] Persona ensemble shown and confirmed.
- [ ] If Archaeology ran, findings cite evidence and retain uncertainty.
- [ ] If reconstruction is being curated, human review completed before that curation.
- [ ] Follow-on work split into reviewable intents.

## Related guides

- [Guided Discovery facilitator guide](guided-discovery-facilitator-guide.md)
- [Working with personas](working-with-personas.md)
- [Repository Source Map](repository-source-map-guide.md)
- [Blast Radius and Impact Routing](blast-radius-and-impact-routing-guide.md)
- [Developer delivery guide](developer-delivery-guide.md)
- [Troubleshooting and recovery](operations/troubleshooting-and-recovery.md)

## Current contract sources

- `README.md`
- `src/context.mjs`
- `src/archaeology.mjs`
- `src/personas.mjs`
- `tests/context.test.mjs`
- `tests/archaeology.test.mjs`
