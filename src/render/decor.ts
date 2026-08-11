// ============================================================================
// Near-layer decor — non-colliding dressing placed ON the level surface.
// buildDecor walks the map (topmost 'ground' tile per column) and sprinkles
// theme-appropriate items deterministically from the seeded decor RNG stream.
// drawDecor renders one layer: 'back' (behind entities — signage, facades,
// torches) or 'front' (sparse tufts overlapping feet).
//
// Decor is a discriminated union; drawDecor dispatches with an exhaustive
// switch ending in a `never` guard that THROWS — the house once shipped an
// invisible-decor bug from a missing case, so the guard is mandatory.
// No DOM at module top. No Math.random. Same (theme, map, seed) => same decor.
// ============================================================================

import type { CameraState, ThemeId, TileMapLike } from '../core/types.ts';
import { TILE, VIEW_W } from '../core/constants.ts';
import { createRng, RNG_STREAM, type Rng } from '../core/rng.ts';

// ---------------------------------------------------------------------------
// The union
// ---------------------------------------------------------------------------

type DecorOf<K extends string> = { kind: K; x: number; y: number; variant: number };

export type Decor =
  // meadow — the kingdom right after the scam
  | DecorOf<'saisieSign'>      // 'SAISIE!' / 'BANK OWNED' foreclosure stake
  | DecorOf<'betsBillboard'>   // "TOAD'S BETS: IMPOSSIBLE TO LOSE!"
  | DecorOf<'boardedHouse'>    // sad Toad-house facade, boarded up
  | DecorOf<'flower'>
  | DecorOf<'bush'>
  | DecorOf<'coinTruck'>       // coin-vacuum truck, parked (rare)
  | DecorOf<'grassTuft'>       // front
  // sewer — the money pipes
  | DecorOf<'leakPipe'>        // dripping wall pipe with stain
  | DecorOf<'ratHole'>
  | DecorOf<'skeletonBettor'>  // slumped skeleton, bet slip still in hand
  | DecorOf<'launderTape'>     // 'LAUNDERING IN PROGRESS' hazard tape
  | DecorOf<'sewerShroom'>
  | DecorOf<'mossTuft'>        // front
  // casino — the platform made physical
  | DecorOf<'slotFacade'>
  | DecorOf<'chipStack'>
  | DecorOf<'cardLean'>        // playing card leaning at a platform edge
  | DecorOf<'allInArrow'>      // 'ALL IN' neon arrow
  | DecorOf<'velvetRope'>
  | DecorOf<'chipScatter'>     // front
  // castle — Bowsonaro's Grand Palace
  | DecorOf<'impeachStatue'>   // small gold Impeach, hands drawn BIG
  | DecorOf<'ballotCrenel'>    // ballot-box crenellation
  | DecorOf<'chainedDoor'>
  | DecorOf<'wallTorch'>       // animated flame via frame
  | DecorOf<'graffiti'>        // 'TRUMP–BOWSONARO 4EVER'
  | DecorOf<'emberTuft'>       // front
  ;

type DecorKind = Decor['kind'];

