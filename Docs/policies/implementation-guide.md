# Organisation Policy Design Gates Implementation Guide

This guide is for maintainers integrating or extending the capability without creating a second policy engine.

> Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Architecture

The policy pack and approved baseline live in `src/organisation-policies.mjs`. Confirmed facts, deterministic evaluation, reviews, exceptions, and current status live in `src/policy-design-gates.mjs`. Conditional Intent and Plan gates and control traces live in `src/policy-gate-integration.mjs`.

`src/runtime/policy-workspace.mjs` is the only adapter-facing service. The CLI, MCP, HTTP, and UI call it; they never match rules, choose precedence, or derive authority themselves.

## Interface map

| Interface | Read | Mutations |
| --- | --- | --- |
| CLI | `ewai policy status` | `confirm-facts`, `evaluate`, `review`, `exception` with project-relative JSON |
| MCP | `ewai_policy_status` | `ewai_policy_confirm_facts`, `ewai_policy_evaluate`, `ewai_policy_record_review`, `ewai_policy_record_exception` |
| HTTP | `GET /api/policies` | strict `POST /api/policies/...` routes |
| UI | Policy gates business/technical workspace | current evaluation and named-review actions |

All roots come from server or process configuration. Reject request fields that attempt to supply a project, organisation, policy, or production root. Escape every browser field and expose only safe persona metadata, bounded categorical facts, rule details, controls, evidence references, and digests.

## Lifecycle hooks

Publish policy events only after verifying the exact durable record. Use a stable source key and record digest so repeat publication is idempotent. Events may include status, intent reference, evidence digest, and rule ID only. Do not include raw policy bodies, persona definitions, credentials, prompts, local absolute paths, or production targets.

Handlers run after persistence. Their failure cannot roll back or veto the EWAI decision, and EWAI does not use them as runtime enforcement.

## Extension rules

- Add a condition dimension only through schema, domain, fact, evaluator, Impact, docs, and migration tests together.
- Keep rules closed and deterministic; do not add narrative expressions or model calls to gate time.
- Keep `not-configured` explicitly non-blocking.
- Keep standard-model behaviour complete; premium personas are metadata-selected optional enrichment.
- Preserve named-human authority and immutable digest binding.
- Ensure any new adapter calls the shared workspace/domain contract.
- Include the permanent disclaimer on success, empty, error, CLI, MCP description, HTTP, UI, report, and guide paths.

## Verification

Run the focused policy tests, `npm run check`, the full `npm test`, `npm pack --dry-run --json`, a fresh Repository Source Map, and the mandatory standards sweep. Static UI contracts do not replace representative desktop and 390 px browser Manual QA.
