import { K, W, H, SCALE, R, box, fine, pdisk, pell, pline, poly, sh, srand, tri } from './draw.js';

export const FLOOR_Y = [205, 410];
export const TOP_Y = [44, 219];

// Geometry and desk positions for each room. Names come from the server so wording stays in one place.
const LAYOUT = [
  { id: 'discovery', x: 0, w: 150, row: 0, wall: K.cream, wain: K.walnut, desks: [38, 112] },
  { id: 'plan', x: 150, w: 170, row: 0, wall: K.cream, wain: K.walnut, desks: [190, 240, 292] },
  { id: 'testplan', x: 320, w: 150, row: 0, wall: K.teal, wain: K.tealD, desks: [358, 432] },
  { id: 'ui', x: 470, w: 170, row: 0, wall: '#cdbb8f', wain: K.walnutD, desks: [510, 590] },
  { id: 'gate', x: 640, w: 160, row: 0, wall: '#c2ad80', wain: K.walnutD, desks: [682, 742] },
  { id: 'build', x: 540, w: 260, row: 1, wall: K.teal, wain: K.tealD, desks: [575, 630, 690, 745] },
  { id: 'review', x: 370, w: 170, row: 1, wall: '#a9a574', wain: K.oliveD, desks: [398, 455, 512] },
  { id: 'test', x: 200, w: 170, row: 1, wall: '#3b6f6e', wain: K.tealD, desks: [225, 285, 345] },
  { id: 'deliver', x: 0, w: 200, row: 1, wall: '#e0d3ad', wain: K.walnut, desks: [40, 100] },
].map((room, i) => ({ ...room, i, fy: FLOOR_Y[room.row], top: TOP_Y[room.row] }));

export const ROOMS = LAYOUT;
export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((room) => [room.id, room]));

const BOOK = ['#8a3b3b', '#2f5f63', '#b88a3e', '#4c6b3a', '#6b4a2f', '#d6c6a0', '#35506b'];
const freshDyn = () => ({ reels: [], crts: [], lamps: [], clocks: [], shafts: [], pools: [] });

// Painting helpers draw onto whichever canvas is current, so the same props serve the full backdrop and the zoomed room renders.
let b = null;
let dyn = freshDyn();

function shelf(x, y, w, h, seed) {
  const rnd = srand(seed);
  box(b, x, y, w, h, K.walnut, K.walnutL, K.walnutD);
  const rows = Math.floor((h - 2) / 12);
  for (let i = 0; i < rows; i++) {
    const sy = y + 2 + i * 12;
    R(b, x + 1, sy, w - 2, 11, K.walnutD);
    R(b, x + 1, sy + 10, w - 2, 1, K.walnutL);
    let bx = x + 2;
    while (bx < x + w - 4) {
      const bw = 2 + Math.floor(rnd() * 3), bh = 6 + Math.floor(rnd() * 4);
      R(b, bx, sy + 10 - bh, bw, bh, BOOK[Math.floor(rnd() * BOOK.length)]);
      bx += bw + (rnd() < .2 ? 2 : 0);
    }
  }
}

