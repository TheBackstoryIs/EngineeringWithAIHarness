# Engineering With AI guides

Use these guides to get EWAI running, describe the work you want to do and take it through delivery. You don't need to read the whole library before starting.

Conversation is the normal way to work with EWAI. Describe what you need in your AI host; the skills help it choose the workflow, ask for missing information, and run the supporting commands. Command examples are available when you want direct control, but you don't have to learn them first. Your choices and approvals still guide the work.

For feature delivery, **`ewai-deliver` coordinates the full fourteen-stage workflow**, bringing in specialist skills as needed and resuming from the project's recorded state. You don't need to run each stage yourself. See the [delivery guide](developer-delivery-guide.md) for the stages and the decisions you'll be asked to make.

## New to EWAI?

1. [Install EWAI](operations/installation-updating-and-entitlements.md) and open it in your project folder.
2. For existing code, follow [existing-project onboarding](existing-project-onboarding-guide.md). EWAI will offer Archaeology to reconstruct missing documentation; you can decline it.
3. For a new project, follow [your first session](tutorials/first-session.md), then [your first delivery](tutorials/first-delivery.md).
4. Read [how the fourteen stages fit together](explanation/delivery-workflow.md) when you want to understand the process. [Core concepts](explanation/core-concepts.md) explains the terms as you need them.

The [Product Owner guide](product-owner-guide.md) covers deeper discovery and optional shared guidance. Bring the problem, examples and people who can help—not a finished technical specification.

If you have a persona licence, [set it up before the analysis](operations/premium-personas-setup.md) you want it to support. Premium personas are optional.

## What are you here to do?

| Your task | Start here |
| --- | --- |
| Describe a feature or improve an existing idea | [Use Intent Studio](guided-intent-workspace-guide.md) |
| Decide what to tackle next | [Use the Companion](context-aware-delivery-companion-user-guide.md) |
| Implement an agreed change | [Developer delivery guide](developer-delivery-guide.md) |
| Check that the result works for people | [Manual QA and acceptance](quality/manual-qa-and-acceptance.md) |

If you're contributing without an engineering background, use the [non-technical team guide](adoption/non-technical-team-guide.md). For examples of the wider workflow, see [worked examples](examples/worked-examples.md).

## Make the dashboard work for you

[Choose which views you need](operations/dashboard-configuration.md). Portfolio, Team Hub, policy tools and the other advanced views are optional and start hidden. Showing a view doesn't configure the service behind it; hiding one doesn't remove checks your project requires.

## Something isn't working?

Start with [troubleshooting and recovery](operations/troubleshooting-and-recovery.md). For a problem that needs support, [prepare a private error report](error-reporting-guide.md) and review it before sharing.

## Find a specialist guide

The [complete guide catalogue](guide-catalogue.md) separates everyday use, engineering, team administration and EWAI maintenance. It includes the command reference, pack authoring, policy setup, integrations and verification notes. Choose what fits your task; the catalogue isn't a checklist.

## A few boundaries worth knowing

- **SPECS keeps the project's agreed knowledge.** Runtime indexes can be rebuilt; don't use a database edit to change an intent or approval.
- **Personas help you think.** Their suggestions aren't evidence from real users or permission to build.
- **Review and approval are separate.** Tests and a promising prototype don't replace Build approval or human acceptance.
- **An installed pack isn't automatically suitable.** Review shared guidance before adopting it. Executable adapters need explicit registration and run with your operating-system permissions; they aren't OS-sandboxed.

If you're changing EWAI itself, start in the [maintainer section](guide-catalogue.md#maintaining-ewai), not the application delivery instructions.
