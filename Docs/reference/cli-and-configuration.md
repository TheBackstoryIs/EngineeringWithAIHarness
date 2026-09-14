# CLI and configuration reference

This is a compact map of the current public EWAI command families. Use the task-oriented guides for decision and safety context.


<!-- editorial: contents -->
## On this page

- [Invocation](#invocation)
- [Project lifecycle](#project-lifecycle)
- [Premium persona entitlement](#premium-persona-entitlement)
- [Dashboard and MCP](#dashboard-and-mcp)
- [Context-Aware Delivery Companion](#context-aware-delivery-companion)
- [Project and Portfolio Orchestration](#project-and-portfolio-orchestration)
- [Consultancy and Network Rollout Control Plane](#consultancy-and-network-rollout-control-plane)
- [Solution Readiness Review](#solution-readiness-review)
- [Design systems](#design-systems)
- [Governed Starter Packs](#governed-starter-packs)
- [Archaeology](#archaeology)
- [Validation configuration](#validation-configuration)
- [Intents](#intents)
- [Guarded delivery](#guarded-delivery)
- [AFK execution](#afk-execution)
- [Repository index](#repository-index)
- [Mind Palace](#mind-palace)
- [Meeting evidence](#meeting-evidence)
- [Evidence-to-Knowledge Proposals](#evidence-to-knowledge-proposals)
- [Packs and personas](#packs-and-personas)
- [Configuration ownership](#configuration-ownership)
- [Related guides](#related-guides)
- [Choose the correct evidence amendment](#choose-the-correct-evidence-amendment)

## Invocation

Use the command installed for your environment:

```bash
ewai <command>
npx --package @thebackstoryis/engineering-with-ai ewai <command>
```

Most project commands accept `--project PATH`. Use `--json` for machine-readable output. Preserve reported unknown and not-supported states rather than interpreting them as success.

## Project lifecycle

| Command | Purpose |
| --- | --- |
| `ewai install` | Copy or link packaged skills into selected agent hosts. |
| `ewai init` | Create the project locator and initial SPECS contract. |
| `ewai checkin` | Inspect framework, entitlement, dashboard, state, standards, validators, and recent work. |
| `ewai doctor` | Validate project installation and configuration. |
| `ewai discover` | Prepare and, through its approved workflow, create initial Project SPECS. |
| `ewai context register` | Register external evidence with authority and processing constraints. |

Important options:

```bash
ewai install --project . --host auto --mode copy
ewai init --project . --name "Example Product" --specs SPECS --codex
ewai discover --project . --answers discovery.yaml --stack ewai.stack.example
```

`init --force`, `persona create --force`, and similar overwrite flags require inspection and deliberate authority.

## Premium persona entitlement

```bash
ewai persona premium status --project . --json
ewai persona premium sync --project . --yes
```

`status` checks licence access and the installed pack, returning `ewai.persona-entitlement/v1` without keys, persona bodies or raw provider errors. It isn't unconditionally read-only: confirmed expiry of the matching team subscription can block access and remove its unchanged managed premium cache. Edited or unsafe content is preserved but isn't treated as active licensed content. Individual expiry keeps the installed pack and stops updates. An unavailable licence service isn't proof of expiry.

Use `ewai persona premium configure --project .` for hidden key entry. Submitting the key verifies access, saves it privately and attempts to download and install the pack immediately. For a later update or repair, `sync --yes` confirms that operation. Core personas remain available without a subscription, and your own personas aren't removed. See [Set up premium personas](../operations/premium-personas-setup.md) for the user workflow, or [Persona entitlement and pack providers](../persona-entitlement-provider-guide.md) for the archive and verification contract.

## Dashboard and MCP

```bash
ewai dashboard --project .
ewai server start --project .
ewai server status --project .
ewai server stop --project .
ewai mcp --project .
```

The host starts the stdio MCP server. Do not launch a second persistent MCP process for the same project.

Nine optional dashboard views start hidden. Use **Configuration** to choose what you need, or read the current settings before changing them:

```bash
ewai dashboard preferences --project . --json
# Replace DIGEST with the digest returned above.
ewai dashboard configure --enable portfolio --expected-digest DIGEST --yes --project .
```

Use repeated `--enable VIEW` or `--disable VIEW` options, and `--collapse` or `--expand` for the sidebar. View IDs are `portfolio`, `team-hub`, `rollout`, `starters`, `policies`, `security`, `hooks`, `context-inspector` and `phase-studio`. The last two appear as **AI context diagnostics** and **Contributions**. These preferences change navigation, not required checks or approvals. See [Choose what's in your dashboard](../operations/dashboard-configuration.md).

## Context-Aware Delivery Companion

```bash
ewai companion status --project . --json
ewai companion status --focus "Manual QA ownership" --project . --json
```

Status returns the bounded, read-only `ewai.companion-guidance/v1` contract. Its
recommendation class comes from governed execution actions, while installed
project, core, personal and premium persona metadata may supply visible advisory
lenses. The Standard host-model baseline is complete without premium content.

The equivalent MCP tool is `ewai_companion_status` with an optional focus of up to
500 characters. The loopback dashboard uses `GET /api/companion`. Neither surface
accepts a project-root override or exposes a Companion mutation. Begin and continue
controls delegate to the existing guarded dashboard handoff and are rechecked there.

See [Context-Aware Delivery Companion](../context-aware-delivery-companion-guide.md)
for ranking, persona selection, authority boundaries, responsive behaviour and the
implementation contract.

## Project and Portfolio Orchestration

```bash
ewai portfolio validate --project . --json
ewai portfolio status --project . --json
ewai portfolio status --focus "dependency and ownership" --project . --json
```

The canonical manifest is `SPECS/1.Scope/portfolio.yaml` beneath the configured SPECS root. Project members resolve through repository names already owned by `SPECS/pipeline.yaml` plus bounded relative `project_path` values. Status returns the read-only `ewai.portfolio-workspace/v1` contract, including active persona provenance and standard LLM review questions. The equivalent MCP tool is `ewai_portfolio_status`; neither surface accepts a project-root override or mutation.

See [Project and Portfolio Orchestration](../project-portfolio-orchestration-guide.md) for single-repository, monorepo, folder-with-repositories and separately configured repository examples, persona enrichment, recovery and authority boundaries.

## Consultancy and Network Rollout Control Plane

```bash
ewai rollout validate --project . --json
ewai rollout status --project . --json
ewai rollout status --focus "Blueprint drift and security evidence" --project . --json
ewai rollout assurance client-portal --project . --json
```

The canonical policy is `SPECS/1.Scope/rollout.yaml` beneath the configured SPECS root. It assigns existing Portfolio project IDs to governed cohorts and exact Organisation Blueprint baselines, with required structural evidence and named review owners. Repository topology stays in `SPECS/pipeline.yaml` and Portfolio rather than being duplicated here.

Status returns the read-only `ewai.rollout-workspace/v1` contract. The equivalent MCP tool is `ewai_rollout_status` with optional `focus` and `projectId`. Focus changes rerun contextual selection across the installed project, core, personal and premium persona catalogue; missing premium content is nonblocking and never fetched by this command family.

See [Consultancy and Network Rollout Control Plane](../consultancy-network-rollout-control-plane-guide.md) for policy examples, supported topologies, exact Blueprint comparison, evidence interpretation, active-persona disclosure, isolation, recovery and human authority boundaries.

## Solution Readiness Review

```bash
ewai readiness profiles --project . --json
ewai readiness prepare <delivery-slug> --profile <profile-id> --project . --json
ewai readiness review <assessment-id> --input <review-file.json> --reviewed-by "Owner" --project . --json
ewai readiness status <assessment-id> --project . --json
```

Preparation composes current evidence across eleven dimensions: purpose, impact, standards, tests, Manual QA, external validation, security, technology and hosting, operations, documentation, and governance or specialist assurance. It writes a cited briefing and review template without executing scanners, deployment tools or release actions. Review records a named human's decisions as an immutable, digest-bound JSON and Markdown report. Status detects repository, profile, preparation and cited-evidence drift.

Every briefing shows the active persona ID, tier and engagement reason. Standard model reasoning plus installed core and project personas forms the baseline; relevant installed personal and premium personas may be swapped in as the profile or evidence gaps change. Premium content is optional and these commands never fetch or synchronise it.

The result is advisory evidence. It does not approve Manual QA or release, replace security review, change a delivery gate, deploy software or certify a solution. See [Solution Readiness Review](../solution-readiness-review-guide.md) for profiles, evidence states, persona handling, recovery and the Manual QA walkthrough.

## Design systems

```bash
ewai design-system status --project . --json
ewai design-system list --project . --json
ewai design-system inspect <pack-id> --project . --json
ewai design-system resolve <pack-id> --project . --json
ewai design-system validate <candidate-folder> --project . --json
ewai design-system install <candidate-folder> --scope project|personal --expected-digest <digest> --yes --project . --json
ewai design-system select <pack-id> --expected-digest <effective-digest> --approved-by "Owner" --yes --project . --json
ewai design-system apply <delivery-slug> --focus "affected surface" --project . --json
```

Validation is read-only. Installation is exact-digest, non-overwriting, and does not select. Selection is a separate named project decision. Application is available only to an existing UI-bearing delivery, uses bounded context and visible active-persona metadata, and emits an immutable receipt without source or persona bodies. `mandatory-overflow` is non-ready and writes no receipt.

Newly stamped UI deliveries link the returned receipt, reviewed plan, and final persona-guided design cycle through `ewai.prototype-manifest/v3`. Historical v1 and v2 manifests remain readable. Use `ewai prototype-review status|plan-prepare|plan-record|cycle-prepare|cycle-record|compare` for the deterministic review contracts. See the [design-system user guide](../design-systems/design-system-user-guide.md), [persona-guided prototype iteration](../persona-guided-prototype-iteration.md), and [implementation guide](../design-systems/design-system-implementation-guide.md).

## Governed Starter Packs

```bash
ewai starter status --project . --json
ewai starter adapters --project . --json
ewai starter digest application=./reviewed-starter --json
ewai starter adapter-validate ./adapter --project . --json
ewai starter adapter-register ./adapter --project . --yes --json
ewai starter preview <receipt-id> --adapter <adapter-id> --project . --yes --json
ewai starter apply <preview-id> --project . --yes --approved-by "Owner" --json
ewai starter recover <attempt-id> --project . --yes --json
```

`digest` accepts one or more `ROLE=FOLDER` values and returns canonical per-target and aggregate digests without exposing source folders in its output. Adapter registration executes no adapter but records an explicit trusted-code decision. Preview runs the registered adapter in bounded staging and changes no application repository. Apply accepts only the immutable preview ID, confirmation, and named approver; the caller cannot resend a file plan. Recovery removes only unchanged journal-owned content.

Project topology is configured separately:

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

See [Governed Starter-Project Materialisation](../governed-starter-project-materialisation-guide.md) for single-repository, monorepo, multi-repository, adapter protocol, persona, evidence, and recovery guidance.

## Archaeology

```bash
ewai archaeology prepare-personas <bundle> --project .
ewai archaeology validate-personas <bundle> --project .
ewai archaeology prepare-technology-hosting <bundle> --project .
ewai archaeology record-technology-hosting <bundle> --input <project-file.json> --reviewed-by "Owner" --project .
ewai archaeology technology-hosting-status <bundle> --project .
ewai archaeology validate <bundle> --project .
ewai archaeology prepare-review <bundle> --project .
ewai archaeology curate <bundle> --project . --yes --approved-by "Owner"
ewai archaeology validate-completion <bundle> --project .
```

These commands support a prepared Archaeology bundle. The human purpose briefing and conversational investigation come first.

Technology and hosting preparation requires a fresh Repository Source Map and a valid, user-reviewed persona-routing gate. It writes an evidence briefing and answer template into the bundle. Recording distinguishes repository-observed, owner-declared and individually human-confirmed claims; it does not rewrite canonical stack strategy. Status reports drift without refreshing or mutating the index. See [Archaeology technology and hosting discovery](../archaeology-technology-and-hosting-discovery.md).

## Validation configuration

```bash
ewai validation list --project . --orchestrator codex
ewai validation set claude available --enabled --project .
ewai validation set codex unavailable --disabled --project .
ewai validation checkpoint implementation-plan --cycles 2 --validators auto --project .
```

Checkpoint names are `implementation-plan`, `test-plan`, and `code`. Review settings include breadth, depth, and output size. EWAI excludes the current orchestrator from independent validation.

## Intents

```bash
ewai intent create <slug> --domain <domain> --title "Title"
ewai intent map-create request.yaml --project . --yes --approved-by "Owner"
ewai intent audit-state --project .
```

Persona attachments use repeated values shaped as `REF:ROLE:DEPTH` on intent creation.

## Guarded delivery

```bash
ewai delivery begin <slug> --project . --tool codex
ewai delivery status <slug> --project .
ewai delivery continue <slug> --project .
ewai delivery resume <slug> --project . --tool codex
ewai delivery gate-template <slug> <phase> --project .
ewai delivery gate <slug> <phase> --input gate.json --project .
ewai delivery phase-start <slug> <phase> --project .
ewai delivery phase-complete <slug> <phase> --artefact <path> --project .
ewai delivery ratify-amendments <slug> --project . --yes --approved-by "Owner" --scope "Approved amendments"
```

Human gates:

```bash
ewai delivery approve-build <slug> --project . --yes --approved-by "Owner" --scope "Approved scope"
ewai delivery approve-manual-qa <slug> --project . --yes --approved-by "Owner" --evidence <path>
```

Do not use low-level phase and gate commands to manufacture evidence. They exist to record a completed canonical workflow. Amendment ratification is allowed only at the pre-Build boundary, revalidates every completed ledger, and remains separate from Build approval.

External cycle evidence:

```bash
ewai delivery validation-cycle <slug> <phase> \
  --provider claude \
  --outcome pass \
  --response <path> \
  --project .
```

Honour the resolved provider list and cycle limit.

## AFK execution

```bash
ewai afk preflight <slug> --provider auto --parallel 1 --project .
ewai afk start <slug> --provider auto --parallel 1 --timeout-minutes 60 --project .
ewai afk status <run-id> --project .
ewai afk pause <run-id> --project .
ewai afk resume <run-id> --project .
ewai afk cancel <run-id> --project .
```

AFK is constrained by the approved task graph, write sets, commands, leases, evidence, and stop conditions. It is not permission to widen scope.

## Repository index

```bash
ewai index refresh --project .
ewai index status --project .
ewai index freshness --project .
ewai index coverage --project .
ewai index profiles [--source core|technology|stack|organisation|project] [--analyser NAME] [--limit N] --project .
ewai index files [--outcome OUTCOME] [--classification CLASS] [--profile ID] [--repository NAME] [--query TEXT] [--limit N] --project .
ewai index search <query> --limit 20 --project .
ewai index graph <target> --limit 20 --project .
ewai index truth <slug> --limit 20 --project .
ewai index similar <slug> --limit 20 --project .
ewai index standards <target> --project .
ewai index standards-coverage <slug> --project .
```

`coverage`, `profiles`, and `files` are safe Repository Source Map projections. They expose repository-relative evidence and profile provenance without file content, analysis metadata, fingerprints, or repository roots. Registered analyser filters include `inventory-only`, `text-summary`, `structured-keys`, `tree-sitter`, `power-platform-metadata`, and `salesforce-metadata`. Coverage includes an explicit partial-platform count. See [Repository Source Map](../repository-source-map-guide.md) for profile configuration, topology examples, and safety limits, and [platform export analysis](../platform-export-analysis-guide.md) for extracted Power Platform and Salesforce source.

## Mind Palace

```bash
ewai palace refresh --project .
ewai palace status --project .
ewai palace search <query> --limit 20 --project .
ewai palace tidiness --project .
ewai palace housekeeping --project .
```

The Palace is a navigational index of canonical SPECS. Housekeeping changes require review.

## Meeting evidence

```bash
ewai meeting register FILE --project . --yes --label "Product sync" --classification internal --cloud-processing allowed --json
ewai meeting prepare SOURCE_ID --project . --json
ewai meeting review SOURCE_ID --input ./meeting-review.json --reviewed-by "Product Owner" --project . --json
ewai meeting status [SOURCE_ID] --project . --json
ewai meeting promote SOURCE_ID --project . --yes --approved-by "Product Owner" --json
```

Registration supports Markdown, text, VTT and SRT sources and records the absolute path only in private gitignored runtime state. `prepare` returns a processing decision, strict candidate contract and contextual active personas; it makes no model call. When cloud processing is denied or unknown, a hosted agent must use the reported manual-local route and must not inspect the source.

Review input must be a project-relative JSON file containing the exact candidate bundle and one named disposition for every candidate. Promotion is a separate evidence-only confirmation. It writes accepted and amended candidates to paired evidence files but cannot create tasks, intents, requirements, policies, approvals or releases.

See the [Meeting evidence user guide](../meeting-evidence-user-guide.md) and [implementer guide](../meeting-evidence-implementer-guide.md).

## Evidence-to-Knowledge Proposals

```bash
ewai knowledge sources --project . --json
ewai knowledge prepare SOURCE_REF [--focus TEXT] --project . --json
ewai knowledge record SOURCE_REF --input FILE --project . --json
ewai knowledge review BUNDLE_ID --input FILE --reviewed-by NAME --project . --json
ewai knowledge materialise BUNDLE_ID --yes --approved-by NAME --project . --json
ewai knowledge recover BUNDLE_ID --yes --project . --json
ewai knowledge status [BUNDLE_ID] --project . --json
```

The matching MCP tools use the `ewai_knowledge_proposal_` prefix. Preparation is read-only and exposes bounded source context only to the CLI or MCP host; loopback browser preparation strips the context body. Recording writes proposal evidence only. Review must be complete and named. Materialisation is a later named, exact-confirmation decision that adds absent files, recognises identical content and preserves differences as conflicts. Recovery may remove unchanged partial writes only when their recorded digests match. It preserves edits, unsafe paths and older writes without digests, retains the journal and reports `KNOWLEDGE_RECOVERY_REQUIRES_REVIEW`. Recovery requires explicit confirmation and is marked destructive in MCP metadata.

See the [Evidence-to-Knowledge Proposals user guide](../knowledge-proposals-user-guide.md) and [implementer guide](../knowledge-proposals-implementer-guide.md).

## Packs and personas

```bash
ewai pack list
ewai persona index --project . --query <topic>
ewai persona list --project . --query <topic>
ewai persona create <slug> --scope project --project . --name "Name" --category <category>
ewai persona path --scope project --project .
ewai persona premium sync --project . --yes
```

Premium sync is never an automatic check-in action. Obtain explicit consent and preserve managed provenance.

## Configuration ownership

| File | Purpose |
| --- | --- |
| `.ewai-pipeline/project.json` | Runtime locator for project and configured SPECS root |
| `SPECS/pipeline.yaml` | Durable project, repositories, packs, approvals, and validation policy |
| `.mcp.json` | Claude Code project MCP entry |
| `.codex/config.toml` | Codex project MCP entry |
| `.agents/mcp_config.json` | Google Antigravity project MCP entry |

Do not store secrets in these examples or commit runtime logs and SQLite state as project truth.

## Related guides

- [Installation, updating, and entitlements](../operations/installation-updating-and-entitlements.md)
- [Dashboard and delivery state](../operations/dashboard-and-delivery-state.md)
- [Troubleshooting and recovery](../operations/troubleshooting-and-recovery.md)

## Choose the correct evidence amendment

Use [Which amendment operation?](../completed-phase-evidence-amendments.md#which-amendment-operation) to distinguish pre-Build `ratify-amendments` from `evidence-amendment` for stale nested evidence references. They aren't interchangeable, and neither supplies approval to implement or release.
