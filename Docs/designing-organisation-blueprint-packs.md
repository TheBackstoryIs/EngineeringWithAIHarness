# Designing Organisation Blueprint Packs

An Organisation Blueprint Pack is a reviewed, reusable starting point for projects that share an organisation's engineering standards and perspectives. It is a strict local `ewai.pack/v1` manifest plus bounded Markdown content.

Use a blueprint to say, “projects of this kind begin with these defaults.” Do not use it to remove project-level Discovery or human approval.


<!-- editorial: contents -->
## On this page

- [Start with the smallest useful pack](#start-with-the-smallest-useful-pack)
- [What a pack can contain](#what-a-pack-can-contain)
- [Design the pack before writing YAML](#design-the-pack-before-writing-yaml)
- [Directory layout](#directory-layout)
- [Complete V1 manifest](#complete-v1-manifest)
- [Field rules](#field-rules)
- [Write standard content](#write-standard-content)
- [Write persona template content](#write-persona-template-content)
- [Add optional organisation policy contributions](#add-optional-organisation-policy-contributions)
- [Treat Starter Packs as governed receipts](#treat-starter-packs-as-governed-receipts)
- [Add dependencies carefully](#add-dependencies-carefully)
- [Install locally](#install-locally)
- [Know the trust and size boundaries](#know-the-trust-and-size-boundaries)
- [Understand digests](#understand-digests)
- [Review and approve in Guided Setup](#review-and-approve-in-guided-setup)
- [What approval creates](#what-approval-creates)
- [Version and publish responsibly](#version-and-publish-responsibly)
- [Troubleshooting](#troubleshooting)
- [Author checklist](#author-checklist)
- [Related guides](#related-guides)
- [Contract sources](#contract-sources)

## Start with the smallest useful pack

Choose one reviewed standard, persona or policy that several projects genuinely need. Give it an owner, add it to one module, then validate the full Blueprint in a disposable project before adoption. The [policy-only example](policies/policy-pack-authoring-guide.md#add-it-to-a-blueprint) shows a complete small manifest and source file.

Use [local installation](#install-locally) and [Guided Setup review](#review-and-approve-in-guided-setup) to try it. Dependencies, starters and optional modules are available when needed; they aren't fields you must populate with invented content.

## What a pack can contain

Each module contains zero or more of:

- **Standards** — Markdown guidance materialised into project-owned SPECS after approval.
- **Persona templates** — Markdown perspectives materialised as project personas after approval.
- **Organisation policy contributions** — strict, declarative, data-only rules resolved into an optional project design-gate baseline after named approval.
- **Governed Starter Packs** — provenance-bearing, target-aware receipts materialised only through an explicitly registered adapter, independent staged-tree verification, immutable preview, and named approval.

A module is either required or optional. Required modules always apply. A participant can select declared optional modules on the root pack during Guided Setup.

## Design the pack before writing YAML

Start with four decisions:

1. **Publisher identity.** Choose a stable lowercase slug, such as `northstar`. It becomes part of every pack ID and materialised persona ID.
2. **Pack boundary.** Group defaults that should version and be reviewed together. Prefer a focused `engineering`, `data-platform`, or `regulated-delivery` pack over a catalogue of everything the organisation knows.
3. **Module boundary.** Put unavoidable baseline requirements in required modules. Put genuinely situational concerns in optional modules.
4. **Ownership.** Name the people accountable for each standard, persona template, dependency, and Governed Starter Pack outside the manifest in your normal review process.

Do not make a rule required merely because it is popular. A required module becomes project truth when the blueprint is approved.

## Directory layout

Every discovered pack has a `pack.yaml`. Standard, persona, and policy `source` values are paths relative to that file.

```text
org-northstar-engineering/
├── pack.yaml
├── standards/
│   ├── api.md
│   └── release.md
├── personas/
│   └── api-governance-lead.md
└── policies/
    └── data-handling.yaml
```

Starter sources do not point to local pack content. They are source references accompanied by an independently verified version, aggregate logical-tree digest, licence, compatibility statement, and target roles.

## Complete V1 manifest

This example uses every supported item type and both module modes:

```yaml
schema: ewai.pack/v1
id: org.northstar.engineering
name: Northstar Engineering Baseline
description: Reviewed engineering conventions for Northstar projects.
version: 1.2.0
type: organisation
requires: []
blueprint:
  publisher:
    id: northstar
    name: Northstar Digital
  compatibility:
    ewai: 0.x
  modules:
    - id: api-conventions
      name: API conventions
      description: Authentication, endpoint, and error-handling rules.
      required: true
      standards:
        - id: api-contract
          title: API contract
          source: standards/api.md
      personas:
        - id: api-governance-lead
          name: API Governance Lead
          source: personas/api-governance-lead.md
      policies:
        - id: data-handling
          title: Data handling policy
          source: policies/data-handling.yaml
      starter_packs:
        - id: api-service
          name: Reviewed API service
          source: https://example.invalid/api-service
          version: 3.1.0
          digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          licence: MIT
          compatibility: Node 22
          targets:
            - role: application
              source_path: application
    - id: delivery-assurance
      name: Delivery assurance
      description: Release and handover evidence for higher-risk work.
      required: false
      standards:
        - id: release
          title: Release readiness
          source: standards/release.md
      personas: []
      policies: []
      starter_packs: []
```

The schema is strict: unknown fields fail validation rather than being ignored.

## Field rules

| Field | Rule |
| --- | --- |
| `schema` | Exactly `ewai.pack/v1`. |
| `id` | `org.<publisher>.<pack>`. The publisher and pack segments use lowercase letters, numbers, hyphens, and supported dot-separated pack suffixes. |
| `version` | Exact semantic version: `major.minor.patch`. |
| `type` | Exactly `organisation`. |
| `requires` | Organisation pack IDs only. Dependencies must be installed and compatible. |
| `blueprint.publisher.id` | Lowercase slug and an exact match for the publisher segment in `id`. |
| `blueprint.compatibility.ewai` | One major line such as `0.x`. It must match the installed EWAI major version. |
| module `id` and item `id` | Lowercase slug; unique within their parent collection. |
| module `required` | Boolean. Dependencies contribute only their required modules. |
| standard/persona/policy `source` | Bounded relative path inside the pack; no absolute path, `..`, NUL byte, or symbolic link. |
| Starter Pack `digest` | Canonical aggregate target-tree digest: `sha256:` followed by 64 lowercase hexadecimal characters. |
| Starter Pack `targets` | One or more unique logical roles with non-overlapping bounded `source_path` values. |

`description` on the pack is optional. All module `description` values are required. A persona item may omit `name`; materialisation then uses the source name or item ID.

## Write standard content

A standard source is ordinary Markdown. Write the rule, why it exists, where it applies, and what evidence demonstrates compliance.

```markdown
# API contract

Use explicit compatibility rules for every externally consumed endpoint.

## Evidence

- Compatibility decision recorded in the intent.
- Contract tests for every supported version.
```

On approval, EWAI adds provenance frontmatter and writes the content beneath:

```text
SPECS/4.Constraints/standards/organisation/<publisher>/<pack>/<module>/<standard>.md
```

## Write persona template content

A blueprint persona source can provide descriptive frontmatter and a practical operating body:

```markdown
---
name: API Governance Lead
version: 1.0.0
description: Applies the organisation's API compatibility and governance conventions.
category: architecture
tags:
  - api
  - governance
capabilities:
  - api-review
---

# API Governance Lead

## Mission

Protect compatibility and make the consequences of API decisions visible.

## Questions to keep asking

- Who consumes this contract today?
- Which change is user-visible or irreversible?

## Boundaries

- This persona advises; accountable people approve project decisions.
```

During named approval, EWAI generates the final `ewai.persona/v1` metadata, forces the tier to `project`, adds source provenance, and writes the result beneath:

```text
SPECS/1.Scope/personas/project/<publisher>-<persona>.md
```

The resulting persona ID is `project.<publisher>.<persona>`.

## Add optional organisation policy contributions

Organisation Policy Design Gates are a separate Blueprint contribution from standards, personas, design systems, and Governed Starter Packs. A policy contribution is a strict `ewai.organisation-policy/v1` YAML document containing declarative rules, provenance, review roles, controls, exception posture, and an explicit unmatched outcome. It cannot contain scripts, prompts, hooks, endpoints, credentials, or other executable behaviour.

Place a policy reference in the module whose applicability it shares:

- a required module contributes its policies whenever that Blueprint is selected;
- an optional root module contributes its policies only when a participant selects that module;
- required dependency modules contribute their policies, while optional dependency modules remain unselected;
- a Blueprint with no selected policy contributions leaves the project in the explicit, non-blocking `not-configured` state. EWAI does not invent a default policy.

Guided Setup previews the resolved publisher, version, provenance labels, policy and rule counts, review roles, outcomes, pack pins, and exact effective digest without exposing policy bodies unnecessarily. A named person must approve that exact digest before EWAI writes the project-local policy baseline. A later upstream change can make the accepted baseline stale, but cannot rewrite it silently.

Use the [Policy Pack Authoring Guide](policies/policy-pack-authoring-guide.md) for the strict policy shape and review checklist, and [Organisation Policy Design Gates](policies/organisation-policy-design-gates.md) for the project workflow and status meanings.

> Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.

## Treat Starter Packs as governed receipts

A Starter Pack entry answers, “which reviewed starting point did we mean, and which logical parts does it contain?” Its fields must be sufficient for people and EWAI to verify the content independently.

EWAI records the entry in the Organisation Blueprint receipt. A separately reviewed, explicitly registered source adapter may later place its content in bounded staging. EWAI does **not** supply credentials, execute retrieved starter content, trust adapter-reported inventories, deploy the result, or infer release approval.

Keep technology-stack selection separate. A stack pack describes engineering guidance and tools; a Starter Pack identifies governed initial content; `starter_materialisation.targets` maps logical roles into this project's repository topology. See [Governed Starter-Project Materialisation](governed-starter-project-materialisation-guide.md).

Repository analysis is separate again. An Organisation Blueprint Pack may declare `source_map.profiles` to classify organisation-specific files and select a registered safe analyser. Profiles do not contain executable hooks or retrieve content. They compose with core, technology, stack, and project profiles, and the active catalogue remains visible in Source Map coverage. Microsoft Power Platform and Salesforce format semantics belong in their technology packs; an organisation pack may narrow repository roles or classifications but should not duplicate or execute a provider parser. See [Repository Source Map](repository-source-map-guide.md) and [platform export analysis](platform-export-analysis-guide.md).

The legacy `boilerplates` field remains readable as a one-role `application` Starter Pack receipt. Use `starter_packs` for new content and for every multi-target starter.

## Add dependencies carefully

Use `requires` when the pack cannot be understood or applied without another organisation pack.

- Dependencies resolve in deterministic dependency-first order.
- A missing, incompatible, or cyclic dependency blocks resolution.
- Required modules from dependencies apply automatically.
- Optional modules from dependencies are not selectable through the root pack.
- Only optional modules declared by the selected root pack may be enabled.

Keep dependency chains short. A pack should not hide a large and surprising policy inheritance tree.

## Install locally

You can distribute complete packs as local folders or through an organisation-operated [Team Hub resource registry](team-hub-resource-registry-guide.md). The registry supports inspecting and installing an exact version and digest; installation doesn't select or apply the Blueprint to a project.

For folder-based distribution, place the complete pack directory beneath one of these local discovery roots:

| Root | Intended ownership |
| --- | --- |
| EWAI package `packs/` | Bundled framework content maintained with EWAI. |
| `~/.ewai/packs/` | Content installed for the current user. |
| `<project>/.ewai-pipeline/packs/` | A project-local installed cache. |

The project cache should be reproducible and disposable; maintain the authoritative pack in controlled version storage outside the cache.

EWAI searches recursively for `pack.yaml` files, to a maximum depth of eight directories. If the same organisation pack ID appears in more than one root, catalogue loading fails instead of silently selecting one.

## Know the trust and size boundaries

The resolver refuses:

- symbolic links and real paths that escape the pack root;
- absolute or parent-traversing standard/persona/policy paths;
- missing or non-file content sources;
- manifests over 256 KiB;
- individual referenced files over 1 MiB;
- more than 5 MiB of referenced standard/persona/policy content per pack;
- manifests nested beyond the configured depth;
- invalid YAML, unknown fields, duplicates, incompatible versions, missing dependencies, and cycles.

These checks constrain what EWAI reads. They do not certify that the organisation's written standard is correct.

## Understand digests

Each pack digest covers the raw `pack.yaml` bytes plus every referenced standard/persona/policy path and its raw bytes in sorted path order. Whitespace changes therefore change the digest.

The resolved selection has a second digest covering the root pack, dependency versions and content digests, and applied modules. This lets Guided Setup detect a change between preview and approval.

Never “tidy” an installed pack after it has been reviewed and assume it is the same input. Re-preview it and review the new digest.

## Review and approve in Guided Setup

1. Start or resume Guided Setup for the project.
2. Choose one compatible installed Organisation Blueprint Pack.
3. Select only the root pack's optional modules that apply.
4. Review the resolved publisher, versions, digests, dependencies, applied modules, and counts of standards, personas, policy contributions, and Starter Pack receipts.
5. Resolve every destination conflict. Preview is write-free; Governed Starter Pack materialisation has no force or merge path.
6. Confirm that the active personas shown in the interface are the right lenses for this section. Blueprint persona templates do not become active project personas before approval.
7. Give the accountable approver's name and approve the complete Discovery result.

Immediately before writing, EWAI re-resolves the installed pack and compares the selection digest. Drift blocks approval. The transaction either writes the complete prepared result or rolls it back.

## What approval creates

Approval can create:

- organisation standards beneath `SPECS/4.Constraints/standards/organisation/`;
- project personas beneath `SPECS/1.Scope/personas/project/`;
- an optional approved policy baseline at `SPECS/4.Constraints/organisation-policy/baseline.json` when selected contributions exist;
- `SPECS/5.Strategy/organisation-blueprint.md`, containing the root, resolved packs, versions, digests, applied modules, approver, timestamp, and Starter Pack receipts;
- a structured `blueprints.organisation` pin in the configured SPECS root's `pipeline.yaml`.

The project-owned copies and receipt allow the approved baseline to remain intelligible even if the installed source later moves or changes.

## Version and publish responsibly

Use semantic versioning as an organisational promise:

- **Patch** for clarification that does not change an obligation or persona stance.
- **Minor** for additive optional guidance or a backward-compatible new module.
- **Major** for changed required behaviour, removed content, incompatible identity, or a substantially changed decision lens.

For every release:

1. review the complete diff, including whitespace-sensitive digest changes;
2. validate every dependency and referenced file;
3. independently verify each Starter Pack version, canonical target digest, licence, compatibility statement, and logical target contract;
4. record ownership and release approval in the pack's source repository;
5. test the pack in a disposable project before distribution;
6. communicate whether existing projects should remain pinned or deliberately adopt the new version.

## Troubleshooting

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| Pack does not appear | Wrong root, filename is not `pack.yaml`, nesting is too deep, or `type` is not `organisation` | Confirm the local root, filename, depth, and manifest type. |
| Manifest is invalid | Wrong field shape, unknown field, ID mismatch, duplicate ID, or malformed semantic version | Compare against the complete example and the strict field rules. |
| Content source is rejected | Absolute path, `..`, symbolic link, missing file, escape, or size limit | Keep real regular files inside the pack and reduce content size. |
| Duplicate pack ID | The same ID exists in two installed roots | Remove the stale installed copy; precedence is deliberately not guessed. |
| Missing or cyclic dependency | A required ID is absent or the dependency graph loops | Install the exact dependency or redesign the dependency graph. |
| Pack is incompatible | Its `ewai` major does not match the running package | Publish a compatible pack version or use the intended EWAI major. |
| Approval reports drift | Pack bytes, referenced content, dependency, or selected module changed after preview | Reopen the preview and review the new digest and consequences. |
| Starter preview reports conflicts | One or more destinations differ or are protected/unsafe | Review the existing project-owned truth outside materialisation, then prepare a new preview. EWAI never forces or merges. |

## Author checklist

- [ ] Stable publisher and pack IDs
- [ ] Exact semantic version and compatible EWAI major
- [ ] Focused modules with defensible required/optional choices
- [ ] Unique IDs in every collection
- [ ] Bounded standard and persona files inside the pack
- [ ] Persona bodies describe mission, questions, evidence, and boundaries
- [ ] Starter Pack targets, version, canonical digest, licence, and compatibility independently reviewed
- [ ] Organisation-owned adapter validated and explicitly registered before use
- [ ] Short, acyclic, installed dependency graph
- [ ] Pack tested from a local discovery root
- [ ] Preview consequences reviewed by the people affected
- [ ] Named approval and project receipt retained

## Related guides

- [Working with personas](working-with-personas.md)
- [Organisation Policy Design Gates](policies/organisation-policy-design-gates.md)
- [Policy Pack Authoring Guide](policies/policy-pack-authoring-guide.md)
- [Repository Source Map](repository-source-map-guide.md)
- [Product Owner guide](product-owner-guide.md)
- [All EWAI guides](README.md)

## Contract sources

- `src/organisation-blueprints.mjs` — strict manifest, roots, bounds, dependencies, digests, and safe projections
- `src/discovery.mjs` — preview, materialisation, provenance, drift detection, approval, pinning, and rollback
- `tests/organisation-blueprints.test.mjs` — valid examples and failure cases
- `tests/discovery.test.mjs` — no-write preview and transactional application evidence
