// ============================================================================
// render/mapArt.ts — the CONTINUOUS OVERWORLD painter for the world map scene.
//
// One 2560x360 kingdom, Super-Mario-World flavored and parodied: four themed
// regions side by side (meadow -> money pipes cutaway -> casino peninsula ->
// scorched palace grounds), landmark transitions on every border (warp pipe,
// glitter gate, drawbridge), beaded walking trails between level dots, and
// Estrada's little map token. Pure presentation: deterministic decor comes
// from a fixed createRng seed at module init (cull-safe: placement is
// precomputed, not drawn from a live stream), all motion comes from `frame`.
//
// Geometry lives HERE so the terrain, the paths and the scene share one truth:
// node world positions = maps.ts per-world 640x360 positions offset by
// (world-1)*640 plus a small per-world y nudge (maps.ts itself is FROZEN).
//
// House rules honored: anchored props only (every standing thing gets a base
// shadow and a named support), sincere zone around the dungeon-door cameo
// (the real Peach is not a gag), stage-set gags kept LIGHT (one clapperboard
// per region), and the HUD wood sign draws its TEXT with ui/theme tokens.
// ============================================================================

import type { LevelId, WorldNo } from '../core/types.ts';
import { VIEW_H, VIEW_W } from '../core/constants.ts';
import { createRng, RNG_STREAM } from '../core/rng.ts';
import { CASTLES, nodeOf, WORLD_MAPS, worldOf } from '../levels/maps.ts';
import { UI, textShadow } from '../ui/theme.ts';

/** The whole kingdom: four 640px regions side by side. */
export const MAP_W = VIEW_W * 4;
const REGION_W = VIEW_W;
/** Sky ends / terrain begins. */
const HORIZON = 96;
/** Sewer region: everything below this line is exposed earth (cutaway). */
const SEWER_CUT = 148;

/** Small per-world vertical nudge for flow (maps.ts positions are FROZEN —
 *  this table is the only place layout deviates from them). */
const Y_NUDGE: Record<WorldNo, number> = { 1: 0, 2: -8, 3: 0, 4: -6 };

type Ctx = CanvasRenderingContext2D;
interface Pt { x: number; y: number }

// ---------------------------------------------------------------------------
// Geometry — node positions and path curves (shared by painter and scene).
// ---------------------------------------------------------------------------

export function nodePos(id: LevelId): Pt {
  const { map, node } = nodeOf(id);
  return { x: node.x + (map.world - 1) * REGION_W, y: node.y + Y_NUDGE[map.world] };
}

/** Every walkable edge on the kingdom: the per-world graph edges plus the
 *  three cross-world connectors (castle -> next world's entry). */
export function listEdges(): readonly { a: LevelId; b: LevelId }[] {
  const out: { a: LevelId; b: LevelId }[] = [];
  for (const map of WORLD_MAPS) {
    for (const n of map.nodes) for (const nx of n.next) out.push({ a: n.levelId, b: nx });
    if (map.world < 4) {
      const next = WORLD_MAPS.find(m => m.world === map.world + 1);
      if (next) out.push({ a: CASTLES[map.world], b: next.entry });
    }
  }
  return out;
}

