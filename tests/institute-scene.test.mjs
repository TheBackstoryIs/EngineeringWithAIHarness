import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { SCENE_ROOMS, roomForPhase, toSceneModel, buildInstituteScene } from '../src/runtime/institute-scene.mjs';
import { initProject } from '../src/project.mjs';
import { createIntent, attachPersonaToIntent } from '../src/intents.mjs';
import { startActiveSession, addActivityEvent, listActiveSessions } from '../src/runtime/work.mjs';

const now = Date.parse('2026-10-12T12:00:00.000Z');
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

function item(overrides = {}) {
  return { id: 'wi-1', slug: 'alpha', title: 'Alpha', lane: 'active', state: 'in-progress', currentPhase: 'plan', completionPercent: 20, blockedBy: '', ...overrides };
}

function session(overrides = {}) {
  return { id: 's-1', workItemId: 'wi-1', ownerId: 'owner-1', tool: 'codex', phaseKey: 'plan', status: 'running', awaitingHuman: false, question: '', summary: 'Drafting', updatedAt: iso(1), ...overrides };
}

test('every delivery stage the harness defines maps to exactly one room', () => {
  const contract = YAML.parse(readFileSync(new URL('../config/delivery-stages.yaml', import.meta.url), 'utf8'));
  const phases = [...contract.stages, ...contract.adjuncts, ...contract.human_gates].map((phase) => phase.id);
  for (const phase of phases) assert.ok(roomForPhase(phase), `${phase} has a room`);
  const claimed = SCENE_ROOMS.flatMap((room) => room.phaseKeys);
  assert.equal(new Set(claimed).size, claimed.length, 'no phase is claimed by two rooms');
  assert.deepEqual([...claimed].sort(), [...phases].sort(), 'rooms claim exactly the contract phases');
  assert.equal(roomForPhase('not-a-phase'), null);
});

test('intents are placed by their recorded phase and unknown phases are reported, not guessed', () => {
  const model = toSceneModel({
    now,
    items: [item(), item({ id: 'wi-2', slug: 'beta', currentPhase: 'build' }), item({ id: 'wi-3', slug: 'gamma', currentPhase: 'mystery-phase' })],
    sessions: [],
  });
  assert.equal(model.intents.find((i) => i.slug === 'alpha').roomId, 'plan');
  assert.equal(model.intents.find((i) => i.slug === 'beta').roomId, 'build');
  const gamma = model.intents.find((i) => i.slug === 'gamma');
  assert.equal(gamma.roomId, null);
  assert.deepEqual(model.unmapped, [{ intentId: 'wi-3', slug: 'gamma', phaseKey: 'mystery-phase' }]);
});

test('queue, delivered and in-flight work are counted from lanes', () => {
  const model = toSceneModel({
    now,
    items: [item(), item({ id: 'b', slug: 'b', lane: 'backlog' }), item({ id: 'r', slug: 'r', lane: 'ready' }), item({ id: 'd', slug: 'd', lane: 'done' }), item({ id: 'k', slug: 'k', lane: 'blocked', blockedBy: 'waiting on schema' })],
    sessions: [],
  });
  assert.equal(model.queue.count, 2);
  assert.equal(model.delivered.count, 1);
  assert.deepEqual(model.intents.map((i) => i.slug).sort(), ['alpha', 'k']);
  assert.equal(model.intents.find((i) => i.slug === 'k').blocked, 'waiting on schema');
});

test('an agent is drawn in its intent room and keeps the phase it reported', () => {
  const model = toSceneModel({ now, items: [item()], sessions: [session({ tool: 'grok', phaseKey: 'build' })] });
  const agent = model.agents[0];
  assert.equal(agent.tool, 'grok');
  assert.equal(agent.toolLabel, 'Grok');
  assert.equal(agent.phaseKey, 'build');
  assert.equal(agent.roomId, 'plan');
  assert.equal(model.intents[0].roomId, 'plan');
  assert.deepEqual(model.intents[0].agentIds, ['s-1']);
});

