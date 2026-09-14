---
name: ewai-organisation-policy
description: Author, adopt, inspect and operate optional Organisation Policy Design Gates in an EWAI project. Use when creating data-only policy contributions in Organisation Blueprint Packs; selecting and approving a project policy baseline; proposing and confirming intent design facts; evaluating a design; tracing controls into Plan evidence; recording a named review or bounded exception; or recovering from policy, fact or evaluation drift.
---

# EWAI Organisation Policy

Keep policy work at design time. Use the shared EWAI domain and adapter operations; never invent a second evaluator in a skill, prompt, UI, hook, or connector.

Resolve the project and configured SPECS root from `.ewai-pipeline/project.json`. Read [the policy contract](references/policy-contract.md) before authoring, adopting, confirming, evaluating, reviewing, or excepting policy evidence.

Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Choose the operation

- **Author:** create or revise a strict data-only policy contribution in an Organisation Blueprint Pack.
- **Adopt:** preview a resolved policy baseline and ask a named person to approve its exact digest through Guided Setup.
- **Apply:** propose attributed facts, obtain complete named-human confirmation, then run the deterministic evaluator.
- **Resolve:** route `review-required` to the named role or use a bounded exception only when the matched rule explicitly permits it.
- **Recover:** re-evaluate after policy, intent, fact, Claim Ledger, task, test, or control-evidence drift.

If no policy baseline is configured, report `not-configured` as explicitly non-blocking and stop policy work. Do not create a hidden default.

## Engage personas without delegating authority

Use standard model reasoning plus installed core and project personas as the complete baseline. Swap in relevant installed personal and premium personas when the policy stage, design dimensions, or uncertainty changes.

Show every active persona's name, tier, matched signal, and engagement reason. Treat its output as a hypothesis or challenge. A named human must confirm every design fact and make every review or exception decision.

Premium personas are optional enrichment and may participate only when reported as installed. Never sync, download, update, imitate, or expose premium persona bodies while using this skill.

## Author and adopt

1. Identify the accountable policy owner, provenance, sources, review roles, unmatched outcome, and closed conditions.
2. Use only the closed condition dimensions and outcomes in the contract. Keep the pack inert: no scripts, commands, prompts, templates, expressions, remote sources, credentials, hooks, or endpoints.
3. Give every control an explicit evidence route: Claim Ledger claim, task, automated test, named human, or specialist review.
4. Add the policy contribution to the appropriate Blueprint module and validate the complete pack.
5. Use Guided Setup to select the Blueprint and inspect its policy preview.
6. Ask a named person to approve the exact effective digest. Upstream changes create drift; they never rewrite the accepted project baseline.

## Apply to an intent

1. Read the current intent, Impact evidence, accepted architecture, data and hosting decisions, and configured policy baseline.
2. Prepare attributed candidate facts through the canonical `preparePolicyFacts` domain operation. Distinguish observed evidence, model proposals, and persona hypotheses.
3. Present all candidates and active personas. Require one named person to confirm or reject every proposed fact.
4. Record the complete confirmation with `ewai_policy_confirm_facts` or `ewai policy confirm-facts --input <project-relative.json>`.
5. Evaluate the exact current intent revision, policy digest, and facts digest with `ewai_policy_evaluate` or `ewai policy evaluate --input <project-relative.json>`.
6. Inspect the business and technical views with `ewai_policy_status` or `ewai policy status <domain/slug> --mode business|technical`.

The evaluator is deterministic. Personas may discover missing facts and challenge consequences; they never choose the outcome.

## Resolve reviews, exceptions, and controls

- For `review-required`, ask the exact required role for a named decision, rationale, evidence, and any controls. Record it against the current evaluation digest.
- For `deny`, do not soften the result. An exception is possible only when that exact matched rule permits one.
- For an exception, require a named approver, accountable owner, exact bounded scope, rationale, compensating controls, evidence, and future expiry.
- During Plan, trace every policy control to the allowed Claim Ledger, task, automated-test, named-human, or specialist-review evidence route.
- Re-run the gate after relevant evidence changes. Never copy a previous pass forward.

## Stop conditions

Stop and escalate when a policy source is ambiguous, executable, remote, or untrusted; the baseline or facts are stale; confirmation is incomplete; the required reviewer is absent; an exception is prohibited or unbounded; control evidence is missing; a model is being asked to make a human decision; or anyone asks EWAI to enforce production behaviour, certify compliance, approve Build or Manual QA, deploy, release, or accept risk.
