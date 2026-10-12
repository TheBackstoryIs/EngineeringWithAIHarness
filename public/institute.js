import { createScene } from './institute/scene.js';
import { agentsHtml, chipsHtml, inspectorHtml, intentsHtml, kpis, legendHtml, paint, roomHtml, stripHtml, unmappedHtml } from './institute/panels.js';

const POLL_MS = 5000;
const LOG_LIMIT = 40;

export function createInstituteView({ api, openIntent, onClose = () => {} }) {
  const $ = (id) => document.getElementById(id);
  let scene = null;
  let polling = null;
  let frame = null;
  let visible = false;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastOk = null;
  let failure = '';
  let digest = '';
  let last = performance.now();
  let panelTick = 0;
  const log = [];

  const setHtml = (el, html) => {
    if (el._html === html) return;
    el._html = html;
    el.innerHTML = html;
    paint(el);
  };

  function stamp() {
    return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function addLog(text) {
    log.unshift({ at: stamp(), text });
    if (log.length > LOG_LIMIT) log.pop();
    renderLog();
  }

  function renderLog() {
    const el = $('instLog');
    el.textContent = '';
    if (!log.length) {
      const empty = document.createElement('div');
      empty.textContent = 'Changes you see while this view is open will be listed here.';
      el.append(empty);
      return;
    }
    for (const entry of log) {
      const row = document.createElement('div');
      const time = document.createElement('b');
      time.textContent = entry.at;
      row.append(time, entry.text);
      el.append(row);
    }
  }

  function renderStatus() {
    const el = $('instStatus');
    if (failure) {
      el.className = 'inst-status bad';
      el.textContent = lastOk ? `Live data unavailable. Showing the last update from ${lastOk.toLocaleTimeString('en-GB')}.` : 'Live data unavailable.';
      return;
    }
    el.className = 'inst-status';
    el.textContent = lastOk ? `Live · updated ${lastOk.toLocaleTimeString('en-GB')}` : 'Loading…';
  }

  function renderPanels() {
    if (!scene) return;
    const v = scene.view();
    if (!v.model) return;
    const k = kpis(v);
    $('instKFlight').textContent = k.flight;
    $('instKAgents').textContent = k.agents;
    $('instKWaiting').textContent = k.waiting;
    $('instKDone').textContent = k.delivered;
    $('instSummary').textContent = `${k.flight} intents in flight, ${k.agents} agents working, ${k.waiting} waiting for you, ${k.delivered} delivered.`;
    setHtml($('instIntents'), intentsHtml(v));
    setHtml($('instAgents'), agentsHtml(v));
    setHtml($('instChips'), chipsHtml(v));
    setHtml($('instLegend'), legendHtml(v));
    setHtml($('instStrip'), stripHtml(v));
    setHtml($('instInspector'), inspectorHtml(v));
    setHtml($('instUnmapped'), unmappedHtml(v));
    const panel = $('instRoomPanel');
    panel.classList.toggle('left', scene.panelSide === 'left');
    panel.classList.toggle('on', Boolean(v.focus));
    if (v.focus) {
      const scroll = panel.scrollTop;
      setHtml(panel, roomHtml(v));
      panel.scrollTop = scroll;
    }
    scene.syncPlaques();
    $('instIntentCount').textContent = v.model.queue.count ? `${v.model.queue.count} queued` : '';
  }

  async function refresh() {
    try {
      const model = await api('/api/institute-scene');
      failure = '';
      lastOk = new Date();
      if (!scene) return;
      if (model.digest !== digest) {
        digest = model.digest;
        scene.update(model);
      }
    } catch (error) {
      failure = error.message || 'Request failed';
    }
    renderStatus();
    renderPanels();
  }

  function schedule() {
    clearTimeout(polling);
    if (!visible) return;
    polling = setTimeout(async () => {
      if (!document.hidden) await refresh();
      schedule();
    }, POLL_MS);
  }

  function loop(now) {
    if (!visible) return;
    const raw = Math.min(.1, (now - last) / 1000);
    last = now;
    if (!paused) {
      const n = Math.max(1, Math.ceil(raw / .05));
      for (let i = 0; i < n; i++) scene.step(raw / n);
    }
    scene.render(now, raw, !paused);
    panelTick -= raw;
    if (panelTick <= 0) {
      panelTick = 1;
      renderPanels();
    }
    frame = requestAnimationFrame(loop);
  }

  function ensureScene() {
    if (scene) return;
    scene = createScene({ canvas: $('instCanvas'), overlay: $('instOverlay'), stage: $('instStage'), tooltip: $('instTip') });
    scene.on('change', renderPanels);
    scene.on('event', addLog);
    scene.warm();
    $('instPause').textContent = paused ? 'Resume motion' : 'Pause motion';
    $('instPause').setAttribute('aria-pressed', String(paused));
    renderLog();
  }

  function pick(event, toggle) {
    const el = event.target.closest('[data-id]');
    if (!el?.dataset.id) return false;
    const id = el.dataset.id;
    if (toggle && scene.selected === id) scene.clearSelection();
    else scene.select(id);
    return true;
  }

  function wire() {
    $('instIntents').addEventListener('pointerdown', (e) => pick(e, true));
    $('instIntents').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick(e, true);
      }
    });
    $('instUnmapped').addEventListener('pointerdown', (e) => pick(e, true));
    $('instStrip').addEventListener('pointerdown', (e) => {
      if (pick(e, true)) return;
      const cell = e.target.closest('[data-room]');
      if (cell) scene.setFocus(scene.focus === cell.dataset.room ? null : cell.dataset.room);
    });
    $('instRoomPanel').addEventListener('pointerdown', (e) => {
      const act = e.target.closest('[data-act]');
      if (act?.dataset.act === 'out') scene.setFocus(null);
      else if (act?.dataset.act === 'open') openIntent(act.dataset.slug);
      else if (!act) pick(e, false);
    });
    $('instInspector').addEventListener('pointerdown', (e) => {
      const act = e.target.closest('[data-act]');
      if (act?.dataset.act === 'follow') scene.follow = !scene.follow;
      else if (act?.dataset.act === 'open') openIntent(act.dataset.slug);
      else pick(e, false);
    });
    $('instChips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-tool]');
      if (!chip) return;
      const next = new Set(scene.view().filter);
      if (next.has(chip.dataset.tool)) next.delete(chip.dataset.tool);
      else next.add(chip.dataset.tool);
      scene.setFilter(next);
    });
    $('instPause').addEventListener('click', () => {
      paused = !paused;
      $('instPause').textContent = paused ? 'Resume motion' : 'Pause motion';
      $('instPause').setAttribute('aria-pressed', String(paused));
    });
    $('instBack').addEventListener('click', close);
    $('instOverview').addEventListener('click', () => scene.setFocus(null));
    $('instRefresh').addEventListener('click', () => refresh());
    $('instPanelToggle').addEventListener('click', () => {
      const root = $('instituteView');
      root.classList.toggle('nopanel');
      $('instPanelToggle').setAttribute('aria-pressed', String(!root.classList.contains('nopanel')));
    });
    addEventListener('keydown', (e) => {
      if (!visible || !scene) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (scene.focus) scene.setFocus(null);
        else if (scene.selected) scene.clearSelection();
        else close();
      }
    });
  }

  let wired = false;
  const overlay = () => $('instituteView');
  const shell = () => $('app');

  function open() {
    if (visible) return;
    visible = true;
    overlay().hidden = false;
    shell().inert = true;
    ensureScene();
    if (!wired) {
      wired = true;
      wire();
    }
    last = performance.now();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(loop);
    $('instBack').focus();
    refresh().then(schedule);
  }

  function close() {
    if (!visible) return;
    visible = false;
    clearTimeout(polling);
    cancelAnimationFrame(frame);
    overlay().hidden = true;
    shell().inert = false;
    onClose();
  }

  return { open, close, isOpen: () => visible, refresh };
}