/** Pure integer -> [0,1) hash (mulberry32 finalizer), stable across frames. */
function hash01(n: number): number {
  let t = (n | 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function idHash(a: LevelId, b: LevelId): number {
  let h = 0;
  const s = `${a}>${b}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Edges whose curve must pass through a landmark (bridge / pipe / gate /
 *  drawbridge): the desired curve MIDPOINT, world coords. */
const EDGE_MID: Record<string, Pt> = {
  'w1a2>w1a3': { x: 214, y: 183 },  // river bridge (high road)
  'w1a2>w1a4': { x: 212, y: 272 },  // river bridge (low road)
  'w1a7>w2a1': { x: 640, y: 203 },  // THE warp pipe into the money pipes
  'w2a8>w3a1': { x: 1280, y: 231 }, // the glitter gate onto the peninsula
  'w3a8>w4a1': { x: 1922, y: 232 }, // the drawbridge over the lava moat
};

/** Quadratic control point for an edge: honors the landmark midpoint table,
 *  otherwise bows deterministically sideways so no trail is a straight ruler. */
function edgeCtrl(a: LevelId, b: LevelId): Pt {
  const p0 = nodePos(a);
  const p1 = nodePos(b);
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const forced = EDGE_MID[`${a}>${b}`];
  if (forced) return { x: 2 * forced.x - mx, y: 2 * forced.y - my };
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const h = hash01(idHash(a, b));
  const k = (h < 0.5 ? -1 : 1) * (10 + Math.abs(h - 0.5) * 2 * 26);
  const cy = Math.min(340, Math.max(HORIZON + 14, my + (dx / len) * k));
  return { x: mx + (-dy / len) * k, y: cy };
}

/** Point along an edge's curve, t in [0,1] (a -> b). The token WALKS this. */
export function edgePoint(a: LevelId, b: LevelId, t: number): Pt {
  const p0 = nodePos(a);
  const p1 = nodePos(b);
  const c = edgeCtrl(a, b);
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

function edgeLength(a: LevelId, b: LevelId): number {
  let len = 0;
  let prev = edgePoint(a, b, 0);
  for (let i = 1; i <= 16; i++) {
    const p = edgePoint(a, b, i / 16);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

// ---------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------

function artText(ctx: Ctx, s: string, x: number, y: number, px: number, color: string, bold = true): void {
  ctx.save();
  ctx.font = `${bold ? 'bold ' : ''}${px}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** Ground contact shadow — the "everything is anchored" stamp. */
function baseShadow(ctx: Ctx, x: number, y: number, rx: number): void {
  ctx.fillStyle = 'rgba(10,14,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, Math.max(2, rx * 0.32), 0, 0, Math.PI * 2);
  ctx.fill();
}

function inView(camX: number, x: number, margin = 70): boolean {
  return x > camX - margin && x < camX + VIEW_W + margin;
}

// ---------------------------------------------------------------------------
// Deterministic decor placement — computed ONCE at module init from a fixed
// seed, so culling never desyncs a live stream. Rejected near nodes, the
// river, the landmarks and the sincere dungeon-door zone.
// ---------------------------------------------------------------------------

const ALL_NODES: Pt[] = WORLD_MAPS.flatMap(m => m.nodes.map(n => nodePos(n.levelId)));

function nearNode(x: number, y: number, r: number): boolean {
  for (const p of ALL_NODES) {
    if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < r * r) return true;
  }
  return false;
}

interface Sprinkle { x: number; y: number; k: number; v: number }

function scatter(
  rng: () => number,
  n: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  reject: (x: number, y: number) => boolean,
): Sprinkle[] {
  const out: Sprinkle[] = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 30) {
    const x = x0 + rng() * (x1 - x0);
    const y = y0 + rng() * (y1 - y0);
    if (nearNode(x, y, 24) || reject(x, y)) continue;
    out.push({ x, y, k: Math.floor(rng() * 3), v: rng() });
  }
  return out;
}

/** Casino peninsula outline (world coords, clockwise). Everything the region
 *  owns stands ON this landmass; the rest is dark water. */
const PENINSULA: readonly Pt[] = [
  { x: 1280, y: 168 }, { x: 1352, y: 142 }, { x: 1448, y: 120 }, { x: 1502, y: 106 },
  { x: 1548, y: 102 }, { x: 1592, y: 120 }, { x: 1648, y: 128 }, { x: 1706, y: 120 },
  { x: 1762, y: 138 }, { x: 1822, y: 168 }, { x: 1862, y: 196 }, { x: 1874, y: 232 },
  { x: 1856, y: 272 }, { x: 1800, y: 296 }, { x: 1742, y: 314 }, { x: 1676, y: 336 },
  { x: 1600, y: 342 }, { x: 1528, y: 326 }, { x: 1478, y: 306 }, { x: 1430, y: 318 },
  { x: 1372, y: 308 }, { x: 1318, y: 296 }, { x: 1280, y: 288 },
];

function inPeninsula(x: number, y: number, margin = 0): boolean {
  // ray cast; margin > 0 demands the point be inside AND away from the edge
  let inside = false;
  for (let i = 0, j = PENINSULA.length - 1; i < PENINSULA.length; j = i++) {
    const a = PENINSULA[i]!;
    const b = PENINSULA[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  if (!inside || margin <= 0) return inside;
  for (let i = 0, j = PENINSULA.length - 1; i < PENINSULA.length; j = i++) {
    const a = PENINSULA[i]!;
    const b = PENINSULA[j]!;
    const t = Math.max(0, Math.min(1,
      ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) /
      (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1)));
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    if ((px - x) * (px - x) + (py - y) * (py - y) < margin * margin) return false;
  }
  return true;
}

const DECOR = (() => {
  const rng = createRng(0x0f0e0d0c ^ RNG_STREAM.decor);
  // meadow micro-flora: keep off the river band and the pipe landmark
  const meadow = scatter(rng, 30, 14, 584, HORIZON + 16, 344,
    (x) => (x > 186 && x < 246) || x > 560);
  // sewer rubble below the cut, clear of the sincere dungeon-door zone
  const sewer = scatter(rng, 22, 660, 1268, SEWER_CUT + 12, 348,
    (x, y) => x > 955 && x < 1165 && y > 235);
  // scorched-land rocks and embers, clear of moat and palace facade
  const castle = scatter(rng, 20, 1956, 2436, HORIZON + 18, 344, () => false);
  // water sparkles: only OUTSIDE the peninsula
  const spark: Sprinkle[] = [];
  let guard = 0;
  while (spark.length < 60 && guard++ < 2000) {
    const x = 1286 + rng() * 628;
    const y = HORIZON + 8 + rng() * (VIEW_H - HORIZON - 20);
    if (inPeninsula(x, y, 8)) continue;
    spark.push({ x, y, k: 0, v: rng() });
  }
  return { meadow, sewer, castle, spark };
})();

// ---------------------------------------------------------------------------
// Region painters (all world coords; ctx is already translated by -camX).
// ---------------------------------------------------------------------------

function drawSky(ctx: Ctx, camX: number, frame: number): void {
  const g = ctx.createLinearGradient(0, 0, MAP_W, 0);
  g.addColorStop(0, '#5fb0e8');
  g.addColorStop(0.205, '#5fb0e8');   // meadow noon
  g.addColorStop(0.29, '#2c3d43');    // dusk over the money pipes
  g.addColorStop(0.46, '#1a2430');
  g.addColorStop(0.55, '#140f30');    // casino night
  g.addColorStop(0.72, '#1c1030');
  g.addColorStop(0.83, '#45090b');    // blood sky
  g.addColorStop(1, '#38070a');
  ctx.fillStyle = g;
  ctx.fillRect(camX - 4, 0, VIEW_W + 8, HORIZON + 2);

  // meadow sun, low and golden
  if (inView(camX, 500, 120)) {
    ctx.fillStyle = 'rgba(255,241,196,0.95)';
    ctx.beginPath();
    ctx.arc(500, 46, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,241,196,0.22)';
    ctx.beginPath();
    ctx.arc(500, 46, 27, 0, Math.PI * 2);
    ctx.fill();
  }
  // stars over the night half, twinkling
  for (let i = 0; i < 46; i++) {
    const sx = 1310 + hash01(i * 37 + 5) * 1230;
    if (!inView(camX, sx, 10)) continue;
    const sy = 6 + hash01(i * 91 + 11) * 74;
    const tw = 0.25 + 0.5 * Math.abs(Math.sin(frame * 0.035 + i * 1.7));
    ctx.fillStyle = `rgba(255,250,230,${tw.toFixed(2)})`;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }
}

function drawGroundBase(ctx: Ctx, camX: number): void {
  const g = ctx.createLinearGradient(0, 0, MAP_W, 0);
  g.addColorStop(0, '#7cc84f');
  g.addColorStop(0.242, '#7cc84f');  // meadow green up to the cutaway
  g.addColorStop(0.256, '#46331f');  // earth
  g.addColorStop(0.494, '#46331f');
  g.addColorStop(0.503, '#0c1130');  // dark water
  g.addColorStop(0.744, '#0c1130');
  g.addColorStop(0.756, '#3c2c27');  // scorched land
  g.addColorStop(1, '#31231e');
  ctx.fillStyle = g;
  ctx.fillRect(camX - 4, HORIZON, VIEW_W + 8, VIEW_H - HORIZON);
}

// ----- W1: MUSHROOM HEIGHTS — checkered meadow, river, cottages, woods -----

function drawMeadow(ctx: Ctx, camX: number, frame: number): void {
  if (!inView(camX, 320, 420)) return;

  // horizon hill bumps (SMW two-tone, outlined)
  for (let i = 0; i < 9; i++) {
    const hx = 24 + i * 76 + hash01(i * 53 + 3) * 26;
    const r = 22 + hash01(i * 17 + 9) * 16;
    ctx.fillStyle = '#58a83c';
    ctx.beginPath();
    ctx.arc(hx, HORIZON + 6, r, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#2f6b22';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, HORIZON + 6, r, Math.PI, 0);
    ctx.stroke();
    // lighter cap on the sunny side, clipped inside the hill silhouette
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, HORIZON + 6, r - 1.5, Math.PI, 0);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#79c060';
    ctx.beginPath();
    ctx.arc(hx - r * 0.34, HORIZON + 8, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(47,107,34,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, HORIZON + 6);
  ctx.lineTo(640, HORIZON + 6);
  ctx.stroke();

  // the big SMW checker
  ctx.fillStyle = 'rgba(30,90,20,0.10)';
  for (let cx = 0; cx < 640; cx += 24) {
    for (let cy = HORIZON + 8; cy < VIEW_H; cy += 24) {
      if (((cx / 24) + Math.floor((cy - HORIZON - 8) / 24)) % 2 === 0) continue;
      ctx.fillRect(cx, cy, 24, 24);
    }
  }

  // micro-flora (anchored: tufts and flowers sit flat on the ground plane)
  for (const s of DECOR.meadow) {
    if (!inView(camX, s.x, 12)) continue;
    if (s.k === 0) {
      ctx.fillStyle = '#5fae3e';
      ctx.fillRect(s.x - 2, s.y - 1, 1.5, 3);
      ctx.fillRect(s.x, s.y - 2, 1.5, 4);
      ctx.fillRect(s.x + 2, s.y - 1, 1.5, 3);
    } else if (s.k === 1) {
      ctx.fillStyle = s.v > 0.5 ? '#f2d94e' : '#f2f2f2';
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
      ctx.fillStyle = '#d8642a';
      ctx.fillRect(s.x - 0.5, s.y - 0.5, 1, 1);
    } else {
      ctx.fillStyle = '#9db874';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 2.5, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // the river: a winding band with animated shimmer, bridges where paths cross
  ctx.fillStyle = '#3d7dc8';
  ctx.beginPath();
  for (let y = HORIZON + 2; y <= VIEW_H; y += 6) {
    const cx = 215 + Math.sin(y * 0.02) * 10;
    if (y === HORIZON + 2) ctx.moveTo(cx - 11, y);
    else ctx.lineTo(cx - 11, y);
  }
  for (let y = VIEW_H; y >= HORIZON + 2; y -= 6) {
    const cx = 215 + Math.sin(y * 0.02) * 10;
    ctx.lineTo(cx + 11, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2c5f9e';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  for (let y = HORIZON + 10; y < VIEW_H; y += 14) {
    const cx = 215 + Math.sin(y * 0.02) * 10;
    const sh = Math.sin(frame * 0.05 + y * 0.3);
    if (sh > 0.2) {
      ctx.strokeStyle = 'rgba(210,235,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 5 + sh * 3, y);
      ctx.lineTo(cx + 2 + sh * 3, y);
      ctx.stroke();
    }
  }
  for (const b of [{ x: 214, y: 183 }, { x: 212, y: 272 }]) {
    ctx.fillStyle = 'rgba(20,30,45,0.3)';
    ctx.fillRect(b.x - 15, b.y + 6, 30, 3); // bridge shadow ON the water
    ctx.fillStyle = '#8a5a2e';
    ctx.fillRect(b.x - 16, b.y - 6, 32, 12);
    ctx.strokeStyle = '#5e3c1c';
    ctx.lineWidth = 1;
    for (let px = -16; px <= 16; px += 4) {
      ctx.beginPath();
      ctx.moveTo(b.x + px, b.y - 6);
      ctx.lineTo(b.x + px, b.y + 6);
      ctx.stroke();
    }
    ctx.fillStyle = '#6e4622';
    ctx.fillRect(b.x - 16, b.y - 8, 32, 2);
    ctx.fillRect(b.x - 16, b.y + 6, 32, 2);
  }

  // little woods (cardboard-free: world 1 trees are real trees, the gag
  // budget is spent on the clapperboard)
  const woods: readonly [number, number][] = [[60, 168], [322, 134], [524, 298]];
  for (const [wx, wy] of woods) {
    if (!inView(camX, wx, 40)) continue;
    for (let t = 0; t < 3; t++) {
      const tx = wx + (t - 1) * 16 + hash01(wx + t * 7) * 6;
      const ty = wy + (t === 1 ? 6 : 0);
      baseShadow(ctx, tx, ty + 1, 7);
      ctx.fillStyle = '#7a4a26';
      ctx.fillRect(tx - 1.5, ty - 7, 3, 8);
      ctx.fillStyle = '#2e8a3a';
      ctx.beginPath();
      ctx.arc(tx, ty - 11, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1d5c26';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.arc(tx - 2.5, ty - 13.5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // mushroom cottages (a tiny village; one is foreclosed, of course)
  const cottages: readonly [number, number, boolean][] = [[52, 302, false], [108, 318, false], [152, 300, true]];
  for (const [hx, hy, sold] of cottages) {
    if (!inView(camX, hx, 30)) continue;
    baseShadow(ctx, hx, hy + 1, 12);
    ctx.fillStyle = '#f2e6c8';
    ctx.fillRect(hx - 7, hy - 12, 14, 12);
    ctx.fillStyle = '#5e3c1c';
    ctx.fillRect(hx - 2, hy - 7, 4, 7); // door
    ctx.fillStyle = '#d8382a';
    ctx.beginPath();
    ctx.arc(hx, hy - 12, 11, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#8a1e14';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hx, hy - 12, 11, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#f7ecc9';
    ctx.beginPath();
    ctx.arc(hx - 4, hy - 16, 2, 0, Math.PI * 2);
    ctx.arc(hx + 4, hy - 15, 1.6, 0, Math.PI * 2);
    ctx.fill();
    if (sold) {
      // FOR SALE post planted in the yard
      ctx.fillStyle = '#6e4622';
      ctx.fillRect(hx + 11, hy - 9, 1.5, 10);
      ctx.fillStyle = '#fdf6e3';
      ctx.fillRect(hx + 5, hy - 15, 14, 7);
      artText(ctx, 'SOLD', hx + 12, hy - 11.5, 5, '#a03030');
    }
  }
}

// ----- W2: THE MONEY PIPES — the path dives underground (earth cutaway) ----

function drawSewer(ctx: Ctx, camX: number, frame: number): void {
  if (!inView(camX, 960, 420)) return;

  // surface lid: dusk grass strip over the cutaway
  ctx.fillStyle = '#233022';
  ctx.fillRect(640, HORIZON, 640, SEWER_CUT - HORIZON);
  ctx.fillStyle = '#1b2519';
  for (let i = 0; i < 22; i++) {
    const bx = 648 + i * 29 + hash01(i * 13 + 2) * 12;
    const bh = 3 + hash01(i * 41 + 8) * 5;
    ctx.fillRect(bx, SEWER_CUT - bh - 2, 2, bh); // dead grass blades
  }
  // dead trees on the surface, silhouetted
  for (const tx of [726, 902, 1104, 1236]) {
    if (!inView(camX, tx, 20)) continue;
    ctx.strokeStyle = '#151d14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, SEWER_CUT - 2);
    ctx.lineTo(tx, SEWER_CUT - 22);
    ctx.moveTo(tx, SEWER_CUT - 14);
    ctx.lineTo(tx - 7, SEWER_CUT - 22);
    ctx.moveTo(tx, SEWER_CUT - 17);
    ctx.lineTo(tx + 6, SEWER_CUT - 26);
    ctx.stroke();
  }
  // the kingdom above, silhouetted: foreclosed mushroom cottages, lights off
  for (const [hx, hw] of [[770, 16], [860, 12], [1010, 15], [1160, 13], [1268, 14]] as const) {
    if (!inView(camX, hx, 20)) continue;
    ctx.fillStyle = '#131b12';
    ctx.fillRect(hx - hw * 0.35, SEWER_CUT - 12, hw * 0.7, 10);
    ctx.beginPath();
    ctx.arc(hx, SEWER_CUT - 12, hw * 0.62, Math.PI, 0);
    ctx.fill();
    if (hx === 1010) { // one tilted SOLD sign up there too
      ctx.fillStyle = '#2c2a20';
      ctx.fillRect(hx + hw * 0.5 + 2, SEWER_CUT - 10, 7, 5);
      ctx.fillRect(hx + hw * 0.5 + 4.5, SEWER_CUT - 5, 1.5, 4);
    }
  }

  // THE CUT: the ragged turf line where the kingdom was sliced open
  ctx.strokeStyle = '#120c08';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(640, SEWER_CUT);
  for (let x = 640; x <= 1280; x += 16) {
    ctx.lineTo(x, SEWER_CUT + (hash01(x * 7 + 1) - 0.5) * 4);
  }
  ctx.stroke();
  ctx.fillStyle = '#2c421f';
  for (let x = 646; x < 1280; x += 22) {
    ctx.fillRect(x, SEWER_CUT - 1, 10, 4 + hash01(x) * 3); // turf overhang
  }

  // earth texture: strata + speckle
  ctx.strokeStyle = 'rgba(20,12,6,0.35)';
  ctx.lineWidth = 1.5;
  for (let sy = SEWER_CUT + 34; sy < VIEW_H; sy += 44) {
    ctx.beginPath();
    ctx.moveTo(640, sy);
    for (let x = 640; x <= 1280; x += 32) {
      ctx.lineTo(x, sy + Math.sin(x * 0.03 + sy) * 3);
    }
    ctx.stroke();
  }
  for (const s of DECOR.sewer) {
    if (!inView(camX, s.x, 10)) continue;
    if (s.k === 0) {
      ctx.fillStyle = '#5c4630';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 3, 2, s.v, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.k === 1) {
      ctx.fillStyle = '#2c2016';
      ctx.fillRect(s.x - 2, s.y - 1, 4, 2.5);
    } else {
      // stray certified coin, half-buried (laundering leaks)
      ctx.fillStyle = '#c9a12e';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a6a10';
      ctx.fillRect(s.x - 2, s.y, 4, 2);
    }
  }

  // pipe clusters bolted to the cut (each hangs FROM the cut line)
  for (const [px, plen] of [[745, 52], [935, 42], [1225, 190]] as const) {
    if (!inView(camX, px, 30)) continue;
    ctx.fillStyle = '#26522e';
    ctx.fillRect(px - 8, SEWER_CUT, 16, plen);
    ctx.fillStyle = '#3a6b42';
    ctx.fillRect(px - 8, SEWER_CUT, 5, plen);
    ctx.fillStyle = '#1c3a22';
    ctx.fillRect(px - 10, SEWER_CUT + 8, 20, 5);
    ctx.fillRect(px - 10, SEWER_CUT + plen - 6, 20, 5);
    if (px === 935) {
      // elbow joint spitting the occasional certified coin
      ctx.fillStyle = '#26522e';
      ctx.fillRect(px - 8, SEWER_CUT + plen - 6, 34, 14);
      ctx.fillStyle = '#1c3a22';
      ctx.fillRect(px + 22, SEWER_CUT + plen - 8, 5, 18);
      const cph = (frame % 90) / 90;
      if (cph < 0.5) {
        ctx.fillStyle = '#ffd34e';
        ctx.beginPath();
        ctx.arc(px + 25, SEWER_CUT + plen + 8 + cph * 40, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // drip stains + animated drips from the cut
  for (const [i, dx] of [700, 830, 908, 1190, 1258].entries()) {
    if (!inView(camX, dx, 10)) continue;
    ctx.fillStyle = 'rgba(16,26,18,0.5)';
    ctx.fillRect(dx - 1.5, SEWER_CUT + 2, 3, 26 + hash01(i * 7 + 3) * 22);
    const ph = (frame * 1.7 + i * 173) % 150;
    if (ph < 120) {
      ctx.fillStyle = 'rgba(140,220,180,0.75)';
      ctx.fillRect(dx - 1, SEWER_CUT + 4 + ph, 2, 3);
    }
  }

  // glow pools where the drips land (anchored: they pool ON the floor line)
  for (const [gx, gy] of [[830, 332], [1210, 338]] as const) {
    if (!inView(camX, gx, 20)) continue;
    const pulse = 0.5 + 0.2 * Math.sin(frame * 0.04 + gx);
    ctx.fillStyle = `rgba(90,200,140,${(0.16 * pulse + 0.1).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(gx, gy, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3f8a5e';
    ctx.beginPath();
    ctx.ellipse(gx, gy, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // THE DUNGEON DOOR (SINCERE — the real Peach is behind it; no gags near)
  if (inView(camX, 1055, 50)) {
    const dx = 1055;
    ctx.fillStyle = '#241a12';
    ctx.fillRect(dx - 20, 258, 40, 62); // stone surround
    ctx.strokeStyle = '#0f0a06';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx - 20, 258, 40, 62);
    ctx.fillStyle = '#07090b';
    ctx.beginPath();
    ctx.moveTo(dx - 13, 320);
    ctx.lineTo(dx - 13, 276);
    ctx.arc(dx, 276, 13, Math.PI, 0);
    ctx.lineTo(dx + 13, 320);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2a3438';
    ctx.lineWidth = 1.5;
    for (let b = -9; b <= 9; b += 4.5) {
      ctx.beginPath();
      ctx.moveTo(dx + b, 272);
      ctx.lineTo(dx + b, 318);
      ctx.stroke();
    }
    // the tiny pink crown, waiting
    ctx.fillStyle = '#ff9ecf';
    ctx.fillRect(dx - 3, 300, 6, 3);
    ctx.fillRect(dx - 3, 297, 1.5, 3);
    ctx.fillRect(dx - 0.7, 297, 1.4, 3);
    ctx.fillRect(dx + 1.6, 297, 1.5, 3);
  }
}

// ----- W3: CASINO PENINSULA — neon land jutting into dark water -----------

function drawCasino(ctx: Ctx, camX: number, frame: number): void {
  if (!inView(camX, 1600, 420)) return;

  // water sparkles + drifting sheen
  for (const s of DECOR.spark) {
    if (!inView(camX, s.x, 8)) continue;
    const tw = Math.abs(Math.sin(frame * 0.03 + s.v * 6.28));
    if (tw < 0.4) continue;
    ctx.fillStyle = `rgba(140,170,255,${(tw * 0.4).toFixed(2)})`;
    ctx.fillRect(s.x, s.y, 2, 1);
  }
  ctx.strokeStyle = 'rgba(120,140,220,0.08)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const wy = 140 + i * 56 + Math.sin(frame * 0.01 + i * 2) * 4;
    ctx.beginPath();
    ctx.moveTo(1284, wy);
    ctx.lineTo(1916, wy);
    ctx.stroke();
  }

  // the peninsula: dark pavement, neon rim, sand fringe
  ctx.beginPath();
  ctx.moveTo(PENINSULA[0]!.x, PENINSULA[0]!.y);
  for (let i = 1; i < PENINSULA.length; i++) ctx.lineTo(PENINSULA[i]!.x, PENINSULA[i]!.y);
  ctx.closePath();
  ctx.save();
  ctx.strokeStyle = '#b89a5e';
  ctx.lineWidth = 6;
  ctx.stroke(); // sand fringe under everything
  ctx.fillStyle = '#28204a';
  ctx.fill();
  ctx.clip();
  // pavement glow grid
  ctx.strokeStyle = 'rgba(140,90,255,0.13)';
  ctx.lineWidth = 1;
  for (let gx = 1280; gx <= 1920; gx += 36) {
    ctx.beginPath();
    ctx.moveTo(gx, 90);
    ctx.lineTo(gx, VIEW_H);
    ctx.stroke();
  }
  for (let gy = 96; gy <= VIEW_H; gy += 36) {
    ctx.beginPath();
    ctx.moveTo(1280, gy);
    ctx.lineTo(1920, gy);
    ctx.stroke();
  }
  ctx.restore();
  // neon trim chasing around the coast
  ctx.beginPath();
  ctx.moveTo(PENINSULA[0]!.x, PENINSULA[0]!.y);
  for (let i = 1; i < PENINSULA.length; i++) ctx.lineTo(PENINSULA[i]!.x, PENINSULA[i]!.y);
  ctx.closePath();
  const neonOn = (frame % 160) > 8; // the sign guy is behind on the bill
  ctx.strokeStyle = neonOn ? 'rgba(255,79,216,0.75)' : 'rgba(120,40,100,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // props ON the pavement, each with its contact shadow
  if (inView(camX, 1570, 40)) { // giant dice pair, tumbled off some game
    baseShadow(ctx, 1572, 266, 20);
    for (const [ox, rot] of [[-10, -0.14], [10, 0.18]] as const) {
      ctx.save();
      ctx.translate(1571 + ox, 254);
      ctx.rotate(rot);
      ctx.fillStyle = '#f2f2f6';
      ctx.fillRect(-9, -9, 18, 18);
      ctx.fillStyle = '#c8c8d4';
      ctx.fillRect(-9, 5, 18, 4); // bottom shade: it SITS on the ground
      ctx.strokeStyle = '#55556a';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-9, -9, 18, 18);
      ctx.fillStyle = '#c02040';
      if (ox < 0) {
        ctx.beginPath();
        ctx.arc(-4, -4, 2.2, 0, Math.PI * 2);
        ctx.arc(4, 4, 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(-4.5, -4.5, 2.2, 0, Math.PI * 2);
        ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
        ctx.arc(4.5, 4.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  if (inView(camX, 1408, 24)) { // a lost playing card, face up
    baseShadow(ctx, 1408, 150, 8);
    ctx.save();
    ctx.translate(1408, 144);
    ctx.rotate(-0.2);
    ctx.fillStyle = '#f7f2e6';
    ctx.fillRect(-5, -7, 10, 14);
    ctx.strokeStyle = '#9a94a5';
    ctx.lineWidth = 1;
    ctx.strokeRect(-5, -7, 10, 14);
    artText(ctx, 'A', -1.5, -2.5, 6, '#c02040');
    artText(ctx, '♥', 1.5, 3, 6, '#c02040');
    ctx.restore();
  }
  if (inView(camX, 1695, 24)) { // chip stack
    baseShadow(ctx, 1695, 246, 9);
    const chipCols = ['#d8382a', '#f2f2f6', '#2a4fd8', '#d8382a', '#54b04a'];
    for (let c = 0; c < 5; c++) {
      ctx.fillStyle = chipCols[c]!;
      ctx.beginPath();
      ctx.ellipse(1695, 244 - c * 3.4, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,20,30,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  if (inView(camX, 1338, 24)) { // SLOTS pole sign, planted
    baseShadow(ctx, 1338, 168, 6);
    ctx.fillStyle = '#3a3446';
    ctx.fillRect(1337, 140, 2.5, 28);
    ctx.fillStyle = '#1d1830';
    ctx.fillRect(1326, 126, 25, 15);
    const lit = ((frame + 60) % 90) > 12;
    ctx.strokeStyle = lit ? '#54ff9f' : '#1e5537';
    ctx.lineWidth = 1;
    ctx.strokeRect(1326, 126, 25, 15);
    artText(ctx, 'SLOTS', 1338.5, 133.5, 6, lit ? '#54ff9f' : '#2e7a4f');
  }
}

// ----- W4: SCORCHED PALACE GROUNDS — lava, cracks, the Grand Palace -------

function drawCastle(ctx: Ctx, camX: number, frame: number): void {
  if (!inView(camX, 2240, 420)) return;

  // ember-lit horizon strip
  const pulse = 0.25 + 0.1 * Math.sin(frame * 0.02);
  ctx.fillStyle = `rgba(255,110,20,${pulse.toFixed(2)})`;
  ctx.fillRect(1940, HORIZON, 620, 4);

  // ash speckle + rocks
  for (const s of DECOR.castle) {
    if (!inView(camX, s.x, 10)) continue;
    if (s.k === 0) {
      ctx.fillStyle = '#241a16';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 3.5, 2.2, s.v, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4a3a32';
      ctx.beginPath();
      ctx.ellipse(s.x - 1, s.y - 1, 2, 1.2, s.v, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.k === 1) {
      const glow = 0.3 + 0.3 * Math.abs(Math.sin(frame * 0.03 + s.v * 6));
      ctx.fillStyle = `rgba(255,120,30,${glow.toFixed(2)})`;
      ctx.fillRect(s.x, s.y, 2, 2); // breathing ember
    } else {
      ctx.fillStyle = '#1c1410';
      ctx.fillRect(s.x - 2.5, s.y - 1, 5, 2.5); // charred plank
    }
  }

  // glowing cracks
  const cracks: readonly [number, number, number][] = [
    [1985, 300, 46], [2120, 250, 60], [2255, 320, 52], [2360, 160, 44],
  ];
  for (const [cx0, cy0, clen] of cracks) {
    if (!inView(camX, cx0, clen + 10)) continue;
    const glow = 0.35 + 0.25 * Math.sin(frame * 0.025 + cx0);
    for (const [style, lw] of [
      [`rgba(255,120,30,${(glow * 0.5).toFixed(2)})`, 4],
      [`rgba(255,190,60,${glow.toFixed(2)})`, 1.5],
    ] as const) {
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(cx0, cy0);
      let px = cx0;
      let py = cy0;
      for (let sIdx = 1; sIdx <= 4; sIdx++) {
        px += clen / 4;
        py += (hash01(cx0 * 13 + sIdx) - 0.5) * 16;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  // lava pools (crusted edges, drifting bright blobs)
  for (const [lx, ly, lr] of [[2045, 322, 22], [2135, 108, 15], [2388, 330, 18]] as const) {
    if (!inView(camX, lx, lr + 14)) continue;
    ctx.fillStyle = 'rgba(255,120,30,0.16)';
    ctx.beginPath();
    ctx.ellipse(lx, ly, lr + 7, (lr + 7) * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1410';
    ctx.beginPath();
    ctx.ellipse(lx, ly, lr + 2.5, (lr + 2.5) * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8541c';
    ctx.beginPath();
    ctx.ellipse(lx, ly, lr, lr * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let bIdx = 0; bIdx < 3; bIdx++) {
      const ba = frame * 0.02 + bIdx * 2.1 + lx;
      ctx.fillStyle = '#ffb02e';
      ctx.beginPath();
      ctx.ellipse(
        lx + Math.cos(ba) * lr * 0.5,
        ly + Math.sin(ba * 1.3) * lr * 0.16,
        3, 1.6, 0, 0, Math.PI * 2,
      );
      ctx.fill();
    }
  }

  // THE GRAND PALACE, looming at the far end of the kingdom
  if (inView(camX, 2500, 140)) {
    const wallTop = 152;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(2440, 328, 122, 6); // it stands on its own shadow
    ctx.fillStyle = '#241019';
    ctx.fillRect(2446, wallTop, 112, 178);
    ctx.fillStyle = '#170a10';
    for (const [tx, tw, ty] of [[2450, 22, 112], [2534, 22, 112], [2483, 36, 88]] as const) {
      ctx.fillRect(tx, ty, tw, 330 - ty);
      for (let c = 0; c < 4; c++) ctx.fillRect(tx + (c * tw) / 4, ty - 6, tw / 6, 6);
    }
    for (let c = 0; c < 7; c++) ctx.fillRect(2446 + c * 17, wallTop - 6, 9, 6);
    // lit windows, flickering
    for (let wIdx = 0; wIdx < 8; wIdx++) {
      const wx = 2455 + (wIdx % 3) * 36 + hash01(wIdx * 31) * 10;
      const wy = 130 + Math.floor(wIdx / 3) * 52 + hash01(wIdx * 57) * 18;
      const lit = ((frame + wIdx * 47) % 190) > 30;
      ctx.fillStyle = lit ? '#ff9d3c' : '#40201a';
      ctx.fillRect(wx, wy, 4, 7);
    }
    // gate: dark arch breathing lava light
    const g = 0.3 + 0.2 * Math.sin(frame * 0.03);
    ctx.fillStyle = '#0c0509';
    ctx.beginPath();
    ctx.moveTo(2489, 330);
    ctx.lineTo(2489, 296);
    ctx.arc(2501, 296, 12, Math.PI, 0);
    ctx.lineTo(2513, 330);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(255,120,30,${g.toFixed(2)})`;
    ctx.fillRect(2493, 318, 16, 12);
    // banners with the shell emblem, swaying
    for (const bx of [2462, 2540]) {
      const sway = Math.sin(frame * 0.012 + bx) * 2;
      ctx.fillStyle = '#4a0a10';
      ctx.beginPath();
      ctx.moveTo(bx - 6, 156);
      ctx.lineTo(bx + 6, 156);
      ctx.lineTo(bx + 6 + sway, 208);
      ctx.lineTo(bx + sway, 198);
      ctx.lineTo(bx - 6 + sway, 208);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2f7a2f';
      ctx.beginPath();
      ctx.arc(bx + sway * 0.5, 176, 4, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    }
    // gold statue of Impeach flanking the gate (hands ENORMOUS, per canon),
    // ON a dark pedestal
    baseShadow(ctx, 2470, 330, 9);
    ctx.fillStyle = '#1a0d12';
    ctx.fillRect(2461, 322, 18, 7);
    ctx.fillRect(2464, 318, 12, 4);
    ctx.fillStyle = '#d9a530';
    ctx.beginPath();
    ctx.moveTo(2470, 296);
    ctx.lineTo(2463, 318);
    ctx.lineTo(2477, 318);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(2470, 293, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a87c20';
    ctx.fillRect(2465.5, 288.5, 9, 2.5); // the swoop
    ctx.strokeStyle = '#d9a530';
    ctx.lineWidth = 2;
    ctx.beginPath(); // thin arms out to the featured attraction
    ctx.moveTo(2467, 302);
    ctx.lineTo(2459, 307);
    ctx.moveTo(2473, 302);
    ctx.lineTo(2481, 307);
    ctx.stroke();
    ctx.fillStyle = '#d9a530';
    ctx.beginPath();
    ctx.arc(2458, 309, 4.5, 0, Math.PI * 2);
    ctx.arc(2482, 309, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ----- Region-border landmarks --------------------------------------------

function drawLandmarks(ctx: Ctx, camX: number, frame: number): void {
  // W1 -> W2: THE warp pipe, lying at the border, mouth to the meadow.
  if (inView(camX, 645, 80)) {
    baseShadow(ctx, 648, 228, 40);
    ctx.fillStyle = '#2f9e44';
    ctx.fillRect(614, 189, 76, 34);
    ctx.fillStyle = '#217a33';
    ctx.fillRect(614, 209, 76, 14);
    ctx.fillStyle = '#57c268';
    ctx.fillRect(614, 189, 76, 7);
    ctx.fillStyle = '#2f9e44';
    ctx.fillRect(596, 184, 20, 44); // mouth ring
    ctx.fillStyle = '#57c268';
    ctx.fillRect(596, 184, 20, 8);
    ctx.fillStyle = '#217a33';
    ctx.fillRect(596, 216, 20, 12);
    ctx.fillStyle = '#0c1c10';
    ctx.fillRect(598, 190, 7, 32); // the dark mouth the road dives into
    ctx.strokeStyle = '#14401e';
    ctx.lineWidth = 2;
    ctx.strokeRect(596, 184, 20, 44);
    ctx.strokeRect(614, 189, 76, 34);
    // hand-painted plank sign planted beside it
    ctx.fillStyle = '#6e4622';
    ctx.fillRect(630, 240, 2.5, 14);
    ctx.fillStyle = '#a8743c';
    ctx.fillRect(614, 230, 36, 12);
    ctx.strokeStyle = '#5e3c1c';
    ctx.lineWidth = 1;
    ctx.strokeRect(614, 230, 36, 12);
    artText(ctx, 'PIPES ▶', 632, 236.5, 6, '#2c1a0c');
  }

  // W2 -> W3: the glitter gate (bulbs chasing around the arch).
  if (inView(camX, 1280, 60)) {
    for (const px of [1266, 1294]) {
      baseShadow(ctx, px + 4, 278, 8);
      ctx.fillStyle = '#3a3446';
      ctx.fillRect(px, 196, 8, 80);
      ctx.fillStyle = '#55506a';
      ctx.fillRect(px, 196, 3, 80);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(px + 4, 192, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // gilded arch — lit, so it reads against the night sky
    ctx.strokeStyle = '#2c2436';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(1284, 200, 22, Math.PI, 0);
    ctx.stroke();
    ctx.strokeStyle = '#d9a530';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(1284, 200, 22, Math.PI, 0);
    ctx.stroke();
    for (let bIdx = 0; bIdx < 7; bIdx++) {
      const a = Math.PI + (bIdx / 6) * Math.PI;
      const on = (bIdx + Math.floor(frame / 8)) % 3 === 0;
      const bx = 1284 + Math.cos(a) * 22;
      const by = 200 + Math.sin(a) * 22;
      if (on) {
        ctx.fillStyle = 'rgba(255,243,176,0.35)';
        ctx.beginPath();
        ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = on ? '#fff3b0' : '#8a6a20';
      ctx.beginPath();
      ctx.arc(bx, by, on ? 2.8 : 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#1d1830';
    ctx.fillRect(1256, 158, 56, 16);
    const lit = (frame % 200) > 16;
    ctx.strokeStyle = lit ? '#ff4fd8' : '#552044';
    ctx.lineWidth = 1;
    ctx.strokeRect(1256, 158, 56, 16);
    artText(ctx, 'CASINO', 1284, 166, 8, lit ? '#ff4fd8' : '#7a3a64');
    ctx.strokeStyle = '#3a3446';
    ctx.lineWidth = 2;
    ctx.beginPath(); // sign hangs from the arch top
    ctx.moveTo(1272, 174);
    ctx.lineTo(1276, 182);
    ctx.moveTo(1296, 174);
    ctx.lineTo(1292, 182);
    ctx.stroke();
  }

  // W3 -> W4: lava moat + drawbridge with chains.
  if (inView(camX, 1922, 60)) {
    ctx.fillStyle = '#1c1410';
    ctx.fillRect(1902, HORIZON, 42, VIEW_H - HORIZON);
    ctx.fillStyle = '#e8541c';
    ctx.fillRect(1908, HORIZON, 30, VIEW_H - HORIZON);
    for (let bIdx = 0; bIdx < 8; bIdx++) {
      const by = HORIZON + 20 + bIdx * 32 + Math.sin(frame * 0.02 + bIdx * 1.7) * 5;
      ctx.fillStyle = '#ffb02e';
      ctx.beginPath();
      ctx.ellipse(1923 + Math.sin(bIdx * 3.1) * 8, by, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,120,30,0.14)';
    ctx.fillRect(1896, HORIZON, 54, VIEW_H - HORIZON); // heat glow
    // the drawbridge the path crosses (bright planks so it pops off the lava)
    ctx.fillStyle = 'rgba(30,12,4,0.45)';
    ctx.fillRect(1900, 244, 46, 4); // its shadow ON the lava crust
    ctx.fillStyle = '#a8743c';
    ctx.fillRect(1900, 223, 46, 19);
    ctx.strokeStyle = '#6e4622';
    ctx.lineWidth = 1;
    for (let px = 1904; px <= 1944; px += 5) {
      ctx.beginPath();
      ctx.moveTo(px, 223);
      ctx.lineTo(px, 242);
      ctx.stroke();
    }
    ctx.fillStyle = '#3c2410';
    ctx.fillRect(1900, 221, 46, 3);
    ctx.fillRect(1900, 240, 46, 3);
    // chain posts on both banks + sagging chains
    for (const [px, dir] of [[1899, -1], [1947, 1]] as const) {
      baseShadow(ctx, px, 246, 4);
      ctx.fillStyle = '#2c2024';
      ctx.fillRect(px - 2, 214, 4, 30);
      ctx.strokeStyle = '#4a4048';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 216);
      ctx.quadraticCurveTo(px + dir * -14, 226, 1923, 226);
      ctx.stroke();
    }
  }
}

// ----- The stage-set gag, kept LIGHT: one clapperboard billboard per set ---

function drawClapper(ctx: Ctx, camX: number, x: number, y: number, world: WorldNo, producer: string, burnt: boolean): void {
  if (!inView(camX, x, 50)) return;
  baseShadow(ctx, x, y + 24, 10);
  ctx.fillStyle = burnt ? '#241a16' : '#6e4622';
  ctx.fillRect(x - 2, y, 4, 24); // the post it stands on
  ctx.save();
  ctx.translate(x, y - 18);
  ctx.rotate(world === 4 ? 0.06 : -0.03);
  ctx.fillStyle = burnt ? '#141116' : '#1d1d22';
  ctx.fillRect(-37, -18, 74, 36);
  ctx.strokeStyle = burnt ? '#3c2c24' : '#4a4a55';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-37, -18, 74, 36);
  // the clapper stick, open
  ctx.save();
  ctx.translate(-37, -18);
  ctx.rotate(-0.16);
  for (let sIdx = 0; sIdx < 8; sIdx++) {
    ctx.fillStyle = sIdx % 2 ? '#e8e0d0' : '#20202a';
    ctx.beginPath();
    ctx.moveTo(sIdx * 9.5, 0);
    ctx.lineTo(sIdx * 9.5 + 6, 0);
    ctx.lineTo(sIdx * 9.5 + 11, -7);
    ctx.lineTo(sIdx * 9.5 + 5, -7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const chalk = burnt ? '#8a7a70' : '#f2f2f2';
  artText(ctx, `SET ${world}`, 0, -8, 9, chalk);
  artText(ctx, `A ${producer}`, 0, 3, 5.5, chalk, false);
  artText(ctx, 'PRODUCTION', 0, 11, 5.5, chalk, false);
  if (burnt) { // world 4: it caught fire and nobody cared
    ctx.fillStyle = '#0c0a0e';
    ctx.beginPath();
    ctx.moveTo(37, -18);
    ctx.lineTo(37, 2);
    ctx.lineTo(22, -6);
    ctx.lineTo(30, -18);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// PUBLIC: terrain, fog, paths, nodes, token, HUD sign
// ---------------------------------------------------------------------------

export function drawTerrain(ctx: Ctx, camX: number, frame: number): void {
  ctx.save();
  ctx.translate(-camX, 0);
  drawSky(ctx, camX, frame);
  drawGroundBase(ctx, camX);
  drawMeadow(ctx, camX, frame);
  drawSewer(ctx, camX, frame);
  drawCasino(ctx, camX, frame);
  drawCastle(ctx, camX, frame);
  drawLandmarks(ctx, camX, frame);
  drawClapper(ctx, camX, 560, 142, 1, 'M. ESTRADA', false);
  drawClapper(ctx, camX, 688, SEWER_CUT - 26, 2, 'P. IMPEACH', false);
  drawClapper(ctx, camX, 1452, 262, 3, 'P. IMPEACH (AGAIN)', false);
  drawClapper(ctx, camX, 1978, 128, 4, 'BOWSONARO', true);
  ctx.restore();
}

/** Beaded trail between two nodes. `lit` = both ends unlocked. */
export function drawEdgePath(ctx: Ctx, camX: number, a: LevelId, b: LevelId, lit: boolean): void {
  const p0 = nodePos(a);
  const p1 = nodePos(b);
  if (!inView(camX, p0.x, 120) && !inView(camX, p1.x, 120)) return;
  const len = edgeLength(a, b);
  const count = Math.max(3, Math.round(len / 11));
  const pad = 13 / len;
  ctx.save();
  ctx.translate(-camX, 0);
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    if (t < pad || t > 1 - pad) continue;
    const p = edgePoint(a, b, t);
    if (lit) {
      ctx.fillStyle = '#4a3a22';
      ctx.beginPath();
      ctx.arc(p.x, p.y + 1.2, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f7ecc9';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(235,225,200,0.26)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export interface NodeState {
  unlocked: boolean;
  cleared: boolean;
  focus: boolean;
  optional: boolean;
  castle: boolean;
  final: boolean;
}

export function drawNode(ctx: Ctx, camX: number, id: LevelId, s: NodeState, frame: number): void {
  const p = nodePos(id);
  if (!inView(camX, p.x, 60)) return;
  ctx.save();
  ctx.translate(-camX, 0);
  if (s.castle) drawCastleIcon(ctx, p.x, p.y, s, frame);
  else drawDot(ctx, p.x, p.y, s, frame);
  ctx.restore();
}

function focusRing(ctx: Ctx, x: number, y: number, r: number, frame: number): void {
  const pr = r + Math.sin(frame / 7) * 1.8;
  ctx.strokeStyle = 'rgba(255,80,50,0.35)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, pr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#ff4030';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(x, y, pr, 0, Math.PI * 2);
  ctx.stroke();
}

function drawDot(ctx: Ctx, x: number, y: number, s: NodeState, frame: number): void {
  baseShadow(ctx, x, y + 5, 8);
  if (s.optional && s.unlocked) {
    // bonus acts wear a dashed teal ring + a tag on a string
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#5fd9c8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, 11.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#8a7a52';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 6);
    ctx.lineTo(x - 14, y - 15);
    ctx.stroke();
    ctx.save();
    ctx.translate(x - 25, y - 19);
    ctx.rotate(-0.08);
    ctx.fillStyle = '#efe28a';
    ctx.fillRect(-13, -5, 27, 10);
    ctx.strokeStyle = '#4a3320';
    ctx.strokeRect(-13, -5, 27, 10);
    artText(ctx, 'BONUS', 0.5, 0.5, 6, '#4a3320');
    ctx.restore();
  }
  // the dot
  const rim = s.unlocked ? '#f7ecc9' : '#4a4a55';
  const fill = !s.unlocked ? '#23232c' : s.cleared ? '#ffca28' : '#e33b28';
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(x, y, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,16,10,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  if (s.unlocked) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(x - 2, y - 2.2, 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    artText(ctx, '?', x, y + 0.5, 8, '#8f8f9c');
  }
  if (s.cleared) {
    // tiny victory flag planted in the dot, waving
    const wav = Math.sin(frame / 9 + x) * 1.4;
    ctx.strokeStyle = '#6e4622';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 3.5, y - 2);
    ctx.lineTo(x + 3.5, y - 14);
    ctx.stroke();
    ctx.fillStyle = '#e33b28';
    ctx.beginPath();
    ctx.moveTo(x + 4, y - 14);
    ctx.lineTo(x + 12 + wav, y - 11.5);
    ctx.lineTo(x + 4, y - 9);
    ctx.closePath();
    ctx.fill();
  }
  if (s.focus) focusRing(ctx, x, y, 12, frame);
}

function drawCastleIcon(ctx: Ctx, x: number, y: number, s: NodeState, frame: number): void {
  const sc = s.final ? 1.5 : 1;
  baseShadow(ctx, x, y + 6 * sc, 17 * sc);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  const body = s.unlocked ? (s.final ? '#6a4a52' : '#9a90a8') : '#4a4656';
  const dark = s.unlocked ? (s.final ? '#432830' : '#6a6278') : '#302c3a';
  // side towers
  ctx.fillStyle = dark;
  ctx.fillRect(-16, -22, 7, 27);
  ctx.fillRect(9, -22, 7, 27);
  ctx.fillRect(-17, -25, 3, 4);
  ctx.fillRect(-12, -25, 3, 4);
  ctx.fillRect(8, -25, 3, 4);
  ctx.fillRect(13, -25, 3, 4);
  // keep
  ctx.fillStyle = body;
  ctx.fillRect(-11, -17, 22, 22);
  for (let c = 0; c < 4; c++) ctx.fillRect(-11 + c * 6, -20, 4, 4);
  ctx.strokeStyle = 'rgba(15,10,16,0.65)';
  ctx.lineWidth = 1.3;
  ctx.strokeRect(-11, -17, 22, 22);
  // door
  ctx.fillStyle = '#14090e';
  ctx.beginPath();
  ctx.moveTo(-4, 5);
  ctx.lineTo(-4, -4);
  ctx.arc(0, -4, 4, Math.PI, 0);
  ctx.lineTo(4, 5);
  ctx.closePath();
  ctx.fill();
  if (!s.unlocked) artText(ctx, '?', 0, -8.5, 10, '#b8b8c8');
  else {
    ctx.fillStyle = s.final ? '#ffd34e' : '#d0c8e0';
    ctx.fillRect(-8, -13, 3, 4);
    ctx.fillRect(5, -13, 3, 4);
  }
  // banner(s) waving from the towers
  const wav = Math.sin(frame / 8 + x) * 1.6;
  const bannerCol = s.cleared ? '#ffca28' : s.unlocked ? '#e33b28' : '#3c3a44';
  for (const bx of s.final ? [-12.5, 12.5] : [12.5]) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(bx, -25);
    ctx.lineTo(bx, -33);
    ctx.stroke();
    ctx.fillStyle = bannerCol;
    ctx.beginPath();
    ctx.moveTo(bx, -33);
    ctx.lineTo(bx + 8 + wav, -30.5);
    ctx.lineTo(bx, -28);
    ctx.closePath();
    ctx.fill();
  }
  if (s.cleared) {
    // gold star stamped on the keep: rescue "accomplished"
    artText(ctx, '★', 0, -11, 9, '#ffca28');
  }
  ctx.restore();
  if (s.focus) focusRing(ctx, x, y - 6 * sc, 22 * sc, frame);
}

/** Fog of the future: regions beyond the highest unlocked world are visible
 *  but sleeping — desaturated dark veil + slow drifting wisps. */
export function drawFog(ctx: Ctx, camX: number, frame: number, maxWorld: WorldNo): void {
  if (maxWorld >= 4) return;
  const x0 = maxWorld * REGION_W;
  if (x0 >= camX + VIEW_W) return;
  ctx.save();
  ctx.translate(-camX, 0);
  const edge = 34;
  const g = ctx.createLinearGradient(x0 - edge, 0, x0 + edge, 0);
  g.addColorStop(0, 'rgba(24,28,42,0)');
  g.addColorStop(1, 'rgba(24,28,42,0.58)');
  ctx.fillStyle = g;
  ctx.fillRect(x0 - edge, 0, edge * 2, VIEW_H);
  ctx.fillStyle = 'rgba(24,28,42,0.58)';
  ctx.fillRect(x0 + edge, 0, MAP_W - x0 - edge, VIEW_H);
  // wisps
  for (let i = 0; i < 10; i++) {
    const wy = 30 + hash01(i * 67 + 3) * 300;
    const span = MAP_W - x0 + 200;
    const wx = x0 - 60 + ((frame * (0.15 + hash01(i * 13) * 0.2) + i * 331) % span);
    if (!inView(camX, wx, 90)) continue;
    ctx.fillStyle = 'rgba(205,215,235,0.05)';
    ctx.beginPath();
    ctx.ellipse(wx, wy, 65, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Estrada's map token: mini hero standing on (or walking between) dots. */
export function drawToken(
  ctx: Ctx, camX: number, x: number, y: number, frame: number,
  opts: { walking: boolean; facing: 1 | -1; bob: boolean },
): void {
  ctx.save();
  ctx.translate(-camX, 0);
  const bob = opts.walking
    ? Math.abs(Math.sin(frame / 3.2)) * -2.2
    : opts.bob ? Math.sin(frame / 14) * 1.4 : 0;
  baseShadow(ctx, x, y - 5, opts.walking ? 5 : 6);
  ctx.translate(x, y - 8 + bob);
  ctx.scale(opts.facing, 1);
  // boots
  const step = opts.walking ? Math.sin(frame / 3.2) * 2 : 0;
  ctx.fillStyle = '#5a3a1e';
  ctx.fillRect(-5 + step, -2, 4, 2.5);
  ctx.fillRect(1 - step, -2, 4, 2.5);
  // overalls + shirt
  ctx.fillStyle = '#2a4fd8';
  ctx.fillRect(-5, -8, 10, 6.5);
  ctx.fillStyle = '#d8382a';
  ctx.fillRect(-5, -10.5, 10, 3);
  ctx.fillRect(-7, -10 + step * 0.5, 2, 4);
  ctx.fillRect(5, -10 - step * 0.5, 2, 4);
  ctx.fillStyle = '#f2b98a';
  ctx.fillRect(-7, -6.5 + step * 0.5, 2, 1.5);
  ctx.fillRect(5, -6.5 - step * 0.5, 2, 1.5);
  // head
  ctx.fillStyle = '#f2b98a';
  ctx.fillRect(-5, -17, 10, 7);
  ctx.fillStyle = '#e0a070';
  ctx.fillRect(4, -14, 2, 2); // the proud nose
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(1, -16, 3, 2);
  ctx.fillStyle = '#000';
  ctx.fillRect(2, -15.4, 2, 1.2);
  ctx.fillRect(1, -16, 3, 0.8); // half-lid: smug at map scale too
  ctx.fillStyle = '#3a2a1e';
  ctx.fillRect(-5, -17, 2, 3.5); // sideburn
  ctx.fillRect(0, -12.2, 4, 1); // pencil moustache
  // cap + medallion
  ctx.fillStyle = '#d8382a';
  ctx.fillRect(-6, -20.5, 12, 4);
  ctx.fillRect(3, -17.5, 4.5, 2);
  ctx.fillStyle = '#ffd34e';
  ctx.beginPath();
  ctx.arc(0, -18.5, 2.2, 0, Math.PI * 2);
  ctx.fill();
  artText(ctx, 'E', 0, -18.2, 4, '#8a2020');
  ctx.restore();
}

/** Walking dust puff (world coords), age 0..18. */
export function drawPuff(ctx: Ctx, camX: number, x: number, y: number, age: number): void {
  ctx.save();
  ctx.translate(-camX, 0);
  const a = Math.max(0, 1 - age / 18);
  ctx.fillStyle = `rgba(235,228,210,${(a * 0.75).toFixed(2)})`;
  ctx.beginPath();
  ctx.arc(x, y - age * 0.3, 2.2 + age * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** HUD: the region name on a hanging wooden sign (screen space, top center).
 *  Board is map art; the TEXT uses ui/theme tokens per house rule. */
export function drawWoodSign(ctx: Ctx, cx: number, line1: string, line2: string): void {
  const w = Math.max(170, line1.length * 9.8 + 26);
  const y = 10;
  const h = 34;
  ctx.save();
  // ropes to the top of frame
  ctx.strokeStyle = '#3c2a18';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2 + 12, 0);
  ctx.lineTo(cx - w / 2 + 10, y + 3);
  ctx.moveTo(cx + w / 2 - 12, 0);
  ctx.lineTo(cx + w / 2 - 10, y + 3);
  ctx.stroke();
  // plank
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(cx - w / 2, y, w, h);
  ctx.strokeStyle = '#452e16';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(cx - w / 2, y, w, h);
  ctx.strokeStyle = 'rgba(40,24,10,0.35)';
  ctx.lineWidth = 1;
  for (const gy of [y + 9, y + 18, y + 27]) {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + 4, gy);
    ctx.quadraticCurveTo(cx, gy + 2, cx + w / 2 - 4, gy);
    ctx.stroke();
  }
  ctx.fillStyle = '#2c1c0c'; // nail heads
  for (const [nx, ny] of [
    [cx - w / 2 + 5, y + 5], [cx + w / 2 - 5, y + 5],
    [cx - w / 2 + 5, y + h - 5], [cx + w / 2 - 5, y + h - 5],
  ] as const) {
    ctx.beginPath();
    ctx.arc(nx, ny, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = UI.fontHead;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  textShadow(ctx, line1, cx, y + 13, UI.text);
  ctx.font = UI.fontSmall;
  textShadow(ctx, line2, cx, y + 26, UI.accent);
  ctx.restore();
}

// re-export for the scene's convenience (single import site)
export { worldOf };
