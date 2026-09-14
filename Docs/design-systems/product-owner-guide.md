# Product owner guide to EWAI design systems

A design system helps you make the intended product experience repeatable. It is broader than visual tokens and components: it can capture the experience promise, product principles, interaction behaviour, content, meaningful states, responsiveness, accessibility, motion, prohibited patterns, and how work should be reviewed.

## Decisions you own

Start by asking EWAI to use your existing design guidance, or to help you capture it with `$ewai-design-system-author`. For example, show it the approved account page and explain that forms must use your existing components, errors must explain how to recover, and layouts must work on a phone. Review the proposed guidance before selecting it for the project. See the [user guide](design-system-user-guide.md) for selection and application.

When that guidance is applied to a delivery, EWAI saves a **receipt**: a record of the exact guidance used. You can compare the prototype with that record later, even if the shared design system has changed.

Product and design owners should decide:

- whether the bundled fallback is sufficient for early work or a project design system should be selected;
- which owner-declared principles are genuinely authoritative;
- how conflicts between observed product behaviour, research, stakeholder expectations, and inferred guidance are resolved;
- which guidance is mandatory and which can vary by surface;
- whether a delivery-local difference is an intentional approved deviation;
- whether repeated learning should be proposed for a future pack version;
- whether the completed experience passes Manual QA and is ready for the next release decision.

An Organisation Blueprint can recommend a design-system pack for a type of project. It does not make these decisions for you.

A changed digest means the guidance differs from the version you reviewed. It doesn't mean “better” or “worse”. Ask to see the changed rules and affected screens before accepting a new version; don't approve an unexplained hash.

## What you will see

During authoring and application, EWAI shows the actively engaged personas and why each is relevant. Project-local personas can preserve knowledge specific to your organisation or product; personal personas can add an individual working lens; installed premium personas can deepen specialist critique. They are advisors, not stakeholders, and premium access is never required for the basic workflow.

During application, you will see:

- whether EWAI used your selected design system or its bundled fallback;
- a digest identifying the exact resolved guidance;
- which guidance was included or left for later, and why;
- active personas and tiers;
- whether mandatory guidance exceeded the context budget;
- an immutable receipt for the prototype.

During review, findings are `aligned`, `approved-deviation`, or `unresolved`. Only use `approved-deviation` when a named accountable owner has already recorded that decision.

## Questions to ask

- Does this experience promise describe the outcome we want users to feel and achieve?
- Are important entry points, empty states, errors, recovery, and completion states covered?
- Are we preserving existing authoritative components instead of recreating inconsistent alternatives?
- Which user groups or contexts are absent from our evidence?
- Did anyone actually inspect the rendered viewport, interactions, keyboard path, and assistive-technology behaviour?
- Is a proposed exception truly local, or evidence that the design system should evolve?

Application receipts and persona reviews improve traceability, but do not approve Build, visual quality, accessibility, Manual QA, publication, deployment, or release. Keep those human decisions explicit.
