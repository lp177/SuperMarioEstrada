// ============================================================================
// src/render/painter.ts — procedural sprite painter for everything in-level.
// Pure presentation: reads sim state, never writes it. No module-level DOM —
// every function receives its ctx. Chunky 16px retro look: 2px outlines,
// saturated colors, strong silhouettes, satirical character.
// All drawing is camera-relative (screen = world - cam) and culled to the
// camera window +32px.
// ============================================================================

import type {
  BossLike,
  BossPhase,
  CameraState,
  CharacterId,
  EnemyKind,
  EntityKind,
  EntityLike,
  LevelLike,
  PlayerLike,
  PlayerSize,
  PowerupKind,
  ThemeId,
  TileKind,
} from '../core/types.ts';
import { GOAL, PHYS, SOLIDITY, TILE, VIEW_H, VIEW_W } from '../core/constants.ts';

type Ctx = CanvasRenderingContext2D;

/** House outline: near-black, 2px, on everything with a silhouette. */
const OUT = '#16121f';
/** Cull margin around the camera window, px. */
const CULL = 32;

function snap(v: number): number {
  return Math.round(v);
}

/** Deterministic per-tile hash in [0,1) for texture variation. Render code
 *  never touches RNG streams — this is a pure function of tile coords. */
function tileHash(tx: number, ty: number): number {
  let h = (tx * 374761393 + ty * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Filled rect with the house 2px outline. */
function orect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, outline: string = OUT): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string, outline?: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline !== undefined) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function tri(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, fill: string, outline?: string): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline !== undefined) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** Tiny centered label. Sets its own font/align state every call. */
function txt(ctx: Ctx, s: string, x: number, y: number, px: number, color: string): void {
  ctx.fillStyle = color;
  ctx.font = `bold ${px}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

/** White plus-shaped glint. */
function sparkle(ctx: Ctx, x: number, y: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 3, y - 1, 6, 2);
  ctx.fillRect(x - 1, y - 3, 2, 6);
}

// ---------------------------------------------------------------------------
// Theme tile palettes — exhaustive Record<ThemeId, …>, never an if-chain.
// ---------------------------------------------------------------------------

interface TilePal {
  /** Exposed surface strip (grass / moss / felt / worn stone). */
  top: string;
  /** Terrain body. */
  fill: string;
  /** Darker texture lines. */
  detail: string;
  /** Theme accent: flowers / slime / gold trim / lava glow. */
  accent: string;
  onewayA: string;
  onewayB: string;
  pipeA: string;
  pipeB: string;
}

const THEME_PAL: Record<ThemeId, TilePal> = {
  meadow: {
    top: '#4fbc45', fill: '#96603a', detail: '#7a4b2a', accent: '#ffe9f2',
    onewayA: '#b0762f', onewayB: '#7c4f1d', pipeA: '#3fae4c', pipeB: '#2a7d35',
  },
  sewer: {
    top: '#5f8a5a', fill: '#525866', detail: '#3f4450', accent: '#7ddc4f',
    onewayA: '#5a6d52', onewayB: '#3e4c39', pipeA: '#a3623a', pipeB: '#74452a',
  },
  casino: {
    top: '#8d4cc2', fill: '#5b2e85', detail: '#472468', accent: '#f2c14e',
    onewayA: '#ff4fd8', onewayB: '#8a1f77', pipeA: '#31d3c8', pipeB: '#1d938b',
  },
  castle: {
    top: '#9a9cab', fill: '#5f616e', detail: '#494b58', accent: '#ff7b2d',
    onewayA: '#e0b23a', onewayB: '#a87a1e', pipeA: '#e0aa2f', pipeB: '#a37a1c',
  },
};

// ---------------------------------------------------------------------------
// Tiles — exhaustive Record<TileKind, draw fn>. An unknown kind THROWS.
// ---------------------------------------------------------------------------

interface TileArgs {
  ctx: Ctx;
  /** Screen px of the tile's top-left corner. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  theme: ThemeId;
  pal: TilePal;
  frame: number;
  level: LevelLike;
}

type TileDraw = (a: TileArgs) => void;

/** Theme-specific ground dressing, applied after the base block. */
const GROUND_FLAVOR: Record<ThemeId, (a: TileArgs, exposed: boolean) => void> = {
  meadow: (a, exposed) => {
    if (!exposed) return;
    const h = tileHash(a.tx, a.ty);
    // grass tufts poking above the surface
    a.ctx.fillStyle = a.pal.top;
    a.ctx.fillRect(a.x + 2, a.y - 2, 3, 2);
    a.ctx.fillRect(a.x + 10, a.y - 2, 3, 2);
    if (h < 0.14) disc(a.ctx, a.x + 7, a.y - 3, 2, a.pal.accent); // rare flower
  },
  sewer: (a, exposed) => {
    const { ctx, x, y, tx, ty } = a;
    if (exposed && tileHash(tx, ty) < 0.5) {
      ctx.fillStyle = a.pal.accent; // moss patches
      ctx.fillRect(x + 3, y + 2, 4, 2);
      ctx.fillRect(x + 10, y + 3, 3, 2);
    }
    // slime drip from an exposed underside, slow-breathing length
    if (a.level.map.tileAt(tx, ty + 1) === 'empty' && tileHash(tx * 7, ty) > 0.72) {
      const len = 4 + Math.sin(a.frame / 22 + tx * 1.7) * 2;
      ctx.fillStyle = a.pal.accent;
      ctx.fillRect(x + 6, y + TILE - 1, 3, len);
      disc(ctx, x + 7.5, y + TILE - 1 + len, 2, a.pal.accent);
    }
  },
  casino: (a, exposed) => {
    if (!exposed) return;
    a.ctx.fillStyle = a.pal.accent; // gold trim under the felt
    a.ctx.fillRect(a.x, a.y + 6, TILE, 1);
  },
  castle: (a) => {
    // lava glow licking the underside of stone above lava
    if (a.level.map.tileAt(a.tx, a.ty + 1) === 'lava') {
      const g = 0.35 + 0.2 * Math.sin(a.frame / 8 + a.tx);
      a.ctx.fillStyle = `rgba(255,123,45,${g.toFixed(3)})`;
      a.ctx.fillRect(a.x, a.y + TILE - 3, TILE, 3);
    }
  },
};

// ---------------------------------------------------------------------------
// Hazard integration — spikes GROW FROM the terrain, never float (playtest
// law). Every spike tile probes its neighbours (spikeSeat) and seats itself
// on whatever solid it touches: floor spikes root DOWN into their support,
// ceiling spikes root UP, wall spikes root SIDEWAYS, and a spike with no
// solid neighbour at all gets a riveted anchor plate so nothing free-floats.
// All drawing happens in a canonical points-up frame (origin = tile centre,
// +y toward the support) rotated onto the actual seat, so each theme flavor
// works in all four orientations for free.
// The 2-3px root flare that overlaps the SUPPORT tile lives in a second
// overlay pass (TILE_OVERLAY, drawn by drawTiles after every base tile): the
// main pass paints rows top-to-bottom, so a floor spike's support lands AFTER
// the spike and would bury any overlap drawn in the first pass.
// ---------------------------------------------------------------------------

interface SpikeSeat {
  /** Rotates the canonical points-up drawing onto the actual support. */
  rot: number;
  /** False = no solid neighbour anywhere: anchor-plate fallback. */
  anchored: boolean;
  /** A same-kind spike continues past the canonical left/right edge — runs
   *  share one base band; seam caps appear only at the run's real ends. */
  leftSame: boolean;
  rightSame: boolean;
}

function spikeSeat(map: LevelLike['map'], tx: number, ty: number): SpikeSeat {
  const solid = (dx: number, dy: number): boolean =>
    SOLIDITY[map.tileAt(tx + dx, ty + dy)] === 'solid';
  const same = (dx: number, dy: number): boolean => map.tileAt(tx + dx, ty + dy) === 'spike';
  // floor first (the normal case), then ceiling, then either wall; the
  // canonical-left/right map directions follow the rotation (see rot math).
  if (solid(0, 1)) return { rot: 0, anchored: true, leftSame: same(-1, 0), rightSame: same(1, 0) };
  if (solid(0, -1)) return { rot: Math.PI, anchored: true, leftSame: same(1, 0), rightSame: same(-1, 0) };
  if (solid(-1, 0)) return { rot: Math.PI / 2, anchored: true, leftSame: same(0, -1), rightSame: same(0, 1) };
  if (solid(1, 0)) return { rot: -Math.PI / 2, anchored: true, leftSame: same(0, 1), rightSame: same(0, -1) };
  return { rot: 0, anchored: false, leftSame: same(-1, 0), rightSame: same(1, 0) };
}

interface SpikeArgs {
  ctx: Ctx;
  /** tileHash(tx,ty): per-tile deterministic jitter. */
  hash: number;
  frame: number;
  leftSame: boolean;
  rightSame: boolean;
}

/** Per-tooth deterministic jitter in [0,1) derived from the tile hash. */
function toothJitter(hash: number, i: number): number {
  return (hash * 31 + i * 0.618034) % 1;
}

/** Tooth centre x for n evenly spaced teeth — adjacent tiles continue the
 *  same rhythm, so a spike run reads as one long trap. */
function toothX(n: number, i: number): number {
  return -8 + (16 / n) * (i + 0.5);
}

/** Tooth height, jittered 12..14.5px so a run is not a repeated comb. */
function toothH(hash: number, i: number): number {
  return 12 + toothJitter(hash, i) * 2.5;
}

/** Canonical teeth row: n points rising from the base line (y=+6, i.e. under
 *  the base band that gets drawn OVER their roots) toward the tile top.
 *  Outline = silhouette UNDERLAY (like the player sprite), never a stroke: a
 *  stroked outline on a tall thin triangle converges above the midpoint and
 *  eats the fill from the tip down — the teeth read as black bristles
 *  (rounds 1-2 finding). The underlay keeps the fill full-width to the tip. */
function teethRow(ctx: Ctx, hash: number, n: number, fill: string, outline: string, bob = 0): void {
  const hw = 16 / n / 2 - 0.4;
  for (let i = 0; i < n; i++) {
    const cxT = toothX(n, i);
    const h = toothH(hash, i);
    tri(ctx, cxT - hw - 0.9, 6.9 + bob, cxT + hw + 0.9, 6.9 + bob, cxT, 6 - h - 1.4 + bob, outline);
    tri(ctx, cxT - hw, 6 + bob, cxT + hw, 6 + bob, cxT, 6 - h + bob, fill);
  }
}

/** Base band across the FULL tile width (runs share it seamlessly); darker
 *  caps only where the run actually ends. Covers the teeth roots, so the
 *  points read as emerging from the band, and the band from the terrain. */
function baseBand(
  ctx: Ctx, y0: number, h: number, fill: string, cap: string,
  s: { leftSame: boolean; rightSame: boolean },
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(-8, y0, 16, h);
  ctx.fillStyle = cap;
  if (!s.leftSame) ctx.fillRect(-8, y0, 2, h);
  if (!s.rightSame) ctx.fillRect(6, y0, 2, h);
}

interface SpikeStyle {
  /** Teeth + base band, canonical frame; stays inside the tile cell. */
  body: (s: SpikeArgs) => void;
  /** Root flare drawn INTO the support tile (+8..~+11) by the overlay pass —
   *  the part that makes the trap read as grown from the terrain. */
  root: (s: SpikeArgs) => void;
}

const SPIKE_STYLE: Record<ThemeId, SpikeStyle> = {
  // tax-form paper spikes STAPLED to the terrain: deadly paperwork, filed
  meadow: {
    body: (s) => {
      const { ctx, hash } = s;
      teethRow(ctx, hash, 2, '#f2efe4', '#9a958c');
      for (const i of [0, 1] as const) {
        const cxT = toothX(2, i);
        ctx.fillStyle = '#c22e2e';
        ctx.fillRect(cxT - 1.5, -1, 3, 1); // TOTAL DUE line
        ctx.fillStyle = '#b8b2a6';
        ctx.fillRect(cxT - 1.5, 1, 3, 1); // fine print
        ctx.fillRect(cxT - 2.5, 3, 5, 1);
      }
      baseBand(ctx, 4, 4, '#e6d9a8', '#b5a273', s);
      ctx.fillStyle = '#b5a273'; // manila fold line
      ctx.fillRect(-8, 4, 16, 1);
      ctx.fillStyle = '#4a4453'; // the staples
      for (const sx of [-4.5, 3.5]) {
        ctx.fillRect(sx - 1.5, 5, 3, 1);
        ctx.fillRect(sx - 1.5, 5, 1, 2.5);
        ctx.fillRect(sx + 0.5, 5, 1, 2.5);
      }
    },
    root: (s) => {
      const { ctx } = s;
      baseBand(ctx, 8, 3, '#6b4326', '#54341d', s); // pressed-earth seam
      ctx.fillStyle = '#422814'; // staple legs biting into the terrain
      for (const sx of [-4.5, 3.5]) {
        ctx.fillRect(sx - 1.5, 8, 1, 2);
        ctx.fillRect(sx + 0.5, 8, 1, 2);
      }
    },
  },

  // rusted iron spikes sweating rust into the masonry they grew from
  sewer: {
    body: (s) => {
      const { ctx, hash } = s;
      teethRow(ctx, hash, 3, '#9aa0ad', OUT);
      for (let i = 0; i < 3; i++) {
        const cxT = toothX(3, i);
        const j = toothJitter(hash, i + 3);
        ctx.fillStyle = '#8a5430'; // rust creeping up from the roots
        ctx.fillRect(cxT - 1, 2 - j * 2, 2, 3);
        ctx.fillStyle = '#74452a';
        ctx.fillRect(cxT - 1, 4, 2, 2);
      }
      baseBand(ctx, 4, 4, '#495061', '#333846', s); // corroded mounting bar
      ctx.fillStyle = '#6d7480'; // worn top edge
      ctx.fillRect(-8, 4, 16, 1);
    },
    root: (s) => {
      const { ctx, hash } = s;
      baseBand(ctx, 8, 3, '#333846', '#262b36', s);
      ctx.fillStyle = '#7c4a28'; // drip stains running off the roots
      for (const [dx, k] of [[-5, 0], [0, 1], [4, 2]] as const) {
        ctx.fillRect(dx, 10, 1.5, 2 + toothJitter(hash, k + 7) * 4);
      }
    },
  },

  // card-shredder blades chewing out of a chrome slot bolted to the felt
  casino: {
    body: (s) => {
      const { ctx, hash, frame } = s;
      const bob = Math.sin(frame / 5 + hash * 6.283); // the shredder CHEWS
      teethRow(ctx, hash, 3, '#c9ccd8', OUT, bob);
      ctx.fillStyle = '#f2f2f2'; // shine on each blade's leading edge
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(toothX(3, i) - 0.5, 6 - toothH(hash, i) * 0.7 + bob, 1, 5);
      }
      // chrome slot housing: blades vanish into a dark slit, not into air
      baseBand(ctx, 3, 5, '#8a8d99', '#565a68', s);
      ctx.fillStyle = '#c9ccd8'; // brushed top edge
      ctx.fillRect(-8, 3, 16, 1);
      ctx.fillStyle = OUT; // the slit itself, continued across a run
      const sx0 = s.leftSame ? -8 : -7;
      const sx1 = s.rightSame ? 8 : 7;
      ctx.fillRect(sx0, 4.5, sx1 - sx0, 1.5);
      if (hash < 0.6) { // shredded-card confetti stuck at the slot
        ctx.fillStyle = '#f5f0e6';
        ctx.fillRect(-6 + hash * 8, 2, 2, 1);
        ctx.fillStyle = '#c22e2e';
        ctx.fillRect(2 - hash * 4, 2.2, 1.5, 1);
      }
    },
    root: (s) => {
      const { ctx } = s;
      baseBand(ctx, 8, 3, '#565a68', '#3f4450', s); // mounting flange
      disc(ctx, -5.5, 9.4, 0.9, '#f2c14e'); // gold house screws
      disc(ctx, 5.5, 9.4, 0.9, '#f2c14e');
    },
  },

  // blackened iron spikes forged into the stone, embers still breathing
  castle: {
    body: (s) => {
      const { ctx, hash, frame } = s;
      teethRow(ctx, hash, 3, '#3a3d4d', OUT);
      ctx.fillStyle = '#6d7480'; // cold edge highlight
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(toothX(3, i) - 0.5, 8 - toothH(hash, i), 1, 5);
      }
      baseBand(ctx, 4, 4, '#26232f', '#1c1a24', s); // scorched collar
      const g = 0.3 + 0.2 * Math.sin(frame / 8 + hash * 6.283);
      ctx.fillStyle = `rgba(255,123,45,${g.toFixed(3)})`; // breathing embers
      ctx.fillRect(-8, 3, 16, 3);
      if ((frame + Math.floor(hash * 97)) % 34 < 17) {
        disc(ctx, -4 + hash * 8, 4.5, 1, '#ff8c2e');
        disc(ctx, 5 - hash * 9, 5.5, 0.8, '#ffd23e');
      }
    },
    root: (s) => {
      const { ctx, hash, frame } = s;
      baseBand(ctx, 8, 3, '#1c1a24', OUT, s);
      const g = 0.25 + 0.15 * Math.sin(frame / 8 + hash * 6.283);
      ctx.fillStyle = `rgba(255,123,45,${g.toFixed(3)})`; // glow over the seam
      ctx.fillRect(-8, 7, 16, 4);
    },
  },
};

/** Isolated spikes (no solid neighbour anywhere) still never free-float: a
 *  riveted anchor plate bolts the trap onto something visible. Rare by
 *  design after the placement audit — but never invisible, never floating. */
function anchorPlate(ctx: Ctx): void {
  orect(ctx, -8, 3, 16, 5, '#8a8d99');
  for (const rx of [-5.5, 0, 5.5]) {
    disc(ctx, rx, 5.5, 1.2, '#c9ccd8');
    disc(ctx, rx + 0.4, 5.9, 0.5, '#565a68');
  }
}

const TILE_DRAW: Record<TileKind, TileDraw> = {
  empty: () => {},

  ground: (a) => {
    const { ctx, x, y, tx, ty, pal } = a;
    const above = a.level.map.tileAt(tx, ty - 1);
    const exposed = above === 'empty' || above === 'oneway';
    ctx.fillStyle = pal.fill;
    ctx.fillRect(x, y, TILE, TILE);
    // offset block-mortar texture
    ctx.fillStyle = pal.detail;
    ctx.fillRect(x, y + 8, TILE, 2);
    ctx.fillRect(x + ((ty & 1) === 0 ? 7 : 3), y + 10, 2, 6);
    if (a.level.map.tileAt(tx - 1, ty) === 'empty') { ctx.fillStyle = OUT; ctx.fillRect(x, y, 2, TILE); }
    if (a.level.map.tileAt(tx + 1, ty) === 'empty') { ctx.fillStyle = OUT; ctx.fillRect(x + TILE - 2, y, 2, TILE); }
    if (exposed) {
      ctx.fillStyle = OUT;
      ctx.fillRect(x, y, TILE, 2);
      ctx.fillStyle = pal.top;
      ctx.fillRect(x, y + 2, TILE, 4);
    }
    GROUND_FLAVOR[a.theme](a, exposed);
  },

  bedrock: (a) => {
    const { ctx, x, y, tx, ty } = a;
    ctx.fillStyle = '#332e40';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#262133';
    ctx.fillRect(x, y + 13, TILE, 3);
    if (((tx + ty) & 1) === 0) ctx.fillRect(x + 5, y + 4, 6, 6);
  },

  brick: (a) => {
    // coin-bag bricks: the kingdom's savings, mortared into the walls
    const { ctx, x, y } = a;
    orect(ctx, x, y, TILE, TILE, '#b06d32');
    ctx.fillStyle = '#8a4f22';
    ctx.fillRect(x + 2, y + 3, 12, 2); // bag tie
    ctx.fillRect(x + 7, y + 5, 2, 9);  // coin seam
    disc(ctx, x + 8, y + 9, 3, '#ffd34e', '#a87a1e'); // coin peeking out
  },

  qblock: (a) => {
    const { ctx, x, y, frame } = a;
    const pulse = Math.sin(frame / 9);
    orect(ctx, x, y, TILE, TILE, '#f2a72b');
    ctx.fillStyle = `rgba(255,255,255,${(0.1 + 0.08 * pulse).toFixed(3)})`;
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#8a2020'; // notary-stamp corners
    ctx.fillRect(x + 2, y + 2, 3, 3);
    ctx.fillRect(x + 11, y + 2, 3, 3);
    ctx.fillRect(x + 2, y + 11, 3, 3);
    ctx.fillRect(x + 11, y + 11, 3, 3);
    txt(ctx, '?', x + 8, y + 8 + pulse * 1.5, 10, '#ffffff');
  },

  usedblock: (a) => {
    const { ctx, x, y } = a;
    orect(ctx, x, y, TILE, TILE, '#8a7f6a');
    ctx.fillStyle = '#6f6555';
    ctx.fillRect(x + 2, y + 2, 3, 3);
    ctx.fillRect(x + 11, y + 2, 3, 3);
    ctx.fillRect(x + 2, y + 11, 3, 3);
    ctx.fillRect(x + 11, y + 11, 3, 3);
    txt(ctx, 'VOID', x + 8, y + 8, 5, '#5a5142');
  },

  oneway: (a) => {
    const { ctx, x, y, pal } = a;
    orect(ctx, x, y, TILE, 7, pal.onewayA);
    ctx.fillStyle = pal.onewayB;
    ctx.fillRect(x + 2, y + 4, TILE - 4, 2);
    ctx.fillRect(x + 6, y + 7, 4, 3); // support nub
  },

  pipe: (a) => {
    const { ctx, x, y, tx, ty, pal } = a;
    const m = a.level.map;
    const isTop = m.tileAt(tx, ty - 1) !== 'pipe';
    const leftEdge = m.tileAt(tx - 1, ty) !== 'pipe';
    const rightEdge = m.tileAt(tx + 1, ty) !== 'pipe';
    ctx.fillStyle = pal.pipeA;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = pal.pipeB;
    if (rightEdge) ctx.fillRect(x + TILE - 5, y, 5, TILE);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    if (leftEdge) ctx.fillRect(x + 2, y, 3, TILE);
    ctx.fillStyle = OUT;
    if (leftEdge) ctx.fillRect(x, y, 2, TILE);
    if (rightEdge) ctx.fillRect(x + TILE - 2, y, 2, TILE);
    if (isTop) {
      const lx = leftEdge ? x - 2 : x;
      const rx = rightEdge ? x + TILE + 2 : x + TILE;
      orect(ctx, lx, y, rx - lx, 7, pal.pipeA);
      ctx.fillStyle = pal.pipeB;
      ctx.fillRect(lx + 2, y + 4, rx - lx - 4, 2);
    }
  },

  spike: (a) => {
    // hazard law: spikes grow FROM the terrain — seat on the solid neighbour
    // (spikeSeat), theme flavor in SPIKE_STYLE, root flare in TILE_OVERLAY.
    const { ctx, x, y, tx, ty } = a;
    const seat = spikeSeat(a.level.map, tx, ty);
    ctx.save();
    ctx.translate(x + TILE / 2, y + TILE / 2);
    ctx.rotate(seat.rot);
    SPIKE_STYLE[a.theme].body({
      ctx, hash: tileHash(tx, ty), frame: a.frame,
      leftSame: seat.leftSame, rightSame: seat.rightSame,
    });
    if (!seat.anchored) anchorPlate(ctx);
    ctx.restore();
  },

  lava: (a) => {
    const { ctx, x, y, tx, ty, frame } = a;
    const surface = a.level.map.tileAt(tx, ty - 1) !== 'lava';
    ctx.fillStyle = '#d8451c';
    ctx.fillRect(x, y, TILE, TILE);
    if (tileHash(tx, ty) < 0.4) {
      ctx.fillStyle = '#a82f12';
      ctx.fillRect(x + 4, y + 6, 6, 4);
    }
    if (surface) {
      const w = Math.sin(frame / 9 + tx * 1.3) * 2; // wobbling crest
      ctx.fillStyle = '#ff8c2e';
      ctx.fillRect(x, y, TILE, 4 + w);
      ctx.fillStyle = '#ffd23e';
      ctx.fillRect(x + ((tx & 1) === 0 ? 2 : 7), y + 1 + w * 0.5, 5, 2);
    }
  },

  crumble: (a) => {
    // cracked IOU notes: they hold your weight about as well as the promise
    const { ctx, x, y } = a;
    orect(ctx, x, y, TILE, TILE, '#e6d9a8');
    ctx.strokeStyle = '#b5a273';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 2);
    ctx.lineTo(x + 6, y + 6);
    ctx.lineTo(x + 4, y + 11);
    ctx.moveTo(x + 13, y + 3);
    ctx.lineTo(x + 10, y + 8);
    ctx.lineTo(x + 12, y + 14);
    ctx.stroke();
    txt(ctx, 'IOU', x + 8, y + 8, 6, '#8a6f3a');
  },
};

/** Integration overlays, drawn in a SECOND pass after every base tile: the
 *  bits of a hazard that must paint ON TOP of a neighbouring tile (spike
 *  roots flaring into their support, lava lapping up a wall). Exhaustive
 *  with explicit nulls, house style — a new tile kind must declare its
 *  overlay even when that declaration is "none". */
const TILE_OVERLAY: Record<TileKind, TileDraw | null> = {
  empty: null,
  ground: null,
  bedrock: null,
  brick: null,
  qblock: null,
  usedblock: null,
  oneway: null,
  pipe: null,
  crumble: null,

  spike: (a) => {
    const seat = spikeSeat(a.level.map, a.tx, a.ty);
    if (!seat.anchored) return; // the anchor plate needs no root
    const { ctx } = a;
    ctx.save();
    ctx.translate(a.x + TILE / 2, a.y + TILE / 2);
    ctx.rotate(seat.rot);
    SPIKE_STYLE[a.theme].root({
      ctx, hash: tileHash(a.tx, a.ty), frame: a.frame,
      leftSame: seat.leftSame, rightSame: seat.rightSame,
    });
    ctx.restore();
  },

  lava: (a) => {
    // the surface row's glow lip laps 2-3px up any solid neighbour's wall so
    // the pool reads as HELD by the terrain; sub-surface stays full-cell.
    const { ctx, x, y, tx, ty, frame } = a;
    const m = a.level.map;
    if (m.tileAt(tx, ty - 1) === 'lava') return;
    for (const side of [-1, 1] as const) {
      if (SOLIDITY[m.tileAt(tx + side, ty)] !== 'solid') continue;
      const wx = side === -1 ? x : x + TILE; // the wall face, screen px
      const lap = 2 + Math.sin(frame / 8 + tx * 1.9 + side); // 1..3px climb
      ctx.fillStyle = '#ff8c2e'; // molten lick riding up the wall
      ctx.fillRect(wx - 3, y - lap, 6, lap + 5);
      ctx.fillStyle = '#ffd23e'; // hot core hugging the wall face
      ctx.fillRect(side === -1 ? wx - 3 : wx + 1, y - lap + 1, 2, lap + 2);
      const g = 0.3 + 0.15 * Math.sin(frame / 6 + tx + side);
      ctx.fillStyle = `rgba(255,140,46,${g.toFixed(3)})`; // heat sheen above
      ctx.fillRect(side === -1 ? wx - 3 : wx, y - lap - 4, 3, 4);
    }
  },
};

export function drawTiles(ctx: Ctx, level: LevelLike, cam: CameraState): void {
  const map = level.map;
  const theme = level.def.theme;
  const pal = THEME_PAL[theme];
  // No frame param in the contract: the level's own free-running frame counter
  // drives tile animation (qblock pulse, lava wobble, drips).
  const frame = level.stats.frames;
  const cx = snap(cam.x);
  const cy = snap(cam.y);
  const tx0 = Math.floor((cx - CULL) / TILE);
  const tx1 = Math.floor((cx + VIEW_W + CULL) / TILE);
  const ty0 = Math.floor((cy - CULL) / TILE);
  const ty1 = Math.floor((cy + VIEW_H + CULL) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const k = map.tileAt(tx, ty);
      if (k === 'empty') continue;
      const fn = TILE_DRAW[k] as TileDraw | undefined;
      if (fn === undefined) throw new Error(`painter: no tile draw for kind '${String(k)}'`);
      fn({ ctx, x: tx * TILE - cx, y: ty * TILE - cy, tx, ty, theme, pal, frame, level });
    }
  }
  // Integration pass: hazard overlaps that must paint OVER neighbour tiles.
  // Row order draws a floor spike's support AFTER the spike — roots drawn in
  // the first pass would be buried under it; this pass runs once everything
  // is down. Same culling window, still before fx/entities in scene order.
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const k = map.tileAt(tx, ty);
      if (k === 'empty') continue;
      const ov = TILE_OVERLAY[k];
      if (ov !== null) ov({ ctx, x: tx * TILE - cx, y: ty * TILE - cy, tx, ty, theme, pal, frame, level });
    }
  }
}

// ---------------------------------------------------------------------------
// Entities — exhaustive Record<EntityKind, draw fn>. Origin = entity center
// (drawEntities translates there first). An unknown kind THROWS.
// ---------------------------------------------------------------------------

type EDraw = (ctx: Ctx, e: EntityLike, frame: number, level: LevelLike) => void;

const POWERUP_DRAW: Record<PowerupKind, (ctx: Ctx, e: EntityLike, frame: number) => void> = {
  stamp: (ctx, e) => {
    // red rubber stamp scuttling on tiny legs: certification comes to YOU
    const step = Math.floor(e.animT / 8) % 2;
    ctx.fillStyle = OUT;
    ctx.fillRect(-5 + step * 2, 6, 3, 2);
    ctx.fillRect(2 - step * 2, 6, 3, 2);
    orect(ctx, -3, -8, 6, 6, '#b03030'); // knob handle
    orect(ctx, -6, -2, 12, 8, '#7a2020'); // stamp base
    ctx.fillStyle = '#ffd34e';
    ctx.fillRect(-4, 0, 8, 2);
  },
  goldpen: (ctx, e, frame) => {
    ctx.rotate(Math.sin(e.animT / 12) * 0.2);
    orect(ctx, -2, -8, 5, 14, '#f2c14e');
    tri(ctx, -2, 6, 3, 6, 0.5, 11, '#8a6a1e'); // nib
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-1, -6, 1, 5); // clip glint
    if (frame % 40 < 8) sparkle(ctx, 5, -7);
  },
  immunity: (ctx, _e, frame) => {
    // the Parliamentary Immunity badge: a star, because of course it is
    const glow = 0.35 + 0.25 * Math.sin(frame / 7);
    ctx.strokeStyle = `rgba(255,220,110,${glow.toFixed(3)})`;
    ctx.lineWidth = 3;
    starPath(ctx, 0, -1, 10, 4.5);
    ctx.stroke();
    starPath(ctx, 0, -1, 8, 3.6);
    ctx.fillStyle = '#ffd34e';
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
    disc(ctx, 0, -1, 2.5, '#c22e2e');
    orect(ctx, -10, 7, 20, 6, '#f5f0e6');
    txt(ctx, 'IMMUNITY', 0, 10, 3.5, '#8a2020');
  },
};

/** 5-point star path centered at (x,y). */
function starPath(ctx: Ctx, x: number, y: number, rOut: number, rIn: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = (i & 1) === 0 ? rOut : rIn;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// ENTOURAGE DISGUISES — every enemy is the world producer's crew in a bad
// costume (the AGENTS.md table). Mechanics and hitboxes are FROZEN: these
// skins change pixels only, dispatched per theme through an exhaustive
// Record<EnemyKind, Record<ThemeId, SkinDraw>> — an unknown theme does not
// compile. Budget rule: each disguise carries exactly ONE readable costume
// tell (back zipper / HELLO-I'M tag / human shoes / costume head ajar); prop
// enemies get one set-dressing tell instead (tape label, price sticker).
// The castle 'rat' is the sanctioned exception: a REAL capybara, no costume.
// ---------------------------------------------------------------------------

type SkinDraw = (ctx: Ctx, e: EntityLike, frame: number) => void;

/** Two-frame walk cycle off the free-running animT. */
function walkStep(e: EntityLike, period: number): number {
  return Math.floor(e.animT / period) % 2;
}

// --- the canonical costume tells (small; pick ONE per disguise) ---

/** Open back zipper: dark gap, someone's skin showing, dangling pull ring. */
function tellZipper(ctx: Ctx, x: number, y: number, h: number): void {
  ctx.fillStyle = OUT;
  ctx.fillRect(x, y, 3, h);
  ctx.fillStyle = '#f2b98a';
  ctx.fillRect(x + 1, y + 1, 1.5, h - 2);
  disc(ctx, x + 1.5, y + h + 1, 1.5, '#c9ccd8', OUT);
}

/** Convention name tag: white card, red HELLO-I'M band, the name. */
function tellTag(ctx: Ctx, x: number, y: number, w: number, name: string): void {
  orect(ctx, x, y, w, 8, '#f5f0e6');
  ctx.fillStyle = '#c22e2e';
  ctx.fillRect(x + 1, y + 1, w - 2, 2.5);
  txt(ctx, name, x + w / 2, y + 5.5, 3, OUT);
}

/** Polished human dress shoes (sock sliver included) where creature feet
 *  should be. `y` is the top of the shoe line. */
function tellShoes(ctx: Ctx, step: number, y: number): void {
  ctx.fillStyle = '#f5f0e6';
  ctx.fillRect(-5 + step, y - 1, 3, 1);
  ctx.fillRect(2 - step, y - 1, 3, 1);
  ctx.fillStyle = '#2a2017';
  ctx.fillRect(-6 + step, y, 5, 2);
  ctx.fillRect(1 - step, y, 5, 2);
}

// --- shared costume chassis ---

/** Goomba-onesie dome with the sewn-on face panel (brows + costume eyes). */
function onesieDome(ctx: Ctx, fill: string): void {
  disc(ctx, 0, -2, 8, fill, OUT);
  orect(ctx, -5, 1, 10, 6, '#e8caa0');
  ctx.fillStyle = OUT;
  ctx.fillRect(-4, 2, 3, 1); // costume-kit angry brows
  ctx.fillRect(1, 2, 3, 1);
  ctx.fillRect(-3, 3, 2, 2); // felt eyes
  ctx.fillRect(1, 3, 2, 2);
}

/** Turtle-suit chassis: costume legs, shell disc, hood head, eye. */
function turtleBase(ctx: Ctx, e: EntityLike, shellFill: string): void {
  const step = walkStep(e, 9);
  ctx.fillStyle = '#2a5f2a';
  ctx.fillRect(-5 + step, 5, 4, 3);
  ctx.fillRect(1 - step, 5, 4, 3);
  disc(ctx, -1, 0, 6.5, shellFill, OUT);
  orect(ctx, 3, -6, 8, 8, '#7dc86f');
  ctx.fillStyle = OUT;
  ctx.fillRect(8, -4, 2, 2);
}

/** Carnivorous-plant-parody chassis shared by every lawyer skin.
 *  The entity's (x,y) is the HEAD center riding the rise/sink cycle and
 *  Lawyer.baseY is the pipe-rim line, so the plant can be ROOTED: a clip
 *  forbids every pixel below the rim (sinking disappears INTO the pipe,
 *  classic style) and a segmented stem runs from the head through the rim.
 *  The head is drawn slightly low while emerging (fast catch-up) so it is
 *  fully swallowed at rest, then rides the (frozen) hurt box once out.
 *  Returns the local head-center y and the chomp state for the theme tell. */
interface PlantLook {
  head: string;
  headDk: string;
  stem: string;
  stemBand: string;
}

function plantChassis(ctx: Ctx, e: EntityLike, look: PlantLook): { cy: number; open: boolean; out: boolean } {
  // baseY probe: Lawyer exposes it readonly; fall back to "fully out".
  const baseY = (e as unknown as { baseY?: number }).baseY ?? e.y + 28;
  const rim = baseY - e.y; // pipe rim in local coords (>= 0 while emerged)
  ctx.beginPath();
  ctx.rect(-26, -64, 52, 64 + rim); // NOTHING below the rim, ever
  ctx.clip();
  // rest position is DEEP enough that hat/tells sit below the rim too; the
  // head pops out fast early, then rides the (frozen) hurt box once out
  const cy = Math.max(0, 12 - rim * 1.5);
  const open = Math.floor(e.animT / 14) % 2 === 0;
  const out = rim > 2;
  // segmented stem, rooted through the rim (the clip trims the rest)
  ctx.fillStyle = look.stem;
  ctx.fillRect(-3, cy, 6, rim - cy + 3);
  ctx.fillStyle = look.stemBand;
  for (let yy = cy + 5; yy < rim + 3; yy += 5) ctx.fillRect(-3, yy, 6, 2);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-3, cy + 3);
  ctx.lineTo(-3, rim + 3);
  ctx.moveTo(3, cy + 3);
  ctx.lineTo(3, rim + 3);
  ctx.stroke();
  // leaf collar where the head meets the stem: chunky, rounded
  for (const sgn of [-1, 1] as const) {
    ctx.save();
    ctx.translate(sgn * 7, cy + 9);
    ctx.rotate(sgn * 0.45);
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = look.head;
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = look.headDk; // center vein
    ctx.fillRect(-3, -0.6, 6, 1.2);
    ctx.restore();
  }
  // the head: big dome, shaded crescent on the off side
  disc(ctx, 0, cy, 8.5, look.headDk, OUT);
  disc(ctx, 1.3, cy - 0.7, 7.2, look.head);
  if (open) {
    // gaping maw: wide, forward, packed with fangs — a MOUTH, not an eye
    ctx.beginPath();
    ctx.ellipse(1.8, cy + 1.5, 6.9, 4.9, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#5c1414';
    ctx.fill();
    tri(ctx, -4.2, cy - 2.6, -1, cy - 2.6, -2.6, cy + 1.4, '#f2efe4'); // top fangs
    tri(ctx, 0, cy - 3, 3.2, cy - 3, 1.6, cy + 1.6, '#f2efe4');
    tri(ctx, 4.2, cy - 2.8, 7.2, cy - 2, 5.6, cy + 1.4, '#f2efe4');
    tri(ctx, -3.2, cy + 5.6, -0.2, cy + 5.9, -1.7, cy + 2.2, '#f2efe4'); // bottom fangs
    tri(ctx, 1.4, cy + 6, 4.4, cy + 5.8, 2.9, cy + 2.4, '#f2efe4');
    ctx.beginPath(); // fat lips around it all
    ctx.ellipse(1.8, cy + 1.5, 7.6, 5.6, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#f4f0e6';
    ctx.lineWidth = 2.6;
    ctx.stroke();
  } else {
    // lips pressed shut: the fat pout, two fang tips still poking out
    ctx.fillStyle = '#f4f0e6';
    ctx.fillRect(-5.5, cy + 0.5, 13, 3.4);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1;
    ctx.strokeRect(-5.5, cy + 0.5, 13, 3.4);
    ctx.fillStyle = OUT;
    ctx.fillRect(-4.5, cy + 2, 11, 0.9);
    tri(ctx, -2.6, cy + 3.9, -0.6, cy + 3.9, -1.6, cy + 6, '#f2efe4');
    tri(ctx, 2.4, cy + 3.9, 4.4, cy + 3.9, 3.4, cy + 6, '#f2efe4');
  }
  return { cy, open, out };
}

const PLANT_LOOK: Record<ThemeId, PlantLook> = {
  meadow: { head: '#3d8f3d', headDk: '#2c6b2c', stem: '#2f6f2f', stemBand: '#4da24d' },
  sewer: { head: '#3d8f3d', headDk: '#2c6b2c', stem: '#2f6f2f', stemBand: '#4da24d' },
  casino: { head: '#3d8f3d', headDk: '#2c6b2c', stem: '#2f6f2f', stemBand: '#4da24d' },
  castle: { head: '#57713a', headDk: '#42582b', stem: '#3f5429', stemBand: '#5c7a3f' },
};

/** Drone rotor pair + hubs (blur width off the free-running clock). */
function droneRotors(ctx: Ctx, e: EntityLike): void {
  const r = Math.abs(Math.sin(e.animT / 2)) * 5 + 1;
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-5 - r, -8);
  ctx.lineTo(-5 + r, -8);
  ctx.moveTo(5 - r, -8);
  ctx.lineTo(5 + r, -8);
  ctx.stroke();
  ctx.fillStyle = OUT;
  ctx.fillRect(-6, -8, 2, 3);
  ctx.fillRect(4, -8, 2, 3);
}

/** Rat-costume chassis: tail, body ellipse, ear, eye, nose. */
function ratBody(ctx: Ctx, e: EntityLike, fur: string): void {
  ctx.strokeStyle = '#ff9bb0'; // tail first (behind)
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, 1);
  ctx.quadraticCurveTo(-11, -2 + Math.sin(e.animT / 6) * 2, -14, 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 1, 7, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = fur;
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.stroke();
  disc(ctx, 3, -3, 2, fur, OUT); // ear
  ctx.fillStyle = OUT;
  ctx.fillRect(5, -1, 2, 2); // beady eye
  disc(ctx, 7.5, 1, 1, '#ff9bb0'); // nose
}

function ratFeet(ctx: Ctx, e: EntityLike): void {
  const step = walkStep(e, 4);
  ctx.fillStyle = OUT;
  ctx.fillRect(-4 + step, 4, 2, 2);
  ctx.fillRect(2 - step, 4, 2, 2);
}

/** Googly eyes perched on a hopping stack, pupils tracking `facing`. */
function stackEyes(ctx: Ctx, e: EntityLike, y: number): void {
  disc(ctx, -3, y, 2, '#ffffff', OUT);
  disc(ctx, 3, y, 2, '#ffffff', OUT);
  disc(ctx, -3 + e.facing, y, 1, OUT);
  disc(ctx, 3 + e.facing, y, 1, OUT);
}

/** Crusher slam-blur streaks while dropping. */
function slamBlur(ctx: Ctx, e: EntityLike): void {
  if (e.vy > 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-9, -26, 3, 14);
    ctx.fillRect(6, -26, 3, 14);
  }
}

const ENEMY_SKIN: Record<EnemyKind, Record<ThemeId, SkinDraw>> = {
  lobbyist: {
    // Cousin Fabio in a goomba onesie — TELL: the back zipper gapes open.
    meadow: (ctx, e) => {
      const step = walkStep(e, 8);
      ctx.fillStyle = '#6f4626'; // costume booties
      ctx.fillRect(-6 + step, 6, 4, 3);
      ctx.fillRect(2 - step, 6, 4, 3);
      onesieDome(ctx, '#a8722f');
      tellZipper(ctx, -8, -4, 6);
    },
    // Junior lawyer, brown suit, zero costume effort — TELL: giant HELLO tag.
    sewer: (ctx, e) => {
      const step = walkStep(e, 6); // billable scurry
      ctx.fillStyle = '#2a2017';
      ctx.fillRect(-5 + step, 6, 4, 3);
      ctx.fillRect(1 - step, 6, 4, 3);
      orect(ctx, -6, -4, 12, 10, '#6f4626'); // suit, off the rack
      ctx.fillStyle = '#f2b98a'; // head
      ctx.fillRect(-4, -10, 8, 6);
      ctx.fillStyle = '#3a2a1e'; // severe side-part
      ctx.fillRect(-4, -10, 8, 2);
      ctx.fillRect(-4, -8, 2, 3);
      ctx.fillStyle = OUT;
      ctx.fillRect(1, -8, 2, 2); // billable-hours stare
      orect(ctx, 5, 0, 6, 5, '#8a5a2b'); // briefcase
      tellTag(ctx, -7, -2, 12, 'ESQ.');
    },
    // Pit-boss nephew, velvet dome + gold chain — TELL: dad's dress shoes.
    casino: (ctx, e) => {
      const step = walkStep(e, 8);
      tellShoes(ctx, step, 6);
      onesieDome(ctx, '#6d2440');
      ctx.fillStyle = '#3a2a1e'; // painted-on slicked hair
      ctx.fillRect(-6, -9, 12, 3);
      for (const [gx, gy] of [[-4.5, -0.5], [-2, 0.5], [1, 0.5], [3.5, -0.5]] as const) {
        disc(ctx, gx, gy, 1.2, '#ffd34e'); // the chain
      }
    },
    // Army buddy in a barrel costume — TELL: the lid sits ajar, hair out.
    castle: (ctx, e) => {
      const step = walkStep(e, 9);
      ctx.fillStyle = '#2a2017'; // combat boots
      ctx.fillRect(-6 + step, 6, 5, 3);
      ctx.fillRect(1 - step, 6, 5, 3);
      orect(ctx, -7, -6, 14, 12, '#8a5a2b'); // the barrel
      ctx.fillStyle = '#6f4626'; // staves
      ctx.fillRect(-3, -5, 1, 10);
      ctx.fillRect(2, -5, 1, 10);
      ctx.fillStyle = '#c9a227'; // hoops
      ctx.fillRect(-7, -3, 14, 1);
      ctx.fillRect(-7, 3, 14, 1);
      ctx.fillStyle = OUT; // face hole
      ctx.fillRect(-2, -2, 7, 5);
      ctx.fillStyle = '#f2b98a';
      ctx.fillRect(-1, -1, 5, 3);
      ctx.fillStyle = OUT;
      ctx.fillRect(2, 0, 1.5, 1.5); // eye at the hole
      ctx.fillStyle = '#3a2a1e'; // TELL: hair escaping under the lid
      ctx.fillRect(-3, -8, 5, 2);
      ctx.save(); // the lid, ajar
      ctx.translate(0, -7);
      ctx.rotate(-0.25);
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 2.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#6f4626';
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    },
  },

  pollster: {
    // Estrada's agent: beret + script-taped shell — TELL: shell zipper.
    meadow: (ctx, e) => {
      turtleBase(ctx, e, '#3d8f3d');
      ctx.fillStyle = '#f5f0e6'; // script pages taped over the shell
      ctx.fillRect(-4, -4, 4, 5);
      ctx.fillRect(0, -2, 4, 5);
      ctx.fillStyle = '#b8b2a6';
      ctx.fillRect(-3, -3, 2, 1);
      ctx.fillRect(-3, -1, 2, 1);
      ctx.fillRect(1, -1, 2, 1);
      ctx.fillRect(1, 1, 2, 1);
      ctx.fillStyle = '#2a2433'; // beret, artistic tilt
      ctx.beginPath();
      ctx.ellipse(6, -7, 5, 2.2, -0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      tellZipper(ctx, -7, -3, 5);
    },
    // Campaign volunteer, the red cap — TELL: HELLO badge on the shell.
    sewer: (ctx, e) => {
      turtleBase(ctx, e, '#3d8f3d');
      orect(ctx, 2, -10, 10, 5, '#d8382a'); // the cap
      txt(ctx, 'MKGA', 7, -7.5, 3, '#ffffff');
      tellTag(ctx, -7, -3, 10, 'VOL.3');
    },
    // Croupier turtle: bow tie + card-back shell — TELL: human shoes.
    casino: (ctx, e) => {
      const step = walkStep(e, 9);
      tellShoes(ctx, step, 6);
      disc(ctx, -1, 0, 6.5, '#2a4fd8', OUT); // card-back shell
      ctx.strokeStyle = '#f2f2f2'; // filigree border
      ctx.lineWidth = 1;
      ctx.strokeRect(-4, -3, 6, 6);
      ctx.strokeRect(-2.5, -1.5, 3, 3);
      orect(ctx, 3, -6, 8, 8, '#7dc86f'); // head
      ctx.fillStyle = OUT;
      ctx.fillRect(8, -4, 2, 2); // eye
      tri(ctx, 4, -1, 4, 3, 1, 1, OUT); // bow tie
      tri(ctx, 4, -1, 4, 3, 7, 1, OUT);
      disc(ctx, 4, 1, 1, '#c22e2e');
    },
    // Son #01 in the jersey shell — TELL: hood ajar, the family chin out.
    castle: (ctx, e) => {
      const step = walkStep(e, 9);
      ctx.fillStyle = '#2a5f2a';
      ctx.fillRect(-5 + step, 5, 4, 3);
      ctx.fillRect(1 - step, 5, 4, 3);
      disc(ctx, -1, 0, 6.5, '#2fae5c', OUT); // jersey shell
      ctx.fillStyle = '#ffd34e';
      ctx.fillRect(-5, -2, 9, 4);
      txt(ctx, '01', -0.5, 0, 4, '#2a4fd8');
      orect(ctx, 3, -6, 8, 8, '#7dc86f'); // turtle hood…
      ctx.fillStyle = '#f2b98a'; // TELL: …riding up a very human chin
      ctx.fillRect(6, 1, 6, 3);
      ctx.fillStyle = OUT;
      ctx.fillRect(3, 0, 8, 1); // hood seam
      ctx.fillStyle = '#f2c14e'; // mini aviators, like dad
      ctx.fillRect(4, -4, 8, 1);
      ctx.fillStyle = '#2a2f3d';
      ctx.fillRect(5, -4, 3, 3);
      ctx.fillRect(9, -4, 3, 3);
    },
  },

  lawyer: {
    // Piranha-parody FIRST; the makeup artist — TELL: powder-puff in the
    // jaws, a beauty mark on the lip, tiny artistic beret.
    meadow: (ctx, e) => {
      const { cy, open, out } = plantChassis(ctx, e, PLANT_LOOK.meadow);
      if (!out) return;
      if (open) {
        disc(ctx, 2, cy + 3.6, 2.2, '#ff9bb0', OUT); // the puff at the bottom lip
        disc(ctx, 1.3, cy + 3, 0.7, '#ffc4d4');
        disc(ctx, 2.9, cy + 4.2, 0.7, '#ffc4d4');
      }
      disc(ctx, 7.6, cy + 5.6, 1, OUT); // beauty mark on the lip
      ctx.save(); // the beret, artistic tilt
      ctx.translate(-3, cy - 8);
      ctx.rotate(-0.15);
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 2.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#2a2433';
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = OUT;
      ctx.fillRect(-0.5, -3.2, 1.2, 2); // beret nub
      ctx.restore();
    },
    // THE lawyer — TELL: a little tie knotted on the stem; barks OBJECTION!
    sewer: (ctx, e) => {
      const { cy, open, out } = plantChassis(ctx, e, PLANT_LOOK.sewer);
      if (!out) return;
      ctx.fillStyle = '#c22e2e';
      ctx.fillRect(-2, cy + 8, 4, 2.5); // the knot
      tri(ctx, -2.6, cy + 10.5, 2.6, cy + 10.5, 0, cy + 18, '#c22e2e', OUT);
      if (open) txt(ctx, 'OBJECTION!', 0, cy - 15, 4, '#c22e2e');
    },
    // The waitress plant — TELL: bow tie + a served subpoena on a tray leaf.
    casino: (ctx, e) => {
      const { cy, out } = plantChassis(ctx, e, PLANT_LOOK.casino);
      if (!out) return;
      tri(ctx, -0.8, cy + 9, -4.6, cy + 7, -4.6, cy + 11, '#c22e2e', OUT); // bow
      tri(ctx, 0.8, cy + 9, 4.6, cy + 7, 4.6, cy + 11, '#c22e2e', OUT);
      disc(ctx, 0, cy + 9, 1.4, '#7a1f1f');
      disc(ctx, -12, cy + 12, 4.4, '#c9ccd8', OUT); // tray held by the leaf
      ctx.fillStyle = '#f5f0e6'; // the subpoena, served chilled
      ctx.fillRect(-14.4, cy + 6, 5, 5.5);
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 1;
      ctx.strokeRect(-14.4, cy + 6, 5, 5.5);
      disc(ctx, -11.8, cy + 8.6, 1, '#c22e2e'); // wax seal
    },
    // The general plant — TELL: starred beret + medal pips on the stem.
    castle: (ctx, e) => {
      const { cy, out } = plantChassis(ctx, e, PLANT_LOOK.castle);
      if (!out) return;
      ctx.save();
      ctx.translate(-2.5, cy - 8);
      ctx.rotate(-0.12);
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.5, 2.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3a5a2a';
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#c22e2e';
      ctx.fillRect(-1, -1.2, 2, 1.8); // star pin
      ctx.restore();
      disc(ctx, -1.6, cy + 14, 1.3, '#ffd34e', OUT); // medal pips
      disc(ctx, 1.6, cy + 17.5, 1.3, '#c9ccd8', OUT);
    },
  },

  paparazzo: {
    // The DOP's film camera — TELL: it hangs from a very visible wire.
    meadow: (ctx, e) => {
      ctx.strokeStyle = '#c9ccd8'; // the wire (before the sway, stays taut)
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(0, -12);
      ctx.stroke();
      ctx.save();
      ctx.rotate(Math.sin(e.animT / 16) * 0.08); // lazy sway on the rig
      disc(ctx, -4, -9, 4, '#2a2f3d', OUT); // film reels
      disc(ctx, 3, -9, 4, '#2a2f3d', OUT);
      disc(ctx, -4, -9, 1.2, '#565a68');
      disc(ctx, 3, -9, 1.2, '#565a68');
      orect(ctx, -8, -6, 16, 11, '#3a3f4d'); // camera body
      disc(ctx, 6, 0, 3.5, '#2a2f3d', OUT); // lens
      disc(ctx, 6, 0, 1.5, '#3fa9ff');
      disc(ctx, -5, -3, 1.2, '#c22e2e'); // REC lamp
      ctx.restore();
    },
    // Surveillance drone in a bird costume: cardboard beak, googly eye —
    // TELL: craft feathers gaffer-taped on at angles no wing ever grew,
    // one moulting off mid-hover. Nobody writes "bird" on a drone; the
    // AUTHORSHIP RULE says the feathers do the pleading (physically).
    sewer: (ctx, e) => {
      droneRotors(ctx, e);
      orect(ctx, -8, -5, 16, 10, '#565a68');
      tri(ctx, 9, -3, 9, 3, 15, 0, '#e0aa2f', OUT); // cardboard beak
      ctx.fillStyle = '#b8b2a6'; // the tape holding it on
      ctx.fillRect(6, -3, 3, 6);
      disc(ctx, 2, -1, 2.5, '#ffffff', OUT); // googly eye
      disc(ctx, 2.7, -0.4, 1, OUT);
      // TELL: two craft feathers taped where a wing vaguely goes — static
      // (taped things do not flap), fanned like the casino wings' cheap kin
      ctx.save();
      ctx.translate(-5, -3);
      ctx.rotate(-0.55);
      tri(ctx, 0, 0, -11, -5, -3, 3, '#e0aa2f', OUT);
      ctx.restore();
      ctx.save();
      ctx.translate(-3, -2);
      ctx.rotate(0.05);
      tri(ctx, 0, 0, -9, -4, -2, 3, '#c9932e', OUT);
      ctx.restore();
      ctx.fillStyle = '#b8b2a6'; // the tape pinning the quills
      ctx.fillRect(-7, -4.5, 5, 2.5);
      // one feather mid-moult, swinging on a curl of tape
      ctx.save();
      ctx.translate(-2, 5);
      ctx.rotate(Math.sin(e.animT / 9) * 0.35);
      ctx.fillStyle = '#b8b2a6';
      ctx.fillRect(-1, 0, 2, 3); // the strip, barely holding
      tri(ctx, -3, 11, 3, 11, 0, 3, '#e0aa2f', OUT);
      ctx.restore();
    },
    // Winged security camera — TELL: cardboard wings, gaffer-taped on.
    casino: (ctx, e) => {
      const flap = Math.sin(e.animT / 4) * 0.5;
      ctx.save();
      ctx.translate(-5, -4);
      ctx.rotate(-0.4 - flap);
      tri(ctx, 0, 0, -10, -5, -3, 3, '#e0aa2f', OUT);
      ctx.restore();
      ctx.save();
      ctx.translate(-2, -5);
      ctx.rotate(0.2 + flap * 0.6);
      tri(ctx, 0, 0, -9, -7, -2, 2, '#c9932e', OUT);
      ctx.restore();
      orect(ctx, -8, -4, 14, 8, '#f2f2f2'); // CCTV wedge
      ctx.fillStyle = '#2a2f3d';
      ctx.fillRect(3, -3, 4, 6); // lens face
      disc(ctx, 5, 2, 1, '#c22e2e'); // REC dot
      ctx.fillStyle = '#b8b2a6'; // TELL: the tape crosses
      ctx.fillRect(-6, -6, 5, 2);
      ctx.fillRect(-4.5, -7.5, 2, 5);
    },
    // Military drone in a beret — TELL: regulation HELLO tag.
    castle: (ctx, e) => {
      droneRotors(ctx, e);
      orect(ctx, -8, -5, 16, 10, '#4a5232'); // camo hull
      ctx.fillStyle = '#6f4626'; // camo blotches
      ctx.fillRect(-5, -3, 4, 3);
      ctx.fillRect(2, 1, 4, 3);
      disc(ctx, 6, 0, 3, '#2a2f3d', OUT); // lens
      disc(ctx, 6, 0, 1.2, '#3fa9ff');
      ctx.fillStyle = '#3a5a2a'; // beret wedged between the rotors
      ctx.beginPath();
      ctx.ellipse(-1, -7, 5, 2, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#c22e2e';
      ctx.fillRect(-2, -8, 2, 1.5); // star pin
      tellTag(ctx, -6, 6, 11, 'SGT.');
    },
  },

  rat: {
    // The intern in the rat suit — TELL: box-fresh white sneakers.
    meadow: (ctx, e) => {
      ratBody(ctx, e, '#8d8d99');
      const step = walkStep(e, 4);
      ctx.fillStyle = '#f5f0e6';
      ctx.fillRect(-5 + step, 4, 4, 2);
      ctx.fillRect(1 - step, 4, 4, 2);
      ctx.fillStyle = '#c22e2e'; // swoosh-adjacent stripe
      ctx.fillRect(-4 + step, 5, 2, 1);
      ctx.fillRect(2 - step, 5, 2, 1);
    },
    // The accountant rat, green eyeshade — TELL: zipper along the back.
    sewer: (ctx, e) => {
      ratBody(ctx, e, '#8d8d99');
      ratFeet(ctx, e);
      ctx.fillStyle = '#2fae5c'; // visor band
      ctx.fillRect(3, -4, 5, 1);
      ctx.fillStyle = 'rgba(125,220,79,0.7)'; // the green eyeshade
      ctx.fillRect(3, -3, 5, 2);
      tellZipper(ctx, -4, -2, 4);
    },
    // The card counter — TELL: a very human shirt cuff palms the ace.
    casino: (ctx, e) => {
      ratBody(ctx, e, '#6d6d7a');
      ratFeet(ctx, e);
      ctx.fillStyle = '#f5f0e6'; // the palmed ace
      ctx.fillRect(6, -8, 5, 6);
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 1;
      ctx.strokeRect(6, -8, 5, 6);
      txt(ctx, 'A', 8.5, -5, 4, '#c22e2e');
      ctx.fillStyle = '#f5f0e6'; // TELL: cuff + cufflink
      ctx.fillRect(4, -3, 3, 2);
      disc(ctx, 5.5, -2, 0.8, '#ffd34e');
    },
    // Not a costume: a real capybara. Completely unbothered.
    castle: (ctx, e) => {
      ctx.beginPath();
      ctx.ellipse(-1, 0, 8, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#a1793f';
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      orect(ctx, 3, -5, 8, 7, '#a1793f'); // stoic brick of a head
      ctx.fillStyle = '#8a6532';
      ctx.fillRect(8, -1, 3, 3); // square snout
      disc(ctx, 5, -5, 1.5, '#a1793f', OUT); // little round ear
      ctx.fillStyle = OUT;
      ctx.fillRect(6, -3, 2, 1); // eye: closed. zen.
      const step = walkStep(e, 8); // ambling, even at rat speed
      ctx.fillStyle = '#6f4626';
      ctx.fillRect(-5 + step, 4, 3, 2);
      ctx.fillRect(2 - step, 4, 3, 2);
      disc(ctx, -2, -7, 2, '#ffd34e', OUT); // its emotional-support bird
      tri(ctx, 0, -7.5, 0, -6.5, 2, -7, '#e0aa2f');
    },
  },

  chipstack: {
    // Stack of film cans — TELL: the props tape is still labeled.
    meadow: (ctx, e) => {
      ctx.rotate(Math.sin(e.animT / 7) * 0.12);
      for (let i = 0; i < 4; i++) {
        orect(ctx, -8, 4 - i * 5, 16, 5, '#8a8d99');
        ctx.fillStyle = '#6b6e78';
        ctx.fillRect(-6, 6 - i * 5, 12, 1);
      }
      ctx.fillStyle = '#f5f0e6'; // TELL
      ctx.fillRect(-6, -3, 12, 4);
      txt(ctx, 'TAKE 3', 0, -1, 3, OUT);
      stackEyes(ctx, e, -13);
    },
    // Stack of coin rolls, fresh from the laundering — TELL: bank band.
    sewer: (ctx, e) => {
      ctx.rotate(Math.sin(e.animT / 7) * 0.12);
      for (let i = 0; i < 4; i++) {
        orect(ctx, -8, 4 - i * 5, 16, 5, '#e6d9a8');
        ctx.fillStyle = '#ffd34e'; // coin ends peeking out
        ctx.fillRect(-8, 5 - i * 5, 2, 3);
        ctx.fillRect(6, 5 - i * 5, 2, 3);
      }
      ctx.fillStyle = '#f5f0e6'; // TELL
      ctx.fillRect(-6, -3, 12, 4);
      txt(ctx, '$10K', 0, -1, 3, '#c22e2e');
      stackEyes(ctx, e, -13);
    },
    // Poker chips (home turf) — TELL: HELLO tag; his name is Chip.
    casino: (ctx, e) => {
      ctx.rotate(Math.sin(e.animT / 7) * 0.12);
      const cols = ['#d84343', '#f2f2f2', '#3f6fd8', '#2fae5c'];
      for (let i = 0; i < 4; i++) {
        orect(ctx, -8, 4 - i * 5, 16, 5, cols[i]!);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(-6, 6 - i * 5, 2, 1);
        ctx.fillRect(4, 6 - i * 5, 2, 1);
      }
      tellTag(ctx, 2, -2, 12, 'CHIP');
      stackEyes(ctx, e, -13);
    },
    // Stack of ballot boxes — TELL: patched with duct tape, obviously.
    castle: (ctx, e) => {
      ctx.rotate(Math.sin(e.animT / 7) * 0.12);
      for (let i = 0; i < 2; i++) {
        const top = -i * 9;
        orect(ctx, -8, top, 16, 9, '#e8e8ee');
        ctx.fillStyle = OUT;
        ctx.fillRect(-4, top + 2, 8, 2); // slot
        txt(ctx, 'VOTE', 0, top + 6.5, 3.5, '#2a4fd8');
      }
      ctx.fillStyle = '#b8b2a6'; // TELL: duct-tape X
      ctx.save();
      ctx.translate(5, 6);
      ctx.rotate(0.5);
      ctx.fillRect(-4, -1, 8, 2);
      ctx.rotate(-1);
      ctx.fillRect(-4, -1, 8, 2);
      ctx.restore();
      stackEyes(ctx, e, -11);
    },
  },

  gavel: {
    // The boom mic, dipping into frame again — TELL: it IS studio gear.
    meadow: (ctx, e) => {
      slamBlur(ctx, e);
      ctx.fillStyle = OUT; // boom pole from above
      ctx.fillRect(-2, -30, 4, 16);
      ctx.fillStyle = '#b8b2a6'; // gaffer-tape wrap
      ctx.fillRect(-2.5, -24, 5, 3);
      ctx.beginPath(); // fuzzy windscreen
      ctx.ellipse(0, -3, 11, 9, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#6b6e78';
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#565a68'; // fuzz
      for (const [fx, fy] of [[-6, -6], [-2, 0], [3, -5], [6, -1], [-7, -1], [1, -8]] as const) {
        ctx.fillRect(fx, fy, 2, 2);
      }
    },
    // An actual judge's gavel — TELL: the rental sticker.
    sewer: (ctx, e) => {
      slamBlur(ctx, e);
      ctx.fillStyle = '#6f4626';
      ctx.fillRect(-2, -18, 4, 12); // handle
      orect(ctx, -11, -8, 22, 15, '#8a5a2b'); // head
      ctx.fillStyle = '#5e3a1c';
      ctx.fillRect(-11, -8, 3, 15);
      ctx.fillRect(8, -8, 3, 15);
      ctx.fillStyle = '#ffd34e';
      ctx.fillRect(-1, -6, 2, 11); // gold inlay
      ctx.fillStyle = '#f5f0e6'; // TELL
      ctx.fillRect(-8, 1, 12, 4);
      txt(ctx, 'RENTED', -2, 3, 3, '#c22e2e');
    },
    // The giant slot-machine lever — TELL: price sticker still on.
    casino: (ctx, e) => {
      slamBlur(ctx, e);
      ctx.fillStyle = '#c9ccd8'; // chrome shaft
      ctx.fillRect(-2, -28, 4, 24);
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(-1, -28, 1, 24); // shine
      disc(ctx, 0, 0, 6, '#d84343', OUT); // the big red knob
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-3, -3, 3, 2); // glint
      ctx.fillStyle = '#f5f0e6'; // TELL
      ctx.fillRect(1, 2, 9, 5);
      txt(ctx, '$9.99', 5.5, 4.5, 3, OUT);
    },
    // The giant army boot — TELL: 'SIZE 98' stenciled on the toe.
    castle: (ctx, e) => {
      slamBlur(ctx, e);
      orect(ctx, -8, -26, 14, 19, '#4a5232'); // shaft
      ctx.strokeStyle = OUT; // laces
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        ctx.moveTo(-6, -23 + i * 5);
        ctx.lineTo(4, -20 + i * 5);
        ctx.moveTo(4, -23 + i * 5);
        ctx.lineTo(-6, -20 + i * 5);
      }
      ctx.stroke();
      orect(ctx, -8, -7, 19, 9, '#3f4531'); // foot, toe forward
      ctx.fillStyle = OUT; // lugged sole
      ctx.fillRect(-9, 1, 21, 4);
      ctx.fillStyle = '#565a68';
      for (let i = 0; i < 5; i++) ctx.fillRect(-8 + i * 4, 2, 2, 2);
      txt(ctx, 'SIZE 98', 1, -3, 3, '#c9a227');
    },
  },
};

/** Which disguises face their walk direction (canvas flip before the skin). */
const SKIN_FACES: Record<EnemyKind, boolean> = {
  lobbyist: true,
  pollster: true,
  lawyer: false,
  paparazzo: true,
  rat: true,
  chipstack: false,
  gavel: false,
};

/** EDraw adapter: flips for facing where the kind walks, then paints the
 *  theme's disguise. Theme dispatch is a Record — an unknown theme is a
 *  compile error, never a fallback. */
function disguise(kind: EnemyKind): EDraw {
  return (ctx, e, frame, level) => {
    if (SKIN_FACES[kind]) ctx.scale(e.facing, 1);
    ENEMY_SKIN[kind][level.def.theme](ctx, e, frame);
  };
}

const ENTITY_DRAW: Record<EntityKind, EDraw> = {
  // The seven enemy kinds wear per-world entourage disguises (table above).
  lobbyist: disguise('lobbyist'),
  pollster: disguise('pollster'),
  lawyer: disguise('lawyer'),
  paparazzo: disguise('paparazzo'),
  rat: disguise('rat'),
  chipstack: disguise('chipstack'),
  gavel: disguise('gavel'),

  pen: (ctx, e) => {
    ctx.rotate(e.animT * 0.35 * e.facing);
    orect(ctx, -7, -2, 14, 4, '#f2c14e');
    tri(ctx, 7, -2, 7, 2, 10, 0, '#8a6a1e');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-5, -1, 3, 2);
  },

  shell: (ctx, e) => {
    // a kicked ballot box: democracy in motion
    if (Math.abs(e.vx) > 0.5) ctx.rotate(Math.sin(e.animT) * 0.12);
    orect(ctx, -7, -6, 14, 12, '#e8e8ee');
    ctx.fillStyle = OUT;
    ctx.fillRect(-4, -4, 8, 2); // slot
    txt(ctx, 'VOTE', 0, 2, 4, '#2a4fd8');
  },

  powerup: (ctx, e, frame) => {
    const kind = e.powerup;
    if (kind === undefined) throw new Error('painter: powerup entity without a powerup kind');
    POWERUP_DRAW[kind](ctx, e, frame);
  },

  coin: (ctx, e) => {
    const ph = [1, 0.55, 0.15, 0.55][Math.floor(e.animT / 7) % 4]!;
    const hw = 5 * ph;
    ctx.beginPath();
    ctx.ellipse(0, 0, hw + 1, 6.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#c9931f';
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, hw, 5.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd34e';
    ctx.fill();
    if (ph === 1) {
      ctx.fillStyle = '#c9931f';
      ctx.fillRect(-1, -3, 2, 6);
    }
  },

  goldbar: (ctx, e, frame) => {
    ctx.beginPath();
    ctx.moveTo(-9, 5);
    ctx.lineTo(-6, -4);
    ctx.lineTo(6, -4);
    ctx.lineTo(9, 5);
    ctx.closePath();
    ctx.fillStyle = '#f2c14e';
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffe08a';
    ctx.fillRect(-5, -3, 10, 2);
    txt(ctx, '$', 0, 1, 7, '#8a6a1e');
    if ((frame + Math.floor(e.x)) % 50 < 8) sparkle(ctx, 6, -5);
  },

  secret: (ctx, e, frame) => {
    const glow = 0.25 + 0.2 * Math.sin(frame / 9 + e.x * 0.1);
    ctx.strokeStyle = `rgba(255,220,120,${glow.toFixed(3)})`;
    ctx.lineWidth = 4;
    ctx.strokeRect(-10, -8, 20, 16);
    orect(ctx, -8, -6, 16, 12, '#e0c37a');
    ctx.fillStyle = '#cbae60';
    ctx.fillRect(-8, -6, 7, 3); // folder tab
    txt(ctx, 'TOP', 0, -2, 4, '#c22e2e');
    txt(ctx, 'SECRET', 0, 3, 4, '#c22e2e');
  },

  spring: (ctx, e, _frame, level) => {
    const p = level.player;
    const near = Math.abs(p.x - e.x) < 14 && p.y < e.y && e.y - p.y < 44;
    const h = near ? 7 : 13; // pre-compressed when someone's about to board
    const topY = 8 - h;
    ctx.strokeStyle = '#d84343';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 1; i <= 3; i++) {
      const yy = 8 - (h * i) / 4;
      ctx.moveTo(-5, yy);
      ctx.lineTo(5, yy);
    }
    ctx.stroke();
    orect(ctx, -7, topY - 4, 14, 4, '#f2f2f2');
    ctx.fillStyle = '#d84343';
    ctx.fillRect(-6, topY - 3, 5, 2);
    orect(ctx, -6, 6, 12, 3, '#8a8d99');
  },

  checkpoint: (ctx, e, frame) => {
    // claimed flags fly the notary's pennant. Field probe: the entity module
    // exposes `claimed` informally — an accepted seam, noted in the report.
    const claimed = (e as unknown as { claimed?: unknown }).claimed === true;
    orect(ctx, -1, -14, 3, 26, '#a9adba'); // pole
    disc(ctx, 0.5, -15, 2.5, claimed ? '#2fae5c' : '#8a8d99', OUT);
    if (claimed) {
      const wave = Math.sin(frame / 5) * 1.5;
      ctx.beginPath();
      ctx.moveTo(2, -14);
      ctx.lineTo(26, -11 + wave);
      ctx.lineTo(2, -7);
      ctx.closePath();
      ctx.fillStyle = '#2fae5c';
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.stroke();
      txt(ctx, 'CERTIFIED', 12, -10.5 + wave / 2, 3, '#ffffff');
    } else {
      orect(ctx, 2, -13, 5, 8, '#8a8d99'); // furled, awaiting the stamp
    }
    orect(ctx, -4, 10, 10, 4, '#6f6555'); // base
  },
};

export function drawEntities(ctx: Ctx, level: LevelLike, cam: CameraState, frame: number): void {
  const cx = snap(cam.x);
  const cy = snap(cam.y);
  for (const e of level.entities) {
    if (!e.alive) continue;
    const sx = snap(e.x) - cx;
    const sy = snap(e.y) - cy;
    if (sx < -CULL || sx > VIEW_W + CULL || sy < -CULL || sy > VIEW_H + CULL) continue;
    const fn = ENTITY_DRAW[e.kind] as EDraw | undefined;
    if (fn === undefined) throw new Error(`painter: no draw for entity kind '${String(e.kind)}'`);
    ctx.save();
    ctx.translate(sx, sy);
    if (e.dyingT > 0) {
      // squash-and-fade death: flattened like a bad alibi
      ctx.globalAlpha = Math.max(0.2, Math.min(1, e.dyingT / 20));
      ctx.translate(0, 8);
      ctx.scale(1.2, 0.4);
      ctx.translate(0, -8);
    }
    fn(ctx, e, frame, level);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Player — SUPER MARIO ESTRADA, the hero the kingdom paid for (literally).
//
// CARICATURE FIRST: the in-level sprite is the cutscene Estrada shrunk to
// chibi (big head ~55% of the height — recognizability lives in the head).
// The VISUAL exceeds the FROZEN hitbox (classic practice): feet stay anchored
// at the box bottom, centered on x. Identity kit at EVERY size: red cap with
// the white 'E' disc + brim toward facing, pencil moustache, smug half-lid
// eye, big nose, slicked sideburn, red shirt sleeves, blue bib with gold
// buttons, white gloves, brown shoes, notary stamp at the belt.
// Palette sampled from the cutscene cast (cutsceneArt.ts P.*) so one glance
// links him to the story. The 2px ink outline is a silhouette stamp: the
// whole body is drawn 8x in ink at 1-2px offsets, then once in color.
// ---------------------------------------------------------------------------

interface EstradaPal {
  cap: string;
  capDark: string;
  shirt: string;
  shirtDark: string;
  bib: string;
  bibDark: string;
  glove: string;
  shoe: string;
  button: string;
  /** The letter on the white cap disc. */
  discE: string;
}

// Shared caricature tones (cutsceneArt.ts: P.skin / INK-adjacent hair).
const E_SKIN = '#f2c090';
const E_SKIN_DK = '#d99e66';
const E_NOSE = '#e8a96e';
const E_HAIR = '#33221a';
const E_TASH = '#241812';
const E_STAMP = '#7a2020';

const PLAYER_PAL: Record<PlayerSize, EstradaPal> = {
  small: {
    cap: '#d8302f', capDark: '#a32222',
    shirt: '#d8302f', shirtDark: '#a32222',
    bib: '#2b4fa8', bibDark: '#1e3a7d',
    glove: '#f4f0e6', shoe: '#6b3d1e',
    button: '#f6c94b', discE: '#d8302f',
  },
  certified: {
    cap: '#d8302f', capDark: '#a32222',
    shirt: '#d8302f', shirtDark: '#a32222',
    bib: '#2b4fa8', bibDark: '#1e3a7d',
    glove: '#f4f0e6', shoe: '#6b3d1e',
    button: '#f6c94b', discE: '#d8302f',
  },
  goldpen: {
    // white-and-gold palette swap: the outfit of a man with nothing to hide.
    // The cap stays RED — the cap IS the identity.
    cap: '#d8302f', capDark: '#a32222',
    shirt: '#f4f0e6', shirtDark: '#cfc4ab',
    bib: '#e0aa2f', bibDark: '#a87c1e',
    glove: '#ffffff', shoe: '#8a6a1e',
    button: '#d8302f', discE: '#d8302f',
  },
};

type PoseKind = 'idle' | 'walk' | 'skid' | 'jump' | 'fall' | 'duck' | 'dead';

interface Pose {
  kind: PoseKind;
  /** Front-leg spread offset in px (-2..2); back leg mirrors it. */
  leg: number;
  /** Arm-swing offset in px (front arm counter-swings the front leg). */
  arm: number;
  /** Idle breathe: 0|1, the head group settles 1px on the exhale. */
  breathe: number;
}

/** Ink-overridable fill helpers: the silhouette pass paints every shape OUT. */
function inkable(ctx: Ctx, ink: boolean): {
  R: (x: number, y: number, w: number, h: number, c: string) => void;
  D: (x: number, y: number, r: number, c: string) => void;
} {
  return {
    R: (x, y, w, h, c) => {
      ctx.fillStyle = ink ? OUT : c;
      ctx.fillRect(x, y, w, h);
    },
    D: (x, y, r, c) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = ink ? OUT : c;
      ctx.fill();
    },
  };
}

/** Hand-pixeled 'E' (crisper than font glyphs at this scale). */
function markE(ctx: Ctx, ink: boolean, x: number, y: number, s: number, c: string): void {
  if (ink) return; // the disc itself already carries the silhouette
  ctx.fillStyle = c;
  ctx.fillRect(x - 2.0 * s, y - 2.6 * s, 1.4 * s, 5.2 * s); // spine
  ctx.fillRect(x - 2.0 * s, y - 2.6 * s, 4.0 * s, 1.2 * s); // top bar
  ctx.fillRect(x - 2.0 * s, y - 0.6 * s, 3.2 * s, 1.2 * s); // mid bar
  ctx.fillRect(x - 2.0 * s, y + 1.4 * s, 4.0 * s, 1.2 * s); // bottom bar
}

/** KO'd X-eye (ink-colored either way, so no override needed). */
function xEye(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.stroke();
}

/** Small Estrada, facing +x, feet at y=0. ~20px tall, head+cap ~55% of it. */
function estradaSmall(ctx: Ctx, pal: EstradaPal, pose: Pose, ink: boolean): void {
  const { R, D } = inkable(ctx, ink);
  const air = pose.kind === 'jump' || pose.kind === 'fall';
  const out = pose.kind === 'fall' || pose.kind === 'skid'; // arms out for balance
  const u = pose.breathe; // head settles 1px on the exhale

  // back arm (behind the torso)
  if (pose.kind === 'jump') {
    R(-8.5, -17, 2.5, 6, pal.shirtDark);
    D(-7.2, -18, 1.9, pal.glove);
  } else if (out) {
    R(-9, -8.5, 3.5, 2.5, pal.shirtDark);
    D(-9.2, -7.2, 1.9, pal.glove);
  } else {
    R(-7, -8 + pose.arm, 2.5, 4, pal.shirtDark);
    D(-5.8, -3.5 + pose.arm, 1.8, pal.glove);
  }

  // torso: blue bib (shirt shows on the sleeves), gold buttons, belt stamp
  R(-5, -7, 10, 5, pal.bib);
  R(-5, -7, 2, 5, pal.bibDark); // shade away from facing
  R(-3, -6.2, 1.6, 1.6, pal.button);
  R(1.4, -6.2, 1.6, 1.6, pal.button);
  R(-7, -7.5, 2, 3, E_STAMP); // notary stamp at the back hip, always
  R(-7, -7.5, 2, 0.9, pal.glove);

  // legs / shoes
  if (pose.kind === 'jump') {
    R(-4.5, -4, 4.5, 2.5, pal.shoe); // tucked
    R(0.5, -4, 4.5, 2.5, pal.shoe);
  } else if (pose.kind === 'fall') {
    R(-5.5, -3, 4.5, 2.5, pal.shoe); // dangling
    R(1.5, -2.5, 4.5, 2.5, pal.shoe);
  } else {
    R(-6.5 - pose.leg, -2, 5.5, 2, pal.shoe);
    R(1 + pose.leg, -2, 5.5, 2, pal.shoe);
  }

  // head — THE caricature: most of the sprite
  R(-7, -15 + u, 14, 8, E_SKIN);
  R(-7, -15 + u, 2, 8, E_SKIN_DK); // shade
  R(-7, -15 + u, 2, 5, E_HAIR); // slicked sideburn…
  R(-7, -11 + u, 3.5, 1.2, E_HAIR); // …with its forward hook
  D(8, -10.5 + u, 2.6, E_NOSE); // the nose, entering the room first
  R(2.5, -8.4 + u, 6, 1.6, E_TASH); // pencil moustache
  R(8, -9.3 + u, 1.3, 1.2, E_TASH); // dapper upturn
  // smug half-lid eye: big white, thin lid line, pupil half-hidden under it
  R(1.8, -13.6 + u, 4, 3.2, '#ffffff');
  R(1.8, -13.6 + u, 4, 0.8, OUT); // the lid, at half mast
  R(3.5, -12.8 + u, 1.6, 1.4, OUT); // low pupil peeking from under the lid

  // cap: red crown + white 'E' disc + brim toward facing (skid tips it)
  ctx.save();
  if (pose.kind === 'skid') {
    ctx.translate(0.8, -16 + u);
    ctx.rotate(0.2);
    ctx.translate(0, 16 - u);
  }
  R(-7.5, -19 + u, 15, 4.5, pal.cap);
  R(-7.5, -19 + u, 3, 4.5, pal.capDark);
  R(3, -16 + u, 7.5, 2, pal.cap); // brim
  R(3, -14.4 + u, 7.5, 0.8, pal.capDark); // brim underside
  D(0.5, -17.3 + u, 3.6, '#ffffff');
  markE(ctx, ink, 0.5, -17.3 + u, 1.0, pal.discE);
  ctx.restore();

  // front arm (over everything: the glove must read)
  if (pose.kind === 'jump') {
    R(6, -17, 2.5, 6, pal.shirt);
    D(7.3, -18, 1.9, pal.glove);
  } else if (out) {
    R(6, -8.5, 3.5, 2.5, pal.shirt);
    D(9.6, -7.2, 1.9, pal.glove);
  } else {
    R(4.5, -8 - pose.arm, 2.5, 4, pal.shirt);
    D(5.8, -3.5 - pose.arm, 1.8, pal.glove);
  }
  void air;
}

/** Certified/goldpen Estrada, facing +x, feet at y=0. ~30px tall. */
function estradaBig(ctx: Ctx, pal: EstradaPal, pose: Pose, ink: boolean): void {
  const { R, D } = inkable(ctx, ink);
  const out = pose.kind === 'fall' || pose.kind === 'skid';
  const u = pose.breathe;

  // back arm
  if (pose.kind === 'jump') {
    R(-10, -26, 3, 7, pal.shirtDark);
    D(-8.4, -27, 2.2, pal.glove);
  } else if (out) {
    R(-11.5, -14, 4, 3, pal.shirtDark);
    D(-11.8, -12.3, 2.2, pal.glove);
  } else {
    R(-9, -14 + pose.arm, 3, 6.5, pal.shirtDark);
    D(-7.3, -6.5 + pose.arm, 2.1, pal.glove);
  }

  // legs (bib-blue trousers) + shoes
  if (pose.kind === 'jump') {
    R(-5, -6.5, 4, 3, pal.bibDark); // tucked
    R(1, -6.5, 4, 3, pal.bib);
    R(-6, -4.5, 5.5, 2.5, pal.shoe);
    R(1, -4, 5.5, 2.5, pal.shoe);
  } else if (pose.kind === 'fall') {
    R(-5.5, -5.5, 4, 3.5, pal.bibDark); // dangling
    R(2, -5, 4, 3, pal.bib);
    R(-7, -3, 6, 2.5, pal.shoe);
    R(2, -2.5, 6, 2.5, pal.shoe);
  } else {
    R(-5.5 - pose.leg, -5, 4, 3.5, pal.bibDark);
    R(1.5 + pose.leg, -5, 4, 3.5, pal.bib);
    R(-7 - pose.leg, -2.5, 6, 2.5, pal.shoe);
    R(1.5 + pose.leg, -2.5, 6.5, 2.5, pal.shoe);
  }

  // torso: red shirt chest, FULL blue bib + straps, gold buttons, belt stamp
  R(-7, -16, 14, 4, pal.shirt);
  R(-7, -16, 3, 4, pal.shirtDark);
  R(-6, -13, 12, 8.5, pal.bib);
  R(-6, -13, 2.5, 8.5, pal.bibDark);
  R(-5, -15.5, 2, 3, pal.bib); // straps
  R(3, -15.5, 2, 3, pal.bib);
  D(-3.5, -11.5, 1.3, pal.button);
  D(3.5, -11.5, 1.3, pal.button);
  R(-9.5, -10, 3, 4.5, E_STAMP); // the notary stamp, holstered
  R(-9.5, -10, 3, 1.2, pal.glove);

  // head
  R(-8, -24 + u, 16, 9.5, E_SKIN);
  R(-8, -24 + u, 2.5, 9.5, E_SKIN_DK);
  R(-8, -24 + u, 2.5, 6, E_HAIR); // sideburn
  R(-8, -18.6 + u, 4, 1.4, E_HAIR); // forward hook
  D(9, -18.5 + u, 3, E_NOSE);
  R(3, -15.8 + u, 7, 1.8, E_TASH); // pencil moustache
  R(9.5, -16.9 + u, 1.5, 1.3, E_TASH); // upturn
  R(2.3, -21.9 + u, 4.4, 3.7, '#ffffff'); // eye
  R(2.3, -21.9 + u, 4.4, 0.9, OUT); // the lid, at half mast
  R(4.4, -21 + u, 1.8, 1.6, OUT); // low pupil peeking from under the lid

  // cap
  ctx.save();
  if (pose.kind === 'skid') {
    ctx.translate(1, -26 + u);
    ctx.rotate(0.2);
    ctx.translate(0, 26 - u);
  }
  R(-8.5, -29.5 + u, 17, 5.5, pal.cap);
  R(-7, -30.5 + u, 14, 1.5, pal.cap); // crown rounding
  R(-8.5, -29.5 + u, 3.5, 5.5, pal.capDark);
  R(4, -25 + u, 8.5, 2.2, pal.cap); // brim
  R(4, -23.2 + u, 8.5, 0.9, pal.capDark);
  D(0.5, -27 + u, 4.2, '#ffffff');
  markE(ctx, ink, 0.5, -27 + u, 1.15, pal.discE);
  ctx.restore();

  // front arm
  if (pose.kind === 'jump') {
    R(7, -26, 3, 7, pal.shirt);
    D(8.6, -27, 2.2, pal.glove);
  } else if (out) {
    R(7.5, -14, 4, 3, pal.shirt);
    D(11.8, -12.3, 2.2, pal.glove);
  } else {
    R(6, -14 - pose.arm, 3, 6.5, pal.shirt);
    D(7.6, -6.5 - pose.arm, 2.1, pal.glove);
  }
}

/** Big-size duck: a proper squat (cap low, knees out) — no scale smear. */
function estradaDuck(ctx: Ctx, pal: EstradaPal, ink: boolean): void {
  const { R, D } = inkable(ctx, ink);
  // body sliver + shoes
  R(-6, -4.5, 12, 3, pal.bib);
  R(-6, -4.5, 2, 3, pal.bibDark);
  R(-7.5, -2.2, 6, 2.2, pal.shoe);
  R(2, -2.2, 6, 2.2, pal.shoe);
  // head, tucked
  R(-7.5, -11.5, 15, 7, E_SKIN);
  R(-7.5, -11.5, 2, 7, E_SKIN_DK);
  R(-7.5, -11.5, 2, 4.5, E_HAIR);
  R(-7.5, -7.6, 3.5, 1.2, E_HAIR);
  D(8.5, -8, 2.8, E_NOSE);
  R(3, -5.8, 6.5, 1.6, E_TASH);
  R(9, -6.9, 1.4, 1.2, E_TASH);
  R(2.5, -10.3, 3.7, 3, '#ffffff');
  R(2.5, -10.3, 3.7, 0.8, OUT); // half-mast lid
  R(4.1, -9.5, 1.5, 1.3, OUT); // low pupil
  // cap pulled LOW
  R(-8, -16.5, 16, 5, pal.cap);
  R(-6.5, -17.5, 13, 1.5, pal.cap);
  R(-8, -16.5, 3, 5, pal.capDark);
  R(3.5, -12, 8, 2, pal.cap);
  R(3.5, -10.4, 8, 0.8, pal.capDark);
  D(0.5, -14.2, 3.7, '#ffffff');
  markE(ctx, ink, 0.5, -14.2, 1.0, pal.discE);
  // gloves braced at the sides
  D(-8, -2.8, 2, pal.glove);
  D(8.2, -2.8, 2, pal.glove);
}

/** KO'd: faces the CAMERA — X-eyes, arms up, the classic launch pose. */
function estradaDead(ctx: Ctx, pal: EstradaPal, big: boolean, ink: boolean): void {
  const { R, D } = inkable(ctx, ink);
  if (big) {
    R(-8, -2.5, 6, 2.5, pal.shoe); // legs splayed
    R(2, -2.5, 6, 2.5, pal.shoe);
    R(-5.5, -5, 4, 3, pal.bibDark);
    R(1.5, -5, 4, 3, pal.bib);
    R(-7, -16, 14, 4, pal.shirt);
    R(-6, -13, 12, 8.5, pal.bib);
    D(-3.5, -11.5, 1.3, pal.button);
    D(3.5, -11.5, 1.3, pal.button);
    R(-10, -25, 3, 7, pal.shirtDark); // arms thrown up
    R(7, -25, 3, 7, pal.shirt);
    D(-8.5, -26.5, 2.2, pal.glove);
    D(8.5, -26.5, 2.2, pal.glove);
    R(-8, -24, 16, 9.5, E_SKIN);
    R(-8, -24, 2, 6, E_HAIR); // both sideburns: full-face view
    R(6, -24, 2, 6, E_HAIR);
    D(0.5, -19, 3, E_NOSE);
    R(-4, -15.8, 9, 1.5, E_TASH);
    R(-8.5, -29.5, 17, 5.5, pal.cap);
    R(-7, -30.5, 14, 1.5, pal.cap);
    R(-8, -24.6, 16, 1.1, pal.capDark); // brim edge-on
    D(0.5, -27, 4.2, '#ffffff');
    markE(ctx, ink, 0.5, -27, 1.15, pal.discE);
    if (!ink) {
      xEye(ctx, -4, -21, 2.3);
      xEye(ctx, 5, -21, 2.3);
    }
  } else {
    R(-6.5, -2, 5, 2, pal.shoe);
    R(1.5, -2, 5, 2, pal.shoe);
    R(-5, -7, 10, 5, pal.bib);
    R(-3, -6.2, 1.6, 1.6, pal.button);
    R(1.4, -6.2, 1.6, 1.6, pal.button);
    R(-8.5, -16, 2.5, 5.5, pal.shirtDark);
    R(6, -16, 2.5, 5.5, pal.shirt);
    D(-7.2, -17, 1.9, pal.glove);
    D(7.3, -17, 1.9, pal.glove);
    R(-7, -15, 14, 8, E_SKIN);
    R(-7, -15, 1.8, 5, E_HAIR);
    R(5.2, -15, 1.8, 5, E_HAIR);
    D(0.5, -10.5, 2.4, E_NOSE);
    R(-3.5, -8.2, 8, 1.3, E_TASH);
    R(-7.5, -19, 15, 4.5, pal.cap);
    R(-7, -15.4, 14, 1, pal.capDark);
    D(0.5, -17.3, 3.6, '#ffffff');
    markE(ctx, ink, 0.5, -17.3, 1.0, pal.discE);
    if (!ink) {
      xEye(ctx, -3.5, -12.3, 1.9);
      xEye(ctx, 4.5, -12.3, 1.9);
    }
  }
}

function estradaSprite(ctx: Ctx, pal: EstradaPal, big: boolean, pose: Pose, ink: boolean): void {
  if (pose.kind === 'dead') estradaDead(ctx, pal, big, ink);
  else if (pose.kind === 'duck' && big) estradaDuck(ctx, pal, ink);
  else if (big) estradaBig(ctx, pal, pose, ink);
  else estradaSmall(ctx, pal, pose, ink);
}

// ---------------------------------------------------------------------------
// MANGIANI — the honest worker (P1's default; Estrada morphs in on 'swap').
// SAME skeleton, poses and clocks as the Estrada rig; only identity differs:
// GREEN cap with the white 'M' disc, ~2px taller at every size, lankier
// (1px narrower limbs), big honest ROUND eyes (centered pupil + highlight —
// the anti-smug), bigger rounder nose, brown swept fringe + sideburn, NO
// moustache, green shirt sleeves over the darker blue bib, no notary stamp
// (he has nothing to certify). Palette sampled from cast.ts (mangGreen /
// mangDark / mangBlue / mangHair).
// ---------------------------------------------------------------------------

const M_HAIR = '#5a3a1c';
/** Nose highlight dot — the honest shine. */
const M_NOSE_HL = '#ffe8d2';

const MANGIANI_PAL: Record<PlayerSize, EstradaPal> = {
  small: {
    cap: '#2f9e44', capDark: '#1f6f30',
    shirt: '#2f9e44', shirtDark: '#227a35',
    bib: '#24427c', bibDark: '#182f5e',
    glove: '#f4f0e6', shoe: '#6b3d1e',
    button: '#f6c94b', discE: '#1f6f30',
  },
  certified: {
    cap: '#2f9e44', capDark: '#1f6f30',
    shirt: '#2f9e44', shirtDark: '#227a35',
    bib: '#24427c', bibDark: '#182f5e',
    glove: '#f4f0e6', shoe: '#6b3d1e',
    button: '#f6c94b', discE: '#1f6f30',
  },
  goldpen: {
    // white-and-gold swap; the cap stays GREEN — the cap IS the identity.
    cap: '#2f9e44', capDark: '#1f6f30',
    shirt: '#f4f0e6', shirtDark: '#cfc4ab',
    bib: '#e0aa2f', bibDark: '#a87c1e',
    glove: '#ffffff', shoe: '#8a6a1e',
    button: '#2f9e44', discE: '#1f6f30',
  },
};

/** Hand-pixeled 'L' (blocky, reads at disc scale). L for LORENZO Mangiani —
 *  an 'M' on the GREEN cap read as Mario's letter (playtest confusion);
 *  parody initials stay (E = Estrada), but the green brother wears his
 *  canon first-name L. */
function markM(ctx: Ctx, ink: boolean, x: number, y: number, s: number, c: string): void {
  if (ink) return; // the disc itself already carries the silhouette
  ctx.fillStyle = c;
  ctx.fillRect(x - 1.4 * s, y - 2.6 * s, 1.3 * s, 5.2 * s); // vertical stroke
  ctx.fillRect(x - 1.4 * s, y + 1.4 * s, 3.2 * s, 1.2 * s); // the foot
}

/** Small Mangiani, facing +x, feet at y=0. ~22px tall (2 more than Estrada). */
function mangianiSmall(ctx: Ctx, pal: EstradaPal, pose: Pose, ink: boolean): void {
  const { R, D } = inkable(ctx, ink);
  const out = pose.kind === 'fall' || pose.kind === 'skid';
  const u = pose.breathe;

  // back arm (lanky: 2px wide)
  if (pose.kind === 'jump') {
    R(-8.3, -18.5, 2, 6, pal.shirtDark);
    D(-7.3, -19.5, 1.7, pal.glove);
  } else if (out) {
    R(-8.8, -9, 3, 2, pal.shirtDark);
    D(-9, -7.8, 1.7, pal.glove);
  } else {
    R(-6.8, -8.5 + pose.arm, 2, 4.5, pal.shirtDark);
    D(-5.8, -3.6 + pose.arm, 1.6, pal.glove);
  }

  // torso: the darker blue bib, gold buttons — no stamp, nothing to certify
  R(-5, -8, 10, 5.5, pal.bib);
  R(-5, -8, 2, 5.5, pal.bibDark);
  R(-3, -7.2, 1.5, 1.5, pal.button);
  R(1.5, -7.2, 1.5, 1.5, pal.button);

  // legs / shoes
  if (pose.kind === 'jump') {
    R(-4, -4.5, 4, 2.5, pal.shoe); // tucked
    R(0.5, -4.5, 4, 2.5, pal.shoe);
  } else if (pose.kind === 'fall') {
    R(-5, -3.5, 4, 2.5, pal.shoe); // dangling
    R(1.5, -3, 4, 2.5, pal.shoe);
  } else {
    R(-6 - pose.leg, -2.5, 4.5, 2.5, pal.shoe);
    R(1.5 + pose.leg, -2.5, 4.5, 2.5, pal.shoe);
  }

  // head — taller face, honest kit
  R(-7, -17 + u, 14, 9, E_SKIN);
  R(-7, -17 + u, 2, 9, E_SKIN_DK);
  R(-7, -17 + u, 2, 6, M_HAIR); // sideburn
  R(-5, -17 + u, 9, 1.6, M_HAIR); // swept fringe under the cap
  D(7.8, -12 + u, 2.9, E_NOSE); // big round nose
  D(6.6, -13.1 + u, 0.8, M_NOSE_HL);
  D(3.2, -13.6 + u, 2.6, '#ffffff'); // big honest ROUND eye
  D(3.8, -13.3 + u, 1.2, OUT); // centered pupil
  D(2.4, -14.5 + u, 0.7, '#ffffff'); // highlight
  R(1.5, -9.8 + u, 8, 2.5, M_HAIR); // full honest moustache — broad and soft
  R(0.8, -9.2 + u, 1.2, 1.6, M_HAIR); // soft droop, back edge
  R(9.2, -9.2 + u, 1.2, 1.6, M_HAIR); // soft droop, front edge

  // cap: GREEN crown + white 'M' disc + brim toward facing
  ctx.save();
  if (pose.kind === 'skid') {
    ctx.translate(0.8, -18 + u);
    ctx.rotate(0.2);
    ctx.translate(0, 18 - u);
  }
  R(-7.5, -21 + u, 15, 4.5, pal.cap);
  R(-7.5, -21 + u, 3, 4.5, pal.capDark);
  R(3, -18 + u, 7.5, 2, pal.cap); // brim
  R(3, -16.4 + u, 7.5, 0.8, pal.capDark);
  D(0.5, -19.3 + u, 3.6, '#ffffff');
  markM(ctx, ink, 0.5, -19.3 + u, 1.0, pal.discE);
  ctx.restore();

  // front arm
  if (pose.kind === 'jump') {
    R(6.3, -18.5, 2, 6, pal.shirt);
    D(7.3, -19.5, 1.7, pal.glove);
  } else if (out) {
    R(5.8, -9, 3, 2, pal.shirt);
    D(9, -7.8, 1.7, pal.glove);
  } else {
    R(4.8, -8.5 - pose.arm, 2, 4.5, pal.shirt);
    D(5.8, -3.6 - pose.arm, 1.6, pal.glove);
  }
}

/** Certified/goldpen Mangiani, facing +x, feet at y=0. ~32px tall. */
function mangianiBig(ctx: Ctx, pal: EstradaPal, pose: Pose, ink: boolean): void {
  const { R, D } = inkable(ctx, ink);
  const out = pose.kind === 'fall' || pose.kind === 'skid';
  const u = pose.breathe;

  // back arm
  if (pose.kind === 'jump') {
    R(-9.6, -28, 2.5, 7.5, pal.shirtDark);
    D(-8.2, -29, 2, pal.glove);
  } else if (out) {
    R(-11, -15.5, 3.5, 2.5, pal.shirtDark);
    D(-11.2, -14, 2, pal.glove);
  } else {
    R(-8.6, -15.5 + pose.arm, 2.5, 7, pal.shirtDark);
    D(-7.2, -7.5 + pose.arm, 1.9, pal.glove);
  }

  // legs (lanky) + shoes
  if (pose.kind === 'jump') {
    R(-4.8, -7, 3.5, 3, pal.bibDark); // tucked
    R(1.3, -7, 3.5, 3, pal.bib);
    R(-5.5, -5, 5, 2.5, pal.shoe);
    R(1.3, -4.5, 5, 2.5, pal.shoe);
  } else if (pose.kind === 'fall') {
    R(-5.2, -6, 3.5, 3.5, pal.bibDark); // dangling
    R(2.2, -5.5, 3.5, 3, pal.bib);
    R(-6.5, -3, 5.5, 2.5, pal.shoe);
    R(2.2, -2.5, 5.5, 2.5, pal.shoe);
  } else {
    R(-5.2 - pose.leg, -5.5, 3.5, 3.5, pal.bibDark);
    R(1.7 + pose.leg, -5.5, 3.5, 3.5, pal.bib);
    R(-6.5 - pose.leg, -2.5, 5.5, 2.5, pal.shoe);
    R(1.7 + pose.leg, -2.5, 6, 2.5, pal.shoe);
  }

  // torso: green shirt chest, FULL darker-blue bib + straps, gold buttons
  R(-7, -18, 14, 4, pal.shirt);
  R(-7, -18, 3, 4, pal.shirtDark);
  R(-6, -14.5, 12, 9, pal.bib);
  R(-6, -14.5, 2.5, 9, pal.bibDark);
  R(-5, -17.5, 2, 3.5, pal.bib); // straps
  R(3, -17.5, 2, 3.5, pal.bib);
  D(-3.5, -12.8, 1.3, pal.button);
  D(3.5, -12.8, 1.3, pal.button);

  // head
  R(-8, -26 + u, 16, 10, E_SKIN);
  R(-8, -26 + u, 2.5, 10, E_SKIN_DK);
  R(-8, -26 + u, 2.5, 7, M_HAIR); // sideburn
  R(-5.5, -26 + u, 11, 2, M_HAIR); // swept fringe
  R(3, -24 + u, 2.5, 1, M_HAIR); // stray honest tuft
  D(8.7, -20 + u, 3.4, E_NOSE); // big round nose
  D(7.3, -21.3 + u, 0.9, M_NOSE_HL);
  D(3.4, -21.8 + u, 3.1, '#ffffff'); // big honest ROUND eye
  D(4.1, -21.4 + u, 1.4, OUT); // centered pupil
  D(2.4, -22.9 + u, 0.8, '#ffffff'); // highlight
  R(2, -17.6 + u, 8.5, 2.4, M_HAIR); // full honest moustache
  R(1.2, -16.9 + u, 1.4, 1.7, M_HAIR); // soft droops
  R(10.1, -16.9 + u, 1.4, 1.7, M_HAIR);

  // cap
  ctx.save();
  if (pose.kind === 'skid') {
    ctx.translate(1, -28 + u);
    ctx.rotate(0.2);
    ctx.translate(0, 28 - u);
  }
  R(-8.5, -31.5 + u, 17, 5.5, pal.cap);
  R(-7, -32.5 + u, 14, 1.5, pal.cap); // crown rounding
  R(-8.5, -31.5 + u, 3.5, 5.5, pal.capDark);
  R(4, -27 + u, 8.5, 2.2, pal.cap); // brim
  R(4, -25.2 + u, 8.5, 0.9, pal.capDark);
  D(0.5, -29 + u, 4.2, '#ffffff');
  markM(ctx, ink, 0.5, -29 + u, 1.15, pal.discE);
  ctx.restore();

  // front arm
  if (pose.kind === 'jump') {
    R(7.1, -28, 2.5, 7.5, pal.shirt);
    D(8.4, -29, 2, pal.glove);
  } else if (out) {
    R(7.5, -15.5, 3.5, 2.5, pal.shirt);
    D(11.2, -14, 2, pal.glove);
  } else {
    R(6.1, -15.5 - pose.arm, 2.5, 7, pal.shirt);
    D(7.4, -7.5 - pose.arm, 1.9, pal.glove);
  }
}

/** Big-size Mangiani duck: proper squat, cap low. ~19px tall. */
function mangianiDuck(ctx: Ctx, pal: EstradaPal, ink: boolean): void {
  const { R, D } = inkable(ctx, ink);
  R(-6, -5.5, 12, 3.3, pal.bib);
  R(-6, -5.5, 2, 3.3, pal.bibDark);
  R(-7.5, -2.4, 5.5, 2.4, pal.shoe);
  R(2.2, -2.4, 5.5, 2.4, pal.shoe);
  R(-7.5, -13.5, 15, 8, E_SKIN);
  R(-7.5, -13.5, 2, 8, E_SKIN_DK);
  R(-7.5, -13.5, 2, 5, M_HAIR);
  R(-5.5, -13.5, 10, 1.8, M_HAIR); // fringe
  D(8, -9.5, 3, E_NOSE);
  D(6.8, -10.6, 0.8, M_NOSE_HL);
  D(3.2, -11, 2.6, '#ffffff');
  D(3.8, -10.7, 1.2, OUT);
  D(2.4, -11.8, 0.7, '#ffffff');
  R(2.2, -7.2, 7, 2, M_HAIR); // full honest moustache
  // cap pulled LOW
  R(-8, -18.5, 16, 5, pal.cap);
  R(-6.5, -19.5, 13, 1.5, pal.cap);
  R(-8, -18.5, 3, 5, pal.capDark);
  R(3.5, -14, 8, 2, pal.cap);
  R(3.5, -12.4, 8, 0.8, pal.capDark);
  D(0.5, -16, 3.7, '#ffffff');
  markM(ctx, ink, 0.5, -16, 1.0, pal.discE);
  D(-7.8, -3, 1.9, pal.glove); // gloves braced at the sides
  D(8, -3, 1.9, pal.glove);
}

/** KO'd Mangiani: faces the camera — X-eyes, arms up, classic launch pose. */
function mangianiDead(ctx: Ctx, pal: EstradaPal, big: boolean, ink: boolean): void {
  const { R, D } = inkable(ctx, ink);
  if (big) {
    R(-7.5, -2.5, 5.5, 2.5, pal.shoe); // legs splayed
    R(2, -2.5, 5.5, 2.5, pal.shoe);
    R(-5.2, -5.5, 3.5, 3.5, pal.bibDark);
    R(1.7, -5.5, 3.5, 3.5, pal.bib);
    R(-7, -18, 14, 4, pal.shirt);
    R(-6, -14.5, 12, 9, pal.bib);
    D(-3.5, -12.8, 1.3, pal.button);
    D(3.5, -12.8, 1.3, pal.button);
    R(-9.6, -27, 2.5, 7.5, pal.shirtDark); // arms thrown up
    R(7.1, -27, 2.5, 7.5, pal.shirt);
    D(-8.2, -28.5, 2, pal.glove);
    D(8.2, -28.5, 2, pal.glove);
    R(-8, -26, 16, 10, E_SKIN);
    R(-8, -26, 2, 7, M_HAIR); // both sideburns: full-face view
    R(6, -26, 2, 7, M_HAIR);
    R(-5.5, -26, 11, 2, M_HAIR); // fringe
    D(0.5, -20.5, 3.2, E_NOSE);
    D(-0.8, -21.7, 0.9, M_NOSE_HL);
    R(-4, -17.8, 9, 2.3, M_HAIR); // the honest moustache, even in defeat
    R(-4.9, -17.1, 1.3, 1.7, M_HAIR);
    R(4.6, -17.1, 1.3, 1.7, M_HAIR);
    R(-8.5, -31.5, 17, 5.5, pal.cap);
    R(-7, -32.5, 14, 1.5, pal.cap);
    R(-8, -26.6, 16, 1.1, pal.capDark); // brim edge-on
    D(0.5, -29, 4.2, '#ffffff');
    markM(ctx, ink, 0.5, -29, 1.15, pal.discE);
    if (!ink) {
      xEye(ctx, -3.8, -22.5, 2.3);
      xEye(ctx, 5, -22.5, 2.3);
    }
  } else {
    R(-6, -2, 4.5, 2, pal.shoe);
    R(1.5, -2, 4.5, 2, pal.shoe);
    R(-5, -8, 10, 5.5, pal.bib);
    R(-3, -7.2, 1.5, 1.5, pal.button);
    R(1.5, -7.2, 1.5, 1.5, pal.button);
    R(-8.3, -17.5, 2, 5.5, pal.shirtDark);
    R(6.3, -17.5, 2, 5.5, pal.shirt);
    D(-7.3, -18.5, 1.7, pal.glove);
    D(7.3, -18.5, 1.7, pal.glove);
    R(-7, -17, 14, 9, E_SKIN);
    R(-7, -17, 1.8, 6, M_HAIR);
    R(5.2, -17, 1.8, 6, M_HAIR);
    R(-5, -17, 10, 1.6, M_HAIR);
    D(0.5, -12, 2.7, E_NOSE);
    R(-3, -9.8, 8, 2, M_HAIR); // honest moustache
    R(-7.5, -21, 15, 4.5, pal.cap);
    R(-7, -16.8, 14, 1, pal.capDark);
    D(0.5, -19.3, 3.6, '#ffffff');
    markM(ctx, ink, 0.5, -19.3, 1.0, pal.discE);
    if (!ink) {
      xEye(ctx, -3.5, -14, 1.9);
      xEye(ctx, 4.5, -14, 1.9);
    }
  }
}

function mangianiSprite(ctx: Ctx, pal: EstradaPal, big: boolean, pose: Pose, ink: boolean): void {
  if (pose.kind === 'dead') mangianiDead(ctx, pal, big, ink);
  else if (pose.kind === 'duck' && big) mangianiDuck(ctx, pal, ink);
  else if (big) mangianiBig(ctx, pal, pose, ink);
  else mangianiSmall(ctx, pal, pose, ink);
}

// ---------------------------------------------------------------------------
// Character dispatch — exhaustive Record<CharacterId, rig>; a new character
// id in types.ts refuses to compile until it gets a rig here.
// ---------------------------------------------------------------------------

interface CharRig {
  pal: Record<PlayerSize, EstradaPal>;
  sprite: (ctx: Ctx, pal: EstradaPal, big: boolean, pose: Pose, ink: boolean) => void;
  /** Visual height in px (for the halo/bubble framing). */
  visH: (big: boolean) => number;
  /** Cap-disc letter painter (shared with the bubble mini-face). */
  mark: (ctx: Ctx, ink: boolean, x: number, y: number, s: number, c: string) => void;
  /** Bubble mini-face eye style. */
  eyes: 'smug' | 'round';
}

const CHAR_RIG: Record<CharacterId, CharRig> = {
  estrada: { pal: PLAYER_PAL, sprite: estradaSprite, visH: (b) => (b ? 30 : 20), mark: markE, eyes: 'smug' },
  mangiani: { pal: MANGIANI_PAL, sprite: mangianiSprite, visH: (b) => (b ? 32 : 22), mark: markM, eyes: 'round' },
};

/** Co-op bubble: the body is REPLACED by a drifting soap bubble holding a
 *  mini sad-face of the character (cap + eyes only). Deterministic off animT. */
function drawBubble(ctx: Ctx, x: number, y: number, big: boolean, pal: EstradaPal, rig: CharRig, animT: number): void {
  const bob = Math.sin(animT / 16) * 1.5;
  const r = big ? 15 : 12.5;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.beginPath(); // soap film
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(185,222,255,0.30)';
  ctx.fill();
  ctx.lineWidth = 2; // bright rim
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.beginPath(); // faint inner rim
  ctx.arc(0, 0, r - 2.5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
  ctx.beginPath(); // glint arc, top-left
  ctx.arc(0, 0, r - 4, Math.PI * 1.15, Math.PI * 1.45);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  disc(ctx, r * 0.45, r * 0.5, 1.2, 'rgba(255,255,255,0.85)'); // second glint
  // mini sad face: cap + eyes only — just enough to know who is in there
  const s = big ? 1 : 0.85;
  ctx.scale(s, s);
  ctx.fillStyle = pal.cap;
  ctx.fillRect(-6.5, -8.5, 13, 4);
  ctx.fillStyle = pal.capDark;
  ctx.fillRect(-6.5, -8.5, 2.5, 4);
  disc(ctx, 0, -8.8, 2.8, '#ffffff');
  rig.mark(ctx, false, 0, -8.8, 0.8, pal.discE);
  if (rig.eyes === 'round') {
    disc(ctx, -3, -1, 2.2, '#ffffff');
    disc(ctx, 3, -1, 2.2, '#ffffff');
    disc(ctx, -3, -0.2, 1, OUT); // pupils low: sad
    disc(ctx, 3, -0.2, 1, OUT);
    disc(ctx, -3.6, -1.8, 0.6, '#ffffff');
    disc(ctx, 2.4, -1.8, 0.6, '#ffffff');
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-4.6, -2.4, 3.4, 2.8);
    ctx.fillRect(1.2, -2.4, 3.4, 2.8);
    ctx.fillStyle = OUT;
    ctx.fillRect(-4.6, -2.4, 3.4, 0.8); // half-mast lids, even in the bubble
    ctx.fillRect(1.2, -2.4, 3.4, 0.8);
    ctx.fillRect(-3.4, -1.4, 1.4, 1.2);
    ctx.fillRect(2.4, -1.4, 1.4, 1.2);
  }
  ctx.beginPath(); // the sad little mouth
  ctx.arc(0, 5.2, 2.6, Math.PI * 1.15, Math.PI * 1.85);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  ctx.restore();
}

/** Silhouette-stamp offsets approximating a 2px ink outline. */
const OUTLINE_OFFS: readonly (readonly [number, number])[] = [
  [-1.6, 0], [1.6, 0], [0, -1.6], [0, 1.6],
  [-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1],
];

/** Landing-squash memory, keyed per player instance; render-side only. */
const squashState = new WeakMap<PlayerLike, { prevVy: number; squashT: number }>();

export function drawPlayer(ctx: Ctx, player: PlayerLike, cam: CameraState, frame: number): void {
  if (player.hidden) return; // inside the goal door — a hidden body draws NOTHING
  const sx = snap(player.x - cam.x);
  const sy = snap(player.y - cam.y);
  if (sx < -CULL || sx > VIEW_W + CULL || sy < -CULL || sy > VIEW_H + CULL) return;

  // Free-running animation clock. PlayerLike does not name animT; probe it
  // informally (same accepted seam as checkpoint.claimed), fall back to frame.
  const animT = (player as unknown as { animT?: number }).animT ?? frame;
  // Safe reads: the concrete Player may not carry the co-op fields until the
  // level/input workflow lands — default to Estrada, never crash.
  const character: CharacterId = player.character ?? 'estrada';
  const rig = CHAR_RIG[character];
  const big = player.size !== 'small';
  const pal = rig.pal[player.size];

  // Co-op bubble: the whole body is replaced by the drifting soap bubble
  // (drawn BEFORE the hurt-blink skip — the bubble is the player's locator).
  if ((player.bubbleT ?? 0) > 0) {
    drawBubble(ctx, sx, sy + player.halfH - rig.visH(big) / 2, big, pal, rig, animT);
    return;
  }

  // classic hurt blink: skip every other 3-frame window while invulnerable
  if (player.invulnT > 0 && player.immunityT <= 0 && Math.floor(frame / 3) % 2 === 0) return;

  // landing squash bookkeeping (render-side vy history via WeakMap)
  const st = squashState.get(player) ?? { prevVy: 0, squashT: 0 };
  if (player.grounded && st.prevVy > 4) st.squashT = 4;
  else if (st.squashT > 0) st.squashT--;
  st.prevVy = player.vy;
  squashState.set(player, st);

  let sclX = 1;
  let sclY = 1;
  if (st.squashT > 0 && player.grounded) {
    sclX = 1.12;
    sclY = 0.88;
  } else if (!player.grounded && !player.dead && Math.abs(player.vy) > 5) {
    sclX = 0.94;
    sclY = 1.08;
  }

  const speed = Math.abs(player.vx);

  // ---- pose from state (animT free-runs; gameplay never resets it) ----
  let pose: Pose;
  if (player.dead) {
    pose = { kind: 'dead', leg: 0, arm: 0, breathe: 0 };
  } else if (player.ducking && big) {
    pose = { kind: 'duck', leg: 0, arm: 0, breathe: 0 };
  } else if (!player.grounded) {
    pose = { kind: player.vy < 0.6 ? 'jump' : 'fall', leg: 0, arm: 0, breathe: 0 };
  } else if (player.skidding) {
    pose = { kind: 'skid', leg: 2, arm: 0, breathe: 0 };
  } else if (speed > 0.15) {
    const period = speed > 2.4 ? 4 : 7; // run cycle vs walk cycle
    const cyc = [0, 1, 2, 1][Math.floor(animT / period) % 4]!; // 3-frame stride
    pose = { kind: 'walk', leg: (cyc - 1) * 2, arm: (cyc - 1) * 2, breathe: 0 };
  } else {
    pose = { kind: 'idle', leg: 0, arm: 0, breathe: Math.floor(animT / 32) % 2 };
  }

  // Parliamentary Immunity: clean hue-cycling glow halo BEHIND the sprite
  // (blinks off intermittently during the final second as a wear-off warning).
  if (player.immunityT > 0 && !(player.immunityT < 60 && Math.floor(frame / 4) % 2 === 0)) {
    const hue = (frame * 6) % 360;
    const vh = rig.visH(big);
    const gy = sy + player.halfH - vh / 2;
    ctx.save();
    ctx.lineWidth = 5;
    ctx.strokeStyle = `hsla(${hue}, 95%, 65%, 0.28)`;
    ctx.beginPath();
    ctx.ellipse(sx, gy, 15, vh / 2 + 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `hsla(${hue}, 95%, 62%, 0.9)`;
    ctx.beginPath();
    ctx.ellipse(sx, gy, 13, vh / 2 + 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // CHARGED FULL RUN (>= 90% runMax, grounded-ish — mirrors Level.intensity's
  // hot band): tiny speed streaks + heel dust wisps trailing the runner — the
  // run state's own visual ambiance, paired with the music's noise-channel
  // lift. Deterministic from animT/vx only; drawn BEHIND the body. NOTE: the
  // painter has no reduced-motion hook (fx owns RM policy), so these stay
  // tiny, low-alpha and always-on by design.
  if (
    !player.dead &&
    speed >= PHYS.runMax * 0.9 &&
    (player.grounded || Math.abs(player.vy) < 1.2)
  ) {
    const dir = player.vx > 0 ? 1 : -1;
    const vh = rig.visH(big);
    const feetY = sy + player.halfH;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2; // house chunky-pixel weight
    for (let i = 0; i < 3; i++) {
      const phase = (animT * 2 + i * 5) % 12; // scrolls away behind the runner
      const y = feetY - 4 - (i * (vh - 6)) / 2;
      const x0 = sx - dir * (7 + phase);
      ctx.globalAlpha = 0.38 * (1 - phase / 16);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 - dir * (14 - i * 3), y);
      ctx.stroke();
    }
    // two dust wisps rolling off the heels
    ctx.fillStyle = '#e8e0d0';
    for (let i = 0; i < 2; i++) {
      const ph = ((animT * 3 + i * 12) % 24) / 24; // 0..1 roll-away cycle
      ctx.globalAlpha = 0.3 * (1 - ph);
      ctx.beginPath();
      ctx.arc(sx - dir * (7 + ph * 11), feetY - 2 - ph * 4, 1.5 + ph * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.translate(sx, sy + player.halfH); // anchor at the feet
  ctx.scale(player.facing * sclX, sclY);
  if (pose.kind === 'walk') {
    ctx.rotate(Math.min(0.11, speed * 0.028)); // forward lean scales with |vx|
    if (pose.leg === 0) ctx.translate(0, -1); // stride bob on the passing frame
  } else if (pose.kind === 'skid') {
    ctx.rotate(-0.16); // heels dug in, leaning back
  }
  // 2px ink outline: stamp the whole silhouette in OUT, then paint the colors
  for (const [ox, oy] of OUTLINE_OFFS) {
    ctx.save();
    ctx.translate(ox, oy);
    rig.sprite(ctx, pal, big, pose, true);
    ctx.restore();
  }
  rig.sprite(ctx, pal, big, pose, false);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Boss — BOWSONARO. Spiked shell painted like a soccer jersey, aviators,
// military beret. Exhaustive Record<BossPhase, draw fn>; unknown phase THROWS.
// ---------------------------------------------------------------------------

type BossDraw = (ctx: Ctx, b: BossLike, frame: number) => void;

/** Bowsonaro body, facing +x, origin at body center. */
function bossBody(ctx: Ctx, b: BossLike, pose: 'roar' | 'hop' | 'throw' | 'flat'): void {
  const t = b.animT;
  // legs
  if (pose === 'flat') {
    // pedaling in the air, on his back (caller flips the canvas)
    const a1 = t / 5;
    ctx.fillStyle = '#57c04b';
    ctx.fillRect(-8 + Math.cos(a1) * 3, 16, 5, 6);
    ctx.fillRect(3 + Math.cos(a1 + Math.PI) * 3, 16, 5, 6);
  } else {
    const step = pose === 'hop' && Math.abs(b.vy) > 0.5 ? 2 : Math.floor(t / 9) % 2;
    ctx.fillStyle = '#57c04b';
    ctx.fillRect(-10, 15 - (step === 0 ? 0 : 2), 7, 6);
    ctx.fillRect(3, 15 - (step === 1 ? 0 : 2), 7, 6);
    ctx.fillStyle = OUT;
    ctx.fillRect(-11, 19, 9, 3); // boots
    ctx.fillRect(2, 19, 9, 3);
  }
  // shell dome painted as a green-yellow jersey
  ctx.beginPath();
  ctx.arc(-3, 2, 18, 0, Math.PI * 2);
  ctx.fillStyle = '#2fae5c';
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(-3, 2, 17, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#ffd34e'; // jersey chest band
  ctx.fillRect(-21, -10, 36, 6);
  ctx.restore();
  txt(ctx, '10', -2.4, 3.6, 8, OUT); // drop shadow first…
  txt(ctx, '10', -3, 3, 8, '#ffd34e'); // …then the yellow 10
  // shell spikes
  tri(ctx, -16, -8, -8, -12, -14, -17, '#c9ccd8', OUT);
  tri(ctx, -8, -13, 0, -14, -5, -21, '#c9ccd8', OUT);
  tri(ctx, 3, -13, 10, -9, 9, -18, '#c9ccd8', OUT);
  // military beret wedged between the spikes
  ctx.save();
  ctx.translate(-4, -19);
  ctx.rotate(-0.2);
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 3.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#3a5a2a';
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#c22e2e';
  ctx.fillRect(-1, -2, 2, 2); // little star pin
  ctx.restore();
  // head + snout
  orect(ctx, 8, -12, 13, 11, '#57c04b');
  ctx.fillStyle = '#7dc86f';
  ctx.fillRect(17, -6, 6, 5); // snout
  orect(ctx, 15, -1, 9, 4, '#57c04b'); // THE chin, jutting past the snout
  // mouth
  if (pose === 'roar') {
    orect(ctx, 12, -3, 9, 5, '#7a1f1f');
    ctx.fillStyle = '#f2efe4';
    ctx.fillRect(13, -3, 2, 2);
    ctx.fillRect(17, -3, 2, 2);
  } else {
    ctx.fillStyle = OUT;
    ctx.fillRect(13, -2, 7, 2); // grim line
  }
  // aviator sunglasses — ALWAYS. Flat on his back they sit askew with a
  // cracked lens, but they do NOT come off. Never have. Never will.
  ctx.save();
  if (pose === 'flat') {
    ctx.translate(1, -1);
    ctx.rotate(0.18);
  }
  ctx.fillStyle = '#f2c14e';
  ctx.fillRect(8, -10, 13, 1); // gold bar
  ctx.fillStyle = '#2a2f3d';
  ctx.fillRect(9, -10, 5, 4);
  ctx.fillRect(15, -10, 5, 4);
  if (pose === 'flat') {
    ctx.strokeStyle = '#c9ccd8'; // the crack
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, -9);
    ctx.lineTo(18, -7.5);
    ctx.lineTo(17, -6.5);
    ctx.stroke();
  }
  ctx.restore();
  // arms
  ctx.fillStyle = '#57c04b';
  if (pose === 'roar') {
    const pump = Math.floor(t / 6) % 2 === 0 ? -4 : 0;
    ctx.fillRect(-20, -14 + pump, 5, 12); // chest-beating
    ctx.fillRect(12, -18 - pump, 5, 12);
  } else if (pose === 'throw') {
    ctx.fillRect(14, -4, 12, 5); // arm extended, decree away
    ctx.fillStyle = '#7dc86f';
    ctx.fillRect(24, -5, 4, 7);
  } else {
    ctx.fillRect(-18, 0, 5, 9);
    ctx.fillRect(13, 0, 5, 9);
  }
}

const BOSS_DRAW: Record<BossPhase, BossDraw> = {
  off: () => {},

  intro: (ctx, b) => {
    // chest-beating roar, swelling up to full staged menace
    const sc = Math.min(1, 0.4 + b.animT / 90);
    ctx.scale(sc, sc);
    ctx.translate(0, Math.abs(Math.sin(b.animT / 8)) * -3);
    bossBody(ctx, b, 'roar');
  },

  fight: (ctx, b) => {
    const throwing = b.animT % 90 < 18;
    bossBody(ctx, b, throwing ? 'throw' : 'hop');
  },

  escape: (ctx, b, frame) => {
    ctx.save();
    ctx.rotate(-0.52 * b.facing); // 30-degree strategic withdrawal
    // jetpack flames under the shell
    const fl = (frame % 4) + 3;
    tri(ctx, -12, 18, -4, 18, -8, 18 + fl * 2, '#ff8c2e');
    tri(ctx, 0, 18, 8, 18, 4, 18 + fl * 2.4, '#ffd23e');
    orect(ctx, -12, 12, 9, 7, '#8a8d99'); // thruster cans
    orect(ctx, 0, 12, 9, 7, '#8a8d99');
    bossBody(ctx, b, 'flat'); // aviators stay on, even at 30 degrees inverted
    ctx.restore();
    // a SPARE pair of aviators tumbles away on a short comedy loop — he
    // packs backups; the pair on his face never moves
    const k = b.animT % 40;
    ctx.save();
    ctx.translate(-14 - k * 0.8, -20 - k * 1.2);
    ctx.rotate(k * 0.3);
    ctx.globalAlpha = Math.max(0, 1 - k / 40);
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(-6, 0, 12, 1);
    ctx.fillStyle = '#2a2f3d';
    ctx.fillRect(-6, 0, 5, 4);
    ctx.fillRect(1, 0, 5, 4);
    ctx.restore();
  },

  defeated: (ctx, b) => {
    ctx.save();
    ctx.scale(1, -1); // flat on his back
    bossBody(ctx, b, 'flat');
    ctx.restore();
    // legs pedaling above the upturned shell
    const a1 = b.animT / 5;
    ctx.fillStyle = '#57c04b';
    ctx.fillRect(-8 + Math.cos(a1) * 3, -24, 5, 6);
    ctx.fillRect(3 + Math.cos(a1 + Math.PI) * 3, -24, 5, 6);
    // shell crack + the sticker that explains everything
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, -8);
    ctx.lineTo(-6, -2);
    ctx.lineTo(-10, 4);
    ctx.stroke();
    orect(ctx, -12, -2, 24, 9, '#f5f0e6');
    txt(ctx, 'FRAUDE?', 0, 2.5, 4.5, '#c22e2e');
  },
};

/** Fixed crumple-jitter radii for the decree missiles (deterministic). */
const DECREE_R = [6, 5, 6.5, 5.5, 6, 5.2, 6.3] as const;

export function drawBoss(ctx: Ctx, boss: BossLike, cam: CameraState, frame: number): void {
  const cx = snap(cam.x);
  const cy = snap(cam.y);
  const fn = BOSS_DRAW[boss.phase] as BossDraw | undefined;
  if (fn === undefined) throw new Error(`painter: no draw for boss phase '${String(boss.phase)}'`);
  const sx = snap(boss.x) - cx;
  const sy = snap(boss.y) - cy;
  const M = CULL * 2; // he's a big boy
  if (sx > -M && sx < VIEW_W + M && sy > -M && sy < VIEW_H + M) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(boss.facing, 1);
    fn(ctx, boss, frame);
    ctx.restore();
  }
  // decree missiles: crumpled paper, red wax seal, legally binding
  boss.shots.forEach((s, i) => {
    const px = snap(s.x) - cx;
    const py = snap(s.y) - cy;
    if (px < -CULL || px > VIEW_W + CULL || py < -CULL || py > VIEW_H + CULL) return;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(frame * 0.25 + i * 1.7);
    ctx.beginPath();
    for (let j = 0; j < DECREE_R.length; j++) {
      const r = DECREE_R[j]!;
      const a = (j * Math.PI * 2) / DECREE_R.length;
      const vx = Math.cos(a) * r;
      const vy = Math.sin(a) * r;
      if (j === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.fillStyle = '#f2efe4';
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#b8b2a6'; // dense legal print
    ctx.fillRect(-3, -3, 6, 1);
    ctx.fillRect(-3, -1, 5, 1);
    ctx.fillRect(-3, 1, 6, 1);
    disc(ctx, 2, 3, 2, '#c22e2e'); // wax seal
    ctx.restore();
  });
}

// ---------------------------------------------------------------------------
// Goal — the flagpole where the score is settled, then the castle door where
// the rescue reliably fails on schedule.
// ---------------------------------------------------------------------------

/** The end-of-level flagpole, GOAL.poleOffsetTiles before the door. Flies the
 *  Mushroom-Kingdom pennant until 'flag-plant' fires (level.finished), then
 *  Estrada's tiny "MISSION FAILED SUCCESSFULLY" pennant — he plants his flag
 *  on YOUR scoring pole, because of course he does. */
function drawFlagpole(ctx: Ctx, poleX: number, baseY: number, frame: number, planted: boolean): void {
  const poleH = GOAL.poleHeightTiles * TILE;
  const topY = baseY - poleH;
  // base block bolted to the runway
  orect(ctx, poleX - 6, baseY - 6, 12, 6, '#8a8d99');
  // shaft: outline slab, steel fill, running highlight
  ctx.fillStyle = OUT;
  ctx.fillRect(poleX - 2.5, topY, 5, poleH - 5);
  ctx.fillStyle = '#c9ccd8';
  ctx.fillRect(poleX - 1.5, topY + 1, 3, poleH - 7);
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(poleX - 1.5, topY + 1, 1, poleH - 7);
  // gold finial ball
  disc(ctx, poleX, topY - 2, 3, '#ffd34e', OUT);
  const wave = Math.sin(frame / 7) * 1.5;
  if (!planted) {
    // Mushroom-Kingdom pennant: royal red swallow-point, white kingdom spot
    ctx.beginPath();
    ctx.moveTo(poleX + 2, topY + 1);
    ctx.lineTo(poleX + 30, topY + 7 + wave);
    ctx.lineTo(poleX + 2, topY + 13);
    ctx.closePath();
    ctx.fillStyle = '#c22e2e';
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
    disc(ctx, poleX + 10, topY + 7 + wave * 0.4, 2.5, '#f5f0e6');
  } else {
    // Estrada's takeover flag: white rectangle, red 'MFS!', fine print
    ctx.beginPath();
    ctx.moveTo(poleX + 2, topY + 1);
    ctx.lineTo(poleX + 28, topY + 2 + wave);
    ctx.lineTo(poleX + 28, topY + 15 + wave);
    ctx.lineTo(poleX + 2, topY + 16);
    ctx.closePath();
    ctx.fillStyle = '#f5f0e6';
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
    txt(ctx, 'MFS!', poleX + 15, topY + 7 + wave * 0.7, 5, '#c22e2e');
    ctx.fillStyle = '#b8b2a6'; // the fine print (terms of the failure apply)
    ctx.fillRect(poleX + 6, topY + 11 + wave * 0.8, 17, 1);
    ctx.fillRect(poleX + 6, topY + 13 + wave * 0.9, 12, 1);
  }
}

export function drawGoal(ctx: Ctx, level: LevelLike, cam: CameraState, frame: number): void {
  // goalX/goalRow are part of the LevelLike contract (types.ts): px center of
  // the facade and the TILE row of the ground line under the door.
  const cx = snap(cam.x);
  const cy = snap(cam.y);
  const baseX = snap(level.goalX) - cx; // facade center
  const baseY = (level.goalRow + 1) * TILE - cy; // ground line under the door
  const W = TILE * 3; // 3 tiles wide
  const H = 56;
  const poleSpanL = GOAL.poleOffsetTiles * TILE + 34; // pole + waving pennant
  const spanV = Math.max(H, GOAL.poleHeightTiles * TILE + 12);
  if (baseX < -W - CULL - poleSpanL || baseX > VIEW_W + W + CULL) return;
  if (baseY < -CULL - spanV || baseY > VIEW_H + CULL + spanV) return;

  // Ceremony state comes from the concrete Level (informal probes — the
  // same accepted seam as checkpoint.claimed / lawyer.baseY): flagPlanted
  // swaps the pennant once 'flag-plant' fired (falls back to finished, which
  // flips the same frame); doorOpen holds while bodies walk in, and after.
  const probe = level as unknown as { flagPlanted?: boolean; doorOpen?: boolean };
  const planted = probe.flagPlanted ?? level.finished;
  const doorOpen = probe.doorOpen === true;

  // (a) THE FLAGPOLE — the classic scoring pole, 8 tiles before the door.
  // Boss acts have NO pole (boss OR flag, never both — the fight is the
  // climax and the goal there is the door itself).
  if (!level.def.boss) {
    drawFlagpole(ctx, baseX - GOAL.poleOffsetTiles * TILE, baseY, frame, planted);
  }

  const pal = THEME_PAL[level.def.theme];
  const x0 = baseX - W / 2;
  const y0 = baseY - H;
  // stone facade
  orect(ctx, x0, y0, W, H, pal.fill);
  ctx.fillStyle = pal.detail;
  for (let i = 0; i < 3; i++) ctx.fillRect(x0 + 2, y0 + 12 + i * 14, W - 4, 2);
  // crenellations
  ctx.fillStyle = pal.fill;
  ctx.fillRect(x0 - 2, y0 - 6, 10, 8);
  ctx.fillRect(x0 + W / 2 - 5, y0 - 6, 10, 8);
  ctx.fillRect(x0 + W - 8, y0 - 6, 10, 8);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, y0 - 5, W - 2, 6);
  // theme banner over the door
  ctx.fillStyle = pal.accent;
  ctx.fillRect(x0 + 6, y0 + 6, W - 12, 4);
  // the facade is a rental — nobody took the tag off (THE WORLD IS A SET)
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + W - 2, y0 + 14);
  ctx.lineTo(x0 + W + 6, y0 + 18);
  ctx.stroke();
  orect(ctx, x0 + W + 2, y0 + 16, 26, 12, '#f5f0e6');
  txt(ctx, 'RENT-A-', x0 + W + 15, y0 + 20, 3.5, OUT);
  txt(ctx, 'CASTLE', x0 + W + 15, y0 + 25, 3.5, OUT);
  if (doorOpen) {
    // the ceremony opened it: a dark doorway swallowing the heroes, the two
    // panels swung back against the jambs, a faint warm glow from inside
    ctx.fillStyle = '#1c1410';
    ctx.fillRect(baseX - 11, baseY - 22, 22, 22);
    ctx.beginPath(); // arch, opened dark too
    ctx.arc(baseX, baseY - 22, 11, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeRect(baseX - 10, baseY - 21, 20, 21);
    ctx.fillStyle = 'rgba(255,211,78,0.12)'; // someone left a lamp on
    ctx.fillRect(baseX - 7, baseY - 16, 14, 16);
    orect(ctx, baseX - 15, baseY - 22, 5, 22, '#6f4626'); // swung panels
    orect(ctx, baseX + 10, baseY - 22, 5, 22, '#6f4626');
  } else {
    // double door, firmly shut, as is tradition
    orect(ctx, baseX - 11, baseY - 22, 11, 22, '#6f4626');
    orect(ctx, baseX, baseY - 22, 11, 22, '#6f4626');
    ctx.fillStyle = '#ffd34e';
    ctx.fillRect(baseX - 4, baseY - 12, 2, 2); // knobs
    ctx.fillRect(baseX + 2, baseY - 12, 2, 2);
    ctx.beginPath(); // arch
    ctx.arc(baseX, baseY - 22, 11, Math.PI, 0);
    ctx.fillStyle = '#6f4626';
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // the crew's wayfinding sign, posted like craft services: the star must
  // not miss his own rescue scene — HERO ENTRANCE, arrow at the door
  const signX = x0 - 14;
  orect(ctx, signX - 1, baseY - 14, 3, 14, '#8a5a2b'); // post
  orect(ctx, signX - 20, baseY - 26, 42, 13, '#e6d9a8');
  txt(ctx, 'HERO', signX + 1, baseY - 22, 4.5, '#3a2a1e');
  txt(ctx, 'ENTRANCE', signX - 2, baseY - 17, 4, '#3a2a1e');
  // the arrow, aimed square at the door
  tri(ctx, signX + 12, baseY - 20, signX + 12, baseY - 14.5, signX + 18, baseY - 17.2, '#c22e2e');
}

// ---------------------------------------------------------------------------
// Presentation-drift gate — the painter's coverage, derived from the ACTUAL
// dispatch tables (never hand-listed, so it cannot lie about them).
// tests/painter-contract.test.ts holds these against canonical copies of the
// unions: extend a union in types.ts and the suite stays red until a draw
// entry exists here. Pure data, no canvas, safe to import in plain Node.
// ---------------------------------------------------------------------------

export const PAINTED_ENTITY_KINDS = Object.keys(ENTITY_DRAW) as readonly EntityKind[];
export const PAINTED_TILE_KINDS = Object.keys(TILE_DRAW) as readonly TileKind[];
export const PAINTED_BOSS_PHASES = Object.keys(BOSS_DRAW) as readonly BossPhase[];

/** Themes each enemy kind has a disguise for (always all four, by type;
 *  exported so the contract test can prove it at runtime too). */
function skinThemes(kind: EnemyKind): readonly ThemeId[] {
  return Object.keys(ENEMY_SKIN[kind]) as ThemeId[];
}

export const PAINTED_ENEMY_SKINS: Record<EnemyKind, readonly ThemeId[]> = {
  lobbyist: skinThemes('lobbyist'),
  pollster: skinThemes('pollster'),
  lawyer: skinThemes('lawyer'),
  paparazzo: skinThemes('paparazzo'),
  rat: skinThemes('rat'),
  chipstack: skinThemes('chipstack'),
  gavel: skinThemes('gavel'),
};