function win(x, y, w, h) {
  R(b, x - 2, y - 2, w + 4, h + 4, K.brassD);
  const g = b.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#86abc4');
  g.addColorStop(.62, '#ecd0a0');
  g.addColorStop(1, '#f1b574');
  b.fillStyle = g;
  b.fillRect(x, y, w, h);
  poly(b, [x, y + h * .7, x + w * .22, y + h * .52, x + w * .5, y + h * .66, x + w * .78, y + h * .46, x + w, y + h * .62, x + w, y + h, x, y + h], '#8aa294');
  poly(b, [x + w * .5, y + h * .66, x + w * .78, y + h * .46, x + w, y + h * .62, x + w, y + h, x + w * .6, y + h], 'rgba(255,255,255,.1)');
  poly(b, [x, y + h * .84, x + w * .3, y + h * .7, x + w * .62, y + h * .8, x + w, y + h * .7, x + w, y + h, x, y + h], '#667f6c');
  for (let i = 0; i < 3; i++) {
    const bx = x + w * (.08 + i * .32), bw = Math.max(3, w * .13), bh = h * (.14 + .06 * ((i * 5) % 3));
    poly(b, [bx, y + h * .8, bx, y + h * .8 - bh, bx + bw / 2, y + h * .8 - bh - 3, bx + bw, y + h * .8 - bh, bx + bw, y + h * .8], '#9a9486');
  }
  for (let i = 0; i < 2; i++) {
    const tx = x + w * (.28 + i * .42), ty = y + h * .8;
    poly(b, [tx - 4, ty, tx, ty - 9, tx + 4, ty], '#566f3c');
    poly(b, [tx, ty - 9, tx + 4, ty, tx, ty], 'rgba(0,0,0,.18)');
  }
  for (let i = 6; i < w; i += 6) R(b, x + i - 1, y, 1, h, K.creamL);
  for (let j = 6; j < h; j += 6) R(b, x, y + j - 1, w, 1, K.creamL);
  R(b, x - 3, y + h + 1, w + 6, 2, K.creamD);
  dyn.shafts.push({ x, y: y + h, w });
}

function seal(cx, cy, r) {
  pdisk(b, cx, cy, r, K.brassD);
  pdisk(b, cx, cy, r - 1, K.brass);
  pdisk(b, cx, cy, r - 4, K.brassD);
  pdisk(b, cx, cy, r - 5, K.brassL);
  pdisk(b, cx, cy, r - 9, K.brassD);
  pdisk(b, cx, cy, r - 10, K.brass);
  pdisk(b, cx, cy, 2, K.brassL);
}

function cabinet(x, y, w, h, withReels) {
  box(b, x, y, w, h, K.teal, K.tealL, K.tealD);
  R(b, x + 1, y + h - 9, w - 2, 8, K.tealD);
  R(b, x + w / 2 - 3, y + h - 6, 6, 2, K.brass);
  if (!withReels) return;
  const n = Math.max(1, Math.floor((w - 4) / 16));
  for (let i = 0; i < n; i++) {
    const cx = x + Math.round((i + .5) * (w / n)), cy = y + 11;
    pdisk(b, cx, cy, 8, K.tealD);
    dyn.reels.push({ x: cx, y: cy, r: 7, s: (0.8 + ((i * 37 + x) % 8) / 10) * ((i + x) % 2 ? 1 : -1) });
  }
  const ly = y + 24;
  for (let i = 0; i < Math.floor((w - 6) / 5); i++) R(b, x + 4 + i * 5, ly, 3, 2, ((i * 7) % 3) ? K.tealD : K.amber);
  R(b, x + 3, ly + 7, w - 6, 10, '#0f2a2c');
  for (let i = 0; i < Math.floor((w - 8) / 4); i++) R(b, x + 5 + i * 4, ly + 9, 2, 2, (i % 3) ? K.tealL : K.amber);
}

function banner(x, y, w, h) {
  R(b, x, y, w, h, '#10272a');
  R(b, x, y, w, 1, K.brass);
  R(b, x + 1, y + 1, w - 2, 1, K.brassD);
  const cx = x + Math.round(w / 2), cy = y + Math.round(h * .38);
  pdisk(b, cx, cy, Math.floor(w / 4), K.brass);
  pdisk(b, cx, cy, Math.floor(w / 4) - 1, '#10272a');
  R(b, cx, cy - Math.floor(w / 4), 1, Math.floor(w / 2), K.brass);
  R(b, cx - Math.floor(w / 4), cy, Math.floor(w / 2), 1, K.brass);
  for (let i = 0; i < 3; i++) R(b, x + 2 + i * Math.floor((w - 4) / 3), y + h, 2, 2, K.brass);
}

