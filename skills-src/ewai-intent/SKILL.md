---
name: ewai-intent
description: Turn an idea, problem, request, or existing feature into a project-local EWAI intent with explicit outcomes, journeys, constraints, evidence, acceptance criteria, and persona attachments. Use when Codex needs to create, enrich, reconcile, or review a file under SPECS/2.Purpose/intents before planning or implementation.
---

# EWAI Intent

Resolve the SPECS root from `.ewai-pipeline/project.json`, then create intent truth under its `2.Purpose/intents/` directory. Do not assume SPECS is at the workspace root and do not write application code during Intent.

If the request spans several independently valuable outcomes or the user wants to shape an initiative, use `$ewai-shape-intents` before refining any individual intent. When an intent belongs to an approved map, read that map and preserve its relationship contract.

## Create the intent

When the local dashboard is available, **Intent Studio** is the preferred guided route for one intent. It implements the same portable contract as the CLI while keeping a recoverable project-local draft:

1. Open **Intent Studio** and choose **Create a new intent** or **Reconcile an eligible draft intent**.
2. Work through the evidence spine. Each save advances the project-local draft revision; stale browser revisions must be reloaded rather than overwritten.
3. Treat the standard host-model baseline as complete. Actively engaged personas from project, core, installed premium, and personal libraries are optional contextual lenses. The interface must show their tier, matching signals, and engagement reason as the section changes.
4. Use **Copy AI review hand-off** when a host-model conversation would help. The copied prompt is advisory and must not alter the draft, make an approval, or invoke a hidden model endpoint.
5. In Review, resolve blocking omissions, check exact canonical destinations, and, for reconciliation, compare the proposed before and after values.
6. Require a named person to approve the current revision. That decision creates or reconciles intent truth only; it does not approve Build, Manual QA, certification, deployment, or release.

If premium personas are not installed, continue with the standard baseline and any available project or core personas. Never sync or download premium content as a side effect of intent work.

1. Read `pipeline.yaml` and applicable constraints from the configured SPECS root.
2. Check for an existing intent with the same or overlapping outcome.
3. Identify the primary user or operator and any decision-maker, affected, assurance, or adversarial personas.
4. Before finalising the draft, create a delivery-shape preview:
   - `single` when the intent is one coherent, reviewable delivery slice;
   - `split` when it spans independently valuable outcomes that should become child intents before delivery;
   - `decision-required` when one or more owner decisions are needed before the split is safe.
5. Show the preview to the user with three choices: keep as one intent, split into the suggested child intents, or refine the split. Record the reviewed decision if the user gives one; otherwise keep it as `not-reviewed`.
6. Create the draft with:

```bash
ewai intent create <slug> \
  --domain <domain> \
  --title "<title>" \
  --persona <persona-ref>:<role>:<depth> \
  --delivery-shape <reviewed-delivery-shape.yaml>
```

7. Replace the generated section prompts with evidence-backed content, including its approved dependencies, relationships, and delivery-shape preview.
8. Keep unresolved product choices visible under Open decisions.

## Delivery-shape discipline

Do not wait until Plan or Build to discover that an intent is too large. An intent should normally be split before delivery when it contains multiple user journeys, actor groups, bounded capabilities, data ownership changes, integrations, security or compliance decisions, or acceptance evidence that cannot be verified cleanly in one pass.

Suggested child intents must be product or operational outcomes, not technical layers. Use `$ewai-shape-intents` when the user accepts a split or wants to refine a broader set of related work. If the user explicitly chooses to keep a large intent together, record the rationale in `delivery_shape.reviewed_decision` and keep the delivery risk visible.

## Persona discipline

Use depth 1 for awareness through depth 5 for a burning, evidence-grade need. Persona attachments describe design and acceptance needs; they do not grant permissions.

Use project persona references from `SPECS/1.Scope/personas/` or installed pack identifiers. Do not assume professional personas are licensed.

Persona output is a hypothesis or challenge, not participant evidence. Record interview, workshop, repository, policy, or research evidence separately and preserve named human accountability for decisions.

## Conditional policy design facts

When the project has an enabled organisation policy baseline, use `$ewai-organisation-policy` to identify policy-material design facts while refining the intent. Preserve whether each fact is observed evidence, a model proposal, or a persona hypothesis. Show the active persona tier and engagement reason, then require a named human to confirm or reject every proposed fact. Do not delay material facts until Build, and do not create policy work for a `not-configured` project.

## Completion boundary

An intent is ready for Plan only when its desired outcome, personas, journeys, acceptance criteria, constraints, dependencies, delivery shape, and open decisions are explicit enough to test. Mark uncertainty rather than inventing repository behaviour.

Read [intent contract](references/intent-contract.md) for the portable schema and completion rules.
