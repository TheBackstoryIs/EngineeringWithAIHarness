---
name: ewai-autonomy
description: Operate governed, bounded autonomous delivery for an exact pool of existing EWAI intents. Use for autonomy status, previews, named grants, local runs and services, human questions, recovery or revocation; keep phase delivery and approvals separate.
---

# EWAI autonomy

Autonomy is **off by default** in a consumer project. Resolve the project and configured SPECS root from `.ewai-pipeline/project.json`; the npm engine repository is not the consumer's authority source. Read the project's current intents, dependencies, standards, delivery state, policy and `ewai autonomy status --project . --json` before proposing work. Do not choose new intent IDs on the owner's behalf or infer a grant from a request to continue.

Use the dashboard's Autonomy view or `ewai autonomy preview` to explain an **exact intent pool**, permitted actions and providers, expiry, runtime, per-operation time, attempt limit, executable candidates, human decisions and blockers. A preview is **not permission**. Recording it only makes that displayed revision approvable. A named owner must explicitly approve its current digest using the guarded dashboard or `ewai autonomy approve --expected-digest DIGEST --approved-by NAME --yes`. A changed pool, provider, limit or evidence requires a new preview and decision. Never issue a live grant merely because the host AI recommends one.

`ewai autonomy run` makes one bounded pass; `ewai autonomy service` starts a local continuing supervisor. Both require the exact approved grant digest and selected provider. Verify provider availability/version and the project's external-review policy; the orchestrator cannot independently review itself. Treat unknown execution, a stale digest, lost ownership, expired scope or an unavailable provider as a stop, not a retry invitation. Usage is provider-reported, not a hard money cap. Set bounded limits and direct the owner to provider-side spend controls.

Monitor status and questions. A worker stages source-bound drafts and host-produced checks, never gate authority. Use `$ewai-deliver` for the complete fourteen-stage phase workflow, canonical gate ledger, standards sweep, validation cycles and leased Build tasks. Existing human Build approval and Manual QA approval remain separate explicit decisions. Do not turn a run question, private answer, worker draft or passing test into either approval. Answer through the dashboard or a private project-relative input file, not chat text containing credentials or private evidence.

Pause, cancel, revoke and recover through guarded revision-bound controls. A cancel request does not confirm termination; inspect `executionStopped`, owner/process state and durable operation receipts. Recover only after inspecting whether the canonical effect already happened; never blindly replay it. Revocation removes future delegation, not historical evidence or an in-flight termination guarantee. Report blocked states honestly. Do not update premium personas, publish, release, deploy or accept on the owner's behalf.

The dashboard and CLI share the same project-local control plane. The npm package also includes `Docs/autonomous-intent-delivery.md` for a longer user guide; do not assume a relative path from this copied skill to that guide. The instructions above remain usable when only the skill subtree is installed.