test('the delivery state outranks a session, which places the intent only when the state has no room for it', () => {
  const canonical = toSceneModel({ now, items: [item({ currentPhase: 'test-execute' })], sessions: [session({ phaseKey: 'plan' })] });
  assert.equal(canonical.intents[0].roomId, 'test');
  const fallback = toSceneModel({ now, items: [item({ currentPhase: 'backlog', lane: 'ready' })], sessions: [session({ phaseKey: 'build' })] });
  assert.equal(fallback.intents[0].roomId, 'build');
  assert.equal(fallback.agents[0].roomId, 'build');
});

test('an unrecognised tool keeps its recorded name and is never relabelled as a model', () => {
  const model = toSceneModel({ now, items: [item()], sessions: [session({ tool: 'my-custom-agent' })] });
  assert.equal(model.agents[0].toolLabel, 'My-custom-agent');
});

test('work waiting for a person sits in the approval room and keeps its real phase', () => {
  const model = toSceneModel({
    now,
    items: [item({ currentPhase: 'plan' })],
    sessions: [session({ awaitingHuman: true, status: 'awaiting-human', question: 'Approve the plan?' })],
  });
  assert.equal(model.intents[0].roomId, 'gate');
  assert.equal(model.intents[0].phaseKey, 'plan');
  assert.equal(model.intents[0].phaseRoomId, 'plan');
  assert.equal(model.intents[0].awaitingHuman, true);
  assert.equal(model.agents[0].question, 'Approve the plan?');
});

test('completed sessions are not drawn and quiet sessions are marked quiet, not stopped', () => {
  const model = toSceneModel({
    now,
    items: [item(), item({ id: 'wi-2', slug: 'beta' })],
    sessions: [session({ status: 'completed' }), session({ id: 's-2', workItemId: 'wi-2', updatedAt: iso(45) })],
  });
  assert.deepEqual(model.agents.map((a) => a.id), ['s-2']);
  assert.equal(model.agents[0].quiet, true);
  assert.equal(model.agents[0].status, 'running');
});

test('a session without a matching work item is dropped rather than invented', () => {
  const model = toSceneModel({ now, items: [item()], sessions: [session({ id: 's-9', workItemId: 'missing' })] });
  assert.deepEqual(model.agents, []);
});

test('personas come only from what the intent records', () => {
  const personas = new Map([['wi-1', [{ ref: 'core.ciso', name: 'CISO', role: 'reviewer' }]]]);
  const model = toSceneModel({ now, items: [item(), item({ id: 'wi-2', slug: 'beta' })], sessions: [], personasByItem: personas });
  assert.deepEqual(model.intents.find((i) => i.slug === 'alpha').personas, [{ ref: 'core.ciso', name: 'CISO', role: 'reviewer' }]);
  assert.deepEqual(model.intents.find((i) => i.slug === 'beta').personas, []);
});

test('pending hand-offs are flagged on the intent without moving it', () => {
  const model = toSceneModel({ now, items: [item({ intentId: 'intent-1' })], sessions: [], handoffs: [{ intentId: 'intent-1', action: 'continue', status: 'pending' }] });
  assert.equal(model.intents[0].handoffPending, 'continue');
  assert.equal(model.intents[0].roomId, 'plan');
});

test('the digest changes with the scene but not with the generation time', () => {
  const input = { items: [item()], sessions: [session()] };
  const first = toSceneModel({ ...input, now });
  const later = toSceneModel({ ...input, now: now + 1000 });
  assert.notEqual(first.generatedAt, later.generatedAt);
  assert.equal(first.digest, later.digest);
  const moved = toSceneModel({ ...input, items: [item({ currentPhase: 'build' })], sessions: [session({ phaseKey: 'build' })], now });
  assert.notEqual(first.digest, moved.digest);
});

test('database timestamps without a zone are read as UTC, so fresh sessions are not marked quiet', () => {
  const stamp = new Date(now - 60_000).toISOString().slice(0, 19).replace('T', ' ');
  const model = toSceneModel({ now, items: [item()], sessions: [session({ updatedAt: stamp })] });
  assert.equal(model.agents[0].quiet, false);
  assert.equal(model.agents[0].updatedAt, new Date(now - 60_000).toISOString().slice(0, 19) + '.000Z');
});

