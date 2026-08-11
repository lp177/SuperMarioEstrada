// ============================================================================
// THE CONTRACT FILE.
// Every cross-module type, interface and id union lives here. Zero imports,
// zero side effects. Extend this file FIRST when adding a feature, run tsc to
// see exactly which modules break, then implement. During parallel agent work
// this file is FROZEN — agents implement against it, they do not edit it.
// ============================================================================

// ---------------------------------------------------------------------------
// Id unions. Closed lists: adding a member forces (via exhaustive Records and
// `never` guards downstream) every table that must know about it to be updated.
// ---------------------------------------------------------------------------

export type ThemeId = 'meadow' | 'sewer' | 'casino' | 'castle';

export type SceneName = 'title' | 'levelselect' | 'cutscene' | 'level';

export type TrackId =
  | 'title'
  | 'meadow'
  | 'sewer'
  | 'casino'
  | 'castle'
  | 'boss'
  | 'cutscene'
  | 'ending';

export type CutsceneId = 'intro' | 'w1-end' | 'w2-end' | 'w3-end' | 'ending';

/** Procedural full-screen illustrations used by cutscene beats. */
export type CutsceneArtId =
  | 'bet-shop'        // Toads queueing to bet at "TOAD'S BETS", coins flowing
  | 'notary'          // Estrada in notary disguise stamping bet slips
  | 'dungeon'         // the real Peach in the rat/skeleton dungeon
  | 'wardrobe'        // Trump putting on the dress/wig; shell on a stand
  | 'staged-kidnap'   // Bowsonaro theatrically carrying Impeach away
  | 'hero-speech'     // Estrada's balcony speech to terrified Toads
  | 'mangiani-joins'  // Mangiani with a tiny backpack, determined
  | 'too-late'        // castle door, "she is in another castle", coffee cup
  | 'big-hands'       // Impeach waving; hands enormous; Mangiani squinting
  | 'ballot-rant'     // Bowsonaro ranting at a podium with turtle minions
  | 'coffee-break'    // Estrada on a break while the castle burns behind
  | 'wig-falls'       // the wig slips in front of everyone
  | 'peach-freed'     // Mangiani opens the dungeon; real Peach steps out
  | 'jail'            // the three conspirators in one cell, still scheming
  ;

export type EnemyKind =
  | 'lobbyist'   // walking briefcase (goomba-class); stompable
  | 'pollster'   // turtle with a red cap; stomp -> ballot-box shell, kickable
  | 'lawyer'     // carnivorous plant in a pipe; rises/sinks, not stompable
  | 'paparazzo'  // flying camera drone; swoops in sine waves
  | 'rat'        // sewer scurrier, fast, small hitbox
  | 'chipstack'  // hopping stack of casino chips
  | 'gavel'      // giant judge gavel crusher (thwomp-class); not stompable
  ;

export type PowerupKind =
  | 'stamp'     // notary stamp -> grow to Certified
  | 'goldpen'   // golden pen -> throw exploding pens
  | 'immunity'  // Parliamentary Immunity: timed invincibility
  ;

export type PlayerSize = 'small' | 'certified' | 'goldpen';

/** Everything the player and level can announce. The sfx table, the fx table
 *  and the event-source map are exhaustive over this union — a new event does
 *  not compile until every table has declared what it does (possibly null). */
export type GameEvent =
  // player feel
  | 'jump' | 'land' | 'skid' | 'stomp'
  // pickups & blocks
  | 'coin' | 'certify' | 'goldbar' | 'secret'
  | 'block-bump' | 'block-empty' | 'brick-break'
  | 'powerup-appear' | 'powerup-grab'
  // combat
  | 'pen-throw' | 'pen-hit' | 'shell-kick' | 'enemy-flip'
  | 'hurt' | 'die' | 'respawn'
  // world objects
  | 'spring' | 'pipe' | 'checkpoint' | 'goal' | 'flag-plant' | 'crumble'
  // ambient (MUST be distance-gated by the emitter)
  | 'drip' | 'slot-spin' | 'gavel-slam' | 'lava-bubble'
  // boss
  | 'boss-intro' | 'boss-hit' | 'boss-shot' | 'boss-escape' | 'boss-defeat'
  | 'gate-slam'
  // UI / cutscene (no world position; fx entries are null)
  | 'ui-move' | 'ui-select' | 'ui-back' | 'text-blip'
  ;

