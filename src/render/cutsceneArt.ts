// ============================================================================
// The film department: full-frame (640x360) procedural cutscene posters.
// Storybook-density panels: layered depth (sky -> distant silhouettes ->
// mid-ground -> textured ground -> actors -> foreground framing + vignette),
// Mario-genre parody scenery, 2-4px outlines, sight gags in every frame.
// Deterministic — no Math.random; all motion derives from `frame`.
// Exhaustive over CutsceneArtId; unknown ids THROW.
//
// ANCHORING RULE (learned the hard way): every prop is visibly supported —
// on a surface, held, or inside a container. Supports are named in comments.
// ============================================================================

import type { CutsceneArtId } from '../core/types.ts';
import { VIEW_W, VIEW_H } from '../core/constants.ts';
import { createRng } from '../core/rng.ts';
import {
  INK, LW, P, COIN, COIN_DARK,
  rect, flat, disc, ell, poly, seg, txt,
  coin, coffeeCup, sparkle, speechSpikes, rat, skeleton,
  bigHand, drawEstrada, drawImpeach, drawBowsonaro, drawMangiani, drawPeach, drawToad,
} from './cast.ts';

// Re-export the cast so existing consumers (titleArt) keep their import path.
export { bigHand, drawEstrada, drawImpeach, drawBowsonaro, drawMangiani, drawPeach, drawToad } from './cast.ts';
export type {
  EstradaOpts, ImpeachOpts, BowsonaroOpts, MangianiOpts, PeachOpts, ToadOpts,
} from './cast.ts';

type Ctx = CanvasRenderingContext2D;

// ============================================================================
// SCENERY LIBRARY — layered-depth building blocks shared by the panels.
// ============================================================================

