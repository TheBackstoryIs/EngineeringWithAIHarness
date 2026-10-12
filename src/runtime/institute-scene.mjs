import { createHash } from 'node:crypto';
import { listDashboardHandoffs } from './dashboard-handoffs.mjs';
import { readRuntimeIntent } from './intents.mjs';
import { listActiveSessions, listRecentPersonaSpeech, listWorkItems, toIsoTimestamp as toIso } from './work.mjs';

export const SCENE_ROOMS = Object.freeze([
  { id: 'discovery', name: 'Intent discovery', subtitle: 'Archive reading room', phaseKeys: ['ideate', 'intent', 'reconcile'] },
  { id: 'plan', name: 'Plan', subtitle: 'Drafting office', phaseKeys: ['plan', 'pattern-validation'] },
  { id: 'testplan', name: 'Test plan', subtitle: 'Analytical tape library', phaseKeys: ['test-plan'] },
  { id: 'ui', name: 'UI design', subtitle: 'Design workshop', phaseKeys: ['ui-design', 'fit-check'] },
  { id: 'gate', name: 'Awaiting approval', subtitle: 'Private study', phaseKeys: ['manual-qa'] },
  { id: 'build', name: 'Build', subtitle: 'Analytical hall', phaseKeys: ['build', 'standards-sweep'] },
  { id: 'review', name: 'External review', subtitle: 'Review committee room', phaseKeys: ['validate-external-plan', 'validate-external-test-plan', 'validate-external-code'] },
  { id: 'test', name: 'Test execution', subtitle: 'Laboratory', phaseKeys: ['test-execute'] },
  { id: 'deliver', name: 'Deliver', subtitle: 'Exhibition hall', phaseKeys: ['delivery', 'retro'] },
].map((room) => Object.freeze({ ...room, phaseKeys: Object.freeze(room.phaseKeys) })));

