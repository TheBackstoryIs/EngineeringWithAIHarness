# Product Owner Guide to Policy Design Gates

Use the Policy gates workspace to understand how an intended feature relates to organisational policy before engineering begins.

> Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Before you open the view

Use an initialised EWAI project with the intent you want to review. In the dashboard, open **Configuration**, enable **Policy Gates**, choose **Save changes**, then open **Policy Gates** in the sidebar. See [dashboard configuration](../operations/dashboard-configuration.md) if you need help finding it.

Your project also needs an approved policy baseline: the rules contributed by an Organisation Blueprint and accepted in Guided Setup. If the view says `not-configured`, ask your technical or governance owner whether a baseline should be adopted. Showing the view doesn't create one, and no baseline means no policy assessment—not a compliance pass. You can continue ordinary EWAI work without this optional capability. [How policy setup works](organisation-policy-design-gates.md).

## Your part in the review

Describe the intended user outcome and the material facts honestly. Do not try to select values that produce a preferred result. A useful evaluation depends on knowing who acts, what they do, what data is involved, where it goes, whether AI participates, where the system is hosted, and which integrations or retention choices matter.

Open **Policy gates**, select the intent, and begin with the **Business** view. It shows the current outcome, whether design action is needed, and the next accountable route. The active personas panel shows which lenses are engaged, their tier, and engagement reason. Treat their questions as prompts for better discovery, not evidence from real users.

## Confirm design facts

Review every proposed fact and its provenance. Confirm or reject the whole set as a named person. If a model or persona proposed a fact, check it against an accepted intent, architecture record, data decision, policy source, or knowledgeable owner before confirmation.

Unknown is better than invented certainty. If an answer would materially change the design, keep it open and assign an owner.

## Read the result

- `allow` means the current design evidence has no policy blocker; it is not approval to Build or release.
- `allow-with-controls` means Plan must carry explicit safeguards and evidence routes.
- `review-required` means a specific named role must decide.
- `deny` means redesign unless that exact rule permits a bounded exception.
- `unassessed`, `stale`, or `invalid` means the evidence cannot support a passing decision.

Stay involved when a control affects the user journey, communications, consent, operating process, training, or acceptance criteria. Use the technical view with an engineer when you need to inspect the exact evidence binding.

## Example: the proposed AI destination changes

Suppose a feature was planned to process internal information within an approved environment, then the proposal changes to send it to an external AI service. Confirm the changed destination and data classification as new facts; don't keep using the earlier assessment.

Evaluate against the current baseline. Depending on those rules, the result may require a specialist review or controls, or deny the design. Ask the named owner to resolve that result before passing the proposal to Plan. An AI suggestion that the service is “safe” isn't that decision.

## Before handing to Plan

Check that the user journey still achieves its outcome, every visible control has an owner, human reviews are recorded, unresolved questions are not disguised as facts, and relevant personas have challenged the design. Policy passage remains separate from Build approval, Manual QA, specialist assurance, and release acceptance.