function drawRoomShell(r) {
  const fl = r.fy - 14, wTop = r.top + 7;
  b.fillStyle = r.wall;
  b.fillRect(r.x, r.top, r.w, fl - r.top);
  b.fillStyle = '#b8a77f';
  b.fillRect(r.x, fl, r.w, 14);
  tri(b, r.x, wTop, r.w, fl - wTop, r.wall, 9, .055, .14);
  R(b, r.x, fl - 22, r.w, 22, r.wain);
  for (let x = r.x; x < r.x + r.w; x += 12) R(b, x, fl - 22, 1, 22, sh(r.wain, -.25));
  R(b, r.x, fl - 23, r.w, 2, K.brass);
  R(b, r.x, fl - 21, r.w, 1, K.brassD);
  R(b, r.x, r.top, r.w, 7, K.walnutD);
  R(b, r.x, r.top + 7, r.w, 1, K.brass);
  for (let x = r.x; x < r.x + r.w; x += 10) R(b, x, r.top + 2, 1, 5, K.walnut);
  for (let x = r.x, i = 0; x < r.x + r.w; x += 10, i++) {
    for (let k = 0; k < 2; k++) tri(b, x, fl + k * 7, Math.min(10, r.x + r.w - x), 7, (i + k) % 2 ? '#cfc09a' : '#bdad85', 3.5, .045, .1);
  }
  R(b, r.x, fl + 5, r.w, 1.6, '#3a7a78');
  R(b, r.x, fl + 6.6, r.w, .8, K.brassD);
  R(b, r.x, fl, r.w, 1, 'rgba(0,0,0,.18)');
  R(b, r.x, r.fy, r.w, r.row ? 10 : 14, K.tealD);
  R(b, r.x, r.fy, r.w, 1, K.brass);
  R(b, r.x, r.fy + 1, r.w, 1, K.brassD);
  for (const px of [r.x, r.x + r.w - 4]) {
    R(b, px, r.top, 4, r.fy - r.top, K.creamD);
    R(b, px, r.top, 1, r.fy - r.top, K.creamL);
    R(b, px, r.top, 4, 3, K.brass);
  }
  for (const lx of [r.x + 8, r.x + r.w - 9]) dyn.lamps.push({ x: lx, y: r.top + 34, s: 34 });
  let g = b.createLinearGradient(0, wTop, 0, wTop + 26);
  g.addColorStop(0, 'rgba(10,8,4,.38)');
  g.addColorStop(1, 'rgba(10,8,4,0)');
  b.fillStyle = g;
  b.fillRect(r.x, wTop, r.w, 26);
  g = b.createLinearGradient(r.x + 4, 0, r.x + 18, 0);
  g.addColorStop(0, 'rgba(10,8,4,.3)');
  g.addColorStop(1, 'rgba(10,8,4,0)');
  b.fillStyle = g;
  b.fillRect(r.x + 4, wTop, 14, fl - wTop);
  g = b.createLinearGradient(r.x + r.w - 4, 0, r.x + r.w - 18, 0);
  g.addColorStop(0, 'rgba(10,8,4,.3)');
  g.addColorStop(1, 'rgba(10,8,4,0)');
  b.fillStyle = g;
  b.fillRect(r.x + r.w - 18, wTop, 14, fl - wTop);
  g = b.createLinearGradient(0, fl, 0, r.fy);
  g.addColorStop(0, 'rgba(0,0,0,.16)');
  g.addColorStop(.5, 'rgba(255,240,210,0)');
  g.addColorStop(1, 'rgba(255,240,210,.1)');
  b.fillStyle = g;
  b.fillRect(r.x + 4, fl, r.w - 8, 14);
}

function agave(x, y) {
  R(b, x - 7, y - 6, 14, 6, K.walnut);
  R(b, x - 7, y - 6, 14, 1, K.brassL);
  const L = [[-62, 13, '#587a3a'], [-38, 16, '#6f9246'], [-14, 18, '#4b6a32'], [10, 17, '#7a9c4c'], [34, 15, '#5a7c3a'], [58, 12, '#6a8c42'], [0, 19, '#86a858']];
  for (const [a, len, c] of L) {
    const rad = a * Math.PI / 180, tx = x + Math.sin(rad) * len, ty = y - 6 - Math.cos(rad) * len, nx = Math.cos(rad) * 1.8, ny = Math.sin(rad) * 1.8;
    poly(b, [x - nx, y - 6 - ny, tx, ty, x + nx, y - 6 + ny], c);
    poly(b, [x, y - 6, tx, ty, x + nx, y - 6 + ny], 'rgba(0,0,0,.2)');
  }
}

