// ============================================================================
// The film department: full-frame (640x360) procedural cutscene posters.
// Chunky retro-poster style: 2-4px outlines, bold readable shapes, sight gags.
// Deterministic — no Math.random; all motion derives from `frame`.
// Exhaustive over CutsceneArtId; unknown ids THROW.
// ============================================================================

import type { CutsceneArtId } from '../core/types.ts';
import { VIEW_W, VIEW_H } from '../core/constants.ts';
import { createRng } from '../core/rng.ts';

type Ctx = CanvasRenderingContext2D;

/** Poster ink (outline) color. */
const INK = '#1b1030';
const LW = 3;

// --- palette -----------------------------------------------------------------
const P = {
  skin: '#f2c090',
  orange: '#f5942e',      // Impeach complexion
  orangeDark: '#d97a1a',
  wig: '#ffd94d',
  estradaRed: '#d8302f',
  estradaBlue: '#2b4fa8',
  glove: '#f4f0e6',
  shoe: '#6b3d1e',
  mangGreen: '#2f9e44',
  mangDark: '#1f6f30',
  peachPink: '#f7a8c8',
  peachDark: '#d1618f',
  hairGold: '#f7c948',
  toadWhite: '#f5efe0',
  toadRed: '#e04848',
  toadSkin: '#f0c9a0',
  shellY: '#e8d532',
  shellG: '#3a9a3a',
  turtSkin: '#8fca5c',
  beret: '#20222c',
} as const;

const COIN = '#f6c94b';
const COIN_DARK = '#c9962a';

// --- primitives --------------------------------------------------------------
function rect(c: Ctx, x: number, y: number, w: number, h: number, fill: string, lw = LW): void {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
  if (lw > 0) { c.lineWidth = lw; c.strokeStyle = INK; c.strokeRect(x, y, w, h); }
}
function flat(c: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
}
function disc(c: Ctx, x: number, y: number, r: number, fill: string, lw = LW): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  if (lw > 0) { c.lineWidth = lw; c.strokeStyle = INK; c.stroke(); }
}
function ell(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string, lw = LW): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  if (lw > 0) { c.lineWidth = lw; c.strokeStyle = INK; c.stroke(); }
}
function poly(c: Ctx, pts: readonly (readonly [number, number])[], fill: string, lw = LW): void {
  const p0 = pts[0];
  if (!p0) return;
  c.beginPath();
  c.moveTo(p0[0], p0[1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    c.lineTo(p[0], p[1]);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (lw > 0) { c.lineWidth = lw; c.strokeStyle = INK; c.stroke(); }
}
function seg(c: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, lw: number): void {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.strokeStyle = color;
  c.lineWidth = lw;
  c.stroke();
}
function txt(
  c: Ctx, s: string, x: number, y: number, px: number, fill: string,
  align: CanvasTextAlign = 'center', outline = true,
): void {
  c.font = `bold ${px}px monospace`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  if (outline) {
    c.lineWidth = Math.max(2, Math.floor(px / 5));
    c.strokeStyle = INK;
    c.strokeText(s, x, y);
  }
  c.fillStyle = fill;
  c.fillText(s, x, y);
}

// --- shared props ------------------------------------------------------------
function coin(c: Ctx, x: number, y: number, r: number): void {
  disc(c, x, y, r, COIN, 2);
  c.beginPath();
  c.arc(x, y, r * 0.55, 0, Math.PI * 2);
  c.strokeStyle = COIN_DARK;
  c.lineWidth = 2;
  c.stroke();
}
function coffeeCup(c: Ctx, x: number, y: number, s: number, frame: number): void {
  rect(c, x - 7 * s, y - 10 * s, 14 * s, 10 * s, '#f4f0e6', 2);
  c.beginPath();
  c.arc(x + 8 * s, y - 5 * s, 4 * s, -Math.PI / 2, Math.PI / 2);
  c.strokeStyle = INK;
  c.lineWidth = 2;
  c.stroke();
  steam(c, x, y - 12 * s, s, frame, 0);
}
function steam(c: Ctx, x: number, y: number, s: number, frame: number, phase: number): void {
  c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.lineWidth = 2;
  for (let i = 0; i < 2; i++) {
    const t = frame * 0.05 + phase + i * 2.1;
    c.beginPath();
    for (let k = 0; k <= 4; k++) {
      const yy = y - k * 5 * s;
      const xx = x + (i - 0.5) * 6 * s + Math.sin(t + k * 0.9) * 3 * s;
      if (k === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy);
    }
    c.stroke();
  }
}
function sparkle(c: Ctx, x: number, y: number, r: number, frame: number, phase: number): void {
  const a = 0.5 + 0.5 * Math.sin(frame * 0.12 + phase);
  const rr = r * (0.6 + 0.4 * a);
  c.fillStyle = `rgba(255,245,180,${(0.35 + 0.6 * a).toFixed(2)})`;
  c.beginPath();
  c.moveTo(x, y - rr);
  c.lineTo(x + rr * 0.3, y - rr * 0.3);
  c.lineTo(x + rr, y);
  c.lineTo(x + rr * 0.3, y + rr * 0.3);
  c.lineTo(x, y + rr);
  c.lineTo(x - rr * 0.3, y + rr * 0.3);
  c.lineTo(x - rr, y);
  c.lineTo(x - rr * 0.3, y - rr * 0.3);
  c.closePath();
  c.fill();
}
function rat(c: Ctx, x: number, y: number, s: number, frame: number, phase: number, cheer = false): void {
  const wig = Math.sin(frame * 0.15 + phase);
  ell(c, x, y - 5 * s, 9 * s, 5 * s, '#8a8494', 2);           // body
  disc(c, x + 8 * s, y - 7 * s, 4.5 * s, '#8a8494', 2);        // head
  disc(c, x + 7 * s, y - 11 * s, 2 * s, '#b7aec2', 2);         // ear
  disc(c, x + 10.5 * s, y - 7.5 * s, 0.9 * s, INK, 0);         // eye
  c.beginPath();                                               // tail
  c.moveTo(x - 8 * s, y - 4 * s);
  c.quadraticCurveTo(x - 15 * s, y - 4 * s - wig * 4 * s, x - 18 * s, y - 9 * s + wig * 3 * s);
  c.strokeStyle = '#b7aec2';
  c.lineWidth = 2;
  c.stroke();
  if (cheer) {
    // little paws up, clapping
    const cl = Math.abs(Math.sin(frame * 0.25 + phase));
    disc(c, x + 4 * s - cl * 2, y - 12 * s, 1.6 * s, '#b7aec2', 1);
    disc(c, x + 9 * s + cl * 2, y - 12 * s, 1.6 * s, '#b7aec2', 1);
  }
}
function sweatDrop(c: Ctx, x: number, y: number, s: number, frame: number): void {
  const t = (frame % 90) / 90;
  const yy = y + t * 10 * s;
  poly(c, [[x, yy - 6 * s], [x + 4 * s, yy + 2 * s], [x, yy + 5 * s], [x - 4 * s, yy + 2 * s]], '#9ed8f7', 2);
}
function speechSpikes(c: Ctx, x: number, y: number, n: number, frame: number): void {
  // little agitation marks around a shouting mouth
  c.strokeStyle = INK;
  c.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const a = -0.6 + i * (1.2 / Math.max(1, n - 1)) + Math.sin(frame * 0.2) * 0.05;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
    c.lineTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16);
    c.stroke();
  }
}

// --- backgrounds -------------------------------------------------------------
function vgrad(c: Ctx, c0: string, c1: string): void {
  const g = c.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  c.fillStyle = g;
  c.fillRect(0, 0, VIEW_W, VIEW_H);
}
function floorBand(c: Ctx, y: number, fill: string): void {
  c.fillStyle = fill;
  c.fillRect(0, y, VIEW_W, VIEW_H - y);
  seg(c, 0, y, VIEW_W, y, INK, LW);
}
function brickWall(c: Ctx, y0: number, y1: number, fill: string, mortar: string): void {
  c.fillStyle = fill;
  c.fillRect(0, y0, VIEW_W, y1 - y0);
  c.strokeStyle = mortar;
  c.lineWidth = 2;
  for (let y = y0; y < y1; y += 24) {
    seg(c, 0, y, VIEW_W, y, mortar, 2);
    const off = ((y - y0) / 24) % 2 === 0 ? 0 : 24;
    for (let x = off; x < VIEW_W; x += 48) seg(c, x, y, x, Math.min(y + 24, y1), mortar, 2);
  }
}
function spotlight(c: Ctx, x: number, topW: number, botW: number, alpha: number): void {
  c.fillStyle = `rgba(255,244,190,${alpha})`;
  c.beginPath();
  c.moveTo(x - topW / 2, 0);
  c.lineTo(x + topW / 2, 0);
  c.lineTo(x + botW / 2, VIEW_H);
  c.lineTo(x - botW / 2, VIEW_H);
  c.closePath();
  c.fill();
}

// ============================================================================
// CAST — consistent across scenes. All draw with feet at (x,y), height ~96*s.
// ============================================================================

export interface EstradaOpts {
  facing?: 1 | -1;
  eyes?: 'smug' | 'wink' | 'wide' | 'closed';
  mouth?: 'grin' | 'flat' | 'open' | 'nervous';
  arms?: 'down' | 'raised' | 'shrug' | 'stamp' | 'recline';
  item?: 'none' | 'stamp' | 'bag';
  masked?: boolean;
  sweatFrame?: number;   // if >= 0, one big animated sweat drop
}

