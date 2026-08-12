// ============================================================================
// Level — the orchestrator, and THE ONLY damage path.
//
// Owns the fixed 1/60s step order, the event list + event sources of the
// current step, the seeded entity RNG stream, the camera, the backtrack
// ratchet, the crumble fuses, the goal ceremony and the boss gates.
// Entities REPORT contact; only Level.damage / Level.kill act on it.
//
// TWO HEROES: solo runs one body (players = [P1 mangiani], morphable in place
// via swapCharacter); local co-op runs two (P2 = estrada, input2). Every
// per-player system below loops over `players`; entities and the boss act
// against the NEAREST active body; camera/ratchet follow the LEADER (max x
// among active bodies). The solo path stays bit-identical to the one-player
// original — co-op is additive and never gates content.
// ============================================================================

import type {
  BlockContents,
  BossLike,
  BuiltLevel,
  CameraState,
  CharacterId,
  Contact,
  EnemyKind,
  EntityCtx,
  EntityKind,
  EntityLike,
  GameEvent,
  InputState,
  LevelDef,
  LevelLike,
  LevelStats,
  PlayerLike,
  SpawnPoint,
  TileKind,
  WarpLink,
  TileMapLike,
} from '../core/types.ts';
import {
  ACT_RULES,
  AMBIENT_RANGE,
  BACKTRACK_SLACK,
  CAMERA,
  GOAL,
  PHYS,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../core/constants.ts';
import { createRng, RNG_STREAM, type Rng } from '../core/rng.ts';
import { buildLevel } from './levelBuilder.ts';
import { Player } from './player.ts';
import {
  spawnCheckpoint,
  spawnEnemy,
  spawnPen,
  spawnPickup,
  spawnPowerup,
  spawnSpring,
} from './entities.ts';
import { Bowsonaro } from './boss.ts';

// ---------------------------------------------------------------------------
// Step tuning that is Level-internal by spec (no global constant exists for
// these; the values are fixed by the house brief, not re-tunable elsewhere).
// ---------------------------------------------------------------------------
/** Squash/death animation length handed to entities Level itself kills. */
const ENEMY_DYING_FRAMES = 20;
/** Frames between death and respawn at the checkpoint (CO-OP full wipe —
 *  solo takes the staged SOLO_DEATH_FRAMES sequence below). */
const RESPAWN_DELAY = 90;
/** Solo death sequence length: stillness -> pop -> gravity-only fall, sized
 *  so the ~1.8 s death jingle (sfx 'die') finishes under the world-hold.
 *  Must stay <= 120: the classic tapes assert respawn within that window. */
const SOLO_DEATH_FRAMES = 118;
/** Corpse stillness before the classic launch — the staged beat of shock. */
const DEATH_STILL_FRAMES = 12;
/** The launch: the corpse pops up, then falls through the whole set (the
 *  player's dead physics is already gravity-only through nothing). */
const DEATH_POP_VY = -5.5;
/** Flag-plant beat: the LAST body enters the door, then this many frames
 *  later 'flag-plant' fires and the act is finished. */
const GOAL_CEREMONY_FRAMES = 90;
/** A walking body counts as "at the door" this many px before goalX. */
const DOOR_INSET_PX = 4;
/** Ceremony stall-proofing: a walker that has not reached the door after this
 *  many frames (10s — any real runway takes < 3s) slips inside off-screen. */
const CEREMONY_WALK_TIMEOUT = 600;
/** Frames a crumble tile survives after first being stood on. */
const CRUMBLE_FUSE = 30;
/** Player must be this many px past arena.x0 before the staged fight starts. */
const BOSS_TRIGGER_DEPTH = 32;
/** Gate columns span floorRow-GATE_H .. floorRow-1. */
const GATE_H = 6;
/** Falling this far below the map bottom is the void. */
const VOID_MARGIN = 32;
/** Pen-vs-enemy overlap half-extent (entities expose no AABB; ~3/4 tile). */
const PEN_HIT_RANGE = TILE * 0.75;
/** Shell-vs-enemy overlap half-extent (slightly bigger — shells are chunky). */
const SHELL_HIT_RANGE = TILE * 0.9;
/** Pen-vs-boss overlap half-extent (the boss is a big target). */
const BOSS_HIT_RANGE = TILE * 1.5;
/** A shell slower than this is parked, not a weapon. */
const SHELL_MIN_SPEED = 0.1;
/** Level-side stagger after any boss hit so pens cannot machine-gun the boss
 *  (mirrors the boss's internal stomp stagger, which Level cannot see). */
const BOSS_PEN_STAGGER = 45;

// -- co-op tuning (fixed by the two-hero brief; solo never reads these) -----
/** P2 spawns/respawns this far right of P1 — side by side, not stacked. */
const P2_SPAWN_DX = 20;
/** Bubble countdown: frames from death to hovering (pop-ready) next to the
 *  leader. Counts 90 -> 1 and HOLDS at 1 while hovering, so `bubbleT > 0`
 *  stays the painter's "draw me as a bubble" test; the pop clears it to 0. */
const BUBBLE_FRAMES = 90;
/** Bubble drift speed toward the leader, px/frame. */
const BUBBLE_DRIFT = 2.5;
/** Grace invulnerability granted by the bubble pop. */
const BUBBLE_POP_INVULN = 60;
/** The bubble hovers this many px above the leader's center. */
const BUBBLE_HOVER_DY = 24;

/** Exhaustive over CharacterId — the solo swap toggle. */
const OTHER_HERO: Record<CharacterId, CharacterId> = {
  mangiani: 'estrada',
  estrada: 'mangiani',
};

/** All-false input: what a missing co-op channel reads. */
const NO_INPUT: InputState = Object.freeze({
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  jumpPressed: false,
  run: false,
  firePressed: false,
  pausePressed: false,
  swapPressed: false,
});

/** The ceremony's substituted input: every locked body auto-walks right,
 *  presses nothing. Real player intent is ignored from grab to flag. */
const CEREMONY_WALK: InputState = Object.freeze({ ...NO_INPUT, right: true });

/** Ambient family — belt-and-braces distance gate on top of the emitters'
 *  own gating (the emitter MUST gate; Level drops strays anyway). */
const AMBIENT_EVENTS: ReadonlySet<GameEvent> = new Set<GameEvent>([
  'drip',
  'slot-spin',
  'gavel-slam',
  'lava-bubble',
]);

/** Exhaustive over EnemyKind by construction — a new enemy kind does not
 *  compile until it is declared here. */
const ENEMY_KIND_TABLE: Record<EnemyKind, true> = {
  lobbyist: true,
  pollster: true,
  lawyer: true,
  paparazzo: true,
  rat: true,
  chipstack: true,
  gavel: true,
};
const ENEMY_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>(
  Object.keys(ENEMY_KIND_TABLE) as EnemyKind[],
);

/** Deterministic FNV-1a hash of a level id — seeds the entity RNG stream. */
function hashLevelId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Level implements LevelLike {
  readonly def: LevelDef;
  readonly map: TileMapLike;
  /** The lead body — players[0]. The gate, probes and the whole solo path
   *  address P1 through this. */
  readonly player: PlayerLike;
  /** All bodies: [P1] solo, [P1, P2] co-op. */
  readonly players: readonly PlayerLike[];
  readonly stats: LevelStats;
  camera: CameraState;
  readonly boss: BossLike | null;

  private ents: EntityLike[] = [];
  private events: GameEvent[] = [];
  private readonly _eventSources = new Map<GameEvent, SpawnPoint>();
  private _backLimitX: number;
  private _finished = false;

  readonly goalX: number;
  readonly goalRow: number;
  private readonly blockContents: Map<string, BlockContents>;
  private readonly arena: { x0: number; x1: number; floorRow: number } | null;
  private readonly rng: Rng;
  private readonly ctx: EntityCtx;

  private respawnPoint: SpawnPoint;
  /** Per-player auto-fire cooldown frames (index-matched to players). */
  private readonly penCooldown: number[] = [0, 0];
  /** Warp links from the builder; transit state while riding a pipe. Only
   *  ONE warp is ever active — first come; the whole world pauses during. */
  private readonly warps: WarpLink[];
  private activeWarp: {
    link: WarpLink;
    phase: 'in' | 'out';
    t: number;
    rider: PlayerLike;
  } | null = null;
  /** Which body compressed each spring this step (set during the entity
   *  pass, consumed by the launch pass). Cleared every step. */
  private readonly springTargets = new Map<EntityLike, PlayerLike>();
  /** Solo swap queued by the scene between steps; the next update() emits
   *  the 'hero-swap' event here so it rides that step's event list. */
  private pendingSwapAt: SpawnPoint | null = null;
  /** Counts down after death; at 0 the player respawns. -1 = idle. */
  private deathTimer = -1;
  /** End-of-level ceremony (null = not started). Replaces the old goal-line
   *  timer: pole grab -> slide ('pole') -> auto-walk ('walk', bodies vanish
   *  into the door) -> flag-plant beat ('plant'). Never cleared once set —
   *  `ceremony`/`doorOpen` keep reading it through the sting. */
  private ceremonyState: {
    /** Frames since the walk phase began — the stall-proof fallback below. */
    walkT?: number;
    phase: 'pole' | 'walk' | 'plant';
    rider: PlayerLike;
    /** Frames spent in 'plant'. */
    plantT: number;
    /** Bodies already inside the door (hidden, frozen). */
    inside: Set<PlayerLike>;
  } | null = null;
  /** Crumble fuses keyed by `${tx},${ty}`; tiles never respawn. */
  private readonly crumbleFuses = new Map<string, number>();
  /** Level-side boss hit stagger for pens. */
  private bossStaggerT = 0;
  private gatesUp = false;
  private gateTiles: { tx: number; ty: number; prev: TileKind }[] = [];

  constructor(def: LevelDef, opts?: { coop?: boolean }) {
    this.def = def;
    const built: BuiltLevel = buildLevel(def);
    this.map = built.map;
    this.goalX = built.goalX;
    this.goalRow = built.goalRow;
    this.blockContents = built.blockContents;
    this.arena = built.arena;
    this.warps = built.warps;

    // Pre-validate: every qblock on the map MUST have declared contents.
    // A missing entry is a builder bug — throw NOW, never at play time.
    for (let ty = 0; ty < this.map.hTiles; ty++) {
      for (let tx = 0; tx < this.map.wTiles; tx++) {
        if (this.map.tileAt(tx, ty) === 'qblock' && !built.blockContents.has(`${tx},${ty}`)) {
          throw new Error(`level ${def.id}: qblock at ${tx},${ty} has no declared contents`);
        }
      }
    }

    const bodies: PlayerLike[] = [new Player(built.start)];
    if (opts?.coop) {
      bodies.push(
        new Player({ x: built.start.x + P2_SPAWN_DX, y: built.start.y }, 'estrada'),
      );
    }
    this.players = bodies;
    this.player = bodies[0]!;
    this.respawnPoint = { x: built.start.x, y: built.start.y };
    this.stats = {
      coins: 0,
      goldbars: new Array<boolean>(ACT_RULES.goldbars).fill(false),
      secrets: new Array<boolean>(ACT_RULES.secrets).fill(false),
      deaths: 0,
      frames: 0,
    };

    for (const e of built.enemies) this.ents.push(spawnEnemy(e.kind, e.x, e.y));
    for (const c of built.coins) this.ents.push(spawnPickup('coin', c.x, c.y));
    for (const g of built.goldbars) this.ents.push(spawnPickup('goldbar', g.x, g.y, g.index));
    for (const s of built.secrets) this.ents.push(spawnPickup('secret', s.x, s.y, s.index));
    for (const s of built.springs) this.ents.push(spawnSpring(s.x, s.y));
    for (const c of built.checkpoints) this.ents.push(spawnCheckpoint(c.x, c.y));

    if (def.boss) {
      if (!built.arena) {
        throw new Error(`level ${def.id}: boss declared but the builder laid no arena`);
      }
      this.boss = new Bowsonaro(built.arena, def.bossRage ?? false);
    } else {
      this.boss = null;
    }

    this.rng = createRng(hashLevelId(def.id) ^ RNG_STREAM.entities);
    this.ctx = {
      map: this.map,
      player: this.player,
      emit: (ev: GameEvent, x: number, y: number): void => this.emitAt(ev, x, y),
      rand: this.rng,
    };

    this._backLimitX = Math.max(0, built.start.x - BACKTRACK_SLACK);
    this.camera = { x: 0, y: 0 };
    this.snapCamera();
  }

  get entities(): readonly EntityLike[] {
    return this.ents;
  }
  get eventSources(): ReadonlyMap<GameEvent, SpawnPoint> {
    return this._eventSources;
  }
  get backLimitX(): number {
    return this._backLimitX;
  }
  get finished(): boolean {
    return this._finished;
  }
  /** True while riding a warp pipe — the scene draws the player BEHIND the
   *  tile layer then, so the pipe body occludes the sink/rise (otherwise the
   *  sprite visibly slides down in FRONT of the pipe). */
  get warping(): boolean {
    return this.activeWarp !== null;
  }
  /** True from the pole grab on — the end-of-level ceremony is performing.
   *  Player intent is locked out and contacts/hazards ignore the bodies. */
  get ceremony(): boolean {
    return this.ceremonyState !== null;
  }
  /** True once 'flag-plant' fired — the painter swaps the pole's pennant to
   *  Estrada's "MISSION FAILED SUCCESSFULLY" flag off this. */
  get flagPlanted(): boolean {
    return this._finished;
  }
  /** The castle door stands OPEN (dark doorway) while bodies walk in and
   *  stays open for the aftermath — the painter reads this. */
  get doorOpen(): boolean {
    return this.ceremonyState !== null && this.ceremonyState.phase !== 'pole';
  }
  /** Flagpole x (px): GOAL.poleOffsetTiles tiles before the door. */
  get poleX(): number {
    return this.goalX - GOAL.poleOffsetTiles * TILE;
  }
  /** Ground line the pole stands on (px) — also the walk row's floor. */
  private get poleBaseY(): number {
    return (this.goalRow + 1) * TILE;
  }

  /** 0..1 gameplay intensity hint for the music system.
   *  - Solo death: 0 — the score DUCKS under the death jingle (music.update
   *    eases downward fast) and comes back the slow way after respawn.
   *  - Speed feeds a gentle slope, but CHARGED FULL RUN (>= 90% of runMax,
   *    grounded-ish: brief hops must not cool the groove) gets a dedicated
   *    hot band that clears music.ts's HOT_NOISE_AT — the noise channel
   *    lifts (ghost hats, hotter drums), tempo and filter open: the run
   *    state's own musical ambiance. Anything below full run stays under
   *    ~0.5 so the two states are audibly distinct.
   *  - A live boss stays the hottest thing in the room. */
  get intensity(): number {
    const p = this.player;
    if (this.players.length === 1 && p.dead) return 0;
    const speed = Math.min(1, Math.abs(p.vx) / PHYS.runMax);
    const fullRun = speed >= 0.9 && (p.grounded || Math.abs(p.vy) < 1.2);
    const bossActive =
      this.boss !== null && (this.boss.phase === 'intro' || this.boss.phase === 'fight');
    return Math.min(1, 0.28 + 0.22 * speed + (fullRun ? 0.25 : 0) + (bossActive ? 0.4 : 0));
  }

  // -------------------------------------------------------------------------
  // The fixed 1/60s step.
  // -------------------------------------------------------------------------
  update(input: InputState, input2?: InputState): GameEvent[] {
    // 1. bookkeeping
    this.stats.frames++;
    this._eventSources.clear();
    this.events = [];
    const inputs: readonly InputState[] =
      this.players.length > 1 ? [input, input2 ?? NO_INPUT] : [input];
    // stomp bounce height reads the STOMPER's hold this step
    for (let i = 0; i < inputs.length; i++) this.jumpHelds[i] = inputs[i]!.jump;
    if (this.bossStaggerT > 0) this.bossStaggerT--;
    // solo swap queued by the scene between steps (see swapCharacter)
    if (this.pendingSwapAt) {
      this.emitAt('hero-swap', this.pendingSwapAt.x, this.pendingSwapAt.y);
      this.pendingSwapAt = null;
    }

    // 1b. warp transit: while a body rides a pipe the world holds its breath —
    // physics, entities and hazards all pause (BOTH bodies in co-op); only the
    // ride animates. This both looks classic and makes transit trivially safe.
    if (this.activeWarp) {
      this.updateWarp();
      for (const p of this.players) for (const ev of p.events) this.events.push(ev);
      return this.events;
    }

    // 1c. THE SOLO DEATH SEQUENCE: the world holds its breath — no entities,
    // no boss, no hazards, no camera pan — while the corpse performs the
    // classic staged exit (DEATH_STILL_FRAMES of stillness, then the
    // DEATH_POP_VY launch, then a gravity-only fall through the set) and the
    // death jingle plays over a ducked score (the intensity getter returns 0
    // while solo-dead). Co-op never comes here: a bubble must never freeze
    // the live partner, and a full wipe keeps the classic unheld timer.
    if (this.players.length === 1 && this.player.dead && this.deathTimer > 0) {
      this.updateDeathSequence();
      for (const p of this.players) for (const ev of p.events) this.events.push(ev);
      return this.events;
    }

    // 2. player physics (a bubbled body floats instead). Player events are
    // read at the END of the step: hurt() / bounce() / respawn() may append
    // to player.events mid-step and reading early would drop them (they get
    // cleared by the next update()). During the goal ceremony the bodies are
    // performers, not players: real intent is ignored (see updateCeremony).
    if (this.ceremonyState) {
      this.updateCeremony();
    } else {
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i]!;
        if (p.bubbleT > 0) this.updateBubble(p, inputs[i]!);
        else p.update(inputs[i]!, this.map);
      }
    }

    // 2b. warp entry: standing on a warp pipe's mouth and pressing down.
    // Only ONE warp can be active at a time — first come (P1 breaks ties).
    // Never during the ceremony: the substituted inputs press nothing, but
    // the check below reads the REAL inputs, so it must be gated too.
    for (let i = 0; i < this.players.length && !this.activeWarp && !this.ceremonyState; i++) {
      const p = this.players[i]!;
      if (p.dead || p.bubbleT > 0 || !p.grounded || !inputs[i]!.down) continue;
      for (const w of this.warps) {
        if (Math.abs(p.x - w.ax) <= 10 && Math.abs(p.y + p.halfH - w.ay) <= 6) {
          this.activeWarp = { link: w, phase: 'in', t: 0, rider: p };
          this.emitAt('pipe', w.ax, w.ay);
          break;
        }
      }
    }

    // death timer -> full respawn (runs after the player updates so a
    // 'respawn' raised by a player survives until the end-of-step collection).
    // Only the CO-OP full wipe still reaches this (bubbles are free; a wipe
    // respawns EVERYONE at the checkpoint) — the solo path early-returns
    // through the death sequence at step 1c and never gets here.
    if (this.player.dead && this.deathTimer > 0) {
      this.deathTimer--;
      if (this.deathTimer === 0) {
        this.deathTimer = -1;
        this.respawnAll();
      }
    }

    // 3. head-bumped tiles (per body; bricks read the BUMPER's size)
    for (const p of this.players) {
      const bump = p.bumpedTile;
      if (bump && !p.dead) this.resolveBump(p, bump.tx, bump.ty);
      p.bumpedTile = null; // consumed — never process a bump twice
    }

    // 4. entities. Each entity acts against the NEAREST active body (never a
    // dead or bubbled one) and its Contact resolves against that same body.
    this.springTargets.clear();
    for (const e of this.ents) {
      if (!e.alive) continue;
      const target = this.nearestActive(e.x, e.y);
      this.ctx.player = target;
      const contact = e.update(this.ctx);
      if (e.kind === 'spring') this.springTargets.set(e, target);
      this.resolveContact(contact, e, target);
      // The bottom of the map is open void now — anything that walks or is
      // kicked off the edge falls out of the world and is culled.
      if (e.y > this.map.pixelH + 200) e.alive = false;
    }
    // springs launch harder than a stomp bounce: bounce clears the variable-
    // jump state, then vy is overridden so the launch cannot be jump-cut.
    for (const e of this.ents) {
      if (!e.alive || e.kind !== 'spring') continue;
      const s = e as EntityLike & { triggered?: boolean };
      if (s.triggered) {
        s.triggered = false;
        // never launch a performer mid-ceremony — the march must not break
        if (this.ceremonyState) continue;
        const rider = this.springTargets.get(e) ?? this.player;
        if (!rider.dead) {
          rider.bounce(false);
          rider.vy = PHYS.springVy;
        }
        this.emitAt('spring', e.x, e.y);
      }
    }

    // 5. pens & shells
    this.updatePensAndShells(inputs);

    // 6. boss
    this.updateBoss();

    // 7. hazard tiles + void
    this.checkHazards();

    // 8. crumble scheduling + fuse ticking
    this.updateCrumble();

    // 9. goal ceremony trigger — the FLAGPOLE, 8 tiles before the door. The
    // FIRST active body past the pole's x grabs it (P1 breaks same-frame
    // ties) and the whole team is locked into the performance. A castle pole
    // stays sealed until the staged encounter resolved — Bowsonaro must
    // escape (or, in rage, actually fall). Without this a runner could start
    // the ceremony mid-"fight".
    const bossResolved =
      this.boss === null ||
      this.boss.phase === 'escape' ||
      this.boss.phase === 'defeated';
    // (activeWarp guard: a warp entered THIS frame must finish its ride
    // before the pole can grab the rider — two machines must never share a
    // body; later frames are covered by the step-1b early return.)
    if (
      !this._finished &&
      this.ceremonyState === null &&
      this.activeWarp === null &&
      bossResolved
    ) {
      // Castle acts have NO flagpole — the boss is the climax (boss OR flag,
      // never both; playtest-settled). The trigger there is the door itself,
      // and the ceremony starts directly in its walk phase.
      const triggerX = this.def.boss ? this.goalX - DOOR_INSET_PX : this.poleX;
      for (const p of this.players) {
        if (this.isActive(p) && p.x >= triggerX) {
          if (this.def.boss) this.startDoorCeremony();
          else this.startCeremony(p);
          break;
        }
      }
    }

    // 10. backtrack ratchet + camera — both follow the LEADER (max x among
    // active bodies). While the boss gates are up the ratchet freezes — the
    // gates own confinement.
    if (!this.gatesUp) {
      this._backLimitX = Math.max(this._backLimitX, this.leader().x - BACKTRACK_SLACK);
    }
    for (const p of this.players) {
      if (p.bubbleT > 0) continue; // bubbles ignore the wall — they drift over it
      const minX = this._backLimitX + p.halfW;
      if (p.x < minX) {
        p.x = minX;
        if (p.vx < 0) p.vx = 0;
      }
    }
    this.moveCamera();

    // collect player events (see step 2 note), then drop dead entities
    for (const p of this.players) for (const ev of p.events) this.events.push(ev);
    if (this.ents.some((e) => !e.alive)) this.ents = this.ents.filter((e) => e.alive);

    return this.events;
  }

  // -------------------------------------------------------------------------
  // Two-hero helpers
  // -------------------------------------------------------------------------

  /** SOLO hero morph (the scene calls this on the swap edge, right before
   *  update()): toggles who P1 is drawn as. The 'hero-swap' event (blip +
   *  puff) is queued and emitted by the NEXT update() so it rides that
   *  step's event list. No-op in co-op — P2 IS the other hero. */
  swapCharacter(): void {
    if (this.players.length > 1) return;
    const p = this.player;
    p.character = OTHER_HERO[p.character];
    this.pendingSwapAt = { x: p.x, y: p.y };
  }

  /** Active = playing right now: not dead, not bubbled. */
  private isActive(p: PlayerLike): boolean {
    return !p.dead && p.bubbleT === 0;
  }

  /** The leading active body (max x), or null when nobody is active. */
  private activeLeader(): PlayerLike | null {
    let best: PlayerLike | null = null;
    for (const p of this.players) {
      if (!this.isActive(p)) continue;
      if (best === null || p.x > best.x) best = p;
    }
    return best;
  }

  /** The camera/ratchet anchor: the leading active body, falling back to P1
   *  when nobody is active (solo death — today's corpse-watching camera). */
  private leader(): PlayerLike {
    return this.activeLeader() ?? this.player;
  }

  /** The body nearest to (x, y) among the active ones; P1 as the inert
   *  fallback when nobody is active (matches the solo dead-player step). */
  private nearestActive(x: number, y: number): PlayerLike {
    let best: PlayerLike | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (!this.isActive(p)) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ?? this.player;
  }

  private jumpHeldFor(p: PlayerLike): boolean {
    return this.jumpHelds[this.players.indexOf(p)] ?? false;
  }

  /** One bubbled body's step: inert, intangible, drifting toward a hover
   *  point above the leader. bubbleT counts down to 1 and holds (hovering);
   *  the pop — this channel's jump edge while hovering — reactivates the
   *  body at the leader's position with grace invulnerability. */
  private updateBubble(p: PlayerLike, input: InputState): void {
    p.events.length = 0; // a bubble raises nothing; stale events must not re-emit
    p.bumpedTile = null;
    const leader = this.activeLeader();
    if (leader === null) return; // full wipe pending — the death timer respawns everyone
    const dx = leader.x - p.x;
    const dy = leader.y - BUBBLE_HOVER_DY - p.y;
    const d = Math.hypot(dx, dy);
    if (d > BUBBLE_DRIFT) {
      p.x += (dx / d) * BUBBLE_DRIFT;
      p.y += (dy / d) * BUBBLE_DRIFT;
    } else {
      p.x = leader.x;
      p.y = leader.y - BUBBLE_HOVER_DY;
    }
    if (p.bubbleT > 1) {
      p.bubbleT--; // still counting down — no pop yet
      return;
    }
    if (input.jumpPressed) {
      p.bubbleT = 0;
      p.dead = false;
      p.x = leader.x;
      p.y = leader.y;
      p.vx = 0;
      p.vy = 0;
      p.grounded = false;
      p.ducking = false;
      p.skidding = false;
      p.invulnT = BUBBLE_POP_INVULN;
      this.emitAt('hero-swap', p.x, p.y); // the pop shares the morph blip
    }
  }

  /** One frame of the solo death hold (step 1c). The corpse is a performer:
   *  perfectly still through the shock beat, launched at DEATH_STILL_FRAMES,
   *  then handed back to its own dead physics for the fall. */
  private updateDeathSequence(): void {
    const p = this.player;
    p.events.length = 0; // stale step events must not re-emit during the hold
    const elapsed = SOLO_DEATH_FRAMES - this.deathTimer;
    if (elapsed === DEATH_STILL_FRAMES) {
      p.vx = 0;
      p.vy = DEATH_POP_VY; // the classic launch
    }
    if (elapsed >= DEATH_STILL_FRAMES) p.update(NO_INPUT, this.map);
    this.deathTimer--;
    if (this.deathTimer === 0) {
      this.deathTimer = -1;
      this.respawnAll();
    }
  }

  /** Everyone back at the checkpoint (solo: the one body — today's path). */
  private respawnAll(): void {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      p.bubbleT = 0;
      p.respawn({ x: this.respawnPoint.x + i * P2_SPAWN_DX, y: this.respawnPoint.y });
    }
    this._backLimitX = Math.max(0, this.respawnPoint.x - BACKTRACK_SLACK);
    this.snapCamera();
  }

  /** The pipe ride: sink into A, teleport, rise out of B. The ratchet and
   *  camera jump WITH the player — exits are builder-validated to never be
   *  behind the entry. */
  private updateWarp(): void {
    const w = this.activeWarp;
    if (!w) return;
    const p = w.rider;
    w.t++;
    p.vx = 0;
    p.vy = 0;
    if (w.phase === 'in') {
      p.y += 0.9; // sink into the pipe
      if (w.t >= 24) {
        p.x = w.link.bx;
        p.y = w.link.by + p.halfH + 4; // start inside pipe B's neck
        this._backLimitX = Math.max(this._backLimitX, w.link.bx - BACKTRACK_SLACK);
        this.snapCamera();
        this.emitAt('pipe', w.link.bx, w.link.by);
        w.phase = 'out';
        w.t = 0;
      }
    } else {
      p.y -= 1.2; // rise out
      if (p.y <= w.link.by - p.halfH) {
        p.y = w.link.by - p.halfH;
        this.activeWarp = null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // The goal ceremony — pole grab, slide, auto-walk, door, flag (step 9 arms
  // it; updateCeremony replaces step 2's player physics while it runs).
  // -------------------------------------------------------------------------

  /** The grab: pay the height bonus ONCE, snap the rider onto the pole and
   *  lock the whole team into the performance. h = 0 at the base, 1 at the
   *  pennant; a top grab gets the notary's certification on top. */
  private startCeremony(rider: PlayerLike): void {
    const poleX = this.poleX;
    const h = clamp(
      (this.poleBaseY - rider.y) / (GOAL.poleHeightTiles * TILE),
      0,
      1,
    );
    this.stats.coins += Math.round(h * GOAL.bonusMaxCoins);
    rider.x = poleX; // classic: the grab snaps the body onto the pole
    rider.vx = 0;
    rider.vy = GOAL.slideSpeed; // reads as a controlled slide (fall pose)
    rider.grounded = false;
    rider.facing = 1;
    this.emitAt('goal', poleX, rider.y);
    // the notary certifies your maximum height — ka-ching
    if (h >= GOAL.topGrabFrac) this.emitAt('certify', poleX, rider.y);
    this.emitAt('pole-slide', poleX, rider.y);
    this.ceremonyState = { phase: 'pole', rider, plantT: 0, inside: new Set() };
  }

  /** Castle-act ceremony: no pole, no height bonus — the beaten (or fled)
   *  boss IS the climax. Everyone just walks through the opened door. */
  private startDoorCeremony(): void {
    const leader = this.players.find((p) => this.isActive(p)) ?? this.player;
    this.emitAt('goal', this.goalX, leader.y);
    this.ceremonyState = { phase: 'walk', rider: leader, plantT: 0, inside: new Set() };
  }

  /** One ceremony frame. The rider slides down the pole (manual, collision-
   *  free — the pole owns the body), every other active body auto-walks
   *  right on real physics with the locked CEREMONY_WALK input; a body
   *  reaching the door goes hidden ('door-in' once each); bubbled/dead
   *  partners skip the walk and go straight inside. 90 frames after the
   *  LAST body enters, 'flag-plant' fires and the act is finished. */
  private updateCeremony(): void {
    const c = this.ceremonyState;
    if (!c) return;
    const doorX = this.goalX - DOOR_INSET_PX;
    for (const p of this.players) {
      if (c.inside.has(p)) {
        // inside the castle: frozen; stale events must never re-emit
        p.events.length = 0;
        p.bumpedTile = null;
        continue;
      }
      if (p === c.rider && c.phase === 'pole') {
        p.events.length = 0;
        p.bumpedTile = null;
        const restY = this.poleBaseY - p.halfH;
        p.x = this.poleX;
        p.vx = 0;
        p.vy = GOAL.slideSpeed;
        p.y = Math.min(p.y + GOAL.slideSpeed, restY);
        if (p.y >= restY) {
          // dismount: hand the body back to real physics for the walk
          p.vy = 0;
          p.grounded = true;
          c.phase = 'walk';
        }
        continue;
      }
      if (!this.isActive(p)) {
        // bubbled/dead partner: no walk of shame, straight to hidden
        p.events.length = 0;
        p.bumpedTile = null;
        p.bubbleT = 0;
        p.hidden = true;
        c.inside.add(p);
        continue;
      }
      // auto-walk toward the door on real physics; the cap keeps the march
      // at ceremony pace instead of carrying run-up momentum
      if (p.vx > GOAL.walkSpeed) p.vx = GOAL.walkSpeed;
      p.update(CEREMONY_WALK, this.map);
      // Stall-proof fallback: a co-op partner wedged behind terrain far from
      // the runway must never freeze the ceremony forever — after the grace
      // window they simply slip inside off-screen (the show must go on).
      const stalled = (c.walkT ?? 0) > CEREMONY_WALK_TIMEOUT;
      if (p.x >= doorX || stalled) {
        p.x = doorX;
        p.vx = 0;
        p.hidden = true; // the painter draws nothing for a hidden body
        c.inside.add(p);
        this.emitAt('door-in', this.goalX, this.poleBaseY - TILE);
      }
    }
    if (c.phase !== 'pole') c.walkT = (c.walkT ?? 0) + 1;
    if (c.phase === 'plant') {
      c.plantT++;
      if (c.plantT === GOAL_CEREMONY_FRAMES) {
        this.emitAt(
          'flag-plant',
          this.poleX,
          this.poleBaseY - GOAL.poleHeightTiles * TILE,
        );
        this._finished = true;
      }
    } else if (c.phase === 'walk' && c.inside.size === this.players.length) {
      // everyone is inside; the flag-plant beat starts NEXT frame, so the
      // 'flag-plant' lands exactly GOAL_CEREMONY_FRAMES after the last entry
      c.phase = 'plant';
      c.plantT = 0;
    }
  }

  // -------------------------------------------------------------------------
  // THE ONLY damage path — per body now, still the single caller of hurt().
  // -------------------------------------------------------------------------
  private damage(p: PlayerLike, fromX: number): void {
    if (this.ceremonyState) return; // performers cannot be hurt
    if (p.dead || p.bubbleT > 0) return;
    const hurt = p.hurt(fromX);
    if (!hurt) return;
    if (p.dead) {
      // 'die' was already raised by the player itself
      this.onDeath(p);
    }
  }

  /** Instant death (lava, void): bypasses sizes and invulnerability. */
  private kill(p: PlayerLike): void {
    if (this.ceremonyState) return; // death cannot occur during the ceremony
    if (p.dead || p.bubbleT > 0) return;
    p.dead = true;
    p.vx = 0;
    this.events.push('die');
    this.onDeath(p);
  }

  /** Post-death routing. Solo — and a co-op full wipe — takes the classic
   *  counted-death respawn timer. A co-op death with a live partner is a
   *  FREE bubble instead (generous house tuning: deaths only count when the
   *  whole team wipes). The counted paths stage THE DEATH POP: solo holds
   *  the corpse perfectly still until step 1c launches it; the co-op wipe
   *  (no world-hold there) launches immediately. */
  private onDeath(p: PlayerLike): void {
    if (this.players.length > 1 && this.activeLeader() !== null) {
      p.bubbleT = BUBBLE_FRAMES; // p.dead stays true: inert & intangible
      p.vx = 0;
      p.vy = 0;
      return;
    }
    this.stats.deaths++;
    p.vx = 0;
    if (this.players.length > 1) {
      p.vy = DEATH_POP_VY;
      this.deathTimer = RESPAWN_DELAY;
    } else {
      p.vy = 0; // held still; the pop lands DEATH_STILL_FRAMES into step 1c
      this.deathTimer = SOLO_DEATH_FRAMES;
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------
  /** Emit an event with a world source. Ambient strays get dropped here even
   *  though gating is the emitter's job — belt and braces. */
  private emitAt(ev: GameEvent, x: number, y: number): void {
    if (AMBIENT_EVENTS.has(ev) && Math.abs(x - this.player.x) >= AMBIENT_RANGE) return;
    this.events.push(ev);
    this._eventSources.set(ev, { x, y });
  }

  private addCoin(x: number, y: number): void {
    this.stats.coins++;
    this.emitAt('coin', x, y);
    // every 100th coin the notary stamps the haul — pure gag event
    if (this.stats.coins % 100 === 0) this.emitAt('certify', x, y);
  }

  // -------------------------------------------------------------------------
  // Step 3: bumped tiles (p = the body whose head hit the tile)
  // -------------------------------------------------------------------------
  private resolveBump(p: PlayerLike, tx: number, ty: number): void {
    const bx = (tx + 0.5) * TILE;
    const by = (ty + 0.5) * TILE;
    const kind = this.map.tileAt(tx, ty);
    switch (kind) {
      case 'qblock': {
        const contents = this.blockContents.get(`${tx},${ty}`);
        // validated at construction — reaching here without contents means the
        // map mutated underneath us, which is its own bug
        if (contents === undefined) {
          throw new Error(`level ${this.def.id}: bumped qblock ${tx},${ty} has no contents`);
        }
        this.releaseContents(contents, bx, by);
        this.map.setTile(tx, ty, 'usedblock');
        break;
      }
      case 'brick': {
        if (p.size !== 'small') {
          this.emitAt('brick-break', bx, by);
          this.map.setTile(tx, ty, 'empty');
        } else {
          this.emitAt('block-bump', bx, by); // thunk, no break
        }
        break;
      }
      case 'usedblock': {
        this.emitAt('block-empty', bx, by);
        break;
      }
      // plain solids bumped from below: no reaction, deliberately
      case 'empty':
      case 'ground':
      case 'bedrock':
      case 'oneway':
      case 'pipe':
      case 'spike':
      case 'lava':
      case 'crumble':
        break;
      default: {
        const _x: never = kind;
        throw new Error(`unhandled bumped tile kind ${String(_x)}`);
      }
    }
  }

  private releaseContents(contents: BlockContents, bx: number, by: number): void {
    switch (contents) {
      case 'coin': {
        this.addCoin(bx, by);
        this.emitAt('block-bump', bx, by);
        break;
      }
      case 'stamp':
      case 'goldpen':
      case 'immunity': {
        // the powerup emerges from the top of the block
        this.ents.push(spawnPowerup(contents, bx, by - TILE));
        this.emitAt('powerup-appear', bx, by);
        this.emitAt('block-bump', bx, by);
        break;
      }
      default: {
        const _x: never = contents;
        throw new Error(`unhandled qblock contents ${String(_x)}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: entity contact resolution (target = the body the entity acted on)
  // -------------------------------------------------------------------------
  private resolveContact(contact: Contact, e: EntityLike, target: PlayerLike): void {
    // ceremony bodies are performing, not playing: every contact is ignored
    if (this.ceremonyState) return;
    if (contact !== 'none' && target.dead) return; // dead player is inert
    switch (contact) {
      case 'none':
        return;
      case 'stomped': {
        // a pollster mutates itself into a 'shell' on stomp — then the stomp
        // is bounce-only; likewise stomping a shell parks it, no squash
        if (e.kind !== 'shell') e.dyingT = ENEMY_DYING_FRAMES;
        target.bounce(this.jumpHeldFor(target));
        this.emitAt('stomp', e.x, e.y);
        return;
      }
      case 'hurt':
        this.damage(target, e.x);
        return;
      case 'kill':
        this.kill(target);
        return;
      case 'pickup':
        this.resolvePickup(e, target);
        return;
      default: {
        const _x: never = contact;
        throw new Error(`unhandled contact ${String(_x)}`);
      }
    }
  }

  /** Per-body input.jump for the current step, captured in update(). */
  private jumpHelds: boolean[] = [];

  private resolvePickup(e: EntityLike, target: PlayerLike): void {
    switch (e.kind) {
      case 'coin': {
        this.addCoin(e.x, e.y);
        e.alive = false;
        return;
      }
      case 'goldbar': {
        if (e.index === undefined || e.index < 0 || e.index >= this.stats.goldbars.length) {
          throw new Error(`goldbar entity with bad index ${String(e.index)}`);
        }
        this.stats.goldbars[e.index] = true;
        this.emitAt('goldbar', e.x, e.y);
        e.alive = false;
        return;
      }
      case 'secret': {
        if (e.index === undefined || e.index < 0 || e.index >= this.stats.secrets.length) {
          throw new Error(`secret entity with bad index ${String(e.index)}`);
        }
        this.stats.secrets[e.index] = true;
        this.emitAt('secret', e.x, e.y);
        e.alive = false;
        return;
      }
      case 'powerup': {
        if (e.powerup === undefined) {
          throw new Error('powerup entity without a powerup kind');
        }
        target.grow(e.powerup);
        this.emitAt('powerup-grab', e.x, e.y);
        e.alive = false;
        return;
      }
      case 'checkpoint': {
        // the entity stays alive and claims itself internally
        this.respawnPoint = { x: e.x, y: e.y };
        this.emitAt('checkpoint', e.x, e.y);
        return;
      }
      default:
        throw new Error(`entity kind ${e.kind} reported pickup contact`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: pens & shells
  // -------------------------------------------------------------------------
  private updatePensAndShells(inputs: readonly InputState[]): void {
    // throw — a fresh press fires immediately; HOLDING fire keeps throwing on
    // the penRepeat cadence (classic hold-to-fire). The penMax pool is SHARED.
    // Ceremony bodies never throw: their intent is locked (real inputs are
    // read here, so the gate is explicit).
    for (let i = 0; i < this.players.length && !this.ceremonyState; i++) {
      const p = this.players[i]!;
      if (this.penCooldown[i]! > 0) this.penCooldown[i] = this.penCooldown[i]! - 1;
      const inp = inputs[i]!;
      const wants = inp.firePressed || (inp.run && this.penCooldown[i] === 0);
      if (!wants || p.dead || p.bubbleT > 0 || p.size !== 'goldpen') continue;
      const live = this.ents.reduce((n, e) => n + (e.alive && e.kind === 'pen' ? 1 : 0), 0);
      if (live < PHYS.penMax) {
        this.ents.push(spawnPen(p.x, p.y, p.facing));
        this.events.push('pen-throw'); // at the player, no source entry
        this.penCooldown[i] = PHYS.penRepeat;
      }
    }

    // pen vs enemy / boss
    for (const pen of this.ents) {
      if (!pen.alive || pen.kind !== 'pen') continue;
      for (const e of this.ents) {
        if (!e.alive || e === pen || e.dyingT > 0 || !ENEMY_KINDS.has(e.kind)) continue;
        if (Math.abs(pen.x - e.x) < PEN_HIT_RANGE && Math.abs(pen.y - e.y) < PEN_HIT_RANGE) {
          e.dyingT = ENEMY_DYING_FRAMES;
          pen.alive = false;
          this.emitAt('pen-hit', e.x, e.y);
          break;
        }
      }
      if (
        pen.alive &&
        this.boss !== null &&
        this.boss.phase === 'fight' &&
        this.bossStaggerT === 0 &&
        Math.abs(pen.x - this.boss.x) < BOSS_HIT_RANGE &&
        Math.abs(pen.y - this.boss.y) < BOSS_HIT_RANGE
      ) {
        this.boss.hp--;
        this.bossStaggerT = BOSS_PEN_STAGGER;
        pen.alive = false;
        this.emitAt('boss-hit', this.boss.x, this.boss.y);
      }
    }

    // moving shell vs enemy
    for (const shell of this.ents) {
      if (!shell.alive || shell.kind !== 'shell') continue;
      if (Math.abs(shell.vx) < SHELL_MIN_SPEED) continue;
      for (const e of this.ents) {
        if (!e.alive || e === shell || e.dyingT > 0 || !ENEMY_KINDS.has(e.kind)) continue;
        if (
          Math.abs(shell.x - e.x) < SHELL_HIT_RANGE &&
          Math.abs(shell.y - e.y) < SHELL_HIT_RANGE
        ) {
          e.dyingT = ENEMY_DYING_FRAMES;
          this.emitAt('enemy-flip', e.x, e.y);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: boss
  // -------------------------------------------------------------------------
  private updateBoss(): void {
    const boss = this.boss;
    if (!boss || !this.arena) return;

    if (boss.phase === 'off') {
      let engaged = false;
      for (const p of this.players) {
        if (this.isActive(p) && p.x > this.arena.x0 + BOSS_TRIGGER_DEPTH) {
          engaged = true;
          break;
        }
      }
      if (engaged) {
        boss.phase = 'intro';
        this.raiseGates();
        // 'boss-intro' is emitted by the boss itself on its first intro tick
        // (same frame — update() below); Level only slams the gates.
        this.emitAt('gate-slam', this.arena.x0, (this.arena.floorRow - GATE_H / 2) * TILE);
      }
    }

    if (boss.phase === 'off') return;

    // The boss, like every entity, acts on the nearest active body.
    const target = this.nearestActive(boss.x, boss.y);
    this.ctx.player = target;
    const contact = boss.update(this.ctx);
    // ceremony bodies ignore boss contact too (he has already left the stage
    // by then — bossResolved gates the pole — but belt and braces)
    if (!target.dead && !this.ceremonyState) {
      switch (contact) {
        case 'none':
          break;
        case 'stomped': {
          // The boss owns the stomp hit: it decrements its OWN hp, tracks its
          // stagger and emits 'boss-hit' before reporting 'stomped'. Level
          // only bounces the player and arms the pen-hit mirror stagger.
          this.bossStaggerT = BOSS_PEN_STAGGER;
          target.bounce(true);
          break;
        }
        case 'hurt':
          this.damage(target, boss.x);
          break;
        case 'kill':
          this.kill(target);
          break;
        case 'pickup':
          throw new Error('boss reported pickup contact');
        default: {
          const _x: never = contact;
          throw new Error(`unhandled boss contact ${String(_x)}`);
        }
      }
    }

    // 'boss-escape' / 'boss-defeat' are emitted by the boss itself;
    // Level only opens the arena again.
    if (this.gatesUp && (boss.phase === 'escape' || boss.phase === 'defeated')) {
      this.clearGates();
    }
  }

  private raiseGates(): void {
    const a = this.arena;
    if (!a || this.gatesUp) return;
    const gx0 = Math.floor(a.x0 / TILE);
    const gx1 = Math.floor(a.x1 / TILE);
    for (const gx of [gx0, gx1]) {
      for (let ty = a.floorRow - GATE_H; ty <= a.floorRow - 1; ty++) {
        this.gateTiles.push({ tx: gx, ty, prev: this.map.tileAt(gx, ty) });
        this.map.setTile(gx, ty, 'bedrock');
      }
    }
    this.gatesUp = true;
  }

  private clearGates(): void {
    for (const g of this.gateTiles) this.map.setTile(g.tx, g.ty, g.prev);
    this.gateTiles = [];
    this.gatesUp = false;
  }

  // -------------------------------------------------------------------------
  // Step 7: hazard tiles + void — sampled per active body
  // -------------------------------------------------------------------------
  private checkHazards(): void {
    // hazards are skipped for the whole cast during the ceremony (the finish
    // runway is flat and safe by act contract; this is the guarantee)
    if (this.ceremonyState) return;
    for (const p of this.players) {
      if (p.dead || p.bubbleT > 0) continue;

      // void first: below the map nothing else matters
      if (p.y > this.map.pixelH + VOID_MARGIN) {
        this.kill(p);
        continue;
      }

      const xs = [p.x - p.halfW, p.x, p.x + p.halfW];
      const ys = [p.y - p.halfH, p.y, p.y + p.halfH];
      let spike = false;
      let lava = false;
      for (const px of xs) {
        for (const py of ys) {
          const s = this.map.solidAtPx(px, py);
          if (s === 'spike') spike = true;
          else if (s === 'lava') lava = true;
        }
      }
      if (lava) {
        this.kill(p);
      } else if (spike) {
        this.damage(p, p.x); // neutral knockback
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 8: crumble tiles
  // -------------------------------------------------------------------------
  private updateCrumble(): void {
    for (const p of this.players) {
      // performers never arm new fuses (armed ones keep ticking below)
      if (this.ceremonyState) break;
      if (p.dead || p.bubbleT > 0 || !p.grounded) continue;
      const footY = p.y + p.halfH + 1;
      const ty = Math.floor(footY / TILE);
      // 1px inset so flush-touching a neighbour tile does not arm it
      const txs = new Set<number>([
        Math.floor((p.x - p.halfW + 1) / TILE),
        Math.floor(p.x / TILE),
        Math.floor((p.x + p.halfW - 1) / TILE),
      ]);
      for (const tx of txs) {
        if (this.map.tileAt(tx, ty) !== 'crumble') continue;
        const key = `${tx},${ty}`;
        if (!this.crumbleFuses.has(key)) this.crumbleFuses.set(key, CRUMBLE_FUSE);
      }
    }
    // fuses tick every frame regardless; fired tiles NEVER respawn
    for (const [key, t] of this.crumbleFuses) {
      if (t <= 1) {
        this.crumbleFuses.delete(key);
        const comma = key.indexOf(',');
        const tx = Number(key.slice(0, comma));
        const ty = Number(key.slice(comma + 1));
        this.map.setTile(tx, ty, 'empty');
        this.emitAt('crumble', (tx + 0.5) * TILE, (ty + 0.5) * TILE);
      } else {
        this.crumbleFuses.set(key, t - 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 10: camera — follows the leader (P1 in solo, exactly as before)
  // -------------------------------------------------------------------------
  private cameraTarget(): { x: number; y: number } {
    const lead = this.leader();
    return {
      x: clamp(lead.x - CAMERA.anchorX, 0, Math.max(0, this.map.pixelW - VIEW_W)),
      y: clamp(
        lead.y - CAMERA.anchorY,
        -CAMERA.overscrollTop,
        Math.max(-CAMERA.overscrollTop, this.map.pixelH - VIEW_H),
      ),
    };
  }

  private snapCamera(): void {
    const t = this.cameraTarget();
    this.camera.x = t.x;
    this.camera.y = t.y;
  }

  private moveCamera(): void {
    const t = this.cameraTarget();
    let dx = t.x - this.camera.x;
    if (dx > CAMERA.deadzoneX) dx -= CAMERA.deadzoneX;
    else if (dx < -CAMERA.deadzoneX) dx += CAMERA.deadzoneX;
    else dx = 0;
    this.camera.x += clamp(dx, -CAMERA.maxPan, CAMERA.maxPan);

    let dy = t.y - this.camera.y;
    if (dy > CAMERA.deadzoneY) dy -= CAMERA.deadzoneY;
    else if (dy < -CAMERA.deadzoneY) dy += CAMERA.deadzoneY;
    else dy = 0;
    this.camera.y += clamp(dy, -CAMERA.maxPan, CAMERA.maxPan);

    // never pan outside the clamp box
    this.camera.x = clamp(this.camera.x, 0, Math.max(0, this.map.pixelW - VIEW_W));
    this.camera.y = clamp(
      this.camera.y,
      -CAMERA.overscrollTop,
      Math.max(-CAMERA.overscrollTop, this.map.pixelH - VIEW_H),
    );
  }
}
