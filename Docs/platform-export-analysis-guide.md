# Power Platform and Salesforce export analysis

EWAI can add bounded platform semantics to already-extracted Microsoft Power
Platform and Salesforce source folders. The capability extends the existing
Repository Source Map: it does not create a second index, connect to a tenant or
org, extract archives, invoke vendor tools, deploy content, or certify that an
application is safe or complete.

Use this guide when a project contains solution source, canvas-app source,
Salesforce Metadata API files, or a Salesforce DX project and you want those
components and declared relationships to participate in repository search,
graphs, Archaeology and Blast Radius.

> Platform analysis is advisory evidence. It is not security certification,
> deployment validation, product acceptance, import assurance, or proof that
> runtime dependencies and business behaviour are complete. A qualified person
> must review the export, coverage limits, findings and residual risk.

## The operating boundary

The workflow has three deliberately separate steps:

1. A person uses Microsoft- or Salesforce-supported tooling to obtain and
   extract source into a local folder.
2. EWAI Discovery may suggest an installed technology pack from bounded path
   markers.
3. A person selects the pack in `SPECS/pipeline.yaml`, then explicitly refreshes
   the Source Map.

Detection does not select a pack. Selecting a pack does not run `pac`, `sf`,
SolutionPackager, PowerShell, an archive utility, a connector, a network request,
an import, or a deployment.