test('a waiting agent reports when it started waiting, from the question event', () => {
  const model = toSceneModel({
    now,
    items: [item()],
    sessions: [session({ awaitingHuman: true, status: 'awaiting-human', waitingSince: iso(12), updatedAt: iso(1) })],
  });
  assert.equal(model.agents[0].waitingSince, new Date(now - 12 * 60_000).toISOString());
  assert.equal(model.intents[0].waitingSince, model.agents[0].waitingSince);
  const running = toSceneModel({ now, items: [item()], sessions: [session()] });
  assert.equal(running.agents[0].waitingSince, '');
  assert.equal(running.intents[0].waitingSince, '');
});

test('a persona is speaking only when a recent event names an attached persona', () => {
  const personas = new Map([['wi-1', [{ ref: 'core.ciso', name: 'CISO', role: 'reviewer' }, { ref: 'core.dpo', name: 'DPO', role: 'reviewer' }]]]);
  const speech = [
    { workItemId: 'wi-1', personas: ['core.ciso', 'core.unattached'], summary: 'Raised a concern', createdAt: iso(1) },
    { workItemId: 'wi-1', personas: ['core.dpo'], summary: 'Old comment', createdAt: iso(20) },
  ];
  const model = toSceneModel({ now, items: [item()], sessions: [], personasByItem: personas, speech });
  assert.deepEqual(model.intents[0].speaking, [{ ref: 'core.ciso', at: iso(1), summary: 'Raised a concern' }]);
});

test('persona speech is recorded with an event and read back from the real runtime database', async (t) => {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-institute-speech-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initProject(root, { name: 'Speech fixture' });
  createIntent(root, { slug: 'alpha', domain: 'platform', title: 'Alpha', details: { problem: 'P.', desiredOutcome: 'O.', users: ['U'], journeys: ['J.'], acceptanceCriteria: ['A.'], constraints: ['C.'], evidence: [], openDecisions: [] } });
  await attachPersonaToIntent(root, 'platform/alpha', { ref: 'ewai.core.maintainer', role: 'reviewer', depth: 3 });
  await attachPersonaToIntent(root, 'platform/alpha', { ref: 'ewai.core.operator', role: 'reviewer', depth: 3 });
  startActiveSession(root, 'alpha', { ownerId: 'tester', tool: 'claude', phaseKey: 'plan', summary: 'Planning' });
  addActivityEvent(root, 'alpha', { eventType: 'progress', summary: 'The maintainer asked about upgrade paths', personas: ['ewai.core.maintainer'] });
  const scene = buildInstituteScene(root, { personaName: (ref) => ref });
  const intent = scene.intents.find((i) => i.slug === 'alpha');
  assert.equal(intent.personas.length, 2);
  assert.deepEqual(intent.speaking.map((p) => p.ref), ['ewai.core.maintainer']);
  assert.throws(() => addActivityEvent(root, 'alpha', { eventType: 'progress', summary: 'Bad', personas: 'not-an-array' }), /personas/i);
});

test('a waiting session with no recorded question falls back to its last update', () => {
  const model = toSceneModel({ now, items: [item()], sessions: [session({ awaitingHuman: true, status: 'awaiting-human', waitingSince: '', updatedAt: iso(7) })] });
  assert.equal(model.agents[0].waitingSince, new Date(now - 7 * 60_000).toISOString());
});

test('the runtime reports when a person was last asked, even after later events', async (t) => {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-institute-wait-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initProject(root, { name: 'Wait fixture' });
  createIntent(root, { slug: 'alpha', domain: 'platform', title: 'Alpha', details: { problem: 'P.', desiredOutcome: 'O.', users: ['U'], journeys: ['J.'], acceptanceCriteria: ['A.'], constraints: ['C.'], evidence: [], openDecisions: [] } });
  startActiveSession(root, 'alpha', { ownerId: 'tester', tool: 'claude', phaseKey: 'plan', summary: 'Planning' });
  addActivityEvent(root, 'alpha', { eventType: 'question', summary: 'Needs a decision', question: 'Which?', requiresHuman: true });
  const [waiting] = listActiveSessions(root);
  assert.equal(waiting.awaitingHuman, true);
  assert.match(waiting.waitingSince, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  addActivityEvent(root, 'alpha', { eventType: 'progress', summary: 'Still waiting', requiresHuman: true });
  const [later] = listActiveSessions(root);
  assert.equal(later.waitingSince, waiting.waitingSince);
});
