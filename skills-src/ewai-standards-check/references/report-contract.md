# Standards-check report contract

Use this contract for every report written by `$ewai-standards-check`.

## Required frontmatter

```yaml
---
title: Standards check — <target>
date: YYYY-MM-DD
status: complete | partial | blocked
scope: snippet | files | directory | change-set | repository
target: <human-readable target>
repository_revision: <commit SHA, working-tree state, or not-repository-backed>
standards_baseline: <commit SHA or working-tree state for SPECS>
reviewer: <AI host/model when known>
---
```

Use `complete` only when every in-scope source surface and applicable standard has a supported outcome. Use `partial` for sampling, explicit exclusions that prevent full coverage, interrupted commands, or unresolved evidence. Use `blocked` when the standards baseline or target cannot be inspected meaningfully.

## Required sections

### 1. Conclusion

State the bounded result in plain language. Never use an unqualified “compliant” for a partial review.

### 2. Review scope

Record:

- requested target and review mode;
- repositories, paths, symbols, snippet lines, commits, or diff range inspected;
- revision and dirty-working-tree state;
- generated, vendored, binary, unavailable, or deliberately excluded surfaces;
- whether coverage is complete, partial, or blocked.

### 3. Standards baseline

List every SPECS source used, with a relative path and relevant heading or rule identifier. Distinguish:

- binding constraints;
- accepted decisions or patterns;
- behavioural expectations and gate evidence;
- advisory material;
- unresolved or conflicting sources.

Do not paste large sections of standards. Paraphrase the rule and link it to its source.

### 4. Outcome summary

Use this table:

| Outcome | Count |
|---|---:|
| Pass | 0 |
| Non-conformity | 0 |
| Warning | 0 |
| Unverified | 0 |
| Standards conflict | 0 |
| Not applicable | 0 |

Add severity counts for non-passing findings when useful.

### 5. Applicability and coverage matrix

Use one row per considered rule:

| Standard | Why it applies | Evidence inspected | Outcome | Finding |
|---|---|---|---|---|

Use a source-provided standard identifier when available; otherwise use `<path>#<heading>`. A whole-repository report must make unexamined source surfaces visible.

### 6. Findings

Give each non-passing finding a stable identifier such as `SC-001` and include:

- outcome and severity;
- standard source and concise rule;
- implementation evidence with path and line or symbol references;
- impact and affected scope;
- confidence and any uncertainty;
- smallest useful remediation;
- verification needed after remediation.

Keep one independently resolvable issue per finding. Do not combine unrelated violations to reduce the finding count.

### 7. Confirmed conformance

Summarize meaningful passes with their evidence. Avoid listing trivial formatting checks when they add no assurance.

### 8. Unverified items and standards conflicts

Explain missing evidence, runtime-only checks, inaccessible systems, ambiguous wording, contradictory records, and the accountable decision needed. Do not convert unknowns into passes.

### 9. Validation commands

Record each command, execution context, exit status, and relevant result. If no commands ran, say why.

### 10. Recommended next actions

Order actions by risk and dependency. Separate:

1. standards decisions or missing evidence;
2. critical and high remediation;
3. lower-severity improvements;
4. re-check and gate evidence.

## Evidence rules

- Prefer repository-relative links and line references.
- Cite the standards baseline and implementation revision independently when they differ.
- Mark conversation-supplied snippets as non-repository-backed.
- Do not expose secrets, credentials, personal data, or unnecessarily reproduce vulnerable code.
- Treat tool output as scoped evidence, not an authority beyond the checks the tool performs.
- Preserve the original report. A later re-check should be a new dated report or a clearly attributable appended review event.