/** Which pass draws each kind — exhaustive, a new kind must declare a layer. */
const DECOR_LAYER: Record<DecorKind, 'back' | 'front'> = {
  saisieSign: 'back',
  betsBillboard: 'back',
  boardedHouse: 'back',
  flower: 'back',
  bush: 'back',
  coinTruck: 'back',
  grassTuft: 'front',
  leakPipe: 'back',
  ratHole: 'back',
  skeletonBettor: 'back',
  launderTape: 'back',
  sewerShroom: 'back',
  mossTuft: 'front',
  slotFacade: 'back',
  chipStack: 'back',
  cardLean: 'back',
  allInArrow: 'back',
  velvetRope: 'back',
  chipScatter: 'front',
  impeachStatue: 'back',
  ballotCrenel: 'back',
  chainedDoor: 'back',
  wallTorch: 'back',
  graffiti: 'back',
  emberTuft: 'front',
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** Chance per eligible column of a back-layer item / a front tuft. */
const BACK_CHANCE = 0.2;
const FRONT_CHANCE = 0.13;
/** Columns skipped after placing a small / big back item (breathing room). */
const SMALL_GAP = 2;
const BIG_GAP = 6;
/** Off-screen culling margin in px (widest decor is the billboard, ~70px). */
const CULL_MARGIN = 90;

interface BackEntry {
  kind: DecorKind;
  weight: number;
  /** Needs the neighbouring columns to be ground at the same row. */
  wide: boolean;
}

const THEME_BACK: Record<ThemeId, readonly BackEntry[]> = {
  meadow: [
    { kind: 'flower', weight: 3, wide: false },
    { kind: 'bush', weight: 3, wide: false },
    { kind: 'saisieSign', weight: 1.6, wide: false },
    { kind: 'boardedHouse', weight: 0.8, wide: true },
    { kind: 'betsBillboard', weight: 0.6, wide: true },
    { kind: 'coinTruck', weight: 0.18, wide: true },
  ],
  sewer: [
    { kind: 'sewerShroom', weight: 3, wide: false },
    { kind: 'ratHole', weight: 2, wide: false },
    { kind: 'leakPipe', weight: 2, wide: false },
    { kind: 'launderTape', weight: 0.9, wide: true },
    { kind: 'skeletonBettor', weight: 0.7, wide: false },
  ],
  casino: [
    { kind: 'chipStack', weight: 3, wide: false },
    { kind: 'cardLean', weight: 2.2, wide: false },
    { kind: 'velvetRope', weight: 1.2, wide: true },
    { kind: 'allInArrow', weight: 1, wide: false },
    { kind: 'slotFacade', weight: 0.9, wide: true },
  ],
  castle: [
    { kind: 'wallTorch', weight: 2.5, wide: false },
    { kind: 'ballotCrenel', weight: 2, wide: false },
    { kind: 'impeachStatue', weight: 1, wide: false },
    { kind: 'graffiti', weight: 0.9, wide: true },
    { kind: 'chainedDoor', weight: 0.8, wide: true },
  ],
};

const THEME_FRONT: Record<ThemeId, DecorKind> = {
  meadow: 'grassTuft',
  sewer: 'mossTuft',
  casino: 'chipScatter',
  castle: 'emberTuft',
};

/** Kinds broad enough to earn the long placement gap. */
const BIG_KINDS: ReadonlySet<DecorKind> = new Set<DecorKind>([
  'betsBillboard', 'boardedHouse', 'coinTruck', 'launderTape',
  'slotFacade', 'velvetRope', 'chainedDoor', 'graffiti',
]);

function pickWeighted(rng: Rng, entries: readonly BackEntry[]): BackEntry {
  let total = 0;
  for (const e of entries) total += e.weight;
  let roll = rng() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  const last = entries[entries.length - 1];
  if (!last) throw new Error('pickWeighted: empty entry table');
  return last;
}

/** Topmost 'ground' tile row of a column with open air above, or null. */
function surfaceRow(map: TileMapLike, tx: number): number | null {
  for (let ty = 0; ty < map.hTiles; ty++) {
    const k = map.tileAt(tx, ty);
    if (k === 'ground') {
      return ty > 0 && map.tileAt(tx, ty - 1) !== 'empty' ? null : ty;
    }
    if (k !== 'empty') return null; // first obstruction isn't ground: no decor
  }
  return null;
}

export function buildDecor(theme: ThemeId, map: TileMapLike, seed: number): Decor[] {
  const backTable = THEME_BACK[theme];
  const frontKind = THEME_FRONT[theme];
  if (!backTable || !frontKind) throw new Error(`buildDecor: unknown theme '${String(theme)}'`);
  const rng = createRng((seed ^ RNG_STREAM.decor) >>> 0);
  const out: Decor[] = [];
  let gap = 0;

  for (let tx = 2; tx < map.wTiles - 2; tx++) {
    const ty = surfaceRow(map, tx);
    if (ty === null || ty < 3) continue;
    const x = tx * TILE + TILE / 2;
    const y = ty * TILE; // base line = top of the surface tile

    if (gap > 0) gap--;
    else if (rng() < BACK_CHANCE) {
      // headroom: two clear tiles above the surface
      if (map.tileAt(tx, ty - 1) === 'empty' && map.tileAt(tx, ty - 2) === 'empty') {
        const entry = pickWeighted(rng, backTable);
        const fits = !entry.wide
          || (map.tileAt(tx - 1, ty) === 'ground' && map.tileAt(tx + 1, ty) === 'ground'
            && map.tileAt(tx - 1, ty - 1) === 'empty' && map.tileAt(tx + 1, ty - 1) === 'empty');
        if (fits) {
          out.push({ kind: entry.kind, x, y, variant: Math.floor(rng() * 1000) });
          gap = BIG_KINDS.has(entry.kind) ? BIG_GAP : SMALL_GAP;
        }
      }
    }

    if (rng() < FRONT_CHANCE && map.tileAt(tx, ty - 1) === 'empty') {
      out.push({ kind: frontKind, x, y, variant: Math.floor(rng() * 1000) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Draw — per-kind painters, anchored at (sx, sy) = base center in screen px.
// Everything is drawn upward from the base; the ground tiles (painted after
// the back layer) cover anything poking below it, so items read as planted.
// ---------------------------------------------------------------------------

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string): void {
  ctx.fillStyle = color;
  ctx.font = `bold ${px}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

// --- meadow ---------------------------------------------------------------

const SAISIE_TEXTS = ['SAISIE!', 'BANK OWNED'] as const;

function drawSaisieSign(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const tilt = ((v % 5) - 2) * 0.04;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(-1, -13, 2, 13);
  ctx.fillStyle = '#fdf6e3';
  ctx.fillRect(-16, -22, 32, 10);
  ctx.strokeStyle = '#b0a080';
  ctx.lineWidth = 1;
  ctx.strokeRect(-16, -22, 32, 10);
  label(ctx, SAISIE_TEXTS[v % SAISIE_TEXTS.length]!, 0, -17, 5, '#a02020');
  ctx.restore();
}

function drawBetsBillboard(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#6a4a2a';
  ctx.fillRect(x - 22, y - 26, 3, 26);
  ctx.fillRect(x + 19, y - 26, 3, 26);
  ctx.fillStyle = '#fff3d6';
  ctx.fillRect(x - 34, y - 52, 68, 28);
  ctx.strokeStyle = '#c62828';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 34, y - 52, 68, 28);
  label(ctx, "TOAD'S BETS", x, y - 44, 8, '#c62828');
  label(ctx, 'IMPOSSIBLE', x, y - 35, 6, '#333333');
  label(ctx, 'TO LOSE!', x, y - 28, 6, '#333333');
}

function drawBoardedHouse(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  // cream wall + spotted dome roof, doorway and window nailed shut
  ctx.fillStyle = '#efe2c8';
  ctx.fillRect(x - 18, y - 22, 36, 22);
  ctx.fillStyle = v % 2 === 0 ? '#c65b4e' : '#7f9fc6'; // faded cap
  ctx.beginPath();
  ctx.arc(x, y - 22, 24, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(x - 10, y - 30, 3.5, 0, Math.PI * 2);
  ctx.arc(x + 8, y - 32, 4, 0, Math.PI * 2);
  ctx.fill();
  // dark doorway with crossed planks
  ctx.fillStyle = '#2c2018';
  ctx.fillRect(x - 5, y - 14, 10, 14);
  ctx.strokeStyle = '#8a6a42';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 14);
  ctx.lineTo(x + 6, y - 1);
  ctx.moveTo(x + 6, y - 14);
  ctx.lineTo(x - 6, y - 1);
  ctx.stroke();
  // boarded window
  ctx.fillStyle = '#2c2018';
  ctx.fillRect(x + 8, y - 18, 7, 6);
  ctx.strokeStyle = '#8a6a42';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 7, y - 17);
  ctx.lineTo(x + 16, y - 13);
  ctx.stroke();
}

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const colors = ['#ff8fb8', '#ffd23f', '#ffffff'] as const;
  ctx.strokeStyle = '#3f8f2f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 7);
  ctx.stroke();
  ctx.fillStyle = colors[v % colors.length]!;
  for (let p = 0; p < 4; p++) {
    const a = (p * Math.PI) / 2 + 0.4;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 2.6, y - 9 + Math.sin(a) * 2.6, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#e8a020';
  ctx.beginPath();
  ctx.arc(x, y - 9, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawBush(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const s = 1 + (v % 3) * 0.25;
  ctx.fillStyle = '#4d9c3a';
  ctx.beginPath();
  ctx.arc(x - 6 * s, y - 4 * s, 5 * s, 0, Math.PI * 2);
  ctx.arc(x, y - 6 * s, 6.5 * s, 0, Math.PI * 2);
  ctx.arc(x + 6 * s, y - 4 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#63b64c';
  ctx.beginPath();
  ctx.arc(x - 2 * s, y - 7 * s, 3.5 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawCoinTruck(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const dir = v % 2 === 0 ? 1 : -1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  // trailer + cab
  ctx.fillStyle = '#46536a';
  ctx.fillRect(-26, -20, 38, 16);
  ctx.fillStyle = '#5a6a85';
  ctx.fillRect(12, -16, 14, 12);
  ctx.fillStyle = '#bcd6ee';
  ctx.fillRect(18, -14, 6, 5); // windshield
  // wheels
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(-16, -3, 4, 0, Math.PI * 2);
  ctx.arc(18, -3, 4, 0, Math.PI * 2);
  ctx.fill();
  // vacuum hose arcing to the ground, coins mid-slurp
  ctx.strokeStyle = '#39445a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-26, -14);
  ctx.quadraticCurveTo(-40, -16, -38, -2);
  ctx.stroke();
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(-40, -6, 2, 2);
  ctx.fillRect(-36, -10, 2, 2);
  ctx.fillRect(-33, -13, 2, 2);
  label(ctx, 'COIN-VAC', -7, -12, 5, '#ffd23f');
  ctx.restore();
}

function drawGrassTuft(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const lean = ((v % 7) - 3) * 0.35;
  ctx.strokeStyle = v % 2 === 0 ? '#3f8f2f' : '#57ab3f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let b = -2; b <= 2; b++) {
    ctx.moveTo(x + b * 2, y);
    ctx.quadraticCurveTo(x + b * 2 + lean, y - 5, x + b * 2 + lean + b * 0.6, y - 7 - Math.abs(b));
  }
  ctx.stroke();
}

// --- sewer ----------------------------------------------------------------

function drawLeakPipe(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, frame: number): void {
  const top = y - 30 - (v % 3) * 6;
  // wall stain running down from the joint
  ctx.fillStyle = 'rgba(70,110,90,0.25)';
  ctx.fillRect(x - 3, top + 8, 6, y - top - 8);
  // pipe stub with flange
  ctx.fillStyle = '#3a464d';
  ctx.fillRect(x - 10, top, 20, 8);
  ctx.fillStyle = '#4a575f';
  ctx.fillRect(x - 12, top + 1, 4, 6);
  ctx.fillRect(x + 8, top + 1, 4, 6);
  // the drip: fall cycle offset per instance
  const cycle = ((frame + v * 13) % 90) / 90;
  if (cycle < 0.65) {
    const dy = (cycle / 0.65) * (y - top - 10);
    ctx.fillStyle = '#7fd4bc';
    ctx.fillRect(x - 1, top + 8 + dy, 2, 3);
  } else if (cycle < 0.72) {
    // tiny splash ring at the base
    ctx.strokeStyle = 'rgba(127,212,188,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y - 1, 3, 1.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawRatHole(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, frame: number): void {
  ctx.fillStyle = '#0a0d0f';
  ctx.beginPath();
  ctx.ellipse(x, y, 7, 5, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  // eyes peek out most of the time
  if (((frame + v * 91) % 360) < 300) {
    ctx.fillStyle = '#ffb84d';
    ctx.fillRect(x - 3, y - 3, 1.5, 1.5);
    ctx.fillRect(x + 1.5, y - 3, 1.5, 1.5);
  }
}

function drawSkeletonBettor(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const dir = v % 2 === 0 ? 1 : -1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  const bone = '#d8d4c4';
  // legs splayed on the floor
  ctx.strokeStyle = bone;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-2, -8);
  ctx.lineTo(6, -1);
  ctx.moveTo(-2, -8);
  ctx.lineTo(9, -4);
  ctx.stroke();
  // slumped ribcage
  ctx.beginPath();
  ctx.moveTo(-3, -16);
  ctx.lineTo(-2, -8);
  ctx.stroke();
  ctx.lineWidth = 1;
  for (let r = 0; r < 3; r++) {
    ctx.beginPath();
    ctx.moveTo(-4, -14 + r * 2.5);
    ctx.lineTo(1, -13 + r * 2.5);
    ctx.stroke();
  }
  // skull tipped forward
  ctx.fillStyle = bone;
  ctx.beginPath();
  ctx.arc(-3, -19, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0d0f';
  ctx.fillRect(-5, -20, 1.5, 1.5);
  ctx.fillRect(-2, -20, 1.5, 1.5);
  // arm out, bet slip still clutched — he was SO sure
  ctx.strokeStyle = bone;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-2, -13);
  ctx.lineTo(8, -10);
  ctx.stroke();
  ctx.fillStyle = '#f5efd8';
  ctx.fillRect(7, -15, 8, 6);
  label(ctx, 'BET', 11, -12, 4, '#a02020');
  ctx.restore();
}

function drawLaunderTape(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#4a575f';
  ctx.fillRect(x - 36, y - 16, 2, 16);
  ctx.fillRect(x + 34, y - 16, 2, 16);
  // sagging tape band
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - 35, y - 14);
  ctx.quadraticCurveTo(x, y - 8, x + 35, y - 14);
  ctx.quadraticCurveTo(x, y - 2, x - 35, y - 8);
  ctx.closePath();
  ctx.fillStyle = '#e8c832';
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = '#1a1a1a';
  for (let s = -40; s < 40; s += 10) {
    ctx.beginPath();
    ctx.moveTo(x + s, y);
    ctx.lineTo(x + s + 4, y);
    ctx.lineTo(x + s + 10, y - 18);
    ctx.lineTo(x + s + 6, y - 18);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  label(ctx, 'LAUNDERING IN PROGRESS', x, y - 10, 5, '#1a1a1a');
}

function drawSewerShroom(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, frame: number): void {
  const glow = 0.35 + 0.2 * Math.sin(frame * 0.05 + v);
  ctx.fillStyle = `rgba(63,184,160,${glow.toFixed(2)})`;
  ctx.beginPath();
  ctx.arc(x, y - 5, 8, 0, Math.PI * 2);
  ctx.fill();
  for (let m = 0; m < 2 + (v % 2); m++) {
    const mx = x + (m - 1) * 5;
    const mh = 4 + ((v + m) % 3) * 2;
    ctx.fillStyle = '#b8c8b0';
    ctx.fillRect(mx - 1, y - mh, 2, mh);
    ctx.fillStyle = '#3fb8a0';
    ctx.beginPath();
    ctx.arc(mx, y - mh, 3.5, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  }
}

function drawMossTuft(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  ctx.strokeStyle = '#2e6b58';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let b = -1; b <= 1; b++) {
    ctx.moveTo(x + b * 3, y);
    ctx.lineTo(x + b * 3 + b, y - 5 - ((v + b) % 3));
  }
  ctx.stroke();
  ctx.fillStyle = '#7fd4bc';
  ctx.fillRect(x + ((v % 3) - 1) * 3 - 0.5, y - 7, 1.5, 1.5);
}

// --- casino ---------------------------------------------------------------

function drawSlotFacade(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, frame: number): void {
  ctx.fillStyle = '#2b1a4d';
  ctx.fillRect(x - 14, y - 36, 28, 36);
  ctx.strokeStyle = '#7f5fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 14, y - 36, 28, 36);
  // reel window: three symbols that never quite line up
  ctx.fillStyle = '#0d0b1a';
  ctx.fillRect(x - 11, y - 30, 22, 10);
  const syms = ['7', '$', '★'] as const;
  for (let r = 0; r < 3; r++) {
    label(ctx, syms[(v + r) % 3]!, x - 7 + r * 7, y - 25, 6, r === 1 ? '#ffd23f' : '#f2f2f6');
  }
  // lever
  ctx.strokeStyle = '#9a9aa5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 14, y - 26);
  ctx.lineTo(x + 19, y - 34);
  ctx.stroke();
  ctx.fillStyle = '#c02040';
  ctx.beginPath();
  ctx.arc(x + 19, y - 35, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // blinking crown light
  const on = ((frame + v * 29) % 60) < 30;
  ctx.fillStyle = on ? '#ffd23f' : '#6b5a1e';
  ctx.beginPath();
  ctx.arc(x, y - 38, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawChipStack(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const chips = 3 + (v % 4);
  const colors = ['#c02040', '#2050c0', '#20a050'] as const;
  for (let c = 0; c < chips; c++) {
    ctx.fillStyle = colors[(v + c) % colors.length]!;
    ctx.beginPath();
    ctx.ellipse(x, y - 2 - c * 3, 6, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y - 2 - c * 3, 6, 2.2, 0, 0.4, 1.2);
    ctx.stroke();
  }
}

function drawCardLean(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const suits = ['♠', '♥', '♦', '♣'] as const;
  const suit = suits[v % 4]!;
  const red = v % 4 === 1 || v % 4 === 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((v % 2 === 0 ? 1 : -1) * 0.22));
  ctx.fillStyle = '#f5f5f0';
  ctx.fillRect(-6, -18, 12, 18);
  ctx.strokeStyle = '#b8b8b0';
  ctx.lineWidth = 1;
  ctx.strokeRect(-6, -18, 12, 18);
  label(ctx, suit, 0, -9, 8, red ? '#c02040' : '#1a1a1a');
  ctx.restore();
}

function drawAllInArrow(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, frame: number): void {
  const lit = ((frame + v * 41) % 90) < 70;
  const neon = lit ? '#ff4fd8' : '#552044';
  ctx.fillStyle = '#3a3a45';
  ctx.fillRect(x - 1.5, y - 26, 3, 26);
  // arrow board pointing down-right at the nearest way to lose everything
  ctx.save();
  ctx.translate(x, y - 30);
  ctx.rotate(0.35);
  ctx.strokeStyle = neon;
  ctx.lineWidth = 2;
  ctx.strokeRect(-16, -7, 26, 14);
  ctx.beginPath();
  ctx.moveTo(10, -10);
  ctx.lineTo(19, 0);
  ctx.lineTo(10, 10);
  ctx.stroke();
  label(ctx, 'ALL IN', -3, 1, 6, neon);
  ctx.restore();
}

function drawVelvetRope(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#c8a02e';
  ctx.fillRect(x - 14, y - 14, 2.5, 14);
  ctx.fillRect(x + 12, y - 14, 2.5, 14);
  ctx.beginPath();
  ctx.arc(x - 12.7, y - 15, 2.2, 0, Math.PI * 2);
  ctx.arc(x + 13.2, y - 15, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a01830';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - 12.7, y - 13);
  ctx.quadraticCurveTo(x, y - 6, x + 13.2, y - 13);
  ctx.stroke();
}

function drawChipScatter(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const colors = ['#c02040', '#2050c0', '#ffd23f'] as const;
  for (let c = 0; c < 3; c++) {
    const cx = x + (((v * 7 + c * 13) % 11) - 5);
    ctx.fillStyle = colors[(v + c) % colors.length]!;
    ctx.beginPath();
    ctx.ellipse(cx, y - 1 - (c % 2), 2.5, 1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- castle ---------------------------------------------------------------

function drawImpeachStatue(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const gold = '#d9a530';
  ctx.fillStyle = '#241014';
  ctx.fillRect(x - 9, y - 6, 18, 6);
  // dress
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.moveTo(x, y - 30);
  ctx.lineTo(x - 8, y - 6);
  ctx.lineTo(x + 8, y - 6);
  ctx.closePath();
  ctx.fill();
  // head + crown
  ctx.beginPath();
  ctx.arc(x, y - 33, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 2, y - 39, 4, 2);
  // arms with disproportionate hands — the sculptor worked from life
  ctx.strokeStyle = gold;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 27);
  ctx.lineTo(x - 9, y - 22);
  ctx.moveTo(x + 3, y - 27);
  ctx.lineTo(x + 9, y - 22);
  ctx.stroke();
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.arc(x - 11, y - 21, 4 + (v % 2), 0, Math.PI * 2);
  ctx.arc(x + 11, y - 21, 4 + (v % 2), 0, Math.PI * 2);
  ctx.fill();
}

function drawBallotCrenel(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  ctx.fillStyle = '#3a2a2e';
  ctx.fillRect(x - 7, y - 11, 14, 11);
  ctx.strokeStyle = '#241014';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 7, y - 11, 14, 11);
  // slot on top, ballot half-stuffed
  ctx.fillStyle = '#100a0c';
  ctx.fillRect(x - 4, y - 12, 8, 2);
  ctx.fillStyle = '#e8e0c8';
  ctx.save();
  ctx.translate(x + ((v % 3) - 1), y - 12);
  ctx.rotate(((v % 5) - 2) * 0.1);
  ctx.fillRect(-2.5, -4, 5, 4);
  ctx.restore();
  label(ctx, 'X', x, y - 5, 6, '#6b1016');
}

function drawChainedDoor(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // arched door, chained shut — nobody asks what's behind it
  ctx.fillStyle = '#2c1a10';
  ctx.fillRect(x - 10, y - 22, 20, 22);
  ctx.beginPath();
  ctx.arc(x, y - 22, 10, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#4a3520';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - 30);
  ctx.lineTo(x, y);
  ctx.stroke();
  // crossed chains
  ctx.strokeStyle = '#6b7078';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 11, y - 26);
  ctx.lineTo(x + 11, y - 6);
  ctx.moveTo(x + 11, y - 26);
  ctx.lineTo(x - 11, y - 6);
  ctx.stroke();
  ctx.fillStyle = '#8a9098';
  for (let l = 0; l < 4; l++) {
    ctx.fillRect(x - 9 + l * 5.5, y - 24.5 + l * 5, 2, 2);
    ctx.fillRect(x + 7 - l * 5.5, y - 24.5 + l * 5, 2, 2);
  }
  // padlock
  ctx.fillStyle = '#c8a02e';
  ctx.fillRect(x - 3, y - 18, 6, 5);
  ctx.strokeStyle = '#c8a02e';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y - 18, 2.5, Math.PI, 0);
  ctx.stroke();
}

function drawWallTorch(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, frame: number): void {
  const t = frame * 0.3 + v;
  // bracket + shaft
  ctx.fillStyle = '#3a3a40';
  ctx.fillRect(x - 1.5, y - 20, 3, 8);
  ctx.fillStyle = '#5a4a30';
  ctx.fillRect(x - 2, y - 26, 4, 7);
  // flame: two layered lobes flickering in height and lean
  const lean = Math.sin(t) * 1.6;
  const hgt = 9 + Math.sin(t * 1.7 + 1) * 2;
  ctx.fillStyle = 'rgba(255,140,30,0.9)';
  ctx.beginPath();
  ctx.moveTo(x - 3.5, y - 26);
  ctx.quadraticCurveTo(x - 4 + lean, y - 26 - hgt * 0.6, x + lean, y - 26 - hgt);
  ctx.quadraticCurveTo(x + 4 + lean, y - 26 - hgt * 0.6, x + 3.5, y - 26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,220,90,0.9)';
  ctx.beginPath();
  ctx.moveTo(x - 1.8, y - 26);
  ctx.quadraticCurveTo(x + lean * 0.7, y - 28 - hgt * 0.35, x + lean * 0.5, y - 26 - hgt * 0.55);
  ctx.quadraticCurveTo(x + 1.8 + lean * 0.4, y - 27 - hgt * 0.2, x + 1.8, y - 26);
  ctx.closePath();
  ctx.fill();
  // glow
  ctx.fillStyle = 'rgba(255,160,60,0.12)';
  ctx.beginPath();
  ctx.arc(x, y - 30, 13 + Math.sin(t * 0.9) * 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawGraffiti(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  // sprayed on a faint slab so it reads against any wall
  ctx.fillStyle = 'rgba(20,10,12,0.5)';
  ctx.fillRect(x - 34, y - 20, 68, 17);
  const tilt = ((v % 3) - 1) * 0.03;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  label(ctx, 'TRUMP–BOWSONARO', 0, -14, 6, '#d0303a');
  label(ctx, '4EVER', -6, -7, 6, '#d0303a');
  // spray heart
  ctx.fillStyle = '#d0303a';
  ctx.beginPath();
  ctx.arc(10, -9, 2, 0, Math.PI * 2);
  ctx.arc(14, -9, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, -8);
  ctx.lineTo(12, -3.5);
  ctx.lineTo(16, -8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawEmberTuft(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, frame: number): void {
  ctx.strokeStyle = '#3a3034';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let b = -1; b <= 1; b++) {
    ctx.moveTo(x + b * 3, y);
    ctx.lineTo(x + b * 3 + b, y - 5 - ((v + b) % 3));
  }
  ctx.stroke();
  const glow = 0.5 + 0.5 * Math.sin(frame * 0.1 + v);
  ctx.fillStyle = `rgba(255,140,40,${glow.toFixed(2)})`;
  ctx.fillRect(x + ((v % 3) - 1) * 3 - 0.5, y - 7, 1.5, 1.5);
}

// ---------------------------------------------------------------------------
// The dispatch — exhaustive switch with the mandatory never guard.
// ---------------------------------------------------------------------------

export function drawDecor(
  ctx: CanvasRenderingContext2D,
  decor: Decor[],
  cam: CameraState,
  layer: 'back' | 'front',
  frame: number,
): void {
  for (const d of decor) {
    // Loud lookup: an unknown kind must NOT be silently filtered out here
    // before the switch's never guard can catch it.
    const dLayer: 'back' | 'front' | undefined = DECOR_LAYER[d.kind];
    if (dLayer === undefined) throw new Error(`drawDecor: unknown decor kind '${String(d.kind)}'`);
    if (dLayer !== layer) continue;
    const sx = d.x - cam.x;
    const sy = d.y - cam.y;
    if (sx < -CULL_MARGIN || sx > VIEW_W + CULL_MARGIN) continue;
    switch (d.kind) {
      case 'saisieSign': drawSaisieSign(ctx, sx, sy, d.variant); break;
      case 'betsBillboard': drawBetsBillboard(ctx, sx, sy); break;
      case 'boardedHouse': drawBoardedHouse(ctx, sx, sy, d.variant); break;
      case 'flower': drawFlower(ctx, sx, sy, d.variant); break;
      case 'bush': drawBush(ctx, sx, sy, d.variant); break;
      case 'coinTruck': drawCoinTruck(ctx, sx, sy, d.variant); break;
      case 'grassTuft': drawGrassTuft(ctx, sx, sy, d.variant); break;
      case 'leakPipe': drawLeakPipe(ctx, sx, sy, d.variant, frame); break;
      case 'ratHole': drawRatHole(ctx, sx, sy, d.variant, frame); break;
      case 'skeletonBettor': drawSkeletonBettor(ctx, sx, sy, d.variant); break;
      case 'launderTape': drawLaunderTape(ctx, sx, sy); break;
      case 'sewerShroom': drawSewerShroom(ctx, sx, sy, d.variant, frame); break;
      case 'mossTuft': drawMossTuft(ctx, sx, sy, d.variant); break;
      case 'slotFacade': drawSlotFacade(ctx, sx, sy, d.variant, frame); break;
      case 'chipStack': drawChipStack(ctx, sx, sy, d.variant); break;
      case 'cardLean': drawCardLean(ctx, sx, sy, d.variant); break;
      case 'allInArrow': drawAllInArrow(ctx, sx, sy, d.variant, frame); break;
      case 'velvetRope': drawVelvetRope(ctx, sx, sy); break;
      case 'chipScatter': drawChipScatter(ctx, sx, sy, d.variant); break;
      case 'impeachStatue': drawImpeachStatue(ctx, sx, sy, d.variant); break;
      case 'ballotCrenel': drawBallotCrenel(ctx, sx, sy, d.variant); break;
      case 'chainedDoor': drawChainedDoor(ctx, sx, sy); break;
      case 'wallTorch': drawWallTorch(ctx, sx, sy, d.variant, frame); break;
      case 'graffiti': drawGraffiti(ctx, sx, sy, d.variant); break;
      case 'emberTuft': drawEmberTuft(ctx, sx, sy, d.variant, frame); break;
      default: {
        const _exhaustive: never = d;
        throw new Error(`drawDecor: unknown decor kind '${(_exhaustive as { kind: string }).kind}'`);
      }
    }
  }
}
