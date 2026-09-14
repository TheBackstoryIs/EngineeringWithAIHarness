# Portfolio review contract

Read this reference before interpreting `ewai.portfolio-workspace/v1`, troubleshooting a portfolio, or producing an LLM-assisted programme review.

## Canonical inputs

- `.ewai-pipeline/project.json` locates the host project and its configured SPECS root.
- `SPECS/pipeline.yaml` owns configured repository names and safe workspace-relative roots.
- `SPECS/1.Scope/portfolio.yaml` owns the portfolio, programme and project hierarchy plus declared project-to-project dependencies.
- Each child project owns its own project config, intent metadata, delivery state, approvals and Manual QA evidence.

The projection is disposable and read-only. It must never become a route for rewriting child evidence.

## Workspace states

| Status | Meaning | Safe response |
| --- | --- | --- |
| `not-configured` | No canonical portfolio manifest exists. | Point to the implementation guide; do not create one without authority. |
| `invalid` | Schema, topology, configured root or path validation failed. | Report stable diagnostics and stop interpretation. |
| `ready` | The manifest is valid and no current attention item was projected. | Review the evidence; do not call this approval or assurance. |
| `attention` | One or more child evidence conditions need an owner. | Preserve each reason and route it to its named owner. |

Member evidence may be `declared`, `ready`, `missing`, `stale`, `disagreement`, or `unavailable`. Absence never means healthy.

## Safe public fields

The workspace may expose:

- safe member IDs, names, kinds, parent IDs, owners, configured repository names and relative project paths;
- bounded intent counts and status metadata;
- current child delivery phase/status, blocked reason, Build-approval boolean, Manual QA status, update time and safe relative evidence reference;
- declared dependency ID, direction, rationale and owner;
- stable attention code, member, owner, reason and evidence class;
- active persona ID, name, tier, matched signals and engagement reason;
- installed-tier availability counts, bounded review questions, evidence classes and mandatory notices.

It must not expose absolute roots, raw intent or persona bodies, prompts, credentials, unrestricted child files, adapter entrypoints or request-supplied authority.

## Evidence taxonomy

| Class | Meaning | Authority |
| --- | --- | --- |
| `declared` | Portfolio structure or dependency recorded by the project. | A project declaration, not proof of runtime coupling. |
| `observed` | Allowlisted evidence read from a child project. | Bounded observation with freshness and provenance. |
| `inferred` | A consequence reasoned from declared and observed evidence. | A review proposition requiring confirmation. |
| `persona-hypothesis` | A concern surfaced through an active persona lens. | Advisory question, never stakeholder fact. |
| `human-decision` | A decision actually recorded by a named accountable person. | The only decision class; scope remains limited to the recorded authority. |

`declared-child-state` identifies a child project’s own recorded delivery claim. Keep it distinct from independently observed cross-project coupling.

V1 returns `observedEvidence.status: not-available` for cross-project Source Map dependencies. Do not reinterpret declared dependencies as observed edges.

## Persona and LLM method

`review.standardLlmAvailable` keeps ordinary host-model reasoning available. Installed project and core personas improve framing at baseline. Installed relevant personal or premium metadata can enrich the bounded ensemble.

When focus changes, retrieve the snapshot again and replace the active ensemble. Do not retain stale lenses merely because they were useful in an earlier pass. Never require premium access, approximate an unavailable specialist, or initiate entitlement/library installation from a review.

Persona output remains `persona-hypothesis` until supported by project evidence or resolved by a named person. It cannot create `human-decision` evidence.

## Human and assurance boundary

Always preserve both notices returned by the workspace. The security notice begins:

> Security validation is evidence, not certification or proof that this system is secure.

Portfolio analysis cannot approve Build or Manual QA, accept residual risk, certify security, mutate child SPECS, change release readiness, dispatch work, deploy or release. Route the next action to the member or dependency owner shown in the projection.