function pendant(r, x, y) {
  R(b, x - .5, r.top + 8, 1, y - r.top - 8, K.brassD);
  R(b, x - 2, y - 2, 4, 3, K.brass);
  poly(b, [x - 8, y + 9, x - 3.5, y + 1, x + 3.5, y + 1, x + 8, y + 9], '#efe2b8');
  poly(b, [x - 8, y + 9, x - 3.5, y + 1, x - 1, y + 1, x - 3, y + 9], 'rgba(255,255,255,.3)');
  poly(b, [x + 2, y + 1, x + 3.5, y + 1, x + 8, y + 9, x + 3, y + 9], 'rgba(120,90,30,.28)');
  R(b, x - 8, y + 9, 16, 1.5, K.brass);
  dyn.lamps.push({ x, y: y + 9, s: 52 });
  dyn.pools.push({ x, y: r.fy - 8, w: r.w * .5 });
}

function drawDecor(r) {
  const t = r.top, fl = r.fy - 14;
  const n = r.w > 200 ? 3 : 2, off = r.i % 2 ? .32 : .28;
  for (let i = 0; i < n; i++) pendant(r, r.x + r.w * (n === 3 ? (.2 + i * .3) : (i ? 1 - off : off)), t + 22 + ((i + r.i) % 2) * 6);
  switch (r.id) {
    case 'plan':
      R(b, r.x + 96, fl - 36, 18, 36, K.walnut);
      for (let i = 0; i < 3; i++) {
        R(b, r.x + 98, fl - 34 + i * 11, 14, 9, K.walnutD);
        R(b, r.x + 103, fl - 30 + i * 11, 5, 1.4, K.brassL);
      }
      agave(r.x + 156, fl + 1);
      break;
    case 'review': agave(r.x + 16, fl + 1); agave(r.x + r.w - 14, fl + 1); break;
    case 'gate': agave(r.x + 22, fl + 1); break;
    case 'deliver': agave(r.x + 52, fl + 1); break;
    case 'discovery': agave(r.x + 140, fl + 1); break;
    default:
  }
}

