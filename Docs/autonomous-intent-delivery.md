# Governed autonomous intent delivery

EWAI can take bounded steps on intents you have already registered in a **consumer project**. The npm package supplies the engine; each consumer keeps its own intents, configured SPECS root, evidence and approvals. Installing or updating the package does not enrol an existing project in autonomous delivery. The mode starts **off by default**.

Autonomy is a way to delegate an exact pool of work, not a standing instruction to choose future intents. New intents are outside a grant until an owner reviews a new preview and gives a new named approval. A preview is **not permission** to execute. The dashboard's Autonomy view combines policy, preview and run information; `ewai autonomy status --project . --json` shows the current mode, grant, runs and questions. Use `ewai autonomy preview` to see executable, human-decision and blocked candidates. Read the configured root from `.ewai-pipeline/project.json`; do not assume `./SPECS`.

## Delegate a bounded pool

1. Confirm that each chosen intent is accepted, its dependencies and project standards are current, and the proposed provider is allowed and available on this host. Choose exact intent IDs, actions, provider, expiry, runtime, per-operation time and attempt limit. A broad domain or all-future-intents grant is not supported.
2. Inspect a preview in the dashboard or CLI. Its executable, human-decision and blocked lists explain what can happen now. Recording a preview stores that displayed proposal for approval; it does not activate it.
3. The named project owner reviews the exact displayed scope and digest, then approves that revision. Re-preview after a changed intent, budget, provider, dependency or configuration. Approval is a separate durable action, never inferred from chat, a preview, a test result or a worker's draft.
4. Run once or start the local service only against that approved digest. Observe status and stop on a human question, blocked action or unknown execution outcome. Do not silently retry or enlarge scope.

For example, after reading the preview and obtaining the owner's decision:

```sh
ewai autonomy preview --project . --intent product/alpha --action begin-harness --action prepare-phase --provider claude --expires-at 2030-12-01T17:00:00.000Z --max-runtime-ms 60000 --max-operation-ms 10000 --max-attempts 2 --record --json
ewai autonomy approve --project . --expected-digest sha256:REPLACE_WITH_DISPLAYED_DIGEST --approved-by 'Named owner' --yes --json
ewai autonomy run --project . --expected-digest sha256:REPLACE_WITH_APPROVED_GRANT_DIGEST --provider claude --yes --json
ewai autonomy status --project . --json
```

These are examples, not a grant or a recommendation to run this particular intent. Use the actual returned digests and a future expiry appropriate to the project, in canonical `YYYY-MM-DDTHH:MM:SS.mmmZ` form. `ewai autonomy service` uses the same digest and provider for a continuing local supervisor. It is not a cloud scheduler and does not outlive its host as a running process. Provider availability and version checks fail closed; the orchestrating host cannot serve as its own independent validator. In this release, the pre-Build proposal adapter supports only macOS with pinned Claude Code `2.1.257 (Claude Code)` and a passing host conformance check; listing Codex or Antigravity in a scope does not make them available for that worker path. A missing or unverified provider must be resolved deliberately, not bypassed.

## What autonomy can and cannot decide

The permitted path can start the harness and prepare source-bound drafts for supported phases. A worker's proposal is staged as a draft, with host-produced checks and explicit human questions. It cannot write a passing gate verdict, approve Build or Manual QA, make its prose authoritative owner evidence, or complete a phase on the strength of its own prose. Source references and schema checks do not prove the draft's facts; a human must review them. For actual phase delivery use `$ewai-deliver`, the canonical gate ledger, deterministic checks and the project's configured validation policy. Approved Build tasks still need their task graph, write-set and lease controls; autonomous operation does not create Build approval.

The supervisor records bounded action and provider-attempt counts. Its usage is provider-reported, not a hard money cap: the engine cannot guarantee a currency spend ceiling from token estimates or missing provider usage. Set tight time and attempt limits, observe provider billing separately, and use the provider's own spend controls where needed. A cancel request does not confirm termination of a child process. Check `executionStopped` and the durable run status before recovery, replacement or another grant. `recovery-required` calls for inspection of the recorded operation and explicit `recover`; it must not blindly repeat a potentially completed effect.

Answering an autonomy question records a private owner response for the run. It does not approve any Build, gate, Manual QA, deployment, release or acceptance decision. Inspect the project evidence and give those approvals through their separate guarded workflows. The dashboard and status projection omit private answer text. Revoke a grant when delegation should cease; revocation does not erase its evidence or assert that in-flight work has stopped.

## Recovery and assurance boundary

Use `ewai autonomy status --project . --run RUN_ID --json` to inspect a run. `ewai autonomy pause|resume|cancel|recover --project . --run RUN_ID --expected-revision N --yes --json` applies a revision-bound control; a stale revision must be inspected again. For a human question, use the dashboard's guarded answer form or `ewai autonomy answer --project . --input PROJECT_RELATIVE_JSON --yes --json`, with a private project-local input file. Do not put private answers or credentials in chat or command arguments.

The package tests exercise a tarball-installed consumer with preseeded offline dependencies; they do not prove a fresh registry dependency bootstrap or migration from every historical version. A controlled test simulates a lost response and verifies no repeated canonical effect. A separate installed-worker test substitutes only the provider boundary with a local child process; it does not establish live provider conformance. Human Manual QA, external acceptance, deployment and npm release remain separate decisions and evidence.
