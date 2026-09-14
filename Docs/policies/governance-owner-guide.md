# Governance Owner Guide to Policy Design Gates

Use this guide when a proposed design needs your policy decision. Check which rule applies, which facts support the result and whether the required controls or an explicitly permitted exception address it. You own that decision; a persona can expose gaps but can't approve the policy review.

> Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Find the policy review

Open your project's dashboard, choose **Configuration**, enable **Policy Gates** and save. Open **Policy Gates** in the sidebar and select the relevant intent. The project must have adopted an approved policy baseline before it can assess that intent. If it reports `not-configured`, agree the baseline through [policy setup](organisation-policy-design-gates.md); turning the view on isn't approval or evidence that the design meets policy.

## Own the agreed rules

Review the source provenance, policy scope, unmatched outcome, rule precedence, review roles, controls, exception permissions, pack pins, and effective digest before approving a baseline. Approval accepts that exact project design baseline; it does not accept every future design.

Maintain source policy and Blueprint versions deliberately. When upstream material changes, EWAI reports drift and requires project review rather than silently updating accepted evidence.

## Perform a review

For `review-required`, inspect the matched facts, exact rule, evaluation digest, proposed design, control evidence, and limitations. Record your name, required role, decision, rationale, evidence, and any additional controls. A persona or model can prepare questions but cannot perform the review.

## Approve an exception

An exception exists only where the matched rule says it is permitted. Require:

- a named approver and accountable owner;
- a scope bounded by the rule and confirmed facts;
- a clear rationale;
- compensating controls;
- evidence references;
- a future expiry.

Do not use an exception to override a prohibited rule. Expired or stale exceptions do not pass the gate. A new decision requires a new evaluation rather than changing an immutable record.

## Assurance boundary

Treat the output as design evidence for governance review. Verify that source policy was interpreted correctly and that controls are proportionate. Certification, legal conclusions, residual-risk acceptance, business acceptance, Manual QA, deployment, and release remain separate named decisions.
