# How delivery moves through fourteen stages

Ask EWAI to work through a feature with you. The **ewai-deliver** skill coordinates specialist skills and follows the saved project state. The runtime checks whether the required evidence and approvals exist; people remain responsible for requirements, trade-offs, Build approval and acceptance.

The CLI command `delivery continue` tells you what can happen next. It doesn't execute an entire stage. The host uses that result to continue the conversation and work.

## One feature through the workflow

This fictional example is a CSV export of a filtered support-ticket list. It illustrates the stages; it isn't evidence that any implementation or review has happened.

| Stage | What it means for this feature |
| --- | --- |
| 1. Ideate — conditional | Establish who needs an export and what they'll do with it, if the initial idea needs shaping. |
| 2. Intent | Agree columns, filters, permissions, excluded data and acceptance criteria. A draft can begin; the intent must be ready before this stage finishes. |
| 3. Reconcile — conditional | Check existing filtering and permissions so the export doesn't invent different rules. |
| 4. Plan | Agree implementation slices, interfaces, dependencies, test approach and stop conditions. |
| 5. Pattern Validation | Check the proposal against the application's existing patterns and accepted standards. |
| 6. Test Plan | Specify evidence for correct rows, denied access, empty data and applicable CSV safety cases. |
| 7. External Plan Validation — provider-gated | Have an eligible, configured independent reviewer challenge the plan. |
| 8. External Test Validation — provider-gated | Have an independent reviewer challenge the proposed tests. |
| 9. Build — explicit approval | Implement the approved export slices and preserve unrelated work. |
| 10. Standards Sweep | Check the completed change against the project's accepted standards. This is required even without an external reviewer. |
| 11. Test Execute | Run the planned checks and record their actual results. Preparing a test isn't passing it. |
| 12. External Code Validation — provider-gated | Obtain independent implementation review where a configured provider is available. |
| 13. Delivery | Prepare the handoff, limitations, release evidence and a walkthrough a person can perform. |
| 14. Retro — after Manual QA | Capture learning after human acceptance and route reviewed improvements into reusable knowledge. |

Ideate and Reconcile depend on the work. External-review stages are recorded as `not-supported` when no eligible independent provider is configured; that isn't a pass. The active orchestrator isn't its own independent reviewer.

## Decisions around the numbered stages

**UI Design**, after Reconcile when interface work is in scope, lets you explore and select an interaction before Build. Prototype selection isn't acceptance of the implementation.

**Build approval**, before stage 9, authorises a defined scope. Agreeing the idea or selecting a prototype doesn't grant it.

**Fit Check**, before Build when resuming a shelved plan, tests whether the earlier plan still fits current requirements, code and constraints. If it doesn't, revise the affected work.

**Manual QA**, after Delivery and before Retro, records a named person's observations and acceptance. Automated checks don't substitute for this.

**Release** requires its own appropriate authority and evidence. A successful command or completed delivery record doesn't grant deployment permission.

## Pause, resume or change direction

EWAI saves the intent and phase evidence in SPECS. Ask it to show what's complete, what's blocked and what decision it needs. Use the guarded resume route for shelved work; don't change a status file or database row to skip a check.

If the outcome changes materially, revisit the intent and plan. A new Build approval may be needed. If only an evidence reference needs a correction, follow the [amendment guide](../completed-phase-evidence-amendments.md), which explains the narrow permitted operations.

Try the [first-delivery tutorial](../tutorials/first-delivery.md). For exact commands and evidence contracts, use the [developer delivery guide](../developer-delivery-guide.md).