The original ZIP or `.msapp` may remain in the repository, but it is inventory
evidence only. EWAI analyses supported source files after they have been
extracted. Microsoft documents its solution source formats and canvas-app
extraction options in the [solution YAML reference](https://learn.microsoft.com/en-us/power-platform/alm/solution-source-control-yaml-format),
[SolutionPackager guidance](https://learn.microsoft.com/en-us/power-platform/alm/solution-packager-tool),
and [canvas-app source guide](https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/power-apps-yaml).
Salesforce documents project source structure in its
[source-format guide](https://developer.salesforce.com/docs/platform/code-builder/guide/codebuilder-source-format.html)
and metadata families in the
[Metadata Coverage Report](https://developer.salesforce.com/docs/success/metadata-coverage-report/references/metadata-types/v66.0/metadata-types.html).

## Try a small extracted source tree

A minimal recognisable Salesforce source layout looks like this:

```text
crm-source/
├── sfdx-project.json
└── force-app/main/default/
    └── objects/Case/
        └── Case.object-meta.xml
```

Use files actually exported from the intended project, not empty files created to trigger detection. For a Power Platform solution, `Other/Solution.xml` and supported extracted component files serve the equivalent role. The supported-evidence tables below explain what each analyser can read.

Configure the containing repository, select the appropriate pack, refresh the Source Map and inspect coverage. The first useful result is an inventory with explicit analysed/partial outcomes and searchable technical identifiers. It isn't confirmation of a live tenant's deployment or runtime relationships.

## Enable the packs

The installed pack IDs are:

- `ewai.technology.power-platform`;
- `ewai.technology.salesforce`.

Discovery can suggest them from these markers:

| Pack | Suggestion markers |
| --- | --- |
| Power Platform | `Other/Solution.xml` or `solutions/*/solution.yml` beneath a walked project folder |
| Salesforce | `sfdx-project.json`, root `package.xml`, `manifest/package.xml`, or `unpackaged/package.xml` |

An archive by itself is not a marker. Suggestions remain proposals until a
person confirms selection.

Enable one or both packs under the canonical project configuration:

```yaml
packs:
  - ewai.core
  - ewai.technology.power-platform
  - ewai.technology.salesforce
```

After changing pack selection, refresh the Source Map because the effective
profile catalogue and its digest have changed:

```bash
ewai index freshness --project . --json
ewai index refresh --project . --json
ewai index coverage --project . --json
```

## Supported Power Platform evidence

The V1 Power Platform analyser recognises:

| Extracted evidence | Semantic facts |
| --- | --- |
| `Other/Solution.xml` | Solution unique name, allowlisted root-component technical identifiers and containment |
| `Other/Customizations.xml` or `Other/Customisations.xml` | Recognisable entity and attribute technical identifiers and containment |
| `solutions/<name>/solution.yml` | Solution identity from the documented solution folder |
| `solutioncomponents.yml` | Allowlisted `Path` component identifiers and solution containment |
| `rootcomponents.yml` | Allowlisted component schema/unique identifiers, type qualifier and containment |
| `missingdependencies.yml` | Path-shaped missing component identifiers and declared requirements when present |
| extracted `Src/*.pa.yaml` and `Src/Component/*.pa.yaml` | App, screen, named-component and control mapping keys plus containment |

The analyser does not persist Power Fx, control property values, display labels,
descriptions, connection-reference values, environment-variable values, or
arbitrary XML/YAML scalar values. A `.msapp` must be extracted outside EWAI
before its supported `Src` files can be analysed.

The newer solution YAML schema and canvas source schema can evolve. Unknown
component structures therefore produce partial evidence rather than a claim of
complete understanding.

## Supported Salesforce evidence

The V1 Salesforce analyser recognises:

| Extracted evidence | Semantic facts |
| --- | --- |
| root, `manifest/`, or `unpackaged/package.xml` | Package, allowlisted metadata type/member identities, containment and API version |
| `sfdx-project.json` | Project and bounded package-directory identifiers |
| decomposed `*.object-meta.xml` | Custom-object identity from its source path |
| decomposed `*.field-meta.xml` | Qualified object/field identity and containment |
| `*.permissionset-meta.xml` and `*.profile-meta.xml` | Object, field, Apex-class, application and tab access with paired boolean or visibility meaning |
| `*.flow-meta.xml` | Flow identity and allowlisted record create/read/update/delete object references |
| `*.cls-meta.xml`, LWC and Aura companion metadata | Component identity from the safe repository-relative path |

The analyser does not persist labels, descriptions, formulas, conditions,
endpoints, tokens, certificates, named-credential values, namespaces, login
URLs, or arbitrary XML/JSON scalar values. Apex and Lightning source code remains
the responsibility of the existing Tree-sitter or generic Source Map profile;
the Salesforce analyser handles only its allowlisted metadata companion facts.

## Repository topologies

Patterns are evaluated relative to each configured repository root. The built-in
profiles contain root and recursive variants so all three common arrangements
are supported.

### Single repository

```yaml
repositories:
  - name: application
    path: .
    role: application
packs:
  - ewai.core
  - ewai.technology.power-platform
  - ewai.technology.salesforce
```

Place extracted folders below this root, for example `solutions/Contoso` and
`force-app/main/default`.

### Monorepo

```yaml
repositories:
  - name: product
    path: .
    role: workspace
packs:
  - ewai.core
  - ewai.technology.power-platform
  - ewai.technology.salesforce
```

Exports may be nested, for example `apps/power/solutions/Contoso` and
`apps/crm/force-app/main/default`. The stored Source Map path remains qualified
by the configured repository name.

### Folder containing repository subfolders

```yaml
repositories:
  - name: power-apps
    path: products/power
    role: low-code
  - name: salesforce-crm
    path: products/salesforce
    role: crm
packs:
  - ewai.core
  - ewai.technology.power-platform
  - ewai.technology.salesforce
```

Here `solutions/Contoso/solution.yml` is relative to `power-apps`, while
`force-app/main/default/...` is relative to `salesforce-crm`. Repository roots
remain configured project-local authority; analyzers cannot escape them.

## Inspect evidence

Inspect the effective profiles and their match counts:

```bash
ewai index profiles --source technology --project . --json
ewai index profiles --analyser power-platform-metadata --project . --json
ewai index profiles --analyser salesforce-metadata --project . --json
```

Inspect files without exposing their content or stored metadata:

```bash
ewai index files --classification power-platform-metadata --project . --json
ewai index files --classification power-platform-canvas --project . --json
ewai index files --classification salesforce-metadata --project . --json
ewai index files --outcome analysis_failed --project . --json
```

Search technical identities and inspect declared graph relationships:

```bash
ewai index search Invoice__c --project . --json
ewai index graph Invoice__c --project . --json
ewai index search ContosoCore --project . --json
ewai index graph ContosoCore --project . --json
```

The same evidence reaches Archaeology and Blast Radius through the canonical
Source Map. Refresh before relying on it. A fresh index means it matches the
current files and profile catalogue; it does not mean coverage is complete.

## Understand partial and failed coverage

Coverage includes a separate `partial` file count. A platform file can be:

- `analysed` and complete within the finite V1 allowlist;
- `analysed` but partial because an unknown family or omitted identifier was
  observed;
- `analysis_failed` with a stable failure code;
- generic, shallow or inventory-only because no selected platform profile
  matched;
- `skipped_sensitive` or `skipped_oversized` under the normal Source Map rules.

Platform analysis is bounded to 240 characters per technical identifier, 1,000
symbols and 2,000 relationships per file, 20,000 visited structural nodes and 96
levels of nesting. Reaching a limit produces partial or failed evidence with a
visible warning. It never silently claims completeness.

Stable platform failure codes are:

- `invalid-platform-document`;
- `unsafe-xml-declaration`;
- `platform-analysis-limit`;
- `unsupported-platform-layout`.

Raw parser errors and source excerpts are not persisted. XML DTD and entity
declarations are rejected; YAML aliases are disabled.

## Troubleshoot safely

### A pack was suggested but is not active

This is expected. Review the detected technology and add the pack explicitly to
`SPECS/pipeline.yaml` if it is appropriate. Then refresh the Source Map.

### A supported file used the generic analyser

Check pack selection, `ewai index profiles` match counts, the configured
repository root and the repository-relative path. Monorepo folders should match
the recursive built-in patterns without a custom profile.

### An archive is inventory-only

This is intentional. Preserve the original export if it is useful evidence, but
extract a working copy with vendor-supported tooling outside EWAI. Do not add a
command-bearing Source Map profile or rename the archive to force parsing.

### Coverage is partial after a successful parse

Review the file family and current allowlist. Partiality may reflect an evolving
vendor schema, an unsupported component family, an invalid technical identifier,
or a graph bound. Treat the missing semantics as an explicit uncertainty in
Blast Radius, planning and testing.

## Extend safely

Technology, stack, organisation and project packs may select only registered
analyzers. A pack can add narrower profiles for known paths, classifications and
repository roles, but it cannot add executable parsing code.

A genuinely new provider family requires an EWAI implementation change with:

- a finite allowlist of persisted facts;
- hostile-document and redaction tests;
- bounded traversal, symbol and relationship behaviour;
- stable failure codes and partial semantics;
- topology and consumer regression tests;
- updated public schemas and this documentation.

Do not broaden a provider parser to retain arbitrary values merely because a
value might sometimes be useful. Promote only stable technical identifiers and
minimum relationship qualifiers required for honest graph meaning.

## Operational checklist

- [ ] The export was obtained and extracted through an accountable vendor-supported process.
- [ ] The original archive is not being treated as semantic source.
- [ ] Pack suggestion was reviewed and selection is explicit.
- [ ] Repository roots and topology are correct.
- [ ] Source Map was refreshed after extraction or pack changes.
- [ ] Profile match counts show the expected provider analyzers.
- [ ] Partial, failed, shallow, sensitive, oversized and inventory evidence was reviewed.
- [ ] Search and graph results contain no prohibited source values.
- [ ] Blast Radius conclusions state the remaining evidence limits.
- [ ] A qualified human reviews security, deployment, product and release decisions.

## Related guides

- [Repository Source Map](repository-source-map-guide.md)
- [Blast Radius and Impact Routing](blast-radius-and-impact-routing-guide.md)
- [Existing-project onboarding](existing-project-onboarding-guide.md)
- [Designing Organisation Blueprint Packs](designing-organisation-blueprint-packs.md)
- [CLI and configuration reference](reference/cli-and-configuration.md)
- [Human approval and assurance](human-approval-and-assurance-guide.md)

## Current contract sources

- `src/platform-metadata-analysis.mjs`
- `src/power-platform-source-map.mjs`
- `src/salesforce-source-map.mjs`
- `src/repository-source-map.mjs`
- `src/runtime/repository-index.mjs`
- `packs/technologies/power-platform/pack.yaml`
- `packs/technologies/salesforce/pack.yaml`
- `tests/platform-metadata-analysis.test.mjs`
- `tests/power-platform-source-map.test.mjs`
- `tests/salesforce-source-map.test.mjs`
- `tests/platform-export-integration.test.mjs`