export function drawEstrada(c: Ctx, x: number, y: number, s: number, o: EstradaOpts = {}): void {
  const f = o.facing ?? 1;
  const eyes = o.eyes ?? 'smug';
  const mouth = o.mouth ?? 'grin';
  const arms = o.arms ?? 'down';
  const hy = y - 74 * s; // head center
  // legs + shoes
  rect(c, x - 13 * s, y - 34 * s, 26 * s, 28 * s, P.estradaBlue);
  ell(c, x - 9 * s + f * 2 * s, y - 3 * s, 9 * s, 4.5 * s, P.shoe, 2);
  ell(c, x + 9 * s + f * 2 * s, y - 3 * s, 9 * s, 4.5 * s, P.shoe, 2);
  // torso: red shirt, blue bib
  rect(c, x - 15 * s, y - 58 * s, 30 * s, 26 * s, P.estradaRed);
  rect(c, x - 10 * s, y - 50 * s, 20 * s, 18 * s, P.estradaBlue, 2);
  disc(c, x - 6 * s, y - 46 * s, 2 * s, COIN, 1);
  disc(c, x + 6 * s, y - 46 * s, 2 * s, COIN, 1);
  // arms
  const shY = y - 54 * s;
  if (arms === 'down') {
    rect(c, x - 20 * s, shY, 6 * s, 22 * s, P.estradaRed, 2);
    rect(c, x + 14 * s, shY, 6 * s, 22 * s, P.estradaRed, 2);
    disc(c, x - 17 * s, shY + 25 * s, 5 * s, P.glove, 2);
    disc(c, x + 17 * s, shY + 25 * s, 5 * s, P.glove, 2);
  } else if (arms === 'raised') {
    rect(c, x - f * 20 * s, shY, 6 * s, 20 * s, P.estradaRed, 2);
    disc(c, x - f * 17 * s, shY + 23 * s, 5 * s, P.glove, 2);
    poly(c, [[x + f * 12 * s, shY + 6 * s], [x + f * 20 * s, shY - 24 * s],
      [x + f * 26 * s, shY - 22 * s], [x + f * 18 * s, shY + 8 * s]], P.estradaRed, 2);
    disc(c, x + f * 23 * s, shY - 26 * s, 6 * s, P.glove, 2); // fist up
  } else if (arms === 'shrug') {
    poly(c, [[x - 14 * s, shY + 6 * s], [x - 28 * s, shY - 6 * s], [x - 30 * s, shY], [x - 15 * s, shY + 11 * s]], P.estradaRed, 2);
    poly(c, [[x + 14 * s, shY + 6 * s], [x + 28 * s, shY - 6 * s], [x + 30 * s, shY], [x + 15 * s, shY + 11 * s]], P.estradaRed, 2);
    ell(c, x - 30 * s, shY - 6 * s, 5.5 * s, 4.5 * s, P.glove, 2); // palms up
    ell(c, x + 30 * s, shY - 6 * s, 5.5 * s, 4.5 * s, P.glove, 2);
  } else if (arms === 'stamp') {
    rect(c, x - f * 20 * s, shY, 6 * s, 22 * s, P.estradaRed, 2);
    disc(c, x - f * 17 * s, shY + 25 * s, 5 * s, P.glove, 2);
    poly(c, [[x + f * 12 * s, shY + 4 * s], [x + f * 26 * s, shY - 10 * s],
      [x + f * 31 * s, shY - 5 * s], [x + f * 17 * s, shY + 9 * s]], P.estradaRed, 2);
    disc(c, x + f * 29 * s, shY - 9 * s, 5.5 * s, P.glove, 2);
  } else { // recline: arms relaxed out (deck chair)
    rect(c, x - 22 * s, shY + 4 * s, 10 * s, 6 * s, P.estradaRed, 2);
    rect(c, x + 12 * s, shY + 4 * s, 10 * s, 6 * s, P.estradaRed, 2);
  }
  // head
  disc(c, x, hy, 17 * s, P.skin);
  ell(c, x + f * 10 * s, hy + 3 * s, 6 * s, 4.5 * s, P.skin, 2); // big nose
  // pencil moustache: THE thin line
  seg(c, x + f * 2 * s, hy + 8 * s, x + f * 15 * s, hy + 7 * s, INK, 2);
  // eyes: smug half-lids by default
  const exL = x + f * 2 * s, exR = x + f * 10 * s, ey = hy - 3 * s;
  if (o.masked) ell(c, x + f * 6 * s, ey, 14 * s, 7 * s, '#2c2c3e', 2); // domino mask
  const eyeOne = (ex: number, open: boolean): void => {
    if (!open) { seg(c, ex - 3 * s, ey, ex + 3 * s, ey, INK, 2); return; }
    ell(c, ex, ey, 3.5 * s, eyes === 'wide' ? 4.5 * s : 3.5 * s, '#fff', 2);
    disc(c, ex + f * 1.2 * s, ey + 0.8 * s, 1.5 * s, INK, 0);
    if (eyes === 'smug') flat(c, ex - 4 * s, ey - 5 * s, 8 * s, 4.5 * s, o.masked ? '#2c2c3e' : P.skin);
    if (eyes === 'smug') seg(c, ex - 3.5 * s, ey - 1 * s, ex + 3.5 * s, ey - 1 * s, INK, 2);
  };
  eyeOne(exL, !(eyes === 'closed'));
  eyeOne(exR, !(eyes === 'closed' || eyes === 'wink'));
  // mouth
  const my = hy + 12 * s;
  if (mouth === 'grin') {
    c.beginPath(); c.arc(x + f * 5 * s, my - 2 * s, 6 * s, 0.15 * Math.PI, 0.85 * Math.PI);
    c.strokeStyle = INK; c.lineWidth = 2.5; c.stroke();
  } else if (mouth === 'open') {
    ell(c, x + f * 5 * s, my, 5 * s, 6 * s, '#7c2230', 2);
  } else if (mouth === 'nervous') {
    c.beginPath(); c.moveTo(x + f * 0 * s, my);
    for (let i = 0; i <= 6; i++) c.lineTo(x + f * (i * 2) * s, my + (i % 2 === 0 ? 0 : 2 * s));
    c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
  } else {
    seg(c, x + f * 1 * s, my, x + f * 10 * s, my, INK, 2.5);
  }
  // red cap with white 'E' badge + brim
  c.beginPath(); c.arc(x, hy - 4 * s, 17 * s, Math.PI, 0); c.closePath();
  c.fillStyle = P.estradaRed; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
  rect(c, x + f * 8 * s, hy - 8 * s, f * 16 * s < 0 ? -16 * s : 16 * s, 5 * s, P.estradaRed, 2);
  disc(c, x, hy - 12 * s, 7 * s, '#fff', 2);
  txt(c, 'E', x, hy - 11.4 * s, Math.max(8, 10 * s), P.estradaRed, 'center', false);
  // held item
  if (o.item === 'stamp') {
    const hx = arms === 'stamp' ? x + f * 29 * s : x + f * 17 * s;
    const hyy = arms === 'stamp' ? shY - 14 * s : shY + 18 * s;
    rect(c, hx - 3 * s, hyy - 10 * s, 6 * s, 8 * s, '#8a5a2b', 2);   // handle
    rect(c, hx - 8 * s, hyy - 3 * s, 16 * s, 5 * s, '#3a3a4c', 2);   // base
  } else if (o.item === 'bag') {
    ell(c, x + f * 26 * s, y - 14 * s, 14 * s, 16 * s, '#c9962a');
    poly(c, [[x + f * 20 * s, y - 28 * s], [x + f * 32 * s, y - 28 * s], [x + f * 26 * s, y - 36 * s]], '#c9962a', 2);
    txt(c, '$', x + f * 26 * s, y - 13 * s, Math.max(8, 12 * s), INK, 'center', false);
  }
  if (o.sweatFrame !== undefined && o.sweatFrame >= 0) sweatDrop(c, x - f * 16 * s, hy - 10 * s, s * 1.2, o.sweatFrame);
}

export interface ImpeachOpts {
  facing?: 1 | -1;
  hands?: 'wave' | 'coffee-wave' | 'phone' | 'chalk' | 'down';
  handScale?: number;    // 1 = merely huge. >1 = colossal.
  waveT?: number;        // animation clock for the wave
  mouth?: 'smug' | 'open' | 'pout';
  wigOn?: boolean;       // false = the reveal
}

/** One HUGE hand, palm out, fingers up. cx,cy = palm center, r = palm radius. */
export function bigHand(c: Ctx, cx: number, cy: number, r: number, tilt: number): void {
  c.save();
  c.translate(cx, cy);
  c.rotate(tilt);
  ell(c, 0, 0, r, r * 1.1, P.orange);
  for (let i = 0; i < 4; i++) {
    const fx = -r * 0.72 + i * (r * 0.48);
    ell(c, fx, -r * 0.95, r * 0.22, r * 0.55, P.orange, 2.5);
  }
  ell(c, -r * 0.95, r * 0.25, r * 0.5, r * 0.24, P.orange, 2.5); // thumb
  c.restore();
}

export function drawImpeach(c: Ctx, x: number, y: number, s: number, o: ImpeachOpts = {}): void {
  const f = o.facing ?? 1;
  const hs = (o.handScale ?? 1) * 14 * s;   // palm radius — the running gag
  const wt = o.waveT ?? 0;
  const hands = o.hands ?? 'wave';
  const mouth = o.mouth ?? 'smug';
  const hy = y - 78 * s;
  // gown: big pink bell
  poly(c, [[x - 12 * s, y - 58 * s], [x + 12 * s, y - 58 * s], [x + 30 * s, y], [x - 30 * s, y]], P.peachPink);
  seg(c, x - 24 * s, y - 14 * s, x + 24 * s, y - 14 * s, P.peachDark, 3);
  // bodice + puff sleeves
  rect(c, x - 11 * s, y - 66 * s, 22 * s, 12 * s, P.peachPink, 2.5);
  disc(c, x - 14 * s, y - 62 * s, 7 * s, P.peachDark, 2);
  disc(c, x + 14 * s, y - 62 * s, 7 * s, P.peachDark, 2);
  // head: orange, jowly
  ell(c, x, hy, 15 * s, 14 * s, P.orange);
  // 5 o'clock shadow
  c.fillStyle = 'rgba(90,60,40,0.28)';
  c.beginPath(); c.ellipse(x, hy + 7 * s, 11 * s, 6 * s, 0, 0, Math.PI); c.fill();
  // pout / mouth
  if (mouth === 'open') ell(c, x + f * 3 * s, hy + 7 * s, 5 * s, 4 * s, '#7c2230', 2);
  else if (mouth === 'pout') ell(c, x + f * 3 * s, hy + 7 * s, 4 * s, 2.5 * s, P.orangeDark, 2);
  else { c.beginPath(); c.arc(x + f * 3 * s, hy + 6 * s, 4.5 * s, 0.2 * Math.PI, 0.8 * Math.PI); c.strokeStyle = INK; c.lineWidth = 2.5; c.stroke(); }
  // tiny squinty eyes
  seg(c, x - 6 * s, hy - 3 * s, x - 1 * s, hy - 3.6 * s, INK, 2.5);
  seg(c, x + f * 2 * s + 2 * s, hy - 3.6 * s, x + f * 2 * s + 7 * s, hy - 3 * s, INK, 2.5);
  if (o.wigOn !== false) {
    // yellow swoop wig
    c.beginPath(); c.arc(x, hy - 5 * s, 15.5 * s, Math.PI * 0.95, Math.PI * 2.02); c.closePath();
    c.fillStyle = P.wig; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
    poly(c, [[x + f * 12 * s, hy - 10 * s], [x + f * 24 * s, hy - 14 * s], [x + f * 22 * s, hy - 6 * s], [x + f * 12 * s, hy - 4 * s]], P.wig, 2.5);
    seg(c, x - f * 10 * s, hy - 12 * s, x + f * 8 * s, hy - 15 * s, '#d9ab1f', 2);
  } else {
    // the reveal: sad orange combover wisps
    c.strokeStyle = P.wig; c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(x - 8 * s + i * 6 * s, hy - 13 * s);
      c.quadraticCurveTo(x - 4 * s + i * 6 * s, hy - 19 * s, x + i * 6 * s, hy - 14 * s);
      c.stroke();
    }
  }
  // tiny crown (comically small)
  poly(c, [[x - 5 * s, hy - 19 * s], [x + 5 * s, hy - 19 * s], [x + 5 * s, hy - 24 * s],
    [x + 2.5 * s, hy - 21.5 * s], [x, hy - 25 * s], [x - 2.5 * s, hy - 21.5 * s], [x - 5 * s, hy - 24 * s]], COIN, 2);
  // THE HANDS. Enormous. Always.
  if (hands === 'wave') {
    const a = Math.sin(wt * 0.12) * 0.35;
    bigHand(c, x + f * 34 * s, y - 74 * s + Math.sin(wt * 0.12) * 4 * s, hs, f * (0.3 + a));
    bigHand(c, x - f * 30 * s, y - 34 * s, hs * 0.9, -f * 0.5);
  } else if (hands === 'coffee-wave') {
    const a = Math.sin(wt * 0.12) * 0.35;
    bigHand(c, x + f * 34 * s, y - 74 * s + Math.sin(wt * 0.12) * 4 * s, hs, f * (0.3 + a));
    bigHand(c, x - f * 26 * s, y - 40 * s, hs * 0.9, -f * 1.2);
    coffeeCup(c, x - f * 26 * s, y - 52 * s, s, wt);
  } else if (hands === 'phone') {
    bigHand(c, x + f * 26 * s, y - 46 * s, hs, f * 1.35);
    rect(c, x + f * 20 * s, y - 66 * s, 12 * s, 20 * s, '#20222c', 2);
    flat(c, x + f * 22 * s, y - 64 * s, 8 * s, 14 * s, '#8fd8ff');
    bigHand(c, x - f * 28 * s, y - 34 * s, hs * 0.85, -f * 0.5);
  } else if (hands === 'chalk') {
    bigHand(c, x + f * 32 * s, y - 66 * s, hs, f * 0.4);
    seg(c, x + f * 32 * s, y - 78 * s, x + f * 36 * s, y - 86 * s, '#fff', 4);
    bigHand(c, x - f * 28 * s, y - 34 * s, hs * 0.85, -f * 0.5);
  } else {
    bigHand(c, x - f * 30 * s, y - 32 * s, hs * 0.95, -f * 0.4);
    bigHand(c, x + f * 30 * s, y - 32 * s, hs * 0.95, f * 0.4);
  }
}