function drawProps(r) {
  const fy = r.fy, t = r.top, x0 = r.x;
  switch (r.id) {
    case 'discovery':
      shelf(x0 + 6, t + 12, 46, fy - t - 28, 11);
      shelf(x0 + 98, t + 12, 46, fy - t - 28, 29);
      win(x0 + 60, t + 14, 30, 52);
      box(b, x0 + 64, t + 76, 22, 26, K.creamD, K.creamL, K.walnut);
      pdisk(b, x0 + 75, t + 70, 7, K.tealD);
      pdisk(b, x0 + 75, t + 70, 6, K.teal);
      R(b, x0 + 69, t + 70, 12, 1, K.brass);
      R(b, x0 + 74, t + 7, 2, 10, K.brassD);
      R(b, x0 + 69, t + 17, 12, 6, '#2f6f4a');
      R(b, x0 + 69, t + 17, 12, 1, K.green);
      dyn.lamps.push({ x: x0 + 75, y: t + 24, s: 40, c: '120,255,170' });
      break;
    case 'plan': {
      box(b, x0 + 14, t + 16, 78, 56, K.tealD, K.tealL, K.ink);
      for (let i = 0; i < 78; i += 8) R(b, x0 + 14 + i, t + 17, 1, 54, '#1e5558');
      for (let j = 0; j < 56; j += 8) R(b, x0 + 15, t + 16 + j, 76, 1, '#1e5558');
      const cx = x0 + 52, cy = t + 44;
      poly(b, [cx - 8, cy - 17, cx + 8, cy - 17, cx + 17, cy - 8, cx + 17, cy + 8, cx + 8, cy + 17, cx - 8, cy + 17, cx - 17, cy + 8, cx - 17, cy - 8], '#10393c');
      for (const [rad, c] of [[12, '#0b2e30'], [11, '#1f6a68'], [10, '#0b2e30'], [6, '#1f6a68'], [5, '#0b2e30']]) pdisk(b, cx, cy, rad, c);
      pline(b, cx - 12, cy, cx + 12, cy, K.green);
      pline(b, cx, cy - 12, cx, cy + 12, K.green);
      pline(b, cx, cy, cx + 8, cy - 8, K.brassL);
      for (const [ox, oy] of [[-30, -10], [30, -12], [-30, 12], [30, 14]]) {
        pdisk(b, cx + ox, cy + oy, 4, '#10393c');
        pdisk(b, cx + ox, cy + oy, 2, K.brassD);
        pline(b, cx + ox * .55, cy + oy * .55, cx + ox * .8, cy + oy * .8, K.brassL);
      }
      for (let i = 0; i < 8; i++) R(b, x0 + 18 + i * 9, t + 66, 5, 1, i % 2 ? K.brassD : K.brassL);
      pline(b, x0 + 18, t + 63, x0 + 88, t + 63, K.brassD);
      for (let i = 0; i < 6; i++) R(b, x0 + 18, t + 20 + i * 2.2, 10 + ((i * 7) % 9), .8, '#2d7a78');
      win(x0 + 116, t + 14, 34, 54);
      R(b, x0 + 104, t + 8, 2, 10, K.brassD);
      dyn.clocks.push({ x: x0 + 105, y: t + 30, r: 7 });
      break;
    }
    case 'testplan':
      for (let i = 0; i < 4; i++) cabinet(x0 + 8 + i * 34, t + 16, 30, fy - 14 - t - 16, true);
      break;
    case 'ui':
      box(b, x0 + 12, t + 22, 30, 40, K.creamL, '#fff', K.creamD);
      R(b, x0 + 16, t + 28, 22, 3, K.slate);
      R(b, x0 + 16, t + 35, 10, 10, K.slate);
      R(b, x0 + 29, t + 35, 9, 4, K.slate);
      R(b, x0 + 29, t + 42, 9, 3, K.slate);
      R(b, x0 + 19, t + 62, 2, fy - 14 - t - 62, K.walnutD);
      R(b, x0 + 33, t + 62, 2, fy - 14 - t - 62, K.walnutD);
      banner(x0 + 60, t + 10, 20, 38);
      win(x0 + 86, t + 14, 26, 40);
      box(b, x0 + 116, fy - 14 - 12, 36, 12, K.walnut, K.walnutL, K.walnutD);
      box(b, x0 + 119, fy - 14 - 52, 30, 40, '#cdc6b0', '#f3eedd', '#8f8a78');
      for (let i = 0; i < 6; i++) R(b, x0 + 123, fy - 14 - 30 + i * 3, 22, 1, '#2a2c2b');
      box(b, x0 + 126, fy - 14 - 49, 16, 10, '#0d1a14', '#243b30', '#0d1a14');
      dyn.beaconX = x0 + 134;
      dyn.beaconY = fy - 14 - 58;
      dyn.scr = { x: x0 + 127, y: fy - 14 - 48, w: 14, h: 8 };
      break;
    case 'gate':
      seal(x0 + 58, t + 46, 19);
      shelf(x0 + 98, t + 14, 24, 52, 41);
      dyn.clocks.push({ x: x0 + 136, y: t + 26, r: 7 });
      dyn.goLamp = { x: x0 + 58, y: t + 78 };
      break;
    case 'build': {
      const gy = t + 60;
      for (let i = 0; i < 6; i++) {
        cabinet(x0 + 4 + i * 40, t + 10, 38, gy - t - 12, false);
        const cx = x0 + 4 + i * 40 + 19, cy = t + 24;
        pdisk(b, cx, cy, 8, K.tealD);
        dyn.reels.push({ x: cx, y: cy, r: 7, s: (0.6 + (i % 4) * .2) * (i % 2 ? 1 : -1) });
        for (let k = 0; k < 6; k++) R(b, x0 + 8 + i * 40 + k * 5, t + 38, 3, 2, ((k + i) % 3) ? K.tealD : K.amber);
      }
      R(b, x0, gy, r.w - 28, 5, K.walnut);
      R(b, x0, gy, r.w - 28, 1, K.walnutL);
      R(b, x0, gy + 5, r.w - 28, 2, K.walnutD);
      for (let x = x0 + 4; x < x0 + r.w - 28; x += 14) R(b, x, gy - 12, 1, 12, K.brass);
      R(b, x0, gy - 12, r.w - 28, 1, K.brassL);
      R(b, x0, gy - 6, r.w - 28, 1, K.brass);
      for (let i = 0; i < 6; i++) cabinet(x0 + 4 + i * 40, gy + 8, 38, fy - 14 - gy - 8, true);
      dyn.crts.push({ x: x0 + 4, y: fy - 14 - 30, w: 0 });
      break;
    }
    case 'review':
      win(x0 + 12, t + 14, 22, 66);
      win(x0 + 138, t + 14, 22, 66);
      seal(x0 + 85, t + 42, 18);
      shelf(x0 + 44, t + 66, 82, 20, 53);
      break;
    case 'test':
      box(b, x0 + 12, t + 14, 32, 66, K.walnut, K.walnutL, K.walnutD);
      box(b, x0 + 17, t + 22, 22, 8, K.brass, K.brassL, K.brassD);
      R(b, x0 + 20, t + 25, 16, 2, K.walnutD);
      R(b, x0 + 34, t + 46, 3, 3, K.brassL);
      R(b, x0 + 54, t + 8, r.w - 62, 2, K.brass);
      R(b, x0 + 54, t + 10, r.w - 62, 1, K.brassD);
      for (let i = 0; i < 3; i++) {
        const sx = x0 + 58 + i * 38;
        box(b, sx, t + 30, 32, 40, K.tealD, K.tealL, K.ink);
        R(b, sx + 3, t + 34, 26, 20, '#0a1612');
        dyn.crts.push({ x: sx + 3, y: t + 34, w: 26, h: 20, i });
        for (let k = 0; k < 5; k++) pdisk(b, sx + 5 + k * 5, t + 62, 1, K.amber);
        dyn.lamps.push({ x: sx + 16, y: t + 62, s: 16, c: '255,170,60' });
      }
      for (let i = 0; i < 5; i++) {
        const fx = x0 + 58 + i * 20;
        R(b, fx, t + 84, 5, 7, ['#7be0a6', '#e8a33d', '#7ea6d4', '#d9694f', '#9bbf5a'][i]);
        R(b, fx + 1, t + 81, 3, 3, '#c8d8d8');
      }
      break;
    case 'deliver':
      win(x0 + 6, t + 14, 38, 66);
      banner(x0 + 62, t + 10, 24, 50);
      for (let i = 0; i < 2; i++) {
        const cx = x0 + 112 + i * 44;
        box(b, cx, t + 30, 40, fy - 14 - t - 30, 'rgba(126,166,191,.18)', '#9fc3d6', K.creamD);
        R(b, cx, t + 30, 40, 2, K.brass);
        R(b, cx + 2, t + 70, 36, 2, K.brassD);
        R(b, cx + 2, t + 110, 36, 2, K.brassD);
        R(b, cx + 2, fy - 14 - 4, 36, 4, K.walnut);
      }
      dyn.shelfY = [t + 70, t + 110];
      dyn.shelfX = x0 + 112;
      for (const [rx, c] of [[62, K.brass], [56, '#cdbd96'], [44, K.brassD], [36, '#cdbd96'], [22, K.brass], [12, K.brassD]]) pell(b, x0 + 100, fy - 7, rx, rx * .11, c);
      break;
    default:
  }
}