const IN_FLIGHT_LANES = new Set(['active', 'qa', 'blocked']);
const QUEUED_LANES = new Set(['backlog', 'ready']);
const QUIET_AFTER_MS = 15 * 60_000;
const SPEAKING_MS = 2 * 60_000;
const TOOL_LABELS = Object.freeze({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', antigravity: 'Antigravity', cursor: 'Cursor', copilot: 'Copilot' });
const phaseRooms = new Map(SCENE_ROOMS.flatMap((room) => room.phaseKeys.map((phase) => [phase, room.id])));

export function roomForPhase(phaseKey) {
  return phaseRooms.get(String(phaseKey ?? '').trim()) ?? null;
}

function toolLabel(tool) {
  const key = String(tool ?? '').trim();
  if (!key) return 'Unknown tool';
  return TOOL_LABELS[key.toLowerCase()] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

export function toSceneModel({ items = [], sessions = [], handoffs = [], personasByItem = new Map(), speech = [], now = Date.now() } = {}) {
  const liveSessions = sessions.filter((session) => session.status !== 'completed');
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const sessionsByItem = new Map();
  for (const session of liveSessions) {
    if (!itemsById.has(session.workItemId)) continue;
    if (!sessionsByItem.has(session.workItemId)) sessionsByItem.set(session.workItemId, []);
    sessionsByItem.get(session.workItemId).push(session);
  }
  for (const list of sessionsByItem.values()) list.sort((a, b) => toIso(b.updatedAt).localeCompare(toIso(a.updatedAt)));

  const handoffByIntent = new Map();
  for (const handoff of handoffs) if (handoff.status === 'pending' && handoff.intentId) handoffByIntent.set(handoff.intentId, handoff.action);

  const shown = items.filter((item) => IN_FLIGHT_LANES.has(item.lane) || sessionsByItem.has(item.id));
  const unmapped = [];
  const intents = shown.map((item) => {
    const itemSessions = sessionsByItem.get(item.id) ?? [];
    const lead = itemSessions[0] ?? null;
    const awaitingHuman = itemSessions.some((session) => session.awaitingHuman);
    // The delivery state is canonical. A session's own phase is used only when the delivery state has no room for the item.
    const canonicalRoom = roomForPhase(item.currentPhase);
    const phaseKey = canonicalRoom ? item.currentPhase : (lead?.phaseKey || item.currentPhase || '');
    const phaseRoom = canonicalRoom ?? roomForPhase(phaseKey);
    const roomId = awaitingHuman ? 'gate' : phaseRoom;
    if (!roomId) unmapped.push({ intentId: item.id, slug: item.slug, phaseKey });
    return {
      id: item.id,
      slug: item.slug,
      title: item.title,
      lane: item.lane,
      state: item.state,
      completionPercent: item.completionPercent ?? 0,
      phaseKey,
      phaseRoomId: phaseRoom,
      roomId,
      blocked: item.lane === 'blocked' ? (item.blockedBy || 'Blocked') : '',
      awaitingHuman,
      handoffPending: handoffByIntent.get(item.intentId) ?? '',
      personas: personasByItem.get(item.id) ?? [],
      agentIds: itemSessions.map((session) => session.id),
    };
  });

  const agents = [...sessionsByItem.values()].flat().sort((a, b) => toIso(b.updatedAt).localeCompare(toIso(a.updatedAt))).map((session) => {
    const intent = intents.find((candidate) => candidate.id === session.workItemId);
    const updatedAt = toIso(session.updatedAt);
    const updated = Date.parse(updatedAt);
    return {
      id: session.id,
      intentId: session.workItemId,
      tool: session.tool,
      toolLabel: toolLabel(session.tool),
      owner: session.ownerId,
      status: session.status,
      phaseKey: session.phaseKey || intent.phaseKey,
      roomId: intent.roomId,
      awaitingHuman: Boolean(session.awaitingHuman),
      waitingSince: session.awaitingHuman ? toIso(session.waitingSince || session.updatedAt) : '',
      question: session.question || '',
      summary: session.summary || '',
      updatedAt,
      quiet: Number.isFinite(updated) ? now - updated > QUIET_AFTER_MS : false,
    };
  });

  for (const intent of intents) {
    const waits = agents.filter((agent) => agent.intentId === intent.id && agent.waitingSince).map((agent) => agent.waitingSince).sort();
    intent.waitingSince = waits[0] ?? '';
    const attached = new Set(intent.personas.map((persona) => persona.ref));
    const spoken = new Map();
    for (const entry of speech) {
      const at = toIso(entry.createdAt);
      if (entry.workItemId !== intent.id || !at || now - Date.parse(at) > SPEAKING_MS) continue;
      for (const ref of entry.personas) if (attached.has(ref) && !spoken.has(ref)) spoken.set(ref, { ref, at, summary: entry.summary || '' });
    }
    intent.speaking = [...spoken.values()];
  }

  const scene = {
    schema: 'ewai.institute-scene/v1',
    rooms: SCENE_ROOMS.map(({ id, name, subtitle }) => ({ id, name, subtitle })),
    intents,
    agents,
    queue: { count: items.filter((item) => QUEUED_LANES.has(item.lane) && !sessionsByItem.has(item.id)).length },
    delivered: { count: items.filter((item) => item.lane === 'done').length },
    unmapped,
  };
  const digest = createHash('sha256').update(JSON.stringify(scene)).digest('hex').slice(0, 16);
  return { ...scene, digest, generatedAt: new Date(now).toISOString() };
}

export function buildInstituteScene(projectRoot, { personaName = (ref) => ref, now = Date.now() } = {}) {
  const items = listWorkItems(projectRoot);
  const sessions = listActiveSessions(projectRoot, { includeCompleted: false });
  const active = new Set(sessions.map((session) => session.workItemId));
  const personasByItem = new Map();
  for (const item of items) {
    if (!active.has(item.id) && !IN_FLIGHT_LANES.has(item.lane)) continue;
    const attachments = readRuntimeIntent(projectRoot, item.intentId)?.personas ?? [];
    personasByItem.set(item.id, attachments.map((attachment) => ({ ref: attachment.ref, name: personaName(attachment.ref), role: attachment.role ?? '' })));
  }
  const speech = listRecentPersonaSpeech(projectRoot, { sinceMs: SPEAKING_MS, now });
  return toSceneModel({ items, sessions, handoffs: listDashboardHandoffs(projectRoot, { status: 'pending' }), personasByItem, speech, now });
}
