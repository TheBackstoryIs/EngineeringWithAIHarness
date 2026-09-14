# Work through your first feature

Follow one fictional feature from a rough request to a reviewed delivery: **export the filtered support-ticket list as CSV**. This is a guided exercise, not a claim that the commands below generate a finished application.

Start with [your first session](first-session.md). To implement an export, you'll need a small working ticket-list application; otherwise use the exercise to plan the feature and stop before Build. You and EWAI must inspect the actual stack and existing behaviour before choosing code or tests.

## Ask for an outcome

In your AI host, say:

> “We need support colleagues to export the filtered ticket list as a CSV. Work through the intent with us using ewai-deliver. Stop before implementation so we can review the plan.”

The **ewai-deliver skill** coordinates the stages. The runtime records progress and checks the evidence; it doesn't replace the conversation or make your decisions.

A draft intent can start this workflow. Before the Intent stage finishes, agree who can export, which filters and columns apply, which data must be excluded, and how you'll recognise a correct result. Don't treat an AI suggestion as an agreed requirement.

For example, you might agree that an authorised colleague can export the filtered rows while a colleague without export permission cannot. Those are tutorial choices: the people responsible for a real project must choose its rules.

## Find the saved work

Ask EWAI for the intent's identifier and location. An identifier such as `support/export-filtered-tickets` identifies one item; use the identifier actually returned for your project.

You can inspect the next step directly:

```bash
ewai delivery continue support/export-filtered-tickets --project .
```

This command **reports the next permitted step** for an existing delivery. It doesn't make the assistant perform that step. Ask the host to continue the work.

At each review, open the linked evidence in SPECS. You should be able to see what was agreed, what remains uncertain and why the next action is allowed or blocked.

## Work through the plan

Follow [the fourteen-stage explanation](../explanation/delivery-workflow.md) alongside the conversation. For this feature, the important questions include:

- Does export use the same filters and permissions as the screen?
- Which fields could expose data the recipient shouldn't receive?
- What happens with no matching rows or an export request that fails?
- Does the proposed implementation fit this application's patterns?
- Which checks require a person, rather than an automated test?

Where interface work is needed, review and select a prototype during UI Design. Selecting it isn't permission to implement it or acceptance of the finished feature.

EWAI prepares test expectations from the accepted requirements. Check that the tests prove the behaviour you agreed, rather than a new assumption. If an independent reviewer isn't available, the relevant external stage remains `not-supported`; a host's review of its own work isn't independent validation. The standards sweep still applies.

## Pause without losing the plan

If you want to plan now and build later, ask for shelf mode **when starting the delivery**:

> “Prepare the export feature in shelf mode. We'll review it before Build.”

When returning to that shelved work, ask EWAI to resume it. EWAI performs a **Fit Check** before Build to establish whether the plan still fits the project. A changed permission model, dependency or requirement may require a revised plan rather than immediate implementation.

For any ordinary pause, return to the same project and ask where the saved work stands. Don't rewrite delivery-state files to force progress.

## Approve a bounded implementation

Only approve Build when you're satisfied with the proposed scope and evidence. For example:

> “We approve implementing the filtered CSV export described in this plan, including the permission checks and planned tests. Don't add scheduled exports or change other permissions.”

That approval applies to the agreed work, not every improvement discovered during implementation. EWAI records it before Build can begin. The [delivery guide](../developer-delivery-guide.md#preserve-the-build-approval-boundary) explains the direct approval command.

During Build, inspect the actual changes and tests. A failing check needs an explanation and a fix within scope—or a new decision—not a rewritten result. Your unrelated edits remain outside the approved change.

## Try the failure case as well as the success

In the implemented example, an authorised colleague should receive only the accepted filtered columns and rows. Also try the agreed denied-access case.

If a colleague without export permission can download the file, the feature hasn't passed that acceptance check, even if the happy path works. Record what happened and ask EWAI to trace the failure against the accepted requirement. Don't mark Manual QA approved while that requirement is failing.

Test data and permissions must be safe and fictional. Don't use a real customer's records to prove this exercise.

## Finish with a human decision

After automated checks and configured reviews, Delivery provides the changes, results, known limits and a **Manual QA walkthrough**. A named person performs or accepts that walkthrough and records the observed result. The assistant can't supply human acceptance on their behalf.

Retro follows Manual QA and captures reusable learning—for example, a missing CSV safety test or a useful export pattern. Completing Delivery or Retro doesn't itself authorise deploying the application.

**Your result:** a traceable feature whose requirements, decisions, implementation, tests and acceptance can be inspected. If you stopped at planning, the result is a reviewed plan, not a delivered feature.

Next: [developer delivery operations](../developer-delivery-guide.md), [human approval](../human-approval-and-assurance-guide.md), or [recovery when a step is blocked](../operations/troubleshooting-and-recovery.md).