function drawStructure() {
  R(b, 0, 36, W, 8, K.tealD);
  R(b, 0, 36, W, 1, K.brassL);
  R(b, 0, 37, W, 1, K.brassD);
  for (let x = 0; x < W; x += 40) R(b, x, 38, 1, 6, K.ink);
  for (const px of [0, 150, 320, 470, 640, 780]) {
    R(b, px, 26, 20, 18, K.creamD);
    R(b, px, 26, 20, 2, K.brassL);
    R(b, px + 2, 28, 16, 16, K.cream);
  }
  R(b, 0, 26, 20, 2, K.brassL);
  banner(60, 4, 22, 34);
  banner(718, 4, 22, 34);
  for (let y = 420; y < H; y += 10) {
    for (let x = 0; x < W; x += 20) R(b, x + ((y / 10) % 2 ? 10 : 0) % 20, y, 20, 10, ((x + y) / 10) % 3 ? '#2c4547' : '#264042');
  }
  R(b, 0, 420, W, 2, K.brass);
  R(b, 0, 422, W, 1, K.brassD);
  R(b, 0, 440, W, 10, '#142628');
  for (let x = 0; x < W; x += 16) R(b, x, 440, 8, 10, '#122022');
  for (const lx of [270, 520]) {
    R(b, lx, 424, 2, 18, K.brassD);
    R(b, lx - 3, 420, 8, 5, K.brass);
    dyn.lamps.push({ x: lx + 1, y: 422, s: 36 });
  }
  R(b, 772, 44, 28, 376, K.ink);
  R(b, 772, 44, 1, 376, K.brassD);
  R(b, 799, 44, 1, 376, K.brassD);
  for (let y = 48; y < 418; y += 12) {
    R(b, 774, y, 1, 6, '#27403f');
    R(b, 797, y, 1, 6, '#27403f');
  }
  R(b, 775, 44, 22, 3, K.brass);
}

