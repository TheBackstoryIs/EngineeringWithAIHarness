# Accept changes to EWAI evidence-depth behaviour

This is feature acceptance for **EWAI maintainers**, not a requirement for every application team running Archaeology. Use a disposable, privacy-safe fixture. The [operator checklist](../quality/reproducible-archaeology-depth-review-checklist.md) covers reviewing an ordinary investigation.

## Demonstrate reproducibility

For formal Manual QA, use the same repository revision and owner declarations in
at least three clean sessions:

- [ ] Record the project revision, Source Map run, provider capability, installed persona tiers, and session condition.
- [ ] Confirm all seven dimensions and their material coverage are equivalent.
- [ ] Confirm stable gap IDs agree when their structured evidence is unchanged.
- [ ] Compare the reviewed runs.
- [ ] Confirm changes are explained in causal order: inputs, evidence, personas, depth, coverage, gaps, then grouping.
- [ ] Treat wording and ordering differences as non-material when structured evidence agrees.
- [ ] Treat a gap or coverage change without an upstream cause as unexplained variance and investigate it.
- [ ] When testing grouping, change only the grouping strategy and confirm gap identity remains stable.



## Check the interface

At desktop width and 390 px:

- [ ] Open Guided Setup and expand **Depth and evidence** with the keyboard.
- [ ] Reach every selector, reviewer field, grouping field, and comparison control in a logical order.
- [ ] Confirm keyboard focus is visible and status does not depend on colour alone.
- [ ] Confirm dimension coverage, recommendation, selection, and active personas remain readable without horizontal page scrolling.
- [ ] Confirm the fallback Design System is labelled as not organisation-approved when no approved pack applies.
- [ ] Confirm advisory and authority notices remain visible.
- [ ] Ask an owner to explain why each deep dimension is deep and why each active persona is present.

## Stop conditions

Do not approve Manual QA while any of these conditions remains:

- stale or missing Source Map evidence;
- unexplained comparison variance;
- an unassigned stable gap;
- a depth reduction without accountable rationale;
- a hidden analysis failure, exclusion, contradiction, or unknown surface;
- a persona presented as stakeholder confirmation or approval;
- materially weaker engineering coverage than the known-good route;
- inaccessible or unusable controls in a required viewport;
- unresolved owner concern about missing or disproportionate content.

## Evidence to retain

- named participants and roles;
- date, project revision, and safe Source Map run ID;
- safe reviewed-run IDs and comparison outcome;
- selected depths and reduction rationale;
- persona identities, tiers, and engagement reasons;
- content-quality ratings and owner comments;
- viewport, keyboard, and accessibility observations;
- screenshots that contain no sensitive information;
- defects, corrective action, and retest evidence;
- final pass or fail decision made through the canonical Manual QA operation.

Do not describe this evidence as security certification, policy compliance,
production readiness, deployment approval, or release acceptance.

## Related guidance

- [Reproducible Archaeology and Discovery Depth](../reproducible-archaeology-and-discovery-depth.md)
- [Worked example](../examples/reproducible-archaeology-depth-example.md)
- [Repository Source Map](../repository-source-map-guide.md)
- [Guided Discovery facilitator guide](../guided-discovery-facilitator-guide.md)
- [Manual QA and acceptance](../quality/manual-qa-and-acceptance.md)


Keep feature acceptance and a project's investigation review separately labelled. A successful fixture run doesn't establish the quality of every real investigation.
