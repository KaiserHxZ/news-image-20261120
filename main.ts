// THE DAY'S NEWS — Friday, 20 November 2026.
// A code-drawn newspaper front page: one day's world news in one image.
// Node 22+, standard library only, no network. Deterministic output:
// the same bytes on every run. Writes entry.png to MAKEFUN_OUTPUT_DIR
// (standing in for /output outside the grader) or /output.
//
// Five verified stories of 20 Nov 2026, told as one day unfolding:
// overnight over Kyiv, morning landfall in Odisha, the day's verdict
// from The Hague, the afternoon sell-off on Wall Street, and evening
// in the Peruvian Andes.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// --- deterministic speckle: fixed-seed PRNG, no Math.random ------------
let seed = 20261120;
function rnd() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- PNG encoder (RGB, filter 0, zlib) ---------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(data.length, 0);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(rgb, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- canvas -------------------------------------------------------------
class Canvas {
  constructor(w, h, paper) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    this.fill(paper);
  }
  fill(c) {
    for (let i = 0; i < this.px.length; i += 3) {
      this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
    }
  }
  set(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) this.set(i, j, c);
  }
  // filled circle
  disc(cx, cy, r, c) {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++)
        if (i * i + j * j <= r * r) this.set(cx + i, cy + j, c);
  }
  // circle outline, thickness t
  ring(cx, cy, r, t, c) {
    for (let j = -r - t; j <= r + t; j++)
      for (let i = -r - t; i <= r + t; i++) {
        const d = Math.sqrt(i * i + j * j);
        if (d <= r && d > r - t) this.set(cx + i, cy + j, c);
      }
  }
  // Bresenham line, thickness t (square brush). Endpoints are rounded
  // first: a fractional start can never step exactly onto the end.
  line(x0, y0, x1, y1, c, t = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0);
    x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    const half = Math.floor(t / 2);
    for (;;) {
      for (let j = -half; j <= half; j++)
        for (let i = -half; i <= half; i++) this.set(x + i, y + j, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  // filled polygon (scanline)
  poly(pts, c) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = [];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.set(x, y, c);
    }
  }
  // vertical gradient band
  vgrad(x, y, w, h, top, bottom) {
    for (let j = 0; j < h; j++) {
      const f = j / Math.max(1, h - 1);
      const c = [0, 1, 2].map((k) => Math.round(top[k] + (bottom[k] - top[k]) * f));
      this.rect(x, y + j, w, 1, c);
    }
  }
}

// --- palette ------------------------------------------------------------
const PAPER = [247, 242, 231];
const INK = [26, 26, 26];
const RULE = [26, 26, 26];
const RED = [178, 35, 27];
const NIGHT_TOP = [10, 18, 38];
const NIGHT_BOT = [43, 74, 110];
const GLOW = [232, 126, 48];
const TEAL = [14, 107, 122];
const TEAL_LT = [178, 222, 226];
const OCHRE = [138, 90, 43];
const OCHRE_LT = [232, 214, 180];
const PLUM = [91, 58, 140];
const PLUM_LT = [214, 203, 232];
const RED_LT = [240, 205, 200];
const GOLD = [196, 148, 44];

// --- 5x7 bitmap font -----------------------------------------------------
// Each glyph: 7 rows of 5 pixels, '#' set. Drawn scaled, so text stays
// crisp at any size and no font file is needed.
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '00100', '01000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '"': ['01010', '01010', '00000', '00000', '00000', '00000', '00000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  _: ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '*': ['00000', '00100', '10101', '01110', '10101', '00100', '00000'],
};

const CHAR_W = 6; // 5 pixels + 1 spacing
const CHAR_H = 7;

function textWidth(s, scale) {
  return s.length * CHAR_W * scale - scale;
}

function drawText(cv, s, x, y, scale, color, align = 'left') {
  const w = textWidth(s, scale);
  let cx = x;
  if (align === 'center') cx = x - Math.floor(w / 2);
  else if (align === 'right') cx = x - w;
  for (let ci = 0; ci < s.length; ci++) {
    const g = GLYPHS[s[ci].toUpperCase()] || GLYPHS['?'];
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++)
        if (g[r][c] === '1') cv.rect(cx + (ci * CHAR_W + c) * scale, y + r * scale, scale, scale, color);
  }
  return w;
}

