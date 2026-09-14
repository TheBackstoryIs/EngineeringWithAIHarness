# Review an Archaeology and Discovery depth run

Use this checklist when preparing and reviewing an investigation in your project. It complements the general
[Manual QA and acceptance guide](manual-qa-and-acceptance.md); it does not replace
the canonical EWAI approval operation.

## Roles

Name the people performing each role before starting:

| Role | Responsibility |
| --- | --- |
| Operator or facilitator | Prepares the workspace, preserves evidence limitations, and guides the review. |
| Product or business owner | Confirms purpose, intended outcomes, users, and proportionate product depth. |
| Technical owner | Challenges repository, architecture, delivery, security, and operational interpretation. |
| Accountable reviewer | Selects depth, records rationale and assigns a reviewed outcome to every gap. Manual QA is a separate decision where applicable. |

One person may perform more than one role when that reflects the project, but the
record must not disguise which decisions lacked independent or specialist review.
Personas advise these people; they do not occupy these roles.

## Before preparing a run

- [ ] Confirm `.ewai-pipeline/project.json` points to the intended project and SPECS root.
- [ ] Record the repository revision and the configured repository topology.
- [ ] Capture a human project briefing: purpose, users, desired outcomes, business context, constraints, and prohibited assumptions.
- [ ] Refresh the Source Map.
- [ ] Inspect `analysis_failed`, `inventory_only`, `skipped_sensitive`, `skipped_oversized`, and excluded surfaces.
- [ ] Confirm applicable project, stack, technology, and Organisation Blueprint Packs.
- [ ] Confirm the provider capability being used.
- [ ] Record which persona tiers are available; do not install or update premium personas as a side effect of this review.
- [ ] Keep secrets, absolute paths, source bodies, prompts, managed persona content, and free-text owner answers out of bounded review inputs.

Stop if the Source Map is missing or stale. Refresh it rather than accepting a
recommendation against an unknown repository state.

## Prepare and inspect

- [ ] Prepare evidence depth in Guided Setup, with the CLI, or through the MCP tool.
- [ ] Confirm architecture, data, security, product, delivery, governance, and operations appear exactly once.
- [ ] For each dimension, inspect coverage, recommendation, drivers, evidence references, and active personas.
- [ ] Confirm active personas change with the concern rather than accumulating across the review.
- [ ] Confirm each persona displays its identity, tier, and reason for engagement.
- [ ] Confirm core and project personas provide a complete path when premium personas are absent.
- [ ] Review stable gaps separately from generated questions and proposed grouping.
- [ ] Preserve contradictory owner and repository evidence rather than choosing the convenient version silently.
- [ ] Ask only the material questions needed to resolve or explicitly retain a gap.

## Record the named review

- [ ] Name the accountable reviewer.
- [ ] Select `bounded`, `standard`, or `deep` independently for all seven dimensions.
- [ ] Add substantive rationale whenever selecting less depth than recommended.
- [ ] Assign every stable gap to one group exactly once.
- [ ] Give every gap an explicit disposition: owned, shared, deferred, or excluded.
- [ ] Confirm grouping describes work organisation and does not alter stable gap identity.
- [ ] Record the review against the current preparation digest.
- [ ] Retain the immutable run ID and content digest without copying sensitive source material into the QA record.

If another preparation supersedes the reviewed digest, repeat the named review.
Do not force an older decision onto new evidence.

## Assess content quality

Structural reproducibility alone is not sufficient. Ask the named product and
technical owners to rate:

- [ ] whether any material concern is missing;
- [ ] whether questions are duplicated, irrelevant, or disproportionate;
- [ ] whether every conclusion can be traced to safe evidence references;
- [ ] whether the selected depth fits the intended change and risk;
- [ ] whether failed, excluded, contradictory, or unknown evidence remains visible;
- [ ] whether the next action for each gap is understandable and owned;
- [ ] whether the process performs at least as well as the previous unconstrained route on engineering coverage.

Record the ratings and rationale. A faster or lower-token run fails this review if
it weakens material engineering understanding.

## Retain the investigation decision

Save the reviewed run ID, selected depths, rationale for reductions, gap owners, unresolved limitations and named review. Don't describe uninvestigated areas as complete. If preparation changes, obtain a fresh review against the new digest.

An ordinary investigation doesn't require three clean sessions or interface testing at 390 px. Those checks belong to [accepting changes to EWAI itself](../maintainers/evidence-depth-acceptance.md). They remain required when that feature acceptance is the task.

## Related guidance

- [Reproducible Archaeology and Discovery Depth](../reproducible-archaeology-and-discovery-depth.md)
- [Worked example](../examples/reproducible-archaeology-depth-example.md)
- [Manual QA and acceptance](manual-qa-and-acceptance.md)
