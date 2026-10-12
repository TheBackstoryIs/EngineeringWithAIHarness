export const W = 800;
export const H = 450;
export const SCALE = 3;

export const K = {
  cream: '#d9cba5', creamL: '#ebdfbc', creamD: '#b9a77f', stone: '#c4b48f',
  teal: '#24565a', tealD: '#14363a', tealL: '#3a7a78', ink: '#0d1a1c',
  brass: '#c99b4c', brassL: '#ecc875', brassD: '#8a6528', amber: '#ffb347',
  walnut: '#6b4428', walnutD: '#432915', walnutL: '#8a5d38', olive: '#6d7138', oliveD: '#454a24',
  slate: '#4b5b64', green: '#7be0a6', blue: '#7ea6bf',
};

export const srand = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

export function sh(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const target = amount < 0 ? 0 : 255, p = Math.abs(amount);
  return `rgb(${Math.round(r + (target - r) * p)},${Math.round(g + (target - g) * p)},${Math.round(b + (target - b) * p)})`;
}

export function mix(a, b, t) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const f = (s) => Math.round(((A >> s) & 255) * (1 - t) + ((B >> s) & 255) * t);
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}

// Fine surfaces are drawn as jittered triangles. Only the cached per-room renders turn this on.
export const fine = { on: false };

export function tri(c, x, y, w, h, col, cell, amp, lamp) {
  let rgb;
  if (col[0] === '#') {
    const n = parseInt(col.slice(1), 16);
    rgb = [n >> 16, (n >> 8) & 255, n & 255];
  } else {
    const m = col.match(/\d+/g);
    rgb = [+m[0], +m[1], +m[2]];
  }
  const nx = Math.max(1, Math.round(w / cell)), ny = Math.max(1, Math.round(h / cell)), cw = w / nx, ch = h / ny;
  let seed = (Math.floor(x) * 31 + Math.floor(y) * 17 + rgb[0] * 7 + rgb[2]) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const P = [];
  for (let j = 0; j <= ny; j++) {
    P[j] = [];
    for (let i = 0; i <= nx; i++) {
      P[j][i] = [x + i * cw + ((i === 0 || i === nx) ? 0 : (rnd() - .5) * cw * .7), y + j * ch + ((j === 0 || j === ny) ? 0 : (rnd() - .5) * ch * .7)];
    }
  }
  c.lineWidth = .35;
  c.lineJoin = 'round';
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = P[j][i], b2 = P[j][i + 1], c2 = P[j + 1][i + 1], d = P[j + 1][i];
      const T = rnd() < .5 ? [[a, b2, d], [b2, c2, d]] : [[a, b2, c2], [a, c2, d]];
      for (const t of T) {
        const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
        const v = (rnd() - .5) * 2 * amp + (.5 - ((cx - x) / w + (cy - y) / h) / 2) * lamp;
        const k = v < 0 ? 0 : 255, q = Math.abs(v);
        const f = `rgb(${Math.round(rgb[0] + (k - rgb[0]) * q)},${Math.round(rgb[1] + (k - rgb[1]) * q)},${Math.round(rgb[2] + (k - rgb[2]) * q)})`;
        c.fillStyle = f;
        c.strokeStyle = f;
        c.beginPath();
        c.moveTo(t[0][0], t[0][1]);
        c.lineTo(t[1][0], t[1][1]);
        c.lineTo(t[2][0], t[2][1]);
        c.closePath();
        c.fill();
        c.stroke();
      }
    }
  }
}

const hsh = (x, y) => ((Math.floor(x) * 73856093) ^ (Math.floor(y) * 19349663)) & 1;

export function poly(c, pts, col) {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fill();
}

export function R(c, x, y, w, h, col) {
  if (fine.on && w >= 9 && h >= 9 && !col.startsWith('rgba')) {
    tri(c, x, y, w, h, col, Math.min(8, Math.max(4, Math.min(w, h) / 2.5)), .05, .08);
    return;
  }
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
  if (w < 5 || h < 5 || col.startsWith('rgba')) return;
  if (hsh(x, y)) {
    poly(c, [x, y, x + w, y, x, y + h], 'rgba(255,255,255,.075)');
    poly(c, [x + w, y, x + w, y + h, x, y + h], 'rgba(0,0,0,.085)');
  } else {
    poly(c, [x, y, x + w, y, x + w, y + h], 'rgba(255,255,255,.075)');
    poly(c, [x, y, x + w, y + h, x, y + h], 'rgba(0,0,0,.085)');
  }
}

export function box(c, x, y, w, h, col, lt, dk) {
  R(c, x, y, w, h, col);
  R(c, x, y, w, 1, lt);
  R(c, x + w - 1, y, 1, h, dk);
  R(c, x, y + h - 1, w, 1, dk);
}

export function pdisk(c, cx, cy, r, col, rot = 0) {
  const rr = r + .5, n = r < 3 ? 6 : r < 8 ? 10 : 14, P = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * 6.2832 + rot + .3;
    P.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(P[0], P[1]);
  for (let i = 2; i < P.length - 2; i += 2) c.lineTo(P[i], P[i + 1]);
  c.closePath();
  c.fill();
  if (r >= 2) {
    for (let i = 0; i < n; i++) {
      const k = i % 3;
      if (k === 2) continue;
      poly(c, [cx, cy, P[i * 2], P[i * 2 + 1], P[i * 2 + 2], P[i * 2 + 3]], k ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.1)');
    }
  }
}

export function pell(c, cx, cy, rx, ry, col) {
  const P = [];
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * 6.2832;
    P.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  poly(c, P, col);
}

export function pline(c, x0, y0, x1, y1, col) {
  c.strokeStyle = col;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x0 + .5, y0 + .5);
  c.lineTo(x1 + .5, y1 + .5);
  c.stroke();
}

export function glowSprite(col) {
  const g = document.createElement('canvas');
  g.width = g.height = 64;
  const c = g.getContext('2d');
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${col},.9)`);
  gr.addColorStop(.35, `rgba(${col},.28)`);
  gr.addColorStop(1, `rgba(${col},0)`);
  c.fillStyle = gr;
  c.fillRect(0, 0, 64, 64);
  return g;
}