export interface BowsonaroOpts {
  facing?: 1 | -1;
  pose?: 'stand' | 'carry' | 'rant' | 'struggle';
  mouth?: 'flat' | 'open';
  shellOn?: boolean;
}

export function drawBowsonaro(c: Ctx, x: number, y: number, s: number, o: BowsonaroOpts = {}): void {
  const f = o.facing ?? 1;
  const pose = o.pose ?? 'stand';
  const hy = y - 62 * s;
  // legs
  rect(c, x - 14 * s, y - 18 * s, 10 * s, 16 * s, P.turtSkin, 2.5);
  rect(c, x + 4 * s, y - 18 * s, 10 * s, 16 * s, P.turtSkin, 2.5);
  ell(c, x - 9 * s, y - 2 * s, 8 * s, 4 * s, P.mangDark, 2);
  ell(c, x + 9 * s, y - 2 * s, 8 * s, 4 * s, P.mangDark, 2);
  // shell: dome painted like a yellow-green soccer jersey, spiked
  if (o.shellOn !== false) {
    c.beginPath(); c.arc(x, y - 30 * s, 26 * s, Math.PI, 0); c.closePath();
    c.fillStyle = P.shellY; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
    c.save(); c.beginPath(); c.arc(x, y - 30 * s, 26 * s, Math.PI, 0); c.closePath(); c.clip();
    c.fillStyle = P.shellG;
    flat(c, x - 26 * s, y - 46 * s, 52 * s, 7 * s, P.shellG);
    flat(c, x - 26 * s, y - 36 * s, 52 * s, 7 * s, P.shellG);
    c.restore();
    for (let i = -1; i <= 1; i++) {
      poly(c, [[x + i * 16 * s - 4 * s, y - 48 * s], [x + i * 16 * s + 4 * s, y - 48 * s], [x + i * 16 * s, y - 58 * s]], '#d9d4c4', 2);
    }
  } else {
    rect(c, x - 16 * s, y - 48 * s, 32 * s, 32 * s, P.turtSkin, 2.5); // shell-less torso
  }
  // arms
  if (pose === 'carry') {
    poly(c, [[x - f * 6 * s, y - 44 * s], [x - f * 2 * s, y - 66 * s], [x + f * 6 * s, y - 64 * s], [x + f * 2 * s, y - 44 * s]], P.turtSkin, 2.5);
    poly(c, [[x + f * 12 * s, y - 42 * s], [x + f * 24 * s, y - 60 * s], [x + f * 30 * s, y - 55 * s], [x + f * 18 * s, y - 38 * s]], P.turtSkin, 2.5);
  } else if (pose === 'rant') {
    poly(c, [[x + f * 14 * s, y - 40 * s], [x + f * 30 * s, y - 62 * s], [x + f * 36 * s, y - 57 * s], [x + f * 20 * s, y - 36 * s]], P.turtSkin, 2.5);
    disc(c, x + f * 33 * s, y - 62 * s, 5 * s, P.turtSkin, 2); // fist
  } else if (pose === 'struggle') {
    // both arms tangled up behind, tugging straps
    poly(c, [[x - 10 * s, y - 40 * s], [x - 26 * s, y - 54 * s], [x - 20 * s, y - 60 * s], [x - 6 * s, y - 46 * s]], P.turtSkin, 2.5);
    poly(c, [[x + 10 * s, y - 40 * s], [x + 26 * s, y - 50 * s], [x + 22 * s, y - 58 * s], [x + 6 * s, y - 46 * s]], P.turtSkin, 2.5);
  } else {
    rect(c, x - f * 24 * s, y - 42 * s, 8 * s, 18 * s, P.turtSkin, 2.5);
  }
  // head: turtle snout, aviators, beret
  ell(c, x + f * 6 * s, hy, 13 * s, 11 * s, P.turtSkin);
  ell(c, x + f * 15 * s, hy + 3 * s, 6 * s, 4 * s, '#b9e08e', 2); // snout
  if (o.mouth === 'open') ell(c, x + f * 13 * s, hy + 7 * s, 5 * s, 4.5 * s, '#5c1f2c', 2);
  else seg(c, x + f * 8 * s, hy + 7 * s, x + f * 18 * s, hy + 8 * s, INK, 2.5);
  // aviator sunglasses: two teardrop lenses + bar
  ell(c, x + f * 2 * s, hy - 2 * s, 5 * s, 4.5 * s, '#3d3f52', 2);
  ell(c, x + f * 12 * s, hy - 2 * s, 5 * s, 4.5 * s, '#3d3f52', 2);
  seg(c, x + f * 6 * s, hy - 3 * s, x + f * 8 * s, hy - 3 * s, INK, 2);
  seg(c, x + f * 0 * s - 4 * s, hy - 4 * s, x + f * 1 * s, hy - 5 * s, INK, 2);
  // beret, tilted
  c.save();
  c.translate(x + f * 4 * s, hy - 9 * s);
  c.rotate(-f * 0.18);
  ell(c, 0, 0, 12 * s, 5 * s, P.beret, 2.5);
  disc(c, 0, -4 * s, 1.6 * s, P.beret, 1);
  c.restore();
}

export interface MangianiOpts {
  facing?: 1 | -1;
  eyes?: 'honest' | 'squint' | 'narrow';
  brows?: 'worried' | 'determined' | 'raised';
  pose?: 'stand' | 'point' | 'run' | 'offer' | 'measure' | 'magnify' | 'fist';
  backpack?: boolean;
}

