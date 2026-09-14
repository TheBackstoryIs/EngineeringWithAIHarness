# Organisation Policy Design Gates

Organisation Policy Design Gates let a team test a proposed system design against its approved organisational rules before Build. They are optional: a project with no approved baseline reports `not-configured` and gains no policy blocker.

> Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Start with the project's accepted rules

If the project already has an approved baseline, follow [the everyday workflow](#everyday-workflow): prepare facts, confirm them, evaluate and route the result. Ask the baseline owner to resolve a stale or missing selection rather than inventing rules in a feature review.

If you're creating policy material for reuse, start with [policy pack authoring](policy-pack-authoring-guide.md). Installing a pack and approving it for this project are separate steps.

## What the capability does

1. An Organisation Blueprint contributes one or more strict, data-only policy packs.
2. Guided Setup resolves those contributions and shows their exact effective digest.
3. A named owner can approve that digest as the project baseline.
4. Intent work proposes facts about actors, operations, data, environments, destinations, models, AI use, retention, and resources.
5. A named person confirms or rejects every fact.
6. EWAI deterministically matches the confirmed facts against every policy rule.
7. The result is `allow`, `allow-with-controls`, `review-required`, `deny`, or `unassessed`.
8. Plan traces required controls to claims, tasks, automated tests, named-human evidence, or specialist review.

The browser’s **Policy gates** area offers a plain-language business view and an evidence-oriented technical view. Both use the same intent, facts, baseline and evaluation. The active persona rail shows which core, project, personal, and installed premium lenses are currently engaged and why.

## Standard and premium personas

Standard model reasoning with core and project personas is a complete baseline. Installed premium personas can add specialist depth for areas such as privacy, security, risk, accessibility, data, operations, or regulation. Premium access never changes the rule engine and is never required for an outcome.

Personas propose questions and possible facts. They do not confirm facts, perform reviews, approve exceptions, accept risk, or certify compliance.

## Everyday workflow

- In **Guided Setup**, inspect and approve an optional policy baseline with the Organisation Blueprint.
- In **Intent**, identify policy-material design facts and preserve their provenance.
- Enable **Policy Gates** in **Configuration** and save, then open it to inspect the current result and active personas. See [dashboard configuration](../operations/dashboard-configuration.md). Hiding this view doesn't disable an applicable policy requirement.
- Use the business view for consequence and next action; use the technical view for exact digests, matched rules, and control traces.
- Ask the named review role to resolve `review-required` rules.
- Use an exception only where the matched rule permits one, and always record owner, scope, controls, evidence, and expiry.
- Re-evaluate after relevant Impact, architecture, fact, Blueprint, task, claim, or test changes.

For role-specific help, continue with the [Product Owner guide](product-owner-guide.md), [Technical Owner guide](technical-owner-guide.md), [Governance Owner guide](governance-owner-guide.md), or [Implementation guide](implementation-guide.md).

## Status meanings

| Status | Meaning | Action |
| --- | --- | --- |
| `not-configured` | No approved policy baseline exists. | Continue normally or adopt one deliberately. |
| `not-evaluated` | A baseline exists but this intent has no current evaluation. | Confirm facts and evaluate. |
| `unassessed` | The evaluation hasn't established an allowed outcome. | Supply or review the missing facts and applicable rules, then evaluate again; don't treat this as a pass. |
| `allow` | The current evidence has no policy blocker. | Continue through the ordinary EWAI gates. |
| `allow-with-controls` | The design can continue only with visible controls. | Trace every control into Plan evidence. |
| `review-required` | A matched rule needs its configured human role. | Obtain and record the named review. |
| `deny` | The current design conflicts with policy. | Redesign, or follow a permitted exception route. |
| `stale` | A relevant revision changed. | Reconfirm or re-evaluate; do not reuse the old pass. |
| `invalid` | Evidence or its digest cannot be trusted. | Preserve it and investigate the integrity failure. |

Passing this gate does not replace security validation, Solution Readiness, Manual QA, specialist review, representative-user evidence, deployment approval, or release acceptance.
