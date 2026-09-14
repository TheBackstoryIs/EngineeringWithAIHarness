import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { projectPaths } from './paths.mjs';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function now() {
  return new Date().toISOString();
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function isWithin(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel));
}

export function atomicText(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.ewai-${process.pid}-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function atomicJson(path, value) {
  atomicText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function deliveryPaths(projectRoot, slug) {
  if (!slugPattern.test(slug)) throw new Error(`Delivery slug must be lower kebab-case: ${slug}`);
  const root = resolve(projectRoot);
  const buildRoot = projectPaths(root).buildRoot;
  const deliveryRoot = resolve(buildRoot, slug);
  if (!isWithin(buildRoot, deliveryRoot)) throw new Error(`Unsafe delivery slug: ${slug}`);
  return {
    projectRoot: root,
    deliveryRoot,
    statePath: resolve(deliveryRoot, 'delivery-state.json'),
    trackerPath: resolve(deliveryRoot, 'tracker.md'),
    contextPath: resolve(deliveryRoot, 'context-packet.md'),
    runsRoot: resolve(deliveryRoot, 'runs'),
    gatesRoot: resolve(deliveryRoot, 'gates')
  };
}

function statusSymbol(status) {
  return {
    pending: '⏸', running: '🟡', completed: '✅', approved: '✅', blocked: '🚫',
    failed: '🚫', issue: '⚠', waived: '⚠', skipped: '⏭', 'not-supported': '—'
  }[status] ?? status;
}

function phaseRows(state, includeNotes = false) {
  return [...state.phases, ...state.adjuncts].map((phase) => {
    const cells = [
      phase.id,
      `${statusSymbol(phase.status)} ${phase.status}`,
      phase.startedAt ?? '',
      phase.completedAt ?? '',
      phase.artefactPath ?? phase.gatePath ?? ''
    ];
    if (includeNotes) cells.push(phase.statusReason ?? '');
    return `| ${cells.join(' | ')} |`;
  });
}

function renderTracker(state) {
  const rows = state.phases.map((phase) => (
    `| ${phase.number} | ${phase.id} | ${statusSymbol(phase.status)} ${phase.status} | ${phase.startedAt ?? ''} | ${phase.completedAt ?? ''} | ${phase.gatePath ?? ''} |`
  ));
  for (const adjunct of state.adjuncts) {
    rows.push(`| — | ${adjunct.id} (adjunct) | ${statusSymbol(adjunct.status)} ${adjunct.status} | ${adjunct.startedAt ?? ''} | ${adjunct.completedAt ?? ''} | ${adjunct.gatePath ?? ''} |`);
  }
  return `---
schema: ewai.tracker/v2
slug: ${state.slug}
status: ${state.status}
current_phase: ${state.currentPhase}
run_mode: ${state.mode}
mission: be right, not done
---

# Pipeline Tracker: ${state.intent.title}

**Slug:** \`${state.slug}\`
**Intent file:** \`${state.intent.path}\`
**Started:** ${state.startedAt}
**Last updated:** ${state.updatedAt}
**Review intensity:** ${state.intensity}
**Run mode:** ${state.mode}
**Current status:** ${state.status}
**Current phase:** ${state.currentPhase}
**Durable JSON authority:** \`delivery-state.json\`

Mission: be right, not done

## Phase Status

| # | Phase | Status | Started | Completed | Gate ledger |
|---|---|---|---|---|---|
${rows.join('\n')}

## Human gates

| Gate | Status | Evidence |
|---|---|---|
${state.humanGates.map((gate) => `| ${gate.id} | ${gate.status} | ${gate.evidencePath ?? ''} |`).join('\n')}

## Resume point

**Next phase:** ${state.currentPhase}
**Command:** continue this work through EWAI; the companion invokes the delivery resume harness.

## Blockers

${state.blockedReason || 'None.'}
`;
}

const contextStateStart = '<!-- EWAI-CONTEXT-STATE:START -->';
const contextStateEnd = '<!-- EWAI-CONTEXT-STATE:END -->';

function renderContextState(state) {
  return `${contextStateStart}
## Current EWAI delivery state

**Last updated:** ${state.updatedAt}
**Status:** ${state.status}
**Current phase:** ${state.currentPhase}
**Run mode:** ${state.mode}
**Review intensity:** ${state.intensity}

### Phase log

| Phase | Status | Started | Completed | Key artefact | Notes |
|---|---|---|---|---|---|
${phaseRows(state, true).join('\n')}

### Human gates

| Gate | Status | Started | Completed | Evidence |
|---|---|---|---|---|
${state.humanGates.map((gate) => `| ${gate.id} | ${gate.status} | ${gate.startedAt ?? ''} | ${gate.completedAt ?? ''} | ${gate.evidencePath ?? ''} |`).join('\n')}
${contextStateEnd}`;
}

function renderContextPacket(state) {
  return `${renderContextState(state)}

# Context Packet: ${state.intent.title}

**Slug:** \`${state.slug}\`
**Started:** ${state.startedAt}
**Last updated:** ${state.updatedAt}
**Current phase:** ${state.currentPhase}
**Review intensity:** ${state.intensity}
**Execution tier:** ${state.intensity}
**Input type:** intent
**Run mode:** ${state.mode}
**Branch strategy:** ${state.mode === 'shelf' ? 'no-build-branches' : 'n/a'}
**Working branch:** not recorded yet

---

## What this capability is

Read the accepted intent at \`${state.intent.path}\`. Carry its plain-language summary forward here during Intent; do not infer purpose from code.

## Why it matters

Read the accepted intent and attached personas. Record who benefits and what fails without the capability during Intent.

## Scope boundary

**In scope:**
- Defined by the accepted intent and gated amendments.

**Out of scope (explicitly deferred):**
- Nothing may be silently deferred; record each deferral and its destination.

## Key decisions made during this run

| # | Decision | Made during | Rationale | Reversibility |
|---|---|---|---|---|
| — | No durable decisions recorded yet | — | — | — |

## Open escalations

| # | Phase raised | Question | Status | Resolution |
|---|---|---|---|---|
| — | — | ${state.blockedReason || 'None'} | ${state.blockedReason ? 'open' : 'resolved'} | — |

## Active constraints

- Build may not start without an explicit, durable human approval record.
- A phase may not complete without the canonical deterministic gate checker passing fresh evidence.
- Intent Markdown, adjacent intent JSON, delivery JSON, and SQLite must agree before work resumes.
- SQLite is an operational projection; project-owned SPECS artefacts retain the durable audit trail.
${state.mode === 'shelf' ? '- Shelf mode uses no build branches; resume must pass FitCheck before Build.' : ''}

## Push-back signals

| # | Phase / tool | Reference file | Nature of push-back | What we did instead | Proposed update |
|---|---|---|---|---|---|
| — | — | — | None recorded | — | — |

## Handoff notes

The managed state block above records the exact resume phase. Add durable human or agent handoff notes here; EWAI preserves this section across phase transitions.

## Links

- Tracker: \`tracker.md\`
- Durable delivery state: \`delivery-state.json\`
- Intent: \`${state.intent.path}\`
- Destination: \`destination.md\` (after Plan)
- Task graph: \`task-graph.json\` (after Plan)
- Build plan: \`build-plan.md\` (after Plan)
- Test plan: \`test-plan.md\` (after TestPlan)
- Task reports: \`tasks/T-###/report.md\` (during Build)
- Retro: \`retro.md\` (after completion)
`;
}

function updateContextState(existing, state) {
  const managed = renderContextState(state);
  const start = existing.indexOf(contextStateStart);
  const end = existing.indexOf(contextStateEnd, start);
  if (start === -1 || end === -1) return `${managed}\n\n${existing}`;
  return `${existing.slice(0, start)}${managed}${existing.slice(end + contextStateEnd.length)}`;
}

export function writeDeliveryDocuments(paths, state) {
  state.updatedAt = now();
  atomicJson(paths.statePath, state);
  atomicText(paths.trackerPath, renderTracker(state));
  const context = existsSync(paths.contextPath)
    ? updateContextState(readFileSync(paths.contextPath, 'utf8'), state)
    : renderContextPacket(state);
  atomicText(paths.contextPath, context);
}
