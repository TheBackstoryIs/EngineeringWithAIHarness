# Context Packet Pattern

> SPECS 5.Strategy / patterns
> Status: EWAI v1

## Purpose

Give every phase and contributor involved in a capability one living artefact that summarises the current delivery run. It prevents each AI or person from re-deriving context and keeps resumable work intelligible.

The Context Packet is distinct from:

- `tracker.md`, the phase-status state machine;
- phase artefacts such as `intent-summary.md` and `build-plan.md`;
- ADRs, which hold durable cross-capability decisions;
- agent memory, which is not project truth.

It lives at `SPECS/6.Build/{slug}/context-packet.md`, is created beside the tracker, is read on every phase entry, and is updated on every phase exit.

## Required structure

The packet uses these sections in this order:

```markdown
# Context Packet: {Capability Name}

**Slug:** `{slug}`
**Started:** {ISO timestamp}
**Last updated:** {ISO timestamp}
**Current phase:** {phase or paused state}
**Review intensity:** {full | scoped | targeted}
**Execution tier:** {full | scoped | targeted}
**Input type:** {intent | capability | idea | bug | resume}
**Run mode:** {normal | dry-run | shelf | bug | resume}
**Branch strategy:** {n/a | no-build-branches | branches-created-at-shelf}
**Working branch:** {main | feature/{slug} | mixed; explain}

---

## What this capability is

{One plain-language paragraph from the accepted intent.}

## Why it matters

{Business rationale, beneficiaries, and what fails without it.}

## Scope boundary

**In scope:**
- {item}

**Out of scope (explicitly deferred):**
- {item}: {reason and destination}

## Key decisions made during this run

| # | Decision | Made during | Rationale | Reversibility |
|---|---|---|---|---|

## Open escalations

| # | Phase raised | Question | Status | Resolution |
|---|---|---|---|---|

## Phase log

| Phase | Status | Started | Completed | Key artefact | Notes |
|---|---|---|---|---|---|

## Active constraints

- {binding constraint downstream phases must retain}

## Push-back signals

| # | Phase / tool | Reference file | Nature of push-back | What we did instead | Proposed update |
|---|---|---|---|---|---|

## Handoff notes

`{phase} → {next phase}: {three to five useful sentences}`

## Links

- Tracker: `tracker.md`
- Durable state: `delivery-state.json`
- Destination: `destination.md` (after Plan)
- Task graph: `task-graph.json` (after Plan)
- Intent: `intent-summary.md`
- Build plan: `build-plan.md` (after Plan)
- Test plan: `test-plan.md` (after TestPlan)
- Task reports: `tasks/T-###/report.md` (during Build)
- Retro: `retro.md` (after completion)
```

## Maintenance protocol

On entry, read the packet and use it as the primary brief. Open referenced artefacts where more detail is required. Before repository-truth claims, query the project-local EWAI index and verify material evidence in source.

On exit, update:

- timestamp and current phase;
- the completed phase-log row;
- new decisions and their reversibility;
- active constraints and open escalations;
- newly created links;
- the handoff for the next phase.

On escalation, record the question and exact paused phase. On resume, validate the packet against `delivery-state.json`, the intent Markdown and JSON, and SQLite. The JSON and guarded transition checks decide whether work may proceed; this Markdown makes the state legible.

Contributors and subagents do not mutate the packet directly. They return evidence to the orchestrator, which is its single writer. Tracker, Context Packet, checklist, gate ledgers, and branch merges are sequentially owned surfaces.

## Retention

Archive the packet with all other delivery evidence after Retro. It remains the readable account of how the capability moved through the pipeline.

## Exclusions

Do not put long analysis, code, per-task execution detail, cross-capability ADR content, hidden agent memory, or speculative ideas in this packet. Keep it under 300 lines; move depth into a linked artefact.
