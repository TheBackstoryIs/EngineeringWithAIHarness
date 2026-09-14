# Organisation Policy Design Gate contract

## Permanent authority boundary

Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Policy pack

An organisation contribution uses `ewai.organisation-policy/v1`. It is strict, data-only, versioned, publisher-bound, provenance-bearing, and limited to this closed condition vocabulary:

- `resource`
- `operation`
- `data_entity`
- `data_classification`
- `actor`
- `environment`
- `destination`
- `model`
- `ai_use`
- `retention`

Outcomes are `allow`, `deny`, `review-required`, `allow-with-controls`, and `unassessed`. Restrictive unresolved outcomes govern. `not-configured` is a workspace state, not a policy outcome, and is non-blocking.

Policy objects cannot contain script, command, prompt, template, expression, executable, secret, credential, token, remote, URL, endpoint, handler, or hook fields. Values are bounded identifiers rather than executable expressions.

Every control declares one or more evidence routes: `claim`, `task`, `automated-test`, `named-human`, or `specialist-review`. A review-required rule names a configured review role. A permitted exception names its review role; prohibited exceptions cannot name one.

## Baseline and drift

Organisation Blueprint resolution produces exact pack, contribution, Blueprint, policy, and effective digests. Guided Setup previews the result and materialises `SPECS/4.Constraints/organisation-policy/baseline.json` only after named approval of the exact digest.

No contribution means `not-configured`, `enabled: false`, and `blocking: false`. A changed source pack makes the accepted baseline stale; it never silently changes the project record.

## Facts and evaluation

Candidate facts use the same closed dimensions and preserve one of three provenance types:

- `observed`
- `model-proposal`
- `persona-hypothesis`, with safe persona ID, name, and tier

The `preparePolicyFacts` domain operation creates the current digest-bound proposal. Confirmation requires `authority: human`, a named confirmer, the exact proposal revision and digest, and one disposition for every fact.

Evaluation requires the current intent revision, effective policy digest, and confirmed-facts digest. It records every matched rule and the governing outcome. Reviews and exceptions are immutable decisions bound to that evaluation digest. Any relevant revision change makes them stale.

## Interfaces

CLI reads:

```text
ewai policy status [INTENT] --mode business|technical --project . --json
```

CLI writes accept a project-relative JSON file:

```text
ewai policy confirm-facts --input FILE --project . --json
ewai policy evaluate --input FILE --project . --json
ewai policy review --input FILE --project . --json
ewai policy exception --input FILE --project . --json
```

MCP tools:

- `ewai_policy_status`
- `ewai_policy_confirm_facts`
- `ewai_policy_evaluate`
- `ewai_policy_record_review`
- `ewai_policy_record_exception`

Loopback HTTP routes:

- `GET /api/policies?intent=<domain/slug>&mode=business|technical`
- `POST /api/policies/facts/confirm`
- `POST /api/policies/evaluate`
- `POST /api/policies/reviews`
- `POST /api/policies/exceptions`

The dashboard **Policy gates** view consumes the same workspace. Business and technical views share one result and reference. It exposes active persona tier and engagement reason while retaining named-human authority.

Requests never supply a project root, organisation root, policy root, or production target. Adapters call the shared service and never derive rules or outcomes.

## Delivery integration

When enabled, current passing policy evidence is conditional for Intent and Plan gates. Plan controls must resolve transitively to exact Claim Ledger, task, test, named-human, or specialist-review evidence. Relevant Impact dimensions are actors, AI use, data, destinations, hosting, and integrations. Changes invalidate affected evidence; unrelated summary churn does not.

Lifecycle events are emitted only after exact durable records exist:

- `ewai.policy.facts.confirmed`
- `ewai.policy.evaluation.recorded`
- `ewai.policy.review.recorded`
- `ewai.policy.exception.recorded`

Events include only status, intent reference, evidence digest, and optional rule ID. Hooks observe a completed EWAI mutation; they cannot veto it, change EWAI state, or invoke production systems on EWAI's behalf.
