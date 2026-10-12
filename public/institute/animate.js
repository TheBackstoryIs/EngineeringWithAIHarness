import { K, W, H, R, box, mix, pdisk, pline, poly } from './draw.js';
import { drawCrate } from './figures.js';
import { ROOMS } from './rooms.js';

const NIGHT = ['#0b1626', '#1b3550', .08];
const DAWN = ['#3d6482', '#eab46f', .55];
const DAY = ['#5a92b8', '#d2e4e8', 1];
const DUSK = ['#2c4a6c', '#ea9a5a', .6];
// The sky follows the viewer's local time, so the building reads as day or night like a real office.
const SKY_STOPS = [[0, NIGHT], [5.5, NIGHT], [7.5, DAWN], [10, DAY], [16, DAY], [18, DUSK], [20, NIGHT], [24, NIGHT]];

function skyAt(hour) {
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const [h0, a] = SKY_STOPS[i], [h1, b] = SKY_STOPS[i + 1];
    if (hour >= h0 && hour <= h1) {
      const f = (hour - h0) / (h1 - h0);
      return { top: mix(a[0], b[0], f), bottom: mix(a[1], b[1], f), daylight: a[2] * (1 - f) + b[2] * f };
    }
  }
  return { top: NIGHT[0], bottom: NIGHT[1], daylight: NIGHT[2] };
}

export function drawSky(ctx, now, date = new Date()) {
  const sky = skyAt(date.getHours() + date.getMinutes() / 60);
  const g = ctx.createLinearGradient(0, 0, 0, 44);
  g.addColorStop(0, sky.top);
  g.addColorStop(1, sky.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 44);
  if (sky.daylight < .35) {
    for (let s = 0; s < 30; s++) {
      const x = (s * 97) % W, y = (s * 53) % 30;
      if (Math.sin(now / 600 + s) > -.3) R(ctx, x, y, 1, 1, 'rgba(255,240,200,.8)');
    }
  }
  for (let c = 0; c < 4; c++) {
    const x = ((now / 1000 * (3 + c) + c * 230) % (W + 80)) - 40, y = 8 + c * 7;
    R(ctx, x, y, 34, 4, 'rgba(255,240,215,.22)');
    R(ctx, x + 6, y - 3, 20, 3, 'rgba(255,240,215,.22)');
  }
  return sky.daylight;
}