function vgrad(c: Ctx, stops: readonly (readonly [number, string])[]): void {
  const g = c.createLinearGradient(0, 0, 0, VIEW_H);
  for (const [t, col] of stops) g.addColorStop(t, col);
  c.fillStyle = g;
  c.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** Cinema vignette: darkened corners pull the eye to the middle. */
function vignette(c: Ctx, strength = 0.34): void {
  const g = c.createRadialGradient(320, 170, 150, 320, 180, 420);
  g.addColorStop(0, 'rgba(8,5,20,0)');
  g.addColorStop(1, `rgba(8,5,20,${strength})`);
  c.fillStyle = g;
  c.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** A big soft moon with craters + halo. */
function moon(c: Ctx, x: number, y: number, r: number): void {
  const g = c.createRadialGradient(x, y, r * 0.4, x, y, r * 2.6);
  g.addColorStop(0, 'rgba(240,240,210,0.35)');
  g.addColorStop(1, 'rgba(240,240,210,0)');
  c.fillStyle = g;
  c.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  disc(c, x, y, r, '#f2ecd0', 0);
  c.fillStyle = 'rgba(190,185,150,0.5)';
  c.beginPath(); c.arc(x - r * 0.3, y - r * 0.2, r * 0.22, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(x + r * 0.35, y + 0.3 * r, r * 0.15, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(x + r * 0.1, y - r * 0.45, r * 0.11, 0, Math.PI * 2); c.fill();
}

/** Mario-genre checkered rolling hill (parody, original colors). */
function checkerHill(c: Ctx, cx: number, cy: number, rx: number, ry: number, base: string, check: string): void {
  c.save();
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = base;
  c.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  c.fillStyle = check;
  const t = 26;
  for (let yy = 0; yy < ry * 2; yy += t) {
    for (let xx = ((yy / t) % 2) * t; xx < rx * 2; xx += t * 2) {
      c.fillRect(cx - rx + xx, cy - ry + yy, t, t);
    }
  }
  c.restore();
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2);
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.stroke();
}

/** Warp pipe standing ON groundY (parody green with rim + shading). */
function pipe(c: Ctx, x: number, groundY: number, w: number, h: number, col = '#2f9e44', colD = '#1f6f30'): void {
  rect(c, x, groundY - h, w, h, col, 2.5);
  flat(c, x + 2, groundY - h, w * 0.28, h, 'rgba(255,255,255,0.18)');
  flat(c, x + w * 0.72, groundY - h, w * 0.26, h, colD);
  rect(c, x - w * 0.12, groundY - h - w * 0.3, w * 1.24, w * 0.3, col, 2.5);
  flat(c, x - w * 0.1 + 2, groundY - h - w * 0.28, w * 0.3, w * 0.26, 'rgba(255,255,255,0.18)');
}

/** A floating sky-block row: bricks + one '$' bet-block. In staged panels
 *  pass hangs=true to hang them from visible strings (the set is fake). */
function blockRow(c: Ctx, x: number, y: number, n: number, dollarAt: number, hangs: boolean): void {
  const t = 22;
  for (let i = 0; i < n; i++) {
    const bx = x + i * t;
    if (hangs) seg(c, bx + t / 2, 0, bx + t / 2, y, 'rgba(240,240,240,0.55)', 1.5); // strings from the rig above frame
    if (i === dollarAt) {
      rect(c, bx, y, t, t, COIN, 2.5);
      txt(c, '$', bx + t / 2, y + t / 2 + 1, 13, '#8a5a00', 'center', false);
    } else {
      rect(c, bx, y, t, t, '#c8763a', 2.5);
      seg(c, bx + 2, y + t / 2, bx + t - 2, y + t / 2, '#8a4a22', 1.5);
      seg(c, bx + t / 2, y + 2, bx + t / 2, y + t / 2, '#8a4a22', 1.5);
    }
  }
}

/** Mushroom cottage with a round door — distant-village dressing. */
function cottage(c: Ctx, x: number, y: number, s: number, capCol: string): void {
  // stem/body sits ON y
  rect(c, x - 16 * s, y - 26 * s, 32 * s, 26 * s, '#f0e4c8', 2.5);
  // round door + window
  disc(c, x, y - 10 * s, 8 * s, '#8a5a2b', 2);
  disc(c, x, y - 10 * s, 5.5 * s, '#6b4420', 1.5);
  disc(c, x + 2 * s, y - 10 * s, 1.2 * s, COIN, 0); // knob
  disc(c, x - 10 * s, y - 18 * s, 3.5 * s, '#ffe9a0', 1.5); // lit window
  // cap
  c.beginPath(); c.arc(x, y - 26 * s, 22 * s, Math.PI, 0); c.closePath();
  c.fillStyle = capCol; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
  disc(c, x - 9 * s, y - 34 * s, 4 * s, '#fff', 1.5);
  disc(c, x + 8 * s, y - 32 * s, 3.4 * s, '#fff', 1.5);
}

/** Grass tufts + tiny flowers along a ground band (texture, not flat color). */
function grassTufts(c: Ctx, seed: number, y0: number, y1: number, n: number, dark: string): void {
  const rng = createRng(seed);
  c.strokeStyle = dark;
  c.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const x = rng() * VIEW_W;
    const y = y0 + rng() * (y1 - y0);
    const h = 3 + rng() * 4;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2, y - h); c.stroke();
    c.beginPath(); c.moveTo(x + 2, y); c.lineTo(x + 3, y - h); c.stroke();
    if (rng() < 0.18) {
      disc(c, x + 5, y - 4, 2.2, rng() < 0.5 ? '#f7d94c' : '#f299c0', 1);
    }
  }
}

/** Cobblestone floor texture between y0 and the frame bottom. */
function cobbles(c: Ctx, seed: number, y0: number, base: string, line: string): void {
  flat(c, 0, y0, VIEW_W, VIEW_H - y0, base);
  seg(c, 0, y0, VIEW_W, y0, INK, LW);
  const rng = createRng(seed);
  c.strokeStyle = line;
  c.lineWidth = 1.5;
  let rowY = y0 + 6;
  let rowH = 9;
  let k = 0;
  while (rowY < VIEW_H) {
    const w = rowH * 2.4;
    for (let x = (k % 2) * w * 0.5 - w; x < VIEW_W + w; x += w) {
      c.beginPath();
      c.ellipse(x + w / 2 + (rng() - 0.5) * 3, rowY + rowH / 2, w / 2, rowH / 2, 0, 0, Math.PI * 2);
      c.stroke();
    }
    rowY += rowH;
    rowH += 3;  // closer rows read bigger
    k++;
  }
}

/** Perspective checker tile floor from y0 down. */
function checkerFloor(c: Ctx, y0: number, colA: string, colB: string): void {
  flat(c, 0, y0, VIEW_W, VIEW_H - y0, colA);
  seg(c, 0, y0, VIEW_W, y0, INK, LW);
  let y = y0;
  let h = 10;
  let k = 0;
  while (y < VIEW_H) {
    const w = h * 2.2;
    for (let x = (k % 2) * w - w; x < VIEW_W + w; x += w * 2) {
      c.fillStyle = colB;
      c.fillRect(x, y, w, h);
    }
    y += h;
    h += 5;
    k++;
  }
}

/** Wooden plank floor from y0 down (boards + nail dots). */
function planks(c: Ctx, y0: number, base: string, line: string): void {
  flat(c, 0, y0, VIEW_W, VIEW_H - y0, base);
  seg(c, 0, y0, VIEW_W, y0, INK, LW);
  let y = y0 + 8;
  let h = 10;
  let k = 0;
  while (y < VIEW_H) {
    seg(c, 0, y, VIEW_W, y, line, 2);
    const off = (k % 2) * 90;
    for (let x = off + 40; x < VIEW_W; x += 180) {
      seg(c, x, y - h + 2, x, y - 1, line, 1.5);
    }
    y += h;
    h += 4;
    k++;
  }
}

/** Stone-block wall with per-block 2-tone shading (dungeon sincerity). */
function stoneWall(c: Ctx, seed: number, y0: number, y1: number, base: string, dark: string, light: string): void {
  flat(c, 0, y0, VIEW_W, y1 - y0, base);
  const rng = createRng(seed);
  const bh = 26;
  for (let y = y0, row = 0; y < y1; y += bh, row++) {
    const off = (row % 2) * 26;
    for (let x = -26 + off; x < VIEW_W; x += 52) {
      const w = 52, h = Math.min(bh, y1 - y);
      c.fillStyle = rng() < 0.25 ? dark : base;
      c.fillRect(x, y, w - 2, h - 2);
      c.strokeStyle = 'rgba(6,8,18,0.55)';
      c.lineWidth = 2;
      c.strokeRect(x, y, w - 2, h - 2);
      c.strokeStyle = light;
      c.lineWidth = 1.2;
      seg(c, x + 2, y + 2, x + w - 6, y + 2, light, 1.2); // top bevel catch-light
    }
  }
}

function spotlightCone(c: Ctx, x: number, topW: number, botW: number, alpha: number): void {
  c.fillStyle = `rgba(255,244,190,${alpha})`;
  c.beginPath();
  c.moveTo(x - topW / 2, 0);
  c.lineTo(x + topW / 2, 0);
  c.lineTo(x + botW / 2, VIEW_H);
  c.lineTo(x - botW / 2, VIEW_H);
  c.closePath();
  c.fill();
}

/** Wall torch: bracket ON the wall, flickering flame + warm glow. */
function torch(c: Ctx, x: number, y: number, s: number, frame: number, phase: number): void {
  const fl = Math.sin(frame * 0.31 + phase) * 2 + Math.sin(frame * 0.13 + phase * 2) * 1.5;
  const g = c.createRadialGradient(x, y - 14 * s, 2, x, y - 14 * s, 46 * s);
  g.addColorStop(0, 'rgba(255,180,70,0.30)');
  g.addColorStop(1, 'rgba(255,180,70,0)');
  c.fillStyle = g;
  c.fillRect(x - 48 * s, y - 62 * s, 96 * s, 96 * s);
  poly(c, [[x - 3 * s, y], [x + 3 * s, y], [x + 5 * s, y + 12 * s], [x - 5 * s, y + 12 * s]], '#3d3f52', 2); // bracket
  rect(c, x - 2.5 * s, y - 10 * s, 5 * s, 10 * s, '#6b4420', 2);   // handle in the bracket
  ell(c, x + fl * 0.4, y - 16 * s - Math.abs(fl) * 0.5, 5 * s, 8 * s + Math.abs(fl), '#ff8c3a', 2);
  ell(c, x + fl * 0.3, y - 14 * s, 2.6 * s, 4.5 * s, '#ffd94d', 0);
}

/** Hanging wall banner on a rod (castle dressing) with an emblem letter. */
function banner(c: Ctx, x: number, y: number, w: number, h: number, col: string, colD: string, emblem: string): void {
  seg(c, x - w / 2 - 5, y, x + w / 2 + 5, y, '#8a7a5a', 3);        // the rod
  disc(c, x - w / 2 - 6, y, 3, COIN, 1.5);
  disc(c, x + w / 2 + 6, y, 3, COIN, 1.5);
  poly(c, [[x - w / 2, y], [x + w / 2, y], [x + w / 2, y + h - 10], [x, y + h], [x - w / 2, y + h - 10]], col, 2.5);
  poly(c, [[x - w / 2 + 5, y + h - 22], [x + w / 2 - 5, y + h - 22], [x + w / 2 - 5, y + h - 13], [x, y + h - 4], [x - w / 2 + 5, y + h - 13]], colD, 0);
  txt(c, emblem, x, y + h * 0.42, Math.max(10, h * 0.3), COIN, 'center', false);
}

/** Chandelier hanging from the ceiling on a chain; candles sit ON its ring. */
function chandelier(c: Ctx, x: number, y: number, s: number, frame: number): void {
  for (let k = 0; k < 4; k++) {
    c.beginPath(); c.ellipse(x, k * 8 * s, 2.6 * s, 4.4 * s, 0, 0, Math.PI * 2);
    c.strokeStyle = '#4c5470'; c.lineWidth = 2; c.stroke();
  }
  ell(c, x, y, 34 * s, 7 * s, '#6a5030', 2.5);            // the ring
  ell(c, x, y - 2 * s, 26 * s, 4 * s, '#83653c', 0);
  for (let i = -2; i <= 2; i++) {
    const cx = x + i * 15 * s;
    rect(c, cx - 2 * s, y - 10 * s, 4 * s, 8 * s, '#f4f0e6', 1.5);  // candles ON the ring
    const fl = Math.sin(frame * 0.3 + i * 1.7) * 1.4;
    ell(c, cx + fl * 0.4, y - 13 * s, 2 * s, 3.4 * s, '#ffb347', 1);
  }
  const g = c.createRadialGradient(x, y - 8 * s, 4, x, y - 8 * s, 70 * s);
  g.addColorStop(0, 'rgba(255,220,130,0.20)');
  g.addColorStop(1, 'rgba(255,220,130,0)');
  c.fillStyle = g;
  c.fillRect(x - 72 * s, y - 80 * s, 144 * s, 120 * s);
}

/** Arched stained-glass window set INTO a wall, glowing. */
function stainedGlass(c: Ctx, x: number, y: number, w: number, h: number, glow: number): void {
  c.save();
  c.beginPath();
  c.moveTo(x - w / 2, y + h);
  c.lineTo(x - w / 2, y + h * 0.3);
  c.arc(x, y + h * 0.3, w / 2, Math.PI, 0);
  c.lineTo(x + w / 2, y + h);
  c.closePath();
  c.clip();
  const cols = ['#7c4fd0', '#d04f6a', '#3f8fd0', '#d0a53f'];
  for (let i = 0; i < 4; i++) {
    c.fillStyle = cols[i]!;
    c.globalAlpha = 0.55 + glow * 0.3;
    c.fillRect(x - w / 2 + (i % 2) * (w / 2), y + Math.floor(i / 2) * (h / 2), w / 2, h / 2);
  }
  c.globalAlpha = 1;
  // a big coin emblem in the glass (they redecorated)
  disc(c, x, y + h * 0.45, w * 0.22, COIN, 2);
  txt(c, '$', x, y + h * 0.45 + 1, w * 0.28, '#8a5a00', 'center', false);
  c.strokeStyle = '#2a2438';
  c.lineWidth = 3;
  seg(c, x, y, x, y + h, '#2a2438', 3);
  seg(c, x - w / 2, y + h * 0.5, x + w / 2, y + h * 0.5, '#2a2438', 3);
  c.restore();
  c.beginPath();
  c.moveTo(x - w / 2, y + h);
  c.lineTo(x - w / 2, y + h * 0.3);
  c.arc(x, y + h * 0.3, w / 2, Math.PI, 0);
  c.lineTo(x + w / 2, y + h);
  c.closePath();
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.stroke();
}

// --- stagecraft gags (the conspirators' sets are terrible) -------------------

/** Cardboard cloud on a visible wooden prop stick, patched with tape. */
function propCloud(c: Ctx, x: number, y: number, s: number, groundY: number, taped: boolean): void {
  seg(c, x, groundY, x, y + 8 * s, '#8a5a2b', 4);                 // the stick reaches the GROUND
  poly(c, [[x - 8 * s, groundY], [x + 8 * s, groundY], [x + 5 * s, groundY - 6 * s], [x - 5 * s, groundY - 6 * s]], '#6b4420', 2); // its base wedge
  ell(c, x, y, 30 * s, 12 * s, '#f5f2e8', 2.5);
  ell(c, x - 14 * s, y - 7 * s, 14 * s, 8 * s, '#f5f2e8', 2.5);
  ell(c, x + 12 * s, y - 6 * s, 12 * s, 7 * s, '#f5f2e8', 2.5);
  if (taped) {
    seg(c, x + 8 * s, y + 2 * s, x + 20 * s, y - 8 * s, 'rgba(200,190,150,0.9)', 5);  // duct-tape cross
    seg(c, x + 8 * s, y - 8 * s, x + 20 * s, y + 2 * s, 'rgba(200,190,150,0.9)', 5);
  }
  txt(c, 'CLOUD (PROP)', x, y + 1, Math.max(6, 6 * s), '#b9b2a4', 'center', false);
}

/** Stage light on a tripod standing ON groundY, aimed at (ax,ay). */
function stageLight(c: Ctx, x: number, groundY: number, s: number, ax: number, ay: number, on: boolean): void {
  seg(c, x, groundY - 34 * s, x - 12 * s, groundY, '#3d3f52', 3);  // tripod legs
  seg(c, x, groundY - 34 * s, x + 12 * s, groundY, '#3d3f52', 3);
  seg(c, x, groundY - 34 * s, x, groundY, '#3d3f52', 3);
  const la = Math.atan2(ay - (groundY - 40 * s), ax - x);
  if (on) {
    c.save();
    c.globalAlpha = 0.16;
    poly(c, [[x, groundY - 40 * s], [ax - 30, ay + 20], [ax + 40, ay - 10]], '#fff4be', 0);
    c.restore();
  }
  c.save();
  c.translate(x, groundY - 40 * s);
  c.rotate(la);
  rect(c, -8 * s, -7 * s, 18 * s, 14 * s, '#2c2e3c', 2.5);
  ell(c, 11 * s, 0, 3.5 * s, 7 * s, on ? '#ffe9a0' : '#6b6a58', 2);
  c.restore();
}

/** The sky is a painted canvas: seam lines, a wrinkle, one curling corner. */
function backdropSeams(c: Ctx, x1: number, x2: number, y1: number): void {
  c.strokeStyle = 'rgba(40,30,60,0.20)';
  c.lineWidth = 2;
  seg(c, x1, 0, x1, y1, 'rgba(40,30,60,0.20)', 2);   // vertical canvas seams
  seg(c, x2, 0, x2, y1, 'rgba(40,30,60,0.20)', 2);
  c.beginPath();                                      // a sagging wrinkle
  c.moveTo(x1, 40);
  c.quadraticCurveTo((x1 + x2) / 2, 58, x2, 44);
  c.stroke();
  // curling top-right corner of the backdrop, canvas back showing
  poly(c, [[VIEW_W - 46, 0], [VIEW_W, 0], [VIEW_W, 34]], '#c8bfa8', 2.5);
  seg(c, VIEW_W - 46, 0, VIEW_W, 34, '#8a8070', 2);
}

/** Boom mic dipping into the top of the frame (held from off-screen). */
function boomMic(c: Ctx, x: number, frame: number): void {
  const dip = Math.sin(frame * 0.03) * 6;
  seg(c, x + 60, -4, x + 8, 26 + dip, '#3d3f52', 5);   // the pole comes from above the frame
  ell(c, x, 32 + dip, 16, 10, '#585a6e', 2.5);
  c.strokeStyle = '#3d3f52';
  c.lineWidth = 1.5;
  for (let i = -1; i <= 1; i++) {
    c.beginPath(); c.ellipse(x, 32 + dip, 16 - Math.abs(i) * 5, 10 - Math.abs(i) * 3, i * 0.3, 0, Math.PI * 2); c.stroke();
  }
}

/** Coins arcing between two points (t offset per coin from frame). */
function coinArc(c: Ctx, x0: number, y0: number, x1: number, peak: number, n: number, frame: number): void {
  for (let i = 0; i < n; i++) {
    const t = ((frame * 0.02 + i / n) % 1);
    const cx = x0 + t * (x1 - x0);
    const cy = y0 - Math.sin(t * Math.PI) * peak;
    coin(c, cx, cy, 7);
    if (i % 2 === 0) sparkle(c, cx + 6, cy - 6, 3, frame, i * 1.7);
  }
}

/** Falling confetti field (seeded columns, frame-driven fall). */
function confetti(c: Ctx, seed: number, n: number, frame: number, cols: readonly string[]): void {
  const rng = createRng(seed);
  for (let i = 0; i < n; i++) {
    const x0 = rng() * VIEW_W;
    const speed = 0.5 + rng() * 0.7;
    const ph = rng() * VIEW_H;
    const col = cols[Math.floor(rng() * cols.length)]!;
    const sway = Math.sin(frame * 0.06 + i) * 6;
    const y = (ph + frame * speed) % (VIEW_H + 12) - 6;
    c.save();
    c.translate(x0 + sway, y);
    c.rotate(frame * 0.05 + i);
    c.fillStyle = col;
    c.fillRect(-2.5, -1.5, 5, 3);
    c.restore();
  }
}

/** Dust motes drifting in a light shaft (sincere panels). */
function motes(c: Ctx, seed: number, n: number, x0: number, y0: number, w: number, h: number, frame: number): void {
  const rng = createRng(seed);
  for (let i = 0; i < n; i++) {
    const px = x0 + rng() * w + Math.sin(frame * 0.02 + i * 1.3) * 8;
    const py = y0 + ((rng() * h + frame * (0.1 + rng() * 0.2)) % h);
    const a = 0.25 + 0.3 * Math.sin(frame * 0.05 + i);
    c.fillStyle = `rgba(255,244,200,${Math.max(0.08, a).toFixed(2)})`;
    c.fillRect(px, py, 2, 2);
  }
}

/** Distant castle silhouette (towers + flags) on the horizon. */
function castleSilhouette(c: Ctx, x: number, baseY: number, s: number, col: string): void {
  flat(c, x - 40 * s, baseY - 60 * s, 80 * s, 60 * s, col);
  for (const dx of [-40, 40]) {
    flat(c, x + dx * s - 12 * s, baseY - 84 * s, 24 * s, 84 * s, col);
    poly(c, [[x + dx * s - 15 * s, baseY - 84 * s], [x + dx * s + 15 * s, baseY - 84 * s], [x + dx * s, baseY - 106 * s]], col, 0);
  }
  for (let i = -3; i <= 3; i += 2) flat(c, x + i * 10 * s, baseY - 66 * s, 6 * s, 6 * s, col);
  seg(c, x, baseY - 106 * s + 2, x, baseY - 118 * s, col, 2);
  poly(c, [[x, baseY - 118 * s], [x + 12 * s, baseY - 114 * s], [x, baseY - 110 * s]], col, 0);
}

/** A row of far-background cheering/standing toad silhouettes. */
function toadCrowdSilhouette(c: Ctx, seed: number, y: number, n: number, col: string, frame: number): void {
  const rng = createRng(seed);
  for (let i = 0; i < n; i++) {
    const x = 8 + (i + rng() * 0.6) * (VIEW_W / n);
    const s = 0.5 + rng() * 0.4;
    const bob = Math.sin(frame * 0.08 + i * 1.1) * 2 * s;
    c.fillStyle = col;
    c.fillRect(x - 5 * s, y - 14 * s + bob, 10 * s, 14 * s);
    c.beginPath();
    c.arc(x, y - 16 * s + bob, 8 * s, Math.PI * 0.95, Math.PI * 2.05);
    c.fill();
  }
}

// ============================================================================
// SCENES
// ============================================================================
type SceneFn = (c: Ctx, frame: number) => void;

// --- intro 1: the betting shop ----------------------------------------------
const sceneBetShop: SceneFn = (c, frame) => {
  // BACK: purple parlor wall with wallpaper stripes + crown molding
  vgrad(c, [[0, '#5a3a78'], [0.7, '#4a2f66'], [1, '#3a2456']]);
  for (let x = 8; x < VIEW_W; x += 36) flat(c, x, 24, 16, 274, 'rgba(255,255,255,0.05)');
  flat(c, 0, 18, VIEW_W, 8, '#6e4e8c');
  seg(c, 0, 26, VIEW_W, 26, INK, 2);
  // string of star lamps hung on a cord spanning the ceiling
  c.strokeStyle = '#2a1c40'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, 8); c.quadraticCurveTo(320, 26, VIEW_W, 8); c.stroke();
  for (let i = 0; i < 6; i++) {
    const lx = 70 + i * 100;
    const t = lx / VIEW_W;
    const cy = 8 + 4 * Math.sin(Math.PI * t) * 3.4;
    seg(c, lx, cy, lx, cy + 10, '#2a1c40', 2);          // each lamp hangs from the cord
    const gl = 0.5 + 0.5 * Math.sin(frame * 0.08 + i * 1.4);
    const g = c.createRadialGradient(lx, cy + 15, 1, lx, cy + 15, 22);
    g.addColorStop(0, `rgba(255,220,120,${(0.25 + gl * 0.2).toFixed(2)})`);
    g.addColorStop(1, 'rgba(255,220,120,0)');
    c.fillStyle = g; c.fillRect(lx - 24, cy - 8, 48, 48);
    sparkle(c, lx, cy + 15, 7, frame, i * 1.4);
    disc(c, lx, cy + 15, 3, COIN, 1.5);
  }
  // MID: the odds board, hanging from the molding on two chains
  seg(c, 60, 26, 70, 48, '#8a8494', 2.5);
  seg(c, 240, 26, 230, 48, '#8a8494', 2.5);
  rect(c, 30, 48, 250, 92, '#173322');
  rect(c, 36, 54, 238, 80, '#1d422b', 2);
  txt(c, 'TODAY', 155, 68, 12, '#9be89b');
  txt(c, 'PEACH KIDNAPPED:', 155, 90, 15, '#f4f0e6');
  txt(c, '1000000:1', 155, 116, 22, COIN);
  // marquee sign over the counter, chase bulbs around the border
  rect(c, 366, 50, 264, 62, '#20222c');
  rect(c, 372, 56, 252, 50, '#2c2e3c', 2);
  txt(c, "TOAD'S BETS", 498, 74, 25, COIN);
  txt(c, 'IMPOSSIBLE TO LOSE!*', 498, 96, 12, '#ff9d9d');
  txt(c, '*you will lose', 440, 122, 7, '#8f86a4', 'center', false);
  for (let i = 0; i < 22; i++) {
    const per = 22, k = i % per;
    const bx = k < 8 ? 370 + k * 37 : k < 11 ? 630 : k < 19 ? 630 - (k - 11) * 37 : 366;
    const by = k < 8 ? 50 : k < 11 ? 50 + (k - 8) * 21 : k < 19 ? 112 : 112 - (k - 19) * 21;
    const on = ((frame >> 3) + i) % 3 !== 0;
    disc(c, bx, by, 3, on ? '#ffe9a0' : '#5a4a30', 1.5);
  }
  // the vault pipe: stands on the floor behind the counter, braced to the wall
  pipe(c, 556, 262, 52, 118, '#2f9e44', '#1f6f30');
  seg(c, 556, 180, 540, 172, '#3d3f52', 4);            // wall brace strut
  seg(c, 608, 180, 624, 172, '#3d3f52', 4);
  txt(c, 'TO VAULT', 582, 168, 8, '#9be89b', 'center', false);
  // FLOOR: casino checker tiles + the queue carpet
  checkerFloor(c, 298, '#3d2a58', '#33204a');
  poly(c, [[6, 360], [330, 306], [372, 306], [92, 360]], '#8a2432', 2); // carpet runner to the counter
  // the counter (wood grain top, paneled front) — Estrada's stage
  flat(c, 360, 252, 280, 14, '#9a6230');
  seg(c, 360, 252, VIEW_W, 252, INK, LW);
  seg(c, 360, 266, VIEW_W, 266, INK, 2);
  flat(c, 360, 266, 280, 94, '#7c4a1f');
  for (let x = 376; x < 640; x += 52) rect(c, x, 276, 38, 66, '#6b4420', 2); // front panels
  seg(c, 364, 258, 636, 258, COIN_DARK, 2);            // brass rail along the counter
  // ON the counter: register, service bell, tips jar
  rect(c, 382, 224, 46, 28, '#3d3f52', 2.5);
  flat(c, 386, 228, 20, 10, '#9be89b');
  txt(c, '$$$', 396, 233, 8, '#173322', 'center', false);
  disc(c, 452, 248, 7, COIN, 2);                        // service bell ON the counter
  rect(c, 450, 238, 4, 4, '#3d3f52', 1.5);
  rect(c, 478, 226, 30, 26, 'rgba(190,220,255,0.25)', 2); // tips jar ON the counter
  coin(c, 488, 244, 5); coin(c, 498, 246, 5);
  txt(c, 'TIPS', 493, 232, 7, '#f4f0e6', 'center', false);
  // Estrada the smug teller, behind the counter (front panel hides his legs)
  drawEstrada(c, 545, 312, 0.98, { facing: -1, eyes: 'smug', mouth: 'grin', arms: 'down' });
  flat(c, 362, 267, 276, 92, 'rgba(60,36,14,0.35)'); // counter front re-shades his lower half
  // coins arc from the register INTO the vault pipe mouth
  coinArc(c, 405, 224, 582, 78, 7, frame);
  // founder's portrait between the boards (every branch must hang one)
  rect(c, 290, 148, 60, 72, '#6a5030', 2.5);
  rect(c, 296, 154, 48, 50, '#d8c8e8', 1.5);
  c.save();
  c.beginPath(); c.rect(296, 154, 48, 50); c.clip();
  poly(c, [[306, 204], [334, 204], [330, 190], [310, 190]], '#2c3e6e', 1.5); // suit shoulders
  poly(c, [[317, 190], [323, 190], [321, 204], [319, 204]], P.tie, 1.5);     // the tie, in oils
  ell(c, 320, 178, 13, 12, P.orange, 2);
  c.fillStyle = P.orangePale;
  c.beginPath(); c.ellipse(320, 175, 9, 4.5, 0, 0, Math.PI * 2); c.fill();
  seg(c, 313, 174, 317, 173.4, INK, 2); seg(c, 323, 173.4, 327, 174, INK, 2); // squint
  ell(c, 320, 184, 3.2, 2.2, '#e0885e', 1.5);                                 // pout
  c.beginPath(); c.moveTo(306, 170); c.quadraticCurveTo(320, 158, 334, 166);
  c.quadraticCurveTo(340, 168, 338, 161); c.lineTo(332, 168); c.closePath();
  c.fillStyle = P.wig; c.fill(); c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
  c.restore();
  txt(c, 'FOUNDER', 320, 213, 7, COIN, 'center', false);
  // the queue: toads of all sizes clutching coins, bobbing with hope
  const bob = (i: number): number => Math.sin(frame * 0.06 + i * 1.3) * 2;
  drawToad(c, 322, 320 + bob(0), 1.1, { facing: 1, mood: 'shock', coin: true, spot: '#e04848', vest: '#5f76d8' });
  drawToad(c, 252, 326 + bob(1), 1.05, { facing: 1, mood: 'adore', coin: true, spot: '#3f8fd0', vest: '#d8635f' });
  drawToad(c, 182, 322 + bob(2), 0.95, { facing: 1, mood: 'cheer', coin: true, spot: '#3a9a3a', vest: '#8a5fd8' });
  drawToad(c, 116, 330 + bob(3), 1.15, { facing: 1, mood: 'shock', coin: true, spot: '#e08a2e', vest: '#3a7a4a' });
  drawToad(c, 52, 324 + bob(4), 0.9, { facing: 1, mood: 'adore', coin: true, spot: '#d048a8', vest: '#b8862e' });
  // velvet queue rope: posts standing ON the floor, rope sagging between
  for (const px of [88, 218, 348]) {
    rect(c, px - 3, 268, 6, 44, '#6a5030', 2);
    disc(c, px, 264, 6, COIN, 2);
    ell(c, px, 314, 12, 4, 'rgba(0,0,0,0.3)', 0);       // post base shadow ON the tiles
  }
  c.strokeStyle = '#a83240'; c.lineWidth = 4;
  for (let i = 0; i < 2; i++) {
    const x0 = 88 + i * 130, x1 = 218 + i * 130;
    c.beginPath(); c.moveTo(x0, 270); c.quadraticCurveTo((x0 + x1) / 2, 290, x1, 270); c.stroke();
  }
  // sight gag: a foreclosure notice already on the wall, day one
  c.save(); c.translate(318, 244); c.rotate(-0.05);
  rect(c, -26, -16, 52, 32, '#f4f0e6', 2);
  txt(c, 'SOON:', 0, -7, 8, '#b9412f', 'center', false);
  txt(c, 'FORECLOSED', 0, 5, 8, '#b9412f', 'center', false);
  c.restore();
  txt(c, 'ALL BETS CERTIFIED BY A REAL ROYAL NOTARY', 320, 350, 11, '#cbb8ff');
  vignette(c, 0.30);
};