export function drawMangiani(c: Ctx, x: number, y: number, s: number, o: MangianiOpts = {}): void {
  const f = o.facing ?? 1;
  const eyes = o.eyes ?? 'honest';
  const brows = o.brows ?? 'worried';
  const pose = o.pose ?? 'stand';
  const hy = y - 92 * s; // taller than Estrada
  // legs: long and thin
  if (pose === 'run') {
    poly(c, [[x - 4 * s, y - 40 * s], [x - 26 * s, y - 10 * s], [x - 20 * s, y - 4 * s], [x + 2 * s, y - 36 * s]], P.estradaBlue, 2.5);
    poly(c, [[x + 2 * s, y - 40 * s], [x + 24 * s, y - 16 * s], [x + 18 * s, y - 8 * s], [x - 2 * s, y - 36 * s]], P.estradaBlue, 2.5);
    ell(c, x - 25 * s, y - 5 * s, 8 * s, 4 * s, P.shoe, 2);
    ell(c, x + 24 * s, y - 10 * s, 8 * s, 4 * s, P.shoe, 2);
  } else {
    rect(c, x - 9 * s, y - 42 * s, 8 * s, 38 * s, P.estradaBlue, 2.5);
    rect(c, x + 1 * s, y - 42 * s, 8 * s, 38 * s, P.estradaBlue, 2.5);
    ell(c, x - 6 * s, y - 3 * s, 8 * s, 4 * s, P.shoe, 2);
    ell(c, x + 6 * s, y - 3 * s, 8 * s, 4 * s, P.shoe, 2);
  }
  // tiny backpack (behind torso)
  if (o.backpack !== false) {
    rect(c, x - f * 22 * s, y - 68 * s, 12 * s, 16 * s, '#8a5a2b', 2.5);
    rect(c, x - f * 19 * s, y - 71 * s, 6 * s, 4 * s, '#6b4420', 2);
  }
  // thin torso: green shirt
  rect(c, x - 11 * s, y - 74 * s, 22 * s, 34 * s, P.mangGreen);
  rect(c, x - 7 * s, y - 62 * s, 14 * s, 22 * s, P.estradaBlue, 2); // overall bib
  // arms by pose
  const shY = y - 70 * s;
  if (pose === 'point') {
    poly(c, [[x + f * 8 * s, shY + 4 * s], [x + f * 34 * s, shY - 8 * s], [x + f * 34 * s, shY - 2 * s], [x + f * 9 * s, shY + 10 * s]], P.mangGreen, 2.5);
    disc(c, x + f * 36 * s, shY - 5 * s, 4.5 * s, P.glove, 2);
    seg(c, x + f * 38 * s, shY - 6 * s, x + f * 46 * s, shY - 9 * s, P.glove, 4);
    rect(c, x - f * 16 * s, shY, 6 * s, 20 * s, P.mangGreen, 2.5);
  } else if (pose === 'offer') {
    poly(c, [[x + f * 8 * s, shY + 4 * s], [x + f * 30 * s, shY + 14 * s], [x + f * 29 * s, shY + 20 * s], [x + f * 8 * s, shY + 10 * s]], P.mangGreen, 2.5);
    ell(c, x + f * 32 * s, shY + 17 * s, 5.5 * s, 4 * s, P.glove, 2); // open palm
    rect(c, x - f * 16 * s, shY, 6 * s, 20 * s, P.mangGreen, 2.5);
  } else if (pose === 'measure') {
    poly(c, [[x + f * 8 * s, shY + 2 * s], [x + f * 30 * s, shY - 4 * s], [x + f * 30 * s, shY + 2 * s], [x + f * 9 * s, shY + 8 * s]], P.mangGreen, 2.5);
    disc(c, x + f * 32 * s, shY - 1 * s, 4.5 * s, P.glove, 2);
    poly(c, [[x - f * 8 * s, shY + 2 * s], [x - f * 26 * s, shY + 8 * s], [x - f * 26 * s, shY + 14 * s], [x - f * 8 * s, shY + 8 * s]], P.mangGreen, 2.5);
    disc(c, x - f * 28 * s, shY + 11 * s, 4.5 * s, P.glove, 2);
  } else if (pose === 'magnify') {
    poly(c, [[x + f * 8 * s, shY + 4 * s], [x + f * 26 * s, shY - 12 * s], [x + f * 31 * s, shY - 7 * s], [x + f * 12 * s, shY + 9 * s]], P.mangGreen, 2.5);
    disc(c, x + f * 29 * s, shY - 10 * s, 4.5 * s, P.glove, 2);
    // magnifying glass
    disc(c, x + f * 38 * s, shY - 20 * s, 9 * s, 'rgba(190,230,255,0.55)', 3);
    seg(c, x + f * 32 * s, shY - 13 * s, x + f * 29 * s, shY - 10 * s, INK, 4);
    rect(c, x - f * 16 * s, shY, 6 * s, 20 * s, P.mangGreen, 2.5);
  } else if (pose === 'fist' || pose === 'run') {
    poly(c, [[x + f * 8 * s, shY + 6 * s], [x + f * 18 * s, shY - 14 * s], [x + f * 24 * s, shY - 12 * s], [x + f * 14 * s, shY + 8 * s]], P.mangGreen, 2.5);
    disc(c, x + f * 21 * s, shY - 16 * s, 5 * s, P.glove, 2);
    poly(c, [[x - f * 8 * s, shY + 6 * s], [x - f * 20 * s, shY + 18 * s], [x - f * 16 * s, shY + 22 * s], [x - f * 6 * s, shY + 12 * s]], P.mangGreen, 2.5);
  } else {
    rect(c, x - 17 * s, shY, 6 * s, 22 * s, P.mangGreen, 2.5);
    rect(c, x + 11 * s, shY, 6 * s, 22 * s, P.mangGreen, 2.5);
    disc(c, x - 14 * s, shY + 25 * s, 4.5 * s, P.glove, 2);
    disc(c, x + 14 * s, shY + 25 * s, 4.5 * s, P.glove, 2);
  }
  // head: narrower than Estrada's
  ell(c, x, hy, 14 * s, 16 * s, P.skin);
  ell(c, x + f * 9 * s, hy + 4 * s, 5 * s, 4 * s, P.skin, 2); // nose
  // full honest moustache (contrast with the pencil one)
  ell(c, x + f * 6 * s, hy + 9 * s, 8 * s, 3 * s, '#4a2c14', 2);
  // big honest eyes
  const exL = x + f * 1 * s, exR = x + f * 9 * s, ey = hy - 3 * s;
  if (eyes === 'honest') {
    ell(c, exL, ey, 4 * s, 5.5 * s, '#fff', 2);
    ell(c, exR, ey, 4 * s, 5.5 * s, '#fff', 2);
    disc(c, exL + f * 1.4 * s, ey + 1 * s, 2 * s, INK, 0);
    disc(c, exR + f * 1.4 * s, ey + 1 * s, 2 * s, INK, 0);
  } else if (eyes === 'squint') {
    seg(c, exL - 3.5 * s, ey, exL + 3.5 * s, ey - 1 * s, INK, 3);
    seg(c, exR - 3.5 * s, ey - 1 * s, exR + 3.5 * s, ey, INK, 3);
  } else { // narrow: thin slits with pupils
    ell(c, exL, ey, 4 * s, 2 * s, '#fff', 2);
    ell(c, exR, ey, 4 * s, 2 * s, '#fff', 2);
    disc(c, exL + f * 1.4 * s, ey, 1.4 * s, INK, 0);
    disc(c, exR + f * 1.4 * s, ey, 1.4 * s, INK, 0);
  }
  // brows
  if (brows === 'worried') {
    seg(c, exL - 4 * s, ey - 7 * s, exL + 3 * s, ey - 9 * s, INK, 3);
    seg(c, exR - 3 * s, ey - 9 * s, exR + 4 * s, ey - 7 * s, INK, 3);
  } else if (brows === 'determined') {
    seg(c, exL - 4 * s, ey - 9 * s, exL + 3 * s, ey - 6 * s, INK, 3);
    seg(c, exR - 3 * s, ey - 6 * s, exR + 4 * s, ey - 9 * s, INK, 3);
  } else {
    seg(c, exL - 4 * s, ey - 9 * s, exL + 3 * s, ey - 9 * s, INK, 3);
    seg(c, exR - 3 * s, ey - 11 * s, exR + 4 * s, ey - 11 * s, INK, 3);
  }
  // small concerned mouth
  seg(c, x + f * 2 * s, hy + 13 * s, x + f * 9 * s, hy + 12 * s, INK, 2.5);
  // green cap with 'M'
  c.beginPath(); c.arc(x, hy - 6 * s, 14 * s, Math.PI, 0); c.closePath();
  c.fillStyle = P.mangGreen; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
  rect(c, x + (f > 0 ? 6 : -20) * s, hy - 10 * s, 14 * s, 4.5 * s, P.mangGreen, 2);
  disc(c, x, hy - 13 * s, 6 * s, '#fff', 2);
  txt(c, 'M', x, hy - 12.4 * s, Math.max(7, 9 * s), P.mangDark, 'center', false);
}

export interface PeachOpts {
  facing?: 1 | -1;
  pose?: 'sit' | 'stand' | 'step';
  mood?: 'sad' | 'hope' | 'happy';
}

