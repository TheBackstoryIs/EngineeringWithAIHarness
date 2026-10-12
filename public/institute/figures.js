import { K, R, poly, sh } from './draw.js';

const SKIN = ['#e1b48f', '#c58f6a', '#a56f4c', '#f0c8a0', '#7d5438'];
const HAIR = ['#2b1d14', '#5a3a22', '#1d1d1d', '#8a6a3a', '#b89a60', '#6b6b6b'];
const PANTS = ['#3a3f44', '#5a4a3a', '#2d3a50', '#4a4a3a'];
const FIGURE_SCALE = 1.15;

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pickBy = (list, key, salt) => list[hashString(`${key}:${salt}`) % list.length];

export function makePalette(key, coat, options = {}) {
  return {
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

function arm(ctx, sx, sy, hx, hy, colour, skin) {
  poly(ctx, [sx - 1.2, sy, sx + 1.2, sy, hx + 1, hy, hx - 1, hy], colour);
  poly(ctx, [hx - 1.1, hy - .2, hx + 1.1, hy - .2, hx + .9, hy + 1.4, hx - .9, hy + 1.4], skin);
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
  leg(ctx, x - 1.7, y - 9, x - 1.7 + sw * 2.6, y, sh(p.pants, -.18), d);
  leg(ctx, x + 1.7, y - 9, x + 1.7 - sw * 2.6, y, p.pants, d);
  const bob = f.moving ? Math.abs(sw) * .8 : (Math.sin(t * 1.6 + f.phase) > .9 ? .6 : 0);
  const ty = y - 18 - bob, ws = Math.sin(t * 11 + f.phase);
  const sxF = x + d * 4.6, sxB = x - d * 4.6;
  if (f.carry) arm(ctx, sxB, ty + 1, x + d * 5.5, ty + 7.5, p.coatD, p.skin);
  else if (f.wave) arm(ctx, sxB, ty + 1, sxB - d * 2 - Math.sin(t * 9 + f.phase + 2) * 2.2, ty - 7, p.coatD, p.skin);
  else arm(ctx, sxB, ty + 1, sxB - d * .4, ty + 9.5, p.coatD, p.skin);
  if (f.kind === 'runner') {
    poly(ctx, [x - d * 4.8, ty + 5, x - d * 8.6, ty + 5.6, x - d * 8.6, ty + 11.6, x - d * 4.8, ty + 11.6], '#7a5230');
    poly(ctx, [x - d * 4.8, ty + 5, x - d * 8.6, ty + 5.6, x - d * 8.6, ty + 7, x - d * 4.8, ty + 6.4], '#9b6e40');
  }
  poly(ctx, [x - 1.3, ty - 1, x + 1.3, ty - 1, x + 1.5, ty + .6, x - 1.5, ty + .6], sh(p.skin.startsWith('#') ? p.skin : '#c58f6a', -.2));
  poly(ctx, [x - 5, ty, x + 5, ty, x + 4, ty + 9.6, x - 4, ty + 9.6], p.coat);
  poly(ctx, [x - 5, ty, x - 1.8, ty, x - 2.6, ty + 9.6, x - 4, ty + 9.6], p.coatL);
  poly(ctx, [x + .8, ty, x + 5, ty, x + 4, ty + 9.6, x + .8, ty + 9.6], p.coatD);
  poly(ctx, [x - 4, ty + 9.6, x + 4, ty + 9.6, x + 4.1, ty + 8.4, x - 4.1, ty + 8.4], 'rgba(0,0,0,.25)');
  poly(ctx, [x - 1.7, ty, x + 1.7, ty, x, ty + 4.4], p.coatD);
  poly(ctx, [x - 5, ty, x - 1, ty, x - 5, ty + 4.2], 'rgba(255,255,255,.1)');
  poly(ctx, [x + 5, ty + 9.6, x + 1, ty + 9.6, x + 5, ty + 5.4], 'rgba(0,0,0,.1)');
  if (f.kind !== 'runner' && p.coat.length === 7 && parseInt(p.coat.slice(1), 16) > 0xb0b0b0) {
    poly(ctx, [x - .9, ty + 1.7, x + .9, ty + 1.7, x + .6, ty + 6, x, ty + 6.8, x - .6, ty + 6], '#1f4a4d');
  }
  if (p.trim) poly(ctx, [x - 5, ty, x + 5, ty, x + 4.6, ty + 1.7, x - 4.6, ty + 1.7], p.trim);
  if (p.badge) {
    const cx = x + d * 2.3, cy = ty + 5.2;
    poly(ctx, [cx, cy - 1.6, cx + 1.4, cy, cx, cy + 1.6, cx - 1.4, cy], p.badge);
  }
  poly(ctx, [x - 2.7, ty - 7.8, x + 2.7, ty - 7.8, x + 3.3, ty - 4, x + 2.3, ty - .6, x - 2.3, ty - .6, x - 3.3, ty - 4], p.skin);
  poly(ctx, [x + .3, ty - 7.8, x + 2.7, ty - 7.8, x + 3.3, ty - 4, x + 2.3, ty - .6, x + .3, ty - .6], 'rgba(0,0,0,.12)');
  poly(ctx, [x - 3.4, ty - 4.1, x - 2.9, ty - 8.3, x + 2.9, ty - 8.3, x + 3.4, ty - 4.1, x + 2.4, ty - 5.7, x - 2.4, ty - 5.7], p.hair);
  poly(ctx, [x - d * 3.4, ty - 5.7, x - d * 3.4, ty - 1.8, x - d * 2.2, ty - 2.4, x - d * 2.2, ty - 5.7], p.hair);
  poly(ctx, [x - 3.4, ty - 4.1, x - .2, ty - 8.3, x - 2.9, ty - 8.3], 'rgba(255,255,255,.14)');
  R(ctx, x + d * 1.4 - .5, ty - 4.6, 1, 1.2, '#1a1410');
  if (f.hat === 'cap') {
    poly(ctx, [x - 3.7, ty - 7.3, x - 2.9, ty - 10, x + 2.9, ty - 10, x + 3.7, ty - 7.3], '#2b3640');
    poly(ctx, [x - 3.7, ty - 7.3, x, ty - 7.3, x - 2.9, ty - 10], 'rgba(255,255,255,.1)');
    poly(ctx, [x + d * 1, ty - 7.3, x + d * 5.2, ty - 6.8, x + d * 5.2, ty - 6, x + d * 1, ty - 6.3], '#1b232a');
  }
  if (f.carry) {
    arm(ctx, sxF, ty + 1, x + d * 5.5, ty + 7.5, p.coat, p.skin);
    drawCrate(ctx, x + d * 6.2 - 4.3, ty + 3.6, f.carry);
  } else if (f.wave) {
    const flap = Math.sin(t * 9 + f.phase) * 2.2;
    arm(ctx, sxF, ty + 1, sxF + d * 2 + flap, ty - 8, p.coat, p.skin);
  } else if (f.work) arm(ctx, sxF, ty + 1, sxF + d * 3.4, ty + 5.5 + ws * 1.7, p.coat, p.skin);
  else arm(ctx, sxF, ty + 1, sxF + d * .4, ty + 9.5, p.coat, p.skin);
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
