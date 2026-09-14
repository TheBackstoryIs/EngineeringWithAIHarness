# EWAI CLI reference

## Project commands

```bash
ewai install [--project PATH] [--host auto|codex|claude|antigravity] [--mode copy|link]
ewai init [--project PATH] [--name NAME] [--specs PATH] [--init-specs-repo] [--claude] [--codex] [--antigravity] [--force] [--json]
ewai checkin [--project PATH] [--json] [--verbose]
ewai dashboard [--project PATH] [--json]
ewai server start|status|stop [--project PATH] [--json]
ewai mcp [--project PATH]
ewai discover [--project PATH] [--answers FILE] [--stack PACK] [--force] [--json]
ewai context register FOLDER [--project PATH] --yes [--label NAME] [--classification public|internal|confidential|restricted] [--cloud-processing allowed|denied|unknown] [--exclude RELATIVE_PATH] [--force] [--json]
ewai archaeology prepare-personas BUNDLE [--project PATH] [--force] [--json]
ewai archaeology validate-personas BUNDLE [--project PATH] [--json]
ewai archaeology validate BUNDLE [--project PATH] [--json]
ewai archaeology prepare-review BUNDLE [--project PATH] [--force] [--json]
ewai archaeology curate BUNDLE [--project PATH] --yes [--approved-by NAME] [--json]
ewai validation list [--project PATH] [--orchestrator manual|claude|codex|antigravity] [--json]
ewai validation set claude|codex|antigravity available|unavailable [--enabled|--disabled] [--project PATH] [--json]
ewai validation checkpoint implementation-plan|test-plan|code [--cycles N] [--validators auto|PROVIDER,...] [--breadth targeted|change-set|capability|system] [--depth issues-only|issues-and-fixes|analysis-and-recommendations] [--output small|medium|large] [--enabled|--disabled] [--project PATH] [--json]
ewai doctor [--project PATH] [--json]
ewai intent create SLUG [--domain DOMAIN] [--title TITLE] [--persona REF:ROLE:DEPTH] [--delivery-shape FILE] [--project PATH] [--json]
ewai intent map-create FILE --yes [--approved-by NAME] [--project PATH] [--json]
ewai intent audit-state [--project PATH] [--json]
ewai afk preflight SLUG [--provider auto|claude|codex|antigravity] [--parallel N] [--project PATH] [--json]
ewai afk start SLUG [--provider auto|claude|codex|antigravity] [--parallel N] [--timeout-minutes N] [--project PATH] [--json]
ewai afk status [RUN_ID] [--project PATH] [--json]
ewai afk pause|resume|cancel RUN_ID [--project PATH] [--json]
ewai palace refresh [--project PATH] [--json]
ewai palace status [--project PATH] [--json]
ewai palace search QUERY [--limit N] [--project PATH] [--json]
ewai palace tidiness [--project PATH] [--json]
ewai palace housekeeping [--project PATH] [--json]
```

Without `--project`, `install` registers EWAI globally. With `--project`, it installs agent skills into that repository. Copy mode is team-friendly; link mode follows the current EWAI checkout.

`init` creates missing project structures and preserves existing files unless `--force` is explicitly supplied. The default SPECS root is `SPECS`. For a workspace containing independent repositories, use `--specs <knowledge-repository>/SPECS --init-specs-repo`; EWAI records that path in `.ewai-pipeline/project.json` and can initialise its containing folder as a dedicated local Git repository. Init does not relocate an existing SPECS contract.

`discover` interviews the project owner or reads a repeatable answers file, then populates the canonical Project SPECS and technology/assurance profile.

`intent map-create` atomically writes one reviewed product-level map and all of its linked draft intents. The JSON or YAML request must use `ewai.intent-map-request/v1`; `--yes` records that the user approved the proposed map. Conversational shaping is handled by `$ewai-shape-intents`, so users should not normally need to prepare this file themselves.

`context register` inventories an explicitly approved source folder without copying its raw content into SPECS. The detailed path and file inventory remain under `.ewai-pipeline/context/`; the committed source registry contains sanitized metadata and a fingerprint. `--yes` represents user consent and is mandatory. Context interpretation is handled conversationally by `$ewai-context-import`.

`archaeology prepare-personas` snapshots the installed core, premium, personal, and project persona capability index into the bounded Archaeology bundle without exposing library paths. The AI completes its pass-by-pass value assessment and presents a concise recommended ensemble to the user. `archaeology validate-personas` is the hard gate before deep analysis; it requires completed reconnaissance, all analysis-pass assessments, a recorded user decision, valid persona references, and assignments for every selected persona.

`archaeology validate` enforces the maximum-detail reconstruction contract, including the confirmed persona-routing gate. It rejects missing capability, coverage, reconstruction, persona-routing, or artefact manifests; missing SPECS record families; consolidated records that reuse a proposed path; placeholder-sized artefacts; unsupported completion states; and unjustified blocked or not-applicable entries.

