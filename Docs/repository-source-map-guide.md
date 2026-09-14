# Repository Source Map guide

The Repository Source Map is EWAI's project-local inventory and analysis layer. It records every regular file found in the configured repositories, gives each file an explicit analysis outcome and depth, and uses deeper Tree-sitter evidence where a supported grammar is registered.

The Source Map evolves the existing Repository Index; it does not replace it. Search, dependency graphs, standards coverage, Blast Radius, and the dashboard all consume the same rebuildable SQLite projection.

> The Source Map is advisory repository evidence. A fresh map is not complete understanding, security certification, product acceptance, or release approval. Dynamic behaviour, external systems, generated assets, runtime configuration, and undocumented human processes can remain outside its evidence.


<!-- editorial: contents -->
## On this page

- [Start with a question about a change](#start-with-a-question-about-a-change)
- [What gets mapped](#what-gets-mapped)
- [Understand outcomes and depths](#understand-outcomes-and-depths)
- [Core analysers and file coverage](#core-analysers-and-file-coverage)
- [Refresh and inspect the Source Map](#refresh-and-inspect-the-source-map)
- [Add a project profile](#add-a-project-profile)
- [Add profiles through packs](#add-profiles-through-packs)
- [Configure repository topologies](#configure-repository-topologies)
- [Profile contract and safety limits](#profile-contract-and-safety-limits)
- [Personas in discovery and impact work](#personas-in-discovery-and-impact-work)
- [Relationship to Blast Radius](#relationship-to-blast-radius)
- [Power Platform and Salesforce exports](#power-platform-and-salesforce-exports)
- [Troubleshooting](#troubleshooting)
- [Operational checklist](#operational-checklist)
- [Related guides](#related-guides)
- [Current contract sources](#current-contract-sources)

## Start with a question about a change

For example: “Where does the application check export permissions?” Ask EWAI to inspect the relevant source and its callers. For direct inspection:

```bash
ewai index freshness --project . --json
ewai index refresh --project . --json
ewai index search "export" --project . --json
```

Choose a returned file or symbol, inspect its graph through the [commands below](#refresh-and-inspect-the-source-map), then read the source. Check coverage before claiming you've found every caller. No search result may mean unsupported analysis, different naming or genuinely absent code.

## What gets mapped

EWAI walks every configured repository and inventories each regular file except:

- symbolic links;
- unreadable directories;
- the configured canonical `SPECS` tree, which is indexed separately by the Mind Palace and delivery projections;
- generated or dependency directories that EWAI excludes by name, including `.git`, `.nuxt`, `.output`, `.ewai-pipeline`, `.phpunit.cache`, `.vite`, `build`, `coverage`, `dist`, `node_modules`, `storage`, and `vendor`.

An uncommon file type is not silently discarded. The core fallback profile records it as inventory-only evidence. Technology, stack, organisation, and project profiles can opt matching files into a registered deeper analyser.

Keeping canonical SPECS out of the Source Map prevents a normal evidence write from making implementation evidence stale. It does not hide project knowledge: the Mind Palace, intent, standards, and delivery projections remain its authoritative readers.

## Understand outcomes and depths

Every file has one outcome:

| Outcome | Meaning |
| --- | --- |
| `analysed` | The selected registered analyser completed. |
| `inventory_only` | EWAI recorded bounded file metadata but did not interpret content. |
| `skipped_sensitive` | The filename is credential-shaped, so EWAI did not open it. |
| `skipped_oversized` | The file exceeded the selected profile's size ceiling, so EWAI did not open it. |
| `analysis_failed` | EWAI retained the file in coverage but its bounded analyser could not complete. |

Analysis depth is separate:

| Depth | Current meaning |
| --- | --- |
| `deep` | A registered deep analyser extracts syntax or declared metadata symbols and relationships. Tree-sitter handles supported source code; reviewed platform analyzers handle finite metadata catalogues. |
| `shallow` | EWAI records structural keys or content-shape summary data, not scalar values. |
| `inventory` | EWAI records file classification and bounded metadata only. |

Deep means deeper structural evidence, not semantic completeness. Shallow structured analysis stores key paths rather than configuration values. Sensitive and oversized files receive metadata-derived fingerprints; EWAI does not hash their content.

## Core analysers and file coverage

Profiles may select only these registered analysers:

| Analyser | Intended evidence |
| --- | --- |
| `tree-sitter` | Syntax-aware PHP, JavaScript, JSX, TypeScript, TSX, and Vue analysis. |
| `power-platform-metadata` | Allowlisted solution, component, canvas and declared dependency facts from supported already-extracted Power Platform source. |
| `salesforce-metadata` | Allowlisted package, component, object, field, flow and permission facts from supported Salesforce source. |
| `structured-keys` | JSON/JSONC, YAML, TOML, XML/SVG, INI/properties, and safe environment-template key shapes. |
| `text-summary` | Documentation and common source/configuration text shapes such as line counts. |
| `inventory-only` | File presence, classification, size, profile, and outcome. |

Core profiles cover common source, structured, documentation, build, query, shell, styling, and configuration file extensions. Unknown and binary files remain visible through inventory-only profiles. Packs should add a profile when the file's role or framework context matters, not merely to make the count look deeper.

## Refresh and inspect the Source Map

Refresh before substantive repository, Blast Radius, or standards claims:

```bash
ewai index freshness --project . --json
ewai index refresh --project . --json
ewai index coverage --project . --json
```

Inspect the effective profile catalogue:

```bash
ewai index profiles --project . --json
ewai index profiles --source organisation --limit 50 --project . --json
ewai index profiles --analyser tree-sitter --project . --json
```

Inspect safe file projections:

```bash
ewai index files --outcome analysis_failed --project . --json
ewai index files --outcome skipped_sensitive --project . --json
ewai index files --classification framework-routing --project . --json
ewai index files --profile project:api-contracts --project . --json
ewai index files --repository api --query contracts --limit 50 --project . --json
```

The profile projection includes a `matchCount`; zero means the profile was active in the completed catalogue but selected no files. The file projection returns repository name, repository-relative path, parser state, counts, classification, profile, analyser, depth, and outcome. It does not expose repository roots, file content, stored analysis metadata, or fingerprints. Filters and result limits are bounded consistently for CLI and MCP callers.

The equivalent read-only MCP tools are:

- `ewai_source_map_coverage`;
- `ewai_source_map_profiles`;
- `ewai_source_map_files`.

The dashboard's **Impact** tab shows coverage, effective profile provenance, a bounded sample needing attention, and the personas actively engaged for the selected work item.

## Add a project profile

Add project-specific rules under `source_map.profiles` in `SPECS/pipeline.yaml`:

```yaml
source_map:
  profiles:
    - id: api-contracts
      patterns:
        - contracts/**/*.json
      analyser: structured-keys
      classification: api-contract
      repositories:
        - backend
      priority: 100
      max_bytes: 500000
```

`repositories` may contain a configured repository name or role. Omit it when the profile should apply to every configured repository.

After changing profiles, refresh the map. The effective profile catalogue has a deterministic digest; changing a profile, pack version, or active pack makes the previous map stale.

## Add profiles through packs

Technology, stack, and Organisation Blueprint Packs use the same declarative `source_map` shape:

```yaml
schema: ewai.pack/v1
id: org.northstar.engineering
name: Northstar engineering
description: Reviewed organisation repository conventions.
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
    - id: repository-conventions
      name: Repository conventions
      description: Classify organisation policy files for repository analysis.
      required: true
source_map:
  profiles:
    - id: decision-policies
      patterns:
        - policies/**/*.yaml
      analyser: structured-keys
      classification: organisation-policy
      priority: 90
```

The example is a complete organisation manifest. `source_map` belongs to the pack, not an individual module. Profiles take effect when the pack is selected in the project configuration; installing a folder alone doesn't activate it.

The Blueprint parser validates profile fields and types, registered analysers, safe patterns and size limits. It rejects executable fields and duplicate profile IDs. Changing a profile changes the pack digest and the effective profile catalogue, so refresh the index after an approved change.

Non-core profile IDs are namespaced when resolved:

- project profile `api-contracts` becomes `project:api-contracts`;
- pack profile `decision-policies` becomes `org.northstar.engineering:decision-policies`.

The effective catalogue includes configured packs and their dependencies. Profile selection is deterministic:

1. project;
2. organisation;
3. stack;
4. technology;
5. core.

Within the same source level, higher `priority` wins, then profile ID provides a stable tie-break. Core safety treatment for sensitive filenames cannot be overridden.

## Configure repository topologies

Source Map profiles use the same `repositories` topology as indexing, starter materialisation, and Blast Radius.

### Single repository

```yaml
repositories:
  - name: application
    path: .
    role: application
source_map:
  profiles:
    - id: application-contracts
      patterns: [contracts/**/*.json]
      analyser: structured-keys
      classification: api-contract
      repositories: [application]
```

### Monorepo

```yaml
repositories:
  - name: product
    path: .
    role: workspace
source_map:
  profiles:
    - id: frontend-pages
      patterns: [apps/web/pages/**/*.vue]
      analyser: tree-sitter
      classification: user-interface
      repositories: [product]
    - id: backend-routes
      patterns: [apps/api/routes/**/*.php]
      analyser: tree-sitter
      classification: framework-routing
      repositories: [product]
```

Patterns are relative to the configured repository root. In a monorepo, include the application subfolder in the pattern.

### Folder containing repository subfolders

```yaml
repositories:
  - name: web-app
    path: clients/web
    role: frontend
  - name: api-app
    path: services/api
    role: backend
source_map:
  profiles:
    - id: frontend-pages
      patterns: [pages/**/*.vue, app/pages/**/*.vue]
      analyser: tree-sitter
      classification: user-interface
      repositories: [frontend]
    - id: backend-routes
      patterns: [routes/**/*.php]
      analyser: tree-sitter
      classification: framework-routing
      repositories: [backend]
```

Here each pattern is relative to its repository subfolder. Repository selectors may use `web-app`/`api-app` names or `frontend`/`backend` roles.

## Profile contract and safety limits

A profile supports only:

- `id`;
- one or more safe relative `patterns` using `*`, `**`, and `?`;
- one registered `analyser`;
- a lower-kebab-case `classification`;
- optional integer `priority` from `-10000` to `10000`;
- optional repository name/role selectors;
- optional `max_bytes` from 1 to 900,000.

Absolute, negated, traversal, backslash, brace, bracket, and parenthesised patterns are rejected. Profiles cannot contain shell commands, module paths, executable hooks, credentials, or network configuration. The 900,000-byte ceiling is global; a profile may lower it but cannot raise it.

Use profiles to select an existing safe analysis behaviour. If a new analyser is needed, it requires a reviewed EWAI implementation change with its own tests and safety model.

## Personas in discovery and impact work

Personas do not change which bytes are indexed. They challenge how the resulting evidence is interpreted.

Attach relevant lenses to the intent during Discovery, including:

- core personas;
- installed premium personas;
- reusable personal personas;
- project-local personas, including approved Blueprint-derived personas.

The dashboard identifies every active persona by name, tier, role, depth, and engagement reason. An attached premium or local reference remains visible as unavailable if its library content cannot currently be resolved. This avoids silently dropping a perspective.

Persona conclusions remain advisory. Real stakeholders and accountable specialists provide acceptance, assurance, and approval.

## Relationship to Blast Radius

The Source Map is the evidence base. Blast Radius resolves supplied paths or symbols and traverses supported relationships from that evidence.

Blast Radius reports partial coverage when the map includes inventory-only, shallow, sensitive, oversized, failed, or explicitly partial platform evidence, when a target is unresolved or ambiguous, or when traversal reaches its bound. A small graph under partial coverage is uncertainty, not proof of low impact.

See [Blast Radius and Impact Routing](blast-radius-and-impact-routing-guide.md) for the review-routing workflow.

## Power Platform and Salesforce exports

The installed `ewai.technology.power-platform` and
`ewai.technology.salesforce` packs add finite semantic profiles for supported
already-extracted source layouts. Their symbols and relationships use the same
Source Map and graph as Tree-sitter evidence. Unsupported families remain
generic, inventory, failed or explicitly partial evidence rather than being
silently discarded.

EWAI does not extract ZIP or `.msapp` archives, run vendor CLIs, connect to a
tenant or org, import, deploy, or retain arbitrary configuration values. See the
[Power Platform and Salesforce export analysis guide](platform-export-analysis-guide.md)
for supported layouts, topology examples, redaction rules and troubleshooting.

## Troubleshooting

### The map is stale after no source-code change

Profile catalogue changes also invalidate freshness. Inspect `ewai index freshness`; if the reason is `profile-catalogue-changed`, review the current packs and profiles, then refresh.

### A file is inventory-only

Inspect its selected profile. The outcome is expected for unknown or binary content. Add a safe profile only if a registered analyser matches the format and the classification provides useful project context.

### A structured file failed

Filter `--outcome analysis_failed`. Confirm the document is valid for its extension. Failure remains visible in Source Map coverage and limits downstream claims.

### A sensitive file was skipped

That is the intended safety behaviour. Do not rename or copy credentials to force analysis. Use a value-free `.env.example`, `.env.sample`, or `.env.template` when configuration-key evidence is genuinely needed.

### The wrong profile won

Inspect `ewai index profiles`, the repository name/role selector, source provenance, and priority. Prefer a narrower pattern to a high global priority. Refresh after correction.

## Operational checklist

- [ ] Every repository root is explicit and correct.
- [ ] Source Map profiles are declarative and use registered analysers only.
- [ ] Organisation and project classifications have named owners.
- [ ] Repository selectors match configured names or roles.
- [ ] Sensitive, oversized, inventory-only, and failed counts were reviewed.
- [ ] Relevant premium and project-local personas are visibly engaged.
- [ ] Partial coverage is carried into Blast Radius, planning, and QA decisions.
- [ ] Human reviewers understand that the Source Map is evidence, not approval.

## Related guides

- [Existing-project onboarding](existing-project-onboarding-guide.md)
- [Blast Radius and Impact Routing](blast-radius-and-impact-routing-guide.md)
- [Designing Organisation Blueprint Packs](designing-organisation-blueprint-packs.md)
- [Governed Starter-Project Materialisation](governed-starter-project-materialisation-guide.md)
- [Working with personas](working-with-personas.md)
- [CLI and configuration reference](reference/cli-and-configuration.md)
- [Troubleshooting and recovery](operations/troubleshooting-and-recovery.md)

## Current contract sources

- `src/repository-source-map.mjs`
- `src/platform-metadata-analysis.mjs`
- `src/power-platform-source-map.mjs`
- `src/salesforce-source-map.mjs`
- `src/runtime/repository-index.mjs`
- `src/runtime/impact-analysis.mjs`
- `config/project.schema.json`
- `config/pack.schema.json`
- `tests/repository-index.test.mjs`
- `tests/repository-index-profiles.test.mjs`
- `tests/repository-source-map-cli.test.mjs`