// Per-frame redraw of the building frame when zoomed, without registering its lamps a second time.
export function drawStructureOn(target) {
  const savedB = b, savedDyn = dyn;
  b = target;
  dyn = freshDyn();
  drawStructure();
  b = savedB;
  dyn = savedDyn;
}

// Draws a room onto its own canvas at 5x so the zoomed view stays crisp.
export function renderRoom(r) {
  const Z = 5, h = r.fy + (r.row ? 10 : 14) - r.top;
  const cvs = document.createElement('canvas');
  cvs.width = Math.ceil(r.w * Z);
  cvs.height = Math.ceil(h * Z);
  const c = cvs.getContext('2d');
  c.setTransform(Z, 0, 0, Z, -r.x * Z, -r.top * Z);
  const savedB = b, savedDyn = dyn, savedFine = fine.on;
  b = c;
  dyn = freshDyn();
  fine.on = true;
  drawRoomShell(r);
  drawProps(r);
  drawDecor(r);
  b = savedB;
  dyn = savedDyn;
  fine.on = savedFine;
  return { cvs, h };
}

// Bakes every room once. The returned dyn holds the moving parts (reels, lamps, clocks) the scene animates on top.
export function buildBackdrop() {
  const bg = document.createElement('canvas');
  bg.width = W * SCALE;
  bg.height = H * SCALE;
  b = bg.getContext('2d');
  b.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  dyn = freshDyn();
  fine.on = true;
  for (const r of ROOMS) {
    drawRoomShell(r);
    drawProps(r);
    drawDecor(r);
  }
  fine.on = false;
  drawStructure();
  const shafts = document.createElement('canvas');
  shafts.width = W * SCALE;
  shafts.height = H * SCALE;
  const sc = shafts.getContext('2d');
  sc.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  for (const s of dyn.shafts) {
    const x0 = s.x + 3, x1 = s.x + s.w - 3, y0 = s.y, L = 105;
    const g = sc.createLinearGradient(0, y0, 0, y0 + L);
    g.addColorStop(0, 'rgba(255,226,160,.24)');
    g.addColorStop(1, 'rgba(255,226,160,0)');
    sc.fillStyle = g;
    sc.beginPath();
    sc.moveTo(x0, y0);
    sc.lineTo(x1, y0);
    sc.lineTo(x1 + L * .5, y0 + L);
    sc.lineTo(x0 + L * .5, y0 + L);
    sc.closePath();
    sc.fill();
  }
  const result = { bg, shafts, dyn };
  b = null;
  return result;
}