// --- intro 2: the notary office ----------------------------------------------
const sceneNotary: SceneFn = (c, frame) => {
  // BACK: wood-panel wall, candle-warm
  vgrad(c, [[0, '#3a2c1c'], [0.8, '#2c2114'], [1, '#241a10']]);
  for (let x = 100; x < VIEW_W; x += 82) {          // panel bevels
    rect(c, x, 40, 66, 160, '#40301e', 2);
    rect(c, x + 8, 48, 50, 144, '#38291a', 1.5);
  }
  flat(c, 0, 200, VIEW_W, 10, '#4a3826');           // wainscot rail
  seg(c, 0, 200, VIEW_W, 200, INK, 2);
  // bookshelf, far left, stuffed with ledgers (and one coin stack ON a shelf)
  rect(c, 8, 52, 84, 158, '#4a3018', 2.5);
  for (let sh = 0; sh < 3; sh++) {
    const sy = 74 + sh * 48;
    flat(c, 12, sy + 26, 76, 5, '#38240f');
    const cols = ['#7c3a2e', '#3a5a7c', '#6a5030', '#4a6a3a', '#7c3a5e'];
    for (let b = 0; b < 5; b++) {
      rect(c, 15 + b * 14, sy - 6 + (b % 2) * 3, 12, 32 - (b % 2) * 3, cols[(b + sh) % 5]!, 1.5);
    }
  }
  coin(c, 30, 66, 5); coin(c, 42, 66, 5); coin(c, 36, 56, 5); // gold ON the top shelf
  // framed credentials (one hangs crooked — nobody checked)
  const frame1 = (fx: number, fy: number, rot: number, l1: string, l2: string): void => {
    c.save(); c.translate(fx, fy); c.rotate(rot);
    rect(c, -22, -17, 44, 34, '#6a5030', 2.5);
    rect(c, -17, -12, 34, 24, '#f0e4c8', 1.5);
    txt(c, l1, 0, -4, 6, '#3a2c1c', 'center', false);
    txt(c, l2, 0, 5, 5, '#8a7a5a', 'center', false);
    c.restore();
  };
  frame1(116, 84, 0, 'DIPLOMA', '(mail)');
  frame1(116, 138, 0.09, 'MOUSTACHE', '1st place');
  // the window: night outside — moon, hand-set stars, a distant castle
  rect(c, 470, 36, 130, 138, '#4a3018', 3);
  c.save();
  c.beginPath(); c.rect(476, 42, 118, 126); c.clip();
  const ng = c.createLinearGradient(0, 42, 0, 168);
  ng.addColorStop(0, '#101a30'); ng.addColorStop(1, '#1c2c48');
  c.fillStyle = ng; c.fillRect(476, 42, 118, 126);
  moon(c, 560, 74, 15);
  const wrng = createRng(88);
  for (let i = 0; i < 14; i++) {
    const a = 0.4 + 0.5 * Math.sin(frame * 0.05 + i * 1.7);
    c.fillStyle = `rgba(255,250,220,${a.toFixed(2)})`;
    c.fillRect(478 + wrng() * 114, 44 + wrng() * 70, 2, 2);
  }
  castleSilhouette(c, 520, 168, 0.34, '#0c1424');
  c.restore();
  seg(c, 535, 42, 535, 168, '#4a3018', 4);          // window mullions
  seg(c, 476, 105, 594, 105, '#4a3018', 4);
  // moonlight spills from the window onto the floor
  c.save(); c.globalAlpha = 0.10;
  poly(c, [[476, 168], [594, 168], [640, 320], [430, 320]], '#bcd8ff', 0);
  c.restore();
  // FLOOR: planks + a round rug under the desk
  planks(c, 310, '#4a3520', '#3a2814');
  ell(c, 320, 336, 250, 24, '#5a2c28', 2.5);
  ell(c, 320, 336, 220, 18, '#6a3830', 2);
  // THE DESK (x 120..520, top 240) — everything on it stays inside that span
  flat(c, 120, 240, 400, 12, '#835b2f');
  seg(c, 120, 240, 520, 240, INK, LW);
  flat(c, 120, 252, 400, 58, '#6b4420');
  seg(c, 120, 252, 520, 252, INK, 2);
  for (let x = 140; x < 500; x += 70) rect(c, x, 260, 50, 42, '#5c3a1a', 2); // desk front panels
  // the TRANSPARENT URN of bet slips, ON the desk. Pile lives INSIDE the glass.
  const uX = 140, uW = 160, uTop = 128, uBottom = 240;
  const slip = (px: number, py: number, rot: number): void => {
    c.save(); c.translate(px, py); c.rotate(rot);
    rect(c, -16, -10, 32, 20, '#f4f0e6', 2);
    seg(c, -10, -3, 10, -3, '#b9b2a4', 1.5);
    seg(c, -10, 3, 8, 3, '#b9b2a4', 1.5);
    c.restore();
  };
  flat(c, uX, uTop, uW, uBottom - uTop, 'rgba(190,220,255,0.10)');
  const rng = createRng(202);
  c.save();
  c.beginPath(); c.rect(uX + 3, uTop + 10, uW - 6, uBottom - uTop - 13); c.clip();
  for (let i = 0; i < 26; i++) {
    const px = uX + 14 + rng() * (uW - 28);
    const py = uBottom - 14 - rng() * rng() * (uBottom - uTop - 44);
    slip(px, py, (rng() - 0.5) * 0.9);
  }
  c.restore();
  const dropT = (frame * 0.012) % 1;                 // one slip forever dropping in
  if (dropT < 0.55) slip(uX + uW / 2, uTop - 18 + dropT * 60, dropT * 1.2);
  flat(c, uX, uTop, uW, uBottom - uTop, 'rgba(210,235,255,0.12)');
  c.save();
  c.beginPath();
  c.moveTo(uX + 18, uBottom); c.lineTo(uX + 52, uTop); c.lineTo(uX + 70, uTop);
  c.lineTo(uX + 36, uBottom); c.closePath();
  c.fillStyle = 'rgba(255,255,255,0.10)'; c.fill();
  c.restore();
  c.lineWidth = 3; c.strokeStyle = '#141020';
  c.strokeRect(uX, uTop, uW, uBottom - uTop);
  rect(c, uX - 6, uTop - 8, uW + 12, 10, '#835b2f', 2);            // lid
  flat(c, uX + uW / 2 - 22, uTop - 5, 44, 4, '#141020');           // the slot
  rect(c, uX + uW / 2 - 26, uBottom - 26, 52, 16, '#f4f0e6', 2);   // label
  txt(c, 'BETS', uX + uW / 2, uBottom - 14, 10, P.estradaRed);
  // loose slips flat ON the desk + the one mid-stamp
  slip(330, 232, 0.08);
  slip(352, 234, -0.12);
  rect(c, 382, 214, 84, 26, '#f4f0e6', 2);
  txt(c, 'CERTIFIED', 424, 227, 11, P.estradaRed);
  // inkpot + quill ON the desk (quill stands IN the pot)
  rect(c, 474, 224, 16, 16, '#20222c', 2);
  c.strokeStyle = '#d9d4c4'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(482, 226); c.quadraticCurveTo(490, 206, 498, 198 + Math.sin(frame * 0.04) * 2); c.stroke();
  // candle ON the desk (x within 120..520 — audited)
  rect(c, 500, 216, 10, 26, '#f4f0e6', 2);
  ell(c, 505, 242, 8, 3, '#d8d2c2', 1.5);            // wax drips pool ON the desk
  const fl = Math.sin(frame * 0.3) * 2;
  const cg = c.createRadialGradient(505, 208, 2, 505, 208, 60);
  cg.addColorStop(0, 'rgba(255,190,90,0.30)');
  cg.addColorStop(1, 'rgba(255,190,90,0)');
  c.fillStyle = cg; c.fillRect(445, 150, 120, 120);
  ell(c, 505 + fl * 0.4, 208 + Math.abs(fl) * 0.6, 4, 7, '#ffb347', 2);
  ell(c, 505 + fl * 0.3, 210, 1.8, 3, '#ffe9a0', 0);
  motes(c, 77, 8, 440, 160, 130, 90, frame);        // dust drifting in the glow
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
  txt(c, 'ROYAL NOTARY OFFICE — TOTALLY INDEPENDENT', 320, 26, 13, '#e8d5a0');
  txt(c, '(fee: 40%)', 320, 44, 11, '#b9a26a');
  // FOREGROUND: a stack of "ARCHIVE" ledgers looms bottom-left, near-camera
  rect(c, -20, 316, 150, 22, '#5a3a24', 3);
  rect(c, -12, 296, 134, 20, '#6a4a2e', 3);
  rect(c, -24, 276, 128, 20, '#4a3018', 3);
  txt(c, 'ARCHIVE (DO NOT OPEN)', 46, 287, 8, '#c8b088', 'center', false);
  vignette(c, 0.36);
};

// --- intro 3 + w2/w3 beats: the real dungeon (sincere, no stagecraft) --------
const sceneDungeon: SceneFn = (c, frame) => {
  vgrad(c, [[0, '#101426'], [1, '#05070f']]);
  stoneWall(c, 41, 0, 300, '#1c2338', '#151b2e', 'rgba(120,140,190,0.16)');
  // moss patches cling to the stones
  const mrng = createRng(43);
  c.fillStyle = 'rgba(60,110,70,0.35)';
  for (let i = 0; i < 9; i++) {
    const mx = mrng() * VIEW_W, my = 40 + mrng() * 240;
    c.beginPath(); c.ellipse(mx, my, 8 + mrng() * 10, 4 + mrng() * 4, 0, 0, Math.PI * 2); c.fill();
  }
  // the barred window, high right: the moon looks in
  rect(c, 444, 26, 76, 54, '#0a0e1c', 2.5);
  c.save();
  c.beginPath(); c.rect(446, 28, 72, 50); c.clip();
  moon(c, 492, 50, 13);
  c.restore();
  seg(c, 468, 26, 468, 80, INK, 4);
  seg(c, 494, 26, 494, 80, INK, 4);
  seg(c, 444, 52, 520, 52, INK, 3);
  // moonlight shaft to the floor, breathing gently; dust motes ride it
  c.save();
  c.globalAlpha = 0.24 + Math.sin(frame * 0.02) * 0.04;
  poly(c, [[446, 80], [518, 80], [430, 320], [260, 320]], '#cfe0ff', 0);
  c.restore();
  motes(c, 91, 14, 280, 90, 200, 220, frame);
  // wall torch, left — the only warmth in the room
  torch(c, 84, 120, 1.25, frame, 0);
  // the old MISSING poster, quietly out of date
  c.save(); c.translate(104, 170); c.rotate(0.06);
  rect(c, -30, -22, 60, 44, '#e8ddc0', 2);
  txt(c, 'MISSING:', 0, -12, 7, '#3a2c1c', 'center', false);
  txt(c, 'PRINCESS', 0, -2, 7, '#3a2c1c', 'center', false);
  txt(c, 'reward: cancelled', 0, 12, 5, '#8a6a4a', 'center', false);
  c.restore();
  // hanging chains with shackles (someone upgraded to a crate seat)
  for (const cx of [150, 196]) {
    c.strokeStyle = '#4c5470'; c.lineWidth = 3;
    for (let k = 0; k < 7; k++) { c.beginPath(); c.ellipse(cx, 18 + k * 15, 5, 8, 0, 0, Math.PI * 2); c.stroke(); }
    ell(c, cx, 128, 9, 6, '#4c5470', 2);
  }
  // tally marks scratched into the wall: day 94 of "storage"
  c.strokeStyle = 'rgba(220,228,255,0.5)'; c.lineWidth = 2;
  for (let g = 0; g < 4; g++) {
    for (let i = 0; i < 4; i++) seg(c, 140 + g * 26 + i * 5, 216, 142 + g * 26 + i * 5, 232, 'rgba(220,228,255,0.5)', 2);
    seg(c, 138 + g * 26, 232, 158 + g * 26, 216, 'rgba(220,228,255,0.5)', 2);
  }
  // complaint box ON the wall, overflowing (the rats are unionizing)
  rect(c, 540, 168, 56, 36, '#5c4322', 2.5);
  flat(c, 548, 174, 40, 5, '#141020');
  for (let i = 0; i < 3; i++) rect(c, 546 + i * 15, 162 - (i % 2) * 5, 14, 10, '#f4f0e6', 1.5); // letters jammed in the slot
  txt(c, 'COMPLAINTS', 568, 194, 7, '#c8b088', 'center', false);
  // FLOOR: cobbles + straw + drip puddles
  cobbles(c, 45, 300, '#141a2e', 'rgba(70,84,120,0.5)');
  c.strokeStyle = '#8a7a3a'; c.lineWidth = 2;              // straw pile, bottom-left
  const srng = createRng(47);
  for (let i = 0; i < 22; i++) {
    const sx = 40 + srng() * 110, sy = 306 + srng() * 30;
    seg(c, sx, sy, sx + 10 - srng() * 20, sy - 4 - srng() * 4, '#8a7a3a', 2);
  }
  // THE POKER GAME. Crate table; cards + pebble-chips ON the crate.
  rect(c, 286, 252, 104, 48, '#5c4322', 2.5);
  seg(c, 286, 276, 390, 276, '#3d2c15', 2);
  seg(c, 338, 252, 338, 300, '#3d2c15', 2);
  flat(c, 286, 252, 104, 8, '#6b4f2a');
  for (let i = 0; i < 3; i++) {                            // discard pile ON the crate
    c.save(); c.translate(316 + i * 18, 248); c.rotate((i - 1) * 0.2);
    rect(c, -6, -8, 12, 16, '#f4f0e6', 1.5);
    disc(c, 0, 0, 1.6, i === 1 ? P.toadRed : INK, 0);
    c.restore();
  }
  disc(c, 372, 244, 4, '#9aa2c2', 1.5);                    // the pot: pebble chips ON the crate
  disc(c, 363, 246, 4, '#7a84a4', 1.5);
  disc(c, 368, 238, 4, '#b9b2a4', 1.5);
  // the real Peach: composed, unimpressed, winning by folding gracefully.
  // She sits ON her own crate (drawn first so she overlaps it).
  rect(c, 214, 262, 66, 38, '#5c4322', 2.5);
  seg(c, 214, 281, 280, 281, '#3d2c15', 2);
  drawPeach(c, 248, 266, 1.12, { facing: 1, pose: 'sit', mood: 'deadpan', holding: 'cards' });
  // the skeleton cellmate: sitting on the floor, WINNING (she lets him)
  skeleton(c, 452, 300, 1.05, { pose: 'poker', mood: 'happy' });
  coin(c, 428, 292, 5); coin(c, 440, 296, 5);              // his winnings, on the floor by his hip
  // spectator rat ON the barrel; floor rat passing through
  rect(c, 556, 252, 54, 48, '#6b4420', 2.5);
  for (const hy2 of [262, 288]) seg(c, 556, hy2, 610, hy2, '#3d2c15', 2);
  rat(c, 580, 252, 0.85, frame, 0.6);
  rat(c, 168, 300, 1, frame, 2.4);
  // drips from the ceiling landing in a puddle (ripples ring out)
  const dripT = (frame * 0.016) % 1;
  disc(c, 470, 84 + dripT * 240, 2.5, '#7fb7d9', 0);
  ell(c, 470, 330, 26, 6, 'rgba(110,150,190,0.25)', 0);    // the puddle
  const rippleT = ((frame * 0.016) + 0.5) % 1;
  c.strokeStyle = `rgba(150,190,230,${(0.5 - rippleT * 0.45).toFixed(2)})`;
  c.lineWidth = 1.5;
  c.beginPath(); c.ellipse(470, 330, 6 + rippleT * 20, 2 + rippleT * 4, 0, 0, Math.PI * 2); c.stroke();
  txt(c, 'DUNGEON B — LONG-TERM STORAGE', 320, 344, 11, '#5f6c96');
  // FOREGROUND: we watch through the cell-door bars
  for (const bx of [12, 30]) rect(c, bx, 0, 9, VIEW_H, '#0c101e', 2);
  for (const bx of [604, 622]) rect(c, bx, 0, 9, VIEW_H, '#0c101e', 2);
  flat(c, 0, 170, 48, 12, '#0c101e');
  flat(c, 596, 170, 44, 12, '#0c101e');
  vignette(c, 0.40);
};

