# Building an internal Blueprint catalogue

Use this guide to make reviewed Organisation Blueprint Packs discoverable across teams without confusing catalogue trust with project approval.

## Current behaviour

EWAI discovers packs from supported local roots. An optional, organisation-operated [Team Hub resource registry](../team-hub-resource-registry-guide.md) can publish, inspect and install reusable resources by exact version and digest. It isn't a vendor-hosted marketplace, and installing a Blueprint doesn't approve it for a project.

The catalogue model below adds ownership, support and adoption guidance around those distribution routes.

## Catalogue responsibilities

An internal catalogue should answer:

- What is this pack for?
- Who publishes and supports it?
- Which projects or risk contexts should use it?
- Which versions are supported?
- What changed in each release?
- What compatibility and dependencies apply?
- Where is the reviewed source?
- How is provenance verified?
- How does a project request help or an exception?

It should not imply that listing equals suitability or approval.

## Keep catalogue metadata outside the manifest

The V1 organisation manifest is strict. Maintain catalogue-only information separately, for example:

| Catalogue field | Purpose |
| --- | --- |
| Display name and summary | Human discovery |
| Owner and support contact | Accountability |
| Status | Draft, pilot, supported, deprecated, or retired |
| Intended audience | Applicability guidance |
| Risk classification | Review depth expectation |
| Source repository and revision | Provenance |
| Supported versions | Maintenance promise |
| Release notes | Change interpretation |
| Adoption guidance | Required project action |
| Exception route | Governance handoff |
| Policy contribution summary | Required or optional module, publisher, version, provenance label, rule and role counts, outcomes, unmatched posture, and digest |

Do not add these as undeclared keys to `pack.yaml`.

## Trust levels

Recommended catalogue states:

- **Draft:** author-owned and not for project use.
- **Pilot:** reviewed for bounded trial projects.
- **Supported:** approved for the declared audience with named maintenance ownership.
- **Deprecated:** still interpretable but no longer recommended for new adoption.
- **Retired:** distribution removed after retention and migration decisions.

State the evidence required to move between levels. Avoid labels such as “certified” unless the organisation has defined exactly what certification means.

## Distribution model

Use an approved internal distribution route to place immutable pack versions into one of the supported local roots. The distribution process should verify:

- source repository and revision;
- expected publisher and pack identity;
- version immutability;
- content digest or release checksum;
- dependency availability;
- safe archive extraction and path boundaries;
- access controls for restricted content;
- audit record of who published and installed it.

EWAI's resolved digest is useful project evidence, but it is not itself a publisher signature. Use your normal software supply-chain controls for authenticity.

## Help teams choose

Catalogue search and descriptions should lead with context rather than technology names alone:

- user and data sensitivity;
- external or internal exposure;
- regulatory and assurance needs;
- delivery type and operational criticality;
- supported technology or architecture patterns;
- required organisational policy.

Guided Setup should still show the exact local pack identity, version, modules, dependencies, digest, and consequences before approval.

## Catalogue policy-bearing Blueprints without activating them

For a Blueprint that contributes Organisation Policy Design Gates, make the design impact visible before installation or selection. Catalogue metadata should identify:

- which required and optional modules contain policy contributions;
- publisher, version, source label, provenance kind, and immutable digest;
- policy, rule, control, and review-role counts;
- possible outcomes and the unmatched outcome;
- EWAI compatibility, support owner, and exception route;
- whether a newer policy version may require existing projects to re-review their baseline.

This metadata helps a team choose; it is not the policy source of truth and does not activate a baseline. Guided Setup must still resolve the installed content, show the exact effective digest and consequences, and obtain named project approval. If a project approves no policy contribution, its policy status remains `not-configured` and non-blocking.

Do not expose complete policy source documents, managed premium persona bodies, project-local personas, credentials, or confidential organisation detail in a general catalogue. Use access-controlled source and distribution routes where the contribution itself is restricted.

See [Organisation Policy Design Gates](../policies/organisation-policy-design-gates.md) for project status and workflow, and the [Governance Owner Guide](../policies/governance-owner-guide.md) for baseline and exception accountability.

> Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Prevent cross-project leakage

Keep reusable organisation knowledge separate from client- or project-specific facts. Before publishing, check that the pack contains no:

- client names or confidential requirements;
- credentials, endpoints, or internal secrets;
- project-specific user research presented as universal truth;
- copied managed persona content;
- machine-specific absolute paths;
- boilerplate that will be executed implicitly.

## Catalogue review cadence

Review each supported entry when:

- EWAI compatibility changes;
- a dependency is upgraded or retired;
- a policy or standard changes;
- a security issue affects included guidance or references;
- user feedback reveals ambiguous applicability;
- the named owner changes;
- the normal review interval expires.

## Catalogue checklist

- [ ] Pack source and publisher are verified.
- [ ] Catalogue metadata is separate from the strict manifest.
- [ ] Status and support promise are defined.
- [ ] Versioned releases are immutable and traceable.
- [ ] Distribution preserves local trust and path safety.
- [ ] Project choice still requires Review and named approval.
- [ ] Deprecation and exception routes are visible.
- [ ] No project or managed-library content leaked into the pack.

## Related guides

- [Designing Organisation Blueprint Packs](../designing-organisation-blueprint-packs.md)
- [Maintaining Organisation Blueprints](maintaining-organisation-blueprints.md)
- [Organisation Policy Design Gates](../policies/organisation-policy-design-gates.md)
- [Governance Owner Guide to Policy Design Gates](../policies/governance-owner-guide.md)
- [Consultancy and multi-project rollout](../adoption/consultancy-and-multi-project-rollout.md)