// Word-wrap a string to lines that fit maxWidth at the given scale.
function wrapText(s, scale, maxWidth) {
  const words = s.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const trial = cur ? cur + ' ' + word : word;
    if (textWidth(trial, scale) <= maxWidth) cur = trial;
    else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawLines(cv, lines, x, y, scale, color, lh, align = 'left') {
  for (let i = 0; i < lines.length; i++)
    drawText(cv, lines[i], x, y + i * lh, scale, color, align);
  return lines.length;
}

// Small filled diamond used as a separator bullet.
function diamond(cv, cx, cy, r, color) {
  cv.poly([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], color);
}

// --- scenes ---------------------------------------------------------------
// Each scene draws inside (x, y, w, h). All shapes are primitives;
// nothing is loaded, traced or copied from any artwork.

// LEAD: overnight over Kyiv — dark sky, missile trails, skyline,
// the river, and a bridge with a broken span.
function sceneKyiv(cv, x, y, w, h) {
  cv.vgrad(x, y, w, h, NIGHT_TOP, NIGHT_BOT);
  // stars
  for (let i = 0; i < 90; i++) {
    const sx = x + Math.floor(rnd() * w);
    const sy = y + Math.floor(rnd() * Math.floor(h * 0.55));
    const b = 150 + Math.floor(rnd() * 105);
    cv.set(sx, sy, [b, b, b + 10 > 255 ? 255 : b + 10]);
  }
  // distant glow on the horizon, kept inside the scene
  cv.disc(x + Math.floor(w * 0.30), y + h - 78, 52, [52, 66, 92]);
  cv.disc(x + Math.floor(w * 0.30), y + h - 78, 34, GLOW);
  cv.disc(x + Math.floor(w * 0.30), y + h - 78, 19, [250, 190, 110]);
  // missile trails: dotted arcs falling left to right
  const trails = [
    [0.02, 0.06, 0.30, 0.52, 26],
    [0.22, 0.02, 0.52, 0.60, 30],
    [0.55, 0.04, 0.80, 0.55, 24],
  ];
  for (const [x0f, y0f, x1f, y1f, n] of trails) {
    const x0 = x + x0f * w, y0 = y + y0f * h;
    const x1 = x + x1f * w, y1 = y + y1f * h;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = Math.round(x0 + (x1 - x0) * t);
      const py = Math.round(y0 + (y1 - y0) * t * t);
      cv.disc(px, py, i === n ? 5 : 2, [255, 220, 160]);
    }
    cv.disc(Math.round(x1), Math.round(y1), 7, [255, 240, 200]);
  }
  // explosion bursts
  const bursts = [
    [0.30, 0.52, 16],
    [0.52, 0.60, 20],
    [0.80, 0.55, 14],
  ];
  for (const [fx, fy, r] of bursts) {
    const cx = x + fx * w, cy = y + fy * h;
    cv.disc(cx, cy, r, GLOW);
    cv.disc(cx, cy, Math.floor(r * 0.55), [255, 214, 130]);
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2 + 0.3;
      cv.line(cx, cy, Math.round(cx + Math.cos(ang) * r * 1.9), Math.round(cy + Math.sin(ang) * r * 1.9), [255, 180, 90], 2);
    }
  }
  // skyline silhouette
  const base = y + h - 34;
  const skyline = [46, 70, 52, 88, 60, 96, 54, 74, 44, 82, 58, 68, 92, 56, 78, 50, 64, 86, 48, 72];
  const bw = w / skyline.length;
  for (let i = 0; i < skyline.length; i++) {
    const bh = skyline[i];
    cv.rect(Math.floor(x + i * bw) + 1, base - bh, Math.floor(bw) - 2, bh, [8, 13, 26]);
    // a few lit windows
    for (let wy = base - bh + 6; wy < base - 6; wy += 12)
      for (let wx = Math.floor(x + i * bw) + 5; wx < x + (i + 1) * bw - 5; wx += 10)
        if (rnd() < 0.28) cv.rect(wx, wy, 3, 4, [250, 200, 120]);
  }
  // smoke columns rising from two hits
  for (const fx of [0.30, 0.52]) {
    let sx = x + fx * w, sy = fyOf(fx, h);
    for (let s = 0; s < 7; s++) {
      cv.disc(Math.round(sx + (rnd() - 0.5) * 8), Math.round(sy), 10 + s * 2, [60, 62, 70]);
      sy -= 12; sx += 4;
    }
  }
  function fyOf(fx, h) { return y + (fx < 0.4 ? 0.52 : 0.60) * h - 14; }
  // river
  cv.rect(x, y + h - 34, w, 34, [16, 30, 52]);
  for (let i = 0; i < 60; i++) {
    const rx = x + Math.floor(rnd() * w);
    const ry = y + h - 30 + Math.floor(rnd() * 26);
    cv.rect(rx, ry, 8 + Math.floor(rnd() * 14), 2, [90, 120, 160]);
  }
  // bridge across the river, broken span near the middle
  const by = y + h - 30;
  cv.rect(x + 40, by, Math.floor(w * 0.34), 5, [20, 24, 34]);
  cv.rect(x + Math.floor(w * 0.62), by, Math.floor(w * 0.34), 5, [20, 24, 34]);
  // tilted fallen span in the gap
  cv.line(x + Math.floor(w * 0.40), by + 2, x + Math.floor(w * 0.58), by + 22, [20, 24, 34], 5);
  // bridge pillars
  for (const fx of [0.14, 0.30, 0.68, 0.86]) {
    cv.rect(x + fx * w - 3, by + 5, 6, 26, [20, 24, 34]);
  }
  // bridge lamps, dark on the broken side
  for (const fx of [0.10, 0.22, 0.34, 0.66, 0.78, 0.90]) {
    cv.rect(x + fx * w - 1, by - 8, 2, 8, [20, 24, 34]);
    cv.disc(x + fx * w, by - 9, 2, fx < 0.4 || fx > 0.62 ? [250, 220, 150] : [70, 70, 70]);
  }
}

