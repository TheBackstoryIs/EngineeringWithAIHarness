# Troubleshooting and recovery

Use this guide when EWAI cannot check in, find project state, open the dashboard, resolve a pack or persona, or move a delivery forward.

## Protect work before diagnosis

First establish:

- the exact project root and current branch;
- tracked, modified, staged, and untracked files;
- whether another agent or person is working in the same checkout;
- the configured SPECS root;
- whether the failing action could overwrite or delete material.

Do not auto-stash, reset, clean, or delete runtime directories as a first response. Unrelated changes belong to their owner.

## Collect a diagnostic baseline

```bash
ewai checkin --project . --json
ewai doctor --project . --json
ewai intent audit-state --project . --json
ewai server status --project .
ewai index freshness --project . --json
ewai palace status --project . --json
```

These commands aren't all read-only. Check-in can start or reuse the dashboard and refresh derived state; `intent audit-state` can recreate missing intent sidecars. Persona licence checks can enforce confirmed matching team expiry. If you only need to inspect a running server or index, use those individual status commands first.

Record unknown checks and their reasons. A network failure, missing CLI, stale projection, and invalid durable state require different recoveries.

## Project cannot be found

Check for:

- `.ewai-pipeline/project.json` in the workspace or an ancestor;
- `SPECS/pipeline.yaml` at the configured location;
- a Git root if the project was expected to resolve from Git;
- a moved workspace with stale absolute runtime references;
- running the command from an unrelated directory.

Supply `--project /exact/path` when discovery is ambiguous. Do not create a second SPECS tree just because the expected one was not found.

## Check-in reports state drift

Four records must remain aligned: intent Markdown, adjacent intent JSON, delivery state, and the rebuildable SQLite projection.

Recovery:

1. stop delivery actions;
2. inspect `ewai intent audit-state --project . --json`;
3. compare durable files with Git history and recent approved actions;
4. preserve the most recent human-authored intent content;
5. use canonical intent or delivery operations to repair state;
6. rerun check-in and the audit;
7. resume only after consistency is restored.

Never edit SQLite directly. Never invent a completed gate or approval.

## Dashboard will not start

```bash
ewai server status --project .
ewai server stop --project .
ewai server start --project .
```

Use the current returned URL. If restart fails, inspect the reported process and log paths, port ownership, Node version, and filesystem permissions. Preserve logs needed for diagnosis before any cleanup.

## Repository index is stale or partial

```bash
ewai index freshness --project . --json
ewai index refresh --project . --json
ewai index status --project . --json
ewai index coverage --project . --json
ewai index profiles --project . --json
ewai index files --outcome analysis_failed --project . --json
```

Report `analysed`, `inventory_only`, `skipped_sensitive`, `skipped_oversized`, and `analysis_failed` separately, then review deep, shallow, and inventory depths. If freshness reports `profile-catalogue-changed`, inspect active packs and profiles before refreshing. Unsupported, malformed, sensitive, or oversized files remain visible without making the whole run unusable; limit source claims to the verified coverage. See the [Repository Source Map guide](../repository-source-map-guide.md).

## Delivery will not continue

```bash
ewai delivery status <intent-slug> --project . --json
ewai delivery continue <intent-slug> --project . --json
```

Common causes:

- **Completing Intent is blocked because the intent is still draft:** agree its outcome and acceptance criteria and make it ready through the intent workflow. A draft can begin delivery; it can't finish the Intent stage;
- a required canonical artefact is missing;
- gate evidence changed after completion;
- the task graph is invalid or task evidence incomplete;
- Build approval has not been recorded;
- a provider validation cycle is unfinished;
- the delivery is shelf-ready and requires resume/FitCheck;
- Manual QA is awaiting a person;
- durable state copies disagree.

These commands inspect progress; they don't ask the host to perform the next stage. Continue in the EWAI conversation once the reported blocker is resolved.