/** Rebindable actions. Bindings store KeyboardEvent.code (physical position). */
export type ActionId = 'left' | 'right' | 'up' | 'down' | 'jump' | 'run' | 'pause';

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export type WorldNo = 1 | 2 | 3 | 4;
export type ActNo = 1 | 2 | 3 | 4;
/** Stable string id — progress is keyed by THIS, never by array index. */
export type LevelId = `w${WorldNo}a${ActNo}`;

/** Tile kinds. The solidity of each kind lives in SOLIDITY (constants.ts). */
export type TileKind =
  | 'empty'
  | 'ground'      // themed terrain block
  | 'bedrock'     // unbreakable floor/wall filler (also out-of-bounds)
  | 'brick'       // breakable when Certified; bumpable when small
  | 'qblock'      // question block: contents in Level.blockContents
  | 'usedblock'   // spent qblock
  | 'oneway'      // jump-through platform (solid from above only)
  | 'pipe'        // pipe body (solid); visual caps handled by painter
  | 'spike'       // hazard: hurts on contact
  | 'lava'        // hazard: kills on contact
  | 'crumble'     // crumbles shortly after being stood on
  ;

export type Solidity = 'pass' | 'solid' | 'oneway' | 'spike' | 'lava';

export interface TileMapLike {
  readonly wTiles: number;
  readonly hTiles: number;
  readonly pixelW: number;
  readonly pixelH: number;
  /** Tile kind at tile coords; out-of-bounds returns 'bedrock' (solid on all
   *  sides) except open sky above the map top, which returns 'empty'. */
  tileAt(tx: number, ty: number): TileKind;
  setTile(tx: number, ty: number, k: TileKind): void;
  /** Solidity sampled at a pixel position. */
  solidAtPx(px: number, py: number): Solidity;
}

/** What a qblock releases when bumped. */
export type BlockContents = 'coin' | PowerupKind;

export interface SpawnPoint { x: number; y: number }

/** The authoring surface for acts. ALL units are TILES unless suffixed Px.
 *  Rows grow downward; row 0 is the sky, row (height-1) the lowest bedrock. */
export interface LevelBuilderLike {
  readonly widthTiles: number;
  readonly heightTiles: number;
  /** Solid themed ground from x0..x1 inclusive, surface at `row`, filled to
   *  bedrock below. Carving a pit = simply not laying ground there. */
  ground(x0: number, x1: number, row: number): void;
  /** A floating strip of solid blocks. */
  platform(x0: number, x1: number, row: number, kind?: 'ground' | 'brick'): void;
  /** Jump-through platform strip. */
  oneway(x0: number, x1: number, row: number): void;
  brick(x: number, row: number): void;
  qblock(x: number, row: number, contents: BlockContents): void;
  /** Vertical pipe: top opening at `row`, extends down `h` tiles. Optional
   *  lawyer plant. Pipes are decor+collision, not warps, unless linked. */
  pipe(x: number, row: number, h: number, opts?: { lawyer?: boolean }): void;
  spikes(x0: number, x1: number, row: number): void;
  lava(x0: number, x1: number, row: number): void;
  crumble(x0: number, x1: number, row: number): void;
  /** Ascending stairs of solid blocks, one tile per column. dir +1 = up-right. */
  steps(x: number, row: number, n: number, dir: 1 | -1): void;
  coin(x: number, row: number): void;
  coinRow(x0: number, x1: number, row: number): void;
  /** One of the act's 5 gold bars (big collectible). Index 0..4, each once. */
  goldbar(index: number, x: number, row: number): void;
  /** One of the act's 3 secrets: a hidden pocket that pops a fanfare. */
  secret(index: number, x: number, row: number): void;
  enemy(kind: EnemyKind, x: number, row: number): void;
  spring(x: number, row: number): void;
  checkpoint(x: number, row: number): void;
  /** Player start. Exactly one per act. */
  start(x: number, row: number): void;
  /** Castle-door goal. Exactly one per act, near the right edge. */
  goal(x: number, row: number): void;
  /** Boss arena for castle acts: gates at both ends, Bowsonaro inside.
   *  Implies the goal sits inside the arena. */
  arena(x0: number, x1: number, floorRow: number): void;
}

export interface EnemySpawn { kind: EnemyKind; x: number; y: number }

/** Everything a LevelBuilder run produces; the Level constructor consumes it.
 *  All positions in PIXELS (centers), converted from tile units by the builder. */