// --- intro 4: the costume department -----------------------------------------
const sceneWardrobe: SceneFn = (c, frame) => {
  vgrad(c, [[0, '#43284e'], [1, '#241430']]);
  // pegboard wall with hooks: every conspiracy needs storage
  flat(c, 196, 40, 260, 104, '#3a2244');
  c.fillStyle = 'rgba(0,0,0,0.35)';
  for (let py = 50; py < 138; py += 16) for (let px = 206; px < 450; px += 16) { c.beginPath(); c.arc(px, py, 1.5, 0, Math.PI * 2); c.fill(); }
  seg(c, 196, 40, 456, 40, INK, 2); seg(c, 196, 144, 456, 144, INK, 2);
  // hooks with: spare crown, moustache card, goomba hood — all HUNG
  const hook = (hx: number): void => { seg(c, hx, 52, hx, 62, '#b9b2a4', 3); disc(c, hx, 62, 2.5, '#b9b2a4', 1.5); };
  hook(228); hook(300); hook(372); hook(432);
  poly(c, [[218, 70], [238, 70], [238, 63], [233, 67], [228, 62], [223, 67], [218, 63]], COIN, 2); // spare crown ON hook
  rect(c, 286, 66, 30, 22, '#f4f0e6', 2);                        // moustache card ON hook
  seg(c, 293, 76, 309, 76, P.hairDark, 3);
  txt(c, 'SPARE', 301, 84, 6, '#8a8494', 'center', false);
  ell(c, 372, 76, 13, 11, '#8a5a2b', 2.5);                       // goomba hood ON hook
  seg(c, 364, 72, 372, 74, INK, 2); seg(c, 380, 72, 372, 74, INK, 2);
  // checklist clipboard ON the pegboard
  rect(c, 416, 62, 34, 44, '#c8a468', 2);
  rect(c, 426, 58, 14, 7, '#8a8494', 1.5);
  txt(c, 'DRESS ok', 433, 74, 6, '#173322', 'center', false);
  txt(c, 'WIG ok', 433, 84, 6, '#173322', 'center', false);
  txt(c, 'HANDS ??', 433, 94, 6, '#b9412f', 'center', false);
  // the mirror, chase bulbs — star of the dressing room
  rect(c, 30, 40, 124, 176, '#7c6a8a', 2.5);
  flat(c, 40, 50, 104, 156, '#b9a8cc');
  poly(c, [[46, 200], [72, 56], [92, 56], [66, 200]], 'rgba(255,255,255,0.25)', 0); // mirror sheen
  // the reflection: orange face, yellow swoop, pout — admiring itself
  c.save();
  c.beginPath(); c.rect(40, 50, 104, 156); c.clip();
  poly(c, [[76, 206], [116, 206], [110, 160], [82, 160]], P.peachPink, 2);   // reflected gown
  poly(c, [[92, 168], [100, 168], [98, 196], [94, 196]], P.tie, 1.5);        // reflected tie
  ell(c, 96, 138, 17, 16, P.orange, 2);
  c.fillStyle = P.orangePale;
  c.beginPath(); c.ellipse(96, 134, 12, 6, 0, 0, Math.PI * 2); c.fill();
  seg(c, 88, 133, 93, 132, INK, 2); seg(c, 99, 132, 104, 133, INK, 2);       // squint
  ell(c, 96, 146, 4, 2.6, '#e0885e', 1.5);                                   // pout
  c.beginPath(); c.moveTo(80, 128); c.quadraticCurveTo(96, 112, 114, 122);
  c.quadraticCurveTo(120, 124, 118, 116);
  c.lineTo(112, 126); c.closePath();
  c.fillStyle = P.wig; c.fill(); c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
  c.restore();                     // reflected pout
  for (let i = 0; i < 10; i++) {
    const on = ((frame >> 4) + i) % 3 !== 0;
    const bx = i < 5 ? 30 + i * 31 : 30 + (i - 5) * 31;
    const by = i < 5 ? 34 : 222;
    disc(c, bx, by, 5, on ? '#ffe9a0' : '#6b5a44', 2);
  }
  // makeup table beside the mirror; everything sits ON its top (y=252)
  rect(c, 168, 252, 118, 54, '#6a4a7a', 2.5);
  flat(c, 168, 252, 118, 10, '#83609a');
  rect(c, 176, 226, 22, 26, '#f4f0e6', 2);                       // powder box ON table
  ell(c, 187, 222, 10, 5, '#e0d4f0', 2);                         // puff resting on it
  rect(c, 206, 234, 8, 18, '#c83a5e', 2);                        // lipstick ON table
  ell(c, 210, 232, 3, 4, '#e05a7a', 1.5);
  // the spare wig on its stand, ON the table
  rect(c, 246, 232, 7, 20, '#8a7a9a', 2);
  disc(c, 249, 226, 11, '#cbb8d9', 2.5);
  c.beginPath(); c.arc(249, 221, 13, Math.PI * 0.95, Math.PI * 2.02); c.closePath();
  c.fillStyle = P.wig; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
  poly(c, [[259, 216], [271, 212], [269, 219], [259, 221]], P.wig, 2);
  txt(c, 'HAIR (BACKUP)', 227, 274, 8, '#cbb8d9', 'center', false);
  // rolling costume rack, right: bar on two A-stands, wheels on the floor
  seg(c, 470, 148, 470, 296, '#8a7a9a', 4);
  seg(c, 620, 148, 620, 296, '#8a7a9a', 4);
  disc(c, 470, 300, 6, '#3d3f52', 2); disc(c, 620, 300, 6, '#3d3f52', 2);   // wheels ON the floor
  seg(c, 458, 152, 632, 152, '#8a7a9a', 4);
  const hang = (hx: number, sway: number): void => {
    seg(c, hx, 152, hx, 162 + sway, '#b9b2a4', 2);
    poly(c, [[hx - 12, 170 + sway], [hx + 12, 170 + sway], [hx + 6, 162 + sway], [hx - 6, 162 + sway]], '#b9b2a4', 1.5);
  };
  const sw = Math.sin(frame * 0.05) * 2;
  hang(492, sw); hang(544, -sw); hang(596, sw);
  poly(c, [[480, 170 + sw], [504, 170 + sw], [512, 234 + sw], [472, 234 + sw]], P.peachPink, 2.5);  // spare gown
  poly(c, [[532, 170 - sw], [556, 170 - sw], [560, 224 - sw], [528, 224 - sw]], '#3a9a3a', 2.5);    // 'shy guy' robe
  poly(c, [[586, 170 + sw], [606, 170 + sw], [612, 218 + sw], [580, 218 + sw]], '#5f76d8', 2.5);    // toad vest costume
  rect(c, 500, 200 + sw, 24, 12, '#f4f0e6', 1.5);
  txt(c, '9.99', 512, 206 + sw, 7, '#b9412f', 'center', false);  // price tag still on
  // FLOOR: stage planks + taped cable + the chalk mark
  planks(c, 306, '#33203e', '#281630');
  c.strokeStyle = '#141020'; c.lineWidth = 4;                    // cable taped across the floor
  c.beginPath(); c.moveTo(160, 360); c.quadraticCurveTo(300, 330, 470, 344); c.stroke();
  for (const [tx2, ty2] of [[250, 339], [390, 338]] as const) {
    seg(c, tx2 - 8, ty2 - 5, tx2 + 8, ty2 + 5, 'rgba(200,190,150,0.9)', 5);
    seg(c, tx2 - 8, ty2 + 5, tx2 + 8, ty2 - 5, 'rgba(200,190,150,0.9)', 5);
  }
  txt(c, 'IMPEACH STANDS HERE >', 250, 318, 8, 'rgba(230,220,250,0.6)', 'center', false);
  // Impeach mid-fitting: gown on, wig on, crown askew, judging the mirror.
  // hands 'down' keeps the one big glove low, clear of the face.
  drawImpeach(c, 330, 306, 1.05, { facing: -1, hands: 'down', mouth: 'pout', waveT: frame });
  // Bowsonaro fighting his shell straps — shell held UP by his own claws
  drawBowsonaro(c, 500, 306, 0.9, { facing: -1, pose: 'struggle', mouth: 'open', shellOn: false });
  c.save();
  c.translate(500, 238 + Math.sin(frame * 0.1) * 3);
  c.rotate(Math.sin(frame * 0.08) * 0.15);
  c.beginPath(); c.arc(0, 0, 24, Math.PI, 0); c.closePath();
  c.fillStyle = P.shellY; c.fill(); c.lineWidth = LW; c.strokeStyle = INK; c.stroke();
  flat(c, -24, -12, 48, 6, P.shellG);
  txt(c, '10', 0, -6, 9, '#fff', 'center', false);
  for (let i = -1; i <= 1; i++) poly(c, [[i * 15 - 4, -2], [i * 15 + 4, -2], [i * 15, -12]], '#d9d4c4', 2);
  seg(c, -22, 4, -34, 22, '#6b4420', 3); seg(c, 22, 4, 34, 22, '#6b4420', 3); // flailing straps
  c.restore();
  speechSpikes(c, 525, 250, 3, frame);
  txt(c, 'COSTUME DEPT — DO NOT TELL ANYONE', 320, 24, 13, '#e0c8f0');
  // FOREGROUND: stage curtain edge, left
  poly(c, [[0, 0], [26, 0], [20, 120], [28, 240], [18, 360], [0, 360]], '#5a1f2e', 3);
  for (let i = 0; i < 3; i++) seg(c, 6 + i * 7, 10, 4 + i * 7, 350, 'rgba(0,0,0,0.25)', 3);
  vignette(c, 0.32);
};

// --- intro 5 + w2 beat: the staged kidnap (worst set in showbiz) -------------
const sceneStagedKidnap: SceneFn = (c, frame) => {
  // BACK: painted-canvas sky with sun rays, seams, a curling corner
  vgrad(c, [[0, '#8fd0f0'], [0.7, '#c8e8e0'], [1, '#e8f4d8']]);
  c.save();
  c.translate(110, 46);
  c.rotate(frame * 0.002);
  for (let i = 0; i < 9; i++) {
    c.rotate(Math.PI / 4.5);
    c.fillStyle = 'rgba(255,240,180,0.15)';
    c.fillRect(-8, 0, 16, 420);
  }
  c.restore();
  disc(c, 110, 46, 26, '#fff2b0', 0);
  backdropSeams(c, 210, 430, 296);
  // cardboard clouds on their sticks (bases planted behind the hill crests)
  propCloud(c, 190, 108, 0.8, 292, true);
  propCloud(c, 306, 74, 0.55, 288, false);
  // DISTANT: checkered hills + a cottage village
  checkerHill(c, 90, 336, 250, 94, '#9cc86e', '#8ab458');
  checkerHill(c, 556, 344, 280, 100, '#8cba62', '#7aa850');
  cottage(c, 190, 298, 0.72, P.toadRed);
  cottage(c, 252, 298, 0.5, '#e08a2e');
  // sky blocks, hanging from the rig on visible strings (the set is fake)
  blockRow(c, 356, 58, 4, 2, true);
  // film crew, left: stage light aimed at the crime, clapperboard leaning on it
  stageLight(c, 56, 296, 1, 380, 240, true);
  c.save();
  c.translate(94, 282); c.rotate(0.16);              // clapperboard LEANS against the tripod leg
  rect(c, -26, -18, 52, 30, '#20222c', 2);
  flat(c, -26, -18, 52, 8, '#f4f0e6');
  for (let i = 0; i < 4; i++) poly(c, [[-26 + i * 13, -18], [-19 + i * 13, -18], [-23 + i * 13, -10], [-30 + i * 13, -10]], '#20222c', 0);
  txt(c, 'TAKE 12', 0, 2, 8, '#f4f0e6', 'center', false);
  c.restore();
  // GROUND: sunny grass with tufts, a worn path, and a taped-down cable
  flat(c, 0, 296, VIEW_W, VIEW_H - 296, '#8cba62');
  seg(c, 0, 296, VIEW_W, 296, INK, LW);
  ell(c, 400, 336, 150, 22, '#c8b478', 0);           // the trampled "crime scene" patch
  grassTufts(c, 55, 302, 356, 60, '#5f8c3c');
  c.strokeStyle = '#141020'; c.lineWidth = 4;        // cable to the stage light, taped
  c.beginPath(); c.moveTo(70, 300); c.quadraticCurveTo(240, 352, 470, 356); c.stroke();
  seg(c, 250, 336, 266, 346, 'rgba(220,210,170,0.9)', 5);
  seg(c, 250, 346, 266, 336, 'rgba(220,210,170,0.9)', 5);
  // chalk victim mark ON the grass where the "crime" happens
  c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 3;
  seg(c, 428, 330, 452, 346, 'rgba(255,255,255,0.75)', 3);
  seg(c, 428, 346, 452, 330, 'rgba(255,255,255,0.75)', 3);
  txt(c, 'VICTIM HERE', 440, 355, 8, 'rgba(255,255,255,0.85)', 'center', false);
  // THE CRIME: Bowsonaro carries Impeach ACROSS his arms — both fully visible,
  // the princess near-horizontal like a sack of certified gold
  const bx = 408, by = 314 + Math.sin(frame * 0.09) * 2;
  // Impeach FIRST, slung over the shoulder: her gown hem disappears behind
  // the shell when Bowsonaro is drawn on top — held, both faces readable.
  c.save();
  c.translate(bx + 34, by - 56);
  c.rotate(-0.38);
  drawImpeach(c, 0, 0, 0.92, { facing: -1, hands: 'wave', waveT: frame, mouth: 'smug' });
  c.restore();
  drawBowsonaro(c, bx, by, 1.2, { facing: -1, pose: 'carry', mouth: 'open' });
  // the witnesses: one filming, one despairing, one mid-faint, one down
  drawToad(c, 66, 330, 1.05, { mood: 'faint', spot: '#3f8fd0' });
  drawToad(c, 152, 332, 1.0, { facing: 1, mood: 'shock', camera: true, spot: '#3a9a3a', vest: '#b8862e' });
  drawToad(c, 232, 328, 1.1, { facing: 1, mood: 'despair', spot: '#e04848' });
  const tip = Math.min(1, ((frame % 240) / 60));
  c.save();                                          // one Toad tipping over in real time
  c.translate(292, 326);
  c.rotate(tip * Math.PI / 2 * 0.9);
  drawToad(c, 0, 0, 0.95, { facing: -1, mood: 'shock', spot: '#d048a8' });
  c.restore();
  // the production assistant holds the victim's CUE CARD up for her
  drawToad(c, 566, 334, 1.0, { facing: -1, mood: 'cheer', spot: '#e08a2e', vest: '#3a7a4a' });
  rect(c, 524, 252, 96, 42, '#f4f0e6', 2.5);         // card rests on his raised hands
  txt(c, 'HELP. OH NO.', 572, 266, 10, INK, 'center', false);
  txt(c, 'ETC.', 572, 282, 10, INK, 'center', false);
  seg(c, 552, 294, 556, 302, INK, 2);                // his hands touch the card
  seg(c, 584, 294, 580, 302, INK, 2);
  txt(c, 'THE CRIME OF THE CENTURY (SCHEDULED, 15H)', 306, 22, 13, INK, 'center', false);
  // FOREGROUND: the boom mic dips into frame — nobody notices, ever
  boomMic(c, 530, frame);
  vignette(c, 0.24);
};

