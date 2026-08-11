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
  // studio props — THE WORLD IS A SET (every theme; density scales by theme)
  | DecorOf<'propStick'>       // cardboard bush/cloud/shroom on a visible stick
  | DecorOf<'tapePatch'>       // duct-tape X slapped on a nearby prop
  | DecorOf<'propTag'>         // 'CLOUD (PROP)' price/name tag hanging off decor
  | DecorOf<'clapperboard'>    // 'RESCUE ATTEMPT — TAKE n'
  | DecorOf<'cueCards'>        // front: Estrada's lines, scattered on the floor
  | DecorOf<'stageLight'>      // tripod spotlight, warm glow ellipse
  | DecorOf<'cableRun'>        // front: black cable taped across the ground
  | DecorOf<'wetPaint'>        // sign + bucket + drips
  | DecorOf<'cardboardToadAudience'> // flat cutout crowd on a stand, some fallen
  | DecorOf<'paperCastle'>     // tiny obviously-2D castle; sometimes edge-on
  | DecorOf<'sandbagPile'>
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
  propStick: 'back',
  tapePatch: 'back',
  propTag: 'back',
  clapperboard: 'back',
  cueCards: 'front',
  stageLight: 'back',
  cableRun: 'front',
  wetPaint: 'back',
  cardboardToadAudience: 'back',
  paperCastle: 'back',
  sandbagPile: 'back',
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
/** Off-screen culling margin in px (widest decor: the cardboard Toad
 *  audience and the cable run, ~88px total — keep every kind inside this). */
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

// ---------------------------------------------------------------------------
// THE WORLD IS A SET — a second, sparser stream of studio-prop gags runs on
// its own cadence: roughly one gag per GAG_EVERY eligible columns. The set
// dressing gets denser (lazier) each world: by the castle they stopped even
// pretending. tapePatch/propTag never spawn alone — they are slapped onto a
// just-placed prop with TAG_CHANCE. All exhaustive Records over ThemeId.
// ---------------------------------------------------------------------------

const GAG_EVERY: Record<ThemeId, number> = {
  meadow: 25,
  sewer: 20,
  casino: 16,
  castle: 12,
};

/** Chance a placed back prop gets a duct-tape patch or a prop tag on it. */
const TAG_CHANCE: Record<ThemeId, number> = {
  meadow: 0.12,
  sewer: 0.18,
  casino: 0.25,
  castle: 0.35,
};

/** Chance an organic prop (bush / sewerShroom) is actually the cardboard
 *  cutout-on-a-stick version. The set dresser is not good. */
const PROP_STICK_CHANCE = 0.3;