// MARKETS: a falling chart — the AI sell-off.
function sceneMarkets(cv, x, y, w, h) {
  cv.rect(x, y, w, h, RED_LT);
  // grid
  for (let gy = y + 14; gy < y + h - 6; gy += 20) cv.line(x + 6, gy, x + w - 6, gy, [225, 185, 180], 1);
  // bars
  const bars = [62, 58, 60, 52, 54, 44, 46, 34, 36, 24];
  const bw = (w - 24) / bars.length;
  for (let i = 0; i < bars.length; i++) {
    const bh = Math.floor((bars[i] / 70) * (h - 24));
    cv.rect(x + 12 + Math.floor(i * bw), y + h - 10 - bh, Math.floor(bw) - 4, bh, i < 5 ? [120, 120, 120] : RED);
  }
  // falling line over the bars
  const pts = [];
  for (let i = 0; i < bars.length; i++) {
    pts.push([x + 12 + Math.floor(i * bw) + Math.floor(bw / 2), y + h - 12 - Math.floor((bars[i] / 70) * (h - 24)) - 6]);
  }
  for (let i = 0; i + 1 < pts.length; i++) cv.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], [90, 10, 5], 3);
  // down arrow at the end
  const ex = x + w - 26, ey = y + h - 18;
  cv.line(ex, ey - 26, ex, ey, RED, 4);
  cv.poly([[ex - 9, ey - 12], [ex + 9, ey - 12], [ex, ey + 2]], RED);
  drawText(cv, '-3.7%', x + w - 74, y + 6, 2, RED);
}

// CYCLONE: spiral over a bending palm, rain slanting.
function sceneCyclone(cv, x, y, w, h) {
  cv.rect(x, y, w, h, TEAL_LT);
  const cx = x + Math.floor(w * 0.34), cy = y + Math.floor(h * 0.52);
  // spiral arms
  for (let arm = 0; arm < 3; arm++) {
    const off = (arm / 3) * Math.PI * 2;
    for (let t = 0; t <= 30; t++) {
      const a = off + (t / 30) * Math.PI * 2.4;
      const r = 4 + (t / 30) * 34;
      cv.disc(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.82), 3, TEAL);
    }
  }
  cv.disc(cx, cy, 6, [247, 242, 231]);
  cv.ring(cx, cy, 8, 2, TEAL);
  // rain slashes
  for (let i = 0; i < 26; i++) {
    const rx = x + Math.floor(rnd() * w);
    const ry = y + Math.floor(rnd() * h);
    cv.line(rx, ry, rx - 5, ry + 9, [90, 140, 150], 2);
  }
  // bending palm at right
  const px = x + w - 46, py = y + h - 8;
  cv.line(px, py, px + 12, py - 44, [101, 67, 33], 4);
  for (let f = 0; f < 5; f++) {
    const a = -0.4 - f * 0.35;
    const fx = px + 12, fyy = py - 44;
    cv.line(fx, fyy, Math.round(fx + Math.cos(a) * 30), Math.round(fyy + Math.sin(a) * 14), [24, 110, 70], 3);
  }
  // waves
  for (let wx = x + 8; wx < x + w - 8; wx += 26) {
    cv.line(wx, y + h - 12, wx + 12, y + h - 12, TEAL, 2);
    cv.line(wx + 4, y + h - 6, wx + 16, y + h - 6, TEAL, 2);
  }
}

