# Technical Owner Guide to Policy Design Gates

Check which version of your organisation's rules the design was assessed against, which controls are needed, and where the delivery plan addresses them. Use the technical policy view to inspect those links and resolve gaps before Build.

> Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Before you start

In an initialised project's dashboard, open **Configuration**, enable **Policy Gates** and choose **Save changes**. An existing intent and an approved policy baseline are needed for an assessment. If the view reports `not-configured`, use [policy setup](organisation-policy-design-gates.md) to review and adopt an applicable baseline with the owner; the visibility setting doesn't install policy or waive any requirements. [Dashboard configuration](../operations/dashboard-configuration.md) explains the navigation controls.

## Inspect the current assessment

Open **Policy gates**, choose the intent, and switch to the **Technical** view. Check the policy digest, facts digest, evaluation digest, matched rules, required reviews, and controls. The business and technical views must reference the same intent and outcome.

Use `ewai policy status <domain/slug> --mode technical --project . --json` or `ewai_policy_status` when working through a terminal or agent host.

## Inspect the control trace into delivery

Every control must resolve through an allowed route:

- a Claim Ledger claim with implementation evidence;
- a task that owns the change;
- an automated test with a stable oracle;
- a named-human check;
- a specialist review.

Plan should record the transitive evidence, not merely repeat the control text. Changing a cited claim, task, test, or evidence file invalidates the gate. Relevant Impact dimensions include actors, AI use, data, destinations, hosting, and integrations.

## Handle drift

Re-evaluate after a material intent revision, changed confirmed fact, new effective Blueprint digest, policy-relevant Impact change, or changed control evidence. Never edit an old evaluation or decision to make it current. Reviews and exceptions are immutable and bound to their original evaluation digest.

## Keep the runtime boundary clear

Application authentication, authorisation, data-loss prevention, API gateways, database permissions, model routing, monitoring, and runtime policy enforcement remain application and infrastructure responsibilities. EWAI can require evidence that these controls are designed and tested; it does not operate them.

Policy passage does not replace threat modelling, security scanners, performance evidence, operational readiness, Manual QA, deployment controls, or release approval.
