import type { GameEvent, Solidity, TileKind } from './types.ts';

// ============================================================================
// THE TUNING TABLE. Every gameplay number lives here, documented.
// Units: pixels, pixels/frame, frames — at a fixed 60 Hz.
// Tuning philosophy (settled): generous. "It's not a precision game."
// ============================================================================

export const VIEW_W = 640;
export const VIEW_H = 360;
export const TILE = 16;
/** Default world height in tiles (rows). Rows grow downward. */
export const WORLD_H_TILES = 36;

// ---------------------------------------------------------------------------
// Player physics. Speed caps stay WELL below TILE per frame — the collision
// sensors probe one tile ahead; faster than that tunnels through walls.
// ---------------------------------------------------------------------------
export const PHYS = {
  // Speed philosophy: the view shows 40 tiles (vs the NES's 16), so px/frame
  // numbers copied from the classics READ 2.5x slower here. Tune for
  // screen-relative motion — snappy spin-up, brisk top speed (playtest:
  // "really slow for walking... not the expected feeling of a mario like").
  // Caps must stay well under TILE=16/frame (collision probes one tile).
  /** Ground acceleration per frame while below the applicable max. */
  acc: 0.14,
  /** Extra acceleration multiplier while `run` held. */
  runBoost: 1.6,
  walkMax: 2.1,
  runMax: 3.8,
  /** Deceleration when skidding (holding the opposite direction). */
  skid: 0.36,
  /** Ground friction with no input. */
  frc: 0.1,
  airAcc: 0.13,
  /** Gravity while rising with jump held (variable jump height). */
  gravHold: 0.17,
  /** Gravity otherwise. */
  grav: 0.42,
  maxFall: 7,
  /** Initial jump impulse (negative = up). Slightly stronger at full run.
   *  NOTE: full-held height is a LEVEL-GEOMETRY CONTRACT — 30 gated acts are
   *  calibrated against it (a 4% trim broke w4a2's climb). Tune jump FEEL via
   *  jumpCut below; touch this only alongside a full world re-tune. */
  jump: -6.7,
  jumpRunBonus: -0.6,
  /** Releasing jump while rising clamps upward speed to this — the jump-CUT
   *  that makes tap-vs-hold height control real (playtest: taps flew too
   *  high without it, and the full jump was "slightly too high"). */
  jumpCut: 2.6,
  /** Frames after leaving a ledge where a jump still works (coyote time). */
  coyote: 6,
  /** Frames a jump press is buffered before landing. */
  jumpBuffer: 6,
  /** Stomp bounce: normal, and when jump is held. */
  bounce: -4.2,
  bounceHold: -6.8,
  /** AABB half-extents [halfW, halfH] per size. Duck halves certified height. */
  smallHalf: [6, 7] as const,
  bigHalf: [6, 13] as const,
  duckHalf: [6, 7] as const,
  /** Post-hurt invulnerability (generous). */
  invuln: 120,
  /** Parliamentary Immunity duration. */
  immunity: 600,
  /** Pen projectile speed / lifetime / max live pens. */
  penSpeed: 5,
  penLife: 90,
  penMax: 2,
  /** Auto-fire cadence: holding `run` keeps throwing every N frames (classic
   *  hold-to-fire, playtest ask); a fresh press always fires immediately. */
  penRepeat: 12,
  springVy: -11.5,
} as const;

// ---------------------------------------------------------------------------
// Camera. Hero sits left of center (the game runs rightward), ~55% of view
// height. Overscroll above row 0 so sky routes don't pin the hero high.
// ---------------------------------------------------------------------------
export const CAMERA = {
  anchorX: VIEW_W * 0.38,
  anchorY: VIEW_H * 0.55,
  deadzoneX: 24,
  deadzoneY: 40,
  maxPan: 16,
  overscrollTop: 48,
} as const;

// ---------------------------------------------------------------------------
// Juice. Hit-stop ONLY for hits the player LANDS. Damage taken never freezes.
// Reduced motion: shake off, particles halved, hit-stop clamped to 2 (not 0).
// ---------------------------------------------------------------------------
export const JUICE = {
  maxHitStop: 10,
  reducedHitStop: 2,
  stompStop: 3,
  bossHitStop: 8,
  maxShake: 6,
} as const;

/** Ambient emitters (own clock, not player-triggered) must be closer than
 *  this to the player or stay silent. The idle-silence test enforces it. */
export const AMBIENT_RANGE = 420;

/** Backtrack slack: the camera ratchets forward; the world closes this many
 *  pixels behind the furthest advance. Collectibles must be forward-reachable. */
export const BACKTRACK_SLACK = 560;

// ---------------------------------------------------------------------------
// Tile solidity — exhaustive: a new TileKind does not compile until it
// declares its solidity here.
// ---------------------------------------------------------------------------
export const SOLIDITY: Record<TileKind, Solidity> = {
  empty: 'pass',
  ground: 'solid',
  bedrock: 'solid',
  brick: 'solid',
  qblock: 'solid',
  usedblock: 'solid',
  oneway: 'oneway',
  pipe: 'solid',
  spike: 'spike',
  lava: 'lava',
  crumble: 'solid',
};

// ---------------------------------------------------------------------------
// Event juice policy: which LANDED-hit events may freeze the world.
// Exhaustiveness lives in the fx/sfx tables (Record<GameEvent, …>); this is
// the single allow-list for hit-stop so damage taken can never freeze.
// ---------------------------------------------------------------------------
export const HIT_STOP: Partial<Record<GameEvent, number>> = {
  stomp: JUICE.stompStop,
  'boss-hit': JUICE.bossHitStop,
  'boss-defeat': JUICE.maxHitStop,
};

// ---------------------------------------------------------------------------
// Structure the act contract enforces (counts per act).
// ---------------------------------------------------------------------------
export const ACT_RULES = {
  goldbars: 5,
  secrets: 3,
  minCheckpoints: 1,
  minCoins: 40,
  minEnemies: 3,
  /** Flow bot must clear the act within this many frames. */
  botFrames: 9000,
  /** Idle player for this many frames must produce zero events. */
  idleFrames: 600,
} as const;

export const STORAGE_KEYS = {
  settings: 'sme.settings.v1',
  progress: 'sme.progress.v1',
} as const;

/** Boss staged-fight tuning. */
export const BOSS = {
  hp: 3,
  rageHp: 5,
  shotEvery: 150,
  rageShotEvery: 90,
  hopVx: 1.2,
  rageHopVx: 1.9,
} as const;