`archaeology validate-completion` is the final closeout gate. It verifies terminal review decisions, a complete curation ledger, accepted records present and hash-matched in canonical SPECS, and a recorded user choice or explicit decline after the three-route prospective-work offer. Run it before describing Archaeology as complete.

`archaeology prepare-review` creates a review guide and pending decision ledger after maximum-detail validation passes. Every reconstruction record requires a terminal, accountable decision; corrections must be applied and acknowledged in the ledger. `archaeology curate` requires explicit consent, preflights every accepted record, refuses differing canonical SPECS conflicts, files only accepted proposals, and writes a provenance-preserving curation ledger.

External validation is project-local. `init --claude --codex --antigravity`, discovery answers, `validation set`, and `validation checkpoint` update the same durable policy in `SPECS/pipeline.yaml`. Availability and enablement are separate; per-checkpoint settings control independent reviewers, bounded review/fix cycles, breadth, depth, and output size. `validation list --orchestrator <host>` shows the effective policy after excluding the active orchestrator. Standards compliance cannot be disabled or waived.

`doctor` validates the project contract, required SPECS paths, persona registry, and configured repository paths.

`intent create` accepts `--delivery-shape <json-or-yaml>` so the capture conversation can persist whether an intent should stay whole, split before delivery, or pause for owner decisions. `intent map-create` carries the same preview for every proposed child intent.

`afk preflight` and `afk start` apply only after explicit Build approval and guarded entry into Build. The local conductor executes ready AFK task contracts on real branches in isolated worktrees, records its ignored runtime state under `.ewai-pipeline/afk/`, and leaves project-owned reports and evidence under `SPECS/6.Build/<slug>/tasks/`. Use the `$ewai-deliver` interaction rather than teaching these commands to the user. Repository topology comes from `SPECS/pipeline.yaml`: a task maps to its named repository, while the project-root repository owns canonical evidence. Per-repository integration branches may be declared in `task-graph.json.repository_branches`; start creates a missing integration branch from a clean current branch but does not silently switch to one that already exists. Status, safe pause, recovery/resume, and cancellation remain available by durable run ID.

`checkin` starts or reuses the project-local loopback pipeline dashboard, refreshes its SQLite projection, and reports Mind Palace tidiness. `dashboard` and `server start` do the same explicitly; `server status` and `server stop` inspect or stop it. Agent hosts launch `mcp` over stdio from the project configuration created by `init`; it is not a persistent background server.

The MCP surface includes Mind Palace search and tidiness, work-item listing and updates, phase and artefact registration, and active-work start/event/finish operations. These drive the Kanban, sprint, intent-detail, live-work, and Mind Palace views without requiring users to learn matching CLI commands.

Mind Palace indexing is derived from canonical `SPECS/` files. `palace search` returns the best matching section from each document. `palace tidiness` is deterministic and read-only. `palace housekeeping` groups the findings but changes no files; use `$ewai-palace-housekeeping` for a Knowledge Curator-led review and explicit approval before editing canonical knowledge. A no-op is valid when the Palace is already tidy.

## Pack and persona commands

Human-readable check-in is compact by default. Use \`--verbose\` for expanded diagnostic text or \`--json\` for the complete structured contract. Brief presentation never omits mandatory blockers, standards or approval boundaries. Init and version checks use the CLI/metadata, not installed-source investigation or an unsupported \`ewai --version\` command.

```bash
ewai pack list [--json]
ewai persona index [--project PATH] [--query TEXT] [--json]
ewai persona list [--project PATH] [--query TEXT] [--json]
ewai persona create SLUG [--scope personal|project] [--project PATH] [--name NAME] [--category CATEGORY] [--force] [--json]
ewai persona path [--scope personal|project] [--project PATH] [--json]
ewai persona premium configure [--project PATH] [--machine-name NAME] [--json]
ewai persona premium status [--project PATH] [--json]
ewai persona premium sync [--project PATH] --yes [--json]
```

`persona index` returns a compact local catalog of identifiers, descriptions, categories, tiers, tags, capabilities, and paths for contextual persona routing. Personal personas live in `~/.ewai/personas/` and can be reused across projects. Project personas live in `SPECS/1.Scope/personas/project/` and should be versioned with the project. Professional persona sources are opt-in packs and must not be assumed available merely because an entitlement mechanism is configured.

The premium portion of `checkin` verifies access and compares versions without downloading. `persona premium configure` explains verify-and-install, accepts a website-purchased key in a hidden terminal prompt, stores it privately after verification and immediately downloads and installs through the core ZIP verifier. Its safe result confirms installed version/count or reports failure. Keys never enter arguments or SPECS. Later `persona premium sync` obtains a short-lived website grant, verifies ZIP/pack contents and atomically updates the managed pack at `~/.ewai/packs/ewai.personas.professional/`; `--yes` is explicit approval for that later download. Reading is neither setup nor sync consent. Source control is not a premium persona delivery route.
