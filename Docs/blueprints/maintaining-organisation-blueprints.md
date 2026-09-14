# Maintaining Organisation Blueprints

Use this guide after an Organisation Blueprint Pack is in use by one or more projects.

## The maintenance contract

A Blueprint is a versioned input to project decisions. Its owner may publish improvements, but each project retains its accepted materialised files, receipt, pin, and adoption authority.

Upstream maintenance must never silently rewrite project truth.

## Assign ownership

Recommended practice is to name:

- a publisher owner accountable for the pack;
- subject-matter owners for each standard and persona template;
- a technical maintainer for schema, compatibility, dependencies, and tests;
- a governance approver for breaking or policy-significant changes;
- a communication owner for release notes and deprecation.

Record ownership in the catalogue or repository documentation. Do not add undeclared governance fields to the strict V1 manifest.

## Version deliberately

Use semantic-versioning intent:

| Change | Suggested version effect |
| --- | --- |
| Clarification with no changed obligation | Patch |
| New optional module or backward-compatible guidance | Minor |
| Changed mandatory standard or policy outcome, removed module, renamed identity, or incompatible structure | Major |

The schema accepts a version string, but EWAI cannot decide the organisational significance of the change. The publisher owns that judgement.

## Keep identity stable

Avoid changing the publisher-scoped pack ID. Consumers and dependency declarations use it as the stable identity. A rename should normally be treated as a new pack with an explicit migration and deprecation notice.

Keep module IDs stable as well. If a module's purpose changes materially, introduce a new module rather than preserving an ID that now means something different.

## Review changes by consequence

For every release, compare:

- required and optional module membership;
- standard wording and obligation strength;
- persona mission, metadata, questions, and authority boundary;
- policy provenance, rule match conditions, outcomes, controls, review roles, exception posture, and unmatched outcome;
- boilerplate metadata and integrity value;
- required pack IDs and the installed dependency versions;
- EWAI compatibility;
- resolved digest for representative selections;
- generated project destinations and collision risk.

Review the resolved pack, not only the manifest diff. A dependency change can alter outcomes without a large root-manifest edit.

## Maintain policy contributions as governed inputs

Treat Organisation Policy Design Gates as versioned design inputs, not as mutable organisation-wide switches. For every policy contribution change:

- retain an accountable policy owner and recognisable source provenance;
- validate the strict, closed rule vocabulary and data-only boundary;
- review changed rule precedence, outcomes, controls, review roles, exception permissions, and unmatched posture;
- publish a new immutable pack version and explain which project designs may be affected;
- test representative facts against both the previous and proposed policy versions;
- preserve the previous source long enough to interpret accepted project evidence.

Changing an upstream policy or Blueprint may mark an accepted project baseline stale, but it must never rewrite that baseline. Each project reopens the preview and a named person approves a new exact effective digest. A project with no approved contribution remains explicitly `not-configured` and non-blocking; maintenance does not create a hidden default.

Policy maintenance also does not install or update premium personas. Installed premium personas can deepen the questions asked during policy analysis, while core and project personas remain a complete baseline; neither persona type changes deterministic rule outcomes or human approval authority.

Use the [Policy Pack Authoring Guide](../policies/policy-pack-authoring-guide.md) to validate contribution structure and the [Governance Owner Guide](../policies/governance-owner-guide.md) to review baseline, review-role, and exception decisions.

> Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Test representative combinations

Maintain fixtures for:

- required modules only;
- each optional module individually;
- supported combinations of optional modules;
- dependency chains;
- the oldest and newest supported EWAI versions where practical;
- collision and unsafe-path rejection;
- total-size and recursion boundaries;
- expected materialised standards, personas, receipts, and pins.

Use a temporary project for approval-flow tests. Do not apply a maintenance candidate directly to a live project merely to see what happens.

## Publish useful release notes

Include:

- pack ID and version;
- release date and owner;
- change classification;
- affected modules and dependencies;
- changed obligations or persona perspectives;
- expected digest changes;
- compatibility changes;
- required consumer action;
- migration and rollback guidance;
- deprecation dates.

The manifest remains strict, so keep this information in adjacent repository or catalogue records.

## Deprecate safely

Recommended practice:

1. stop recommending the deprecated version to new projects;
2. publish the supported replacement and migration difference;
3. retain the old source long enough to interpret existing receipts and pins;
4. notify known project owners;
5. allow projects to review and schedule adoption;
6. record exceptions for projects that must remain pinned;
7. remove distribution only after the retention decision is explicit.

Deprecation is not permission to delete project-owned materialised standards or personas.

## Respond to a security or policy correction

For an urgent correction:

- publish a new immutable version;
- identify affected versions and modules;
- describe impact and required action without exposing exploit details unnecessarily;
- provide a bounded comparison and recovery route;
- notify project owners through the organisation's approved channel;
- require each affected project to record its adoption or risk decision;
- retain evidence of the response.

Do not overwrite a previously published version in place. Existing digests and approval evidence must remain interpretable.

## Maintenance checklist

- [ ] Ownership and subject-matter review are current.
- [ ] Identity and module semantics remain stable.
- [ ] Version reflects consequence, not file count.
- [ ] Required and optional combinations were tested.
- [ ] Dependencies and compatibility were resolved.
- [ ] Release notes explain project action.
- [ ] Previous receipts and pins remain interpretable.
- [ ] No project is silently upgraded.

## Related guides

- [Blueprint validation and troubleshooting](validation-and-troubleshooting.md)
- [Internal Blueprint catalogue](internal-blueprint-catalogue.md)
- [Policy Pack Authoring Guide](../policies/policy-pack-authoring-guide.md)
- [Governance Owner Guide to Policy Design Gates](../policies/governance-owner-guide.md)
- [Organisation rollout](../organisation-rollout-guide.md)
- [Human approval and assurance](../human-approval-and-assurance-guide.md)
