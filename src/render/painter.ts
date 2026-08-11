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

/** Silhouette-stamp offsets approximating a 2px ink outline. */
const OUTLINE_OFFS: readonly (readonly [number, number])[] = [
  [-1.6, 0], [1.6, 0], [0, -1.6], [0, 1.6],
  [-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1],
];

/** Landing-squash memory, keyed per player instance; render-side only. */
const squashState = new WeakMap<PlayerLike, { prevVy: number; squashT: number }>();

export function drawPlayer(ctx: Ctx, player: PlayerLike, cam: CameraState, frame: number): void {
  const sx = snap(player.x - cam.x);
  const sy = snap(player.y - cam.y);
  if (sx < -CULL || sx > VIEW_W + CULL || sy < -CULL || sy > VIEW_H + CULL) return;
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

  // Free-running animation clock. PlayerLike does not name animT; probe it
  // informally (same accepted seam as checkpoint.claimed), fall back to frame.
  const animT = (player as unknown as { animT?: number }).animT ?? frame;
  const pal = PLAYER_PAL[player.size];
  const big = player.size !== 'small';
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
    const vh = big ? 30 : 20;
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
    estradaSprite(ctx, pal, big, pose, true);
    ctx.restore();
  }
  estradaSprite(ctx, pal, big, pose, false);
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
