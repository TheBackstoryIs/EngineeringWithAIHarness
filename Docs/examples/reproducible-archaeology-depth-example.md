# Worked example: reproducible Archaeology and Discovery depth

This example shows how two sessions can produce different explanatory wording
while reaching the same material investigation boundary. The project, people,
IDs, and digests are illustrative; they are not a claim about a real system.

Use this alongside the
[Reproducible Archaeology and Discovery Depth guide](../reproducible-archaeology-and-discovery-depth.md).

## What you can reproduce

This is a worked interpretation, not a bundled runnable Northstar application. Its IDs and digests won't resolve in your project. To try the workflow, initialise a disposable project with a small codebase, agree its purpose and processing permissions, refresh the Source Map, then follow the [prepare/review/compare guide](../reproducible-archaeology-and-discovery-depth.md). Use the IDs and templates actually returned.

You can reproduce how stable evidence and gap identity are compared. Exact explanatory wording, persona availability and coverage depend on your inputs; this example doesn't guarantee matching output.

## Scenario

Northstar has inherited a small internal case-triage service. It has one web
application, one API, an SQL database, and an overnight export to a reporting
platform. The repository is available, but the operating model and data-handling
decisions are incomplete.

The named owner says the immediate outcome is to make a safe maintenance change,
not to redesign the service. The team wants enough understanding to plan that
change without turning Archaeology into an unbounded documentation exercise.

## 1. Establish the evidence boundary

The team refreshes the Source Map against revision `example-4f21a9` and records:

| Evidence surface | Result |
| --- | --- |
| Regular files | 286 inventoried |
| Analysed | 267 |
| Inventory-only | 8 |
| Analysis failed | 3 |
| Sensitive | 2, retained as metadata-only evidence |
| Oversized | 6, retained as explicit coverage limits |
| Owner declarations | Service purpose, internal users, current hosting, recovery owner, and client-data classification |

The eight inventory-only files and three analysis failures are not removed to
make coverage appear healthier. They remain inputs to the depth recommendation.

## 2. Review the depth profile

EWAI recommends each dimension independently:

| Dimension | Recommendation | Why | Named-owner selection |
| --- | --- | --- | --- |
| Architecture | `standard` | Component boundaries are visible, but the reporting integration has two competing implementations. | `standard` |
| Data | `deep` | The service processes client identifiers and exports them across a system boundary. | `deep` |
| Security | `deep` | Authorization is partly observed, while the reporting trust boundary is not confirmed. | `deep` |
| Product | `bounded` | The requested maintenance outcome affects one existing internal journey. | `bounded` |
| Delivery | `standard` | Unit tests exist, but release and rollback evidence is partial. | `standard` |
| Governance | `deep` | Client-data policy applies and one retention decision has no named authority. | `deep` |
| Operations | `standard` | Hosting is known, but recovery ownership and the overnight failure path need confirmation. | `standard` |

This is more proportionate than selecting `deep` for the whole project. Repository
size did not determine the result, and the number of proposed intents is not used
as evidence of depth.

## 3. Observe persona swapping

The active ensemble changes with the concern:

| Concern | Active perspectives | Reason shown to the reviewer |
| --- | --- | --- |
| Product journey | Archaeology lead, local Product Owner | Confirm the affected journey and resist inferring desired behaviour from code. |
| Client-data export | Archaeology lead, local Data Owner, installed premium Privacy Specialist | Challenge classification, movement, retention, and evidence gaps. |
| Reporting trust boundary | Archaeology lead, local Security Owner, installed premium Threat Modeller | Examine identity, authorization, exposure, and failure paths. |
| Recovery | Archaeology lead, local Service Owner | Establish operational ownership and recovery evidence. |

The premium specialists are used because they are already installed and relevant.
Repeating the process without premium access still completes with the core and
project personas plus the standard model. No persona can confirm an owner
declaration or approve the selected depth.

## 4. Record stable gaps

The generated prose differs between two clean sessions:

- session A says, “The export retention owner is not evidenced”;
- session B says, “No accountable retention decision was found for reporting exports.”

Both statements resolve to the same structured condition and therefore the same
illustrative stable ID:

| Stable gap | Structured meaning | Evidence references |
| --- | --- | --- |
| `GAP-GOV-8ab42c91d730` | Governance · retention owner missing · current state `unassigned` · intended state `named-owner` | Policy applicability and export configuration |
| `GAP-SEC-27f061c35a9d` | Security · reporting trust boundary unresolved · current state `partial` · intended state `confirmed` | API client and owner declaration |
| `GAP-OPS-d2e19b07c411` | Operations · overnight failure recovery untested · current state `unknown` · intended state `tested` | Scheduler configuration and runbook |

The IDs above illustrate the real `GAP-<dimension>-<digest>` shape. A real ID is
calculated by EWAI from the complete structured identity; do not invent or edit it.

## 5. Keep grouping separate

The first reviewer groups all three gaps under `safe-reporting-maintenance`. A
second reviewer keeps the evidence and gaps unchanged but groups them by owner:

- `data-governance` owns the retention gap;
- `platform-security` owns the trust-boundary gap;
- `service-operations` owns the recovery gap.

That can produce three intents instead of one. The comparison reports a grouping
change, not new discovery content. Stable gap identity is independent of how the
organisation chooses to arrange the work.

## 6. Compare two reviewed runs

| Comparison layer | Run A versus run B | Interpretation |
| --- | --- | --- |
| Inputs | Same | Same project, revision, Source Map, packs, provider capability, and exclusions. |
| Evidence | Same | Repository and bounded owner-evidence fingerprints agree. |
| Personas | Same | The same named identities and tiers were engaged. |
| Selected depth | Same | All seven named decisions agree. |
| Coverage | Same | Failures and limited surfaces remain visible in both runs. |
| Stable gaps | Same | The same three structured concerns were retained. |
| Grouping | Different | The owner deliberately changed the work-organisation strategy. |
| Unexplained variance | Empty | The only material difference has a recorded cause. |

The two runs are reproducible despite different prose and grouping. They would
not be reproducible if the security gap disappeared while all upstream evidence,
coverage, personas, and depth remained unchanged.

## 7. Decide whether the result is good enough

The named owner still needs to assess content quality. They review the runs for:

- missing material concerns;
- duplicated or irrelevant questions;
- evidence traceability;
- proportionate depth;
- useful next actions;
- visibility of failures and contradictions.

Only after that review may the owner approve Manual QA through the canonical EWAI
operation. Reproducible structure is evidence of control, not proof that the
investigation was complete or that the proposed change is safe to release.

Use the
[operator and Manual QA checklist](../quality/reproducible-archaeology-depth-review-checklist.md)
to conduct and record that assessment.