// --- intro 6: the balcony speech ---------------------------------------------
const sceneHeroSpeech: SceneFn = (c, frame) => {
  vgrad(c, [[0, '#f2a65e'], [0.6, '#e88a52'], [1, '#d86a4a']]);
  // god-rays behind the castle
  c.save();
  c.translate(320, 20);
  for (let i = 0; i < 7; i++) {
    c.rotate(Math.PI / 3.5);
    c.fillStyle = 'rgba(255,240,180,0.10)';
    c.fillRect(-14, 0, 28, 460);
  }
  c.restore();
  // castle facade with block seams + flanking towers
  flat(c, 120, 0, 400, 260, '#e0d0e8');
  c.strokeStyle = 'rgba(120,90,140,0.35)'; c.lineWidth = 2;
  for (let y = 20; y < 250; y += 26) seg(c, 120, y, 520, y, 'rgba(120,90,140,0.35)', 2);
  for (let y = 20, r = 0; y < 250; y += 26, r++) {
    for (let x = 120 + ((r % 2) * 33); x < 520; x += 66) seg(c, x, y, x, Math.min(y + 26, 250), 'rgba(120,90,140,0.35)', 2);
  }
  flat(c, 120, 0, 26, 260, '#c8b0d8');
  flat(c, 494, 0, 26, 260, '#c8b0d8');
  seg(c, 120, 0, 120, 260, INK, LW); seg(c, 520, 0, 520, 260, INK, LW);
  seg(c, 146, 0, 146, 260, INK, 2); seg(c, 494, 0, 494, 260, INK, 2);
  // one 'E' banner (the other side belongs to the flag — no collisions)
  banner(c, 172, 96, 40, 76, P.estradaRed, P.estradaRedDark, 'E');
  // the castle's own front door, far below the balcony
  poly(c, [[282, 296], [282, 222], [298, 206], [342, 206], [358, 222], [358, 296]], '#8a6a4a', 2.5);
  seg(c, 320, 208, 320, 296, INK, 2);
  disc(c, 312, 254, 3, COIN, 1.5); disc(c, 328, 254, 3, COIN, 1.5);
  // campaign posters slapped on the facade
  for (const [px, py, rot] of [[218, 246, -0.06], [420, 240, 0.05]] as const) {
    c.save(); c.translate(px, py); c.rotate(rot);
    rect(c, -24, -30, 48, 60, '#f4f0e6', 2);
    disc(c, 0, -12, 10, P.skin, 1.5);
    c.beginPath(); c.arc(0, -15, 10, Math.PI, 0); c.closePath();
    c.fillStyle = P.estradaRed; c.fill(); c.strokeStyle = INK; c.lineWidth = 1.5; c.stroke();
    seg(c, -4, -8, 6, -8.5, P.hairDark, 2);
    txt(c, 'HERO', 0, 8, 8, P.estradaRed, 'center', false);
    txt(c, '(OFFICIAL)', 0, 20, 5, '#8a8494', 'center', false);
    c.restore();
  }
  // bunting strings sag across the facade
  for (const [x0, x1] of [[146, 320], [320, 494]] as const) {
    c.strokeStyle = '#8a6a9a'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x0, 118); c.quadraticCurveTo((x0 + x1) / 2, 138, x1, 118); c.stroke();
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const fx = x0 + (x1 - x0) * t;
      const fy = 118 + Math.sin(Math.PI * t) * 18;
      poly(c, [[fx - 5, fy], [fx + 5, fy], [fx, fy + 9]], i % 2 === 0 ? COIN : P.estradaRed, 1.5);
    }
  }
  // the speech banner (hung from the towers on ropes)
  const sway = Math.sin(frame * 0.04) * 3;
  seg(c, 146, 8, 168 + sway, 26, '#6a5030', 2);
  seg(c, 494, 8, 472 + sway, 26, '#6a5030', 2);
  poly(c, [[158 + sway, 26], [482 + sway, 26], [474 + sway, 82], [166 + sway, 82]], '#f4f0e6');
  txt(c, 'I WILL RESCUE HER', 320 + sway, 46, 17, P.estradaRed);
  txt(c, 'MYSELF!!', 320 + sway, 68, 19, P.estradaRed);
  // balcony: slab on corbels, balustrade, flagpole planted in the corner
  poly(c, [[196, 186], [216, 176], [216, 186]], '#b89ac8', 2);   // corbels under the slab
  poly(c, [[424, 186], [444, 176], [444, 186]], '#b89ac8', 2);
  flat(c, 180, 176, 280, 12, '#c8aad8');
  seg(c, 180, 176, 460, 176, INK, 2.5);
  seg(c, 452, 176, 452, 60, '#8a6a9a', 4);                       // flagpole ON the balcony slab
  disc(c, 452, 56, 4, COIN, 2);
  const fw = Math.sin(frame * 0.09) * 5;
  poly(c, [[452, 62], [504 + fw, 68], [500 + fw, 84], [452, 88]], P.estradaRed, 2); // the 'E' flag
  txt(c, 'E', 476 + fw * 0.5, 75, 12, '#fff', 'center', false);
  // Estrada mid-pump on the balcony (rail drawn after, in front of him)
  const pump = Math.sin(frame * 0.1) * 3;
  drawEstrada(c, 320, 176 + pump * 0.4, 0.95, { facing: 1, eyes: 'smug', mouth: 'open', arms: 'raised' });
  flat(c, 180, 150, 280, 26, '#b89ac8');
  seg(c, 180, 150, 460, 150, INK, 2.5);
  for (let i = 0; i < 10; i++) seg(c, 193 + i * 28, 150, 193 + i * 28, 176, '#8a6a9a', 4); // balusters
  // GROUND: plaza cobbles + the crowd (far silhouettes, near variety)
  cobbles(c, 61, 296, '#c8845e', 'rgba(120,70,50,0.4)');
  toadCrowdSilhouette(c, 67, 312, 18, '#8a4a3a', frame);
  const rng = createRng(303);
  const spots = ['#e04848', '#3f8fd0', '#3a9a3a', '#e08a2e', '#d048a8'];
  const vests = ['#5f76d8', '#d8635f', '#8a5fd8', '#3a7a4a', '#b8862e'];
  for (let i = 0; i < 8; i++) {
    const txp = 46 + i * 64 + rng() * 18;
    const typ = 322 + rng() * 30;
    drawToad(c, txp, typ + Math.sin(frame * 0.08 + i) * 2.5, 0.8 + rng() * 0.35,
      { facing: txp < 320 ? 1 : -1, mood: 'adore', spot: spots[i % 5]!, vest: vests[(i + 2) % 5]! });
  }
  // staffer with the APPLAUSE sign (sign rests on his raised hands)
  drawToad(c, 86, 346, 1.05, { facing: 1, mood: 'cheer', spot: '#3f8fd0', vest: '#b8862e' });
  rect(c, 46, 268, 80, 30, '#f4f0e6', 2.5);
  txt(c, 'APPLAUSE', 86, 284, 11, INK, 'center', false);
  seg(c, 74, 298, 76, 308, INK, 2); seg(c, 98, 298, 96, 308, INK, 2);
  // the teleprompter cart, wheeled up under the balcony
  rect(c, 496, 268, 64, 30, '#3d3f52', 2.5);
  disc(c, 508, 302, 6, '#20222c', 2); disc(c, 548, 302, 6, '#20222c', 2);  // wheels ON the plaza
  flat(c, 502, 272, 52, 22, '#9be89b');
  txt(c, '(CRY HERE)', 528, 283, 8, '#173322', 'center', false);
  // Mangiani, corner, arms crossed, first doubt
  drawMangiani(c, 588, 352, 0.95, { facing: -1, eyes: 'squint', brows: 'worried', mouth: 'grim', pose: 'stand', backpack: false });
  txt(c, 'hm.', 588, 226, 12, '#fff');
  confetti(c, 313, 24, frame, [COIN, '#f4f0e6', P.estradaRed]);
  vignette(c, 0.26);
};

// --- intro 7: Mangiani joins --------------------------------------------------
const sceneMangianiJoins: SceneFn = (c, frame) => {
  vgrad(c, [[0, '#9fd6ea'], [0.6, '#c2e6cc'], [1, '#d8ecc0']]);
  // morning sun + two honest clouds + one dishonest one
  const sg = c.createRadialGradient(84, 60, 6, 84, 60, 60);
  sg.addColorStop(0, 'rgba(255,244,180,0.8)'); sg.addColorStop(1, 'rgba(255,244,180,0)');
  c.fillStyle = sg; c.fillRect(20, 0, 130, 130);
  disc(c, 84, 60, 20, '#fff2b0', 0);
  for (const [cx0, cy0, sp] of [[180, 60, 0.10], [420, 40, 0.06]] as const) {
    const cx = cx0 + Math.sin(frame * 0.01) * 6 * sp * 10;
    ell(c, cx, cy0, 34, 12, 'rgba(255,255,255,0.9)', 0);
    ell(c, cx + 20, cy0 - 8, 22, 10, 'rgba(255,255,255,0.9)', 0);
  }
  propCloud(c, 552, 108, 0.8, 262, true);    // its stick lands on the far hill
  // sky blocks drifting over the meadow (world 1 standard issue)
  blockRow(c, 62, 134, 3, 1, false);
  // DISTANT: hills, a paper castle ON a visible stand, the cottage village
  checkerHill(c, 130, 346, 260, 96, '#9cc86e', '#8ab458');
  checkerHill(c, 520, 356, 300, 104, '#8cba62', '#7aa850');
  castleSilhouette(c, 332, 254, 0.45, '#8a7aa4');
  seg(c, 302, 254, 284, 228, '#6b4420', 4);                 // the prop stick bracing it
  txt(c, 'CASTLE (FAR)', 332, 266, 7, '#6d6088', 'center', false);
  cottage(c, 84, 302, 0.7, P.toadRed);
  cottage(c, 148, 300, 0.5, '#3f8fd0');
  pipe(c, 588, 306, 30, 46);
  pipe(c, 556, 306, 22, 30);
  // GROUND: meadow + dirt path with stones + flowers
  flat(c, 0, 306, VIEW_W, VIEW_H - 306, '#7cae56');
  seg(c, 0, 306, VIEW_W, 306, INK, LW);
  poly(c, [[290, 306], [354, 306], [470, 360], [180, 360]], '#c8a468', 2); // the path they will take
  const prng = createRng(59);
  for (let i = 0; i < 8; i++) ell(c, 230 + prng() * 190, 320 + prng() * 32, 5 + prng() * 3, 2.5, '#b09058', 1.5);
  grassTufts(c, 57, 312, 356, 70, '#55823a');
  // signpost: two planks + the rescue schedule nailed under them
  rect(c, 528, 240, 8, 66, '#8a5a2b', 2.5);
  poly(c, [[488, 218], [576, 218], [588, 231], [576, 244], [488, 244]], '#c8a468', 2.5);
  txt(c, "BOWSONARO'S →", 536, 231, 9, INK, 'center', false);
  poly(c, [[496, 250], [572, 250], [582, 261], [572, 272], [496, 272]], '#b89458', 2);
  txt(c, '14 KM (ISH)', 536, 261, 8, INK, 'center', false);
  rect(c, 514, 278, 40, 24, '#f4f0e6', 1.5);                // nailed memo
  disc(c, 534, 276, 2, '#8a8494', 1);
  txt(c, 'TUE: FAIL', 534, 286, 6, '#8a8494', 'center', false);
  txt(c, 'WED: FAIL', 534, 294, 6, '#8a8494', 'center', false);
  // the two heroes
  drawMangiani(c, 235, 306, 1.2, { facing: 1, eyes: 'honest', brows: 'determined', mouth: 'grim', pose: 'fist', backpack: true });
  txt(c, 'I AM COMING WITH YOU.', 235, 148, 14, '#fff');
  drawEstrada(c, 400, 306, 1.2, { facing: -1, eyes: 'wide', mouth: 'nervous', arms: 'down', sweatFrame: frame });
  txt(c, 'ha. ha. great.', 400, 166, 12, '#fff');
  // birds crossing + one butterfly working the flowers
  for (let i = 0; i < 3; i++) {
    const bx = ((frame * 0.4 + i * 220) % (VIEW_W + 60)) - 30;
    const by = 46 + i * 22 + Math.sin(frame * 0.1 + i) * 4;
    c.strokeStyle = INK; c.lineWidth = 2;
    c.beginPath(); c.moveTo(bx - 7, by); c.quadraticCurveTo(bx - 3, by - 5, bx, by);
    c.quadraticCurveTo(bx + 3, by - 5, bx + 7, by); c.stroke();
  }
  const bt = frame * 0.05;
  const bfx = 120 + Math.sin(bt) * 34, bfy = 316 + Math.sin(bt * 1.7) * 12;
  const flap = Math.sin(frame * 0.5) * 0.6;
  ell(c, bfx - 3, bfy, 4, 2.5 + flap * 2, '#f0a8d0', 1.5);
  ell(c, bfx + 3, bfy, 4, 2.5 - flap * 2, '#f0a8d0', 1.5);
  seg(c, bfx, bfy - 3, bfx, bfy + 3, INK, 1.5);
  // FOREGROUND: a leaf canopy dips into the top-left corner; daisies bottom-right
  const lsway = Math.sin(frame * 0.02) * 3;
  poly(c, [[0, 0], [180, 0], [150 + lsway, 14], [96 + lsway, 40], [40 + lsway, 58], [0, 66]], '#2f8e38', 3);
  poly(c, [[0, 0], [120, 0], [86 + lsway, 18], [34 + lsway, 36], [0, 42]], '#3a9a3a', 2.5);
  c.strokeStyle = '#25702c'; c.lineWidth = 2;               // leaf vein scallops
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    c.arc(20 + i * 30 + lsway * (i / 5), 26 + i * 7, 12, Math.PI * 0.1, Math.PI * 0.8);
    c.stroke();
  }
  for (const [dx, dy, ds] of [[602, 352, 1.2], [630, 344, 0.9]] as const) {
    seg(c, dx, dy + 8 * ds, dx, dy + 22 * ds, '#3a7a2a', 3);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.sin(frame * 0.03) * 0.1;
      ell(c, dx + Math.cos(a) * 8 * ds, dy + Math.sin(a) * 8 * ds, 5 * ds, 3.4 * ds, '#fff', 1.5);
    }
    disc(c, dx, dy, 5 * ds, COIN, 1.5);
  }
  vignette(c, 0.20);
};

// --- w1/w2/w3 beats: too late (again) ------------------------------------------
// ONE castle-door composition, three escalating pieces of evidence: warm coffee
// -> still-smoking cigarette -> the kidnapper's cat, fed on schedule. Everything
// except the evidence prop, the management note and the punchlines is shared.
interface TooLateSpec {
  /** Management's note nailed to the door, one entry per line (11px each). */
  noteLines: readonly string[];
  /** Estrada's resigned caption (the same word, escalating). */
  quip: string;
  /** Mangiani's deduction over the evidence. */
  callout: string;
  /** How done Mangiani is with this. */
  mangianiMouth: 'grim' | 'open';
  /** THE EVIDENCE, drawn ON the stool (top face y=268, spanning x 476..532). */
  evidence(c: Ctx, frame: number): void;
  /** Variant dressing on the door itself (drawn right after the leaves). */
  doorExtra?(c: Ctx, frame: number): void;
  /** Variant near-camera layer (drawn after the foreground pillars). */
  foreground?(c: Ctx, frame: number): void;
}

const tooLateScene = (spec: TooLateSpec): SceneFn => (c, frame) => {
  vgrad(c, [[0, '#4a3c5e'], [1, '#332848']]);
  stoneWall(c, 71, 46, 306, '#5a4a6e', '#4c3e60', 'rgba(190,170,220,0.18)');
  flat(c, 0, 40, VIEW_W, 8, '#3a2f50');
  seg(c, 0, 46, VIEW_W, 46, INK, 2);
  // producer's banner over the door
  banner(c, 320, 50, 84, 64, '#2c5234', '#1f3d26', 'B');
  // torches flank the doorway; their glow warms the stones
  torch(c, 172, 158, 1, frame, 0);
  torch(c, 468, 158, 1, frame, 2.2);
  // the great door: arch frame, one leaf swung OPEN into darkness
  poly(c, [[212, 306], [212, 122], [244, 92], [396, 92], [428, 122], [428, 306]], '#3a2c20');
  flat(c, 244, 112, 152, 194, '#0d0a14');                    // the darkness inside
  poly(c, [[244, 306], [244, 112], [320, 132], [320, 306]], '#5c4322', LW); // open leaf
  for (const hz of [150, 250]) {                             // big strap hinges
    poly(c, [[246, hz], [286, hz + 8], [286, hz + 14], [246, hz + 6]], '#8a8494', 2);
  }
  disc(c, 308, 216, 5, COIN, 2);
  spec.doorExtra?.(c, frame);
  // 'RENT-A-CASTLE' tag hangs from the open leaf's hinge on a string
  seg(c, 250, 152, 240, 176, '#c8b088', 1.5);
  c.save(); c.translate(238, 186); c.rotate(-0.12 + Math.sin(frame * 0.04) * 0.05);
  rect(c, -26, -10, 52, 20, '#e8d5a0', 2);
  txt(c, 'RENT-A-CASTLE', 0, 0, 6, '#6b4420', 'center', false);
  c.restore();
  // the note, nailed to the CLOSED leaf
  rect(c, 336, 148, 120, 78, '#f4f0e6');
  disc(c, 396, 144, 3, '#8a8494', 2);
  const nLines = spec.noteLines.length;
  spec.noteLines.forEach((line, i) => {
    txt(c, line, 396, 182 + (i - (nLines - 1) / 2) * 16, 11, INK, 'center', false);
  });
  txt(c, '- mgmt', 424, 214, 9, '#8a8494', 'center', false);
  // stagecraft: a tape seam up the "stone" wall + WET PAINT placard leaning on it
  seg(c, 92, 46, 92, 306, 'rgba(220,210,170,0.3)', 6);
  for (const ty of [116, 226]) {                             // duct-tape X patches
    seg(c, 80, ty - 9, 104, ty + 9, 'rgba(220,210,170,0.6)', 5);
    seg(c, 80, ty + 9, 104, ty - 9, 'rgba(220,210,170,0.6)', 5);
  }
  c.save(); c.translate(80, 290); c.rotate(0.1);             // placard leans against the wall
  rect(c, -24, -16, 48, 30, '#f4f0e6', 2);
  txt(c, 'WET PAINT', 0, -2, 8, '#b9412f', 'center', false);
  c.restore();
  // arrow-slit window, right wall, for balance
  rect(c, 548, 96, 16, 52, '#141020', 2.5);
  seg(c, 548, 122, 564, 122, '#3a2f50', 3);
  // FLOOR: castle checker tiles + doormat at the threshold
  checkerFloor(c, 306, '#4a3c58', '#3e3050');
  rect(c, 264, 312, 112, 20, '#8a6a3a', 2);
  txt(c, 'GONE KIDNAPPING', 320, 322, 8, '#3a2c14', 'center', false);
  // the evidence pedestal: a stool, dead center of Mangiani's attention
  rect(c, 476, 268, 56, 10, '#6b4420', 2.5);
  seg(c, 484, 278, 480, 306, '#6b4420', 4);
  seg(c, 524, 278, 528, 306, '#6b4420', 4);
  seg(c, 504, 278, 504, 306, '#6b4420', 4);
  spec.evidence(c, frame);
  // Estrada shrugging THEATRICALLY (slow loop)
  const shrug = Math.sin(frame * 0.05) * 3;
  drawEstrada(c, 152, 306 + shrug * 0.3, 1.15, { facing: 1, eyes: 'closed', mouth: 'grin', arms: 'shrug' });
  txt(c, spec.quip, 152, 172, 13, '#fff');
  // Mangiani, staring at the evidence, doing the math
  drawMangiani(c, 560, 306, 1.1, { facing: -1, eyes: 'narrow', brows: 'raised', mouth: spec.mangianiMouth, pose: 'point', backpack: true });
  c.setLineDash([4, 6]);
  seg(c, 540, 204, 512, 250, 'rgba(255,255,255,0.5)', 2);
  c.setLineDash([]);
  txt(c, spec.callout, 548, 170, 11, '#fff');
  motes(c, 83, 8, 150, 120, 120, 160, frame);
  // FOREGROUND: pillar edges frame the shot
  flat(c, 0, 0, 26, VIEW_H, '#241b38');
  flat(c, 614, 0, 26, VIEW_H, '#241b38');
  flat(c, 0, 286, 34, 14, '#2c2244');
  flat(c, 606, 286, 34, 14, '#2c2244');
  spec.foreground?.(c, frame);
  vignette(c, 0.32);
};

