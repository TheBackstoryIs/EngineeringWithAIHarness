# Archaeology technology and hosting discovery

Use this capability during Archaeology to turn repository signals and accountable human answers into a governed view of the technology actually used and where it actually runs.

It is designed for inherited systems, poorly documented services, mixed estates and repositories whose deployment files no longer reliably describe production. It supports cloud, on-premises, SaaS, PaaS, IaaS, managed-service and hybrid operating models.

Ask EWAI: “During Archaeology, help me establish which technologies this project uses and where it actually runs.” EWAI prepares a briefing from the repository evidence and asks you to confirm the real operating environment. You review misleading signals, supply evidence and identify what remains unknown. Configuration files alone don't establish what's live.

The command and JSON reference below is for a technical owner who wants to inspect or record the profile directly. In the guided conversation, EWAI prepares the bundle and answer template with you. If you don't own the hosting information, involve the platform or service owner rather than guessing.


<!-- editorial: contents -->
## On this page

- [What it produces](#what-it-produces)
- [Evidence language](#evidence-language)
- [Before you begin](#before-you-begin)
- [Repository topologies](#repository-topologies)
- [Common signals and pack extensions](#common-signals-and-pack-extensions)
- [Prepare the owner briefing](#prepare-the-owner-briefing)
- [Complete the answer template](#complete-the-answer-template)
- [Record the reviewed profile](#record-the-reviewed-profile)
- [Check status and handle drift](#check-status-and-handle-drift)
- [Human review checklist](#human-review-checklist)
- [Required assurance notice](#required-assurance-notice)

## What it produces

The workflow adds five files to the selected Archaeology evidence bundle:

| File | Purpose |
| --- | --- |
| `technology-hosting-brief.json` | Machine-readable Source Map observations, active personas, questions, limitations and preparation digest. |
| `technology-hosting-brief.md` | Human-readable briefing for the owner conversation. |
| `technology-hosting-answers.template.json` | Governed input template for owner declarations and confirmations. |
| `technology-hosting-profile.json` | Attributed reviewed profile preserving observations, answers, contradictions and unresolved questions. |
| `technology-hosting-profile.md` | Human-readable profile and evidence status. |

The workflow does not automatically change the canonical stack strategy, choose a hosting provider, install a technology pack, inspect a live cloud tenant, deploy anything or certify security. A reviewed profile can later support an explicit Archaeology curation decision.

## Evidence language

The profile deliberately separates three kinds of statement:

- `repository-observed`: the Repository Source Map found a file or pack profile that suggests a technology or deployment surface;
- `owner-declared`: a person supplied an answer but did not mark that individual answer as confirmed;
- `human-confirmed`: a person explicitly marked that individual answer as confirmed and supplied the relevant evidence references.

A reviewer name does not confirm every answer. Confirmation is per technology, hosting field, location and environment.

Configuration is never proof of current runtime state. A Terraform file may describe an old experiment. A Salesforce project can be present while a different tenant is live. A CI workflow may no longer be the approved production release route. Keep those signals and record their disposition as `active`, `inactive`, `contradicted` or `uncertain`.

## Before you begin

This isn't a standalone scan for an empty folder. Accept the optional investigation through [existing-project onboarding](existing-project-onboarding-guide.md#choose-whether-to-run-archaeology), then use the bundle that `ewai-archaeology` prepares. The dated bundle path below is an example: replace it throughout with your actual bundle. Don't create an empty directory and expect it to satisfy the persona-routing prerequisite.

1. Complete EWAI initialization and explain the project's purpose.
2. Accept Archaeology; EWAI prepares or selects its bundle under the configured `SPECS/3.Evidence/archaeology/` root.
3. Review EWAI's proposed persona perspectives. The agreed selection is recorded in `persona-routing.yaml`.
4. Put the relevant repositories and extracted platform source in scope, then have EWAI refresh the Repository Source Map. The direct inspection commands are:

```bash
ewai index refresh --project .
ewai index freshness --project . --json
ewai archaeology validate-personas \
  SPECS/3.Evidence/archaeology/2026-08-23-system-baseline \
  --project . --json
```

Preparation refuses a stale Source Map. It does not silently refresh the index because refreshing and analysing repository evidence is a distinct operation the operator should be able to see.

## Repository topologies

Technology and hosting discovery uses the repositories already configured in `SPECS/pipeline.yaml`.

### Single repository

Use one configured application repository. Signals and evidence paths are labelled with that repository name.

### Monorepo

Configure the monorepo once. The Source Map retains paths for each service, application, infrastructure area and package, so the owner can confirm different runtimes or deployment paths by environment.

### Folder containing repository subfolders

Configure each repository subfolder as a named repository under the shared SPECS contract. The discovery profile retains the repository name on every observation instead of flattening the estate into one inferred stack.

This is particularly important when application, infrastructure, CRM and low-code exports live in separate repositories.

## Common signals and pack extensions

EWAI recognises common repository signals for:

- Node.js, Bun, PHP, Python, Go, Rust, Ruby, JVM and .NET projects;
- Nuxt, Next.js, Angular, Vite and Prisma configuration;
- package managers and lockfiles;
- Docker, Docker Compose, Kubernetes and Helm;
- Terraform and Azure Bicep;
- GitHub Actions, GitLab CI/CD, Azure Pipelines and Jenkins;
- Azure, AWS, Google Cloud, Vercel, Netlify, Fly.io, Render, Railway and Heroku-compatible descriptors;
- OpenAPI and GraphQL contracts;
- Microsoft Power Platform and Salesforce project exports.

This catalogue is not a closed list. Installed technology, stack, Organisation Blueprint and project Source Map profiles can match additional file types. Those matches appear as pack-provided `source-map-profile` observations carrying the exact profile ID and analyser metadata. EWAI does not turn that identifier into a more specific claim unless the repository or a human supplies the evidence.

### Power Platform and Salesforce exports

Power Apps and Salesforce can export application or project configuration as archives. Export the material using the platform's supported process, extract the archive into a repository or configured repository subfolder, then refresh the Source Map before preparing discovery.

EWAI does not extract ZIP or `.msapp` archives for you. The extracted folder is evidence supplied by the operator; it is not proof of the tenant, environment, region or live release state. See [Power Platform and Salesforce export analysis](platform-export-analysis-guide.md) for the extraction and indexing boundary.

## Prepare the owner briefing

```bash
ewai archaeology prepare-technology-hosting \
  SPECS/3.Evidence/archaeology/2026-08-23-system-baseline \
  --project . --json
```

Preparation:

- reads only safe Repository Source Map projections;
- detects built-in and pack-provided signals across every configured repository;
- loads the approved persona-routing inventory;
- engages the core Archaeologist and SPECS Knowledge Curator plus relevant confirmed premium, personal and project personas;
- records exactly which personas are active and why;
- produces questions covering actual technology, provider, platform/service, locations, environments, deployment model, operating model, data residency, release route, inactive signals, contradictions and unresolved questions.

Premium personas improve the lenses available when installed and selected. They are not required for the standard workflow, are never downloaded by this command and cannot replace evidence or accountable confirmation. Project-local personas are valuable for organisation-specific hosting, architecture, operations and release responsibilities.

## Complete the answer template

In the guided conversation, answer the briefing questions and check EWAI's proposed record. For direct editing, open `technology-hosting-answers.template.json` in the selected bundle and change its answers, not the generated brief. Preserve `schema` and `preparedDigest`. Confirm each answer only if you have the responsibility and evidence to do so; otherwise ask the appropriate owner.

For example, find an observation in `technology-hosting-brief.json`, copy its actual `ATH-OBS-…` ID into the related answer's `observationRefs`, and record whether the responsible person confirmed it. `ATH-OBS-1234567890` below is illustrative, not an ID you can submit unchanged. If no observation supports a declaration, don't manufacture one.

Each answer supports:

```json
{
  "value": "Microsoft Azure",
  "confirmed": true,
  "observationRefs": ["ATH-OBS-1234567890"],
  "evidence": ["Platform owner confirmation", "Production service inventory"],
  "notes": "Primary production provider"
}
```

Technology items use `category`, `name` and optional `version` alongside the same confirmation and evidence fields. Environments additionally record provider, platform/service, location, deployment model and operating model.

Use `unknown` when the answer is not established. Record the owner of the missing answer in `unresolvedQuestions`. Do not infer a provider, region or data-residency statement from repository configuration.

Supported deployment-model values are:

`cloud`, `on-premises`, `saas`, `paas`, `iaas`, `managed-service`, `hybrid`, `other`, `unknown`.

Supported operating-model values are:

`self-managed`, `provider-managed`, `shared`, `third-party-managed`, `hybrid`, `unknown`.

Use `observationReviews` to mark each misleading or uncertain repository signal. Preserve contradictions explicitly rather than choosing one source and deleting the other.

## Record the reviewed profile

```bash
ewai archaeology record-technology-hosting \
  SPECS/3.Evidence/archaeology/2026-08-23-system-baseline \
  --input SPECS/3.Evidence/archaeology/2026-08-23-system-baseline/technology-hosting-answers.template.json \
  --reviewed-by "Platform owner" \
  --project . --json
```

The input file must resolve inside the project. Recording validates the preparation digest, every observation reference, deployment and operating vocabularies, reviewer identity and the no-overwrite boundary. The two profile files are written as one recoverable file transaction.

After recording, open both `technology-hosting-profile.md` and `.json` in that bundle and check `technology-hosting-status` reports `recorded`. You should see repository observations and owner answers kept separately, including unresolved questions.

Recording does not promote the result into canonical strategy. Use the normal Archaeology review and curation workflow when the profile is ready to support proposed SPECS records.

## Check status and handle drift

```bash
ewai archaeology technology-hosting-status \
  SPECS/3.Evidence/archaeology/2026-08-23-system-baseline \
  --project . --json
```

Status is one of:

- `missing`: no preparation exists;
- `prepared`: the briefing exists and awaits a recorded profile;
- `recorded`: the profile matches the preparation and Source Map run;
- `stale`: the Source Map changed, became stale, or the profile no longer matches its preparation;
- `invalid`: a stored artefact cannot be read or validated.

The status check ignores only this capability's five generated bundle files. Any unrelated indexed file addition, change or deletion makes the result stale.

Preparation does not overwrite existing artefacts unless `--force` is explicitly used. A forced re-preparation never overwrites an existing reviewed profile; instead the old profile becomes stale against the new preparation digest. Preserve the previous bundle when historical traceability matters, and normally create a new dated Archaeology bundle for a new baseline.

## Human review checklist

- Every material runtime, framework, data store, integration and infrastructure component is either recorded or explicitly unknown.
- Provider, platform/service, location, environment, deployment model and operating model are answered separately.
- Data storage, processing, backup and replication locations have an accountable confirmation owner.
- The real release route, approval points and rollback route are recorded.
- Historical and inactive repository signals retain a disposition and explanation.
- Contradictions and unresolved questions remain visible.
- Active personas are visible, relevant and within the approved routing decision.
- No persona or repository signal is presented as stakeholder acceptance, security approval or business truth.

## Required assurance notice

Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.