const THEME_GAGS: Record<ThemeId, readonly BackEntry[]> = {
  meadow: [ // Estrada's hero-movie set: film gear everywhere, still "hidden"
    { kind: 'stageLight', weight: 2, wide: false },
    { kind: 'clapperboard', weight: 1.6, wide: false },
    { kind: 'cueCards', weight: 1.4, wide: false },
    { kind: 'sandbagPile', weight: 1.4, wide: false },
    { kind: 'wetPaint', weight: 1.2, wide: false },
    { kind: 'paperCastle', weight: 1, wide: false },
    { kind: 'propStick', weight: 0.9, wide: false },
    { kind: 'cableRun', weight: 0.9, wide: true },
    { kind: 'cardboardToadAudience', weight: 0.8, wide: true },
  ],
  sewer: [ // Trump's back office: cables and sandbags, zero housekeeping
    { kind: 'stageLight', weight: 1.8, wide: false },
    { kind: 'cableRun', weight: 1.6, wide: true },
    { kind: 'sandbagPile', weight: 1.5, wide: false },
    { kind: 'wetPaint', weight: 1.3, wide: false },
    { kind: 'clapperboard', weight: 1.2, wide: false },
    { kind: 'cueCards', weight: 1, wide: false },
    { kind: 'propStick', weight: 0.8, wide: false },
    { kind: 'cardboardToadAudience', weight: 0.6, wide: true },
    { kind: 'paperCastle', weight: 0.5, wide: false },
  ],
  casino: [ // the show floor: lights, a fake crowd of winners
    { kind: 'stageLight', weight: 2.2, wide: false },
    { kind: 'cableRun', weight: 1.5, wide: true },
    { kind: 'clapperboard', weight: 1.3, wide: false },
    { kind: 'cueCards', weight: 1.2, wide: false },
    { kind: 'sandbagPile', weight: 1.2, wide: false },
    { kind: 'wetPaint', weight: 1.2, wide: false },
    { kind: 'cardboardToadAudience', weight: 1.1, wide: true },
    { kind: 'paperCastle', weight: 0.8, wide: false },
    { kind: 'propStick', weight: 0.8, wide: false },
  ],
  castle: [ // they stopped trying
    { kind: 'sandbagPile', weight: 2, wide: false },
    { kind: 'stageLight', weight: 2, wide: false },
    { kind: 'cableRun', weight: 1.8, wide: true },
    { kind: 'wetPaint', weight: 1.5, wide: false },
    { kind: 'clapperboard', weight: 1.4, wide: false },
    { kind: 'cardboardToadAudience', weight: 1.4, wide: true },
    { kind: 'paperCastle', weight: 1.3, wide: false },
    { kind: 'cueCards', weight: 1.2, wide: false },
    { kind: 'propStick', weight: 1, wide: false },
  ],
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

/** Build a Decor from a runtime-picked kind. Every DecorOf<K> member has this
 *  exact shape, but TS only auto-distributes union-typed discriminant literals
 *  up to 25 constituents — past that (we are) the assertion is required. The
 *  kind is statically DecorKind, so the closed set still holds; drawDecor's
 *  layer lookup + never guard keep the runtime loud. */
function makeDecor(kind: DecorKind, x: number, y: number, variant: number): Decor {
  return { kind, x, y, variant } as Decor;
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
  const gagTable = THEME_GAGS[theme];
  const gagEvery = GAG_EVERY[theme];
  const tagChance = TAG_CHANCE[theme];
  if (!backTable || !frontKind || !gagTable || gagEvery === undefined || tagChance === undefined) {
    throw new Error(`buildDecor: unknown theme '${String(theme)}'`);
  }
  const rng = createRng((seed ^ RNG_STREAM.decor) >>> 0);
  const out: Decor[] = [];
  let gap = 0;
  // Studio-prop gag stream: counts down eligible columns, ~1 gag per gagEvery.
  let gagCool = Math.floor(gagEvery / 2);

  for (let tx = 2; tx < map.wTiles - 2; tx++) {
    const ty = surfaceRow(map, tx);
    if (ty === null || ty < 3) continue;
    const x = tx * TILE + TILE / 2;
    const y = ty * TILE; // base line = top of the surface tile
    const headroom = map.tileAt(tx, ty - 1) === 'empty' && map.tileAt(tx, ty - 2) === 'empty';
    let placedHere = false;

    if (gap > 0) gap--;
    else if (rng() < BACK_CHANCE) {
      // headroom: two clear tiles above the surface
      if (headroom) {
        const entry = pickWeighted(rng, backTable);
        const fits = !entry.wide
          || (map.tileAt(tx - 1, ty) === 'ground' && map.tileAt(tx + 1, ty) === 'ground'
            && map.tileAt(tx - 1, ty - 1) === 'empty' && map.tileAt(tx + 1, ty - 1) === 'empty');
        if (fits) {
          // THE WORLD IS A SET: organic props are sometimes the cardboard
          // cutout-on-a-stick version. Nobody on the crew can tell the
          // difference; the player can.
          const kind: DecorKind =
            (entry.kind === 'bush' || entry.kind === 'sewerShroom') && rng() < PROP_STICK_CHANCE
              ? 'propStick'
              : entry.kind;
          out.push(makeDecor(kind, x, y, Math.floor(rng() * 1000)));
          // ...and props arrive patched with duct tape or still price-tagged.
          if (rng() < tagChance) {
            const overlay: DecorKind = rng() < 0.55 ? 'tapePatch' : 'propTag';
            out.push(makeDecor(overlay, x, y, Math.floor(rng() * 1000)));
          }
          gap = BIG_KINDS.has(entry.kind) ? BIG_GAP : SMALL_GAP;
          placedHere = true;
        }
      }
    }

    // The studio-prop gag stream — independent cadence, never doubling up on
    // a column that just got a prop.
    if (gagCool > 0) gagCool--;
    else if (!placedHere && headroom) {
      const g = pickWeighted(rng, gagTable);
      const gagFits = !g.wide
        || (map.tileAt(tx - 1, ty) === 'ground' && map.tileAt(tx + 1, ty) === 'ground'
          && map.tileAt(tx - 1, ty - 1) === 'empty' && map.tileAt(tx + 1, ty - 1) === 'empty');
      if (gagFits) {
        out.push(makeDecor(g.kind, x, y, Math.floor(rng() * 1000)));
        gagCool = gagEvery + Math.floor(rng() * 9) - 4;
      }
    }

    if (rng() < FRONT_CHANCE && map.tileAt(tx, ty - 1) === 'empty') {
      out.push(makeDecor(frontKind, x, y, Math.floor(rng() * 1000)));
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

// --- studio props (every theme) — THE WORLD IS A SET -----------------------

/** Raw-cardboard edge color: every cutout wears it like a confession. */
const CARDBOARD_EDGE = '#d8cfae';
/** Duct tape. The other load-bearing material. */
const DUCT_TAPE = 'rgba(196,193,182,0.92)';

function drawPropStick(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const face = v % 3; // 0 bush, 1 cloud, 2 mushroom — the crew grabbed whatever
  const flip = v % 7 === 0; // mounted upside down; nobody checked
  // stick + A-frame base: the landscape is freestanding
  ctx.fillStyle = '#8a6a42';
  ctx.fillRect(x - 1.5, y - 15, 3, 15);
  ctx.strokeStyle = '#6f5433';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 7, y);
  ctx.lineTo(x, y - 6);
  ctx.lineTo(x + 7, y);
  ctx.stroke();
  ctx.save();
  ctx.translate(x, y - 20);
  if (flip) ctx.scale(1, -1);
  ctx.lineWidth = 1;
  if (face === 0) {
    // cardboard bush
    ctx.fillStyle = '#4d9c3a';
    ctx.beginPath();
    ctx.arc(-6, 2, 5, 0, Math.PI * 2);
    ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
    ctx.arc(6, 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = CARDBOARD_EDGE;
    ctx.stroke();
  } else if (face === 1) {
    // a cloud. On a stick. Planted in the ground. Sure.
    ctx.fillStyle = '#f4f4f2';
    ctx.beginPath();
    ctx.arc(-7, 2, 4.5, 0, Math.PI * 2);
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.arc(7, 2, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#cfc7b0';
    ctx.stroke();
  } else {
    // cardboard mushroom
    ctx.fillStyle = '#efe2c8';
    ctx.fillRect(-2.5, -1, 5, 7);
    ctx.fillStyle = '#c65b4e';
    ctx.beginPath();
    ctx.arc(0, -1, 7, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = CARDBOARD_EDGE;
    ctx.stroke();
    ctx.fillStyle = '#f5f5f0';
    ctx.beginPath();
    ctx.arc(-3, -4, 1.7, 0, Math.PI * 2);
    ctx.arc(3, -3.5, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // the tape doing the load-bearing
  ctx.fillStyle = DUCT_TAPE;
  ctx.fillRect(x - 3, y - 16, 6, 3);
}

function drawTapePatch(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const px = x + ((v % 13) - 6);
  const py = y - 7 - (v % 9);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(((v % 7) - 3) * 0.09);
  ctx.fillStyle = DUCT_TAPE;
  ctx.save();
  ctx.rotate(0.78);
  ctx.fillRect(-8, -2.2, 16, 4.4);
  ctx.restore();
  ctx.rotate(-0.78);
  ctx.fillRect(-8, -2.2, 16, 4.4);
  // torn ends
  ctx.fillStyle = 'rgba(160,157,146,0.9)';
  ctx.fillRect(6.5, -2.2, 1.5, 4.4);
  ctx.fillRect(-8, -2.2, 1.5, 4.4);
  ctx.restore();
}

const TAG_TEXTS = ['CLOUD (PROP)', 'BUSH (PROP)', 'SCENERY #7', '$4.99', 'RENT-A-CASTLE', 'RETURN BY FRI'] as const;

function drawPropTag(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const tx = x + 6 + (v % 5);
  const ty = y - 12 - (v % 7);
  // string still tied to the prop
  ctx.strokeStyle = '#b8b0a0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tx - 5, ty - 7);
  ctx.quadraticCurveTo(tx - 1, ty - 4, tx, ty - 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(((v % 5) - 2) * 0.12);
  ctx.fillStyle = '#f7f2df';
  ctx.fillRect(-16, -2, 34, 9);
  ctx.strokeStyle = '#c9c0a4';
  ctx.strokeRect(-16, -2, 34, 9);
  ctx.fillStyle = '#8a8578';
  ctx.fillRect(-14, 1.5, 2, 2); // punched hole
  label(ctx, TAG_TEXTS[v % TAG_TEXTS.length]!, 2, 2.8, 4, '#a03030');
  ctx.restore();
}

function drawClapperboard(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((v % 2 === 0 ? 1 : -1) * 0.1);
  // slate left leaning on the ground between takes
  ctx.fillStyle = '#1e1e24';
  ctx.fillRect(-14, -16, 28, 16);
  ctx.strokeStyle = '#3c3c46';
  ctx.lineWidth = 1;
  ctx.strokeRect(-14, -16, 28, 16);
  // clap bar, open a crack — mid-take, forever
  ctx.save();
  ctx.translate(-14, -16);
  ctx.rotate(-0.16);
  ctx.fillStyle = '#1e1e24';
  ctx.fillRect(0, -5, 28, 5);
  ctx.fillStyle = '#e8e8e8';
  for (let s = 0; s < 4; s++) {
    ctx.beginPath();
    ctx.moveTo(2 + s * 7, -5);
    ctx.lineTo(6 + s * 7, -5);
    ctx.lineTo(4 + s * 7, 0);
    ctx.lineTo(s * 7, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  label(ctx, 'RESCUE ATTEMPT', 0, -12, 4, '#e8e8e8');
  label(ctx, `TAKE ${2 + (v % 45)}`, 0, -5.5, 5, '#ffd23f');
  ctx.restore();
}

const CUE_TEXTS = ['MAMMA MIA!', 'LOOK SAD', 'ARRIVE LATE', 'HERO POSE'] as const;

function drawCueCards(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  for (let c = 0; c < 2 + (v % 2); c++) {
    const cx = x + (c - 1) * 8 + ((v >> c) % 3) - 1;
    ctx.save();
    ctx.translate(cx, y);
    ctx.rotate((((v + c * 3) % 5) - 2) * 0.16);
    ctx.fillStyle = '#f5f2e4';
    ctx.fillRect(-5, -7, 10, 7);
    ctx.strokeStyle = '#c9c4ae';
    ctx.lineWidth = 1;
    ctx.strokeRect(-5, -7, 10, 7);
    // scribbles
    ctx.strokeStyle = '#8a8a95';
    ctx.beginPath();
    ctx.moveTo(-3, -4);
    ctx.lineTo(3, -4);
    ctx.moveTo(-3, -2.5);
    ctx.lineTo(2, -2.5);
    ctx.stroke();
    ctx.restore();
  }
  // the top card is legible — Estrada needs his lines
  label(ctx, CUE_TEXTS[v % CUE_TEXTS.length]!, x, y - 10, 4, '#55524a');
}

function drawStageLight(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, frame: number): void {
  const dir = v % 2 === 0 ? 1 : -1;
  const hx = x + dir * 2;
  const hy = y - 33;
  // warm glow first, so the hardware reads on top of its own light
  const gl = (0.09 + 0.02 * Math.sin(frame * 0.05 + v)).toFixed(3);
  ctx.fillStyle = `rgba(255,214,140,${gl})`;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(x + dir * 36, y);
  ctx.lineTo(x + dir * 8, y);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + dir * 23, y - 1, 15, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // tripod
  ctx.strokeStyle = '#2c2c34';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 7, y);
  ctx.lineTo(x, y - 26);
  ctx.moveTo(x + 7, y);
  ctx.lineTo(x, y - 26);
  ctx.moveTo(x, y - 26);
  ctx.lineTo(x, y - 31);
  ctx.stroke();
  // head with barn doors, tilted at the action
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(dir * 0.5);
  ctx.fillStyle = '#33333b';
  ctx.fillRect(-6, -5, 12, 10);
  ctx.fillStyle = '#ffd894';
  ctx.fillRect(4, -4, 2, 8); // the lens, glowing
  ctx.strokeStyle = '#33333b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(6, -5);
  ctx.lineTo(10, -8);
  ctx.moveTo(6, 5);
  ctx.lineTo(10, 8);
  ctx.stroke();
  ctx.restore();
}

function drawCableRun(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  // black cable taped across the ground; the crew calls this "safe"
  ctx.strokeStyle = '#17171c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 34, y - 1);
  for (let s = 0; s < 4; s++) {
    const x0 = x - 34 + s * 17;
    ctx.quadraticCurveTo(x0 + 8.5, y - 4 - ((v + s) % 2), x0 + 17, y - 1);
  }
  ctx.stroke();
  // duct tape strips pinning it down
  ctx.fillStyle = DUCT_TAPE;
  for (let s = 0; s <= 4; s++) ctx.fillRect(x - 36 + s * 17, y - 4, 4, 5);
}

const PAINT_COLORS = ['#4d9c3a', '#5aa7e0', '#c62828'] as const;

function drawWetPaint(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const paint = PAINT_COLORS[v % PAINT_COLORS.length]!;
  // stake sign
  ctx.save();
  ctx.translate(x - 6, y);
  ctx.rotate(((v % 5) - 2) * 0.05);
  ctx.fillStyle = '#8a6a42';
  ctx.fillRect(-1, -14, 2, 14);
  ctx.fillStyle = '#fdf6e3';
  ctx.fillRect(-14, -23, 28, 10);
  ctx.strokeStyle = '#c9b992';
  ctx.lineWidth = 1;
  ctx.strokeRect(-14, -23, 28, 10);
  label(ctx, 'WET PAINT', 0, -18, 5, '#c62828');
  // drips off the sign — painted with the same wet paint
  ctx.fillStyle = paint;
  ctx.fillRect(-8, -13, 1.5, 4 + (v % 3));
  ctx.fillRect(4, -13, 1.5, 3 + (v % 4));
  ctx.restore();
  // bucket, tipped slightly, with a spill
  ctx.save();
  ctx.translate(x + 9, y);
  ctx.rotate(-0.08);
  ctx.fillStyle = '#7d848f';
  ctx.beginPath();
  ctx.moveTo(-5, -9);
  ctx.lineTo(5, -9);
  ctx.lineTo(4, 0);
  ctx.lineTo(-4, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = paint;
  ctx.fillRect(-4.5, -9, 9, 2); // paint at the brim
  ctx.restore();
  ctx.fillStyle = paint;
  ctx.beginPath();
  ctx.ellipse(x + 15, y - 1, 6, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawCardboardToadAudience(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  // the stand: one long plank the "crowd" clips into
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(x - 40, y - 2, 80, 2);
  for (let t = 0; t < 5; t++) {
    const tx = x - 32 + t * 16;
    const fallen = ((v >> t) & 1) === 1 && (t === 1 || t === 3);
    // brace behind the standing ones (drawn first, so it reads as behind)
    if (!fallen && (v + t) % 2 === 0) {
      ctx.strokeStyle = '#6f5433';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx + 4, y - 2);
      ctx.lineTo(tx, y - 9);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(tx, y - 2);
    if (fallen) ctx.rotate(1.35 + ((v + t) % 3) * 0.08);
    // flat cutout Toad: body, cap, printed-on enthusiasm
    ctx.strokeStyle = CARDBOARD_EDGE;
    ctx.lineWidth = 1;
    ctx.fillStyle = '#efe2c8';
    ctx.fillRect(-3, -8, 6, 8);
    ctx.strokeRect(-3, -8, 6, 8);
    ctx.fillStyle = '#f5f5f0';
    ctx.beginPath();
    ctx.arc(0, -9, 5.5, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = (v + t) % 2 === 0 ? '#c65b4e' : '#4d6c9c';
    ctx.beginPath();
    ctx.arc(-2.5, -10.5, 1.6, 0, Math.PI * 2);
    ctx.arc(2.5, -10.5, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-1.8, -7.5, 1, 1.5);
    ctx.fillRect(0.8, -7.5, 1, 1.5);
    ctx.restore();
  }
}

function drawPaperCastle(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  if (v % 4 === 0) {
    // seen edge-on: forced perspective at its most forced. It's paper.
    ctx.strokeStyle = '#6f5433';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x - 1, y - 13);
    ctx.stroke();
    ctx.fillStyle = '#57525f';
    ctx.fillRect(x - 1, y - 24, 2, 24);
    ctx.fillStyle = '#9a94a5';
    ctx.fillRect(x + 1, y - 24, 1, 24); // the entire visible "front"
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((v % 5) - 2) * 0.04);
  // wooden strut propping it from behind
  ctx.strokeStyle = '#6f5433';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(5, -16);
  ctx.stroke();
  // flat little "distant" castle, standing right there on the lawn
  ctx.fillStyle = '#8d8798';
  ctx.fillRect(-9, -16, 18, 16);
  ctx.fillRect(-14, -22, 6, 22);
  ctx.fillRect(8, -22, 6, 22);
  for (let c = 0; c < 3; c++) ctx.fillRect(-7 + c * 6, -19, 3, 3);
  ctx.fillStyle = '#a03030';
  ctx.beginPath();
  ctx.moveTo(-15, -22);
  ctx.lineTo(-11, -29);
  ctx.lineTo(-7, -22);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(7, -22);
  ctx.lineTo(11, -29);
  ctx.lineTo(15, -22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4f4a58';
  ctx.fillRect(-2.5, -7, 5, 7);
  // raw cardboard edge
  ctx.strokeStyle = CARDBOARD_EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(-9, -16, 18, 16);
  ctx.restore();
}

/** Bag spots: up to 3 on the ground row, a 4th on top. */
const SANDBAG_SPOTS = [[-11, -4], [1, -4], [12, -5], [-5, -11]] as const;

function drawSandbagPile(ctx: CanvasRenderingContext2D, x: number, y: number, v: number): void {
  const n = 2 + (v % 3);
  for (let s = 0; s < n; s++) {
    const spot = SANDBAG_SPOTS[s];
    if (!spot) throw new Error('drawSandbagPile: bag spot bookkeeping broke');
    ctx.save();
    ctx.translate(x + spot[0], y + spot[1]);
    ctx.rotate((((v + s * 3) % 5) - 2) * 0.08);
    ctx.fillStyle = s % 2 === 0 ? '#b3a273' : '#a4925f';
    ctx.beginPath();
    ctx.ellipse(0, 0, 7.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // cinch stitch + tied ear
    ctx.strokeStyle = '#8a7a4d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(7, 0);
    ctx.stroke();
    ctx.fillStyle = '#8a7a4d';
    ctx.fillRect(6, -2.5, 2.5, 2.5);
    ctx.restore();
  }
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
      case 'propStick': drawPropStick(ctx, sx, sy, d.variant); break;
      case 'tapePatch': drawTapePatch(ctx, sx, sy, d.variant); break;
      case 'propTag': drawPropTag(ctx, sx, sy, d.variant); break;
      case 'clapperboard': drawClapperboard(ctx, sx, sy, d.variant); break;
      case 'cueCards': drawCueCards(ctx, sx, sy, d.variant); break;
      case 'stageLight': drawStageLight(ctx, sx, sy, d.variant, frame); break;
      case 'cableRun': drawCableRun(ctx, sx, sy, d.variant); break;
      case 'wetPaint': drawWetPaint(ctx, sx, sy, d.variant); break;
      case 'cardboardToadAudience': drawCardboardToadAudience(ctx, sx, sy, d.variant); break;
      case 'paperCastle': drawPaperCastle(ctx, sx, sy, d.variant); break;
      case 'sandbagPile': drawSandbagPile(ctx, sx, sy, d.variant); break;
      default: {
        const _exhaustive: never = d;
        throw new Error(`drawDecor: unknown decor kind '${(_exhaustive as { kind: string }).kind}'`);
      }
    }
  }
}