// env: { t, daylight, glow, shafts, lift, awaitingApproval, workingApproval, deliveredCount, load, date }
export function drawMovingParts(ctx, dyn, env) {
  const { t, glow } = env;
  for (const r of dyn.reels) {
    const x = r.x, y = r.y;
    pdisk(ctx, x, y, r.r, '#b9b5a3', t * r.s);
    pdisk(ctx, x, y, r.r - 1, '#9d9a88', t * r.s);
    pdisk(ctx, x, y, 2, K.brass);
    for (let k = 0; k < 3; k++) {
      const a = t * r.s + k * 2.094;
      pline(ctx, x + Math.cos(a) * 2, y + Math.sin(a) * 2, x + Math.cos(a) * (r.r - 1), y + Math.sin(a) * (r.r - 1), '#3b3a34');
    }
  }
  for (const c of dyn.crts) {
    if (!c.w) continue;
    R(ctx, c.x, c.y, c.w, c.h, '#06120e');
    for (let x = 0; x < c.w; x++) {
      const y = c.y + c.h / 2 + Math.sin(x * .55 + t * 4 + c.i * 2) * (3 + 2 * Math.sin(t * .7 + c.i));
      R(ctx, c.x + x, y, 1, 1, K.green);
      R(ctx, c.x + x, y + 1, 1, 1, 'rgba(123,224,166,.35)');
    }
  }
  const terminal = dyn.crts[0];
  if (terminal && !terminal.w) {
    const x = terminal.x + 10, y = terminal.y;
    box(ctx, x - 8, y - 4, 30, 32, K.tealD, K.tealL, K.ink);
    R(ctx, x - 4, y, 20, 14, '#06120e');
    for (let i = 0; i < 20; i++) R(ctx, x - 4 + i, y + 7 + Math.sin(i * .6 + t * 5) * 4, 1, 1, K.green);
    R(ctx, x - 2, y + 18, 3, 3, K.amber);
    R(ctx, x + 3, y + 18, 3, 3, '#6b2b24');
    const p = { x: x + 30, y: y + 10 };
    box(ctx, p.x, p.y + 8, 14, 10, K.creamD, K.creamL, K.walnut);
    const off = Math.floor(t * 6) % 4;
    for (let i = 0; i < 10; i++) R(ctx, p.x + 3, p.y - 2 + i, 8, 1, (i + off) % 4 ? K.creamL : '#9c8b66');
  }
  if (dyn.beaconX) {
    const gl = .65 + .35 * Math.sin(t * 2.2);
    pdisk(ctx, dyn.beaconX, dyn.beaconY + 7, 3, '#7a4a12');
    pdisk(ctx, dyn.beaconX, dyn.beaconY + 7, 2, `rgb(255,${150 + 80 * gl | 0},60)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = .55 * gl;
    ctx.drawImage(glow['255,170,60'], dyn.beaconX - 22, dyn.beaconY - 15, 44, 44);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const s = dyn.scr;
    for (let i = 0; i < 4; i++) R(ctx, s.x + 1, s.y + 1 + i * 2, 3 + ((Math.sin(t * 3 + i * 1.7) + 1) * 4 | 0), 1, K.green);
  }
  const date = env.date ?? new Date();
  const minute = (date.getMinutes() + date.getSeconds() / 60) / 60 * 6.283, hour = ((date.getHours() % 12) + date.getMinutes() / 60) / 12 * 6.283;
  for (const c of dyn.clocks) {
    pdisk(ctx, c.x, c.y, c.r, K.brassD);
    pdisk(ctx, c.x, c.y, c.r - 1, K.creamL);
    pline(ctx, c.x, c.y, c.x + Math.sin(minute) * (c.r - 2), c.y - Math.cos(minute) * (c.r - 2), K.ink);
    pline(ctx, c.x, c.y, c.x + Math.sin(hour) * 3, c.y - Math.cos(hour) * 3, K.ink);
  }
  if (dyn.goLamp) {
    const l = dyn.goLamp, waiting = env.awaitingApproval, held = env.workingApproval;
    R(ctx, l.x - 8, l.y - 3, 16, 7, K.ink);
    const col = waiting ? (Math.sin(t * 6) > 0 ? K.green : K.amber) : (held ? K.amber : '#3a3020');
    R(ctx, l.x - 6, l.y - 2, 12, 5, col);
    if (waiting || held) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = waiting ? .7 : .35;
      ctx.drawImage(glow[waiting ? '120,255,170' : '255,190,90'], l.x - 22, l.y - 22, 44, 44);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  {
    const y = Math.round(env.lift.y), cx = 774;
    R(ctx, cx, y - 30, 24, 32, 'rgba(10,20,22,.55)');
    R(ctx, cx, y - 30, 24, 2, K.brassL);
    R(ctx, cx, y, 24, 2, K.brass);
    R(ctx, cx, y - 30, 2, 32, K.brass);
    R(ctx, cx + 22, y - 30, 2, 32, K.brass);
    for (let i = 0; i < 4; i++) R(ctx, cx + 4 + i * 5, y - 28, 1, 28, K.brassD);
    R(ctx, cx + 11, y - 34, 2, 4, K.brassD);
  }
  if (dyn.shelfX) {
    // Shelf crates are a count of finished work, not individual intents, so they use a neutral brass label.
    for (let i = 0; i < Math.min(8, env.deliveredCount); i++) {
      drawCrate(ctx, dyn.shelfX + 3 + (i % 4) * 9, dyn.shelfY[i < 4 ? 0 : 1] - 6, i % 2 ? K.brassL : K.brass);
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const p of dyn.pools) {
    ctx.globalAlpha = .2 * (.92 + .08 * Math.sin(t * 3 + p.x));
    ctx.drawImage(glow['255,190,90'], p.x - p.w / 2, p.y - p.w * .1, p.w, p.w * .2);
  }
  for (const r of ROOMS) {
    const load = env.load[r.id] ?? 0;
    ctx.globalAlpha = (.07 + .17 * load) * (.9 + .1 * Math.sin(t * 2 + r.i));
    ctx.drawImage(glow['255,190,90'], r.x + r.w / 2 - r.w * .6, r.top - 10, r.w * 1.2, (r.fy - r.top) * 1.2);
  }
  for (const l of dyn.lamps) {
    ctx.globalAlpha = .34 * (.88 + .12 * Math.sin(t * 5 + l.x));
    ctx.drawImage(glow[l.c || '255,190,90'], l.x - l.s / 2, l.y - l.s / 2, l.s, l.s);
  }
  ctx.globalAlpha = Math.max(0, env.daylight) * .9;
  ctx.drawImage(env.shafts, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  for (const l of dyn.lamps) if (!l.c) R(ctx, l.x - 1, l.y - 6, 3, 12, K.amber);
}

export function drawDesk(ctx, desk, t) {
  const x = desk.x, y = desk.fy - 16;
  R(ctx, x - 11, y + 9, 22, 1, 'rgba(0,0,0,.25)');
  R(ctx, x - 11, y, 22, 3, K.walnutL);
  R(ctx, x - 11, y, 22, 1, K.brassL);
  R(ctx, x - 11, y + 3, 22, 6, K.walnut);
  R(ctx, x + 7, y + 3, 4, 6, K.walnutD);
  R(ctx, x - 9, y + 5, 18, 1, K.walnutD);
  const lx = x - 8, ga = ctx.globalAlpha;
  R(ctx, lx - 3, y - 1.2, 6, 1.4, K.brassD);
  R(ctx, lx - .5, y - 6, 1, 5, K.brass);
  poly(ctx, [lx - 3.6, y - 10, lx + 3.6, y - 10, lx + 4.6, y - 5.8, lx - 4.6, y - 5.8], '#2f6f4a');
  poly(ctx, [lx - 3.6, y - 10, lx, y - 10, lx - 1.4, y - 5.8, lx - 4.6, y - 5.8], 'rgba(255,255,255,.16)');
  R(ctx, lx - 4.6, y - 5.8, 9.2, .9, K.brass);
  return { y, lx, ga };
}

export function drawDeskLamp(ctx, desk, glow, lit) {
  if (!lit) return;
  const y = desk.fy - 16, lx = desk.x - 8, ga = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = ga * .55;
  ctx.drawImage(glow['120,255,170'], lx - 12, y - 16, 24, 22);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = ga;
}

export function drawLink(ctx, from, to, t) {
  const x0 = from.x + 6, y0 = from.y, x1 = to.x - 4, y1 = to.y, n = 7;
  for (let i = 0; i < n; i++) {
    const u = ((i + t * 1.4) % n) / n;
    R(ctx, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, 2, 1, K.brassL);
  }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - 1, pulse = 1 + Math.sin(t * 4) * .25;
  pdisk(ctx, mx, my, 3.2 * pulse, K.brassD);
  pdisk(ctx, mx, my, 2.4 * pulse, '#f4ecd2');
  pdisk(ctx, mx, my, 1, K.brass);
}

export function drawProgress(ctx, x, y, fraction, colour) {
  R(ctx, x - 1, y - 1, 24, 4, K.ink);
  R(ctx, x, y, 22, 2, '#24393a');
  R(ctx, x, y, Math.round(22 * Math.max(0, Math.min(1, fraction))), 2, colour);
}

export function drawBrackets(ctx, x, y, colour, t) {
  const s = 13 + Math.round(Math.sin(t * 5) * 2);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    R(ctx, x + sx * s - (sx > 0 ? 3 : 0), y + sy * s, 4, 1, colour);
    R(ctx, x + sx * s, y + sy * s - (sy > 0 ? 3 : 0), 1, 4, colour);
  }
}

export function drawBubble(ctx, x, y, t) {
  R(ctx, x - 6, y - 4, 13, 7, '#f4ecd2');
  R(ctx, x - 5, y - 5, 11, 1, '#f4ecd2');
  R(ctx, x - 1, y + 3, 3, 2, '#f4ecd2');
  for (let i = 0; i < 3; i++) R(ctx, x - 4 + i * 4, y - 2 + (Math.floor(t * 4 + i) % 3 === 0 ? -1 : 0), 2, 2, K.walnutD);
}

// An old-fashioned thermometer: the mercury rises, and changes colour, the longer someone has waited.
export function drawThermometer(ctx, x, baseY, fill, t) {
  const full = fill >= 1, h = 22, jitter = full ? Math.sin(t * 40) * .5 : 0, cx = x + jitter;
  const top = baseY - h, level = Math.max(0, Math.min(1, fill));
  const colour = level < .5 ? mix('#7be0a6', '#ffb347', level * 2) : mix('#ffb347', '#d9381e', (level - .5) * 2);
  R(ctx, cx - 3, top - 1, 6, h + 1, K.ink);
  R(ctx, cx - 2, top, 4, h - 1, '#e9e1c6');
  pdisk(ctx, cx, baseY + 2, 4, K.ink);
  pdisk(ctx, cx, baseY + 2, 3, colour);
  const mercury = Math.round((h - 3) * level);
  R(ctx, cx - 1, baseY - 1 - mercury, 2, mercury + 1, colour);
  for (let i = 1; i < 5; i++) R(ctx, cx + 3, top + i * 4, 2, 1, K.brassD);
  R(ctx, cx - 1, top + 1, 1, 3, 'rgba(255,255,255,.7)');
  if (full) {
    for (let i = 0; i < 3; i++) {
      const u = ((t * 1.3 + i / 3) % 1);
      R(ctx, cx - 6 + i * 6 + Math.sin(t * 6 + i) * 2, top - 3 - u * 8, 2, 2, `rgba(255,120,80,${(1 - u).toFixed(2)})`);
    }
  }
}
