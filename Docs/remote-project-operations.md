# Remote project changes and verification

EWAI can expose bounded project operations through its existing project-bound MCP
connection. Files, execution, delivery evidence and the tracker stay on the project
machine. This adds tools to an existing connection; it does not create a network
listener, remote filesystem mount, Git sync or publication service. The existing
connection must already provide authenticated, authorised access to the project.

## Enable locally

An owner configures `remote_operations` in the project's configured SPECS
`pipeline.yaml`. It is off when absent. MCP tools cannot edit this configuration or
enable access themselves. Existing projects retain their current delivery behaviour.

```yaml
remote_operations:
  enabled: true
  allow_code_writes: false
  checks:
    whitespace:
      repository: application
      executable: /usr/bin/git
      args: [diff, --check]
      phases: [fit-check]
      timeout_ms: 10000
      max_output_bytes: 65536
```

Use an executable's actual absolute path on the project machine. Repository names
must match the project's existing `repositories` configuration. The example checks
whitespace only; configure the repository's actual required validation commands as
additional named checks. Every named check configured for a phase must have current
passing evidence before that phase can complete. Phases with no configured checks
retain existing gate behaviour; remote preflight explicitly reports the missing
check capability rather than claiming full remote readiness.

Named checks are trusted local executable configuration. They use argv with
`shell:false`, a minimal environment, a timeout of at most ten minutes, bounded
captured output and POSIX process groups for cancellation. They run with the local
user's permissions, **not an OS sandbox**. Do not place credentials in command
arguments. Arbitrary inherited environment secrets are excluded; common credential
patterns are redacted from bounded output, but this is not a comprehensive data
loss prevention system. Only configure checks whose output is appropriate for the
connected agent. Windows check execution is refused until process-tree control is
supported; capability/preflight reports the limitation.

## Remote workflow

1. Read `ewai_project_capabilities`, then `ewai_project_preflight` with the intent
   slug. For code implementation, pass `requireCodeWrites:true`. Checks-only
   readiness and code-edit permission are separate; inspect the returned
   capabilities. Missing access, missing checks and phase conflicts remain explicit.
2. Read files using `ewai_project_read_file` with `repository` and a relative
   `path`. The response includes UTF-8 content and `sha256`. Files are limited to
   256 KiB. Unsafe paths, symbolic links, hard-link aliases and credential paths
   are refused.
3. Author phase evidence using `ewai_project_apply_change`:

   ```json
   {
     "slug": "example-change",
     "phase": "fit-check",
     "operationId": "e03828d4-80fd-45c4-9ce2-f328d926641f",
     "confirmed": true,
     "kind": "evidence",
     "path": "fit-check-report.md",
     "expectedSha256": null,
     "content": "# FitCheck\n\nSource-grounded findings.\n"
   }
   ```

   Evidence paths are relative to `6.Build/<slug>/`. Required authored artefacts
   and attachments under `evidence/authored/<phase>/` are supported. Generated
   checks, tracker state, approvals, task graphs and gate ledgers are protected.
   An authored report does not assert that any check ran.
4. To update an existing file, supply its current SHA-256. Supply either complete
   `content`, `patch: {oldText, newText}` with exactly one matching occurrence, or
   `delete:true`. All changes use an operation ID and explicit confirmation.
   Deletion requires an existing file and its exact hash. For code, additionally
   supply `kind:code`, `repository`, `taskId`, `leaseId` and `leaseToken` from the
   existing task lease operation. The active approved Build, task branch and
   declared write set are checked. Keep lease tokens private.
5. Start a named check with `ewai_project_check_start`, supplying `slug`, `phase`,
   `check`, a new UUID `operationId` and `confirmed:true`. Build checks also require
   task lease fields; their configured absolute executable plus arguments must
   exactly match an entry in the task's `allowed_commands`.
6. Poll `ewai_project_check_status` using the slug and operation ID. The local worker
   survives an MCP client disconnect. Status returns the terminal outcome, exit
   code, bounded redacted output, receipt path, source revision and `fresh`/`passed`.
7. Use the existing gate-recording and phase-completion tools. Only these guarded
   operations advance delivery. Phase completion additionally verifies all named
   checks configured for that phase; stale or missing results block it.

Set `allow_code_writes:true` only when remote code editing is wanted. This setting
never supplies Build approval or a task lease. No operation commits, pushes,
creates a PR, merges, deploys, approves Manual QA or publishes a release.

## Concurrency and evidence

Protocol writes and checks share a project operation lock. File writes also acquire
the existing intent mutation ownership; checks hold intent ownership during local
execution. A check reserves the project until it terminates. Other local editors
and external processes are outside that protocol lock: expected file hashes detect
changes since a read, and revision fingerprints detect changes during a check.
This is cooperative coordination, not a filesystem lock against every editor.

Source fingerprints cover Git-visible files in configured repositories, excluding
delivery/runtime areas, plus repository HEAD and branch. Separate fingerprints bind
the delivery state, current intent, authored phase artefacts and attachments, task graph,
claim ledger, plan contract, Build approval,
constraints and strategy documents, including ignored SPECS. Ignored build outputs
and installed dependency trees are not fully inventoried. A changed source,
standard, plan or policy invalidates earlier results. A check that edits source
must be rerun against the resulting revision.

Immutable completion receipts and bounded output live under
`6.Build/<slug>/evidence/project-operations/`. Disposable dispatch/control journals
live under `.ewai-pipeline/runtime/project-operations/`. Clients receive no ability
to write either area directly. Preserve the runtime attempt journals when recovering
an in-flight run; do not delete them as routine cleanup. A captured result proves
only the assertions exercised by that configured check.

## Reconnect, cancel and recover

After a lost response, retry the **same operation ID and same payload**, or poll its
status. Payload field ordering does not matter. Reusing an ID for different content
is refused. Checks are never automatically dispatched twice.

`ewai_project_check_cancel` with `confirmed:true` creates a cancellation request.
The worker terminates its POSIX process group and records the outcome. A request
alone is not proof of stopped execution; poll until terminal status.

If the worker disappears without a receipt, status becomes `recovery-required`.
`ewai_project_recover` requires confirmation, verifies the recorded process has
stopped and, for checks, verifies its recorded child process group has stopped. It
records the interruption, releases matching ownership and never reruns a command.
If process identity or termination cannot be established, it refuses recovery and
retains the lock for operator diagnosis. Do not clear a lock while a child might
still be running. Interrupted file writes can be reconciled against their recorded
before/after hashes once the originating process is proven stopped.

Manual acceptance should exercise the real remote client against an authorised
project: preflight, FitCheck evidence write, named checks, disconnect/reconnect,
conflict rejection and canonical phase completion. Passing local protocol tests
does not establish that a particular hosted connection exposes the new tools.
