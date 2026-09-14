# Governed Starter-Project Materialisation

Governed Starter-Project Materialisation turns an accepted Organisation Blueprint receipt into an immutable preview and, after named human approval, adds missing project files. It supports a single repository, a monorepo, and a workspace containing several independent Git repositories.

The capability is additive-only. It never overwrites, merges, deletes, or forces an existing destination.

> A starter source adapter is trusted local code. EWAI runs it with the invoking user's permissions and does not OS-sandbox it. EWAI independently verifies its staged output. The result is evidence, not security certification, code-quality approval, licence approval, business acceptance, or release approval.


<!-- editorial: contents -->
## On this page

- [Use a supplied adapter](#use-a-supplied-adapter)
- [Keep four concepts separate](#keep-four-concepts-separate)
- [End-to-end flow](#end-to-end-flow)
- [Define a Starter Pack in a Blueprint](#define-a-starter-pack-in-a-blueprint)
- [Calculate the canonical digest](#calculate-the-canonical-digest)
- [Configure repository topology](#configure-repository-topology)
- [Implement a generic source adapter](#implement-a-generic-source-adapter)
- [Validate and register an adapter](#validate-and-register-an-adapter)
- [Prepare, review, and apply](#prepare-review-and-apply)
- [Understand classifications](#understand-classifications)
- [Persona engagement and human authority](#persona-engagement-and-human-authority)
- [Evidence and lifecycle handoff](#evidence-and-lifecycle-handoff)
- [Recovery](#recovery)
- [Implementer checklist](#implementer-checklist)
- [Related guides](#related-guides)

## Use a supplied adapter

Before starting, obtain the approved adapter package and starter receipt from its owner. EWAI doesn't ship a downloader for every source service. You'll need the accepted Blueprint, a current starter receipt and repository target mappings.

For operation, follow [repository topology](#configure-repository-topology), [validate and register](#validate-and-register-an-adapter), then [prepare, review and apply](#prepare-review-and-apply). Preview runs the trusted adapter to obtain staging files; application is the separate approved step that adds them to repositories.

If you're creating the reusable starter definition or writing the adapter, use the authoring sections below. Their code and configuration aren't extra prerequisites to implement yourself when an approved package has already been supplied.

## Keep four concepts separate

| Concept | What it owns | What it does not own |
| --- | --- | --- |
| Organisation Blueprint Pack | Organisation standards, persona templates, and Governed Starter Pack receipts | Project-specific repository placement or technology selection |
| Governed Starter Pack | Versioned source identity, licence, compatibility, logical target roles, and one canonical aggregate digest | Credentials, provider integration, destination roots, or approval |
| Technology Stack | Framework and platform guidance, constraints, commands, and patterns | Starter source provenance or local repository topology |
| Repository Topology | Named local Git repositories and the destination path for each logical target role | Pack content, fetching, or technology policy |

A Blueprint may recommend both a technology stack and a Starter Pack, but they remain independently reviewable decisions. A team can change its stack guidance without silently changing its starter content, or use the same starter across different repository layouts.

## End-to-end flow

1. An organisation publishes a reviewed Blueprint containing one or more `starter_packs` receipts.
2. Guided Discovery resolves the Blueprint, materialises its standards and project personas, and records the accepted immutable receipt.
3. The project maps every Starter Pack logical role to one configured repository and relative destination path.
4. A technical operator validates and explicitly registers an organisation-owned source adapter.
5. EWAI runs that trusted adapter only against a bounded staging directory.
6. EWAI independently inventories the staged regular files and verifies the accepted digest.
7. EWAI binds the receipt, adapter, topology, Git revisions, staged tree, destination classifications, and expiry into one immutable preview.
8. The dashboard or CLI shows safe per-target `create`, `identical`, and `conflict` counts and the actively engaged personas.
9. A named person approves the current preview.
10. EWAI revalidates every bound input, creates only missing files, persists canonical evidence, then emits a non-authoritative lifecycle event.

Preview does not change application repositories. Approval expires after 30 minutes. Drift or conflict requires a fresh preview.

## Define a Starter Pack in a Blueprint

Use `starter_packs`, not the legacy `boilerplates` field, for new packs:

```yaml
modules:
  - id: application-foundation
    name: Application foundation
    description: Organisation-owned starting content for the application.
    required: true
    standards: []
    personas: []
    starter_packs:
      - id: service-platform
        name: Service platform
        source: https://source.example.invalid/service-platform-4.2.0.tar.gz
        version: 4.2.0
        digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        licence: Apache-2.0
        compatibility: EWAI 0.x; Node 22; deployment target reviewed separately
        targets:
          - role: api
            source_path: services/api
          - role: web
            source_path: clients/web
```

Every target needs a unique lowercase `role` and a non-overlapping relative `source_path`. The adapter writes the complete staged output using those source paths. Files outside exactly one declared target are rejected.

Legacy `boilerplates` remain readable as a one-role `application` receipt for compatibility. They should be migrated to explicit `starter_packs` before adding multi-target content.

## Calculate the canonical digest

Build the exact logical target folders locally, then run:

```bash
ewai starter digest api=./reviewed/services/api web=./reviewed/clients/web --json
```

The returned aggregate `digest` belongs in `pack.yaml`. Each target is independently canonicalised before the role and target digest are combined. The calculation rejects:

- symbolic links, hard-link aliases, and special files;
- unsafe, non-NFC, reserved, trailing-dot, or case-equivalent paths;
- excessive depth, file size, total size, path length, or file count.

The digest represents logical content. Do not substitute an archive checksum, Git commit, release tag, or adapter-reported digest.

## Configure repository topology

Repositories are configured under `repositories`. Each must resolve to its own Git working-tree root. Targets map Starter Pack roles to those repositories.

### Single repository

```yaml
repositories:
  - name: application
    path: .
    role: application
starter_materialisation:
  targets:
    - role: application
      repository: application
      path: .
```

### Monorepo

```yaml
repositories:
  - name: product
    path: .
    role: workspace
starter_materialisation:
  targets:
    - role: api
      repository: product
      path: apps/api
    - role: web
      repository: product
      path: apps/web
```

### Folder containing several repositories

```yaml
repositories:
  - name: api
    path: services/api
    role: service
  - name: web
    path: clients/web
    role: client
starter_materialisation:
  targets:
    - role: api
      repository: api
      path: .
    - role: web
      repository: web
      path: src
```

The last example assumes `services/api` and `clients/web` are independent Git working trees. Target destination paths may not overlap in one repository or enter protected content such as `.git`, `.ewai-pipeline`, `.codex`, `.claude`, `.agents`, the configured SPECS tree, `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, `.env`, `.npmrc`, or `.netrc`.

## Implement a generic source adapter

If you're writing the adapter, use the [authoring reference](reference/starter-adapter-authoring.md) for the complete package and request/acknowledgement contracts. If your organisation supplies one, you can continue directly to validation and registration below.

## Validate and register an adapter

```bash
ewai starter adapter-validate ./starter-source-adapter --project . --json
ewai starter adapter-register ./starter-source-adapter --project . --yes --json
ewai starter adapters --project . --json
```

Validation is read-only. Registration is an explicit trust decision. Review the publisher, source classes, entrypoint, package contents, version, and digests before `--yes`.

The dashboard intentionally cannot register an adapter because that would require sending a filesystem path and executable authority through the browser.

## Prepare, review, and apply

For the dashboard workflow, enable **Starters** in **Configuration** and save first. See [dashboard configuration](operations/dashboard-configuration.md). This only shows the workspace; adapter registration and approval to add files remain separate steps.

List the safe workspace:

```bash
ewai starter status --project . --json
```

Prepare:

```bash
ewai starter preview \
  org.northstar.engineering:application-foundation:service-platform \
  --adapter northstar.approved-source \
  --project . \
  --yes \
  --json
```

The preview contains per-target counts and digests, classifications, repository roles and target roots, expiry, and active personas. It contains no source URL, file body, generated filename, staging root, trusted adapter path, or raw adapter output.

Apply only the current preview:

```bash
ewai starter apply <preview-id> \
  --project . \
  --yes \
  --approved-by "Delivery Owner" \
  --json
```

The caller cannot resend or alter the file plan. EWAI re-resolves accepted Blueprint truth and rechecks adapter bytes, target mappings, Git revisions, staged content, destination state, preview digest, and expiry.

## Understand classifications

| Classification | Meaning | Effect |
| --- | --- | --- |
| `create` | No destination exists | Eligible for additive creation after approval |
| `identical` | A regular destination file has the accepted content digest | Left untouched |
| `conflict` | A destination exists but is different, symbolic, directory, special, protected, or case-equivalent | Blocks the complete application |

EWAI never offers force or merge. Resolve a conflict deliberately outside materialisation, review the resulting project truth, then prepare a new preview.

## Persona engagement and human authority

The dashboard shows the personas engaged for the current moment and why. EWAI selects from:

- relevant project-local personas materialised from the accepted Blueprint;
- installed premium product, delivery, platform, or architecture personas;
- core operator, maintainer, end-user, and SPECS curator lenses.

Review, application, and recovery use different ensembles. Premium content is used only when already installed; this workflow never downloads or updates it.

Personas advise. They do not approve the adapter, accept the product outcome, confirm licensing, certify security, or authorise release. The `--approved-by` person or dashboard approver remains accountable for materialisation.

## Evidence and lifecycle handoff

Successful application writes exact evidence beneath:

```text
SPECS/3.Evidence/starter-materialisations/<attempt-id>.json
SPECS/3.Evidence/starter-materialisations/<attempt-id>.md
```

Evidence records the approved preview, named approver, canonical tree and target digests, repository revisions, repository-relative destinations, result counts, personas, and disclaimer. It is persisted before the attempt becomes completed.

EWAI then publishes `ewai.project.starter.materialised`. The safe event contains only receipt and adapter IDs, aggregate digest, target/repository/result counts, completion time, evidence references, and safe persona projections. Hook failure cannot change materialisation truth.

## Recovery

Normal failure rolls back only content EWAI can prove it created. If a generated file changes after publication, EWAI preserves it and marks the attempt `recovery-required`.

```bash
ewai starter recover <attempt-id> --project . --yes --json
```

Recovery is idempotent and digest-sensitive. It removes only unchanged journal-owned files and empty journal-owned directories. It never removes a changed file merely to make the attempt look clean.

## Implementer checklist

- [ ] Blueprint uses `starter_packs` with unique, non-overlapping logical targets.
- [ ] Canonical digest was produced from the reviewed logical target trees.
- [ ] Licence and compatibility were reviewed by accountable people.
- [ ] Project topology maps every role exactly once across real Git worktrees.
- [ ] Adapter package has a stable publisher, semantic version, and protocol version.
- [ ] Adapter receives credentials through its own approved mechanism, never from EWAI request fields.
- [ ] Adapter writes only regular files beneath staging and does not execute retrieved content.
- [ ] Adapter package validates and is explicitly registered.
- [ ] Preview shows zero conflicts and the expected target/repository counts.
- [ ] Active project, premium, and core persona lenses are appropriate for the moment.
- [ ] Named approval is from someone authorised to add the project foundation.
- [ ] Canonical evidence is retained and reviewed before any later delivery or release decision.

## Related guides

- [Designing Organisation Blueprint Packs](designing-organisation-blueprint-packs.md)
- [Working with personas](working-with-personas.md)
- [Human approval and assurance](human-approval-and-assurance-guide.md)
- [Troubleshooting and recovery](operations/troubleshooting-and-recovery.md)
- [CLI and configuration reference](reference/cli-and-configuration.md)