// QUAKE: Andes ridge, a seismograph zigzag, cracks in the ground.
function sceneQuake(cv, x, y, w, h) {
  cv.rect(x, y, w, h, OCHRE_LT);
  // far ridge
  cv.poly([[x, y + h - 30], [x + w * 0.16, y + 26], [x + w * 0.30, y + h - 30]], [170, 140, 105]);
  // near ridge with snow cap
  cv.poly([[x + w * 0.22, y + h - 26], [x + w * 0.52, y + 8], [x + w * 0.82, y + h - 26]], OCHRE);
  cv.poly([[x + w * 0.46, y + 20], [x + w * 0.52, y + 8], [x + w * 0.58, y + 20]], [247, 242, 231]);
  cv.poly([[x + w * 0.62, y + h - 26], [x + w * 0.86, y + 34], [x + w, y + h - 26]], [120, 84, 50]);
  // ground
  cv.rect(x, y + h - 26, w, 26, [96, 68, 44]);
  // cracks
  cv.line(x + Math.floor(w * 0.30), y + h - 26, x + Math.floor(w * 0.26), y + h - 4, [40, 26, 16], 2);
  cv.line(x + Math.floor(w * 0.26), y + h - 12, x + Math.floor(w * 0.33), y + h - 8, [40, 26, 16], 2);
  cv.line(x + Math.floor(w * 0.62), y + h - 26, x + Math.floor(w * 0.66), y + h - 6, [40, 26, 16], 2);
  // seismograph zigzag across the sky
  let zx = x + 10, zy = y + 22;
  const zpts = [[zx, zy]];
  const steps = [0, -12, 14, -22, 26, -18, 10, -6, 12, -26, 20, -8, 0];
  for (const s of steps) {
    zx += Math.floor((w - 80) / steps.length);
    zy = y + 26 + s;
    zpts.push([zx, zy]);
  }
  for (let i = 0; i + 1 < zpts.length; i++) cv.line(zpts[i][0], zpts[i][1], zpts[i + 1][0], zpts[i + 1][1], INK, 2);
  // falling rocks
  for (const [fx, fy] of [[0.72, 0.62], [0.78, 0.72], [0.68, 0.78]]) {
    cv.disc(x + fx * w, y + fy * h, 3, [70, 52, 36]);
  }
  drawText(cv, '6.7', x + w - 52, y + 6, 2, INK);
}

// COURT: courthouse facade with columns, scales of justice above.
function sceneCourt(cv, x, y, w, h) {
  cv.rect(x, y, w, h, PLUM_LT);
  const cx = x + Math.floor(w / 2);
  // pediment
  cv.poly([[cx - 78, y + 34], [cx + 78, y + 34], [cx, y + 8]], PLUM);
  // scales emblem in the pediment
  cv.line(cx, y + 13, cx, y + 29, GOLD, 2);
  cv.line(cx - 9, y + 17, cx + 9, y + 17, GOLD, 2);
  cv.poly([[cx - 12, y + 17], [cx - 6, y + 17], [cx - 9, y + 23]], GOLD);
  cv.poly([[cx + 6, y + 17], [cx + 12, y + 17], [cx + 9, y + 23]], GOLD);
  cv.rect(cx - 6, y + 29, 12, 2, GOLD);
  // columns
  for (const ox of [-58, -20, 20, 58]) {
    cv.rect(cx + ox - 6, y + 38, 12, 40, [247, 242, 231]);
    cv.rect(cx + ox - 8, y + 36, 16, 4, [247, 242, 231]);
    cv.rect(cx + ox - 8, y + 76, 16, 4, [247, 242, 231]);
  }
  // steps and door
  cv.rect(cx - 84, y + 80, 168, 4, PLUM);
  cv.rect(cx - 92, y + 84, 184, 4, [70, 46, 110]);
  cv.rect(cx - 10, y + 58, 20, 22, [50, 34, 80]);
}

// --- front page -------------------------------------------------------------
function panelFrame(cv, x, y, w, h) {
  cv.rect(x, y, w, 2, RULE);
  cv.rect(x, y + h - 2, w, 2, RULE);
  cv.rect(x, y, 2, h, RULE);
  cv.rect(x + w - 2, y, 2, h, RULE);
}

