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
  EntityKind,
  EntityLike,
  LevelLike,
  PlayerLike,
  PlayerSize,
  PowerupKind,
  ThemeId,
  TileKind,
} from '../core/types.ts';
import { TILE, VIEW_H, VIEW_W } from '../core/constants.ts';

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
    // tax-form spikes: pointed paperwork, the deadliest instrument known
    const { ctx, x, y } = a;
    for (const ox of [0, 8]) {
      tri(ctx, x + ox + 1, y + TILE, x + ox + 8, y + TILE, x + ox + 4.5, y + 2, '#f2efe4', '#9a958c');
      ctx.fillStyle = '#c22e2e';
      ctx.fillRect(x + ox + 3, y + 7, 3, 1); // TOTAL DUE line
      ctx.fillStyle = '#b8b2a6';
      ctx.fillRect(x + ox + 3, y + 9, 3, 1); // fine print
      ctx.fillRect(x + ox + 2, y + 11, 5, 1);
    }
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

const ENTITY_DRAW: Record<EntityKind, EDraw> = {
  lobbyist: (ctx, e) => {
    // a briefcase that walks: sunglasses, tie, no soul
    ctx.scale(e.facing, 1);
    const step = Math.floor(e.animT / 8) % 2;
    ctx.fillStyle = OUT;
    ctx.fillRect(-6 + (step === 0 ? 0 : 1), 6, 4, 3);
    ctx.fillRect(2 - (step === 0 ? 0 : 1), 6, 4, 3);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -8, 3, Math.PI, 0);
    ctx.stroke();
    orect(ctx, -8, -7, 16, 14, '#a8722f');
    ctx.fillStyle = '#7c4f1d';
    ctx.fillRect(-8, -1, 16, 2); // latch band
    ctx.fillStyle = '#ffd34e';
    ctx.fillRect(-1, -2, 3, 4); // clasp
    ctx.fillStyle = OUT; // sunglasses band
    ctx.fillRect(-7, -5, 13, 3);
    ctx.fillStyle = '#3a3f4d';
    ctx.fillRect(-5, -4, 4, 2);
    ctx.fillRect(1, -4, 4, 2);
    tri(ctx, -1, 1, 2, 1, 0.5, 6, '#c22e2e'); // tie
  },

  pollster: (ctx, e) => {
    ctx.scale(e.facing, 1);
    const step = Math.floor(e.animT / 9) % 2;
    ctx.fillStyle = '#2a5f2a';
    ctx.fillRect(-5 + step, 5, 4, 3);
    ctx.fillRect(1 - step, 5, 4, 3);
    disc(ctx, -1, 0, 6.5, '#3d8f3d', OUT); // shell
    ctx.fillStyle = '#2f6f2f';
    ctx.fillRect(-6, -1, 10, 2);
    orect(ctx, 3, -6, 8, 8, '#7dc86f'); // head
    ctx.fillStyle = OUT;
    ctx.fillRect(8, -4, 2, 2); // eye
    orect(ctx, 2, -10, 10, 5, '#d8382a'); // the cap
    txt(ctx, 'MKGA', 7, -7.5, 3, '#ffffff');
  },

  lawyer: (ctx, e) => {
    // pin-striped piranha plant, billing by the bite
    ctx.fillStyle = '#2f6f2f';
    ctx.fillRect(-2, 2, 4, 12); // stalk
    orect(ctx, -11, 7, 7, 6, '#8a5a2b'); // briefcase leaves
    orect(ctx, 4, 7, 7, 6, '#8a5a2b');
    disc(ctx, 0, -4, 8, '#28304f', OUT); // suited head
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const px of [-4, 0, 4]) {
      ctx.moveTo(px, -11);
      ctx.lineTo(px, 2);
    }
    ctx.stroke();
    const open = Math.floor(e.animT / 14) % 2 === 0;
    if (open) {
      tri(ctx, -5, -4, -1, -4, -3, -1, '#f2efe4'); // chompers
      tri(ctx, 1, -4, 5, -4, 3, -1, '#f2efe4');
      ctx.fillStyle = '#7a1f1f';
      ctx.fillRect(-4, -3, 8, 2);
    } else {
      ctx.fillStyle = '#f2efe4';
      ctx.fillRect(-5, -4, 10, 2);
    }
    tri(ctx, -1, 3, 2, 3, 0.5, 8, '#c22e2e'); // tie
  },

  paparazzo: (ctx, e) => {
    ctx.scale(e.facing, 1);
    const t = e.animT;
    const r = Math.abs(Math.sin(t / 2)) * 5 + 1;
    ctx.strokeStyle = OUT; // rotor blur
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
    orect(ctx, -8, -5, 16, 10, '#565a68');
    disc(ctx, 4, 0, 3.5, '#2a2f3d', OUT); // lens
    disc(ctx, 4, 0, 1.5, '#3fa9ff');
    const flashing = Math.floor(t) % 80 < 5; // diode on its own clock
    disc(ctx, -5, -7, 2, flashing ? '#ffffff' : '#c9a227');
    if (flashing) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-9, -11);
      ctx.lineTo(-7, -9);
      ctx.moveTo(-1, -11);
      ctx.lineTo(-3, -9);
      ctx.stroke();
    }
  },

  rat: (ctx, e) => {
    ctx.scale(e.facing, 1);
    ctx.strokeStyle = '#ff9bb0'; // tail first (behind)
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, 1);
    ctx.quadraticCurveTo(-11, -2 + Math.sin(e.animT / 6) * 2, -14, 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 1, 7, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#8d8d99';
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
    disc(ctx, 3, -3, 2, '#8d8d99', OUT); // ear
    ctx.fillStyle = OUT;
    ctx.fillRect(5, -1, 2, 2); // beady eye
    disc(ctx, 7.5, 1, 1, '#ff9bb0'); // nose
    const step = Math.floor(e.animT / 4) % 2;
    ctx.fillStyle = OUT;
    ctx.fillRect(-4 + step, 4, 2, 2);
    ctx.fillRect(2 - step, 4, 2, 2);
  },

  chipstack: (ctx, e) => {
    ctx.rotate(Math.sin(e.animT / 7) * 0.12);
    const cols = ['#d84343', '#f2f2f2', '#3f6fd8', '#2fae5c'];
    for (let i = 0; i < 4; i++) {
      orect(ctx, -8, 4 - i * 5, 16, 5, cols[i]!);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(-6, 6 - i * 5, 2, 1);
      ctx.fillRect(4, 6 - i * 5, 2, 1);
    }
    disc(ctx, -3, -13, 2, '#ffffff', OUT); // googly eyes
    disc(ctx, 3, -13, 2, '#ffffff', OUT);
    disc(ctx, -3 + e.facing, -13, 1, OUT);
    disc(ctx, 3 + e.facing, -13, 1, OUT);
  },

  gavel: (ctx, e) => {
    if (e.vy > 2) {
      // slam blur: justice, delivered at terminal velocity
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-9, -26, 3, 14);
      ctx.fillRect(6, -26, 3, 14);
    }
    ctx.fillStyle = '#6f4626';
    ctx.fillRect(-2, -18, 4, 12); // handle
    orect(ctx, -11, -8, 22, 15, '#8a5a2b'); // head
    ctx.fillStyle = '#5e3a1c';
    ctx.fillRect(-11, -8, 3, 15);
    ctx.fillRect(8, -8, 3, 15);
    ctx.fillStyle = '#ffd34e';
    ctx.fillRect(-1, -6, 2, 11); // gold inlay
  },

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
// ---------------------------------------------------------------------------