export function drawPeach(c: Ctx, x: number, y: number, s: number, o: PeachOpts = {}): void {
  const f = o.facing ?? 1;
  const pose = o.pose ?? 'stand';
  const mood = o.mood ?? 'sad';
  const sit = pose === 'sit';
  const hy = y - (sit ? 58 : 76) * s;
  // gown bell
  if (sit) {
    poly(c, [[x - 10 * s, y - 44 * s], [x + 10 * s, y - 44 * s], [x + 22 * s, y], [x - 22 * s, y]], P.peachPink);
  } else {
    poly(c, [[x - 10 * s, y - 60 * s], [x + 10 * s, y - 60 * s], [x + 24 * s, y], [x - 24 * s, y]], P.peachPink);
    if (pose === 'step') ell(c, x + f * 12 * s, y - 2 * s, 6 * s, 3.5 * s, P.peachDark, 2); // slipper forward
  }
  seg(c, x - 18 * s, y - 10 * s, x + 18 * s, y - 10 * s, P.peachDark, 2.5);
  // bodice + puff sleeves
  rect(c, x - 8 * s, y - (sit ? 52 : 68) * s, 16 * s, 10 * s, P.peachPink, 2.5);
  disc(c, x - 11 * s, y - (sit ? 49 : 65) * s, 5 * s, P.peachDark, 2);
  disc(c, x + 11 * s, y - (sit ? 49 : 65) * s, 5 * s, P.peachDark, 2);
  // arms: folded on lap when sitting, one reaching when stepping
  if (pose === 'step') {
    poly(c, [[x + f * 6 * s, y - (sit ? 48 : 64) * s], [x + f * 22 * s, y - 56 * s], [x + f * 21 * s, y - 50 * s], [x + f * 6 * s, y - 58 * s]], P.peachPink, 2);
    disc(c, x + f * 24 * s, y - 54 * s, 3.5 * s, P.skin, 2);
  } else {
    disc(c, x - 6 * s, y - (sit ? 40 : 52) * s, 3.5 * s, P.skin, 2);
    disc(c, x + 6 * s, y - (sit ? 40 : 52) * s, 3.5 * s, P.skin, 2);
  }
  // head — kept kind and simple; she is sympathetic, never mocked
  disc(c, x, hy, 12 * s, P.skin);
  // golden hair frame
  c.beginPath(); c.arc(x, hy - 3 * s, 13 * s, Math.PI * 0.9, Math.PI * 2.1); c.closePath();
  c.fillStyle = P.hairGold; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
  poly(c, [[x - 13 * s, hy], [x - 10 * s, hy + 18 * s], [x - 4 * s, hy + 6 * s]], P.hairGold, 2);
  poly(c, [[x + 13 * s, hy], [x + 10 * s, hy + 18 * s], [x + 4 * s, hy + 6 * s]], P.hairGold, 2);
  // gentle eyes
  if (mood === 'happy') {
    c.strokeStyle = INK; c.lineWidth = 2;
    c.beginPath(); c.arc(x - 4 * s, hy, 2.5 * s, Math.PI, 0); c.stroke();
    c.beginPath(); c.arc(x + 4 * s, hy, 2.5 * s, Math.PI, 0); c.stroke();
    c.beginPath(); c.arc(x, hy + 5 * s, 3.5 * s, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  } else {
    disc(c, x - 4 * s, hy, 1.6 * s, INK, 0);
    disc(c, x + 4 * s, hy, 1.6 * s, INK, 0);
    if (mood === 'sad') {
      seg(c, x - 6 * s, hy - 4 * s, x - 2 * s, hy - 5 * s, INK, 2);
      seg(c, x + 2 * s, hy - 5 * s, x + 6 * s, hy - 4 * s, INK, 2);
      seg(c, x - 2.5 * s, hy + 6 * s, x + 2.5 * s, hy + 6 * s, INK, 2);
    } else { // hope
      c.beginPath(); c.arc(x, hy + 5 * s, 3 * s, 0.2 * Math.PI, 0.8 * Math.PI);
      c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
    }
  }
  // proper crown (not tiny — hers is real)
  poly(c, [[x - 6 * s, hy - 14 * s], [x + 6 * s, hy - 14 * s], [x + 6 * s, hy - 21 * s],
    [x + 3 * s, hy - 17 * s], [x, hy - 22 * s], [x - 3 * s, hy - 17 * s], [x - 6 * s, hy - 21 * s]], COIN, 2);
}

export interface ToadOpts {
  facing?: 1 | -1;
  mood?: 'despair' | 'faint' | 'adore' | 'shock' | 'cheer';
  camera?: boolean;
  coin?: boolean;
}

export function drawToad(c: Ctx, x: number, y: number, s: number, o: ToadOpts = {}): void {
  const f = o.facing ?? 1;
  const mood = o.mood ?? 'despair';
  if (mood === 'faint') {
    // flat on the back, little legs up
    ell(c, x, y - 6 * s, 14 * s, 6 * s, P.toadWhite, 2.5);
    disc(c, x - 12 * s, y - 8 * s, 4 * s, P.toadRed, 2);
    disc(c, x + 8 * s, y - 8 * s, 4 * s, P.toadRed, 2);
    rect(c, x - 4 * s, y - 16 * s, 3 * s, 8 * s, P.toadSkin, 2);
    rect(c, x + 2 * s, y - 14 * s, 3 * s, 6 * s, P.toadSkin, 2);
    // spiral eyes
    c.strokeStyle = INK; c.lineWidth = 1.5;
    for (const ex of [x - 4 * s, x + 3 * s]) {
      c.beginPath();
      for (let a = 0; a < Math.PI * 3; a += 0.4) c.lineTo(x + (ex - x) + Math.cos(a) * a * 0.5 * s * 0.5, y - 3 * s + Math.sin(a) * a * 0.5 * s * 0.5);
      c.stroke();
    }
    return;
  }
  const hy = y - 26 * s;
  // little body
  rect(c, x - 8 * s, y - 18 * s, 16 * s, 16 * s, mood === 'adore' ? '#d8635f' : '#5f76d8', 2.5);
  ell(c, x - 5 * s, y - 2 * s, 5 * s, 3 * s, P.shoe, 2);
  ell(c, x + 5 * s, y - 2 * s, 5 * s, 3 * s, P.shoe, 2);
  // arms
  if (mood === 'cheer' || mood === 'adore') {
    seg(c, x - 8 * s, y - 14 * s, x - 15 * s, y - 24 * s, P.toadSkin, 3.5);
    seg(c, x + 8 * s, y - 14 * s, x + 15 * s, y - 24 * s, P.toadSkin, 3.5);
  } else if (mood === 'despair') {
    // hands on head
    seg(c, x - 8 * s, y - 14 * s, x - 9 * s, hy - 6 * s, P.toadSkin, 3.5);
    seg(c, x + 8 * s, y - 14 * s, x + 9 * s, hy - 6 * s, P.toadSkin, 3.5);
  } else {
    seg(c, x - 8 * s, y - 14 * s, x - 13 * s, y - 8 * s, P.toadSkin, 3.5);
    seg(c, x + 8 * s, y - 14 * s, x + 13 * s, y - 8 * s, P.toadSkin, 3.5);
  }
  // face
  disc(c, x, hy, 9 * s, P.toadSkin);
  if (mood === 'shock') {
    disc(c, x - 3 * s, hy - 1 * s, 2 * s, '#fff', 1.5);
    disc(c, x + 3 * s, hy - 1 * s, 2 * s, '#fff', 1.5);
    disc(c, x - 3 * s, hy - 1 * s, 0.8 * s, INK, 0);
    disc(c, x + 3 * s, hy - 1 * s, 0.8 * s, INK, 0);
    ell(c, x, hy + 4 * s, 2.5 * s, 3.5 * s, '#7c2230', 1.5);
  } else if (mood === 'adore' || mood === 'cheer') {
    c.strokeStyle = INK; c.lineWidth = 1.8;
    c.beginPath(); c.arc(x - 3 * s, hy - 1 * s, 1.8 * s, Math.PI, 0); c.stroke();
    c.beginPath(); c.arc(x + 3 * s, hy - 1 * s, 1.8 * s, Math.PI, 0); c.stroke();
    c.beginPath(); c.arc(x, hy + 3 * s, 3 * s, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  } else { // despair
    seg(c, x - 4.5 * s, hy - 2 * s, x - 1.5 * s, hy - 1 * s, INK, 2);
    seg(c, x + 1.5 * s, hy - 1 * s, x + 4.5 * s, hy - 2 * s, INK, 2);
    c.beginPath(); c.arc(x, hy + 6 * s, 3 * s, 1.15 * Math.PI, 1.85 * Math.PI);
    c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
    // tears
    disc(c, x - 5 * s, hy + 3 * s, 1.2 * s, '#9ed8f7', 1);
    disc(c, x + 5 * s, hy + 3 * s, 1.2 * s, '#9ed8f7', 1);
  }
  // mushroom cap with spots
  c.beginPath(); c.arc(x, hy - 4 * s, 12 * s, Math.PI * 0.95, Math.PI * 2.05); c.closePath();
  c.fillStyle = P.toadWhite; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
  disc(c, x - 6 * s, hy - 10 * s, 3 * s, P.toadRed, 1.5);
  disc(c, x + 6 * s, hy - 10 * s, 3 * s, P.toadRed, 1.5);
  disc(c, x, hy - 14 * s, 3 * s, P.toadRed, 1.5);
  // props
  if (o.coin) coin(c, x + f * 14 * s, y - 20 * s, 5 * s);
  if (o.camera) {
    rect(c, x + f * 10 * s, hy - 4 * s, 12 * s, 9 * s, '#3d3f52', 2);
    disc(c, x + f * 16 * s, hy + 0.5 * s, 3 * s, '#8fd8ff', 1.5);
  }
}

// ============================================================================
// SCENES
// ============================================================================
type SceneFn = (c: Ctx, frame: number) => void;

const sceneBetShop: SceneFn = (c, frame) => {
  vgrad(c, '#5a3a78', '#2c1c48');
  floorBand(c, 300, '#3d2a58');
  // glittering counter, right side
  rect(c, 380, 190, 240, 110, '#7c4a1f');
  flat(c, 380, 190, 240, 14, '#9a6230');
  // sign above the counter
  rect(c, 370, 60, 260, 56, '#20222c');
  txt(c, "TOAD'S BETS", 500, 80, 26, COIN);
  txt(c, 'IMPOSSIBLE TO LOSE!', 500, 103, 13, '#ff9d9d');
  const rng = createRng(101);
  for (let i = 0; i < 10; i++) sparkle(c, 380 + rng() * 240, 55 + rng() * 70, 5 + rng() * 4, frame, rng() * 6);
  // odds board
  rect(c, 30, 40, 250, 90, '#173322');
  txt(c, 'TODAY', 155, 58, 12, '#9be89b');
  txt(c, 'PEACH KIDNAPPED:', 155, 80, 15, '#f4f0e6');
  txt(c, '1000000:1', 155, 106, 22, COIN);
  // Estrada behind the counter, smug teller
  drawEstrada(c, 520, 268, 0.85, { facing: -1, eyes: 'smug', mouth: 'grin', arms: 'down' });
  flat(c, 380, 258, 240, 46, '#7c4a1f'); // counter front hides his legs
  seg(c, 380, 258, 620, 258, INK, LW);
  // queue of Toads clutching their coins
  const bob = (i: number): number => Math.sin(frame * 0.06 + i * 1.3) * 2;
  drawToad(c, 330, 322 + bob(0), 1.1, { facing: 1, mood: 'shock', coin: true });
  drawToad(c, 250, 328 + bob(1), 1.05, { facing: 1, mood: 'adore', coin: true });
  drawToad(c, 175, 324 + bob(2), 1.0, { facing: 1, mood: 'cheer', coin: true });
  drawToad(c, 105, 330 + bob(3), 1.1, { facing: 1, mood: 'shock', coin: true });
  drawToad(c, 40, 326 + bob(4), 0.95, { facing: 1, mood: 'adore', coin: true });
  // coins arcing from the counter into a pipe
  rect(c, 560, 130, 56, 60, '#2f9e44');
  rect(c, 552, 118, 72, 16, '#37b350');
  for (let i = 0; i < 7; i++) {
    const t = ((frame * 0.02 + i / 7) % 1);
    const cx = 470 + t * 118;
    const cy = 200 - Math.sin(t * Math.PI) * 90;
    coin(c, cx, cy, 7);
  }
  txt(c, 'ALL BETS CERTIFIED BY A REAL ROYAL NOTARY', 320, 348, 11, '#cbb8ff');
};

const sceneNotary: SceneFn = (c, frame) => {
  vgrad(c, '#3a2c1c', '#241a10');
  floorBand(c, 310, '#4a3520');
  // desk
  rect(c, 120, 240, 400, 70, '#6b4420');
  flat(c, 120, 240, 400, 12, '#835b2f');
  // The TRANSPARENT URN of bet slips, sitting on the desk. The pile lives
  // INSIDE the glass (clipped), bottom-heavy like real tombola stuffing.
  const uX = 148, uW = 168, uTop = 126, uBottom = 240;
  const slip = (px: number, py: number, rot: number): void => {
    c.save(); c.translate(px, py); c.rotate(rot);
    rect(c, -16, -10, 32, 20, '#f4f0e6', 2);
    seg(c, -10, -3, 10, -3, '#b9b2a4', 1.5);
    seg(c, -10, 3, 8, 3, '#b9b2a4', 1.5);
    c.restore();
  };
  // back glass
  flat(c, uX, uTop, uW, uBottom - uTop, 'rgba(190,220,255,0.10)');
  // slips clipped to the urn interior, piled toward the bottom
  const rng = createRng(202);
  c.save();
  c.beginPath();
  c.rect(uX + 3, uTop + 10, uW - 6, uBottom - uTop - 13);
  c.clip();
  for (let i = 0; i < 26; i++) {
    const px = uX + 14 + rng() * (uW - 28);
    const py = uBottom - 14 - rng() * rng() * (uBottom - uTop - 44);
    slip(px, py, (rng() - 0.5) * 0.9);
  }
  c.restore();
  // one slip forever dropping through the lid slot (the business is booming)
  const dropT = (frame * 0.012) % 1;
  if (dropT < 0.55) slip(uX + uW / 2, uTop - 18 + dropT * 60, dropT * 1.2);
  // front glass: sheen + slanted highlight, then the outline and the lid slot
  flat(c, uX, uTop, uW, uBottom - uTop, 'rgba(210,235,255,0.12)');
  c.save();
  c.beginPath();
  c.moveTo(uX + 18, uBottom); c.lineTo(uX + 52, uTop); c.lineTo(uX + 70, uTop);
  c.lineTo(uX + 36, uBottom); c.closePath();
  c.fillStyle = 'rgba(255,255,255,0.10)';
  c.fill();
  c.restore();
  c.lineWidth = 3; c.strokeStyle = '#141020';
  c.strokeRect(uX, uTop, uW, uBottom - uTop);
  rect(c, uX - 6, uTop - 8, uW + 12, 10, '#835b2f', 2);            // lid
  flat(c, uX + uW / 2 - 22, uTop - 5, 44, 4, '#141020');           // the slot
  rect(c, uX + uW / 2 - 26, uBottom - 26, 52, 16, '#f4f0e6', 2);   // label
  txt(c, 'BETS', uX + uW / 2, uBottom - 14, 10, P.estradaRed);
  // a couple of loose slips lying flat ON the desk, waiting for the stamp
  slip(352, 232, 0.08);
  slip(374, 234, -0.12);
  // a slip mid-stamp, CERTIFIED in red
  rect(c, 400, 214, 84, 26, '#f4f0e6', 2);
  txt(c, 'CERTIFIED', 442, 227, 11, P.estradaRed);
  // candle — ON the desk (desk spans x 120..520; keep the base inside it)
  rect(c, 494, 216, 10, 26, '#f4f0e6', 2);
  const fl = Math.sin(frame * 0.3) * 2;
  ell(c, 499 + fl * 0.4, 208 + Math.abs(fl) * 0.6, 4, 7, '#ffb347', 2);
  // Estrada in the half-mask, stamping, winking every ~2.5s
  const wink = (frame % 150) < 22;
  const stampBeat = Math.sin(frame * 0.15) > 0.4;
  drawEstrada(c, 330, 300, 1.25, {
    facing: 1, masked: true, eyes: wink ? 'wink' : 'smug', mouth: 'grin',
    arms: 'stamp', item: 'stamp',
  });
  if (stampBeat) {
    txt(c, 'KA-CHUNK', 430, 168, 14, COIN);
    speechSpikes(c, 408, 190, 3, frame);
  }
  txt(c, 'ROYAL NOTARY OFFICE — TOTALLY INDEPENDENT', 320, 30, 13, '#e8d5a0');
  txt(c, '(fee: 40%)', 320, 48, 11, '#b9a26a');
};

const sceneDungeon: SceneFn = (c, frame) => {
  vgrad(c, '#101426', '#05070f');
  brickWall(c, 0, 300, '#1c2338', '#11162a');
  floorBand(c, 300, '#141a2e');
  // one shaft of light from a high barred window
  rect(c, 452, 30, 60, 44, '#0a0e1c', 2.5);
  seg(c, 472, 30, 472, 74, INK, 3); seg(c, 492, 30, 492, 74, INK, 3);
  c.save();
  c.globalAlpha = 0.28 + Math.sin(frame * 0.02) * 0.04;
  poly(c, [[452, 74], [512, 74], [420, 300], [280, 300]], '#fff4be', 0);
  c.restore();
  // chains
  for (const cx of [60, 110]) {
    c.strokeStyle = '#4c5470'; c.lineWidth = 3;
    for (let k = 0; k < 6; k++) { c.beginPath(); c.ellipse(cx, 20 + k * 16, 5, 9, 0, 0, Math.PI * 2); c.stroke(); }
  }
  // crate + the real Peach, sitting in the light, sympathetic
  rect(c, 300, 258, 90, 42, '#5c4322');
  seg(c, 300, 279, 390, 279, '#3d2c15', 2); seg(c, 345, 258, 345, 300, '#3d2c15', 2);
  drawPeach(c, 345, 262, 1.15, { facing: -1, pose: 'sit', mood: 'sad' });
  // skeleton cellmate against the wall, STILL holding his bet slip
  const sk = 150, sky = 300;
  disc(c, sk, sky - 58, 12, '#d9d4c4');
  disc(c, sk - 4, sky - 60, 2.2, INK, 0); disc(c, sk + 4, sky - 60, 2.2, INK, 0);
  seg(c, sk - 4, sky - 51, sk + 4, sky - 51, INK, 2);
  rect(c, sk - 10, sky - 46, 20, 30, '#d9d4c4', 2.5);
  seg(c, sk - 10, sky - 38, sk + 10, sky - 38, INK, 2);
  seg(c, sk - 10, sky - 30, sk + 10, sky - 30, INK, 2);
  seg(c, sk + 10, sky - 42, sk + 26, sky - 34, '#d9d4c4', 4);
  rect(c, sk + 22, sky - 44, 26, 16, '#f4f0e6', 2);
  txt(c, 'BET', sk + 35, sky - 36, 8, '#b9412f', 'center', false);
  // rats
  rat(c, 230, 300, 1, frame, 0);
  rat(c, 470, 300, 0.8, frame, 2.4);
  // drips
  for (let i = 0; i < 3; i++) {
    const t = ((frame * 0.013 + i * 0.37) % 1);
    const dx = 200 + i * 150;
    disc(c, dx, 10 + t * 280, 2.5, '#7fb7d9', 0);
  }
  txt(c, 'DUNGEON B — LONG-TERM STORAGE', 320, 340, 11, '#5f6c96');
};

const sceneWardrobe: SceneFn = (c, frame) => {
  vgrad(c, '#43284e', '#241430');
  floorBand(c, 306, '#33203e');
  // mirror with bulbs
  rect(c, 30, 40, 120, 170, '#7c6a8a', 2.5);
  flat(c, 40, 50, 100, 150, '#b9a8cc');
  for (let i = 0; i < 8; i++) {
    const on = ((frame >> 4) + i) % 3 !== 0;
    disc(c, 30 + (i % 4) * 40 + 10, i < 4 ? 34 : 216, 5, on ? '#ffe9a0' : '#6b5a44', 2);
  }
  // wig on a stand
  rect(c, 200, 250, 8, 56, '#8a7a9a', 2);
  disc(c, 204, 240, 14, '#cbb8d9', 2.5);
  c.beginPath(); c.arc(204, 234, 16, Math.PI * 0.95, Math.PI * 2.02); c.closePath();
  c.fillStyle = P.wig; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
  poly(c, [[216, 228], [230, 224], [228, 232], [216, 234]], P.wig, 2);
  txt(c, 'HAIR (OFFICIAL)', 204, 320, 10, '#cbb8d9');
  // shell on a mannequin
  rect(c, 560, 236, 8, 70, '#8a7a9a', 2);
  c.beginPath(); c.arc(564, 232, 30, Math.PI, 0); c.closePath();
  c.fillStyle = P.shellY; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
  flat(c, 536, 216, 56, 7, P.shellG); flat(c, 536, 204, 56, 7, P.shellG);
  for (let i = -1; i <= 1; i++) poly(c, [[564 + i * 18 - 4, 202], [564 + i * 18 + 4, 202], [564 + i * 18, 192]], '#d9d4c4', 2);
  // Trump silhouette stepping INTO the dress — one leg in
  const tx = 330;
  poly(c, [[tx - 30, 306], [tx + 30, 306], [tx + 16, 226], [tx - 16, 226]], P.peachPink); // dress held up
  drawImpeach(c, tx, 306, 1.0, { facing: -1, hands: 'down', mouth: 'pout', waveT: frame });
  // bare orange leg stepping over the dress hem
  poly(c, [[tx + 20, 306], [tx + 52, 258 + Math.sin(frame * 0.05) * 4], [tx + 62, 264 + Math.sin(frame * 0.05) * 4], [tx + 34, 306]], P.orange, 2.5);
  // Bowsonaro fighting his shell straps
  drawBowsonaro(c, 480, 306, 0.9, { facing: -1, pose: 'struggle', mouth: 'open', shellOn: false });
  c.save();
  c.translate(480, 240 + Math.sin(frame * 0.1) * 3);
  c.rotate(Math.sin(frame * 0.08) * 0.15);
  c.beginPath(); c.arc(0, 0, 24, Math.PI, 0); c.closePath();
  c.fillStyle = P.shellY; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
  for (let i = -1; i <= 1; i++) poly(c, [[i * 15 - 4, -2], [i * 15 + 4, -2], [i * 15, -12]], '#d9d4c4', 2);
  seg(c, -22, 4, -34, 22, '#6b4420', 3); seg(c, 22, 4, 34, 22, '#6b4420', 3); // flailing straps
  c.restore();
  speechSpikes(c, 505, 250, 3, frame);
  txt(c, 'COSTUME DEPT — DO NOT TELL ANYONE', 320, 26, 13, '#e0c8f0');
};

const sceneStagedKidnap: SceneFn = (c, frame) => {
  vgrad(c, '#8fd0f0', '#e8f4d8');
  // dramatic sun rays
  c.save();
  c.translate(320, 40);
  for (let i = 0; i < 9; i++) {
    c.rotate(Math.PI / 9);
    c.fillStyle = 'rgba(255,240,180,0.16)';
    c.fillRect(-9, 0, 18, 400);
  }
  c.restore();
  floorBand(c, 296, '#8cba62');
  // town houses far back
  for (let i = 0; i < 4; i++) {
    const hx = 40 + i * 160;
    rect(c, hx, 216, 90, 80, '#d8c8a8', 2.5);
    poly(c, [[hx - 8, 216], [hx + 98, 216], [hx + 45, 180]], P.toadRed, 2.5);
  }
  // Bowsonaro theatrically carrying Impeach
  const bx = 400, by = 312 + Math.sin(frame * 0.09) * 2;
  drawBowsonaro(c, bx, by, 1.15, { facing: -1, pose: 'carry', mouth: 'open' });
  c.save();
  c.translate(bx - 6, by - 96);
  c.rotate(-0.22);
  drawImpeach(c, 0, 0, 1.0, { facing: -1, hands: 'coffee-wave', waveT: frame, mouth: 'smug' });
  c.restore();
  txt(c, 'HELP. OH NO. ETC.', 452, 128, 13, '#fff');
  // fainting Toads
  drawToad(c, 80, 322, 1.1, { mood: 'faint' });
  drawToad(c, 160, 330, 1.0, { facing: 1, mood: 'shock' });
  drawToad(c, 238, 324, 1.05, { facing: 1, mood: 'despair' });
  drawToad(c, 560, 330, 1.0, { mood: 'faint' });
  const tip = Math.min(1, ((frame % 240) / 60));
  c.save(); // one Toad mid-faint, tipping over
  c.translate(600, 326);
  c.rotate(tip * Math.PI / 2 * 0.9);
  drawToad(c, 0, 0, 1.0, { facing: -1, mood: 'shock' });
  c.restore();
  txt(c, 'THE CRIME OF THE CENTURY (SCHEDULED, 15H)', 320, 26, 13, INK, 'center', false);
};

const sceneHeroSpeech: SceneFn = (c, frame) => {
  vgrad(c, '#f2a65e', '#d86a4a');
  // castle facade + balcony
  flat(c, 120, 0, 400, 250, '#e0d0e8');
  seg(c, 120, 0, 120, 250, INK, LW); seg(c, 520, 0, 520, 250, INK, LW);
  rect(c, 180, 150, 280, 26, '#b89ac8', 2.5); // balcony rail
  for (let i = 0; i < 9; i++) seg(c, 195 + i * 31, 150, 195 + i * 31, 176, '#8a6a9a', 3);
  // speech banner
  const sway = Math.sin(frame * 0.04) * 4;
  poly(c, [[150 + sway, 40], [490 + sway, 40], [482 + sway, 96], [158 + sway, 96]], '#f4f0e6');
  txt(c, 'I WILL RESCUE HER', 320 + sway, 60, 18, P.estradaRed);
  txt(c, 'MYSELF!!', 320 + sway, 84, 20, P.estradaRed);
  // Estrada on the balcony, fist pumping
  const pump = Math.sin(frame * 0.1) * 3;
  drawEstrada(c, 320, 168 + pump * 0.4, 1.05, { facing: 1, eyes: 'smug', mouth: 'open', arms: 'raised' });
  flat(c, 180, 150, 280, 26, '#b89ac8'); // rail in front of him
  seg(c, 180, 150, 460, 150, INK, 2.5);
  floorBand(c, 296, '#c8845e');
  // adoring crowd
  const rng = createRng(303);
  for (let i = 0; i < 9; i++) {
    const txp = 30 + i * 68 + rng() * 20;
    const typ = 320 + rng() * 34;
    drawToad(c, txp, typ + Math.sin(frame * 0.08 + i) * 2.5, 0.85 + rng() * 0.3, { facing: txp < 320 ? 1 : -1, mood: 'adore' });
  }
  // Mangiani in the corner, squinting, arms crossed
  drawMangiani(c, 596, 352, 0.95, { facing: -1, eyes: 'squint', brows: 'worried', pose: 'stand', backpack: false });
  txt(c, 'hm.', 596, 236, 12, '#fff');
};

const sceneMangianiJoins: SceneFn = (c, frame) => {
  vgrad(c, '#9fd6ea', '#d8ecc0');
  // rolling hills
  ell(c, 120, 330, 260, 90, '#9cc86e', 0);
  ell(c, 520, 344, 300, 100, '#8cba62', 0);
  floorBand(c, 306, '#7cae56');
  // signpost
  rect(c, 542, 240, 8, 66, '#8a5a2b', 2.5);
  poly(c, [[500, 226], [600, 226], [612, 240], [600, 254], [500, 254]], '#c8a468', 2.5);
  txt(c, "BOWSONARO'S →", 554, 240, 10, INK, 'center', false);
  // Mangiani planted at Estrada's side, determined
  drawMangiani(c, 240, 306, 1.2, { facing: 1, eyes: 'honest', brows: 'determined', pose: 'fist', backpack: true });
  txt(c, 'I AM COMING WITH YOU.', 240, 156, 14, '#fff');
  // Estrada: forced grin, ONE enormous sweat drop
  drawEstrada(c, 400, 306, 1.2, { facing: -1, eyes: 'wide', mouth: 'nervous', arms: 'down', sweatFrame: frame });
  txt(c, 'ha. ha. great.', 400, 170, 12, '#fff');
  // birds
  for (let i = 0; i < 3; i++) {
    const bx = ((frame * 0.4 + i * 220) % (VIEW_W + 60)) - 30;
    const by = 50 + i * 24 + Math.sin(frame * 0.1 + i) * 4;
    c.strokeStyle = INK; c.lineWidth = 2;
    c.beginPath(); c.moveTo(bx - 7, by); c.quadraticCurveTo(bx - 3, by - 5, bx, by);
    c.quadraticCurveTo(bx + 3, by - 5, bx + 7, by); c.stroke();
  }
};

const sceneTooLate: SceneFn = (c, frame) => {
  vgrad(c, '#5a4a6a', '#3a2c48');
  brickWall(c, 60, 306, '#6a5a7a', '#584a66');
  floorBand(c, 306, '#4a3c58');
  // big castle door, ajar — darkness behind
  poly(c, [[220, 306], [220, 120], [250, 90], [390, 90], [420, 120], [420, 306]], '#3a2c20');
  flat(c, 250, 110, 140, 196, '#0d0a14');
  poly(c, [[250, 306], [250, 110], [330, 130], [330, 306]], '#5c4322', LW); // the door itself, half open
  disc(c, 318, 210, 5, COIN, 2);
  // the note, pinned with a nail
  rect(c, 340, 150, 120, 76, '#f4f0e6');
  disc(c, 400, 146, 3, '#8a8494', 2);
  txt(c, 'SHE IS IN', 400, 168, 11, INK, 'center', false);
  txt(c, 'ANOTHER CASTLE,', 400, 184, 11, INK, 'center', false);
  txt(c, 'SORRY', 400, 200, 11, INK, 'center', false);
  txt(c, '- mgmt', 428, 216, 9, '#8a8494', 'center', false);
  // stool + STILL-STEAMING coffee
  rect(c, 480, 270, 52, 10, '#6b4420', 2.5);
  seg(c, 486, 280, 482, 306, '#6b4420', 4); seg(c, 526, 280, 530, 306, '#6b4420', 4);
  coffeeCup(c, 506, 268, 1.2, frame);
  // Estrada shrugging THEATRICALLY (slow shrug loop)
  const shrug = Math.sin(frame * 0.05) * 3;
  drawEstrada(c, 130, 306 + shrug * 0.3, 1.2, { facing: 1, eyes: 'closed', mouth: 'grin', arms: 'shrug' });
  txt(c, 'welp.', 130, 168, 13, '#fff');
  // Mangiani STARING at the cup
  drawMangiani(c, 590, 306, 1.1, { facing: -1, eyes: 'narrow', brows: 'raised', pose: 'point', backpack: true });
  // sight line from his eyes to the cup
  c.setLineDash([4, 6]);
  seg(c, 570, 208, 516, 252, 'rgba(255,255,255,0.5)', 2);
  c.setLineDash([]);
  txt(c, '...still hot?', 566, 178, 11, '#fff');
};

const sceneBigHands: SceneFn = (c, frame) => {
  vgrad(c, '#7cb8e8', '#c8e0f0');
  // clouds
  const rng = createRng(404);
  for (let i = 0; i < 5; i++) {
    const cx = ((rng() * 640 + frame * 0.15) % (VIEW_W + 120)) - 60;
    const cy = 40 + rng() * 120;
    ell(c, cx, cy, 40, 14, 'rgba(255,255,255,0.85)', 0);
    ell(c, cx + 24, cy - 8, 26, 12, 'rgba(255,255,255,0.85)', 0);
  }
  // the airship, upper right
  const ay = 90 + Math.sin(frame * 0.03) * 5;
  ell(c, 470, ay, 130, 36, '#6b4420');           // hull
  flat(c, 350, ay - 20, 240, 20, '#835b2f');
  seg(c, 340, ay - 20, 600, ay - 20, INK, LW);
  for (let i = 0; i < 4; i++) disc(c, 380 + i * 60, ay + 6, 6, '#3d3f52', 2); // portholes
  // propeller
  const spin = Math.sin(frame * 0.6);
  ell(c, 338, ay, 6, 24 * Math.abs(spin) + 2, '#8a8494', 2);
  // Impeach on deck — HANDS HALF THE FRAME
  drawImpeach(c, 470, ay - 18, 0.9, { facing: -1, hands: 'down', mouth: 'open', waveT: frame });
  const wob = Math.sin(frame * 0.08);
  bigHand(c, 250, 170 + wob * 10, 95, -0.25 + wob * 0.08);   // THE hand. Half the frame.
  bigHand(c, 560, 230, 60, 0.5);
  txt(c, 'HELLO LITTLE PEOPLE', 250, 40, 14, '#fff');
  floorBand(c, 320, '#8cba62');
  // Mangiani foreground with measuring tape, narrowed eyes
  drawMangiani(c, 110, 356, 1.15, { facing: 1, eyes: 'narrow', brows: 'worried', pose: 'measure', backpack: true });
  // the tape, stretched toward the hand
  seg(c, 148, 268, 210, 240, COIN, 3);
  rect(c, 132, 262, 16, 12, '#3d3f52', 2);
  txt(c, 'hand: 4.5 m ??', 150, 226, 11, INK, 'left', false);
};

const sceneBallotRant: SceneFn = (c, frame) => {
  vgrad(c, '#2c3a2c', '#141c14');
  spotlight(c, 320, 90, 330, 0.14);
  floorBand(c, 306, '#243024');
  // banner
  const sway = Math.sin(frame * 0.05) * 3;
  poly(c, [[110 + sway, 34], [530 + sway, 34], [522 + sway, 78], [118 + sway, 78]], '#3a9a3a');
  txt(c, 'THE SHELLS ARE RIGGED!', 320 + sway, 56, 18, '#ffe9a0');
  // podium
  poly(c, [[270, 306], [370, 306], [360, 210], [280, 210]], '#5c4322');
  flat(c, 274, 206, 92, 10, '#6b4420');
  seg(c, 274, 206, 366, 206, INK, 2.5);
  disc(c, 320, 196, 5, '#3d3f52', 2); // mic
  seg(c, 320, 200, 320, 210, '#3d3f52', 3);
  // Bowsonaro mid-rant
  drawBowsonaro(c, 320, 232, 1.05, { facing: 1, pose: 'rant', mouth: 'open' });
  speechSpikes(c, 352, 150, 4, frame);
  // turtle minions: asleep in their shells, Zzz drifting
  for (let i = 0; i < 3; i++) {
    const mx = 90 + i * 60;
    c.beginPath(); c.arc(mx, 300, 22, Math.PI, 0); c.closePath();
    c.fillStyle = P.shellY; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
    flat(c, mx - 22, 288, 44, 6, P.shellG);
    disc(c, mx + 20, 296, 8, P.turtSkin, 2); // dozing head poking out
    seg(c, mx + 16, 295, mx + 24, 295, INK, 2);
    const zt = (frame * 0.02 + i * 0.33) % 1;
    txt(c, 'Z', mx + 26 + zt * 18, 268 - zt * 26, 10 + zt * 6, '#9be89b', 'center', false);
  }
  // Impeach at the side, deep in the phone
  drawImpeach(c, 540, 306, 0.95, { facing: -1, hands: 'phone', mouth: 'pout', waveT: frame });
  c.save(); // phone glow on the face
  c.globalAlpha = 0.25 + Math.sin(frame * 0.2) * 0.05;
  poly(c, [[500, 240], [540, 210], [540, 250]], '#8fd8ff', 0);
  c.restore();
  txt(c, 'RALLY #4 — ATTENDANCE: 3 (ALL ASLEEP)', 320, 344, 11, '#9be89b');
};

const sceneCoffeeBreak: SceneFn = (c, frame) => {
  vgrad(c, '#f2a65e', '#e86a4a');
  // burning castle, background
  flat(c, 380, 90, 180, 210, '#8a7a9a');
  seg(c, 380, 90, 380, 300, INK, LW); seg(c, 560, 90, 560, 300, INK, LW); seg(c, 380, 90, 560, 90, INK, LW);
  for (const [tx2, ty] of [[380, 90], [560, 90]] as const) {
    rect(c, tx2 - 16, ty - 40, 32, 40, '#8a7a9a', 2.5);
    poly(c, [[tx2 - 20, ty - 40], [tx2 + 20, ty - 40], [tx2, ty - 70]], '#6a5a7a', 2.5);
  }
  // flames out of windows
  const rng = createRng(505);
  for (let i = 0; i < 4; i++) {
    const wx = 405 + (i % 2) * 90 + rng() * 20;
    const wy = 130 + Math.floor(i / 2) * 70;
    rect(c, wx, wy, 26, 34, '#1b1030', 2);
    const lick = Math.sin(frame * 0.25 + i * 1.7) * 6;
    poly(c, [[wx + 2, wy + 34], [wx + 24, wy + 34], [wx + 20, wy + 10 - lick], [wx + 13, wy + 22], [wx + 6, wy + 6 + lick]], '#ff8c3a', 2);
    poly(c, [[wx + 7, wy + 34], [wx + 19, wy + 34], [wx + 13, wy + 14 - lick * 0.6]], '#ffd94d', 0);
  }
  // smoke
  for (let i = 0; i < 3; i++) {
    const t = (frame * 0.01 + i * 0.33) % 1;
    ell(c, 470 + Math.sin(t * 6) * 20, 90 - t * 70, 18 + t * 22, 12 + t * 10, `rgba(60,50,70,${(0.5 - t * 0.45).toFixed(2)})`, 0);
  }
  floorBand(c, 300, '#e0b070');
  // deck chair + Estrada reclined with espresso
  poly(c, [[90, 300], [230, 300], [210, 250], [110, 250]], '#e04848', 2.5);
  seg(c, 110, 250, 70, 220, '#6b4420', 4);
  poly(c, [[70, 220], [130, 214], [150, 244], [110, 250]], '#e04848', 2.5);
  c.save();
  c.translate(150, 286);
  c.rotate(-0.5);
  drawEstrada(c, 0, 0, 1.05, { facing: 1, eyes: 'closed', mouth: 'grin', arms: 'recline' });
  c.restore();
  coffeeCup(c, 236, 246, 0.9, frame);
  rect(c, 228, 246, 20, 54, '#8a5a2b', 2); // side table
  // the sign
  rect(c, 300, 236, 10, 64, '#8a5a2b', 2.5);
  poly(c, [[252, 190], [358, 190], [358, 238], [252, 238]], '#f4f0e6');
  txt(c, 'ON BREAK', 305, 206, 13, P.estradaRed);
  txt(c, '14:00-15:30', 305, 224, 12, INK, 'center', false);
  // Mangiani SPRINTING past toward the fire
  const mrx = 40 + ((frame * 2.2) % 520);
  drawMangiani(c, mrx, 322, 1.1, { facing: 1, eyes: 'honest', brows: 'worried', pose: 'run', backpack: true });
  for (let i = 0; i < 4; i++) seg(c, mrx - 40 - i * 14, 300 - i * 6, mrx - 62 - i * 14, 300 - i * 6, 'rgba(255,255,255,0.6)', 3);
};

const sceneWigFalls: SceneFn = (c, frame) => {
  vgrad(c, '#6a2c3a', '#38141e');
  brickWall(c, 40, 300, '#7a3c4a', '#66303e');
  floorBand(c, 300, '#8a2432');
  flat(c, 0, 300, VIEW_W, 60, '#a83240'); // red carpet
  seg(c, 0, 300, VIEW_W, 300, INK, LW);
  // throne, back-left
  rect(c, 60, 120, 90, 180, COIN, 2.5);
  poly(c, [[60, 120], [150, 120], [150, 96], [128, 112], [105, 90], [82, 112], [60, 96]], COIN, 2.5);
  // Impeach revealed — wig OFF, frozen mid-gasp
  drawImpeach(c, 320, 300, 1.15, { facing: 1, hands: 'down', mouth: 'open', wigOn: false, waveT: 0 });
  // THE WIG, mid-air, tumbling
  c.save();
  const wy = 130 + Math.sin(frame * 0.06) * 8;
  c.translate(390, wy);
  c.rotate(frame * 0.04);
  c.beginPath(); c.arc(0, 0, 18, Math.PI * 0.95, Math.PI * 2.02); c.closePath();
  c.fillStyle = P.wig; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
  poly(c, [[14, -6], [30, -10], [27, -1], [14, 2]], P.wig, 2);
  c.restore();
  txt(c, '!!', 320, 150, 26, '#fff');
  // everyone frozen: Bowsonaro mid-gesture
  drawBowsonaro(c, 500, 300, 0.95, { facing: -1, pose: 'rant', mouth: 'open' });
  // Mangiani POINTING, vindicated
  drawMangiani(c, 130, 300, 1.1, { facing: 1, eyes: 'honest', brows: 'raised', pose: 'point', backpack: true });
  txt(c, 'I KNEW IT!', 130, 158, 14, '#fff');
  // one Toad, camera flash
  drawToad(c, 580, 336, 1.0, { facing: -1, mood: 'shock', camera: true });
  if ((frame % 80) < 6) {
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillRect(0, 0, VIEW_W, VIEW_H);
  }
};

const scenePeachFreed: SceneFn = (c, frame) => {
  vgrad(c, '#101426', '#05070f');
  brickWall(c, 0, 300, '#1c2338', '#11162a');
  floorBand(c, 300, '#141a2e');
  // dungeon door OPEN, light FLOODS in
  poly(c, [[400, 300], [400, 100], [430, 80], [560, 80], [590, 100], [590, 300]], '#3a2c20');
  flat(c, 420, 96, 150, 204, '#fff4be');
  poly(c, [[590, 100], [590, 300], [630, 300]], '#5c4322', LW); // door swung open
  c.save();
  c.globalAlpha = 0.30 + Math.sin(frame * 0.02) * 0.05;
  poly(c, [[420, 96], [570, 96], [340, 300], [80, 300]], '#fff4be', 0);
  c.restore();
  // Peach stepping out of the light, hopeful
  drawPeach(c, 470, 300, 1.2, { facing: -1, pose: 'step', mood: 'hope' });
  // Mangiani offering his hand, kind
  drawMangiani(c, 340, 300, 1.15, { facing: 1, eyes: 'honest', brows: 'raised', pose: 'offer', backpack: true });
  txt(c, 'miss, your kingdom misses you.', 320, 60, 12, '#fff');
  // rats APPLAUDING
  rat(c, 130, 300, 1, frame, 0, true);
  rat(c, 190, 300, 0.85, frame, 1.5, true);
  rat(c, 70, 300, 0.9, frame, 3.1, true);
  // the skeleton raises his bet slip in salute
  const sk = 250, sky = 300;
  disc(c, sk, sky - 52, 10, '#d9d4c4');
  disc(c, sk - 3, sky - 54, 1.8, INK, 0); disc(c, sk + 3, sky - 54, 1.8, INK, 0);
  c.beginPath(); c.arc(sk, sky - 48, 4, 0.15 * Math.PI, 0.85 * Math.PI); c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
  rect(c, sk - 8, sky - 42, 16, 26, '#d9d4c4', 2);
  seg(c, sk + 8, sky - 38, sk + 20, sky - 58, '#d9d4c4', 3.5);
  rect(c, sk + 14, sky - 70, 22, 14, '#f4f0e6', 2);
  // sparkles in the light
  const rng = createRng(606);
  for (let i = 0; i < 6; i++) sparkle(c, 380 + rng() * 180, 110 + rng() * 160, 4 + rng() * 3, frame, rng() * 6);
};

const sceneJail: SceneFn = (c, frame) => {
  vgrad(c, '#3a3f52', '#20242f');
  brickWall(c, 0, 306, '#4a4f62', '#3c4152');
  floorBand(c, 306, '#33374a');
  // barred window: outside is SUNNY — Mangiani & Peach eating ice cream
  rect(c, 262, 40, 120, 84, '#8fd0f0', 2.5);
  ell(c, 292, 62, 16, 6, '#fff', 0);
  flat(c, 262, 100, 120, 24, '#8cba62');
  // tiny happy figures with cones
  drawMangiani(c, 300, 118, 0.32, { facing: 1, eyes: 'honest', brows: 'raised', pose: 'stand', backpack: false });
  drawPeach(c, 340, 118, 0.34, { facing: -1, pose: 'stand', mood: 'happy' });
  poly(c, [[313, 92], [319, 92], [316, 102]], '#c8a468', 1.5);
  disc(c, 316, 89, 4, '#f7a8c8', 1.5);
  poly(c, [[326, 92], [332, 92], [329, 102]], '#c8a468', 1.5);
  disc(c, 329, 89, 4, '#9ed8f7', 1.5);
  for (let i = 0; i < 4; i++) seg(c, 262 + 24 + i * 24, 40, 262 + 24 + i * 24, 124, '#20242f', 5);
  seg(c, 262, 82, 382, 82, '#20242f', 5);
  // Estrada at a little table STILL stamping APPEAL forms
  rect(c, 60, 250, 120, 12, '#6b4420', 2.5);
  seg(c, 70, 262, 66, 306, '#6b4420', 4); seg(c, 170, 262, 174, 306, '#6b4420', 4);
  const rng = createRng(707);
  for (let i = 0; i < 6; i++) {
    c.save(); c.translate(85 + rng() * 70, 244 - rng() * 10); c.rotate((rng() - 0.5) * 0.4);
    rect(c, -13, -8, 26, 16, '#f4f0e6', 2);
    c.restore();
  }
  txt(c, 'APPEAL', 120, 238, 9, P.estradaRed, 'center', false);
  drawEstrada(c, 120, 306, 0.95, { facing: -1, eyes: 'smug', mouth: 'flat', arms: 'stamp', item: 'stamp' });
  // Impeach signing the wall: WITCH HUNT! — huge hand, tiny chalk
  drawImpeach(c, 320, 306, 0.95, { facing: 1, hands: 'chalk', mouth: 'pout', waveT: frame });
  const wob2 = Math.sin(frame * 0.07) * 2;
  txt(c, 'WITCH', 420, 176 + wob2, 16, '#fff', 'center', false);
  txt(c, 'HUNT!', 420, 196 + wob2, 16, '#fff', 'center', false);
  // Bowsonaro ranting at the rat jury
  drawBowsonaro(c, 520, 306, 0.85, { facing: 1, pose: 'rant', mouth: 'open' });
  speechSpikes(c, 548, 240, 3, frame);
  // rat jury on a little bench, one with a gavel
  rect(c, 560, 286, 76, 8, '#6b4420', 2);
  rat(c, 580, 286, 0.7, frame, 0.5);
  rat(c, 610, 286, 0.7, frame, 1.9);
  rat(c, 596, 268, 0.7, frame, 3.2);
  rect(c, 622, 258, 10, 5, '#8a5a2b', 1.5); // tiny gavel
  seg(c, 627, 263, 627, 270, '#8a5a2b', 2);
  txt(c, 'CELL 1 — THE BOARD OF DIRECTORS', 320, 344, 11, '#9aa2c2');
};

// ============================================================================
// Dispatch — exhaustive over CutsceneArtId; unknown ids THROW.
// ============================================================================
const SCENES: Record<CutsceneArtId, SceneFn> = {
  'bet-shop': sceneBetShop,
  'notary': sceneNotary,
  'dungeon': sceneDungeon,
  'wardrobe': sceneWardrobe,
  'staged-kidnap': sceneStagedKidnap,
  'hero-speech': sceneHeroSpeech,
  'mangiani-joins': sceneMangianiJoins,
  'too-late': sceneTooLate,
  'big-hands': sceneBigHands,
  'ballot-rant': sceneBallotRant,
  'coffee-break': sceneCoffeeBreak,
  'wig-falls': sceneWigFalls,
  'peach-freed': scenePeachFreed,
  'jail': sceneJail,
};

export function drawCutsceneArt(ctx: CanvasRenderingContext2D, id: CutsceneArtId, frame: number): void {
  const fn = SCENES[id];
  if (fn === undefined) throw new Error(`drawCutsceneArt: unknown CutsceneArtId '${String(id)}'`);
  ctx.save();
  fn(ctx, frame);
  ctx.restore();
}
