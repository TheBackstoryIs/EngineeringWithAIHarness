# Persona engagement UI guide

This is an implementation and design guide for teams presenting EWAI's active personas in Guided Discovery, Blast Radius or another conversational surface. The response fields below describe the current contract. The later presentation and interaction sections are design recommendations, not a claim that every EWAI screen already provides those controls. For everyday use, see [Working with personas](../working-with-personas.md).

## The user question the UI must answer

At any moment, a participant should be able to answer:

> Which perspectives are influencing this conversation, where did they come from, and why are they relevant now?

Visibility is not decoration. It helps participants challenge missing, irrelevant, or overrepresented perspectives.

## Current response contract

Guided Discovery returns active personas with:

- `id`;
- `name`;
- `tier`;
- `category`;
- a bounded description;
- `matchedSignals`;
- `engagementReason`.

The response also states that guidance is advisory and human evidence takes priority. The ensemble can change by section, answer context, or proposed-change evidence, with up to four relevant personas selected.

Persona-driven test preparation uses the same safe ensemble contract. Its dashboard [coverage loom](../quality/persona-driven-test-scenarios.md) keeps source, persona concern, and proof route visibly separate.

## Minimum visible treatment

For each active persona, display:

1. **Name** as the primary label.
2. **Tier/source** as provenance, not status or authority.
3. **Engagement reason** in plain language.
4. **Matched concerns** when the user wants more detail.

Also provide an explicit empty state when no persona matches. Do not silently fall back to implying that an unnamed generic expert is active.

## Show change over time

When the section or evidence changes:

- identify personas that joined;
- identify personas that left;
- explain the new concern that caused the change;
- retain access to the current ensemble without interrupting the main task.

Recommended practice is a compact persistent summary with an expandable detail panel. Avoid a constantly animating “agent conversation” that distracts from the human discussion.

## Language to use

Prefer:

- “Active perspectives”;
- “Engaged because…”;
- “Matched concerns”;
- “Advisory”;
- “Project”, “premium”, “personal”, or “core” source.

Avoid:

- “Decision-makers”;
- “Approvers”;
- “The user says…” when no real user spoke;
- “Verified expert” unless a separate assurance process defines that claim;
- authority implied by a paid or higher-precedence tier.

## Interaction states

| State | UI response |
| --- | --- |
| Loading | Preserve the prior confirmed ensemble and say a new selection is being evaluated. |
| Active | Show name, tier, reason, and optional matched concerns. |
| No match | Explain that no installed persona matched; invite review of missing perspectives. |
| Parse problem | Exclude the unsafe definition and link to persona troubleshooting. |
| Premium unavailable | State that the managed library is not installed or accessible; do not prompt an automatic download. |
| Changed draft revision | Preserve entered work and ask the user to reconcile the newer revision. |

## Allow challenge without pretending to configure authority

Useful actions include:

- “Why is this persona active?”
- “What evidence is this question based on?”
- “This perspective is not relevant.”
- “A stakeholder perspective is missing.”
- “Open persona details.”

If the current product does not support manual pinning or exclusion, present these as feedback or follow-up actions rather than controls that appear to have changed the resolver.

## Accessibility

- Do not encode tiers or active/inactive state by colour alone.
- Make change announcements available to assistive technology without repeatedly stealing focus.
- Keep reasons concise and expandable.
- Support keyboard inspection of every persona.
- Use readable source labels rather than unexplained icons.
- Preserve the active ensemble when zoomed or reflowed.

## Privacy and content boundaries

Do not expose proprietary persona bodies merely to explain selection. Public metadata, matched concerns, and the generated reason are sufficient for the active summary.

Do not display filesystem paths to ordinary participants. Maintainer diagnostics may expose a local path in a separate technical view with appropriate access.

## Acceptance checklist

- [ ] Active personas remain visible throughout each section.
- [ ] Name, tier, reason, and matched concerns are available.
- [ ] Tier is presented as provenance, not authority.
- [ ] Join/leave changes are understandable.
- [ ] No-match and unavailable-premium states are honest.
- [ ] Advisory and human-evidence boundaries are visible.
- [ ] The UI does not expose managed persona content.
- [ ] Keyboard, screen-reader, zoom, and colour-independent use were checked.

## Related guides

- [Working with personas](../working-with-personas.md)
- [Guided Discovery facilitator guide](../guided-discovery-facilitator-guide.md)
- [Blast Radius and Impact Routing](../blast-radius-and-impact-routing-guide.md)
- [Persona-driven test scenarios](../quality/persona-driven-test-scenarios.md)
- [Persona authoring cookbook](persona-authoring-cookbook.md)

## Current contract sources

- `src/runtime/guided-discovery.mjs`
- `src/runtime/impact-analysis.mjs`
- `src/runtime/persona-engagement.mjs`
- `src/runtime/dashboard-server.mjs`
- `tests/guided-discovery.test.mjs`
- `tests/impact-analysis.test.mjs`