interface PlayerCosmetics {
  cap: string;
  shirt: string;
  overalls: string;
  skin: string;
  boot: string;
  medal: string;
}

const PLAYER_PAL: Record<PlayerSize, PlayerCosmetics> = {
  small: {
    cap: '#d8382a', shirt: '#d8382a', overalls: '#2a4fd8',
    skin: '#f2b98a', boot: '#5a3a1e', medal: '#ffd34e',
  },
  certified: {
    cap: '#d8382a', shirt: '#d8382a', overalls: '#2a4fd8',
    skin: '#f2b98a', boot: '#5a3a1e', medal: '#ffd34e',
  },
  goldpen: {
    // palette swap: white-and-gold, the outfit of a man with nothing to hide
    cap: '#f5f0e6', shirt: '#f5f0e6', overalls: '#e0aa2f',
    skin: '#f2b98a', boot: '#8a6a1e', medal: '#d8382a',
  },
};

/** Landing-squash memory, keyed per player instance; render-side only. */
const squashState = new WeakMap<PlayerLike, { prevVy: number; squashT: number }>();

/** Body drawn facing +x with FEET at y=0, head upward (negative y). */
function drawEstradaBody(ctx: Ctx, pal: PlayerCosmetics, big: boolean, walk: number, airborne: boolean): void {
  const armsUp = airborne;
  if (big) {
    // boots
    ctx.fillStyle = pal.boot;
    ctx.fillRect(-6 + walk, -3, 5, 3);
    ctx.fillRect(1 - walk, -3, 5, 3);
    // overalls + straps
    orect(ctx, -6, -13, 12, 10, pal.overalls);
    ctx.fillStyle = pal.overalls;
    ctx.fillRect(-5, -16, 2, 4);
    ctx.fillRect(3, -16, 2, 4);
    ctx.fillStyle = pal.medal;
    ctx.fillRect(-4, -12, 2, 2); // button
    ctx.fillRect(2, -12, 2, 2);
    // notary stamp holstered at the belt
    ctx.fillStyle = '#7a2020';
    ctx.fillRect(-8, -12, 3, 4);
    ctx.fillStyle = '#f5f0e6';
    ctx.fillRect(-8, -12, 3, 1);
    // shirt torso
    ctx.fillStyle = pal.shirt;
    ctx.fillRect(-6, -17, 12, 4);
    // arms
    ctx.fillStyle = pal.shirt;
    if (armsUp) {
      ctx.fillRect(-9, -22, 3, 7);
      ctx.fillRect(6, -22, 3, 7);
      ctx.fillStyle = pal.skin;
      ctx.fillRect(-9, -24, 3, 2); // hands in the air (like he just doesn't care)
      ctx.fillRect(6, -24, 3, 2);
    } else {
      ctx.fillRect(-8, -16 + walk, 3, 6);
      ctx.fillRect(5, -16 - walk, 3, 6);
      ctx.fillStyle = pal.skin;
      ctx.fillRect(-8, -10 + walk, 3, 2);
      ctx.fillRect(5, -10 - walk, 3, 2);
    }
    // head
    ctx.fillStyle = pal.skin;
    ctx.fillRect(-5, -25, 10, 8);
    ctx.fillStyle = '#e0a070';
    ctx.fillRect(4, -21, 3, 3); // proud nose
    ctx.fillStyle = OUT;
    ctx.fillRect(1, -23, 2, 2); // eye
    ctx.fillStyle = '#3a2a1e';
    ctx.fillRect(0, -18.5, 5, 1.5); // the pencil moustache
    // cap + 'E' medallion
    orect(ctx, -6, -29, 12, 5, pal.cap);
    ctx.fillStyle = pal.cap;
    ctx.fillRect(3, -25.5, 5, 2); // brim
    disc(ctx, 0, -26.5, 2.5, pal.medal);
    txt(ctx, 'E', 0, -26.5, 4, '#8a2020');
  } else {
    // small: same grifter, less of him
    ctx.fillStyle = pal.boot;
    ctx.fillRect(-5 + walk, -2, 4, 2);
    ctx.fillRect(1 - walk, -2, 4, 2);
    orect(ctx, -5, -7, 10, 5, pal.overalls);
    ctx.fillStyle = '#7a2020';
    ctx.fillRect(-7, -7, 2, 3); // stamp at the belt, always
    ctx.fillStyle = pal.shirt; // stub arms
    if (armsUp) {
      ctx.fillRect(-7, -11, 2, 4);
      ctx.fillRect(5, -11, 2, 4);
    } else {
      ctx.fillRect(-7, -7 + walk, 2, 3);
      ctx.fillRect(5, -7 - walk, 2, 3);
    }
    ctx.fillStyle = pal.skin;
    ctx.fillRect(-5, -12, 10, 6);
    ctx.fillStyle = '#e0a070';
    ctx.fillRect(4, -10, 2, 2);
    ctx.fillStyle = OUT;
    ctx.fillRect(1, -11, 2, 2);
    ctx.fillStyle = '#3a2a1e';
    ctx.fillRect(0, -8, 4, 1);
    orect(ctx, -6, -15, 12, 4, pal.cap);
    ctx.fillStyle = pal.cap;
    ctx.fillRect(3, -12, 4, 2);
    disc(ctx, 0, -13, 2, pal.medal);
    txt(ctx, 'E', 0, -13, 3, '#8a2020');
  }
}

