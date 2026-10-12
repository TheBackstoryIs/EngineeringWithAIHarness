import { K, R, poly, sh } from './draw.js';

const SKIN = ['#f6d7bd', '#f0c8a0', '#e1b48f', '#d09b72', '#c58f6a', '#a56f4c', '#8a5a3c', '#6b4429', '#4f3220'];
const HAIR = ['#2b1d14', '#5a3a22', '#1d1d1d', '#8a6a3a', '#b89a60', '#6b6b6b', '#9a4a2a', '#d8d4cc', '#3a2a4a'];
const PANTS = ['#3a3f44', '#5a4a3a', '#2d3a50', '#4a4a3a', '#6a3a3a', '#3a5048', '#55506a'];
// Weighted by repetition. Every choice is seeded by the figure's key, so a figure looks the same on every load.
const HAIR_STYLES = ['short', 'short', 'crop', 'long', 'long', 'ponytail', 'bun', 'bob', 'curly', 'bald'];
const TOPS = ['jacket', 'jacket', 'shirt', 'shirt', 'hoodie'];
const BOTTOMS = ['trousers', 'trousers', 'trousers', 'skirt', 'shorts', 'dress'];
const BEARDED = new Set(['short', 'crop', 'curly', 'bald']);
const FIGURE_SCALE = 1.15;

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pickBy = (list, key, salt) => list[hashString(`${key}:${salt}`) % list.length];
const roll = (key, salt) => (hashString(`${key}:${salt}`) % 1000) / 1000;

export function makePalette(key, coat, options = {}) {
  const hairStyle = pickBy(HAIR_STYLES, key, 'style');
  const bottom = pickBy(BOTTOMS, key, 'bottom');
  const top = bottom === 'dress' ? 'shirt' : options.top || pickBy(TOPS, key, 'top');
  const facialRoll = roll(key, 'facial');
  return {
    hairStyle, top, bottom,
    sleeve: top === 'shirt' ? .5 : 1,
    facial: BEARDED.has(hairStyle) && facialRoll < .3 ? (facialRoll < .15 ? 'beard' : 'moustache') : null,
    glasses: roll(key, 'glasses') < .22,
    coat,
    coatD: sh(coat, -.22),
    coatL: sh(coat, .14),
    pants: options.pants || pickBy(PANTS, key, 'pants'),
    skin: pickBy(SKIN, key, 'skin'),
    hair: pickBy(HAIR, key, 'hair'),
    trim: options.trim || null,
    badge: options.badge || null,
  };
}

export function makeFigure(options) {
  return { x: 0, y: 0, dir: 1, phase: (hashString(String(options.key ?? '')) % 600) / 100, moving: false, path: [], carry: null, work: false, hat: null, alpha: 1, ...options };
}

export function drawCrate(ctx, x, y, colour) {
  poly(ctx, [x, y + 1.6, x + 7, y + 1.6, x + 7, y + 6.4, x, y + 6.4], '#7a5230');
  poly(ctx, [x, y + 1.6, x + 3.5, y + 1.6, x, y + 6.4], 'rgba(255,255,255,.08)');
  poly(ctx, [x, y + 1.6, x + 1.6, y, x + 8.6, y, x + 7, y + 1.6], '#b0834c');
  poly(ctx, [x + 7, y + 1.6, x + 8.6, y, x + 8.6, y + 4.8, x + 7, y + 6.4], '#4a2f19');
  poly(ctx, [x + 1.2, y + 3.2, x + 5.8, y + 3.2, x + 5.8, y + 5, x + 1.2, y + 5], colour);
  R(ctx, x, y + 1.6, 7, .9, K.brassL);
}

function leg(ctx, hx, hy, fx, fy, colour, d) {
  poly(ctx, [hx - 1.8, hy, hx + 1.8, hy, fx + 1.4, fy - 1.3, fx - 1.4, fy - 1.3], colour);
  poly(ctx, [fx - 1.7, fy - 1.4, fx + 1.7, fy - 1.4, fx + 1.7 + d * 1.3, fy, fx - 1.7, fy], '#1a1410');
}

function arm(ctx, sx, sy, hx, hy, colour, skin, len = 1) {
  const ex = sx + (hx - sx) * len, ey = sy + (hy - sy) * len;
  if (len < 1) poly(ctx, [ex - 1, ey, ex + 1, ey, hx + 1, hy, hx - 1, hy], skin);
  poly(ctx, [sx - 1.2, sy, sx + 1.2, sy, ex + 1, ey, ex - 1, ey], colour);
  poly(ctx, [hx - 1.1, hy - .2, hx + 1.1, hy - .2, hx + .9, hy + 1.4, hx - .9, hy + 1.4], skin);
}

