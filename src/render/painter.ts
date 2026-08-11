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

/** Plant stalk rising from the pipe mouth. */
function plantStalk(ctx: Ctx, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(-2, 2, 4, 12);
}

/** The chomp cycle shared by plant heads (open jaw / pressed shut). */
function plantChomp(ctx: Ctx, e: EntityLike): void {
  if (Math.floor(e.animT / 14) % 2 === 0) {
    tri(ctx, -5, -4, -1, -4, -3, -1, '#f2efe4');
    tri(ctx, 1, -4, 5, -4, 3, -1, '#f2efe4');
    ctx.fillStyle = '#7a1f1f';
    ctx.fillRect(-4, -3, 8, 2);
  } else {
    ctx.fillStyle = '#f2efe4';
    ctx.fillRect(-5, -4, 10, 2);
  }
}

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
    // The makeup artist: powder-puff head, dabbing — TELL: HELLO tag.
    meadow: (ctx, e) => {
      plantStalk(ctx, '#2f6f2f');
      orect(ctx, -11, 8, 7, 5, '#e8b4c8'); // compact-case leaf
      orect(ctx, 4, 8, 7, 5, '#c9ccd8'); // hand-mirror leaf
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(5, 9, 5, 3);
      const dab = Math.floor(e.animT / 14) % 2 === 0 ? 2 : 0;
      disc(ctx, 0, -5 + dab, 7, '#ff9bb0', OUT); // the puff
      disc(ctx, -3, -8 + dab, 2, '#ffc4d4');
      disc(ctx, 3, -7 + dab, 2, '#ffc4d4');
      if (dab === 2) { // powder poof
        disc(ctx, -6, -13, 1.5, '#f5f0e6');
        disc(ctx, 0, -15, 1.5, '#f5f0e6');
        disc(ctx, 6, -13, 1.5, '#f5f0e6');
      }
      tellTag(ctx, -6, 0, 12, 'M.U.A.');
    },
    // THE lawyer: pinstripe sleeve, briefcase jaws — TELL: sleeve zipper.
    sewer: (ctx, e) => {
      plantStalk(ctx, '#28304f');
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; // pinstripes
      ctx.fillRect(-1, 3, 1, 11);
      ctx.fillRect(1, 3, 1, 11);
      orect(ctx, -11, 7, 7, 6, '#8a5a2b'); // filing leaves
      orect(ctx, 4, 7, 7, 6, '#8a5a2b');
      if (Math.floor(e.animT / 14) % 2 === 0) { // jaws open
        orect(ctx, -7, -13, 14, 6, '#6f4626');
        orect(ctx, -7, -3, 14, 6, '#8a5a2b');
        ctx.fillStyle = '#f2efe4'; // discovery documents
        ctx.fillRect(-5, -6, 10, 3);
        txt(ctx, 'OBJECTION!', 0, -16, 3, '#c22e2e');
      } else {
        orect(ctx, -7, -9, 14, 9, '#8a5a2b'); // case pressed shut
        ctx.fillStyle = '#ffd34e';
        ctx.fillRect(-1, -6, 3, 3); // clasp
      }
      tellZipper(ctx, -1.5, 4, 7);
    },
    // The waitress plant, serving subpoenas — TELL: HELLO 'DEB' tag.
    casino: (ctx, e) => {
      plantStalk(ctx, '#2f6f2f');
      orect(ctx, 4, 8, 7, 5, '#2f6f2f'); // plain leaf
      disc(ctx, -8, 10, 4.5, '#c9ccd8', OUT); // serving-tray leaf
      ctx.fillStyle = '#f5f0e6'; // the subpoena
      ctx.fillRect(-10, 4, 5, 5);
      disc(ctx, -7.5, 6, 1, '#c22e2e'); // wax seal
      disc(ctx, 0, -4, 8, '#3d8f3d', OUT);
      plantChomp(ctx, e);
      ctx.fillStyle = '#f5f0e6'; // doily cap
      ctx.fillRect(-5, -12, 10, 2);
      disc(ctx, 5, -11, 1.8, '#c22e2e'); // bow
      tellTag(ctx, 3, -1, 10, 'DEB');
    },
    // The general plant: peaked cap + medals — TELL: chin under the seam.
    castle: (ctx, e) => {
      plantStalk(ctx, '#57713a');
      orect(ctx, -11, 7, 7, 6, '#57713a'); // epaulette leaves
      orect(ctx, 4, 7, 7, 6, '#57713a');
      ctx.fillStyle = '#ffd34e'; // gold fringe
      ctx.fillRect(-10, 12, 5, 1);
      ctx.fillRect(5, 12, 5, 1);
      disc(ctx, 0, -4, 8, '#57713a', OUT);
      plantChomp(ctx, e);
      ctx.fillStyle = '#3a5a2a'; // peaked cap
      ctx.fillRect(-6, -14, 12, 4);
      ctx.fillStyle = OUT;
      ctx.fillRect(-7, -10, 14, 1.5); // brim
      ctx.fillStyle = '#c22e2e';
      ctx.fillRect(-1, -13, 2, 2); // star pin
      disc(ctx, -2, 6, 1.2, '#ffd34e'); // medals on the stalk
      disc(ctx, 1, 8, 1.2, '#c9ccd8');
      ctx.fillStyle = '#f2b98a'; // TELL: human chin, jutting (family trait)
      ctx.fillRect(-2, 3, 6, 2);
      ctx.fillStyle = OUT;
      ctx.fillRect(-4, 2.5, 9, 1); // costume seam
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
    // 'TOTALLY A BIRD' surveillance drone — TELL: the sign says so.
    sewer: (ctx, e) => {
      droneRotors(ctx, e);
      orect(ctx, -8, -5, 16, 10, '#565a68');
      tri(ctx, 9, -3, 9, 3, 15, 0, '#e0aa2f', OUT); // cardboard beak
      ctx.fillStyle = '#b8b2a6'; // the tape holding it on
      ctx.fillRect(6, -3, 3, 6);
      disc(ctx, 2, -1, 2.5, '#ffffff', OUT); // googly eye
      disc(ctx, 2.7, -0.4, 1, OUT);
      ctx.strokeStyle = OUT; // TELL: the sworn statement, on strings
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, 5);
      ctx.lineTo(-3, 9);
      ctx.moveTo(4, 5);
      ctx.lineTo(3, 9);
      ctx.stroke();
      orect(ctx, -9, 9, 18, 8, '#e6d9a8');
      txt(ctx, 'A BIRD', 0, 13.5, 4, OUT);
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
    ctx.fillStyle = '#ffffff'; // smug half-lid eye: white, low pupil…
    ctx.fillRect(1, -23, 3, 2);
    ctx.fillStyle = OUT;
    ctx.fillRect(2, -22.2, 2, 1.2);
    ctx.fillRect(1, -23, 3, 1); // …and the lid at half mast
    ctx.fillStyle = '#3a2a1e';
    ctx.fillRect(-5, -24, 2, 4); // slicked sideburn under the cap
    ctx.fillRect(-5, -20.5, 3, 1); // its little forward hook
    ctx.fillRect(0, -18.5, 5, 1); // the pencil moustache (thinner = smugger)
    ctx.fillRect(4.5, -19.2, 1, 1); // dapper upturn
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
    ctx.fillStyle = '#ffffff'; // the same smug half-lid, fun-size
    ctx.fillRect(1, -11, 3, 2);
    ctx.fillStyle = OUT;
    ctx.fillRect(2, -10.4, 2, 1.2);
    ctx.fillRect(1, -11, 3, 0.8);
    ctx.fillStyle = '#3a2a1e';
    ctx.fillRect(-5, -12, 1.5, 3); // sideburn
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
// Goal — the castle door where the rescue reliably fails on schedule.
// ---------------------------------------------------------------------------

export function drawGoal(ctx: Ctx, level: LevelLike, cam: CameraState, frame: number): void {
  // goalX/goalRow are part of the LevelLike contract (types.ts): px center of
  // the facade and the TILE row of the ground line under the door.
  const cx = snap(cam.x);
  const cy = snap(cam.y);
  const baseX = snap(level.goalX) - cx; // facade center
  const baseY = (level.goalRow + 1) * TILE - cy; // ground line under the door
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
