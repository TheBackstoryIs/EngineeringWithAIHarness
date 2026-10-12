import { intentColour, personaColour, toolStyle } from './scene.js';

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

// The dashboard CSP forbids inline style attributes, so colours and widths travel as data attributes and are applied through the CSSOM.
export function paint(root) {
  for (const el of root.querySelectorAll('[data-c]')) el.style.setProperty('--c', el.dataset.c);
  for (const el of root.querySelectorAll('[data-w]')) el.style.width = `${el.dataset.w}%`;
}

export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const SHORT = { discovery: 'Discover', plan: 'Plan', testplan: 'Test plan', ui: 'UI', gate: 'Approval', build: 'Build', review: 'Review', test: 'Test', deliver: 'Deliver' };
const roomOf = (v, id) => v.rooms.find((r) => r.id === id);
const colourOf = (v, intent) => v.colours[intent.id] ?? intentColour(intent.slug);

function placeLabel(v, intent) {
  if (intent.awaitingHuman) return intent.waitingSince ? `Waiting ${waitedFor(intent.waitingSince, v.serverNow)}` : 'Waiting for you';
  if (intent.blocked) return 'Blocked';
  const room = roomOf(v, intent.roomId);
  return room ? room.name : 'Phase not mapped';
}

export function waitedFor(since, now = Date.now()) {
  const ms = now - Date.parse(since);
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

function agentState(agent, v) {
  if (agent.awaitingHuman) return agent.waitingSince ? `Waiting for you, ${waitedFor(agent.waitingSince, v.serverNow)}` : 'Waiting for you';
  if (agent.quiet) return 'No recent activity';
  return agent.status === 'running' ? 'Working' : agent.status;
}

export function kpis(v) {
  const m = v.model;
  return {
    flight: m.intents.length,
    agents: m.agents.filter((a) => a.status === 'running' && !a.quiet && !a.awaitingHuman).length,
    waiting: m.intents.filter((i) => i.awaitingHuman).length,
    delivered: m.delivered.count,
  };
}

export function intentsHtml(v) {
  const rows = [...v.model.intents].sort((a, b) => (roomOf(v, b.phaseRoomId)?.index ?? -1) - (roomOf(v, a.phaseRoomId)?.index ?? -1)).map((it) => {
    const at = roomOf(v, it.phaseRoomId)?.index ?? -1;
    const pips = v.rooms.map((r) => `<u class="${r.index < at ? 'd' : r.index === at ? 'c' : ''}"></u>`).join('');
    const personas = it.personas.map((p) => `<s class="on" data-c="${personaColour(p.ref)}">${esc(p.name)}${it.speaking.some((x) => x.ref === p.ref) ? ' · speaking' : ''}</s>`).join('');
    const sel = v.selected === it.id ? ' sel' : '';
    return `<div class="row${sel}" tabindex="0" data-id="${esc(it.id)}" data-c="${colourOf(v, it)}"><i class="chip"></i><div class="t"><span>${esc(it.slug)}</span><em>${esc(placeLabel(v, it))}</em></div><div class="pips">${pips}</div><div class="pp">${personas}</div></div>`;
  });
  return rows.join('') || '<div class="hint2">No intents are in flight. Work appears here when it is active, in QA or blocked.</div>';
}

export function agentsHtml(v) {
  const rows = v.model.agents.map((a) => {
    const intent = v.model.intents.find((i) => i.id === a.intentId);
    const dim = v.filter.size && !v.filter.has(String(a.tool).toLowerCase());
    const state = agentState(a, v);
    const cls = a.awaitingHuman ? 'a' : a.status === 'running' && !a.quiet ? 'w' : '';
    return `<div class="ag${dim ? ' dim' : ''}" data-c="${toolStyle(a.tool).colour}"><i></i><div>${esc(a.toolLabel)}<small>${esc(roomOf(v, a.roomId)?.name ?? 'No room')}${intent ? ` · ${esc(intent.slug)}` : ''}</small></div><div class="st ${cls}">${esc(state)}</div></div>`;
  });
  return rows.join('') || '<div class="hint2">No agent sessions are open. Sessions appear when a tool registers active work.</div>';
}

export function chipsHtml(v) {
  const tools = [...new Map(v.model.agents.map((a) => [String(a.tool).toLowerCase(), a.toolLabel])).entries()];
  return tools.map(([key, label]) => `<button type="button" class="chip" data-tool="${esc(key)}" aria-pressed="${v.filter.has(key)}" data-c="${toolStyle(key).colour}"><i></i>${esc(label)}</button>`).join('');
}

export function legendHtml(v) {
  const tools = [...new Map(v.model.agents.map((a) => [String(a.tool).toLowerCase(), a.toolLabel])).entries()];
  return `${tools.map(([key, label]) => `<span data-c="${toolStyle(key).colour}"><i></i>${esc(label)}</span>`).join('')}<span data-c="#e0b04a"><i></i>Persona lens (coloured tag)</span><span data-c="#c8bfa0"><i></i>Runner (flat cap)</span>`;
}

export function stripHtml(v) {
  const dot = (it) => `<i class="${it.id === v.selected ? 'sel' : ''}" data-id="${esc(it.id)}" data-c="${colourOf(v, it)}" title="${esc(it.slug)}"></i>`;
  let h = `<div class="pc"><div class="h"><b>Queue</b><em>${v.model.queue.count}</em></div></div>`;
  for (const r of v.rooms) {
    h += `<div class="pc${r.overflow ? ' jam' : ''}${v.focus === r.id ? ' focus' : ''}" data-room="${r.id}" title="${esc(r.name)}"><div class="h"><span><b>${String(r.index + 1).padStart(2, '0')}</b> ${esc(SHORT[r.id] ?? r.name)}</span><em>${r.intents.length}/${r.capacity}${r.overflow ? ` +${r.overflow}` : ''}</em></div><div class="dots">${r.intents.map(dot).join('')}</div></div>`;
  }
  return `${h}<div class="pc"><div class="h"><b>Done</b><em>${v.model.delivered.count}</em></div></div>`;
}

function agentLines(v, intent) {
  const agents = v.model.agents.filter((a) => a.intentId === intent.id);
  if (!agents.length) return '<div class="note">No active session is registered for this intent.</div>';
  return agents.map((a) => `<div class="sh" data-c="${toolStyle(a.tool).colour}"><i></i><span>${esc(a.toolLabel)}</span><em class="${a.awaitingHuman ? 'a' : a.status === 'running' && !a.quiet ? 'w' : ''}">${esc(agentState(a, v))}</em></div>${a.summary ? `<div class="note">${esc(a.summary)}</div>` : ''}${a.question ? `<div class="note ask">${esc(a.question)}</div>` : ''}`).join('');
}

export function roomHtml(v) {
  const r = roomOf(v, v.focus);
  if (!r) return '';
  let h = `<div class="rph"><div><b>${String(r.index + 1).padStart(2, '0')} · ${esc(r.name)}</b><small>${esc(r.subtitle)}</small></div><button type="button" data-act="out">Zoom out</button></div>`;
  h += `<div class="rpm"><span>${r.seated}/${r.capacity} desks used</span><span class="${r.overflow ? 'jam' : ''}">${r.overflow} not drawn</span></div>`;
  if (r.id === 'gate') h += '<div class="note">Work lands here when a session has asked a person a question. The longer it waits, the higher the thermometer rises, filling at 30 minutes. Answer it from the board; this scene never approves anything.</div>';
  for (const it of r.intents) {
    const personas = it.personas.map((p) => `<s class="on" data-c="${personaColour(p.ref)}">${esc(p.name)}${it.speaking.some((x) => x.ref === p.ref) ? ' · speaking' : ''}</s>`).join('');
    h += `<div class="sc" data-c="${colourOf(v, it)}"><div class="si" data-id="${esc(it.id)}" data-c="${colourOf(v, it)}"><i></i><span>${esc(it.slug)}</span><em>${esc(it.phaseKey || 'no phase')}</em></div><div class="bar" data-c="${colourOf(v, it)}"><u data-w="${Math.round(it.completionPercent ?? 0)}"></u></div><div class="note">Overall progress ${Math.round(it.completionPercent ?? 0)}%${it.blocked ? ` · Blocked: ${esc(it.blocked)}` : ''}${it.handoffPending ? ` · hand-off queued (${esc(it.handoffPending)})` : ''}</div>${agentLines(v, it)}${personas ? `<div class="pp">${personas}</div><div class="note">Persona lenses attached to this intent.</div>` : ''}<button type="button" class="go" data-act="open" data-slug="${esc(it.slug)}">Open intent</button></div>`;
  }
  if (!r.intents.length) h += '<div class="note">Nothing is here right now.</div>';
  if (r.id === 'discovery') h += `<div class="wt"><h4>Queue</h4><div class="note">${v.model.queue.count} intent${v.model.queue.count === 1 ? '' : 's'} in backlog or ready, not yet started.</div></div>`;
  if (r.id === 'deliver') h += `<div class="wt"><h4>Shipped</h4><div class="note">${v.model.delivered.count} intent${v.model.delivered.count === 1 ? '' : 's'} in the done lane.</div></div>`;
  return h;
}

function kv(rows) {
  return `<dl>${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val}</dd>`).join('')}</dl>`;
}

const intentLink = (v, id) => {
  const it = v.model.intents.find((i) => i.id === id);
  return it ? `<a data-id="${esc(it.id)}" data-c="${colourOf(v, it)}">${esc(it.slug)}</a>` : 'None';
};

export function inspectorHtml(v, now = Date.now()) {
  const target = v.inspect;
  const empty = '<div class="hint2">Click an agent, persona, runner or crate in the scene, or an intent in a list, to inspect it. Selecting an intent dims everything else.</div>';
  if (!target) return empty;
  if (target.t === 'agent') {
    const a = v.model.agents.find((x) => x.id === target.id);
    if (!a) return empty;
    return `<div class="insp"><div class="ih" data-c="${toolStyle(a.tool).colour}"><i></i>${esc(a.toolLabel)}</div>${kv([
      ['Room', esc(roomOf(v, a.roomId)?.name ?? 'None')], ['Phase', esc(a.phaseKey || 'Not recorded')], ['State', esc(agentState(a, v))],
      ['Owner', esc(a.owner || 'Not recorded')], ['Last update', esc(ago(a.updatedAt, now))], ['Intent', intentLink(v, a.intentId)],
      ...(a.summary ? [['Summary', esc(a.summary)]] : []), ...(a.question ? [['Question', esc(a.question)]] : []),
    ])}</div>`;
  }
  if (target.t === 'persona') {
    const it = v.model.intents.find((i) => i.id === target.intentId);
    const p = it?.personas.find((x) => x.ref === target.ref);
    if (!p) return empty;
    const talk = it.speaking.find((x) => x.ref === p.ref);
    return `<div class="insp"><div class="ih" data-c="${personaColour(p.ref)}"><i></i>${esc(p.name)}</div>${kv([['Kind', 'Persona lens'], ['Role on intent', esc(p.role || 'Not recorded')], ['Attached to', intentLink(v, it.id)], ['Speaking', talk ? esc(talk.summary || 'In the latest update') : 'Not in the last two minutes']])}</div>`;
  }
  if (target.t === 'runner') return `<div class="insp"><div class="ih" data-c="#c8bfa0"><i></i>Runner</div>${kv([['Doing', 'Carrying an intent to the room for its new phase'], ['Intent', intentLink(v, target.intentId)]])}</div>`;
  const it = v.model.intents.find((i) => i.id === target.id);
  if (!it) return empty;
  return `<div class="insp"><div class="ih" data-c="${colourOf(v, it)}"><i></i>${esc(it.slug)}</div>${kv([
    ['Title', esc(it.title)], ['Phase', esc(it.phaseKey || 'Not recorded')], ['Room', esc(placeLabel(v, it))], ['Lane', esc(it.lane)],
    ['Progress', `${Math.round(it.completionPercent ?? 0)}%`], ...(it.blocked ? [['Blocked', esc(it.blocked)]] : []),
    ...(it.handoffPending ? [['Hand-off', `Queued: ${esc(it.handoffPending)}`]] : []),
    ['Agents', v.model.agents.filter((a) => a.intentId === it.id).map((a) => esc(a.toolLabel)).join(', ') || 'None'],
    ['Personas', it.personas.map((p) => esc(p.name)).join(', ') || 'None attached'],
  ])}<button type="button" class="go" data-act="open" data-slug="${esc(it.slug)}">Open intent</button><button type="button" class="fol" data-act="follow" aria-pressed="${v.follow}">${v.follow ? 'Following. Click to stop' : 'Follow with camera'}</button></div>`;
}

export function unmappedHtml(v) {
  if (!v.model.unmapped.length) return '';
  return `<div class="card"><h2>Not placed</h2><div class="hint2">These intents are in a phase this scene has no room for, so they are listed rather than drawn.</div>${v.model.unmapped.map((u) => `<div class="row" tabindex="0" data-id="${esc(u.intentId)}" data-c="${intentColour(u.slug)}"><i class="chip"></i><div class="t"><span>${esc(u.slug)}</span><em>${esc(u.phaseKey || 'no phase')}</em></div></div>`).join('')}</div>`;
}
