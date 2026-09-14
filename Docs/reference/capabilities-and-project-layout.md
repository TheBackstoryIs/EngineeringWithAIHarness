# Capabilities and project layout

Use this reference when you need the detail behind a particular EWAI capability or want to understand its project files. For first use, follow [your first session](../tutorials/first-session.md). The [guide catalogue](../guide-catalogue.md) links the focused operating guides.

Use the section links to look up a capability, its boundaries and the relevant files. You don't need to configure every optional capability before you start. Operating guides explain the user workflow; linked implementation references describe the host and integration contracts.


<!-- editorial: contents -->
## On this page

- [Initialise a project](#initialise-a-project)
- [Enrich a project from supplied context](#enrich-a-project-from-supplied-context)
- [Understand an existing project with Archaeology](#understand-an-existing-project-with-archaeology)
- [Shape enterprise and solution architecture](#shape-enterprise-and-solution-architecture)
- [Check code against project standards](#check-code-against-project-standards)
- [Discover and define the project](#discover-and-define-the-project)
- [Create an intent](#create-an-intent)
- [Discover packs and personas](#discover-packs-and-personas)
- [Project configuration](#project-configuration)
- [Delivery stages and retrospective learning](#delivery-stages-and-retrospective-learning)
- [The EWAI companion](#the-ewai-companion)
- [Technology and stack packs](#technology-and-stack-packs)
- [Design-system capabilities](#design-system-capabilities)
- [Portfolio and rollout coordination](#portfolio-and-rollout-coordination)
- [Project-local SQLite, dashboard, and MCP](#project-local-sqlite-dashboard-and-mcp)
- [Why SPECS/ and SQLite are separate](#why-specs-and-sqlite-are-separate)

## Initialise a project

From anywhere, provide the project path explicitly:

```bash
ewai init --project /path/to/project --name "Example Product" --codex
ewai doctor --project /path/to/project
```

Or run from inside a Git repository:

```bash
cd /path/to/project
ewai init
ewai doctor
```

For a workspace containing several independent repositories, keep the runtime locator at the workspace root and place SPECS in a dedicated knowledge repository:

```bash
cd /path/to/workspace
ewai init --name "Example Product" --specs project-knowledge/SPECS --init-specs-repo
```

EWAI records `project-knowledge/SPECS` in `.ewai-pipeline/project.json`, so launching from `workspace/api`, `workspace/web`, or another child repository still resolves the shared project. The generated pipeline initially registers `project-knowledge` as the `knowledge-and-delivery` repository; add the workspace's application, infrastructure, and documentation repositories during setup. `--init-specs-repo` initializes that containing folder as a local Git repository but does not create or publish a remote. EWAI recommends this dedicated-repository layout for multi-repository products. A single repository or monorepo should normally keep the default `./SPECS` layout.

Default initialisation creates:

```text
project/
├── SPECS/
│   ├── pipeline.yaml
│   ├── 1.Scope/{domain,personas,api,research,handoffs,templates}/
│   ├── 2.Purpose/{intents,journeys,explorations,discussions,requirements}/
│   ├── 3.Evidence/{archaeology,context-imports,retros,postmortems,gates,iteration-logs,risk}/
│   ├── 4.Constraints/compliance/
│   ├── 5.Strategy/{architecture,decisions,options,sops,runbooks,capsules}/
│   └── 6.Build/
└── .ewai-pipeline/
    ├── .gitignore
    ├── data/pipeline.sqlite
    ├── logs/
    ├── runtime/
    └── project.json
```

Initialisation preserves existing files unless `--force` is explicitly supplied.

It also safely merges project MCP entries for the three supported hosts:

```text
.mcp.json                 Claude Code
.codex/config.toml        Codex
.agents/mcp_config.json   Google Antigravity / AGY CLI
```

Each host launches the same project-bound `ewai mcp --project .` stdio server. Existing host settings and MCP servers are preserved.

Before creating EWAI artefacts, initialization checks for existing source files, manifests, and project definitions. The conversational companion first captures a human project briefing, then optionally asks whether the user has a folder of emails, meeting transcripts, documentation, research, requirements, or other project material that could enrich the project. For an existing codebase, EWAI offers optional Archaeology. If the owner accepts, it compares the confirmed purpose and reviewed imported context with repository evidence before deeper reconstruction. A fresh project uses the same context to make discovery more specific.

`--claude`, `--codex`, and `--antigravity` record validation CLIs that the user has explicitly confirmed are available and initially enabled. Antigravity access uses the `agy` executable. These flags do not install or authenticate those services. At delivery time EWAI excludes the active orchestrator from the independent reviewer set.

## Enrich a project from supplied context

During setup, EWAI can register a user-supplied folder of project material without copying its raw contents into the repository. It asks about authority, exclusions, data classification, and whether the current AI provider may process the content before opening any files. Absolute paths and detailed filenames stay in the gitignored `.ewai-pipeline/` runtime; SPECS receives sanitized source metadata, evidence-backed findings, and reviewed knowledge.

After a bounded initial scan, EWAI compares the perspectives needed by the material with a compact index of the core, premium, personal, and project personas actually installed. It tells the user which available personas would improve the analysis, assigns a small ensemble to different passes, records missing perspectives, and switches lenses as the evidence moves between product, user, architecture, operations, security, data, and assurance concerns.

Installed personas are analysis aids. They are not evidence about the project's users. When emails, transcripts, or documents reveal real actors, responsibilities, goals, frustrations, environments, or decision authority, EWAI proposes evidence-linked project personas for review under the Context Import bundle. Accepted personas are promoted into `SPECS/1.Scope/personas/project/`.

Context Import can reconstruct:

- project language, actors and stakeholder relationships;
- intents, journeys, workflows, requirements and success measures;
- options, decisions, rationale and later supersession;
- constraints, risks, incidents, dependencies and open questions;
- candidate architecture records, ADRs, standards, SOPs and runbooks.

It distinguishes something being stated, proposed, agreed, decided, implemented, superseded, contradicted, inferred, or unknown. This prevents meeting conversation from silently becoming project truth.

```text
SPECS/3.Evidence/context-imports/<date>-<subject>/
├── source-registration.yaml
├── report.md
├── evidence-ledger.yaml
├── persona-routing.yaml
├── actors-and-persona-candidates.md
├── decisions-and-options.md
├── open-questions.md
└── proposals/SPECS/
```

## Understand an existing project with Archaeology

Archaeology is optional. If you decline it, continue Discovery with known gaps recorded; the reconstruction and curation steps below don't apply. See [existing-project onboarding](../existing-project-onboarding-guide.md).

When EWAI detects existing code, it establishes why the project exists, who it serves, desired outcomes, business context, constraints, and non-goals before deep investigation. Archaeology starts with reconnaissance, presents its inferred understanding for correction, and proceeds only when material purpose differences have been resolved.

Archaeology uses the free **EWAI Archaeologist** and **SPECS Knowledge Curator** personas. After initial reconnaissance—and before deep agents run—it inventories the installed core, premium, personal, and project persona libraries, assesses which perspectives would improve each bounded pass, shows the user a concise recommended ensemble, records gaps, and asks for confirmation. The complete persona-routing checkpoint is retained as evidence and must validate before deep analysis proceeds. Installed personas are reasoning lenses rather than evidence about real users.

After the Source Map and technology/hosting evidence are current, Archaeology prepares a seven-dimensional evidence-depth run. A named owner selects depth independently for each concern and explicitly groups every stable gap before the deep passes claim an agreed boundary. Repeated runs compare governed inputs, evidence, personas, depth, coverage, gaps, and grouping in causal order. The standard model with core and project personas remains complete without premium content; premium personas are used only when already installed and relevant.

### What reconstruction covers

Archaeology examines the agreed project boundary using source code, tests, schemas, configuration, Git history, existing and deleted documentation, imported context, supplied operational evidence and attributed human testimony. For a whole-project request, reconnaissance is only the first pass: the goal is detailed reconstruction of every material capability, not a lightweight assessment.

The proposed SPECS records cover:

- people and purpose: personas, intents, workflows, journeys and requirements;
- engineering and governance: risks, constraints, architecture, integrations, patterns, ADRs, decisions and options;
- operation and history: SOPs, runbooks, operational procedures, historical Build records, incidents, retrospectives and learning.

Security and code quality receive separate evidence-led reviews. These are static reviews, not penetration testing or certification. Material findings become proposed risks, constraints, technical-debt entries, patterns, decisions and remediation candidates, as appropriate.

In Claude Code, the bounded defensive security pass uses the current `opus` alias and retries once with `sonnet` if Opus is unavailable or refuses the pass. A refused pass remains incomplete, rather than being reported as a successful review.

Reports, catalogues, indexes and ledgers help you navigate the reconstruction; they aren't substitutes for the individual records. Each capability is examined across Scope, Purpose, Evidence, Constraints, Strategy, Build and the applicable fourteen delivery stages.

Project-wide reconstruction also covers the risk register, integration catalogue, persona library, architecture set, pattern library, ADR index, options register, standards, SOPs, runbooks, observability, recovery, deployment history, technical debt and incidents. Missing evidence remains a recorded gap or owned exception, not invented history.

Progress updates describe the investigation in human terms—for example, “Looking for user processes” or “Reviewing the database structure”. Detailed commands and scan output are available when needed to understand a decision or failure.

It also reconstructs the evidenced technology stack: languages, frameworks, runtimes, package managers, data stores, infrastructure, CI, deployment targets, and versions. Technology is labelled as declared, observed, inferred, inactive, or unknown. Matching EWAI technology packs are proposed, not silently enabled.

Each investigation creates a review bundle:

```text
SPECS/3.Evidence/archaeology/<date>-<subject>/
├── report.md
├── evidence-ledger.yaml
├── coverage-ledger.yaml
├── capability-catalog.yaml
├── specs-reconstruction-ledger.yaml
├── archaeology-artifact-manifest.yaml
├── persona-routing.yaml
├── review-guide.md
├── review-decisions.yaml
├── review-question-plan.yaml
├── open-questions.md
├── analysis/
└── proposals/SPECS/{1.Scope,2.Purpose,3.Evidence,4.Constraints,5.Strategy,6.Build}/
```

Observed facts, corroborated findings, inferences, contradictions, and unknowns remain distinct. Implemented choices can become proposed reconstructed decisions, but alternatives are described as historically considered only when repository or human evidence supports that claim. Before review, a validator requires every capability and project-wide record family to have an individual detailed proposal or an evidenced, owned exception. It rejects summary-only bundles and reused composite proposal paths.

Once validation passes, EWAI offers either self-review and manual filing or an AI-guided high-level walkthrough with drill-down into every proposed record. For the guided route, it synthesizes cross-record questions so one answer can resolve the same underlying decision across a clearly listed set of personas, workflows, ADRs, constraints, and risks. It distinguishes clarification from approval and splits records when the answer does not genuinely apply to all of them. The user can accept, correct, reject, or defer findings. If the user then asks EWAI to file accepted material, automatic curation preflights every destination, refuses to overwrite differing canonical knowledge, and records provenance in a curation ledger.

### Choosing future work

After curation, you can choose a separate discussion of future work—even if the findings have already produced remediation intents. EWAI offers to:

- interview you about upcoming work;
- interpret a roadmap or feature list you supply;
- suggest evidence-based improvements to features, experience, integrations, operations, security, resilience, testing, observability, code quality and maintainability.

Your choice or decline is recorded in `future-work-transition.yaml`. Recommendations remain proposals in the Archaeology bundle until you accept them. Accepted ideas that still need shaping become discovery requests under `SPECS/2.Purpose/explorations/feature-candidates/`. Full intents require your approval and testable outcomes, personas, journeys, acceptance evidence, constraints, dependencies and open decisions. Archaeology doesn't modify application code.

## Shape enterprise and solution architecture

Ask the AI companion to use `$ewai-architecture` when the project needs to understand or decide architecture for the whole enterprise or solution, a bounded capability or domain, one or more intents, or a cross-cutting concern such as data, integration, security, resilience, identity, observability, or deployment.

The walkthrough begins with business purpose and scope, then assesses applicable business/capability, domain/information, application/service, integration, technology/deployment, security/trust, operations/resilience, and governance/evolution viewpoints. It can describe an evidenced current state, develop a proposed target state, or map the transition between them. Existing code and reviewed Archaeology evidence prove current implementation; they do not silently become intended policy.

If the entitled premium library is installed, EWAI prefers its `enterprise-architect` persona and can add a small ensemble of other installed perspectives. It never reconstructs a missing premium persona or treats persona opinion as project evidence.

Each walkthrough creates a review bundle:

```text
SPECS/3.Evidence/architecture/<date>-<scope>/
├── scope.yaml
├── evidence-ledger.yaml
├── viewpoint-matrix.yaml
├── persona-routing.yaml
├── current-state.md
├── target-state.md
├── transition-and-gaps.md
├── open-questions.md
├── review-ledger.yaml
└── proposals/SPECS/
```

EWAI produces individual proposed standards, patterns, ADRs, options, risks, integration records, architecture views, diagrams, runbooks, and transition decisions rather than hiding them in one narrative report. Every diagram retains an editable text source and an accessible explanation. The user can review and file records manually or use a guided walkthrough; only records receiving explicit accountable approval move into canonical SPECS. Accepted constraints and standards become binding inputs to `$ewai-deliver` and `$ewai-standards-check`. Architecture never starts Build or implementation by itself.

## Check code against project standards

Ask the AI companion to use `$ewai-standards-check` against code pasted into the conversation, one or more files, a directory, a change set, or the whole repository. The skill builds an applicability matrix from accepted project constraints, standards, architecture, patterns, decisions, requirements, and gate evidence under `SPECS/`; it does not invent a generic baseline when project standards are missing.

Every run creates a Markdown report under:

```text
SPECS/3.Evidence/reviews/standards/<date>-<target>-standards-check.md
```

The report records the standards baseline, code revision, inspected scope, exclusions, validation commands, passes, non-conformities, warnings, unresolved evidence, and conflicting standards. Repository-wide reviews must disclose partial or sampled coverage and cannot report unqualified compliance. A standards check is review-only unless the user also asks for fixes, and its report supports a delivery gate without silently passing that gate.

## Discover and define the project

After initialization, run the structured project interview:

```bash
ewai discover --project /path/to/project
```

For repeatable or automated setup, copy `templates/discovery-answers.yaml`, complete it, and run:

```bash
ewai discover --project /path/to/project --answers discovery-answers.yaml
```

Discovery populates the established Engineering With AI Project SPECS: scope and context in `1.Scope`, intent and discovery notes in `2.Purpose`, success and risk evidence in `3.Evidence`, confirmed project rules in `4.Constraints`, and approach/stack/options in `5.Strategy`.

For an existing repository, a repeated interview, or a context-cost review, use the optional evidence-depth workflow from Guided Setup or run `ewai archaeology depth-prepare`. It makes the seven concern-specific recommendations, coverage, stable gaps, adaptive questions, and actively engaged personas visible before a named person records the exact investigation boundary. Use `depth-compare` to explain repeated-run differences without rerunning repository analysis.

Candidate minimum standards stay under `5.Strategy/options/` until accepted. Candidate compliance obligations stay under `3.Evidence/risk/` until a qualified owner confirms and promotes them into `4.Constraints/compliance/`.

When the owner chooses Archaeology for an existing codebase, it discovers the observed stack and presents it for confirmation. For a new project, Discovery first establishes product shape, deployment needs, team capability, data and integration constraints, assurance, scale, and operational ownership. It then explains suitable installed packs and trade-offs, allowing the owner to select a pack, record custom technology, or keep the decision explicitly open. Laravel, Nuxt, and Laravel-Nuxt provide framework detection and baseline commands. Power Platform and Salesforce provide suggestion-only format detection and bounded local metadata analysis after explicit selection; they do not extract, connect, import, or deploy. Accepted project standards, patterns, and ADRs remain the binding source.

External-validation availability can be changed later without rerunning discovery:

```bash
ewai validation list --project /path/to/project --orchestrator claude
ewai validation set claude available --enabled --project /path/to/project
ewai validation set codex available --enabled --project /path/to/project
ewai validation set antigravity available --enabled --project /path/to/project
ewai validation checkpoint implementation-plan --cycles 2 \
  --validators codex,antigravity \
  --breadth capability \
  --depth issues-and-fixes \
  --output medium \
  --project /path/to/project
```

Availability records what the project can access; `enabled` records what the project chooses to spend. Each implementation-plan, test-plan, and code checkpoint independently controls its reviewers, maximum review/fix cycles, breadth, analysis depth, and output size. The active orchestrator is excluded from independent validation. Unsupported stages remain visible in delivery state and must not be marked passed.

The EWAI method is provider-neutral. One capable AI can run the workflow without pretending self-review is independent; additional Claude CLI, Codex CLI, or Antigravity (`agy`) systems can provide independent perspectives where available and proportionate. Standards compliance is always required, even when no external validator is configured.

## Create an intent

Create a project-local intent and attach one or more personas:

```bash
ewai intent create supplier-renewal \
  --project /path/to/project \
  --domain supplier-management \
  --title "Supplier Renewal" \
  --persona ewai.core.end-user:primary:5 \
  --persona project.finance-controller:consulted:3
```

Persona attachments use this form:

```text
<persona-reference>:<role>:<depth>
```

Depth ranges from `1`, awareness, to `5`, a burning evidence-grade need. Persona attachments inform design and acceptance; they do not grant application permissions.

Personas are focused lenses, not substitutes for stakeholders. They help surface relevant questions and specialist perspectives when the right people cannot be present throughout a delivery cycle. Evidence from real people always takes priority, and personas should make uncertainty visible rather than inventing user authority.

The resulting intent is written to:

```text
SPECS/2.Purpose/intents/supplier-management/supplier-renewal.md
```

For a broader idea or workflow, ask the companion to **explore the idea and shape connected intents**. `$ewai-shape-intents` uses project evidence and, when installed, the premium Product Owner persona to lead a one-question-at-a-time conversation. It proposes outcome-led slices and their dependencies, asks the user to revise or approve the map, then atomically creates:

```text
SPECS/2.Purpose/explorations/intent-maps/<map>.{md,json}
SPECS/2.Purpose/intents/<domain>/<intent>.{md,json}
```

Each intent stores its map membership and direct relationships in both Markdown frontmatter and adjacent JSON. SQLite projects the same state for the dashboard, where the slideout shows the intent map and connections. The resulting intents remain drafts; the user chooses which one to refine through `$ewai-intent`, and delivery does not begin automatically.

## Discover packs and personas

List installed packs:

```bash
ewai pack list
```

Search free personas:

```bash
ewai persona list --query operator
ewai persona list --query archaeology
ewai persona list --query specs
```

Create a reusable persona in your own library, or create one that belongs to a specific project:

```bash
ewai persona create security-reviewer --name "Security Reviewer" --category engineering
ewai persona create finance-controller \
  --scope project \
  --project /path/to/project \
  --name "Finance Controller" \
  --category finance
```

Use `ewai persona path` to locate your personal library at `~/.ewai/personas/`. Project personas live in `SPECS/1.Scope/personas/project/` and can be shared through the project's version control.

EWAI keeps persona ownership explicit:

- Core personas are maintained by EWAI and included with the framework.
- Premium personas are installed from an entitled pack whose source directory is named `premium-personas`.
- Personal personas are owned by an individual and reusable across their projects.
- Project personas are owned by a project or team and stored in its SPECS structure.

Commercial persona packs are not included in the public repository. They are distributed separately through the entitlement and pack-distribution mechanism, keeping premium content out of public Git history. Installed premium files are managed as a local pack cache rather than copied into project-owned SPECS.

Inspect access, installation and local verification without downloading content:

```bash
ewai persona premium status --project . --json
```

After explicit user consent, the existing synchronisation command acquires and verifies the offered install, repair or update:

```bash
ewai persona premium sync --project . --yes
```

Premium personas are delivered exclusively by Conversational Coding using your licence key. Run `ewai persona premium configure --project .` for private setup. A missing key offers setup without blocking the core harness. Website acquisition remains separate from core staging, manifest/content validation, receipts, atomic promotion and recovery. See the [persona entitlement and pack provider guide](../persona-entitlement-provider-guide.md).

## Project configuration

The configured SPECS root's `pipeline.yaml` binds EWAI to the project. `.ewai-pipeline/project.json` is the lightweight workspace locator:

```yaml
schema: ewai.project/v1
project:
  name: Example Product
specs:
  root: project-knowledge/SPECS
repositories:
  - name: knowledge
    path: project-knowledge
    role: knowledge-and-delivery
  - name: api
    path: api
    role: backend
skills:
  namespace: ewai
  profile: full
packs:
  - ewai.core
approvals:
  build: required
  destructive_operations: required
validation:
  standards:
    required: true
    allow_waiver: false
  external:
    policy: configured
    independent_only: true
    providers:
      claude:
        state: available
        enabled: true
      codex:
        state: available
        enabled: true
      antigravity:
        state: unavailable
        enabled: false
    checkpoints:
      implementation-plan:
        enabled: true
        max_cycles: 2
        validators: auto
        review:
          breadth: capability
          depth: issues-and-fixes
          output: medium
      test-plan:
        enabled: true
        max_cycles: 2
        validators: [codex]
        review:
          breadth: capability
          depth: issues-and-fixes
          output: medium
      code:
        enabled: true
        max_cycles: 3
        validators: auto
        review:
          breadth: change-set
          depth: analysis-and-recommendations
          output: large
```

Multi-repository products can register separate frontend, backend, infrastructure, and documentation repositories using paths relative to the project root.

## Delivery stages and retrospective learning

`config/delivery-stages.yaml` is the portable contract for the fourteen-stage EWAI delivery loop:

```text
Ideate → Intent → Reconcile → Plan → Pattern Validation → Test Plan
→ External Plan Validation → External Test-Plan Validation → Build
→ Standards Sweep → Test Execute → External Code Validation → Delivery → Retro
```

UI Design and Fit Check are conditional adjuncts. Manual QA is the human gate between Delivery and Retro.

Definition of Ready and Definition of Done are project-owned contracts. EWAI can recommend a baseline from the selected technology and assurance context, but the team decides what evidence its work must satisfy.

External-validation stages use only providers explicitly marked `available` and `enabled` in the project's `SPECS/pipeline.yaml`, filtered per checkpoint and with the active orchestrator removed. Each delivery snapshots that resolved policy into `SPECS/6.Build/<slug>/delivery-state.json`; each review/fix cycle is then hashed into the phase's `validation-cycles.json`. When no independent provider remains, the stage is `not-supported`; EWAI does not pretend that self-review was independent validation.

The Phase 10 Standards Sweep is separate and non-negotiable. It always verifies delivered code against accepted project-local SPECS standards, regardless of external-provider availability or token-efficiency settings.

### Bounded unattended Build execution

After explicit Build approval and entry into Phase 9 Build, EWAI can run validated AFK tasks through a local conductor. This is not a second workflow and it does not ask an AI whether work is “done.” It derives readiness from `task-graph.json`, granular task evidence, durable delivery state, and execution leases.

```bash
ewai afk preflight my-intent --provider auto --parallel 2
ewai afk start my-intent --provider auto --parallel 2 --timeout-minutes 45
ewai afk status
ewai afk pause <run-id>
ewai afk resume <run-id>
ewai afk cancel <run-id>
```

Each task runs on a real task branch in an isolated Git worktree using an enabled local Claude, Codex, or Antigravity CLI. Concurrency never exceeds the validated task graph. Workers cannot own central delivery state or merges; the conductor enforces write sets, captures structured evidence, obtains a fresh-context review, merges in declared order, and runs post-merge verification before committing. Runtime state and raw provider logs live under ignored `.ewai-pipeline/afk/`; task reports and hashed evidence remain under `6.Build/<slug>/tasks/` in the configured SPECS repository.

AFK detects topology from the configured `pipeline.yaml`. A simple project maps tasks to its single repository. A multi-repository project maps each task's `repo` to a named configured repository, creates and integrates its task branch there, and commits canonical evidence in the repository containing the configured SPECS root. The workspace itself does not need to be a Git repository. `task-graph.json.repository_branches` can declare different integration branches per repository; its scalar `parent_branch` remains the backwards-compatible default. When a declared integration branch does not exist, `afk start` creates it from that repository's clean current branch. Preflight blocks missing mappings, ambiguous SPECS ownership, nested non-root repository paths, dirty repositories, detached heads, or drift from an integration branch that already exists instead of guessing. A completed AFK run means eligible Build tasks were integrated; the canonical Build gate, Standards Sweep, Test Execute, external code validation, Delivery, Manual QA, and Retro still run normally.

Retro writes its evidence under `SPECS/3.Evidence/retros/` and routes accepted learning back into the applicable project-local context, personas, intents, journeys, constraints, standards, patterns, ADRs, stack guidance, templates, validators, and technology packs. Retrospective learning happens for each completed unit of work, not only at the end of a sprint or programme. The `ewai-deliver` runtime enforces the fourteen-stage order and will not enter Build without durable, explicit human approval.

## The EWAI companion

The primary interface is one command:

```bash
ewai
```

For a new workspace, EWAI first asks where to keep SPECS and initializes it after you agree. Check-in follows initialization and returns the local dashboard link, framework update status and premium-persona status.

First-run onboarding then covers your optional persona learning or setup choice, the project briefing and source-processing decisions. For existing code, EWAI offers Archaeology; you can decline and continue with Discovery and Doctor. Chosen licence setup is settled before an accepted investigation starts. See [your first session](../tutorials/first-session.md) and [existing-project onboarding](../existing-project-onboarding-guide.md) for the full walkthrough.

For a returning project, check-in uses the existing configuration and recent work. It doesn't repeat first-run onboarding or download premium updates without your approval. Configuring a licence is an explicitly chosen action that verifies and installs immediately; routine check-in isn't that action.

At a session decision point, you see the returned status and numbered actions. For example, when work exists but no premium licence is configured:

```text
What would you like to do?

[1] Capture something new
[2] Pick up an intent that can move forward
[3] Explore an idea and shape connected intents
[4] Explore the Mind Palace, risks, or standards
[5] See recommendations and possible next work
[6] Continue a piece of work
[7] Read about premium personas
[8] Set up premium personas
[9] Configure the dashboard

What's on your mind?
```

You can respond naturally: “continue that”, “what is blocking it?”, “I want to add audit logging”, “pick up this intent”, or “move this forward”. The numbered actions provide shortcuts; they don't limit the conversation.

Without existing work, [6] is absent. With available premium access and a verified installed pack, [7] and [8] are absent; licence management remains in Configuration. [9] remains available, and the remaining identifiers aren't renumbered. A missing-licence setup question can follow the menu, but you can decline it.

Conversational actions use the same guarded project-local operations as the dashboard and optional commands. Before moving work forward, EWAI checks the current stage, required documents, evidence, approvals, tests and configured external validators, then explains the proposed next step.

Running `ewai` refreshes the selected host's managed EWAI skills and launches the conversational companion in an available Claude Code, Codex or Google Antigravity host. Initialization adds a small managed instruction block so directly opened agent sessions use the same check-in. The lower-level commands remain available for scripts and integrations; you don't need to learn them to work conversationally.

## Technology and stack packs

A technology pack can provide:

- Repository detection rules.
- Framework and language compatibility.
- Install, build, lint, test, and deployment commands.
- Standards and validation guidance.
- Deployment-target references.

The Power Platform and Salesforce technology packs also select reviewed,
EWAI-owned metadata analysers for already-extracted local source. Detection only
suggests these packs. Selection is human-controlled, and the packs cannot run
vendor tools or supply executable analyser modules. See
[Power Platform and Salesforce export analysis](../platform-export-analysis-guide.md).

A stack pack composes several technology packs. For example, `ewai.stack.laravel-nuxt` combines independently deployable Laravel and Nuxt repositories without duplicating their individual guidance.

Technology and stack packs do not own project starting content. Organisation Blueprint Governed Starter Packs carry the reviewed source receipt, canonical logical-tree digest, licence, compatibility, and target roles. Project topology then maps those roles into a single repository, a monorepo, or a folder containing multiple Git repositories. See [Governed Starter-Project Materialisation](../governed-starter-project-materialisation-guide.md).

## Design-system capabilities

Design-system packs are separate from technology stacks and governed starter content. They carry reusable experience, principle, foundation, token, component, interaction, content, state, responsive, accessibility, motion, prohibited-pattern, and review guidance. Projects can use the clearly labelled bundled fallback or explicitly select a project root and dependency graph by reviewed digest. Organisation Blueprints may recommend design-system IDs but never install or select them.

During UI Design, the guided workflow has separate preparation and review steps:

1. `ewai-design-system-apply` prepares bounded design context, shows the relevant installed personas and saves an immutable receipt without persisting the model payload.
2. `ewai-prototype-iteration` reviews the plan, then selects relevant personas independently for each rendered-design cycle. Findings stay separate from their assessed responses.
3. You review material trade-offs and choose a design. Iteration is bounded; unresolved concerns don't become approval merely because the cycle limit was reached.
4. `ewai.prototype-manifest/v3` links the design receipt, reviewed plan and final cycle.
5. `ewai-design-system-review` compares the result with the recorded guidance, distinguishing alignment, separately approved deviations, unresolved findings and missing evidence.

Start with the [screen prototype creation guide](../screen-prototype-creation-guide.md), [design-system user guide](../design-systems/design-system-user-guide.md) or [prototype iteration guide](../persona-guided-prototype-iteration.md). The [implementation guide](../design-systems/design-system-implementation-guide.md) contains the host integration contracts.

## Portfolio and rollout coordination

Project and Portfolio Orchestration is a separate read-only coordination layer. A canonical portfolio manifest maps portfolio, programme and project ownership onto those configured repositories without centralising child approvals or delivery state. Standard host-model reasoning works with the bounded snapshot and installed project/core personas; relevant installed premium personas can enrich the active ensemble. See [Project and Portfolio Orchestration](../project-portfolio-orchestration-guide.md).

The Consultancy and Network Rollout Control Plane builds on that safe Portfolio topology. A canonical rollout policy assigns project IDs to cohorts and exact Organisation Blueprint baselines, projects structural evidence without raw client content, and routes every unresolved adoption or assurance decision to a named human. Standard host-model reasoning is sufficient; relevant premium personas can enrich the review only when already installed. See [Consultancy and Network Rollout Control Plane](../consultancy-network-rollout-control-plane-guide.md).

## Project-local SQLite, dashboard, and MCP

EWAI ships a Node runtime and database migrations; it does not ship a pre-populated customer database. `ewai init` creates a fresh project-local SQLite database, and `ewai checkin` starts or reuses a loopback Node server for that project.

The current runtime layout is:

```text
.ewai-pipeline/
├── data/
│   └── pipeline.sqlite
├── logs/
├── runtime/
└── project.json
```

The SQLite database belongs to the project runtime and is gitignored. SQLite WAL files, future repository indexes, process logs, and active-session records are not suitable for Git merging.

The Node server resolves the current project, reads `SPECS/pipeline.yaml`, and opens that project's `.ewai-pipeline/data/pipeline.sqlite`. This prevents one global installation from mixing data between businesses or repositories.

The normal route is to run `ewai`, which opens the selected AI host and performs an interpreted check-in before beginning the conversation. A directly opened agent session uses the managed project instruction to perform the same check-in. The runtime can also be controlled explicitly:

```bash
cd /path/to/project
ewai dashboard
ewai server status
ewai server stop
```

### Dashboard navigation and delivery actions

The dashboard binds only to `127.0.0.1`, chooses a stable project-specific port and reuses a healthy existing process. Use its category counts, search, sprint and completion filters, compact Kanban cards, independently scrolling lanes and intent drawer to find work in a large project.

The drawer's **Move this forward** rail shows the actions permitted by the recorded evidence. Depending on the work's current state, you can queue it for the companion, record explicit Build approval, enter guarded Build, run AFK preflight or start bounded unattended delivery. Active conductor controls let you pause, resume or cancel safely.

These actions use the same guarded domain functions as MCP and CLI. They don't allow raw phase or completion edits. Optional views are enabled in **Configuration**; you don't need all of them for an ordinary project.

### Optional coordination views

The dashboard’s **Portfolio** workspace uses a responsive programme line and selected-context rail to show hierarchy, declared dependency direction, child evidence freshness, attention ownership, standard LLM review questions and actively engaged persona names, tiers, matched signals and reasons. It is read-only and exposes no child Build, Manual QA, risk, deployment or release action.

The dashboard's **Team Hub** workspace keeps single-contributor mode as the default. It exposes the exact outbound disclosure contract, stores only an endpoint and token environment-variable name, requires deliberate publication, and shows failed attempts separately from accepted transport receipts. Connected contributors can also discover, inspect and explicitly install exact immutable Organisation Blueprint and design-system releases from the optional registry. The separately operated hub does not centralise SPECS, source code, gate authority or production execution, and resource installation never selects or applies a pack. See the [Team Hub guide](../team-hub-guide.md) and [Resource Registry guide](../team-hub-resource-registry-guide.md).

The dashboard's **Companion** workspace provides a responsive decision runway over the same bounded `ewai.companion-guidance/v1` contract exposed by check-in, CLI, MCP and loopback HTTP. Selecting or focusing work replaces the active persona ensemble and review questions. Standard host-model reasoning with installed project/core personas is complete; relevant installed personal or premium personas can add optional depth. Human approval, Manual QA, security disposition, accepted risk, deploy and release remain outside the Companion. Start with the [Companion user guide](../context-aware-delivery-companion-user-guide.md), or use the [operating and implementation guide](../context-aware-delivery-companion-guide.md) for the technical contract.

### Contributions and prototype review

**Contributions** lets business-facing owners, technical owners and shared reviewers work on one attributed thread, with different evidence emphasis for each responsibility. It shows active persona names, tiers, signals and reasons; installed premium and personal personas remain optional.

During UI Design, the prototype review panel shows the plan or rendered-design personas, tier availability, findings, responses and bounded next action. Hand-offs retain attribution and refer to the prior digest. Host review remains advisory (`authority: none`). Confirming evidence or recording a persona review doesn't complete a phase, approve Build or accept Manual QA.

See [Guided Phase Evidence Drafting](../guided-phase-evidence-drafting-guide.md) and [Persona-guided prototype iteration](../persona-guided-prototype-iteration.md).

### Local error reporting

The dashboard's **Error Reporting** workspace creates and displays privacy-bounded local drafts, deterministic ZIP packages, redaction summaries, attempts and receipts. Automatic draft capture is opt-in and local-only. Preparing email reveals the ZIP and opens the default email client but remains `prepared-not-sent`; provider transport requires a separately registered trusted adapter, exact digest and explicit confirmation. See the [Local Error Reporting guide](../error-reporting-guide.md) and [provider guide](../error-reporting-provider-guide.md).

A conversational dashboard handoff changes no delivery state by itself. The next `ewai` companion check-in names the selected intent, treats “go” as confirmation to claim it, and invokes the canonical `$ewai-deliver` skill. AFK start is available only after durable Build approval, entry into Build, a valid task graph, clean configured repositories, safe branch topology, and an enabled local provider all pass preflight. Material progress then appears in the intent drawer and Live work view.

### Personas and project knowledge

The drawer's **Personas** workspace searches core, premium, personal and project libraries. You can attach a perspective to intent frontmatter with an explicit role and depth, or create a missing project-owned persona. The persona's definition and its attachment to an intent remain distinct.

**Mind Palace** navigates the project-owned SPECS hierarchy, searches inside document sections, shows tidiness findings and renders Markdown or supported text sources. Canonical knowledge stays in the files, not the operational database.

Its secondary evidence modes provide different workflows:

- **Meeting evidence** shows safe registered-source state, the source-to-review-to-evidence route and active personas, without raw transcript text or absolute paths.
- **Knowledge proposals** turns promoted meeting evidence and retrospectives into proposals from a closed set of record types. You inspect provenance and personas, record a complete named review and separately approve additive-only materialisation. Differing existing knowledge remains a conflict.

The standard host model and project/core personas support these workflows. Relevant installed personal or premium personas may add depth, not approval authority. See the [Meeting evidence guide](../meeting-evidence-user-guide.md), [Knowledge Proposals guide](../knowledge-proposals-user-guide.md) and [integration reference](../knowledge-proposals-implementer-guide.md).

If check-in confirms unavailable premium access and no installed premium pack, the category rail shows the project-configured upgrade link. Unknown connectivity doesn't trigger an upsell.

### MCP access

The MCP server uses stdio and is started by Codex, Claude Code, or Antigravity from the project configuration written during initialization. It exposes intent and work-item reads, guarded intent creation, operational updates, phase and material registration, runtime status, and active-work events. It does not require the HTTP dashboard to be running.

### Current runtime scope

The public-safe runtime now covers intents, grouped work items, sprint membership, lanes, progress, phase state, linked artefacts, active sessions, material activity events, and a read-only Mind Palace projection of the `SPECS/` tree. Palace search uses a disposable SQLite FTS5 section index; tidiness deterministically reports broken internal links, identical content, orphaned records, empty documents, and missing Markdown titles. `ewai palace housekeeping` prepares a review plan and changes no files. The `$ewai-palace-housekeeping` skill then offers a walkthrough or explicit approval route before canonical knowledge changes. `SPECS/` Markdown remains authoritative throughout, so the Palace index can be rebuilt rather than becoming a second source of truth.

Explicit Mind Palace commands are available for people, scripts, and agent integrations:

```bash
ewai palace refresh
ewai palace status
ewai palace search "alert escalation"
ewai palace tidiness
ewai palace housekeeping
```

`tidiness` is always read-only. `housekeeping` is also read-only at the CLI layer: it groups possible problems and directs the companion to the review-led skill. A tidy Palace may correctly produce a no-op.

## Why `SPECS/` and SQLite are separate

`SPECS/` contains durable project truth:

- Intents and journeys.
- Constraints and standards.
- Plans and task graphs.
- Gate evidence.
- Test reports.
- Delivery records and retrospectives.
- Persona references and intent attachments.

SQLite contains rebuildable operational projections, including:

- Work-item status and ordering.
- Phase transitions.
- Active sessions and questions.
- Registered artefacts.
- Command runs and their durable run UUIDs.
- Repository files, symbols, spans, imports, relationships, and index runs.
- Standards applicability, capability fingerprints, and validation findings.
- Mind Palace documents, sections, links, index runs, and derived tidiness evidence.

For an active intent, delivery status is written to three committed sources: the intent Markdown frontmatter, its adjacent structured intent JSON, and `SPECS/6.Build/<slug>/delivery-state.json`. SQLite is a fourth, rebuildable operational projection. Check-in audits these copies, backfills a missing adjacent JSON file, and blocks delivery if existing copies disagree.

Design-phase HTML prototypes and their design-system application evidence are stored with their intent:

```text
SPECS/6.Build/<intent-slug>/ui-design-assets/
├── design-system/
│   ├── receipt-<digest>.json
│   └── summary-<digest>.md
├── prototype-iterations/
│   ├── plans/plan-<digest>.json
│   └── cycles/cycle-<number>-<digest>.json
└── prototypes/
    ├── manifest.json
    ├── selected.html
    └── variants/<variant-name>/index.html
```

The selected file is registered as a `prototype` artefact. New UI deliveries use `ewai.prototype-manifest/v3` at `ui-design-assets/prototypes/manifest.json` to link an immutable design-system receipt at `ui-design-assets/design-system/receipt-<digest>.json`, the reviewed prototype plan, and the final persona-guided design cycle; historical v1 and v2 manifests remain readable. The intent slideout hotlinks the selected HTML entry point in a sandboxed preview, provides a full-size link, and keeps variants and source paths visible alongside the other delivery materials.

The design goal is that losing `.ewai-pipeline/` should not lose the project's approved intent, plan, decisions, or delivery evidence. The operational database can be migrated, repaired, or rebuilt without replacing the committed `SPECS/` record.