// w1: STILL-STEAMING coffee (the entire case, in one prop)
const sceneTooLate = tooLateScene({
  noteLines: ['SHE IS IN', 'ANOTHER CASTLE,', 'SORRY'],
  quip: 'welp.',
  callout: '...still hot?',
  mangianiMouth: 'grim',
  evidence: (c, frame) => coffeeCup(c, 504, 266, 1.2, frame), // cup ON the stool top
});

// w2: a cigarette in an ashtray, EMBER STILL GLOWING, smoke still rising
const sceneTooLate2 = tooLateScene({
  noteLines: ['STILL ANOTHER', 'CASTLE.', 'STOP COMING.'],
  quip: 'welp. again.',
  callout: '...still smoking?',
  mangianiMouth: 'grim',
  evidence: (c, frame) => {
    // glass ashtray sitting ON the stool top
    ell(c, 504, 264, 14, 5, '#9aa0b4', 2.5);                 // the dish
    ell(c, 504, 262.5, 9, 2.6, '#5a5f72', 1.5);              // its hollow
    // two stubbed butts IN the hollow (this is a routine, not an accident)
    seg(c, 499, 262, 503, 260.5, '#e8e2d0', 3);
    seg(c, 506, 261, 509.5, 262.5, '#e8e2d0', 3);
    disc(c, 503.4, 260.4, 1, '#8a8494', 0);
    disc(c, 505.8, 260.9, 1, '#8a8494', 0);
    // THE cigarette: filter resting ON the ashtray rim, ember end cantilevered
    seg(c, 508, 261.5, 515, 259.4, '#d99a4a', 3.5);          // cork filter
    seg(c, 515, 259.4, 522, 257.3, '#f4f0e6', 3.5);          // paper body
    seg(c, 522, 257.3, 524.5, 256.5, '#7a7466', 3.5);        // ash about to drop
    // pulsing ember + its glow
    const pulse = 0.5 + 0.5 * Math.sin(frame * 0.11);
    const eg = c.createRadialGradient(525.5, 256, 1, 525.5, 256, 14);
    eg.addColorStop(0, `rgba(255,140,60,${(0.25 + pulse * 0.22).toFixed(2)})`);
    eg.addColorStop(1, 'rgba(255,140,60,0)');
    c.fillStyle = eg; c.fillRect(511, 242, 29, 28);
    disc(c, 525.5, 256.2, 1.9, '#ff8c3a', 0);
    disc(c, 525.5, 256.2, 0.9, pulse > 0.5 ? '#ffe9a0' : '#ffd94d', 0);
    // the lazy smoke ribbon, curling up FROM the ember (fades as it climbs)
    for (let k = 0; k < 16; k++) {
      const t0 = k / 16, t1 = (k + 1) / 16;
      const px0 = 525.5 + Math.sin(frame * 0.045 + t0 * 5.2) * (1.5 + t0 * 14);
      const py0 = 254 - t0 * 92;
      const px1 = 525.5 + Math.sin(frame * 0.045 + t1 * 5.2) * (1.5 + t1 * 14);
      const py1 = 254 - t1 * 92;
      seg(c, px0, py0, px1, py1, `rgba(222,226,238,${(0.55 * (1 - t0 * 0.85)).toFixed(2)})`, 2 + t0 * 2.5);
    }
  },
});

// w3: the cat's bowl, kibble heaped FRESH — somebody kept the feeding schedule
const sceneTooLate3 = tooLateScene({
  noteLines: ['AT THIS POINT', 'THIS IS ON YOU.'],
  quip: 'welp. thrice.',
  callout: '...fresh kibble?',
  mangianiMouth: 'open',
  evidence: (c, frame) => {
    // the cat bowl ON the stool top, fish-skeleton decal on the front
    poly(c, [[488, 268], [520, 268], [524, 255], [484, 255]], '#3f8fd0', 2.5);
    ell(c, 504, 255, 20, 3.6, '#3577b0', 2);                 // rim
    seg(c, 495, 261.5, 511, 261.5, '#f4f0e6', 1.5);          // decal: spine
    for (let i = 0; i < 3; i++) seg(c, 500 + i * 4, 259, 500 + i * 4, 264, '#f4f0e6', 1.5); // ribs
    poly(c, [[511, 261.5], [515.5, 258.5], [515.5, 264.5]], '#f4f0e6', 0);  // tail
    disc(c, 493.5, 261.5, 2.2, '#f4f0e6', 0);                // head
    disc(c, 493, 261.2, 0.8, INK, 0);                        // eye
    // kibble: a fresh heap INSIDE the rim, two strays ON the stool beside it
    ell(c, 504, 252, 13, 5.5, '#8a5a2b', 2);
    const krng = createRng(313);
    for (let i = 0; i < 16; i++) {
      const a = krng() * Math.PI * 2;
      const r = Math.sqrt(krng());
      disc(c, 504 + Math.cos(a) * r * 11, 251.5 + Math.sin(a) * r * 3.8, 1.4, krng() < 0.5 ? '#a9743f' : '#6b4420', 0);
    }
    disc(c, 481, 266.5, 1.5, '#a9743f', 0);                  // strays ON the stool top
    disc(c, 526.5, 266.8, 1.5, '#6b4420', 0);
    // one well-fed fly doing lazy circuits above the heap
    const fa = frame * 0.06;
    const fx = 504 + Math.cos(fa) * 17;
    const fy = 241 + Math.sin(fa * 2.3) * 4;
    c.fillStyle = INK; c.fillRect(fx - 1.2, fy - 1.2, 2.6, 2.6);
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(fx + 0.8, fy - 2.2, 1.6, 1.6); // wing glint
  },
  doorExtra: (c, frame) => {
    // a cat-flap set INTO the open leaf, still swinging — somebody JUST left
    poly(c, [[266, 298], [266, 276], [296, 273], [296, 298]], '#4a3418', 2.5); // flap frame
    flat(c, 269, 278, 24, 18, '#0d0a14');                    // the hole behind it
    const lift = Math.abs(Math.sin(frame * 0.06)) * 7;       // hinged at the top
    poly(c, [[269, 278], [293, 275.5], [293, 296 - lift], [269, 298 - lift]], '#6b4420', 2);
    seg(c, 269, 278, 293, 275.5, '#8a8494', 2);              // the hinge strip
    txt(c, 'CAT DOOR', 281, 268, 5, '#c8b088', 'center', false);
  },
  foreground: (c, frame) => {
    // paw prints from the flap toward the exit (right past the hero)
    for (const [px, py] of [[266, 310], [232, 315], [196, 320], [158, 325], [118, 330]] as const) {
      disc(c, px, py, 2.4, 'rgba(14,10,26,0.8)', 0);
      for (let i = 0; i < 3; i++) disc(c, px - 2.6 + i * 2.6, py - 3.6, 1, 'rgba(14,10,26,0.8)', 0);
    }
    // the kidnapper's cat, fed and smug, padding off-frame with its tail up
    // (kept ABOVE the vignette's black corner so the silhouette reads)
    const bob = Math.sin(frame * 0.11) * 1.2;
    const cx2 = 56, cy2 = 322 + bob;
    for (let i = 0; i < 4; i++) {                            // striding legs, feet ON the floor
      const st = Math.sin(frame * 0.12 + i * 1.7) * 3;
      seg(c, cx2 - 11 + i * 8, cy2 + 5, cx2 - 11 + i * 8 + st, cy2 + 15, '#141020', 4);
    }
    const tsw = Math.sin(frame * 0.06) * 3;                  // tail UP, tip curled
    c.strokeStyle = '#141020'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx2 + 15, cy2 - 3);
    c.quadraticCurveTo(cx2 + 27, cy2 - 24, cx2 + 18 + tsw, cy2 - 37);
    c.stroke();
    c.lineCap = 'butt';
    ell(c, cx2, cy2, 18, 8.5, '#141020', 0);                 // body
    disc(c, cx2 - 15, cy2 - 10, 6.8, '#141020', 0);          // head, chin UP (smug)
    poly(c, [[cx2 - 20, cy2 - 14], [cx2 - 16.5, cy2 - 21], [cx2 - 13.5, cy2 - 14.5]], '#141020', 0); // ears
    poly(c, [[cx2 - 12, cy2 - 15], [cx2 - 9, cy2 - 21], [cx2 - 6.5, cy2 - 14.5]], '#141020', 0);
    // strong rim light so the silhouette reads against the dark floor
    c.strokeStyle = 'rgba(200,180,230,0.65)'; c.lineWidth = 2;
    c.beginPath(); c.ellipse(cx2, cy2, 18, 8.5, 0, Math.PI * 1.02, Math.PI * 1.98); c.stroke();
    c.beginPath(); c.arc(cx2 - 15, cy2 - 10, 6.8, Math.PI * 0.85, Math.PI * 1.75); c.stroke();
    c.strokeStyle = 'rgba(200,180,230,0.5)'; c.lineWidth = 1.5; // tail rim
    c.beginPath(); c.moveTo(cx2 + 17, cy2 - 5);
    c.quadraticCurveTo(cx2 + 29, cy2 - 24, cx2 + 20 + tsw, cy2 - 38);
    c.stroke();
  },
});

// --- w1/w2/w3 beat: the hands do not add up ----------------------------------
const sceneBigHands: SceneFn = (c, frame) => {
  vgrad(c, [[0, '#7cb8e8'], [0.7, '#a8d4ee'], [1, '#c8e0f0']]);
  // drifting clouds
  const crng = createRng(404);
  for (let i = 0; i < 5; i++) {
    const cx = ((crng() * 640 + frame * 0.15) % (VIEW_W + 120)) - 60;
    const cy = 34 + crng() * 90;
    ell(c, cx, cy, 40, 14, 'rgba(255,255,255,0.85)', 0);
    ell(c, cx + 24, cy - 8, 26, 12, 'rgba(255,255,255,0.85)', 0);
  }
  // DISTANT: checkered hills roll to the horizon; a cottage minds its business
  checkerHill(c, 140, 388, 300, 110, '#9cc86e', '#8ab458');
  checkerHill(c, 540, 396, 320, 116, '#8cba62', '#7aa850');
  cottage(c, 606, 322, 0.55, P.toadRed);
  // the getaway airship (bobbing, propeller spinning, flag flying)
  const ay = 148 + Math.sin(frame * 0.03) * 5;
  ell(c, 490, ay, 112, 30, '#6b4420');                      // hull
  for (let i = 0; i < 3; i++) seg(c, 392 + i * 6, ay - 8 + i * 9, 596 - i * 10, ay - 8 + i * 9, '#4a2f14', 1.5); // planks
  flat(c, 386, ay - 24, 212, 18, '#835b2f');                // deck
  seg(c, 380, ay - 24, 602, ay - 24, INK, LW);
  for (let i = 0; i < 4; i++) disc(c, 420 + i * 50, ay + 4, 6, '#3d3f52', 2); // portholes
  const spin = Math.sin(frame * 0.6);
  ell(c, 374, ay, 6, 24 * Math.abs(spin) + 2, '#8a8494', 2); // propeller
  seg(c, 598, ay - 24, 598, ay - 56, '#4a2f14', 3);          // stern flagpole ON the deck
  const fw2 = Math.sin(frame * 0.1) * 4;
  poly(c, [[598, ay - 56], [556 + fw2, ay - 52], [560 + fw2, ay - 40], [598, ay - 44]], P.peachPink, 2);
  txt(c, 'IMPEACH 1', 578 + fw2 * 0.5, ay - 48, 6, '#7c2230', 'center', false);
  // rope ladder dangling from the hull (rungs swing gently)
  const lsw = Math.sin(frame * 0.05) * 3;
  seg(c, 430, ay + 18, 424 + lsw, ay + 74, '#c8b088', 2);
  seg(c, 446, ay + 18, 440 + lsw, ay + 74, '#c8b088', 2);
  for (let i = 1; i < 4; i++) seg(c, 428 + lsw * (i / 4), ay + 18 + i * 14, 444 + lsw * (i / 4), ay + 18 + i * 14, '#c8b088', 2.5);
  // Impeach ON deck behind the railing — hands hidden: the FOREGROUND hand
  // below is her one oversized hand this panel (never both).
  drawImpeach(c, 470, ay - 20, 0.8, { facing: -1, hands: 'hidden', mouth: 'open', waveT: frame });
  for (let i = 0; i < 6; i++) seg(c, 396 + i * 40, ay - 24, 396 + i * 40, ay - 44, '#4a2f14', 3); // railing posts
  seg(c, 390, ay - 44, 600, ay - 44, '#4a2f14', 3);
  txt(c, 'HELLO LITTLE PEOPLE', 470, ay - 106, 13, '#fff');
  // THE HAND — half the sky. One pink sleeve anchors it back to the ship.
  const wob = Math.sin(frame * 0.08);
  poly(c, [[402, ay - 6], [396, ay + 26], [306, 240 + wob * 8], [268, 200 + wob * 8]], P.peachPink, 3);
  bigHand(c, 240, 178 + wob * 9, 88, -0.25 + wob * 0.07);
  // GROUND: meadow band + the chain-link fence they kidnap over
  flat(c, 0, 320, VIEW_W, VIEW_H - 320, '#8cba62');
  seg(c, 0, 320, VIEW_W, 320, INK, LW);
  grassTufts(c, 63, 326, 356, 46, '#5f8c3c');
  for (let px = 20; px < VIEW_W; px += 90) seg(c, px, 320, px, 286, '#8a8494', 3); // fence posts ON the ground line
  c.strokeStyle = 'rgba(140,140,160,0.8)'; c.lineWidth = 1.5;
  for (let px = 20; px < VIEW_W - 90; px += 90) {
    for (let k = 0; k < 3; k++) {
      seg(c, px + k * 30, 286, px + (k + 1) * 30, 320, 'rgba(140,140,160,0.8)', 1.5);
      seg(c, px + k * 30, 320, px + (k + 1) * 30, 286, 'rgba(140,140,160,0.8)', 1.5);
    }
  }
  seg(c, 0, 286, VIEW_W, 286, '#8a8494', 2.5);
  // witnesses: Mangiani measuring, two toads doing the arithmetic too
  drawMangiani(c, 110, 356, 1.15, { facing: 1, eyes: 'narrow', brows: 'worried', mouth: 'grim', pose: 'measure', backpack: true });
  seg(c, 148, 268, 216, 244, COIN, 3);                       // the tape, stretched toward the hand
  rect(c, 132, 262, 16, 12, '#3d3f52', 2);                   // tape case in his hand
  txt(c, 'hand: 4.5 m ??', 150, 224, 11, INK, 'left', false);
  drawToad(c, 548, 352, 0.95, { facing: -1, mood: 'shock', spot: '#3f8fd0' });
  drawToad(c, 596, 356, 0.85, { facing: -1, mood: 'despair', spot: '#e08a2e' });
  // FOREGROUND: a wisp of cloud slides under the hand for depth
  ell(c, 180 + Math.sin(frame * 0.02) * 10, 262, 90, 12, 'rgba(255,255,255,0.5)', 0);
  vignette(c, 0.24);
};