export interface BuiltLevel {
  map: TileMapLike;
  start: SpawnPoint;
  goalX: number;
  goalRow: number;
  enemies: EnemySpawn[];
  coins: SpawnPoint[];
  goldbars: { index: number; x: number; y: number }[];
  secrets: { index: number; x: number; y: number }[];
  springs: SpawnPoint[];
  checkpoints: SpawnPoint[];
  /** qblock contents keyed by `${tx},${ty}`. */
  blockContents: Map<string, BlockContents>;
  arena: { x0: number; x1: number; floorRow: number } | null;
}

export interface LevelDef {
  id: LevelId;
  world: WorldNo;
  act: ActNo;
  title: string;
  /** End-of-act sting: Estrada's unique ridiculous excuse line. */
  excuse: string;
  theme: ThemeId;
  /** Width in tiles. Height defaults to WORLD_H_TILES. */
  width: number;
  height?: number;
  /** Castle act: staged Bowsonaro encounter. Rage = the real final fight. */
  boss?: boolean;
  bossRage?: boolean;
  /** Full cutscene after this act (castle acts only). */
  cutsceneAfter?: CutsceneId;
  /** Deterministic level construction. Must not touch module state. */
  build(b: LevelBuilderLike): void;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Pure intent, one physics step's worth. `*Pressed` are edges valid for
 *  exactly one step; Input.endFrame() (called once per physics step, INSIDE
 *  the accumulator loop) clears them. */
export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;        // held
  jumpPressed: boolean; // edge
  run: boolean;         // held: run modifier; its edge is the pen throw
  firePressed: boolean; // edge of `run`
  pausePressed: boolean;
}