function hairBehind(ctx, x, ty, d, p, t, phase) {
  const h = p.hair;
  if (p.hairStyle === 'long') poly(ctx, [x - 3.9, ty - 7.6, x + 3.9, ty - 7.6, x + 4.5, ty + 5, x + 1.6, ty + 5, x + 1.2, ty - 2, x - 1.2, ty - 2, x - 1.6, ty + 5, x - 4.5, ty + 5], h);
  else if (p.hairStyle === 'bob') poly(ctx, [x - 3.9, ty - 7.6, x + 3.9, ty - 7.6, x + 4.1, ty - 1, x - 4.1, ty - 1], h);
  else if (p.hairStyle === 'ponytail') {
    const sway = Math.sin(t * 2.2 + phase) * .8;
    poly(ctx, [x - d * 3, ty - 6.6, x - d * 3.8, ty - 5, x - d * (7.2 + sway), ty - 1.4, x - d * (5.8 + sway), ty + 1.8, x - d * 3.2, ty - 3.2], h);
  } else if (p.hairStyle === 'curly') poly(ctx, [x - 4.9, ty - 6, x - 3.4, ty - 9.8, x + 3.4, ty - 9.8, x + 4.9, ty - 6, x + 4.6, ty - 2.4, x - 4.6, ty - 2.4], h);
}

function hairTop(ctx, x, ty, d, p) {
  const h = p.hair, s = p.hairStyle;
  if (s === 'bald') {
    poly(ctx, [x - 3.4, ty - 4.1, x - 3, ty - 6.4, x - 2.2, ty - 6, x - 2.5, ty - 4.1], h);
    poly(ctx, [x + 3.4, ty - 4.1, x + 3, ty - 6.4, x + 2.2, ty - 6, x + 2.5, ty - 4.1], h);
    return;
  }
  if (s === 'crop') poly(ctx, [x - 3.3, ty - 5, x - 2.8, ty - 8.1, x + 2.8, ty - 8.1, x + 3.3, ty - 5, x + 2.3, ty - 6.4, x - 2.3, ty - 6.4], h);
  else if (s === 'curly') {
    poly(ctx, [x - 3.8, ty - 4.6, x - 3.6, ty - 9.4, x + 3.6, ty - 9.4, x + 3.8, ty - 4.6, x + 2.6, ty - 6.2, x - 2.6, ty - 6.2], h);
    poly(ctx, [x - 3.8, ty - 9.4, x - 1.8, ty - 10.6, x + 1.8, ty - 10.6, x + 3.8, ty - 9.4], h);
  } else {
    poly(ctx, [x - 3.4, ty - 4.1, x - 2.9, ty - 8.3, x + 2.9, ty - 8.3, x + 3.4, ty - 4.1, x + 2.4, ty - 5.7, x - 2.4, ty - 5.7], h);
    if (s === 'short') poly(ctx, [x - d * 3.4, ty - 5.7, x - d * 3.4, ty - 1.8, x - d * 2.2, ty - 2.4, x - d * 2.2, ty - 5.7], h);
    if (s === 'bun') {
      poly(ctx, [x - d * 3.4, ty - 9.4, x - d * 1, ty - 10.8, x + d * .6, ty - 9.4, x + d * .6, ty - 8, x - d * 3, ty - 8], h);
      poly(ctx, [x - d * 3.1, ty - 9.2, x - d * 1.2, ty - 10.4, x - d * 1.2, ty - 9.2], 'rgba(255,255,255,.16)');
    }
  }
  poly(ctx, [x - 3.4, ty - 4.1, x - .2, ty - 8.3, x - 2.9, ty - 8.3], 'rgba(255,255,255,.14)');
}

function drawFace(ctx, x, ty, d, p) {
  if (p.facial === 'beard') poly(ctx, [x - 2.8, ty - 3, x + 2.8, ty - 3, x + 2.4, ty - .2, x - 2.4, ty - .2], p.hair);
  if (p.facial === 'moustache') R(ctx, x + d * .5 - 1.6, ty - 2.9, 3.2, .8, p.hair);
  if (p.glasses) {
    const gx = x + d * 1.4;
    R(ctx, gx - 1.8, ty - 5.3, 3.6, 2, 'rgba(20,16,12,.85)');
    R(ctx, gx - 1.3, ty - 4.9, 2.6, 1.2, 'rgba(190,225,235,.6)');
  }
}

