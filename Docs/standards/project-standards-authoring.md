# Project standards authoring guide

Use this guide to turn a proposed engineering practice into an explicit, reviewable, testable project constraint.

## Separate recommendation from acceptance

Initial Discovery writes minimum-standard recommendations under:

```text
SPECS/5.Strategy/options/minimum-standards.md
```

They remain options until a technical owner accepts, replaces, or rejects them. Accepted project standards belong in:

```text
SPECS/4.Constraints/standards.md
```

Organisation Blueprint standards materialise under:

```text
SPECS/4.Constraints/standards/organisation/<publisher>/<pack>/<module>/<standard>.md
```

A generated recommendation is not binding merely because it exists.

## Write one enforceable concern at a time

A useful standard states:

- **Purpose:** the outcome or risk it protects.
- **Scope:** repositories, components, data, or changes to which it applies.
- **Rule:** the concrete obligation.
- **Rationale:** why this project adopted it.
- **Verification:** commands, evidence, or review that demonstrate conformance.
- **Exceptions:** who may approve one, required compensating controls, and review date.
- **Owner:** who interprets and maintains it.
- **Change triggers:** when it must be reviewed.

Avoid mixing unrelated security, testing, naming, and deployment rules into one page.

## Example

```markdown
# Public API compatibility

## Purpose

Protect consumers from unannounced breaking changes.

## Scope

All externally consumed HTTP API contracts.

## Rule

Breaking request or response changes require a new supported API version and a documented consumer migration path.

## Verification

- Contract tests compare the supported schema fixtures.
- Delivery evidence identifies affected consumers.
- Manual QA exercises one existing and one migrated consumer journey.

## Exceptions

The technical owner and Product Owner must approve the reason, affected consumers, compensating communication, and expiry date.

## Owner

Platform Architecture.
```

## Make verification proportional and observable

Prefer a combination of:

- deterministic linting or static analysis;
- focused automated behaviour tests;
- architecture or threat review;
- change-set inspection;
- operational evidence;
- Manual QA;
- named approval for exceptions.

Do not write “follow best practice” as a rule. Name the observable behaviour and evidence the project needs.

## Resolve conflicts explicitly

Standards may conflict with each other, an architecture decision, a Blueprint version, or an inherited code constraint. Do not assume a universal precedence order.

Record:

1. the conflicting statements and sources;
2. the scope of each;
3. the decision owner;
4. the chosen interpretation;
5. any migration or exception;
6. review or expiry date.

Update or supersede stale text rather than appending a contradictory note that leaves two apparent truths.

## Check applicability before Build

Use repository knowledge to identify applicable standards:

```bash
ewai index standards <target> --project .
ewai index standards-coverage <intent-slug> --project .
```

The EWAI standards-check skill can review a snippet, file, change set, capability, or repository against accepted project-local SPECS. It should report baseline, revision, scope, exclusions, commands, passes, non-conformities, warnings, unresolved evidence, and conflicts.

A standards review does not fix code or pass a delivery gate unless the user has separately authorised those actions and the guarded evidence is recorded.

## Manage exceptions

An exception should include:

- standard and affected scope;
- business or technical reason;
- risk created;
- compensating controls;
- accountable approver;
- owner and expiry/review date;
- evidence needed to close it.

“The AI could not comply” is not sufficient justification.

## Review and retirement

Review when technology support changes, incidents expose a gap, regulation or policy changes, verification becomes ineffective, or teams repeatedly request the same exception.

When retiring a standard, retain enough history to interpret earlier delivery evidence and identify its replacement.

## Author checklist

- [ ] Recommendation and accepted standard are in the correct locations.
- [ ] Purpose, scope, rule, and owner are explicit.
- [ ] Verification produces observable evidence.
- [ ] Exceptions have authority, controls, and expiry.
- [ ] Conflicts are resolved rather than hidden.
- [ ] The rule is proportionate to project risk.
- [ ] Change and retirement triggers are recorded.

## Related guides

- [Developer delivery guide](../developer-delivery-guide.md)
- [Organisation-specific personas](../personas/organisation-specific-personas.md)
- [Human approval and assurance](../human-approval-and-assurance-guide.md)

## Current contract sources

- `src/discovery.mjs`
- `src/runtime/repository-index.mjs`
- `README.md`
- `SPECS/pipeline.yaml`
