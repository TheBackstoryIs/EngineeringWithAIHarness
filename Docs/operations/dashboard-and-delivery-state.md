# Dashboard and delivery-state operations

Use this guide to inspect EWAI work, understand which state is authoritative, and recover projections without editing phase status by hand.

## Inspecting, queuing and doing work

- **Inspect:** status views and `delivery continue` explain recorded progress and the next permitted step.
- **Queue or hand off:** a supported dashboard action prepares work for the host to pick up.
- **Execute:** the host performs the requested work through the appropriate skill and guarded operations.

A queued handoff isn't a completed feature, and opening a view doesn't run its workflow. Follow the host's conversation and actual activity/results to see whether execution began.

## Open the project dashboard

Project check-in starts or reuses the local loopback dashboard and returns its actual URL:

```bash
ewai checkin --project .
```

You can also manage the server explicitly:

```bash
ewai server status --project .
ewai server start --project .
ewai server stop --project .
```

Use the returned URL rather than assuming a fixed port.

## Choose the views you need

The left sidebar keeps optional tools out of the way until you choose them. Open **Configuration**, select the views you need and save the changes. Portfolio, Team Hub, Governed Rollout, Starters, Policy Gates, Security Validation, Hooks, AI context diagnostics and Contributions all start hidden.

Showing a view doesn't connect a service, run a security tool or approve a change. Hiding it doesn't disable a required check. See [Choose what's in your dashboard](dashboard-configuration.md) for the controls and command-line equivalents.

## Understand the state layers

| Layer | Purpose | Authority |
| --- | --- | --- |
| Intent Markdown | Human-readable purpose, journeys, acceptance, constraints, and relationships | Durable project truth |
| Adjacent intent JSON | Structured companion state for the intent | Durable and must agree with Markdown |
| `SPECS/6.Build/<slug>/delivery-state.json` | Canonical guarded phase, approval, validation, and run state | Durable delivery truth |
| `.ewai-pipeline/data/pipeline.sqlite` | Fast dashboard and API projection | Rebuildable operational state |
| Repository and Palace indexes | Search, graph, and knowledge-navigation projections | Rebuildable operational state |

Do not “fix” a disagreement by editing the SQLite database or raw delivery status. Use audit and guarded transition commands.

## Inspect delivery

```bash
ewai delivery status <intent-slug> --project . --json
ewai delivery continue <intent-slug> --project . --json
ewai delivery runs <intent-slug> --project . --json
```

`continue` reports the next action without starting it. It neither resumes work nor bypasses a gate. If work is shelf-ready, use the guarded resume operation rather than starting Build directly.

## Read phase status accurately

- **pending:** the stage has not started.
- **running:** active work or a human gate is in progress.
- **completed:** canonical artefacts and a passing hashed gate ledger were recorded.
- **skipped:** the declared condition did not apply.
- **not-supported:** a provider-gated stage could not run under the resolved policy.
- **paused-awaiting-manual-qa:** automated Delivery is complete and human acceptance remains outstanding.
- **blocked:** a declared issue prevents safe progress.

Do not describe `not-supported` as passed or a running Manual QA gate as complete.

## Four-way integrity

Audit intent copies and delivery alignment:

```bash
ewai intent audit-state --project . --json
```

The audit can recreate a missing adjacent JSON sidecar from authoritative project records, but it reports disagreement rather than silently choosing between conflicting durable states.

When drift appears:

1. stop phase transitions;
2. identify which durable file changed and why;
3. compare with version-control history and the gate evidence;
4. use a supported delivery or intent operation to reconcile it;
5. refresh the dashboard projection;
6. verify the audit is consistent before continuing.

## Runs and live activity

Command runs explain which host, mode, and phase initiated work. Live activity records material events such as handoffs, decisions, external reviews, responses, blockers, human questions, and completed artefacts.

The activity stream shows material changes and decisions, not a token-by-token transcript or periodic “still working” messages. A quiet stream alone doesn't mean that work has stopped.

If a command process ended without closing its run record, inspect before marking old records stale:

```bash
ewai delivery runs --mark-stale --hours 6 --project .
```

Do not mark a genuinely active long-running operation stale merely because it has been quiet.

## Repository index operations

```bash
ewai index status --project . --json
ewai index freshness --project . --json
ewai index refresh --project . --json
ewai index coverage --project . --json
ewai index profiles --source organisation --project . --json
ewai index files --outcome analysis_failed --project . --json
ewai index search "authentication" --limit 20 --project .
ewai index graph src/example.mjs --limit 20 --project .
```

Refresh before substantive source, Blast Radius, or standards claims when the map is missing or stale. Review outcomes and depths separately: a completed run inventories the supported project tree but does not mean every file was opened or deeply analysed. The **Impact** tab also shows active persona provenance; those perspectives are advisory and do not alter repository facts.

## Mind Palace operations

```bash
ewai palace status --project . --json
ewai palace refresh --project . --json
ewai palace search "release decision" --limit 20 --project .
ewai palace tidiness --project . --json
ewai palace housekeeping --project .
```

The Palace indexes canonical SPECS sections. Housekeeping is review-led; it must not silently rewrite project knowledge.

## Dashboard safety

- Bind and use the project-local loopback service as configured.
- Do not treat dashboard buttons as a weaker approval path; approval actions must create the same durable evidence.
- Preserve unrelated work and host configuration during restarts.
- Treat the dashboard as unavailable if you cannot confirm a healthy process and current URL.
- A stale state file or port is diagnostic evidence, not proof that the service is running.

## Related guides

- [Developer delivery guide](../developer-delivery-guide.md)
- [Troubleshooting and recovery](troubleshooting-and-recovery.md)
- [CLI and configuration reference](../reference/cli-and-configuration.md)

## Current contract sources

- `src/runtime/dashboard.mjs`
- `src/runtime/work.mjs`
- `src/runtime/runs.mjs`
- `src/runtime/repository-index.mjs`
- `src/runtime/palace.mjs`
- `src/delivery.mjs`
- `src/intents.mjs`