export interface InputLike {
  state(): InputState;
  endFrame(): void;
  /** Attach DOM listeners. The ONLY method that touches the DOM. */
  attach(target: EventTarget): void;
  /** Raw pressed-edge codes since last endFrame — for menus & rebinding UI. */
  edges(): ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/** Coordinate convention (ground truth, do not re-derive): x,y is the CENTER
 *  of the player's AABB, y grows downward. Half-extents depend on size and
 *  ducking (PHYS in constants.ts). Tile coords: tx = floor(px / TILE). */
export interface PlayerLike {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  ducking: boolean;
  skidding: boolean;
  size: PlayerSize;
  /** Frames of Parliamentary Immunity remaining (0 = none). */
  immunityT: number;
  /** Post-hurt invulnerability frames remaining. */
  invulnT: number;
  dead: boolean;
  /** Events raised by the player THIS step. Cleared at the start of each
   *  update; Level reads them right after calling update. */
  events: GameEvent[];
  /** Head-bumped block tile this step (Level mutates the tile), else null. */
  bumpedTile: { tx: number; ty: number } | null;
  halfW: number;
  halfH: number;
  update(input: InputState, map: TileMapLike): void;
  /** Bounce after stomping something. */
  bounce(strong: boolean): void;
  /** Apply damage: goldpen->certified->small->dead. Returns true if it hurt. */
  hurt(fromX: number): boolean;
  grow(kind: PowerupKind): void;
  respawn(at: SpawnPoint): void;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface EntityCtx {
  map: TileMapLike;
  player: PlayerLike;
  /** Emit an event with a world position (for fx placement + sfx). Ambient
   *  emitters MUST distance-gate before calling. */
  emit(ev: GameEvent, x: number, y: number): void;
  /** Seeded RNG stream for entities. */
  rand(): number;
}

/** What an entity reports about touching the player this step.
 *  Level.damagePlayer is the ONLY code path that acts on it. */
export type Contact = 'none' | 'hurt' | 'kill' | 'stomped' | 'pickup';

export type EntityKind = EnemyKind | 'pen' | 'shell' | 'powerup' | 'coin'
  | 'goldbar' | 'secret' | 'spring' | 'checkpoint';

export interface EntityLike {
  /** Mutable: a stomped pollster BECOMES a 'shell'. */
  kind: EntityKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  /** Free-running animation clock — never reset by gameplay. */
  animT: number;
  /** Squash/death animation frames remaining; alive goes false at 0. */
  dyingT: number;
  alive: boolean;
  /** For goldbars/secrets: which of the act's slots this is. */
  index?: number;
  /** For powerups: what it grants. */
  powerup?: PowerupKind;
  update(ctx: EntityCtx): Contact;
}

// ---------------------------------------------------------------------------
// Boss — Bowsonaro
// ---------------------------------------------------------------------------

export type BossPhase = 'off' | 'intro' | 'fight' | 'escape' | 'defeated';

export interface BossLike {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  phase: BossPhase;
  hp: number;
  /** Free-running animation clock — NEVER reset by gameplay. */
  animT: number;
  /** Live "decree" projectiles (paper missiles the player dodges). */
  readonly shots: readonly { x: number; y: number; vx: number; vy: number }[];
  update(ctx: EntityCtx): Contact;
}

// ---------------------------------------------------------------------------
// Level
// ---------------------------------------------------------------------------

export interface CameraState { x: number; y: number }

export interface LevelStats {
  coins: number;
  goldbars: boolean[]; // length 5
  secrets: boolean[];  // length 3
  deaths: number;
  frames: number;
}

export interface LevelLike {
  readonly def: LevelDef;
  readonly map: TileMapLike;
  readonly player: PlayerLike;
  readonly entities: readonly EntityLike[];
  readonly stats: LevelStats;
  camera: CameraState;
  /** The world closes behind the player: x below this is walled off. */
  readonly backLimitX: number;
  /** Where event fx spawn, when not at the player. Cleared each step. */
  readonly eventSources: ReadonlyMap<GameEvent, SpawnPoint>;
  readonly boss: BossLike | null;
  /** True once the goal ceremony finished; scene advances to sting/cutscene. */
  readonly finished: boolean;
  /** Run one 1/60s step. Returns the events raised this step. */
  update(input: InputState): GameEvent[];
}

// ---------------------------------------------------------------------------
// Presentation interfaces (implemented by audio / fx / render modules)
// ---------------------------------------------------------------------------

export interface SfxLike {
  /** Resume/create the AudioContext. Call on a user gesture before play(). */
  ensure(): void;
  play(ev: GameEvent): void;
}

export interface MusicLike {
  ensure(): void;
  play(track: TrackId): void;
  stop(): void;
  /** 0..1 gameplay intensity; modulates tempo/filter within the track. */
  setIntensity(v: number): void;
  /** Big-moment takeover; release() hands back to a DIFFERENT random track. */
  takeover(track: TrackId): void;
  release(): void;
  update(): void;
}

export interface FxLike {
  onEvent(ev: GameEvent, x: number, y: number): void;
  /** Advances particle ages; gated by hit-stop, unlike shake. */
  update(): void;
  /** Returns true while the world is frozen (hit-stop). */
  tickFreeze(): boolean;
  shakeOffset(frame: number): { x: number; y: number };
  renderGround(ctx: CanvasRenderingContext2D, cam: CameraState): void;
  renderAir(ctx: CanvasRenderingContext2D, cam: CameraState): void;
  /** Full-screen flash overlay alpha (0 = none) and color. */
  flash(): { alpha: number; color: string } | null;
}

// ---------------------------------------------------------------------------
// Cutscenes
// ---------------------------------------------------------------------------

export interface CutsceneBeat {
  art: CutsceneArtId;
  /** Speaker name shown in the nameplate; '' = narrator. */
  speaker: string;
  text: string;
}

export interface CutsceneScript {
  id: CutsceneId;
  music: TrackId;
  beats: CutsceneBeat[];
}

// ---------------------------------------------------------------------------
// Progress & settings
// ---------------------------------------------------------------------------

export interface ActBest {
  coins: number;
  goldbars: number; // 0..5
  secrets: number;  // 0..3
  deaths: number;
  timeFrames: number;
}

export interface ProgressData {
  /** Keyed by stable LevelId. Presence = cleared. */
  cleared: Partial<Record<LevelId, ActBest>>;
  /** Cutscenes already watched (they stay skippable/replayable). */
  seen: Partial<Record<CutsceneId, true>>;
}

export interface SettingsData {
  musicVol: number;   // 0..1
  sfxVol: number;     // 0..1
  /** null = follow prefers-reduced-motion; boolean = explicit override. */
  reducedMotion: boolean | null;
  bindings: Record<ActionId, string[]>; // KeyboardEvent.code values
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export type SceneParams = {
  title: Record<string, never>;
  levelselect: Record<string, never>;
  cutscene: { id: CutsceneId; then: { scene: 'title' } | { scene: 'level'; levelId: LevelId } };
  level: { levelId: LevelId };
};

export interface SceneLike {
  /** One fixed 1/60s step. Must assume exactly 1/60 s — takes no dt. */
  update(): void;
  render(ctx: CanvasRenderingContext2D): void;
}

export interface GameLike {
  changeScene<S extends SceneName>(name: S, params: SceneParams[S]): void;
  readonly frame: number;
}
