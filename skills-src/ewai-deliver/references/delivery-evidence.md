# EWAI delivery evidence contracts

These are durable project records, not chat summaries. Paths are relative to `SPECS/6.Build/<slug>/` unless stated otherwise.

## Task graph

`task-graph.json` uses `schema_version: 1` and must contain:

- `slug`, `status`, and `parent_branch`;
- optionally, `repository_branches`, keyed by configured `SPECS/pipeline.yaml` repository name, when repositories use different integration branches;
- `source.claim_ledger`, `source.plan_contract`, and `source.destination` pointing to real delivery artefacts;
- `parallelism.allowed`, a positive `max_parallel_tasks`, and rationale;
- one or more `afk_waves`, with ready tasks, parallel tasks, merge order, and rationale;
- one or more tasks with unique IDs and branches.

Every non-orchestration task requires:

- `id`, `slice`, `name`, `issue_kind`, numeric `priority`, `parallel_wave`, `classification`, `repo`, and `branch`;
- `depends_on` and Claim Ledger `claims`;
- `user_visible_outcome`, `read_set`, `write_set`, and `central_writes_allowed`;
- `module_interface_contract` containing `module`, `interface`, `behaviour_owned`, `caller_contract`, and `test_boundary`;
- `first_failing_test` or an explicit rationale;
- `red_green_refactor` containing `red_command`, `expected_red_failure`, `green_command`, and `refactor_boundary`;
- bounded `allowed_commands`, `stop_conditions`, and named `completion_evidence`;
- a bounded `ralph_loop` contract even when it is disabled;
- `review.fresh_context_required: true`, `review.review_tests_first: true`, and binding `standards_pushed`;
- `merge.orchestrator_owned: true` and `post_merge_checks`;
- `report_path` and `evidence_path`, normally `tasks/T-###/report.md` and `tasks/T-###/evidence.json`.

Every task `repo` must exactly match a configured repository name. Use branch names that are siblings of the integration branch, such as `ewai-afk-example-T-001-slice`; do not put a child ref below an existing branch such as `feature/example/T-001`, because Git cannot store both `feature/example` and `feature/example/T-001`. The AFK conductor preserves the declared task branch in evidence and records the actual safe branch it created.

Every actionable Claim Ledger claim must be owned exactly once. Every task claim must exist in the ledger. Every non-orchestration slice must exist in both the Claim Ledger and Plan Contract. The validator rejects cycles, missing dependencies, unsafe central writes, overlapping parallel write sets, and incomplete nested contracts.

## Task completion evidence

The report remains the human-readable handoff. The evidence sidecar is the machine-verifiable completion record:

```json
{
  "schema": "ewai.task-evidence/v1",
  "task_id": "T-001",
  "repository": "application",
  "task_branch": "ewai-afk-example-T-001-slice",
  "branch": "ewai-afk-example-T-001-slice",
  "base_branch": "feature/example",
  "commit": "full-or-short-commit-id",
  "changed_files": ["src/example.js"],
  "commands": [
    {"stage":"red","command":"npm test -- example","expected_failure":"feature is not implemented","exit_code":1,"output_path":"tasks/T-001/evidence/red.txt","output_sha256":"..."},
    {"stage":"green","command":"npm test -- example","exit_code":0,"output_path":"tasks/T-001/evidence/green.txt","output_sha256":"..."},
    {"stage":"refactor","command":"npm test -- example","exit_code":0,"output_path":"tasks/T-001/evidence/refactor.txt","output_sha256":"..."}
  ],
  "review": {
    "fresh_context": true,
    "tests_reviewed_first": true,
    "status": "pass",
    "reviewer": "independent-session-id",
    "evidence_path": "tasks/T-001/evidence/review.md",
    "evidence_sha256": "..."
  },
  "completion_checks": [
    {"name":"tests pass","status":"pass","evidence_path":"tasks/T-001/evidence/tests.txt","evidence_sha256":"..."}
  ]
}
```

Capture command output at execution time. Do not write a synthetic output file after the fact. In multi-repository delivery, implementation and checks run in the task's configured repository while the conductor writes this evidence into the project-root SPECS repository. Every changed file must remain within the task write set, command hashes must still match, all named completion obligations must pass, and review must be fresh and tests-first. Narrative alone never completes a task or unlocks its dependants.

The AFK conductor may add `post_merge_checks` to the same evidence record. Each item carries the exact command, exit code, output path, and hash produced while the merge was pending. The conductor commits the merge only after these checks pass. This is additional integration evidence; it never substitutes for red, green, refactor, fresh-context review, or the named task completion checks.

## Prototype manifest

When UI Design applies, create `ui-design-assets/prototypes/manifest.json`:

```json
{
  "schema": "ewai.prototype-manifest/v1",
  "status": "selected",
  "selected": {
    "title": "Chosen interaction",
    "path": "ui-design-assets/prototypes/selected.html",
    "decision": "Why this option was selected"
  },
  "registration": {
    "kind": "prototype",
    "status": "active",
    "path": "ui-design-assets/prototypes/selected.html"
  }
}
```

The selected file must be runnable and remain inside the prototypes directory. The registration path must match it so the project dashboard can expose the same approved prototype.
