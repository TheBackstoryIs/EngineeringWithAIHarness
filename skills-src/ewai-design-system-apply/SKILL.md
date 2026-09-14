---
name: ewai-design-system-apply
description: Apply a resolved EWAI design system to an existing UI-bearing delivery through bounded context, visible contextual personas, and an immutable delivery receipt. Use during UI Design or Prototype work before selecting a runnable prototype, or when an existing design application must be re-prepared after focus or source changes.
---

# EWAI Design System Apply

Apply the project’s selected design system—or the clearly labelled bundled fallback—to one governed delivery. Read [the application contract](references/application-contract.md) before applying it.

## Workflow

1. Confirm the delivery exists and its UI Design adjunct is in scope. This skill does not create an intent, begin a delivery, or approve a phase.
2. Inspect `ewai design-system status --project PROJECT --json`. Stop when a selected system is stale. A fallback is usable guidance but remains visibly unapproved.
3. Describe the affected surface and current design focus. Keep it narrow enough for relevant context and personas to swap in.
4. Run `ewai design-system apply DELIVERY_SLUG --focus TEXT --project PROJECT --json`. Add `--budget TOKENS` only when the default budget is unsuitable.
5. Show the selected and deferred contributions and every active persona’s safe reference, name, tier, matched signals, and reason. Premium personas may enrich an installed catalogue, but the standard path must work without them and must never expose or persist their bodies.
6. If the result is `non-ready`, do not construct a model prompt or a receipt. Narrow the focus, explicitly increase the budget, or split the operation and run it again.
7. Use the returned digest-addressed receipt path, receipt digest, and effective design-system digest as the design-system section of `ewai.prototype-manifest/v3`.
8. Use `$ewai-prototype-iteration` to review the plan and produced design with independently selected relevant personas, then link the reviewed plan and final cycle in v3.
9. Select the runnable prototype only after the manifest validates. The receipt and persona review record influence and critique, not visual acceptance.

## Boundaries

- Never mutate the installed design-system pack while applying it.
- Never conceal fallback mode, deferred mandatory guidance, stale source content, or an unavailable premium tier.
- Never persist full contribution context, persona definitions, model prompts, credentials, or absolute source paths in a receipt.
- Never treat application, persona participation, a valid manifest, or static conformance as Build approval, Manual QA, accessibility certification, deviation approval, publication, deployment, or release.
