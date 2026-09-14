# Rollout review contract

Read this reference before interpreting `ewai.rollout-workspace/v1`, troubleshooting a rollout, or producing an LLM-assisted consultancy or network review.

## Canonical inputs

- `.ewai-pipeline/project.json` locates the host project and configured SPECS root.
- `SPECS/pipeline.yaml` owns configured repository names and safe workspace-relative roots.
- `SPECS/1.Scope/portfolio.yaml` owns the portfolio, programme, project hierarchy, topology, ownership, and declared dependencies.
- `SPECS/1.Scope/rollout.yaml` owns rollout baselines, cohorts, assignments, evidence expectations, freshness, and review ownership.
- Each assigned project owns its Organisation Blueprint pin, standards, delivery, Manual QA, and security evidence.

The rollout workspace is a disposable, bounded projection. It is not a second client registry and cannot write into a child project.

## Workspace and adoption states

| Status | Meaning | Safe response |
| --- | --- | --- |
| `not-configured` | No rollout policy exists. | Point to the implementation guide; do not create policy without authority. |
| `invalid` | Policy, Portfolio, project topology, or evidence structure failed validation. | Report stable diagnostics and stop interpretation. |
| `ready` | The policy is valid and all projected adoption and required evidence states are current. | Review the evidence; do not call this approval or certification. |
| `attention` | At least one project adoption or required-evidence state needs review. | Preserve the reason and route it to the named owner. |

Project adoption can be `aligned`, `review-required`, `not-adopted`, `unavailable`, `stale`, or `invalid`. Required evidence can be `present`, `missing`, `stale`, `not-configured`, or `unavailable`. Absence and uncertainty never imply alignment.

## Safe public fields

The projection may expose:

- bounded rollout, Portfolio, cohort, baseline, and project IDs, names, owners, review dates, and required evidence classes;
- exact expected and observed Blueprint ID, version, and optional digest;
- structural adoption and evidence states, safe timestamps, limitations, and accountable routes;
- latest delivery status, phase, Build-approval boolean, and Manual QA state;
- security-validation configuration and structural run state without findings or dispositions;
- active persona ID, name, tier, matched signals, and engagement reason;
- installed-tier availability counts, review questions, evidence classes, and mandatory notices.

It must not expose absolute roots, raw policy or persona bodies, source documents, prompts, credentials, validator output, findings, risk decisions, adapter code, or request-supplied authority.

## Exact Blueprint comparison

V1 compares the project-owned Blueprint pin with the cohort baseline by exact ID and version, plus digest when the baseline declares one. An exact match is `aligned`. Any difference is `review-required`.

The checker does not infer semantic-version precedence, upgrade safety, compatibility, replacement, equivalence, or migration completeness. A named accountable human owns that decision.

## Evidence taxonomy

| Class | Meaning | Authority |
| --- | --- | --- |
| `declared-policy` | Baseline, cohort, assignment, ownership, or evidence expectation recorded by the host project. | A governed declaration, not proof of adoption. |
| `observed-project-evidence` | Allowlisted structural evidence read from an assigned project. | Bounded observation with freshness and limitations. |
| `automated-check` | Exact comparison or deterministic freshness result. | A repeatable check, not an adequacy judgement. |
| `persona-hypothesis` | Concern or interpretation from a disclosed persona lens. | Advisory proposition requiring evidence or human resolution. |
| `human-decision` | Decision actually recorded by a named accountable person. | The only decision class; limited to its recorded scope. |

The selected-project assurance view is explicitly structural-only and returns no adequacy verdict.

## Persona and LLM method

`review.standardLlmAvailable` means the ordinary host model can perform the bounded review. Installed project and core personas improve context at baseline. Installed, relevant personal or premium personas may enrich a focused review.

Retrieve the projection again when the focus changes so irrelevant personas leave the active ensemble and newly relevant ones can enter. Disclose the returned name, tier, matched signals, and engagement reason. Missing premium content is nonblocking. Never fetch, synchronise, imitate, or reconstruct unavailable premium content from this skill.

Persona output remains `persona-hypothesis` unless supported by project evidence or resolved by a named human. It cannot become `human-decision` evidence by repetition or confidence.

## Human and assurance boundary

Always preserve both workspace notices:

> Rollout and persona analysis is advisory. Organisation Blueprint adoption, evidence adequacy, accepted risk, Manual QA, deployment and release decisions remain with named accountable humans.

> Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.

Rollout analysis cannot change policy, write child SPECS, approve Build or Manual QA, accept risk, certify security, dispatch work, change readiness, deploy, or release.