export function drawPlayer(ctx: Ctx, player: PlayerLike, cam: CameraState, frame: number): void {
  const sx = snap(player.x - cam.x);
  const sy = snap(player.y - cam.y);
  if (sx < -CULL || sx > VIEW_W + CULL || sy < -CULL || sy > VIEW_H + CULL) return;
  // classic hurt blink: skip every other 3-frame window while invulnerable
  if (player.invulnT > 0 && player.immunityT <= 0 && Math.floor(frame / 3) % 2 === 0) return;

  // landing squash bookkeeping (render-side vy history via WeakMap)
  const st = squashState.get(player) ?? { prevVy: 0, squashT: 0 };
  if (player.grounded && st.prevVy > 4) st.squashT = 5;
  else if (st.squashT > 0) st.squashT--;
  st.prevVy = player.vy;
  squashState.set(player, st);

  let sclX = 1;
  let sclY = 1;
  if (st.squashT > 0 && player.grounded) {
    sclX = 1.15;
    sclY = 0.85;
  } else if (!player.grounded && Math.abs(player.vy) > 4) {
    sclX = 0.9;
    sclY = 1.15;
  }

  const pal = PLAYER_PAL[player.size];
  const big = player.size !== 'small';
  const hh = player.halfH;

  ctx.save();
  ctx.translate(sx, sy + hh); // anchor at the feet
  ctx.scale(player.facing * sclX, sclY);
  if (player.dead) {
    // KO'd: flipped in place. The performance is over (this take, anyway).
    ctx.translate(0, -hh);
    ctx.rotate(Math.PI);
    ctx.translate(0, -hh);
  }
  if (player.skidding && player.grounded) ctx.rotate(-0.15); // lean back
  if (player.ducking && big) ctx.scale(1, 0.55); // squat
  const walking = player.grounded && Math.abs(player.vx) > 0.15 && !player.ducking;
  const walk = walking ? (Math.floor(frame / 7) % 2 === 0 ? 1 : -1) : 0;
  drawEstradaBody(ctx, pal, big, walk, !player.grounded && !player.dead);
  ctx.restore();

  if (player.immunityT > 0) {
    // Parliamentary Immunity: the man is LITERALLY untouchable, in rainbow
    ctx.save();
    ctx.strokeStyle = `hsl(${(frame * 14) % 360} 90% 60%)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - player.halfW - 3, sy - player.halfH - 3, player.halfW * 2 + 6, player.halfH * 2 + 6);
    ctx.restore();
  }
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
  ctx.fillStyle = '#ffd34e'; // jersey band
  ctx.fillRect(-21, -2, 36, 8);
  ctx.restore();
  txt(ctx, '01', -3, 2, 6, '#2a4fd8');
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
  // aviator sunglasses (unless they flew off — escape draws them separately)
  if (pose !== 'flat') {
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(8, -10, 13, 1); // gold bar
    ctx.fillStyle = '#2a2f3d';
    ctx.fillRect(9, -10, 5, 4);
    ctx.fillRect(15, -10, 5, 4);
  } else {
    ctx.fillStyle = OUT; // dazed X eyes
    ctx.fillRect(11, -10, 2, 2);
    ctx.fillRect(16, -10, 2, 2);
  }
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
    bossBody(ctx, b, 'flat'); // no sunglasses on the face
    ctx.restore();
    // the aviators, tumbling off on a short comedy loop
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
// Goal — the castle door where the rescue reliably fails on schedule.
// ---------------------------------------------------------------------------

export function drawGoal(ctx: Ctx, level: LevelLike, cam: CameraState, frame: number): void {
  // LevelLike does not expose the goal position; the Level implementation
  // carries goalX/goalRow from BuiltLevel. Field probe — an accepted seam
  // (same class as the checkpoint `claimed` probe). Unknown shape THROWS.
  const g = level as unknown as { goalX?: unknown; goalRow?: unknown };
  if (typeof g.goalX !== 'number' || typeof g.goalRow !== 'number') {
    throw new Error('painter: Level does not expose numeric goalX/goalRow');
  }
  const cx = snap(cam.x);
  const cy = snap(cam.y);
  const baseX = snap(g.goalX) - cx; // facade center
  const baseY = (g.goalRow + 1) * TILE - cy; // ground line under the door
  const W = TILE * 3; // 3 tiles wide
  const H = 56;
  if (baseX < -W - CULL || baseX > VIEW_W + W + CULL) return;
  if (baseY < -CULL - H || baseY > VIEW_H + CULL + H) return;

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
  // the sign: honesty in advertising, for once
  const signX = x0 - 14;
  orect(ctx, signX - 1, baseY - 14, 3, 14, '#8a5a2b'); // post
  orect(ctx, signX - 20, baseY - 26, 42, 13, '#e6d9a8');
  txt(ctx, 'RESCUE HERE', signX + 1, baseY - 22, 4.5, '#3a2a1e');
  txt(ctx, '(TOO LATE)', signX + 1, baseY - 17, 4, '#c22e2e');

  if (level.finished) {
    // ceremony aftermath: the flag says it all
    const fx = baseX + W / 2 + 10;
    orect(ctx, fx - 1, baseY - 34, 3, 34, '#a9adba');
    disc(ctx, fx + 0.5, baseY - 35, 2, '#ffd34e', OUT);
    const wave = Math.sin(frame / 6) * 1.5;
    ctx.beginPath();
    ctx.moveTo(fx + 2, baseY - 33);
    ctx.lineTo(fx + 34, baseY - 30 + wave);
    ctx.lineTo(fx + 34, baseY - 19 + wave);
    ctx.lineTo(fx + 2, baseY - 16);
    ctx.closePath();
    ctx.fillStyle = '#f5f0e6';
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.stroke();
    txt(ctx, 'MISSION FAILED', fx + 18, baseY - 28 + wave / 2, 3.5, '#c22e2e');
    txt(ctx, 'SUCCESSFULLY', fx + 18, baseY - 23 + wave / 2, 3.5, '#c22e2e');
  }
}