function storyPanel(cv, x, y, w, h, scene, kicker, headline, captions, accent) {
  panelFrame(cv, x, y, w, h);
  scene(cv, x + 2, y + 2, w - 4, 88);
  cv.rect(x + 2, y + 90, w - 4, 2, RULE);
  drawText(cv, kicker, x + 14, y + 98, 2, accent);
  drawText(cv, headline, x + 14, y + 116, 3, INK);
  drawLines(cv, captions, x + 14, y + 144, 2, [60, 60, 60], 17);
}

function drawPage() {
  const cv = new Canvas(W, H, PAPER);

  // --- masthead ---
  cv.rect(8, 10, 1008, 3, RULE);
  drawText(cv, "THE DAY'S NEWS", 512, 20, 8, INK, 'center');
  cv.rect(8, 82, 1008, 2, RULE);
  drawText(cv, 'VOL. I - NO. 20', 16, 90, 2, [90, 90, 90]);
  drawText(cv, 'FRIDAY, 20 NOVEMBER 2026', 512, 88, 3, INK, 'center');
  drawText(cv, 'ONE DAY, ONE PAGE', 1008, 90, 2, [90, 90, 90], 'right');
  cv.rect(8, 112, 1008, 5, RULE);

  // --- lead: Kyiv ---
  const LX = 8, LY = 124, LW = 1008, LH = 396;
  panelFrame(cv, LX, LY, LW, LH);
  sceneKyiv(cv, LX + 2, LY + 2, LW - 4, 268);
  cv.rect(LX + 2, LY + 270, LW - 4, 2, RULE);
  drawText(cv, 'OVERNIGHT - KYIV, UKRAINE', LX + 14, LY + 280, 2, RED);
  drawText(cv, 'A NIGHT OF FIRE OVER KYIV', LX + 14, LY + 298, 5, INK);
  drawLines(cv, [
    '400+ DRONES, 110 MISSILES; 3 KYIV BRIDGES SHUT,',
    'POWER CUT ACROSS UKRAINE; 2 FALL IN POLAND.',
  ], LX + 14, LY + 342, 2, [60, 60, 60], 18);

  // --- four stories, one day unfolding ---
  const GY = 530, GH = 190, GW = 498, GX2 = 518;
  storyPanel(cv, 8, GY, GW, GH, sceneMarkets,
    'NEW YORK - MARKETS', 'AI ROUT HITS WALL STREET',
    ['S&P -3.7% AND DOW IN CORRECTION;', 'NASDAQ -5.3%, DOWN FOR THE YEAR.'], RED);
  storyPanel(cv, GX2, GY, GW, GH, sceneCyclone,
    'MORNING - ODISHA, INDIA', 'CYCLONE AKVAN COMES ASHORE',
    ['WINDS 80 KM/H, 300,000 EVACUATED;', 'HEAVY RAIN, NO DEATHS REPORTED.'], TEAL);
  storyPanel(cv, 8, GY + 200, GW, GH, sceneQuake,
    'EVENING - JUNIN, PERU', '6.7 QUAKE SHAKES THE ANDES',
    ['EPICENTRE NEAR JUNIN; FELT IN LIMA.', 'NO DEATHS REPORTED AT FIRST.'], OCHRE);
  storyPanel(cv, GX2, GY + 200, GW, GH, sceneCourt,
    'THE HAGUE - WORLD COURT', 'MYANMAR REJECTS VERDICT',
    ['A DAY AFTER THE GENOCIDE RULING,', 'THE REGIME CALLS IT UNFAIR.'], PLUM);

  // --- also today ---
  const SX = 8, SY = 930, SW = 1008, SH = 86;
  cv.rect(SX, SY, SW, SH, INK);
  drawText(cv, 'ALSO TODAY', 512, SY + 10, 2, GOLD, 'center');
  drawLines(cv, [
    'UKRAINE RETAKES 14 VILLAGES IN KHARKIV / HUNGARY LIFTS EU VETO',
    "TRUMP CALLS PUTIN 'TIRED' AFTER SUMMIT / COP31 TALKS STALL",
  ], 512, SY + 30, 2, [247, 242, 231], 19, 'center');

  return cv;
}

function main() {
  const cv = drawPage();
  const png = encodePNG(cv.px, W, H);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'entry.png');
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
}

main();
