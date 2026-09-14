# EWAI phase routing

The sequence below is mandatory. At every entry, use the project-local required-artefact contract and gate template. At every exit, record the gate and complete the phase through guarded EWAI operations.

| Stage | Purpose | Exit evidence |
|---|---|---|
| 1. Ideate | Turn a rough thought into an inspectable problem and candidate outcome. | Grill ledger and draft intent. |
| 2. Intent | Establish purpose, scope, users, acceptance evidence, constraints, dependencies, and readiness. | Accepted intent summary and dependency checks. |
| 3. Reconcile | Compare intent with existing repository behaviour and resolve disagreement. | Repository-grounded reconciliation. |
| UI Design | For user-facing work, agree the interaction and visual outcome before planning code. | Design record plus selected runnable prototype manifest. |
| 4. Plan | Define vertical slices, claims, interfaces, tasks, write sets, sequencing, and implementation flow. | Build Plan, Claim Ledger, Plan Contract, destination, and task graph. |
| 5. Pattern Validation | Challenge the plan against local architecture, patterns, standards, and source truth. | Passing pattern and contract checks. |
| 6. Test Plan | Design proportional tests and explicit red/green/refactor evidence for every task and claim. | Test Plan plus task/test traceability. |
| 7. Validate External Plan | Where configured, independently challenge the implementation plan. | Provider reviews, findings matrix, actions, and final passes. |
| 8. Validate External Test Plan | Where configured, independently challenge coverage and test design. | Provider reviews, findings matrix, actions, and final passes. |
| FitCheck | On resume or immediately before Build, check drift in code, standards, dependencies, and plan assumptions. | FitCheck report and any repaired plan evidence. |
| 9. Build | Implement task contracts after explicit human approval, using leases and red/green/refactor. | Per-task narrative reports and machine-verifiable evidence JSON. |
| 10. Standards Sweep | Verify the actual change against every binding project standard. | Standards report with no unresolved mandatory failures. |
| 11. Test Execute | Run the planned suites and preserve outcomes. | Test execution report and captured output. |
| 12. Validate External Code | Where configured, independently review the final change. | Provider reviews, findings matrix, actions, and final passes. |
| 13. Delivery | Integrate task branches, run post-merge checks, prepare human walkthrough, and prove done. | Delivery checklist, task completion, and QA walkthrough. |
| Manual QA | Let a human validate the real outcome. | Explicit durable approval or a return to corrective work. |
| 14. Retro | Learn from the whole cycle and improve project knowledge and pipeline assets. | Retrospective, metrics, curated knowledge, and owned improvements. |

## Conditional paths

- Use shelf mode to stop after validated planning; resume only through FitCheck.
- Escalate when evidence cannot resolve a consequential choice. Persist the question and exact recovery point.
- Recover interrupted work from intent Markdown, intent JSON, delivery state, task evidence, and SQLite; never from chat memory.
- Route a new idea or discovered gap through Intent shaping before delivery.
- Where several intents share a product outcome, preserve their dependency and sequencing relationships rather than collapsing them into one oversized intent.
