import { K, W, H, SCALE, glowSprite, R } from './draw.js';
import { ROOMS, ROOM_BY_ID, FLOOR_Y, buildBackdrop, drawStructureOn, renderRoom } from './rooms.js';
import { drawCrate, drawFigure, hashString, makeFigure, makePalette, stepFigure } from './figures.js';
import { drawBubble, drawBrackets, drawDesk, drawDeskLamp, drawLink, drawMovingParts, drawProgress, drawSky, drawThermometer } from './animate.js';

const INTENT_COLOURS = ['#e8a33d', '#4fb3a9', '#d9694f', '#9bbf5a', '#7ea6d4', '#e08fb0', '#e8d36a', '#e07a3d'];
const PERSONA_COLOURS = ['#d97c6a', '#6fb0d6', '#e0b04a', '#8fc27a', '#c6a3d6', '#e59a5a', '#5fc7b8', '#e8826f', '#b8b2e0', '#f0cf70'];
const TOOL_STYLES = {
  claude: { coat: '#2a6a6c', trim: K.brassL, colour: '#4fb3a9' },
  codex: { coat: '#6d7a3a', trim: '#d9e29a', colour: '#9bbf5a' },
  gemini: { coat: '#bb8640', trim: '#fff0c0', colour: '#7ea6d4' },
  grok: { coat: '#4b5b64', trim: '#e6dbbb', colour: '#c6a3d6' },
};
const OTHER_TOOL_COATS = ['#5d6d7a', '#7a5a6a', '#6a7a5a', '#8a6a4a'];
const MAX_RUNNERS = 4;
const LIFT_X = 785;
export const FRUSTRATION_FULL_MS = 30 * 60_000;

export const intentColour = (slug) => INTENT_COLOURS[hashString(slug) % INTENT_COLOURS.length];
export const personaColour = (ref) => PERSONA_COLOURS[hashString(ref) % PERSONA_COLOURS.length];
export function toolStyle(tool) {
  const key = String(tool ?? '').toLowerCase();
  if (TOOL_STYLES[key]) return TOOL_STYLES[key];
  const coat = OTHER_TOOL_COATS[hashString(key) % OTHER_TOOL_COATS.length];
  return { coat, trim: K.brassD, colour: '#b9b09a' };
}

function setColour(element, colour) {
  element.style.setProperty('--c', colour);
}

