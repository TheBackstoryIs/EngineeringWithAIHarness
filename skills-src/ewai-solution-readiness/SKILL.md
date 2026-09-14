---
name: ewai-solution-readiness
description: Prepare and complete a governed, evidence-bound Solution Readiness Review for an EWAI delivery. Use when an owner asks whether a solution has proportionate evidence for internal, sensitive, client-facing, public-service, critical or regulated use; when release evidence must be composed across intent, impact, standards, tests, Manual QA, security, hosting, operations, documentation and specialist assurance; or when an earlier readiness report may have become stale.
---

# EWAI Solution Readiness

Use the CLI/domain contract to prepare evidence. Facilitate a named human review. Never turn the result into certification or release permission.

## Method

1. List profiles with `ewai readiness profiles --project . --json`.
2. Ask the accountable owner to choose `internal-only`, `internal-sensitive`, `client-facing`, `public-service`, or `critical-regulated`.
3. Prepare current evidence with `ewai readiness prepare SLUG --profile PROFILE --project . --json`.
4. Show every dimension, state, limitation and citation. Never collapse them into a score.
   When an organisation policy baseline is enabled, include the current policy design gate as an evidence dimension with its exact baseline, fact and evaluation digests, matched controls, decisions and staleness. `not-configured` stays visible where policy is not required; never relabel it as satisfied.
5. Show **Active personas** with safe ID, name, tier, matched concern and engagement reason.
6. Review the generated `readiness-review.template.json` with a named human. Every required dimension needs an explicit disposition and reason. Conditions and residual risks need an owner and future review date.
7. Record it with `ewai readiness review ASSESSMENT --input FILE --reviewed-by NAME --project . --json`.
8. Explain the result and every contributing condition or blocker.
9. Check currency with `ewai readiness status ASSESSMENT --project . --json`. When stale, prepare a new assessment; never overwrite history.

## Evidence vocabulary

- Prepared states: `satisfied`, `conditional`, `blocking`, `missing`, `stale`, `not-applicable`, `not-configured`.
- Human dispositions: `accepted`, `conditional`, `blocked`, `insufficient-evidence`, `not-applicable`.
- Advisory results: `ready-for-human-decision`, `conditional`, `blocked`, `insufficient-evidence`.

Never accept `missing`, `stale`, `blocking` or `not-configured` required evidence as satisfied. `ready-for-human-decision` means the evidence is coherent enough for accountable human judgement; it does not mean approved or released.

## Persona method

- Use standard model reasoning plus installed core and project personas as the complete baseline.
- Swap in relevant installed project, personal and premium personas as the profile and evidence gaps change.
- Keep project, personal and core persona provenance visible alongside any optional premium enrichment.
- Premium personas are optional enrichment. Never sync, download or imitate premium content during this skill.
- Keep active personas visible at preparation and review.
- Treat personas as advisory lenses. They do not supply stakeholder evidence, accept risk or approve release.

## Stop conditions

- Stop if the delivery slug or cited path escapes the configured project.
- Stop if the preparation, repository revision or cited evidence is stale.
- Stop if a required dimension lacks a decision or a condition lacks accountable ownership.
- Stop if anyone asks the skill to rewrite source evidence, approve Manual QA, change a security disposition, deploy or release.
- The skill does not approve Manual QA or release.
- Preserve blockers and uncertainty. Do not manufacture evidence, a percentage score or a certificate.

## Mandatory notices

Repeat both notices on every presentation path:

Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.

Solution Readiness Review is advisory evidence, not certification, business acceptance, Manual QA approval, security approval, deployment permission or release authorisation. Accountable humans retain every approval and risk decision.