// --- w1/w2/w3 beat: the rally ------------------------------------------------
const sceneBallotRant: SceneFn = (c, frame) => {
  vgrad(c, [[0, '#22301f'], [1, '#0e150d']]);
  const swx = Math.sin(frame * 0.02) * 26;
  spotlightCone(c, 320 + swx, 80, 320, 0.12);
  spotlightCone(c, 320 - swx, 60, 250, 0.08);
  // back wall drapes in jersey colors + the message
  for (const [dx, col] of [[80, '#2c5234'], [560, '#2c5234']] as const) {
    poly(c, [[dx - 46, 20], [dx + 46, 20], [dx + 30, 150], [dx - 30, 150]], col, 2.5);
    for (let i = -1; i <= 1; i++) seg(c, dx + i * 18, 24, dx + i * 12, 146, 'rgba(0,0,0,0.3)', 3);
    poly(c, [[dx - 20, 150], [dx + 20, 150], [dx, 168]], '#d9b53a', 2);   // gold swag tip
  }
  const sway = Math.sin(frame * 0.05) * 3;
  seg(c, 118, 30, 148 + sway, 44, '#6a5030', 2);            // banner ropes
  seg(c, 522, 30, 492 + sway, 44, '#6a5030', 2);
  poly(c, [[132 + sway, 44], [508 + sway, 44], [500 + sway, 86], [140 + sway, 86]], '#3a9a3a');
  txt(c, 'THE SHELLS ARE RIGGED!', 320 + sway, 66, 17, '#ffe9a0');
  // rows of EMPTY folding chairs fading into the dark
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 6; i++) {
      const chx = 60 + i * 100 + row * 40, chy = 210 + row * 26;
      rect(c, chx, chy, 26, 22, row === 0 ? '#2a3328' : '#222a20', 2);
      seg(c, chx + 3, chy + 22, chx + 3, chy + 34, '#222a20', 2.5);
      seg(c, chx + 23, chy + 22, chx + 23, chy + 34, '#222a20', 2.5);
    }
  }
  rect(c, 56, 196, 60, 14, '#f4f0e6', 1.5);                 // sign taped to the front chair
  txt(c, 'PRESS', 86, 203, 8, '#b9412f', 'center', false);
  // FLOOR: hall planks
  planks(c, 268, '#243024', '#1a241a');
  // the stage platform (Bowsonaro's world: everything on a soapbox)
  flat(c, 190, 262, 260, 12, '#5c4322');
  seg(c, 190, 262, 450, 262, INK, 2.5);
  flat(c, 190, 274, 260, 32, '#4a3418');
  for (let x = 204; x < 440; x += 44) seg(c, x, 276, x, 304, '#3a2810', 2);
  // ballot boxes stacked BESIDE the stage, one tipped and spilling
  const urn = (ux: number, uy: number, rot: number): void => {
    c.save(); c.translate(ux, uy); c.rotate(rot);
    rect(c, -24, -20, 48, 40, '#8a8494', 2.5);
    flat(c, -16, -14, 32, 4, '#141020');
    txt(c, 'URNA', 0, 6, 8, '#20222c', 'center', false);
    c.restore();
  };
  urn(246, 288, 0);
  urn(246, 248, -0.06);
  urn(190, 298, 0.5);                                       // tipped over
  for (let i = 0; i < 4; i++) rect(c, 200 + i * 15, 306 + (i % 2) * 7, 14, 9, '#f4f0e6', 1.5); // spilled ballots ON the floor
  // BOWSONARO first — standing on a crate behind the podium (he insists on
  // the tall podium anyway); the podium front covers the crate and his legs
  rect(c, 296, 232, 52, 30, '#5c4322', 2.5);
  drawBowsonaro(c, 322, 234, 1.15, { facing: 1, pose: 'rant', mouth: 'open' });
  speechSpikes(c, 366, 118, 4, frame);
  // podium ON the stage; mic on a gooseneck; cable taped down the steps
  poly(c, [[278, 262], [362, 262], [354, 192], [286, 192]], '#5c4322');
  seg(c, 278, 262, 362, 262, INK, 2.5);
  flat(c, 282, 188, 76, 9, '#6b4420');
  seg(c, 282, 188, 358, 188, INK, 2.5);
  txt(c, 'MITO', 320, 230, 10, '#d9b53a', 'center', false); // stencil on the podium
  c.strokeStyle = '#20222c'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(302, 188); c.quadraticCurveTo(292, 174, 300, 166); c.stroke();
  disc(c, 302, 162, 5, '#3d3f52', 2);
  c.beginPath(); c.moveTo(352, 262); c.quadraticCurveTo(420, 300, 520, 330); c.strokeStyle = '#141020'; c.lineWidth = 4; c.stroke();
  seg(c, 432, 296, 448, 306, 'rgba(200,190,150,0.9)', 5);   // tape on the cable
  // the audience: three spiked shells, asleep; Zzz rises on its own schedule
  for (let i = 0; i < 3; i++) {
    const mx = 496 + (i % 2) * 66, my = 302 + Math.floor(i / 2) * 26;
    c.beginPath(); c.arc(mx, my, 20, Math.PI, 0); c.closePath();
    c.fillStyle = P.shellY; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
    flat(c, mx - 20, my - 11, 40, 5, P.shellG);
    for (let k = -1; k <= 1; k++) poly(c, [[mx + k * 12 - 3, my - 15 + Math.abs(k) * 3], [mx + k * 12 + 3, my - 15 + Math.abs(k) * 3], [mx + k * 12, my - 23 + Math.abs(k) * 3]], '#d9d4c4', 1.5);
    disc(c, mx - 19, my - 4, 7, P.turtSkin, 2);             // dozing head poking out
    seg(c, mx - 22, my - 5, mx - 15, my - 5, INK, 2);
    const zt = (frame * 0.02 + i * 0.33) % 1;
    txt(c, 'Z', mx - 24 - zt * 14, my - 26 - zt * 22, 9 + zt * 6, '#9be89b', 'center', false);
  }
  // Impeach at the wings, deep in the phone (one big hand holds it)
  drawImpeach(c, 116, 306, 0.9, { facing: 1, hands: 'phone', mouth: 'pout', waveT: frame });
  c.save();
  c.globalAlpha = 0.22 + Math.sin(frame * 0.2) * 0.05;
  poly(c, [[154, 240], [116, 214], [116, 252]], '#8fd8ff', 0); // phone glow on the face
  c.restore();
  // the unused confetti cannon, saving itself for a win
  poly(c, [[586, 306], [606, 306], [612, 270], [596, 266]], '#7c3a5e', 2.5);
  seg(c, 590, 306, 580, 322, '#3d3f52', 3);
  seg(c, 602, 306, 612, 322, '#3d3f52', 3);
  txt(c, 'DO NOT', 600, 282, 6, '#f4f0e6', 'center', false);
  txt(c, 'WASTE', 600, 290, 6, '#f4f0e6', 'center', false);
  txt(c, 'RALLY #4 — ATTENDANCE: 3 (ALL ASLEEP)', 320, 344, 11, '#9be89b');
  // FOREGROUND: backs of two empty chairs at the camera line
  for (const chx of [40, 480]) {
    flat(c, chx, 330, 120, 30, '#141a12');
    flat(c, chx + 8, 322, 104, 10, '#1a231a');
  }
  vignette(c, 0.34);
};

// --- w2/w3 beat: the coffee break ---------------------------------------------
const sceneCoffeeBreak: SceneFn = (c, frame) => {
  vgrad(c, [[0, '#f2a65e'], [0.55, '#ec8850'], [1, '#e86a4a']]);
  // smoke plumes rising off the castle
  for (let i = 0; i < 4; i++) {
    const t = (frame * 0.008 + i * 0.25) % 1;
    ell(c, 470 + Math.sin(t * 6 + i) * 26, 90 - t * 74, 18 + t * 26, 12 + t * 12,
      `rgba(60,50,70,${(0.5 - t * 0.45).toFixed(2)})`, 0);
  }
  // the burning castle: towers, crenellations, windows on fire
  flat(c, 380, 90, 190, 226, '#8a7a9a');
  seg(c, 380, 90, 380, 316, INK, LW); seg(c, 570, 90, 570, 316, INK, LW); seg(c, 380, 90, 570, 90, INK, LW);
  for (let i = 0; i < 5; i++) flat(c, 384 + i * 40, 82, 22, 8, '#8a7a9a');
  for (const tx2 of [380, 570]) {
    rect(c, tx2 - 16, 50, 32, 40, '#8a7a9a', 2.5);
    poly(c, [[tx2 - 20, 50], [tx2 + 20, 50], [tx2, 20]], '#6a5a7a', 2.5);
    const lick2 = Math.sin(frame * 0.3 + tx2) * 3;
    ell(c, tx2, 46 - Math.abs(lick2), 6, 8 + Math.abs(lick2), '#ff8c3a', 1.5); // roof already caught
  }
  const wrng = createRng(505);
  for (let i = 0; i < 4; i++) {
    const wx = 402 + (i % 2) * 88 + wrng() * 18;
    const wy = 122 + Math.floor(i / 2) * 74;
    rect(c, wx, wy, 26, 34, '#1b1030', 2);
    const lick = Math.sin(frame * 0.25 + i * 1.7) * 6;
    poly(c, [[wx + 2, wy + 34], [wx + 24, wy + 34], [wx + 20, wy + 10 - lick], [wx + 13, wy + 22], [wx + 6, wy + 6 + lick]], '#ff8c3a', 2);
    poly(c, [[wx + 7, wy + 34], [wx + 19, wy + 34], [wx + 13, wy + 14 - lick * 0.6]], '#ffd94d', 0);
  }
  const fg = c.createRadialGradient(475, 180, 20, 475, 180, 190); // fire glow on everything
  fg.addColorStop(0, 'rgba(255,140,60,0.18)'); fg.addColorStop(1, 'rgba(255,140,60,0)');
  c.fillStyle = fg; c.fillRect(280, 0, 360, 360);
  // embers drift up and away
  const erng = createRng(507);
  for (let i = 0; i < 10; i++) {
    const t = (erng() * 100 + frame * (0.4 + erng() * 0.5)) % 130;
    const ex = 400 + erng() * 160 + Math.sin(frame * 0.05 + i) * 8;
    c.fillStyle = `rgba(255,${160 - t}, 60, ${(Math.max(0, 0.8 - t / 130)).toFixed(2)})`;
    c.fillRect(ex, 130 - t, 2.5, 2.5);
  }
  // GROUND: lawn, scorched near the castle
  flat(c, 0, 300, VIEW_W, 60, '#e0b070');
  seg(c, 0, 300, VIEW_W, 300, INK, LW);
  flat(c, 0, 300, 300, 60, '#a8c070');
  for (const [sx2, sy2, sr] of [[420, 330, 30], [520, 344, 24], [360, 350, 20]] as const) {
    ell(c, sx2, sy2, sr, sr * 0.35, 'rgba(60,40,40,0.45)', 0);   // scorch marks
  }
  grassTufts(c, 73, 306, 356, 30, '#7a9a4a');
  // hydrant + hose: fully connected, fully kinked, fully ignored
  rect(c, 296, 278, 18, 24, '#c83a2e', 2.5);
  disc(c, 305, 274, 6, '#c83a2e', 2);
  c.strokeStyle = '#a83240'; c.lineWidth = 5;
  c.beginPath(); c.moveTo(314, 292); c.quadraticCurveTo(360, 320, 392, 310);
  c.lineTo(398, 322); c.quadraticCurveTo(430, 330, 470, 318); c.stroke();
  seg(c, 392, 306, 400, 326, '#7c2230', 5);                  // THE kink
  txt(c, '(kink)', 396, 342, 8, '#7c2230', 'center', false);
  // the bucket brigade does its best
  const swing = Math.sin(frame * 0.15) * 4;
  drawToad(c, 486, 340, 0.9, { facing: 1, mood: 'despair', spot: '#3f8fd0' });
  rect(c, 498, 328 + swing * 0.4, 12, 10, '#5f76d8', 2);     // bucket in hand
  drawToad(c, 540, 348, 0.95, { facing: 1, mood: 'shock', spot: '#3a9a3a' });
  rect(c, 552, 334 - swing * 0.4, 12, 10, '#5f76d8', 2);
  // Mangiani SPRINTING toward the fire, forever — BEHIND the break furniture,
  // which is exactly how much attention Estrada pays him
  const mrx = 30 + ((frame * 2.2) % 560);
  drawMangiani(c, mrx, 328, 1.05, { facing: 1, eyes: 'honest', brows: 'worried', mouth: 'open', pose: 'run', backpack: true });
  for (let i = 0; i < 4; i++) seg(c, mrx - 40 - i * 14, 304 - i * 6, mrx - 62 - i * 14, 304 - i * 6, 'rgba(255,255,255,0.6)', 3);
  // Estrada's break corner: a proper chaise longue, side table, espresso, SIGN
  poly(c, [[134, 206], [158, 198], [208, 280], [184, 290]], '#c8384a', 2.5);  // backrest fabric
  poly(c, [[178, 284], [252, 278], [256, 290], [182, 296]], '#c8384a', 2.5);  // leg rest
  seg(c, 150, 232, 128, 316, '#6b4420', 5);                  // head-end leg to the lawn
  seg(c, 196, 292, 186, 316, '#6b4420', 5);                  // mid leg
  seg(c, 248, 288, 256, 316, '#6b4420', 5);                  // foot-end leg
  seg(c, 128, 316, 256, 316, '#6b4420', 4);                  // ground rail
  c.save();
  c.translate(196, 282);
  c.rotate(-0.55);
  drawEstrada(c, 0, 0, 1.02, { facing: 1, eyes: 'closed', mouth: 'grin', arms: 'recline' });
  c.restore();
  rect(c, 262, 250, 26, 66, '#8a5a2b', 2);                   // side table
  coffeeCup(c, 275, 248, 0.9, frame);                        // espresso ON the table
  rect(c, 316, 240, 10, 76, '#8a5a2b', 2.5);                 // sign post planted in the lawn
  poly(c, [[270, 194], [374, 194], [374, 242], [270, 242]], '#f4f0e6');
  txt(c, 'ON BREAK', 322, 210, 13, P.estradaRed);
  txt(c, '14:00-15:30', 322, 228, 12, INK, 'center', false);
  vignette(c, 0.26);
};