export function drawFigure(ctx, f, t) {
  const x = f.x, y = f.y, p = f.pal, d = f.dir;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(FIGURE_SCALE, FIGURE_SCALE);
  ctx.translate(-x, -y);
  if (f.alpha < 1) ctx.globalAlpha = f.alpha;
  poly(ctx, [x - 6, y - .5, x - 3, y - 2, x + 3, y - 2, x + 6, y - .5, x + 3, y + .8, x - 3, y + .8], 'rgba(0,0,0,.28)');
  const sw = f.moving ? Math.sin(f.phase) : 0;
  if (f.wave) ctx.translate(0, -Math.abs(Math.sin(t * 5 + f.phase)) * 2.4);
  const bare = p.bottom !== 'trousers', legColour = bare ? p.skin : p.pants;
  const flB = x - 1.7 + sw * 2.6, flF = x + 1.7 - sw * 2.6;
  leg(ctx, x - 1.7, y - 9, flB, y, sh(legColour, -.18), d);
  leg(ctx, x + 1.7, y - 9, flF, y, legColour, d);
  if (p.bottom === 'shorts') {
    for (const [hx, fx, c] of [[x - 1.7, flB, sh(p.pants, -.18)], [x + 1.7, flF, p.pants]]) {
      const kx = hx + (fx - hx) * .4, ky = y - 9 + 9 * .4;
      poly(ctx, [hx - 2, y - 9, hx + 2, y - 9, kx + 1.9, ky, kx - 1.9, ky], c);
    }
  }
  if (p.bottom === 'skirt' || p.bottom === 'dress') {
    const cloth = p.bottom === 'dress' ? p.coat : p.pants, hem = y - (p.bottom === 'dress' ? 3.6 : 5), flare = sw * .9;
    poly(ctx, [x - 4.2, y - 10.6, x + 4.2, y - 10.6, x + 6.3 + flare, hem, x - 6.3 + flare, hem], cloth);
    poly(ctx, [x + .8, y - 10.6, x + 4.2, y - 10.6, x + 6.3 + flare, hem, x + .8, hem], 'rgba(0,0,0,.14)');
  }
  const bob = f.moving ? Math.abs(sw) * .8 : (Math.sin(t * 1.6 + f.phase) > .9 ? .6 : 0);
  const ty = y - 18 - bob, ws = Math.sin(t * 11 + f.phase);
  const sxF = x + d * 4.6, sxB = x - d * 4.6;
  if (f.carry) arm(ctx, sxB, ty + 1, x + d * 5.5, ty + 7.5, p.coatD, p.skin, p.sleeve);
  else if (f.wave) arm(ctx, sxB, ty + 1, sxB - d * 2 - Math.sin(t * 9 + f.phase + 2) * 2.2, ty - 7, p.coatD, p.skin, p.sleeve);
  else arm(ctx, sxB, ty + 1, sxB - d * .4, ty + 9.5, p.coatD, p.skin, p.sleeve);
  if (f.kind === 'runner') {
    poly(ctx, [x - d * 4.8, ty + 5, x - d * 8.6, ty + 5.6, x - d * 8.6, ty + 11.6, x - d * 4.8, ty + 11.6], '#7a5230');
    poly(ctx, [x - d * 4.8, ty + 5, x - d * 8.6, ty + 5.6, x - d * 8.6, ty + 7, x - d * 4.8, ty + 6.4], '#9b6e40');
  }
  poly(ctx, [x - 1.3, ty - 1, x + 1.3, ty - 1, x + 1.5, ty + .6, x - 1.5, ty + .6], sh(p.skin.startsWith('#') ? p.skin : '#c58f6a', -.2));
  poly(ctx, [x - 5, ty, x + 5, ty, x + 4, ty + 9.6, x - 4, ty + 9.6], p.coat);
  poly(ctx, [x - 5, ty, x - 1.8, ty, x - 2.6, ty + 9.6, x - 4, ty + 9.6], p.coatL);
  poly(ctx, [x + .8, ty, x + 5, ty, x + 4, ty + 9.6, x + .8, ty + 9.6], p.coatD);
  poly(ctx, [x - 4, ty + 9.6, x + 4, ty + 9.6, x + 4.1, ty + 8.4, x - 4.1, ty + 8.4], 'rgba(0,0,0,.25)');
  if (p.top === 'jacket') poly(ctx, [x - 1.7, ty, x + 1.7, ty, x, ty + 4.4], p.coatD);
  else if (p.top === 'shirt') poly(ctx, [x - 2, ty, x + 2, ty, x, ty + 2], p.skin);
  else {
    poly(ctx, [x - 3.8, ty - 1.2, x + 3.8, ty - 1.2, x + 4.4, ty + 1.8, x - 4.4, ty + 1.8], p.coatL);
    poly(ctx, [x - 2.8, ty + 6, x + 2.8, ty + 6, x + 3.2, ty + 8.4, x - 3.2, ty + 8.4], p.coatD);
  }
  poly(ctx, [x - 5, ty, x - 1, ty, x - 5, ty + 4.2], 'rgba(255,255,255,.1)');
  poly(ctx, [x + 5, ty + 9.6, x + 1, ty + 9.6, x + 5, ty + 5.4], 'rgba(0,0,0,.1)');
  if (f.kind !== 'runner' && p.top === 'jacket' && p.coat.length === 7 && parseInt(p.coat.slice(1), 16) > 0xb0b0b0) {
    poly(ctx, [x - .9, ty + 1.7, x + .9, ty + 1.7, x + .6, ty + 6, x, ty + 6.8, x - .6, ty + 6], '#1f4a4d');
  }
  if (p.trim) poly(ctx, [x - 5, ty, x + 5, ty, x + 4.6, ty + 1.7, x - 4.6, ty + 1.7], p.trim);
  if (p.badge) {
    const cx = x + d * 2.3, cy = ty + 5.2;
    poly(ctx, [cx, cy - 1.6, cx + 1.4, cy, cx, cy + 1.6, cx - 1.4, cy], p.badge);
  }
  hairBehind(ctx, x, ty, d, p, t, f.phase);
  poly(ctx, [x - 2.7, ty - 7.8, x + 2.7, ty - 7.8, x + 3.3, ty - 4, x + 2.3, ty - .6, x - 2.3, ty - .6, x - 3.3, ty - 4], p.skin);
  poly(ctx, [x + .3, ty - 7.8, x + 2.7, ty - 7.8, x + 3.3, ty - 4, x + 2.3, ty - .6, x + .3, ty - .6], 'rgba(0,0,0,.12)');
  hairTop(ctx, x, ty, d, p);
  R(ctx, x + d * 1.4 - .5, ty - 4.6, 1, 1.2, '#1a1410');
  drawFace(ctx, x, ty, d, p);
  if (f.hat === 'cap') {
    poly(ctx, [x - 3.7, ty - 7.3, x - 2.9, ty - 10, x + 2.9, ty - 10, x + 3.7, ty - 7.3], '#2b3640');
    poly(ctx, [x - 3.7, ty - 7.3, x, ty - 7.3, x - 2.9, ty - 10], 'rgba(255,255,255,.1)');
    poly(ctx, [x + d * 1, ty - 7.3, x + d * 5.2, ty - 6.8, x + d * 5.2, ty - 6, x + d * 1, ty - 6.3], '#1b232a');
  }
  if (f.carry) {
    arm(ctx, sxF, ty + 1, x + d * 5.5, ty + 7.5, p.coat, p.skin, p.sleeve);
    drawCrate(ctx, x + d * 6.2 - 4.3, ty + 3.6, f.carry);
  } else if (f.wave) {
    const flap = Math.sin(t * 9 + f.phase) * 2.2;
    arm(ctx, sxF, ty + 1, sxF + d * 2 + flap, ty - 8, p.coat, p.skin, p.sleeve);
  } else if (f.work) arm(ctx, sxF, ty + 1, sxF + d * 3.4, ty + 5.5 + ws * 1.7, p.coat, p.skin, p.sleeve);
  else arm(ctx, sxF, ty + 1, sxF + d * .4, ty + 9.5, p.coat, p.skin, p.sleeve);
  if (f.alpha < 1) ctx.globalAlpha = 1;
  ctx.restore();
}

export function stepFigure(f, dt) {
  f.phase += dt * (f.moving ? 9 : .6);
  if (!f.path.length) {
    f.moving = false;
    return;
  }
  const w = f.path[0], dx = w.x - f.x, dy = w.y - f.y, dist = Math.hypot(dx, dy), speed = (w.lift ? 52 : 40) * dt;
  f.moving = true;
  if (dist <= speed) {
    f.x = w.x;
    f.y = w.y;
    f.path.shift();
    if (w.cb) w.cb();
  } else {
    f.x += dx / dist * speed;
    f.y += dy / dist * speed;
    if (Math.abs(dx) > .3) f.dir = Math.sign(dx);
  }
  if (w.lift) f.moving = false;
}