Compare [the two amendment operations](../completed-phase-evidence-amendments.md#which-amendment-operation) before changing completed evidence.

When a named human has approved legitimate amendments and the current phase is Build, use the guarded recovery rather than editing stored hashes:

```bash
ewai delivery ratify-amendments <intent-slug> \
  --project . \
  --yes \
  --approved-by "Owner" \
  --scope "Exact amended evidence being ratified"
```

This operation validates all completed phase artefacts and ledgers, records their previous and replacement hashes, and does not grant Build approval. Follow the reported next action. Do not change `currentPhase`, gate status, hashes, or completion percentages by hand.

## Premium persona sync fails

Read the actual failure before retrying. Licence verification, archive download and local validation are different steps.

- **Key rejected:** copy it from My Account or the team invitation and retry the private setup form.
- **Key saved, download failed:** retry setup when the connection is available; the key alone doesn't make the pack ready.
- **Local files changed:** preserve those edits before deciding how to recover the managed library.
- **Different seat or provider:** confirm which subscription should own the installation; replacement requires explicit consent.
- **Archive rejected:** preserve the previous pack and report the validation error. Don't unpack it manually to bypass the check.
- **Interrupted operation or held lock:** check whether another installation is running before investigating its staging files. Don't delete a live lock.

Persona downloads come from the website, not Git. See [Set up and update premium personas](premium-personas-setup.md) for the full recovery path.

## A persona is missing or irrelevant

```bash
ewai persona path --scope project --project .
ewai persona list --project . --query <topic>
```

Check valid frontmatter, scope, ID, description, tags, capabilities, and project root. If the persona appears but is not engaged, its metadata may not match the section. Improve the complete owned persona; do not rely on automatic overlay composition.

## A Blueprint is rejected

Diagnose root discovery, strict manifest parsing, compatibility, dependencies, content paths, size limits, digest, preview revision, and destination conflicts in that order. Use [Blueprint validation and troubleshooting](../blueprints/validation-and-troubleshooting.md).

## A Governed Starter Pack cannot be prepared or applied

Start with the safe workspace:

```bash
ewai starter status --project . --json
ewai starter adapters --project . --json
```

Check, in order:

1. the Organisation Blueprint receipt is still accepted and has not drifted;
2. every logical target has one non-overlapping `starter_materialisation.targets` mapping;
3. every configured repository is its own Git working-tree root;
4. the registered adapter package, publisher, version, entrypoint, and package digest have not drifted;
5. the adapter supports the receipt's source class and writes every file beneath exactly one target source path;
6. the independently verified aggregate staged-tree digest matches the receipt;
7. the preview is unexpired and repository revisions are unchanged;
8. every destination remains `create` or `identical`, with no conflict or protected path.

Prepare a fresh preview after any legitimate change. Never edit the runtime SQLite rows, preview digest, journal, classification, or evidence by hand.

If application reports `recovery-required`, inspect the preserved paths and obtain human direction before changing them. Recovery is digest-sensitive:

```bash
ewai starter recover <attempt-id> --project . --yes --json
```

EWAI removes only unchanged files it can prove it created and empty directories it journalled. A changed file is preserved. Do not delete it merely to clear the state. See [Governed Starter-Project Materialisation](../governed-starter-project-materialisation-guide.md).

## Recovery requires destructive action

Stop and obtain explicit authority when recovery would:

- delete or overwrite project knowledge;
- remove a managed cache or runtime database;
- discard Git changes;
- replace host configuration;
- force an update or rewrite history;
- affect another project or user.

Resolve exact targets with read-only checks and prefer recoverable operations. After any authorised material deletion, record what was removed and how it can be recovered.

## Diagnostic handoff template

Record:

- project root and configured SPECS root;
- branch and worktree state without secret content;
- EWAI version and installation source;
- exact command and error;
- check-in, doctor, integrity, dashboard, and index status;
- last known successful action;
- durable files involved;
- actions already attempted;
- the decision or authority now required.

## Related guides

- [Installation, updating, and entitlements](installation-updating-and-entitlements.md)
- [Dashboard and delivery state](dashboard-and-delivery-state.md)
- [Developer delivery guide](../developer-delivery-guide.md)
