// ============================================================================
// Parallax backgrounds — one full-screen painter per ThemeId.
// Pure presentation: reads cam/frame, draws to the given ctx, never touches
// module-level DOM state and never calls Math.random. All per-instance
// variation comes from hash01 (a pure integer hash), all motion from `frame`.
// Dispatch is an exhaustive Record<ThemeId, painter>; an unknown id THROWS.
// ============================================================================

import type { CameraState, ThemeId } from '../core/types.ts';
import { VIEW_W, VIEW_H } from '../core/constants.ts';

/** Parallax factors per depth layer (fraction of cam.x). */
const PARALLAX_FAR = 0.2;
const PARALLAX_MID = 0.4;
const PARALLAX_NEAR = 0.7;

/** Castle lightning: deterministic flash window. */
const LIGHTNING_PERIOD = 623;
const LIGHTNING_FRAMES = 6;

type Painter = (ctx: CanvasRenderingContext2D, cam: CameraState, frame: number) => void;

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Pure integer -> [0,1) hash (mulberry32 finalizer). Stable across frames. */
function hash01(n: number): number {
  let t = (n | 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Visit every instance of a horizontally repeating element that can touch the
 *  view, given the layer's scroll offset. cb receives (screenX, index). */
function tiled(ox: number, period: number, margin: number, cb: (sx: number, i: number) => void): void {
  const first = Math.floor((ox - margin) / period);
  const last = Math.floor((ox + VIEW_W + margin) / period);
  for (let i = first; i <= last; i++) cb(i * period - ox, i);
}

function vgrad(ctx: CanvasRenderingContext2D, y0: number, y1: number, stops: readonly (readonly [number, string])[]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function fillSky(ctx: CanvasRenderingContext2D, stops: readonly (readonly [number, string])[]): void {
  ctx.fillStyle = vgrad(ctx, 0, VIEW_H, stops);
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

// ---------------------------------------------------------------------------
// SET DRESSING — "THE WORLD IS A SET" (AGENTS.md). The sky is a painted
// canvas backdrop hung by the conspirators, and stagecraft is not among the
// skills their crimes required: stitch seams, a wrinkled fold, a curling
// corner with raw scaffolding behind it, sandbags + scaffold poles
// silhouetted at the screen edges, stage-light tripods on the skyline, and a
// boom mic that dips into the top of frame and slowly retracts on a fixed
// deterministic cycle. Everything stays SUBTLE at parallax distance and
// escalates meadow -> sewer -> casino -> castle — by the castle they stopped
// trying and a spare backdrop panel stenciled 'CASTLE (PROP)' just hangs
// there, askew.
//
// SINCERE ZONE: the sewer's barred-door cameo (the real Peach's dungeon) is
// NOT a set. No gag renders within CAMEO_CLEAR px of a cameo center —
// same-layer gags skip those slots outright (stable: same parallax layer),
// and the screen-fixed edge rigging fades out as a cameo slides near.
// ---------------------------------------------------------------------------

const SEWER_ARCH_PERIOD = 170;
/** Every Nth arch holds the dungeon door (see drawSewer). */
const SEWER_CAMEO_EVERY = 8;
const SEWER_CAMEO_INDEX = 3;
const CAMEO_CLEAR = 100;

/** Sincere-zone scale for a far-layer x: 0 within CAMEO_CLEAR px of a
 *  dungeon-door cameo center, ramping to 1 by CAMEO_CLEAR + 70 px out. */
function cameoClearance(farX: number): number {
  const period = SEWER_ARCH_PERIOD * SEWER_CAMEO_EVERY;
  const c = SEWER_ARCH_PERIOD * SEWER_CAMEO_INDEX;
  const wrapped = (((farX - c) % period) + period) % period;
  const d = Math.min(wrapped, period - wrapped);
  if (d <= CAMEO_CLEAR) return 0;
  return Math.min(1, (d - CAMEO_CLEAR) / 70);
}

interface DressingSpec {
  /** Px between canvas stitch seams (far-layer space). */
  seamPeriod: number;
  /** Seam stroke color incl. alpha — light on dark skies, dark on light. */
  seamStyle: string;
  /** Px between wrinkled folds in the canvas. */
  foldPeriod: number;
  /** Which top corner of the backdrop curls open, and how far. */
  curl: 'tl' | 'tr';
  curlSize: number;
  /** Sandbags + scaffold poles at the screen edges (silhouette alpha). */
  riggingAlpha: number;
  /** The ground line the edge rigging stands on. */
  riggingBaseY: number;
  /** Boom mic max dip below the top of frame, and frames per cycle. */
  micDepth: number;
  micPeriod: number;
  /** Stage-light tripods on the skyline. */
  tripodPeriod: number;
  tripodChance: number;
  tripodBaseY: number;
  /** Castle only: the spare 'CASTLE (PROP)' backdrop panel, hung askew. */
  propPanel: boolean;
  /** Sincere-zone scale for a far-layer x (1 = all clear). null = no zone. */
  guard: ((farX: number) => number) | null;
}

/** Exhaustive: a new theme does not compile until it declares how badly its
 *  producer dressed the set. Escalates in theme order. */
const SET_DRESSING: Record<ThemeId, DressingSpec> = {
  meadow: {
    seamPeriod: 480, seamStyle: 'rgba(80,55,40,0.06)', foldPeriod: 1100,
    curl: 'tr', curlSize: 38, riggingAlpha: 0.28, riggingBaseY: 300,
    micDepth: 20, micPeriod: 1560, tripodPeriod: 160, tripodChance: 0.15,
    tripodBaseY: 252, propPanel: false, guard: null,
  },
  sewer: {
    seamPeriod: 400, seamStyle: 'rgba(190,215,205,0.05)', foldPeriod: 950,
    curl: 'tl', curlSize: 42, riggingAlpha: 0.4, riggingBaseY: 330,
    micDepth: 26, micPeriod: 1320, tripodPeriod: 150, tripodChance: 0.22,
    tripodBaseY: 320, propPanel: false, guard: cameoClearance,
  },
  casino: {
    seamPeriod: 330, seamStyle: 'rgba(255,255,255,0.06)', foldPeriod: 820,
    curl: 'tr', curlSize: 46, riggingAlpha: 0.5, riggingBaseY: 300,
    micDepth: 32, micPeriod: 1140, tripodPeriod: 140, tripodChance: 0.3,
    tripodBaseY: 300, propPanel: false, guard: null,
  },
  castle: {
    seamPeriod: 260, seamStyle: 'rgba(255,235,215,0.10)', foldPeriod: 640,
    curl: 'tr', curlSize: 54, riggingAlpha: 0.62, riggingBaseY: 310,
    micDepth: 40, micPeriod: 930, tripodPeriod: 130, tripodChance: 0.42,
    tripodBaseY: 310, propPanel: true, guard: null,
  },
};

/** Vertical stitch seams + the occasional wrinkled fold — the sky is sewn
 *  together from panels and nobody ironed it. */
function drawCanvasFlaws(ctx: CanvasRenderingContext2D, oxFar: number, spec: DressingSpec): void {
  tiled(oxFar, spec.seamPeriod, 20, (sx, i) => {
    if (spec.guard && spec.guard(sx + oxFar) < 1) return;
    const wob = hash01(i * 173 + 41) * 3 - 1.5;
    ctx.strokeStyle = spec.seamStyle;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.quadraticCurveTo(sx + wob, 160, sx, 320);
    ctx.stroke();
    // whip stitches across the seam
    ctx.beginPath();
    for (let y = 18 + (((i % 3) + 3) % 3) * 7; y < 320; y += 34) {
      ctx.moveTo(sx - 3 + wob * (y / 320), y);
      ctx.lineTo(sx + 3 + wob * (y / 320), y + 3);
    }
    ctx.stroke();
  });
  tiled(oxFar, spec.foldPeriod, 40, (sx, i) => {
    if (spec.guard && spec.guard(sx + oxFar) < 1) return;
    const bend = hash01(i * 211 + 7) * 24 - 12;
    // a crease: shadow line + highlight line, slightly bent
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.quadraticCurveTo(sx + bend, 170, sx - bend * 0.4, 320);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(sx + 3, 0);
    ctx.quadraticCurveTo(sx + 3 + bend, 170, sx + 3 - bend * 0.4, 320);
    ctx.stroke();
  });
}

/** Stage-light tripods silhouetted on the skyline. One is still on. */
function drawSkylineTripods(ctx: CanvasRenderingContext2D, oxFar: number, spec: DressingSpec): void {
  tiled(oxFar, spec.tripodPeriod, 20, (sx, i) => {
    if (hash01(i * 149 + 71) > spec.tripodChance) return;
    if (spec.guard && spec.guard(sx + oxFar) < 1) return;
    const by = spec.tripodBaseY;
    ctx.strokeStyle = 'rgba(25,20,26,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx - 5, by);
    ctx.lineTo(sx, by - 13);
    ctx.moveTo(sx + 5, by);
    ctx.lineTo(sx, by - 13);
    ctx.moveTo(sx, by);
    ctx.lineTo(sx, by - 15);
    ctx.stroke();
    ctx.fillStyle = 'rgba(25,20,26,0.7)';
    ctx.fillRect(sx - 3, by - 20, 6, 6); // the lamp head
    // a warm pilot glow — someone left it on, it's on the kingdom's tab
    ctx.fillStyle = 'rgba(255,205,120,0.5)';
    ctx.fillRect(sx - 1, by - 17, 2, 2);
  });
}

/** Sandbags + scaffold poles at the screen edges — the wings are showing. */
function drawEdgeRigging(ctx: CanvasRenderingContext2D, oxFar: number, spec: DressingSpec): void {
  for (const side of [-1, 1] as const) {
    const ex = side === -1 ? 9 : VIEW_W - 9;
    const scale = spec.guard ? spec.guard(ex + oxFar) : 1;
    if (scale <= 0) continue;
    const a = (spec.riggingAlpha * scale).toFixed(3);
    const by = spec.riggingBaseY;
    ctx.fillStyle = `rgba(18,14,20,${a})`;
    // scaffold pole with a coupler plate
    ctx.fillRect(ex - 2, by - 150, 4, 150);
    ctx.fillRect(ex - 4, by - 96, 8, 4);
    // diagonal brace running off-screen
    ctx.strokeStyle = `rgba(18,14,20,${a})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ex, by - 88);
    ctx.lineTo(ex + side * 20, by);
    ctx.stroke();
    // sandbags at the foot
    ctx.fillStyle = `rgba(18,14,20,${a})`;
    for (let s = 0; s < 3; s++) {
      const bx = ex - side * (4 + s * 9);
      const bagY = by - 4 - (s === 1 ? 6 : 0);
      ctx.beginPath();
      ctx.ellipse(bx, bagY, 7, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** The boom mic: dips into the top of frame, hovers, then SLOWLY retracts,
 *  on a fixed deterministic cycle. Nobody is fooled. */
function drawBoomMic(ctx: CanvasRenderingContext2D, frame: number, spec: DressingSpec): void {
  const ph = (frame % spec.micPeriod) / spec.micPeriod;
  let t = 0;
  if (ph < 0.1) t = ph / 0.1; // dips in
  else if (ph < 0.34) t = 1; // hovers, hoping nobody noticed
  else if (ph < 0.7) t = 1 - (ph - 0.34) / 0.36; // the slow guilty retreat
  if (t <= 0) return;
  const cyc = Math.floor(frame / spec.micPeriod);
  const mx = VIEW_W * (0.24 + hash01(cyc * 23 + 9) * 0.52);
  const tipY = spec.micDepth * t - 6;
  ctx.strokeStyle = '#241f28';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(mx - 26, -8);
  ctx.lineTo(mx, tipY);
  ctx.stroke();
  // fuzzy windscreen
  ctx.fillStyle = '#3a333d';
  ctx.beginPath();
  ctx.ellipse(mx + 3, tipY + 4, 9, 6, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,80,95,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let f = 0; f < 7; f++) {
    const ang = f * 0.9;
    const fx = mx + 3 + Math.cos(ang) * 9;
    const fy = tipY + 4 + Math.sin(ang) * 6;
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + Math.cos(ang) * 2.5, fy + Math.sin(ang) * 2.5);
  }
  ctx.stroke();
}

/** A top corner of the backdrop curls open: raw scaffolding in the gap. */
function drawCurlCorner(ctx: CanvasRenderingContext2D, spec: DressingSpec): void {
  const s = spec.curlSize;
  const right = spec.curl === 'tr';
  const cx = right ? VIEW_W : 0;
  const dir = right ? -1 : 1;
  // the void behind the canvas
  ctx.fillStyle = '#16121a';
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx + dir * s, 0);
  ctx.lineTo(cx, s);
  ctx.closePath();
  ctx.fill();
  // raw scaffolding poles in the gap
  ctx.strokeStyle = '#4d4341';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + dir * s * 0.66, 0);
  ctx.lineTo(cx + dir * s * 0.1, s * 0.62);
  ctx.moveTo(cx + dir * s * 0.32, 0);
  ctx.lineTo(cx, s * 0.35);
  ctx.stroke();
  // the curled flap: back side of the canvas, rolled along the tear line
  ctx.fillStyle = '#e3d6b6';
  ctx.beginPath();
  ctx.moveTo(cx + dir * s, 0);
  ctx.quadraticCurveTo(cx + dir * (s * 0.5 + 14), s * 0.5 + 14, cx, s);
  ctx.quadraticCurveTo(cx + dir * (s * 0.5 + 4), s * 0.5 + 4, cx + dir * s, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c9b992';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx + dir * s * 0.92, 4);
  ctx.quadraticCurveTo(cx + dir * (s * 0.5 + 10), s * 0.5 + 10, cx + dir * 3, s * 0.92);
  ctx.stroke();
}

/** Castle only: they stopped trying. A spare backdrop panel stenciled
 *  'CASTLE (PROP)' hangs askew from two ropes — one of them slipped. */
function drawPropPanel(ctx: CanvasRenderingContext2D, oxFar: number, frame: number): void {
  tiled(oxFar, 1150, 220, (sx, i) => {
    const h = hash01(i * 211 + 13);
    const py = 70 + h * 26;
    const tilt = 0.09 + h * 0.06 + Math.sin(frame * 0.006 + i * 2.3) * 0.01;
    // ropes to the rig above the frame — one taut, one sagging
    ctx.strokeStyle = '#2a2226';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx - 46, 0);
    ctx.lineTo(sx - 60, py - 34);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx + 70, 0);
    ctx.quadraticCurveTo(sx + 82, py * 0.7, sx + 58, py - 46);
    ctx.stroke();
    ctx.save();
    ctx.translate(sx, py);
    ctx.rotate(tilt);
    // raw canvas panel
    ctx.fillStyle = '#cfc09c';
    ctx.fillRect(-70, -44, 140, 88);
    ctx.strokeStyle = '#a89a72';
    ctx.lineWidth = 2;
    ctx.strokeRect(-70, -44, 140, 88);
    // the "castle": one flat grey keep, two towers, zero effort
    ctx.fillStyle = '#7d7688';
    ctx.fillRect(-34, -22, 68, 44);
    ctx.fillRect(-52, -30, 16, 52);
    ctx.fillRect(36, -30, 16, 52);
    for (let c = 0; c < 4; c++) ctx.fillRect(-32 + c * 18, -28, 9, 6);
    ctx.fillStyle = '#4f4a58';
    ctx.fillRect(-8, 0, 16, 22); // roughly centered, roughly a door
    // the stencil, spray-through, not even straight
    ctx.fillStyle = 'rgba(30,24,28,0.8)';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CASTLE (PROP)', 2, 34);
    ctx.restore();
  });
}

// ---------------------------------------------------------------------------
// MEADOW — warm sky, fat clouds, foreclosed mushroom-house skyline, hills,
// and the TOAD'S BETS blimp slowly trawling for new suckers.
// ---------------------------------------------------------------------------

function drawMeadow(ctx: CanvasRenderingContext2D, cam: CameraState, frame: number): void {
  fillSky(ctx, [[0, '#5aa7e0'], [0.55, '#a8d4ef'], [0.8, '#ffe2a8'], [1, '#ffd489']]);

  // Sun, low and golden — the kingdom's assets set with it.
  ctx.fillStyle = 'rgba(255,240,190,0.9)';
  ctx.beginPath();
  ctx.arc(520, 74, 26, 0, Math.PI * 2);
  ctx.fill();

  // The blimp: screen-space drift right-to-left, towing the grift banner.
  const span = VIEW_W + 560;
  const bx = VIEW_W + 200 - ((frame * 0.3) % span);
  const by = 52 + Math.sin(frame * 0.01) * 4;
  ctx.fillStyle = '#8d97a6';
  ctx.beginPath();
  ctx.ellipse(bx, by, 34, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6f7987';
  ctx.fillRect(bx - 6, by + 9, 12, 5); // gondola
  ctx.beginPath(); // tail fin
  ctx.moveTo(bx + 28, by - 8);
  ctx.lineTo(bx + 42, by - 12);
  ctx.lineTo(bx + 42, by + 4);
  ctx.closePath();
  ctx.fill();
  // Tow rope + banner trailing behind (blimp flies left, banner to the right).
  ctx.strokeStyle = '#5c6470';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx + 40, by);
  ctx.lineTo(bx + 58, by + 6);
  ctx.stroke();
  ctx.fillStyle = '#fff6e0';
  ctx.fillRect(bx + 58, by - 2, 78, 15);
  ctx.fillStyle = '#c62828';
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText("TOAD'S BETS", bx + 97, by + 6);

  // FAR (0.2): fat clouds drifting, then the hazy mushroom-house skyline.
  const oxFar = cam.x * PARALLAX_FAR;
  tiled(oxFar + frame * 0.06, 230, 90, (sx, i) => {
    const h = hash01(i * 31 + 7);
    const cy = 42 + h * 76;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.arc(sx, cy, 13 + h * 6, 0, Math.PI * 2);
    ctx.arc(sx + 15, cy - 5, 11 + h * 5, 0, Math.PI * 2);
    ctx.arc(sx + 30, cy + 1, 12 + h * 4, 0, Math.PI * 2);
    ctx.arc(sx + 15, cy + 6, 14, 0, Math.PI * 2);
    ctx.fill();
  });
  const skylineY = 252;
  tiled(oxFar, 96, 60, (sx, i) => {
    const h = hash01(i * 53 + 1);
    const hh = 18 + h * 20; // house height
    const w = 20 + h * 8;
    // stem + cap silhouette in warm haze
    ctx.fillStyle = '#c9a9b8';
    ctx.fillRect(sx - w * 0.32, skylineY - hh, w * 0.64, hh);
    ctx.beginPath();
    ctx.arc(sx, skylineY - hh, w * 0.62, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#b3919f';
    ctx.fillRect(sx - 2, skylineY - 7, 4, 7); // dark doorway
    if (h > 0.45) {
      // FOR SALE sign out front — the whole street is on the market.
      ctx.fillStyle = '#8a7268';
      ctx.fillRect(sx + w * 0.45, skylineY - 9, 1, 9);
      ctx.fillStyle = '#fdf6e3';
      ctx.fillRect(sx + w * 0.45 - 8, skylineY - 15, 17, 7);
      ctx.fillStyle = '#a03030';
      ctx.font = 'bold 5px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FOR SALE', sx + w * 0.45, skylineY - 11);
    }
  });
  // haze ground line under the skyline
  ctx.fillStyle = '#d9bfa8';
  ctx.fillRect(0, skylineY, VIEW_W, VIEW_H - skylineY);

  // THE SET: the sky is sewn canvas; the crew's gear is not quite hidden.
  const set = SET_DRESSING.meadow;
  drawCanvasFlaws(ctx, oxFar, set);
  drawSkylineTripods(ctx, oxFar, set);

  // MID (0.4): rolling hills.
  const oxMid = cam.x * PARALLAX_MID;
  ctx.fillStyle = '#8fca62';
  tiled(oxMid, 250, 160, (sx, i) => {
    const h = hash01(i * 71 + 3);
    const r = 110 + h * 60;
    ctx.beginPath();
    ctx.arc(sx, 268 + r * 0.55, r, Math.PI, 0);
    ctx.fill();
  });
  ctx.fillStyle = '#8fca62';
  ctx.fillRect(0, 300, VIEW_W, VIEW_H - 300);

  // NEAR (0.7): darker hill row.
  const oxNear = cam.x * PARALLAX_NEAR;
  ctx.fillStyle = '#5fa844';
  tiled(oxNear, 190, 140, (sx, i) => {
    const h = hash01(i * 97 + 11);
    const r = 80 + h * 50;
    ctx.beginPath();
    ctx.arc(sx, 330 + r * 0.5, r, Math.PI, 0);
    ctx.fill();
  });
  ctx.fillRect(0, 344, VIEW_W, VIEW_H - 344);

  // stage gear over the whole backdrop (still behind tiles + gameplay)
  drawEdgeRigging(ctx, oxFar, set);
  drawBoomMic(ctx, frame, set);
  drawCurlCorner(ctx, set);
}

// ---------------------------------------------------------------------------
// SEWER — the money pipes. Dark vault, arched brickwork, chains, grate light,
// rat eyes, and — recurring, easy to miss — a barred door with a tiny pink
// crown behind it. The real Peach is down here. Nobody is looking.
// ---------------------------------------------------------------------------

function drawSewer(ctx: CanvasRenderingContext2D, cam: CameraState, frame: number): void {
  fillSky(ctx, [[0, '#131a1c'], [0.6, '#0d1214'], [1, '#080c0d']]);

  // FAR (0.2): arched brick wall.
  const oxFar = cam.x * PARALLAX_FAR;
  ctx.fillStyle = '#1c2427';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // faint mortar courses
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = 12; y < VIEW_H; y += 14) ctx.fillRect(0, y, VIEW_W, 1);
  tiled(oxFar, SEWER_ARCH_PERIOD, 90, (sx, i) => {
    // dark arched recess
    ctx.fillStyle = '#11171a';
    ctx.beginPath();
    ctx.moveTo(sx - 28, 320);
    ctx.lineTo(sx - 28, 140);
    ctx.arc(sx, 140, 28, Math.PI, 0);
    ctx.lineTo(sx + 28, 320);
    ctx.closePath();
    ctx.fill();
    // Every SEWER_CAMEO_EVERYth arch: the dungeon door. Bars, and a tiny pink
    // crown waiting. This cameo is SINCERE — cameoClearance() keeps every set
    // gag at least CAMEO_CLEAR px away. The REAL kingdom is not a set.
    if (((i % SEWER_CAMEO_EVERY) + SEWER_CAMEO_EVERY) % SEWER_CAMEO_EVERY === SEWER_CAMEO_INDEX) {
      ctx.fillStyle = '#07090b';
      ctx.fillRect(sx - 16, 210, 32, 110);
      ctx.strokeStyle = '#2a3438';
      ctx.lineWidth = 2;
      for (let b = -12; b <= 12; b += 6) {
        ctx.beginPath();
        ctx.moveTo(sx + b, 212);
        ctx.lineTo(sx + b, 318);
        ctx.stroke();
      }
      // the crown: 5px of pink in a kingdom of murk
      ctx.fillStyle = '#ff9ecf';
      ctx.fillRect(sx - 3, 258, 6, 3);
      ctx.fillRect(sx - 3, 255, 1, 3);
      ctx.fillRect(sx - 1, 255, 2, 3);
      ctx.fillRect(sx + 2, 255, 1, 3);
    }
  });

  // THE SET: even down here the wall is canvas — except near the door.
  const set = SET_DRESSING.sewer;
  drawCanvasFlaws(ctx, oxFar, set);
  drawSkylineTripods(ctx, oxFar, set);

  // MID (0.4): grate light shafts, hanging chains, rat eyes.
  const oxMid = cam.x * PARALLAX_MID;
  tiled(oxMid, 330, 120, (sx, i) => {
    const h = hash01(i * 37 + 5);
    const w = 34 + h * 18;
    // grate slats at the top
    ctx.fillStyle = '#04070a';
    for (let s = 0; s < 5; s++) ctx.fillRect(sx - w / 2 + (s * w) / 5, 0, w / 9, 4);
    // shaft widening downward, breathing slightly with frame
    const sway = Math.sin(frame * 0.008 + i) * 4;
    ctx.fillStyle = 'rgba(150,255,205,0.055)';
    ctx.beginPath();
    ctx.moveTo(sx - w / 2, 0);
    ctx.lineTo(sx + w / 2, 0);
    ctx.lineTo(sx + w * 1.1 + sway, VIEW_H - 30);
    ctx.lineTo(sx - w * 1.1 + sway, VIEW_H - 30);
    ctx.closePath();
    ctx.fill();
  });
  tiled(oxMid, 88, 40, (sx, i) => {
    const h = hash01(i * 59 + 13);
    if (h < 0.35) return; // gaps between chains
    const len = 34 + h * 80;
    const sway = Math.sin(frame * 0.015 + i * 1.3) * 2;
    ctx.strokeStyle = '#2e383d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.quadraticCurveTo(sx + sway, len * 0.6, sx + sway, len);
    ctx.stroke();
    ctx.fillStyle = '#39454b';
    ctx.beginPath();
    ctx.arc(sx + sway, len + 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
  tiled(oxMid, 270, 40, (sx, i) => {
    const h = hash01(i * 83 + 29);
    if (h < 0.5) return;
    // rat eyes blink: mostly on, briefly off, offset per instance
    if (((frame + i * 137) % 420) > 360) return;
    const ey = 296 + h * 26;
    ctx.fillStyle = '#ffb84d';
    ctx.fillRect(sx, ey, 2, 2);
    ctx.fillRect(sx + 5, ey, 2, 2);
  });

  // NEAR (0.7): fat pipe silhouettes running along the wall.
  const oxNear = cam.x * PARALLAX_NEAR;
  tiled(oxNear, 240, 90, (sx, i) => {
    const h = hash01(i * 101 + 17);
    const px = sx + h * 60;
    ctx.fillStyle = '#232d32';
    ctx.fillRect(px - 9, 0, 18, VIEW_H - 24);
    ctx.fillStyle = '#2b373d';
    ctx.fillRect(px - 11, 40 + h * 60, 22, 6); // flange
    ctx.fillRect(px - 11, 160 + h * 80, 22, 6);
  });

  // Murky water strip at the bottom, sine ripple on the surface.
  const wtop = VIEW_H - 26;
  ctx.fillStyle = 'rgba(24,46,38,0.85)';
  ctx.beginPath();
  ctx.moveTo(0, VIEW_H);
  for (let x = 0; x <= VIEW_W; x += 8) {
    ctx.lineTo(x, wtop + Math.sin((x + cam.x * PARALLAX_NEAR) * 0.05 + frame * 0.06) * 2);
  }
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,220,190,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= VIEW_W; x += 8) {
    const y = wtop + Math.sin((x + cam.x * PARALLAX_NEAR) * 0.05 + frame * 0.06) * 2;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // stage gear (the rigging fades out when the dungeon door slides near)
  drawEdgeRigging(ctx, oxFar, set);
  drawBoomMic(ctx, frame, set);
  drawCurlCorner(ctx, set);
}

// ---------------------------------------------------------------------------
// CASINO — the scam made architecture. Night sky, neon skyline, a ferris
// wheel of card suits, spotlights hunting for the last solvent Toad.
// ---------------------------------------------------------------------------

function drawCasino(ctx: CanvasRenderingContext2D, cam: CameraState, frame: number): void {
  fillSky(ctx, [[0, '#0d0b26'], [0.7, '#221040'], [1, '#331550']]);

  const oxFar = cam.x * PARALLAX_FAR;
  // stars, twinkling
  tiled(oxFar, 46, 20, (sx, i) => {
    const h = hash01(i * 43 + 19);
    const sy = 8 + h * 150;
    const tw = 0.35 + 0.55 * Math.abs(Math.sin(frame * 0.04 + h * 6.28));
    ctx.fillStyle = `rgba(255,255,235,${tw.toFixed(2)})`;
    ctx.fillRect(sx + h * 30, sy, 1.5, 1.5);
  });

  // FAR (0.2): skyline with neon.
  tiled(oxFar, 150, 90, (sx, i) => {
    const h = hash01(i * 67 + 23);
    const bw = 54 + h * 40;
    const bh = 70 + h * 90;
    const by = 300 - bh;
    ctx.fillStyle = '#191233';
    ctx.fillRect(sx - bw / 2, by, bw, bh);
    // lit windows
    ctx.fillStyle = 'rgba(255,220,130,0.35)';
    for (let wy = by + 8; wy < 292; wy += 12) {
      for (let wx = sx - bw / 2 + 6; wx < sx + bw / 2 - 6; wx += 10) {
        if (hash01(i * 977 + wy * 31 + wx) > 0.5) ctx.fillRect(wx, wy, 3, 4);
      }
    }
    // neon: flickers off for a beat now and then
    const lit = ((frame + i * 53) % 240) >= 14;
    const sign = ((i % 3) + 3) % 3;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (sign === 0) {
      ctx.fillStyle = lit ? '#ff4fd8' : '#552044';
      ctx.fillText('BETS', sx, by - 5);
    } else if (sign === 1) {
      ctx.fillStyle = lit ? '#54ff9f' : '#1e5537';
      ctx.fillText('☘ WIN', sx, by - 5);
    } else {
      // giant dice on the roof
      const dy = by - 18;
      ctx.save();
      ctx.translate(sx, dy);
      ctx.rotate(0.18);
      ctx.fillStyle = lit ? '#f2f2f6' : '#9a9aa5';
      ctx.fillRect(-8, -8, 16, 16);
      ctx.fillStyle = '#c02040';
      ctx.fillRect(-5, -5, 3, 3);
      ctx.fillRect(2, -5, 3, 3);
      ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.fillRect(-5, 2, 3, 3);
      ctx.fillRect(2, 2, 3, 3);
      ctx.restore();
    }
  });
  ctx.fillStyle = '#141028';
  ctx.fillRect(0, 300, VIEW_W, VIEW_H - 300);

  // THE SET: neon can't hide a stitched sky. Trump ordered EXTRA tripods.
  const set = SET_DRESSING.casino;
  drawCanvasFlaws(ctx, oxFar, set);
  drawSkylineTripods(ctx, oxFar, set);

  // MID (0.4): the ferris wheel of card suits, turning slowly.
  const oxMid = cam.x * PARALLAX_MID;
  tiled(oxMid, 860, 180, (sx, i) => {
    const cy = 196;
    const r = 72;
    const a0 = frame * 0.004 + hash01(i * 7 + 2) * 6.28;
    ctx.strokeStyle = '#7f5fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    const suits = ['♠', '♥', '♦', '♣'] as const;
    for (let s = 0; s < 8; s++) {
      const a = a0 + (s * Math.PI) / 4;
      const px = sx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      ctx.strokeStyle = '#5a44b8';
      ctx.beginPath();
      ctx.moveTo(sx, cy);
      ctx.lineTo(px, py);
      ctx.stroke();
      const suit = suits[s % 4]!;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = s % 2 === 0 ? '#f2f2f6' : '#ff5a6e';
      ctx.fillText(suit, px, py + 4);
    }
    // support legs
    ctx.strokeStyle = '#3d2f80';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - 26, 330);
    ctx.lineTo(sx, cy);
    ctx.lineTo(sx + 26, 330);
    ctx.stroke();
  });

  // NEAR (0.7): sweeping spotlights + a strip of midway bulbs.
  const oxNear = cam.x * PARALLAX_NEAR;
  tiled(oxNear, 520, 200, (sx, i) => {
    const a = Math.sin(frame * 0.008 + i * 1.7) * 0.55;
    ctx.fillStyle = 'rgba(255,240,180,0.09)';
    ctx.beginPath();
    ctx.moveTo(sx, VIEW_H);
    ctx.lineTo(sx + Math.sin(a - 0.06) * 460, VIEW_H - Math.cos(a - 0.06) * 460);
    ctx.lineTo(sx + Math.sin(a + 0.06) * 460, VIEW_H - Math.cos(a + 0.06) * 460);
    ctx.closePath();
    ctx.fill();
  });
  const bulbColors = ['#ff5a6e', '#ffd23f', '#54ff9f'] as const;
  for (let x = -16; x <= VIEW_W + 16; x += 16) {
    const gi = Math.floor((x + oxNear) / 16);
    const c = bulbColors[(((gi + Math.floor(frame / 20)) % 3) + 3) % 3]!;
    ctx.fillStyle = c;
    ctx.fillRect(x - ((oxNear % 16) + 16) % 16, 336, 3, 3);
  }

  // stage gear over the glitz
  drawEdgeRigging(ctx, oxFar, set);
  drawBoomMic(ctx, frame, set);
  drawCurlCorner(ctx, set);
}

// ---------------------------------------------------------------------------
// CASTLE — Bowsonaro's Grand Palace. Blood sky, deterministic lightning,
// gold statues of Impeach (the hands, drawn BIG), lava-glow horizon,
// shell-emblem banners.
// ---------------------------------------------------------------------------

function drawCastle(ctx: CanvasRenderingContext2D, cam: CameraState, frame: number): void {
  const flash = (frame % LIGHTNING_PERIOD) < LIGHTNING_FRAMES;
  fillSky(ctx, [[0, '#3d060a'], [0.55, '#611010'], [1, '#7c1d10']]);

  // lava glow horizon, pulsing
  const pulse = 0.35 + 0.15 * Math.sin(frame * 0.02);
  ctx.fillStyle = vgrad(ctx, 250, VIEW_H, [
    [0, 'rgba(255,120,20,0)'],
    [0.6, `rgba(255,120,20,${pulse.toFixed(2)})`],
    [1, `rgba(255,170,40,${(pulse + 0.15).toFixed(2)})`],
  ]);
  ctx.fillRect(0, 250, VIEW_W, VIEW_H - 250);

  if (flash) {
    ctx.fillStyle = 'rgba(255,225,225,0.28)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // one jagged bolt, position stable for the duration of this flash
    const bseed = Math.floor(frame / LIGHTNING_PERIOD);
    let bx = hash01(bseed * 17 + 5) * VIEW_W;
    ctx.strokeStyle = '#fff3f3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    let by = 0;
    for (let s = 1; by < 230; s++) {
      bx += (hash01(bseed * 131 + s) - 0.5) * 46;
      by += 24 + hash01(bseed * 197 + s) * 22;
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }

  // FAR (0.2): obsidian palace skyline.
  const oxFar = cam.x * PARALLAX_FAR;
  tiled(oxFar, 180, 100, (sx, i) => {
    const h = hash01(i * 61 + 9);
    const tw = 40 + h * 34;
    const th = 90 + h * 110;
    const ty = 310 - th;
    ctx.fillStyle = flash ? '#33131b' : '#200609';
    ctx.fillRect(sx - tw / 2, ty, tw, th);
    // crenellated top
    for (let c = 0; c < 5; c++) ctx.fillRect(sx - tw / 2 + (c * tw) / 5, ty - 7, tw / 9, 7);
    // one lit window
    ctx.fillStyle = '#ff9d3c';
    ctx.fillRect(sx - 2, ty + 16 + h * 30, 4, 6);
  });
  ctx.fillStyle = flash ? '#33131b' : '#200609';
  ctx.fillRect(0, 310, VIEW_W, VIEW_H - 310);

  // THE SET: by world 4 they stopped trying. Seams everywhere, tripods
  // everywhere, and the spare backdrop panel is just... hanging there.
  const set = SET_DRESSING.castle;
  drawCanvasFlaws(ctx, oxFar, set);
  drawSkylineTripods(ctx, oxFar, set);
  if (set.propPanel) drawPropPanel(ctx, oxFar, frame);

  // MID (0.4): gold statues of Princess Impeach on pedestals.
  const oxMid = cam.x * PARALLAX_MID;
  tiled(oxMid, 340, 90, (sx, i) => {
    const h = hash01(i * 89 + 21);
    const baseY = 322;
    const gold = flash ? '#f5c86a' : '#d9a530';
    const goldDark = flash ? '#c99f45' : '#a87c20';
    // pedestal
    ctx.fillStyle = '#2a0f12';
    ctx.fillRect(sx - 16, baseY - 14, 32, 14);
    ctx.fillRect(sx - 12, baseY - 40, 24, 26);
    // dress (triangle skirt + bodice)
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.moveTo(sx, baseY - 92);
    ctx.lineTo(sx - 15, baseY - 40);
    ctx.lineTo(sx + 15, baseY - 40);
    ctx.closePath();
    ctx.fill();
    // head + wig puff
    ctx.beginPath();
    ctx.arc(sx, baseY - 99, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = goldDark;
    ctx.fillRect(sx - 8, baseY - 106, 16, 4); // the swoop
    // tiny crown
    ctx.fillStyle = gold;
    ctx.fillRect(sx - 3, baseY - 112, 6, 3);
    ctx.fillRect(sx - 3, baseY - 115, 1, 3);
    ctx.fillRect(sx - 0.5, baseY - 115, 1, 3);
    ctx.fillRect(sx + 2, baseY - 115, 1, 3);
    // thin arms ending in ENORMOUS hands (the sculptor was paid to notice)
    ctx.strokeStyle = gold;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx - 6, baseY - 84);
    ctx.lineTo(sx - 20, baseY - 72);
    ctx.moveTo(sx + 6, baseY - 84);
    ctx.lineTo(sx + 20, baseY - 72);
    ctx.stroke();
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.arc(sx - 24, baseY - 70, 8 + h * 2, 0, Math.PI * 2);
    ctx.arc(sx + 24, baseY - 70, 8 + h * 2, 0, Math.PI * 2);
    ctx.fill();
  });

  // NEAR (0.7): shell-emblem banners hanging from above, swaying.
  const oxNear = cam.x * PARALLAX_NEAR;
  tiled(oxNear, 260, 60, (sx, i) => {
    const sway = Math.sin(frame * 0.01 + i * 2.1) * 3;
    const bw = 30;
    const bh = 92;
    ctx.fillStyle = '#4a0a10';
    ctx.beginPath();
    ctx.moveTo(sx - bw / 2, 0);
    ctx.lineTo(sx + bw / 2, 0);
    ctx.lineTo(sx + bw / 2 + sway, bh - 16);
    ctx.lineTo(sx + sway, bh - 30); // swallowtail
    ctx.lineTo(sx - bw / 2 + sway, bh - 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6b1016';
    ctx.fillRect(sx - bw / 2, 0, bw, 8);
    // shell emblem: green dome with spikes
    const ex = sx + sway * 0.6;
    const ey = 44;
    ctx.fillStyle = '#2f7a2f';
    ctx.beginPath();
    ctx.arc(ex, ey, 8, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8e0c8';
    for (let s = -1; s <= 1; s++) {
      ctx.beginPath();
      ctx.moveTo(ex + s * 5 - 2, ey - (s === 0 ? 7 : 5));
      ctx.lineTo(ex + s * 5, ey - (s === 0 ? 12 : 10));
      ctx.lineTo(ex + s * 5 + 2, ey - (s === 0 ? 7 : 5));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#245c24';
    ctx.fillRect(ex - 8, ey, 16, 3);
  });

  // stage gear, no longer even silhouette-shy
  drawEdgeRigging(ctx, oxFar, set);
  drawBoomMic(ctx, frame, set);
  drawCurlCorner(ctx, set);
}

// ---------------------------------------------------------------------------
// Dispatch — exhaustive by construction; unknown ids throw at runtime too.
// ---------------------------------------------------------------------------

const PAINTERS: Record<ThemeId, Painter> = {
  meadow: drawMeadow,
  sewer: drawSewer,
  casino: drawCasino,
  castle: drawCastle,
};

export function drawBackground(ctx: CanvasRenderingContext2D, theme: ThemeId, cam: CameraState, frame: number): void {
  const painter = PAINTERS[theme];
  if (!painter) throw new Error(`drawBackground: unknown theme '${String(theme)}'`);
  painter(ctx, cam, frame);
}
