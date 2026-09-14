---
name: ewai-standards-check
description: Verify a supplied code snippet, one file, several files, a directory, a change set, or an entire repository against the accepted project standards and related decisions captured in SPECS. Use when an EWAI project owner asks whether code follows project standards, requests a standards audit or compliance check, needs gate evidence before moving work forward, or wants a durable Markdown standards-check report.
---

# EWAI Standards Check

Check implementation evidence against project-owned standards. Resolve the SPECS root from `.ewai-pipeline/project.json`, treat it as the source of truth, and write a durable Markdown review; do not substitute generic best practice for a missing project rule.

## Establish the review boundary

1. Resolve the workspace and configured SPECS root from `.ewai-pipeline/project.json`; fall back to `./SPECS` only for a legacy/default project without a locator.
2. Run the normal EWAI check-in when this is the first substantive action in the conversation.
3. Confirm the target from the request:
   - code supplied in the conversation;
   - one file or an explicit list of files;
   - a directory, commit, branch diff, or working-tree change set;
   - the whole repository.
4. Confirm whether the user wants review only or also wants fixes. Default to review only. Never alter code merely because a non-conformity is found.
5. If the configured SPECS root is absent, stop and explain that there is no project standards contract to verify. Offer EWAI initialization or Archaeology rather than inventing a baseline.

For a whole-repository request, inventory the source surfaces before checking them. Exclude generated, vendored, cache, build-output, dependency, and binary paths unless a project standard explicitly brings them into scope. Record every exclusion. Do not describe a sampled or partially inspected repository as compliant.

## Build the applicable standards set

Read project sources before inspecting implementation:

1. Read `SPECS/5.Strategy/standards-index.md` when it exists and follow its routing instructions.
2. Read applicable accepted rules under `SPECS/4.Constraints/`, including compliance constraints.
3. Read accepted architecture, patterns, anti-patterns, decisions, schemas, SOPs, and stack guidance under `SPECS/5.Strategy/` when they constrain the target.
4. Read relevant scope, domain, intent, requirement, journey, risk, gate, and Build records when they determine expected behaviour or required evidence.
5. Read repository-local agent instructions named by the project, such as `AGENTS.md` or `CLAUDE.md`, only when SPECS adopts or routes to them. Record their authority explicitly.

Create an applicability matrix before judging the code. Give each rule a stable identifier from the source when available; otherwise use `<relative-path>#<heading>`. For each rule record:

- why it applies to this target;
- which implementation surfaces can prove or disprove it;
- what validation evidence is required;
- whether it is `applicable`, `not-applicable`, `conflicting`, or `unresolved`.

Do not silently choose between conflicting accepted records. Report the conflict as a standards defect and keep the affected checks unresolved until a project owner decides precedence.

## Inspect implementation evidence

Read the target and enough surrounding code to evaluate it accurately. Follow imports, callers, routes, schemas, tests, configuration, generated contracts, and framework conventions where the standard crosses file boundaries. A file-only request limits the reported target, not the contextual reading needed to understand it.

Use the most specific available evidence:

- source paths and line numbers;
- symbols, routes, migrations, schemas, or configuration keys;
- tests and their assertions;
- formatter, linter, type-checker, static-analysis, security, or project validation output;
- repository history when the standard or exception depends on an accepted decision.

Run safe project-defined validation commands when they are necessary and available. Follow the project's execution instructions and record the exact command and outcome. A green tool result is evidence for the rules it actually covers, not proof that every project standard passes.

Classify each applicable rule as:

- `pass`: direct evidence satisfies the rule;
- `non-conformity`: direct evidence contradicts the rule;
- `warning`: the code creates a material concern but the rule is advisory or incomplete;
- `unverified`: evidence is missing, inaccessible, ambiguous, or requires runtime/human validation;
- `not-applicable`: the rule was considered and does not govern this target;
- `standards-conflict`: accepted project sources disagree.

Assign `critical`, `high`, `medium`, `low`, or `information` severity to non-passing findings. Separate certainty about the evidence from severity of the impact. Never claim security, compliance, correctness, or whole-repository conformance from absence of detected failures.

## Write the Markdown report

Read [the standards-check report contract](references/report-contract.md) completely before writing the result.

Create:

```text
SPECS/3.Evidence/reviews/standards/<YYYY-MM-DD>-<target-slug>-standards-check.md
```

Use a collision-safe suffix rather than overwriting an existing report. Keep sensitive code out of the report; cite paths and describe evidence instead. For supplied snippets, assign displayed line numbers and label the evidence as conversation-supplied rather than repository-verified.

The report must contain the target, commit or working-tree state, standards sources, applicability matrix, inspected evidence, exclusions, command results, outcome counts, detailed findings, unverified items, conflicts, and a proportionate remediation order. Include passes as well as problems so the report shows real coverage.

If the check belongs to an intent or delivery stage, link the report from the applicable Build tracker or evidence record without changing the stage automatically. A report does not pass a gate by itself; the project's gate contract decides that.

## Present the outcome

Lead with the bounded conclusion and the report path. State:

- how many rules passed, failed, warned, remained unverified, conflicted, or were not applicable;
- the highest-severity findings;
- whether coverage was complete, partial, or blocked for the requested boundary;
- what decision, evidence, or remediation should happen next.

If the user requested fixes, propose the smallest safe sequence and ask for any authority needed by the project before editing. After fixes, create a new report or an explicitly dated re-check section; preserve the original evidence.