function element(parent, className, html = '') {
  const e = document.createElement('div');
  e.className = className;
  e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

export function createScene({ canvas, overlay, stage, tooltip }) {
  const ctx = canvas.getContext('2d');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  ctx.imageSmoothingEnabled = true;
  const backdrop = buildBackdrop();
  const glow = { '255,190,90': glowSprite('255,190,90'), '120,255,170': glowSprite('120,255,170'), '255,170,60': glowSprite('255,170,60') };
  const vignette = document.createElement('canvas');
  vignette.width = W * SCALE;
  vignette.height = H * SCALE;
  {
    const c = vignette.getContext('2d');
    c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    const gr = c.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, W * .62);
    gr.addColorStop(0, 'rgba(8,14,16,0)');
    gr.addColorStop(1, 'rgba(4,8,10,.62)');
    c.fillStyle = gr;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,196,120,.045)';
    c.fillRect(0, 0, W, H);
    const bt = c.createLinearGradient(0, H * .8, 0, H);
    bt.addColorStop(0, 'rgba(0,0,0,0)');
    bt.addColorStop(1, 'rgba(0,0,0,.28)');
    c.fillStyle = bt;
    c.fillRect(0, H * .8, W, H * .2);
  }
  const roomCache = new Map();
  const cachedRoom = (room) => {
    if (!roomCache.has(room.id)) roomCache.set(room.id, renderRoom(room));
    return roomCache.get(room.id);
  };

  const cam = { x: 0, y: 0, s: 1, tx: 0, ty: 0, ts: 1 };
  const records = new Map();
  const runners = [];
  const particles = [];
  const lift = { y: FLOOR_Y[0] - 4, carrier: null };
  const listeners = { change: () => {}, event: () => {} };
  const roomNames = {};
  let model = null;
  let focus = null;
  let selected = null;
  let inspect = null;
  let follow = false;
  let filter = new Set();
  let daylight = .6;
  let lastDelivered = null;
  let agentsByIntent = new Map();
  let agentById = new Map();
  let clockOffset = 0;
  let lastTick = 0;
  const serverNow = () => Date.now() - clockOffset;

  const desks = ROOMS.flatMap((room) => room.desks.map((x, k) => ({
    id: `${room.id}-${k}`, room, x, fy: room.fy, intentId: null, reserved: null, agent: null, agentId: null, personas: [], tag: null, tagKey: '',
  })));
  const desksOf = (roomId) => desks.filter((d) => d.room.id === roomId);
  const freeDesk = (roomId) => desksOf(roomId).find((d) => !d.intentId && !d.reserved);

  const plaques = ROOMS.map((room) => {
    const e = element(overlay, 'plaque', `<span class="no">${String(room.i + 1).padStart(2, '0')}</span><span class="name"></span><span class="n z">0/0</span><span class="q"></span>`);
    e.addEventListener('click', (event) => {
      event.stopPropagation();
      api.setFocus(focus === room.id ? null : room.id);
    });
    return { room, e, name: e.querySelector('.name'), n: e.querySelector('.n'), q: e.querySelector('.q') };
  });

  function emit(text) {
    listeners.event(text);
  }

  const roomName = (id) => roomNames[id] ?? id ?? 'no room';

  /* ---------- reconcile ---------- */
  function freeRecordDesk(rec) {
    const d = desks.find((candidate) => candidate.id === rec.deskId);
    if (d && d.intentId === rec.id) {
      d.intentId = null;
      d.agentId = null;
      d.agent = null;
      for (const p of d.personas) p.tag?.remove();
      d.personas = [];
    }
    rec.deskId = null;
  }

  function seat(rec, desk) {
    desk.intentId = rec.id;
    desk.reserved = null;
    rec.deskId = desk.id;
    rec.state = 'seated';
  }

  function legTo(f, x, row, lane, cb) {
    const out = [];
    if (f.row !== row) {
      out.push({ x: LIFT_X, y: FLOOR_Y[f.row] - lane, cb: () => { lift.carrier = f; } });
      out.push({ x: LIFT_X, y: FLOOR_Y[row] - lane, lift: true, cb: () => { f.row = row; lift.carrier = null; } });
    }
    out.push({ x, y: FLOOR_Y[row] - lane, cb });
    return out;
  }

  function startTransit(rec, from, to) {
    const lane = 3 + (hashString(rec.id) % 6);
    const f = makeFigure({ key: `runner:${rec.id}`, kind: 'runner', hat: 'cap', pal: makePalette(`runner:${rec.id}`, '#3c4a55', { pants: '#26323a', trim: K.brass }), x: from.x - 30, y: from.fy - lane, row: from.room.row, iid: rec.id });
    to.reserved = rec.id;
    const runner = { f, rec, from, to };
    runners.push(runner);
    const finish = () => {
      const index = runners.indexOf(runner);
      if (index >= 0) runners.splice(index, 1);
    };
    const toDestination = () => legTo(f, to.x - 15, to.room.row, lane, () => {
      f.carry = null;
      to.reserved = null;
      const current = records.get(rec.id);
      if (current) arriveAt(current, to);
      f.dir = 1;
      f.path = [{ x: to.x - 15 - 30, y: to.fy - lane, cb: finish }];
    });
    f.path = legTo(f, from.x - 15, from.room.row, lane, () => {
      f.carry = rec.colour;
      if (from.intentId === rec.id) {
        from.intentId = null;
        from.agent = null;
        from.agentId = null;
        for (const p of from.personas) p.tag?.remove();
        from.personas = [];
      }
      rec.deskId = null;
      rec.state = 'transit';
      f.path = toDestination();
    });
    rec.state = 'pickup';
  }

  function arriveAt(rec, planned) {
    const wanted = rec.data?.roomId;
    const desk = planned.room.id === wanted && !planned.intentId ? planned : (wanted ? freeDesk(wanted) : null);
    if (desk) seat(rec, desk);
    else rec.state = wanted ? 'overflow' : 'unplaced';
    rec.roomId = wanted ?? null;
  }

  function update(next) {
    const first = !model;
    model = next;
    clockOffset = Date.now() - Date.parse(next.generatedAt);
    for (const r of next.rooms) roomNames[r.id] = r.name;
    agentsByIntent = new Map();
    agentById = new Map(next.agents.map((a) => [a.id, a]));
    for (const agent of next.agents) {
      if (!agentsByIntent.has(agent.intentId)) agentsByIntent.set(agent.intentId, []);
      agentsByIntent.get(agent.intentId).push(agent);
    }
    const incoming = new Map(next.intents.map((i) => [i.id, i]));
    for (const rec of [...records.values()]) {
      if (incoming.has(rec.id)) continue;
      freeRecordDesk(rec);
      const owner = runners.find((r) => r.rec === rec);
      if (owner) {
        owner.f.carry = null;
        if (owner.to.reserved === rec.id) owner.to.reserved = null;
      }
      records.delete(rec.id);
      if (selected === rec.id) {
        selected = null;
        inspect = null;
      }
    }
    for (const it of next.intents) {
      let rec = records.get(it.id);
      const isNew = !rec;
      if (isNew) {
        rec = { id: it.id, deskId: null, state: 'none', roomId: null, colour: intentColour(it.slug) };
        records.set(it.id, rec);
        if (!first) emit(`${it.slug} appeared${it.roomId ? ` in ${roomName(it.roomId)}` : ''}`);
      }
      const previousRoom = rec.roomId;
      rec.data = it;
      if (rec.state === 'pickup' || rec.state === 'transit') continue;
      if (!it.roomId) {
        freeRecordDesk(rec);
        rec.state = 'unplaced';
        rec.roomId = null;
        continue;
      }
      const current = desks.find((d) => d.id === rec.deskId);
      if (current && current.room.id === it.roomId) {
        rec.roomId = it.roomId;
        continue;
      }
      if (previousRoom && previousRoom !== it.roomId) emit(`${it.slug} moved from ${roomName(previousRoom)} to ${roomName(it.roomId)}`);
      const destination = freeDesk(it.roomId);
      if (current && destination && !first && runners.length < MAX_RUNNERS) {
        rec.roomId = it.roomId;
        startTransit(rec, current, destination);
        continue;
      }
      freeRecordDesk(rec);
      if (destination) seat(rec, destination);
      else rec.state = 'overflow';
      rec.roomId = it.roomId;
    }
    for (const rec of records.values()) {
      if (rec.state !== 'overflow' && rec.state !== 'unplaced') continue;
      const wanted = rec.data.roomId;
      const desk = wanted ? freeDesk(wanted) : null;
      if (desk) seat(rec, desk);
    }
    if (!first && lastDelivered !== null && next.delivered.count > lastDelivered) {
      const deliver = ROOM_BY_ID.deliver;
      emit(`${next.delivered.count - lastDelivered} intent${next.delivered.count - lastDelivered > 1 ? 's' : ''} delivered`);
      for (let i = 0; i < 18; i++) particles.push({ x: deliver.x + 100 + (i % 9 - 4) * 4, y: deliver.fy - 28, vx: (i % 7 - 3) * 6, vy: -20 - (i % 5) * 7, l: .7 + (i % 4) * .15, c: K.brassL });
    }
    lastDelivered = next.delivered.count;
    for (const desk of desks) syncDesk(desk);
    listeners.change();
  }

  function leadAgentOf(rec) {
    const list = agentsByIntent.get(rec.id) ?? [];
    return list[0] ?? null;
  }

  function syncDesk(desk) {
    const rec = desk.intentId ? records.get(desk.intentId) : null;
    if (!rec) {
      if (desk.tag) {
        desk.tag.remove();
        desk.tag = null;
        desk.tagKey = '';
      }
      desk.agent = null;
      desk.agentId = null;
      return;
    }
    const agent = leadAgentOf(rec);
    if (!agent) {
      desk.agent = null;
      desk.agentId = null;
    } else if (desk.agentId !== agent.id) {
      const style = toolStyle(agent.tool);
      desk.agentId = agent.id;
      desk.agent = makeFigure({ key: agent.id, x: desk.x, y: desk.fy - 11, pal: makePalette(agent.id, style.coat, { trim: style.trim, badge: style.colour }), dir: 1, iid: rec.id });
    }
    if (desk.agent) {
      desk.agent.wave = Boolean(agent?.awaitingHuman);
      desk.agent.work = Boolean(agent && agent.status === 'running' && !agent.quiet && !agent.awaitingHuman);
    }
    const refs = rec.data.personas;
    const same = desk.personas.length === refs.length && desk.personas.every((p, i) => p.ref === refs[i].ref);
    if (!same) {
      for (const p of desk.personas) p.tag?.remove();
      desk.personas = refs.map((persona, i) => {
        const colour = personaColour(persona.ref);
        const tag = element(overlay, 'tag persona', '');
        tag.textContent = shortName(persona.name);
        setColour(tag, colour);
        const span = Math.max(30, desk.room.w - 40);
        const f = makeFigure({
          key: `persona:${persona.ref}:${rec.id}`, kind: 'persona', ref: persona.ref, name: persona.name, role: persona.role,
          x: desk.room.x + 20 + ((hashString(`${persona.ref}:${rec.id}`) % 100) / 100) * span, y: desk.fy - 3 - (i % 3) * 3.5, dir: -1,
          pal: makePalette(persona.ref, mixCoat(colour), { badge: colour }), iid: rec.id, tag, wait: 1 + i * .7, speaking: false, bubbleAt: 0,
        });
        return f;
      });
    }
    const speakingRefs = new Set(rec.data.speaking.map((entry) => entry.ref));
    for (const p of desk.personas) {
      const talking = speakingRefs.has(p.ref);
      if (talking && !p.speaking) p.path = [{ x: desk.x + 18 + (desk.personas.indexOf(p) % 3) * 6, y: desk.fy - 3 }];
      p.speaking = talking;
    }
    const label = agent ? agent.toolLabel : 'No active session';
    const extra = (agentsByIntent.get(rec.id)?.length ?? 0) - 1;
    const waited = agent?.awaitingHuman && agent.waitingSince ? Math.max(0, Math.floor((serverNow() - Date.parse(agent.waitingSince)) / 60_000)) : -1;
    const key = `${rec.id}|${agent?.id ?? ''}|${agent?.quiet ? 'q' : ''}|${extra}|${waited}`;
    if (!desk.tag) {
      desk.tag = element(overlay, 'tag agent', '');
    }
    if (desk.tagKey !== key) {
      desk.tagKey = key;
      desk.tag.className = `tag agent${agent ? '' : ' idle'}${agent?.quiet ? ' quiet' : ''}`;
      setColour(desk.tag, agent ? toolStyle(agent.tool).colour : '#8fa59f');
      desk.tag.textContent = '';
      const name = document.createElement('span');
      name.className = 'who';
      const mark = document.createElement('span');
      mark.className = 'm';
      name.append(mark, `${label}${extra > 0 ? ` +${extra}` : ''}`);
      const slug = document.createElement('span');
      slug.className = 's';
      slug.textContent = waited >= 0 ? `${rec.data.slug} · waiting ${waited} min` : rec.data.slug;
      desk.tag.append(name, slug);
    }
  }

  const mixCoat = (colour) => {
    const n = parseInt(colour.slice(1), 16);
    const f = (v) => Math.round(v * .8).toString(16).padStart(2, '0');
    return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
  };
  const shortName = (name) => {
    const text = String(name ?? '');
    if (text.length <= 14) return text;
    const words = text.split(/\s+/);
    return words[words.length - 1].slice(0, 14);
  };

  /* ---------- derived view for panels ---------- */
  function view() {
    const roomsView = ROOMS.map((room) => {
      const roomDesks = desksOf(room.id);
      const intents = [...records.values()].filter((rec) => rec.data?.roomId === room.id).map((rec) => rec.data);
      const seated = roomDesks.filter((d) => d.intentId).length;
      return {
        id: room.id, index: room.i, name: roomNames[room.id] ?? room.id, subtitle: model?.rooms.find((r) => r.id === room.id)?.subtitle ?? '',
        capacity: roomDesks.length, seated, intents, overflow: Math.max(0, intents.length - roomDesks.length),
        agents: (model?.agents ?? []).filter((a) => a.roomId === room.id),
      };
    });
    return { model, serverNow: serverNow(), rooms: roomsView, focus, selected, inspect, follow, filter, colours: Object.fromEntries([...records.values()].map((r) => [r.id, r.colour])) };
  }

  /* ---------- camera ---------- */
  function setFocus(id) {
    focus = id;
    if (!id) {
      cam.tx = 0;
      cam.ty = 0;
      cam.ts = 1;
      follow = false;
    } else {
      const r = ROOM_BY_ID[id], top = r.top - 6, rh = r.fy + 16 - top;
      const sc = Math.min(H * .94 / rh, W * .66 / r.w), vw = W / sc, vh = H / sc, left = r.x + r.w / 2 > W / 2;
      cam.ts = sc;
      cam.tx = Math.max(0, Math.min(W - vw, r.x + r.w / 2 - vw * (left ? .635 : .365)));
      cam.ty = Math.max(0, Math.min(H - vh, top + rh / 2 - vh / 2));
      focus = id;
      api.panelSide = left ? 'left' : 'right';
    }
    listeners.change();
  }

  function followTick() {
    if (!follow || !selected) return;
    const rec = records.get(selected);
    const room = rec?.data?.roomId;
    if (room && room !== focus) setFocus(room);
  }

  /* ---------- frame ---------- */
  function step(dt) {
    for (const desk of desks) {
      if (desk.agent) stepFigure(desk.agent, dt);
      for (const p of desk.personas) {
        stepFigure(p, dt);
        if (p.path.length || p.speaking) continue;
        p.wait -= dt;
        if (p.wait > 0) continue;
        const r = desk.room;
        p.wait = 1.5 + Math.random() * 4;
        p.path = [{ x: r.x + 16 + Math.random() * (r.w - 34), y: desk.fy - 2 - Math.random() * 7 }];
      }
    }
    for (const runner of runners) stepFigure(runner.f, dt);
    if (lift.carrier) lift.y = lift.carrier.y;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.l -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt;
      if (p.l <= 0) particles.splice(i, 1);
    }
    for (const desk of desks) {
      const agent = desk.agentId ? agentById.get(desk.agentId) : null;
      if (agent && agent.status === 'running' && !agent.quiet && !agent.awaitingHuman && Math.random() < dt * 4) {
        particles.push({ x: desk.x + (Math.random() - .5) * 14, y: desk.fy - 17, vx: (Math.random() - .5) * 24, vy: -14 - Math.random() * 20, l: .4 + Math.random() * .5, c: Math.random() < .5 ? K.amber : K.brassL });
      }
    }
    followTick();
  }

  const dimDesk = (desk) => {
    let a = 1;
    const agent = desk.agentId ? agentById.get(desk.agentId) : null;
    if (selected && desk.intentId !== selected) a = .35;
    if (filter.size && !(agent && filter.has(String(agent.tool).toLowerCase()))) a = Math.min(a, .28);
    return a;
  };

  function selectedPosition() {
    const rec = records.get(selected);
    if (!rec) return null;
    const desk = desks.find((d) => d.id === rec.deskId);
    if (desk) return { x: desk.x, y: desk.fy - 21 };
    const runner = runners.find((r) => r.rec === rec);
    return runner ? { x: runner.f.x, y: runner.f.y - 21 } : null;
  }

  const place = (el, x, y) => {
    el.style.left = `${(x - cam.x) * cam.s / W * 100}%`;
    el.style.top = `${(y - cam.y) * cam.s / H * 100}%`;
  };

  function render(now, rawDt, motion) {
    const t = now / 1000, kk = 1 - Math.exp(-rawDt * 6);
    cam.s += (cam.ts - cam.s) * kk;
    cam.x += (cam.tx - cam.x) * kk;
    cam.y += (cam.ty - cam.y) * kk;
    if (Math.abs(cam.ts - cam.s) < .002 && Math.abs(cam.tx - cam.x) < .1 && Math.abs(cam.ty - cam.y) < .1) {
      cam.s = cam.ts;
      cam.x = cam.tx;
      cam.y = cam.ty;
    }
    if (now - lastTick > 1000) {
      lastTick = now;
      for (const desk of desks) if (desk.agentId && agentById.get(desk.agentId)?.awaitingHuman) syncDesk(desk);
    }
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const k = SCALE * cam.s;
    ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
    daylight = drawSky(ctx, motion ? now : 0);
    if (cam.s > 1.015) {
      const x0 = cam.x, x1 = cam.x + W / cam.s, y0 = cam.y, y1 = cam.y + H / cam.s;
      for (const r of ROOMS) {
        if (r.x + r.w < x0 || r.x > x1 || r.fy + 14 < y0 || r.top > y1) continue;
        const rc = cachedRoom(r);
        ctx.drawImage(rc.cvs, r.x, r.top, r.w, rc.h);
      }
      drawStructureOn(ctx);
    } else ctx.drawImage(backdrop.bg, 0, 0, W, H);
    const load = {};
    for (const room of ROOMS) {
      const roomDesks = desksOf(room.id);
      load[room.id] = roomDesks.filter((d) => d.intentId && agentById.get(d.agentId)?.status === 'running').length / roomDesks.length;
    }
    const gateDesks = desksOf('gate');
    drawMovingParts(ctx, backdrop.dyn, {
      t: motion ? t : 0, daylight, glow, shafts: backdrop.shafts, lift, load, deliveredCount: model?.delivered.count ?? 0,
      awaitingApproval: gateDesks.some((d) => records.get(d.intentId)?.data.awaitingHuman),
      workingApproval: false,
      date: new Date(),
    });
    const items = [];
    for (const desk of desks) {
      const a = dimDesk(desk), rec = desk.intentId ? records.get(desk.intentId) : null;
      if (desk.agent) desk.agent.alpha = a;
      items.push({
        y: desk.fy - 7,
        f: () => {
          ctx.globalAlpha = a;
          drawDesk(ctx, desk, t);
          drawDeskLamp(ctx, desk, glow, Boolean(rec));
          if (rec) {
            drawCrate(ctx, desk.x - 1, desk.fy - 22, rec.colour);
            if (rec.data.awaitingHuman) R(ctx, desk.x - 1, desk.fy - 24, 7, 1, Math.sin(t * 5) > 0 ? K.brassL : K.amber);
            if (rec.data.blocked) R(ctx, desk.x - 1, desk.fy - 24, 7, 1, '#d9694f');
          }
          ctx.globalAlpha = 1;
        },
      });
      if (desk.agent) items.push({ y: desk.fy - 11, f: () => drawFigure(ctx, desk.agent, t) });
      for (const p of desk.personas) {
        p.alpha = selected && p.iid !== selected ? .35 : 1;
        items.push({ y: p.y, f: () => drawFigure(ctx, p, t) });
      }
    }
    for (const runner of runners) items.push({ y: runner.f.y, f: () => drawFigure(ctx, runner.f, t) });
    items.sort((p, q) => p.y - q.y).forEach((item) => item.f());
    for (const desk of desks) {
      const rec = desk.intentId ? records.get(desk.intentId) : null;
      if (!rec) continue;
      ctx.globalAlpha = dimDesk(desk);
      const agent = desk.agentId ? agentById.get(desk.agentId) : null;
      for (const p of desk.personas) {
        if (!p.speaking) continue;
        drawLink(ctx, { x: desk.x, y: desk.fy - 30 }, { x: p.x, y: p.y - 21 }, t);
        drawBubble(ctx, p.x + 7, p.y - 56, t);
      }
      if (agent?.awaitingHuman && agent.waitingSince) {
        drawThermometer(ctx, desk.x + 27, desk.fy - 24, (serverNow() - Date.parse(agent.waitingSince)) / FRUSTRATION_FULL_MS, t);
      }
      drawProgress(ctx, desk.x - 11, desk.fy - 51, (rec.data.completionPercent ?? 0) / 100, rec.colour);
      ctx.globalAlpha = 1;
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.min(1, p.l * 2);
      R(ctx, p.x, p.y, 1, 1, p.c);
    }
    ctx.globalAlpha = 1;
    const sel = selected ? records.get(selected) : null;
    if (sel) {
      const p = selectedPosition();
      if (p) drawBrackets(ctx, Math.round(p.x), Math.round(p.y), sel.colour, t);
    }
    for (let i = 0; i < 28; i++) {
      const x = (i * 131 + t * (2 + i % 5)) % W, y = ((i * 71) + Math.sin(t * .5 + i) * 6 + t * (1 + i % 3)) % 410 + 30;
      ctx.globalAlpha = .25 * daylight + .05;
      R(ctx, x, y, 1, 1, '#ffe9b8');
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.drawImage(vignette, 0, 0, W, H);
    stage.style.setProperty('--z', Math.min(cam.s, 1.7).toFixed(2));
    for (const desk of desks) {
      if (!desk.tag) continue;
      place(desk.tag, desk.x, desk.fy - 57 - (desk.room.id === 'build' && desks.indexOf(desk) % 2 ? 10 : 0));
      desk.tag.style.opacity = (desk.tag.classList.contains('idle') ? .6 : desk.tag.classList.contains('quiet') ? .75 : 1) * dimDesk(desk);
      for (const [index, p] of desk.personas.entries()) {
        place(p.tag, p.x, p.y - 36 - (index % 3) * 7);
        p.tag.style.opacity = p.alpha;
        p.tag.style.display = cam.s > 1.25 || p.speaking || selected === p.iid ? '' : 'none';
      }
    }
    for (const { room, e } of plaques) {
      const l = (room.x - cam.x) * cam.s, rr = (room.x + room.w - cam.x) * cam.s, tp = (room.top - cam.y) * cam.s, bt = (room.fy - cam.y) * cam.s;
      e.style.display = (rr < 0 || l > W || bt < 0 || tp > H) ? 'none' : '';
      place(e, room.x + 8, room.top + 9);
    }
  }

  function syncPlaques() {
    const v = view();
    const selectedRoom = selected ? records.get(selected)?.data?.roomId : null;
    for (const p of plaques) {
      const r = v.rooms[p.room.i];
      p.name.textContent = '';
      p.name.append(r.name);
      const sub = document.createElement('i');
      sub.textContent = r.subtitle;
      p.name.append(sub);
      p.n.textContent = `${r.intents.length}/${r.capacity}`;
      p.n.className = `n${r.intents.length ? '' : ' z'}`;
      p.q.textContent = r.overflow ? `+${r.overflow}` : '';
      p.e.classList.toggle('jam', r.overflow > 0);
      p.e.classList.toggle('hot', selectedRoom === r.id);
    }
  }

  /* ---------- picking ---------- */
  function toWorld(event) {
    const r = canvas.getBoundingClientRect();
    return { x: cam.x + (event.clientX - r.left) / r.width * (W / cam.s), y: cam.y + (event.clientY - r.top) / r.height * (H / cam.s) };
  }
  const roomAt = (x, y) => ROOMS.find((r) => x >= r.x && x < r.x + r.w && y >= r.top && y <= r.fy + (r.row ? 10 : 14));
  function hit(wx, wy) {
    let best = null;
    const test = (x, y, w, h, o) => {
      if (wx >= x - w && wx <= x + w && wy >= y - h && wy <= y && (!best || y > best.y)) best = { y, ...o };
    };
    for (const desk of desks) {
      if (desk.agent && desk.agentId) test(desk.agent.x, desk.agent.y, 7, 33, { t: 'agent', id: desk.agentId, desk });
      if (desk.intentId) test(desk.x, desk.fy - 7, 11, 22, { t: 'intent', id: desk.intentId, desk });
      for (const p of desk.personas) test(p.x, p.y, 7, 33, { t: 'persona', ref: p.ref, intentId: p.iid, figure: p });
    }
    for (const runner of runners) test(runner.f.x, runner.f.y, 7, 33, { t: 'runner', intentId: runner.rec.id });
    return best;
  }
  function describe(h) {
    if (h.t === 'agent') {
      const a = agentById.get(h.id), rec = records.get(h.desk.intentId);
      return a ? `<b>${esc(a.toolLabel)}</b><br>${esc(roomName(a.roomId))}<br>${esc(rec?.data.slug ?? '')} · ${esc(a.awaitingHuman ? 'waiting for a person' : a.quiet ? 'no recent activity' : a.status)}` : '';
    }
    if (h.t === 'intent') {
      const d = records.get(h.id)?.data;
      return d ? `<b>${esc(d.slug)}</b><br>${esc(d.phaseKey || 'no phase recorded')}${d.blocked ? `<br>Blocked: ${esc(d.blocked)}` : ''}` : '';
    }
    if (h.t === 'persona') return `<b>${esc(h.figure.name)}</b><br>Persona lens attached to ${esc(records.get(h.intentId)?.data.slug ?? '')}`;
    return `<b>Runner</b><br>carrying ${esc(records.get(h.intentId)?.data.slug ?? 'work')}`;
  }
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

  function inspectTarget(h) {
    inspect = h.t === 'intent' ? { t: 'intent', id: h.id } : h.t === 'agent' ? { t: 'agent', id: h.id } : h.t === 'persona' ? { t: 'persona', ref: h.ref, intentId: h.intentId } : { t: 'runner', intentId: h.intentId };
    selected = h.t === 'intent' || h.t === 'agent' ? h.desk.intentId : h.intentId;
    if (!selected) follow = false;
    listeners.change();
  }

  canvas.addEventListener('click', (event) => {
    const p = toWorld(event), h = hit(p.x, p.y);
    if (h) {
      inspectTarget(h);
      const room = h.desk ? h.desk.room : roomAt(p.x, p.y);
      if (room && focus !== room.id) setFocus(room.id);
      return;
    }
    const room = roomAt(p.x, p.y);
    if (!room) {
      if (focus) setFocus(null);
      return;
    }
    setFocus(focus === room.id ? null : room.id);
  });
  canvas.addEventListener('mousemove', (event) => {
    const p = toWorld(event), h = hit(p.x, p.y), room = h ? null : roomAt(p.x, p.y);
    canvas.style.cursor = (h || room) ? 'pointer' : 'default';
    const html = h ? describe(h) : room ? `<b>${esc(roomName(room.id))}</b><br>${esc(model?.rooms.find((r) => r.id === room.id)?.subtitle ?? '')}<br><i>${focus === room.id ? 'Click to zoom out' : 'Click to zoom in'}</i>` : '';
    if (!html) {
      tooltip.style.display = 'none';
      return;
    }
    const sr = stage.getBoundingClientRect();
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(event.clientX - sr.left + 14, sr.width - 240)}px`;
    tooltip.style.top = `${event.clientY - sr.top + 14}px`;
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  const api = {
    panelSide: 'right',
    update,
    step,
    render,
    view,
    syncPlaques,
    setFocus,
    get focus() { return focus; },
    get selected() { return selected; },
    get inspect() { return inspect; },
    get follow() { return follow; },
    set follow(value) { follow = Boolean(value); followTick(); listeners.change(); },
    select(id) {
      selected = id;
      inspect = id ? { t: 'intent', id } : null;
      if (!id) follow = false;
      listeners.change();
    },
    setFilter(next) { filter = next; listeners.change(); },
    clearSelection() { selected = null; inspect = null; follow = false; listeners.change(); },
    warm() { ROOMS.forEach((room, i) => setTimeout(() => cachedRoom(room), 600 + i * 150)); },
    on(name, handler) { listeners[name] = handler; },
    hasMotionActors() { return runners.length > 0 || particles.length > 0; },
  };
  return api;
}