// --- ending 1: the wig comes off ----------------------------------------------
const sceneWigFalls: SceneFn = (c, frame) => {
  vgrad(c, [[0, '#4a1c2c'], [1, '#2c0e18']]);
  // throne-room wall: stained glass, chandelier, gold statue of the boss
  flat(c, 0, 0, VIEW_W, 300, '#5c2434');
  c.strokeStyle = 'rgba(30,10,20,0.5)'; c.lineWidth = 2;
  for (let y = 24; y < 300; y += 34) seg(c, 0, y, VIEW_W, y, 'rgba(30,10,20,0.5)', 2);
  const glow = 0.5 + 0.5 * Math.sin(frame * 0.05);
  stainedGlass(c, 110, 34, 62, 96, glow);
  stainedGlass(c, 530, 34, 62, 96, glow * 0.8);
  chandelier(c, 320, 78, 1, frame);
  // fluted columns
  for (const colx of [52, 588]) {
    flat(c, colx - 16, 60, 32, 240, '#6e3040');
    seg(c, colx - 16, 60, colx - 16, 300, INK, 2.5); seg(c, colx + 16, 60, colx + 16, 300, INK, 2.5);
    for (let i = -1; i <= 1; i++) seg(c, colx + i * 9, 66, colx + i * 9, 294, 'rgba(30,10,20,0.4)', 2);
    rect(c, colx - 22, 292, 44, 12, '#4c1f2c', 2.5);
  }
  // the golden Impeach statue in a lit wall NICHE (one huge golden hand raised)
  c.save();
  c.beginPath();
  c.moveTo(452, 208); c.lineTo(452, 128); c.arc(484, 128, 32, Math.PI, 0); c.lineTo(516, 208);
  c.closePath();
  c.fillStyle = '#3a1220'; c.fill();
  c.clip();
  const ng2 = c.createRadialGradient(484, 150, 6, 484, 150, 70);
  ng2.addColorStop(0, 'rgba(255,210,110,0.30)'); ng2.addColorStop(1, 'rgba(255,210,110,0)');
  c.fillStyle = ng2; c.fillRect(444, 96, 84, 120);
  poly(c, [[470, 204], [498, 204], [492, 168], [476, 168]], COIN, 2.5);   // gown
  disc(c, 484, 158, 9, COIN, 2.5);                                        // head
  c.beginPath(); c.moveTo(475, 152); c.quadraticCurveTo(485, 143, 495, 150);  // gold swoop
  c.quadraticCurveTo(500, 152, 499, 146); c.lineTo(494, 152); c.closePath();
  c.fillStyle = '#e0b83a'; c.fill(); c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
  ell(c, 466, 152, 8, 10, '#e0b83a', 2);                                  // the statue's one big hand
  c.restore();
  c.beginPath();
  c.moveTo(452, 208); c.lineTo(452, 128); c.arc(484, 128, 32, Math.PI, 0); c.lineTo(516, 208);
  c.closePath();
  c.strokeStyle = INK; c.lineWidth = 3; c.stroke();
  rect(c, 452, 208, 64, 13, '#6e3040', 2.5);                              // niche ledge
  txt(c, 'DEAR LEADER', 484, 215, 6, '#d9b53a', 'center', false);
  // the throne, empty, on its dais (left)
  flat(c, 34, 284, 150, 16, '#6e3040');
  seg(c, 34, 284, 184, 284, INK, 2.5);
  rect(c, 64, 150, 90, 134, COIN, 2.5);
  poly(c, [[64, 150], [154, 150], [154, 122], [130, 140], [109, 116], [88, 140], [64, 122]], COIN, 2.5);
  flat(c, 76, 168, 66, 100, '#a83240');
  // red carpet rolls toward the camera with a gold border
  checkerFloor(c, 300, '#3a1420', '#2e0f1a');
  poly(c, [[236, 300], [404, 300], [478, 360], [162, 360]], '#a83240', 2.5);
  seg(c, 248, 306, 172, 356, COIN_DARK, 3);
  seg(c, 392, 306, 468, 356, COIN_DARK, 3);
  for (let i = 0; i < 3; i++) {                              // carpet diamonds
    const dy = 316 + i * 14, dw = 8 + i * 3;
    poly(c, [[320, dy - 5], [320 + dw, dy], [320, dy + 5], [320 - dw, dy]], COIN_DARK, 0);
  }
  // THE MOMENT. Impeach revealed — wig OFF, frozen mid-gasp.
  drawImpeach(c, 320, 300, 1.15, { facing: 1, hands: 'down', mouth: 'open', wigOn: false, waveT: frame });
  txt(c, '!!', 320, 148, 26, '#fff');
  // the wig, mid-air, tumbling — the wind that took it made visible
  const wy = 138 + (Math.sin(frame * 0.06) + 1) * 14;
  c.save();
  c.translate(398, wy);
  c.rotate(frame * 0.05);
  c.beginPath(); c.arc(0, 0, 18, Math.PI * 0.95, Math.PI * 2.02); c.closePath();
  c.fillStyle = P.wig; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
  poly(c, [[14, -6], [30, -10], [27, -1], [14, 2]], P.wig, 2);
  c.restore();
  c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 2;  // gust swirls carrying it
  c.beginPath(); c.moveTo(350, wy - 40); c.quadraticCurveTo(390, wy - 56, 428, wy - 38); c.stroke();
  c.beginPath(); c.moveTo(362, wy - 22); c.quadraticCurveTo(398, wy - 34, 430, wy - 20); c.stroke();
  seg(c, 380, wy - 66, 392, wy - 52, 'rgba(255,255,255,0.4)', 2);
  // witnesses, frozen
  drawBowsonaro(c, 522, 300, 0.95, { facing: -1, pose: 'rant', mouth: 'open' });
  drawMangiani(c, 138, 300, 1.1, { facing: 1, eyes: 'honest', brows: 'raised', mouth: 'open', pose: 'point', backpack: true });
  txt(c, 'I KNEW IT!', 138, 152, 14, '#fff');
  // the press: one toad, one camera, one flash
  drawToad(c, 600, 344, 0.95, { facing: -1, mood: 'shock', camera: true, spot: '#3f8fd0' });
  if ((frame % 80) < 6) {
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  // FOREGROUND: royal drapes swag in from the top corners
  poly(c, [[0, 0], [150, 0], [96, 26], [34, 74], [0, 108]], '#7c1f30', 3);
  poly(c, [[640, 0], [490, 0], [544, 26], [606, 74], [640, 108]], '#7c1f30', 3);
  for (const [gx, gy] of [[60, 46], [580, 46]] as const) {
    c.strokeStyle = COIN_DARK; c.lineWidth = 2;
    c.beginPath(); c.arc(gx, gy, 30, Math.PI * 0.2, Math.PI * 0.6); c.stroke();
  }
  vignette(c, 0.34);
};

// --- ending 2: the real Peach, freed (sincere) --------------------------------
const scenePeachFreed: SceneFn = (c, frame) => {
  vgrad(c, [[0, '#101426'], [1, '#05070f']]);
  stoneWall(c, 41, 0, 300, '#1c2338', '#151b2e', 'rgba(120,140,190,0.16)');
  // continuity with the dungeon panel: same window (daylight now), same
  // tallies, same complaint box (finally emptied)
  rect(c, 130, 26, 76, 54, '#8fd0f0', 2.5);
  seg(c, 154, 26, 154, 80, INK, 4);
  seg(c, 180, 26, 180, 80, INK, 4);
  seg(c, 130, 52, 206, 52, INK, 3);
  c.save(); c.globalAlpha = 0.10;
  poly(c, [[132, 80], [204, 80], [260, 300], [90, 300]], '#cfe0ff', 0);
  c.restore();
  c.strokeStyle = 'rgba(220,228,255,0.45)'; c.lineWidth = 2;
  for (let g = 0; g < 4; g++) {
    for (let i = 0; i < 4; i++) seg(c, 96 + g * 26 + i * 5, 152, 98 + g * 26 + i * 5, 168, 'rgba(220,228,255,0.45)', 2);
    seg(c, 94 + g * 26, 168, 114 + g * 26, 152, 'rgba(220,228,255,0.45)', 2);
  }
  txt(c, 'day 94: OUT', 148, 184, 8, 'rgba(220,228,255,0.6)', 'center', false);
  rect(c, 246, 160, 56, 36, '#5c4322', 2.5);                 // complaint box, empty at last
  flat(c, 254, 166, 40, 5, '#141020');
  txt(c, 'COMPLAINTS', 274, 186, 7, '#c8b088', 'center', false);
  txt(c, '(resolved)', 274, 206, 7, '#8a94b8', 'center', false);
  // the dungeon door: OPEN at last, morning light flooding through
  poly(c, [[398, 300], [398, 96], [428, 76], [562, 76], [592, 96], [592, 300]], '#3a2c20');
  flat(c, 418, 92, 156, 208, '#fff4be');
  const dg = c.createLinearGradient(418, 0, 592, 0);        // depth inside the light
  dg.addColorStop(0, 'rgba(255,255,255,0.5)'); dg.addColorStop(1, 'rgba(255,220,140,0)');
  c.fillStyle = dg; c.fillRect(418, 92, 156, 208);
  poly(c, [[592, 96], [592, 300], [634, 300], [634, 130]], '#5c4322', LW);   // door leaf swung open
  for (const hz of [150, 240]) poly(c, [[594, hz], [628, hz + 6], [628, hz + 12], [594, hz + 6]], '#8a8494', 2);
  disc(c, 600, 210, 4, COIN, 2);
  c.save();
  c.globalAlpha = 0.28 + Math.sin(frame * 0.02) * 0.05;      // the shaft reaches the floor
  poly(c, [[418, 92], [572, 92], [340, 300], [60, 300]], '#fff4be', 0);
  c.restore();
  motes(c, 95, 16, 150, 110, 320, 200, frame);
  const srng = createRng(606);
  for (let i = 0; i < 7; i++) sparkle(c, 380 + srng() * 190, 100 + srng() * 170, 4 + srng() * 3, frame, srng() * 6);
  // FLOOR: cobbles — with flowers daring to sprout where the light lands
  cobbles(c, 45, 300, '#141a2e', 'rgba(70,84,120,0.5)');
  for (const [fx, fy, fc] of [[300, 322, '#f7d94c'], [352, 338, '#f299c0'], [258, 344, '#9ed8f7'], [390, 320, '#f7d94c']] as const) {
    seg(c, fx, fy, fx, fy - 9, '#3a7a2a', 2);
    for (let a = 0; a < 5; a++) disc(c, fx + Math.cos(a * 1.256) * 3.4, fy - 11 + Math.sin(a * 1.256) * 3.4, 2, fc, 0);
    disc(c, fx, fy - 11, 1.8, COIN, 0);
  }
  // broken shackle, OPEN, on the cobbles — nobody wears it again
  c.strokeStyle = '#4c5470'; c.lineWidth = 3.5;
  c.beginPath(); c.arc(210, 330, 9, Math.PI * 0.2, Math.PI * 1.5); c.stroke();
  seg(c, 218, 336, 230, 330, '#4c5470', 3.5);
  // Peach steps out of the light; Mangiani offers his hand, kind
  drawPeach(c, 468, 300, 1.2, { facing: -1, pose: 'step', mood: 'hope' });
  drawMangiani(c, 336, 300, 1.15, { facing: 1, eyes: 'honest', brows: 'raised', mouth: 'smile', pose: 'offer', backpack: true });
  txt(c, 'miss, your kingdom misses you.', 388, 56, 12, '#fff');
  // the cellmates celebrate: rats applaud, the skeleton raises his slip
  rat(c, 128, 300, 1, frame, 0, true);
  rat(c, 186, 300, 0.85, frame, 1.5, true);
  rect(c, 52, 262, 52, 38, '#6b4420', 2.5);                  // crate riser for the third rat
  seg(c, 52, 281, 104, 281, '#3d2c15', 2);
  rat(c, 78, 262, 0.9, frame, 3.1, true);
  skeleton(c, 252, 300, 1.0, { pose: 'salute', mood: 'happy' });
  // FOREGROUND: the doorframe edge slides into the shot, right
  flat(c, 634, 0, 6, VIEW_H, '#241b10');
  vignette(c, 0.28);
};

// --- ending 3: cell 1, the board of directors ---------------------------------
const sceneJail: SceneFn = (c, frame) => {
  vgrad(c, [[0, '#3a3f52'], [1, '#20242f']]);
  stoneWall(c, 51, 0, 306, '#4a4f62', '#3e4354', 'rgba(160,170,200,0.15)');
  // the window: outside is SUNNY — Mangiani & Peach at the ice-cream stand
  rect(c, 258, 36, 128, 92, '#2c303e', 3);
  c.save();
  c.beginPath(); c.rect(262, 40, 120, 84); c.clip();
  const wg = c.createLinearGradient(0, 40, 0, 124);
  wg.addColorStop(0, '#8fd0f0'); wg.addColorStop(1, '#c8e8d8');
  c.fillStyle = wg; c.fillRect(262, 40, 120, 84);
  const cwx = 262 + ((frame * 0.1) % 140);
  ell(c, cwx, 58, 16, 6, '#fff', 0);                        // a cloud crosses the window
  flat(c, 262, 102, 120, 22, '#8cba62');
  drawMangiani(c, 300, 120, 0.34, { facing: 1, eyes: 'honest', brows: 'raised', mouth: 'smile', pose: 'stand', backpack: false });
  drawPeach(c, 344, 120, 0.36, { facing: -1, pose: 'stand', mood: 'happy' });
  poly(c, [[312, 94], [318, 94], [315, 104]], '#c8a468', 1.5);  // cones held between them
  disc(c, 315, 91, 4, '#f7a8c8', 1.5);
  poly(c, [[327, 94], [333, 94], [330, 104]], '#c8a468', 1.5);
  disc(c, 330, 91, 4, '#9ed8f7', 1.5);
  c.restore();
  for (let i = 0; i < 4; i++) seg(c, 284 + i * 26, 36, 284 + i * 26, 128, '#20242f', 5);
  seg(c, 258, 82, 386, 82, '#20242f', 5);
  // the triple bunk: one bed per felon, name-tagged
  seg(c, 40, 116, 40, 306, '#5c4322', 5);
  seg(c, 160, 116, 160, 306, '#5c4322', 5);
  for (let b = 0; b < 3; b++) {
    const by = 150 + b * 58;
    flat(c, 36, by, 130, 8, '#6b4420');
    seg(c, 36, by, 166, by, INK, 2);
    flat(c, 42, by - 8, 118, 8, b === 1 ? '#7a5f8a' : '#5f768a');  // thin mattress ON the plank
    seg(c, 42, by - 8, 160, by - 8, INK, 1.5);
    rect(c, 166, by - 6, 16, 12, '#f4f0e6', 1.5);
    txt(c, ['B', 'I', 'E'][b]!, 174, by, 8, '#b9412f', 'center', false);
  }
  for (let r = 0; r < 4; r++) seg(c, 188, 306 - r * 40, 208, 306 - r * 40 - 24, '#5c4322', 3); // ladder leaning on the bunk
  // FLOOR: cold cobbles + the drain
  cobbles(c, 55, 306, '#2c3040', 'rgba(120,130,160,0.4)');
  ell(c, 330, 342, 14, 6, '#171a24', 2);
  seg(c, 322, 340, 338, 340, '#3a4054', 1.5);
  seg(c, 322, 344, 338, 344, '#3a4054', 1.5);
  // house rules, framed (they are not followed)
  rect(c, 196, 148, 52, 34, '#5c4322', 2);
  rect(c, 200, 152, 44, 26, '#e8ddc0', 1.5);
  txt(c, 'NO STAMPING', 222, 161, 5, '#3a2c1c', 'center', false);
  txt(c, 'AFTER 22:00', 222, 170, 5, '#3a2c1c', 'center', false);
  // Estrada's appeal desk — the paperwork empire continues from inside
  rect(c, 232, 252, 116, 10, '#6b4420', 2.5);
  seg(c, 242, 262, 238, 306, '#6b4420', 4);
  seg(c, 338, 262, 342, 306, '#6b4420', 4);
  const arng = createRng(707);
  for (let i = 0; i < 6; i++) {
    c.save(); c.translate(254 + arng() * 76, 246 - arng() * 8); c.rotate((arng() - 0.5) * 0.4);
    rect(c, -13, -8, 26, 16, '#f4f0e6', 2);
    c.restore();
  }
  txt(c, 'APPEALS', 292, 230, 9, P.estradaRed, 'center', false);
  drawEstrada(c, 206, 306, 0.95, { facing: 1, eyes: 'smug', mouth: 'flat', arms: 'stamp', item: 'stamp' });
  // Impeach, chalking the wall defense (one big hand, tiny chalk)
  drawImpeach(c, 396, 306, 0.95, { facing: 1, hands: 'chalk', mouth: 'pout', waveT: frame });
  const wob2 = Math.sin(frame * 0.07) * 2;
  txt(c, 'WITCH', 476, 168 + wob2, 16, '#e8e4f0', 'center', false);
  txt(c, 'HUNT!', 476, 188 + wob2, 16, '#e8e4f0', 'center', false);
  c.strokeStyle = 'rgba(232,228,240,0.5)'; c.lineWidth = 2;   // his chalk tallies of "days wronged"
  for (let g = 0; g < 3; g++) for (let i = 0; i < 4; i++) seg(c, 448 + g * 24 + i * 5, 206, 450 + g * 24 + i * 5, 220, 'rgba(232,228,240,0.5)', 2);
  // Bowsonaro appeals to the jury of rats
  drawBowsonaro(c, 506, 306, 0.92, { facing: 1, pose: 'rant', mouth: 'open' });
  speechSpikes(c, 538, 238, 3, frame);
  rect(c, 548, 286, 58, 8, '#6b4420', 2);                     // jury bench
  seg(c, 554, 294, 552, 306, '#5c4322', 3);
  seg(c, 600, 294, 602, 306, '#5c4322', 3);
  rat(c, 566, 286, 0.7, frame, 0.5);
  rat(c, 592, 286, 0.7, frame, 1.9);
  rect(c, 550, 278, 10, 5, '#8a5a2b', 1.5);                   // the foreman's gavel ON the bench
  seg(c, 555, 278, 555, 271, '#8a5a2b', 2);
  txt(c, 'CELL 1 — THE BOARD OF DIRECTORS', 320, 344, 11, '#9aa2c2');
  // FOREGROUND: we look in through the cell-door bars
  for (const bx of [8, 26]) rect(c, bx, 0, 9, VIEW_H, '#141824', 2);
  for (const bx of [613, 630]) rect(c, bx, 0, 8, VIEW_H, '#141824', 2);
  flat(c, 0, 60, 44, 10, '#141824');
  flat(c, 606, 60, 34, 10, '#141824');
  vignette(c, 0.36);
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
  'too-late-2': sceneTooLate2,
  'too-late-3': sceneTooLate3,
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
