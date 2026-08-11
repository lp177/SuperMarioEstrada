// ============================================================================
// Level — the orchestrator, and THE ONLY damage path.
//
// Owns the fixed 1/60s step order, the event list + event sources of the
// current step, the seeded entity RNG stream, the camera, the backtrack
// ratchet, the crumble fuses, the goal ceremony and the boss gates.
// Entities REPORT contact; only Level.damagePlayer / Level.kill act on it.
// ============================================================================

import type {
  BlockContents,
  BossLike,
  BuiltLevel,
  CameraState,
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
  TileMapLike,
} from '../core/types.ts';
import {
  ACT_RULES,
  AMBIENT_RANGE,
  BACKTRACK_SLACK,
  CAMERA,
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
/** Frames between death and respawn at the checkpoint. */
const RESPAWN_DELAY = 90;
/** Flag ceremony length: 'goal' fires, then this many frames later 'flag-plant'. */
const GOAL_CEREMONY_FRAMES = 90;
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
  readonly player: PlayerLike;
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
  private readonly goalY: number;
  private readonly blockContents: Map<string, BlockContents>;
  private readonly arena: { x0: number; x1: number; floorRow: number } | null;
  private readonly rng: Rng;
  private readonly ctx: EntityCtx;

  private respawnPoint: SpawnPoint;
  /** Counts down after death; at 0 the player respawns. -1 = idle. */
  private deathTimer = -1;
  /** Counts down after 'goal'; at 0 'flag-plant' fires. -1 = idle. */
  private goalTimer = -1;
  /** Crumble fuses keyed by `${tx},${ty}`; tiles never respawn. */
  private readonly crumbleFuses = new Map<string, number>();
  /** Level-side boss hit stagger for pens. */
  private bossStaggerT = 0;
  private gatesUp = false;
  private gateTiles: { tx: number; ty: number; prev: TileKind }[] = [];

  constructor(def: LevelDef) {
    this.def = def;
    const built: BuiltLevel = buildLevel(def);
    this.map = built.map;
    this.goalX = built.goalX;
    this.goalRow = built.goalRow;
    this.goalY = (built.goalRow + 0.5) * TILE;
    this.blockContents = built.blockContents;
    this.arena = built.arena;

    // Pre-validate: every qblock on the map MUST have declared contents.
    // A missing entry is a builder bug — throw NOW, never at play time.
    for (let ty = 0; ty < this.map.hTiles; ty++) {
      for (let tx = 0; tx < this.map.wTiles; tx++) {
        if (this.map.tileAt(tx, ty) === 'qblock' && !built.blockContents.has(`${tx},${ty}`)) {
          throw new Error(`level ${def.id}: qblock at ${tx},${ty} has no declared contents`);
        }
      }
    }

    this.player = new Player(built.start);
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

  /** 0..1 gameplay intensity hint for the music system. */
  get intensity(): number {
    const speed = Math.min(1, Math.abs(this.player.vx) / PHYS.runMax);
    const bossActive =
      this.boss !== null && (this.boss.phase === 'intro' || this.boss.phase === 'fight');
    return Math.min(1, 0.3 + 0.3 * speed + (bossActive ? 0.4 : 0));
  }

  // -------------------------------------------------------------------------
  // The fixed 1/60s step.
  // -------------------------------------------------------------------------
  update(input: InputState): GameEvent[] {
    // 1. bookkeeping
    this.stats.frames++;
    this._eventSources.clear();
    this.events = [];
    this.jumpHeld = input.jump; // stomp bounce height reads this step's hold
    if (this.bossStaggerT > 0) this.bossStaggerT--;

    // 2. player physics. Player events are read at the END of the step: hurt()
    // / bounce() / respawn() may append to player.events mid-step and reading
    // early would drop them (they get cleared by the next update()).
    this.player.update(input, this.map);

    // death timer -> respawn (runs after player.update so a 'respawn' raised
    // by the player survives until the end-of-step collection)
    if (this.player.dead && this.deathTimer > 0) {
      this.deathTimer--;
      if (this.deathTimer === 0) {
        this.deathTimer = -1;
        this.player.respawn(this.respawnPoint);
        this._backLimitX = Math.max(0, this.respawnPoint.x - BACKTRACK_SLACK);
        this.snapCamera();
      }
    }

    // 3. head-bumped tile
    const bump = this.player.bumpedTile;
    if (bump && !this.player.dead) this.resolveBump(bump.tx, bump.ty);
    this.player.bumpedTile = null; // consumed — never process a bump twice

    // 4. entities
    for (const e of this.ents) {
      if (!e.alive) continue;
      const contact = e.update(this.ctx);
      this.resolveContact(contact, e);
    }
    // springs launch harder than a stomp bounce: bounce clears the variable-
    // jump state, then vy is overridden so the launch cannot be jump-cut.
    for (const e of this.ents) {
      if (!e.alive || e.kind !== 'spring') continue;
      const s = e as EntityLike & { triggered?: boolean };
      if (s.triggered) {
        s.triggered = false;
        if (!this.player.dead) {
          this.player.bounce(false);
          this.player.vy = PHYS.springVy;
        }
        this.emitAt('spring', e.x, e.y);
      }
    }

    // 5. pens & shells
    this.updatePensAndShells(input);

    // 6. boss
    this.updateBoss();

    // 7. hazard tiles + void
    this.checkHazards();

    // 8. crumble scheduling + fuse ticking
    this.updateCrumble();

    // 9. goal ceremony
    if (
      !this._finished &&
      this.goalTimer < 0 &&
      !this.player.dead &&
      this.player.x >= this.goalX
    ) {
      this.emitAt('goal', this.goalX, this.goalY);
      this.goalTimer = GOAL_CEREMONY_FRAMES;
    } else if (this.goalTimer > 0) {
      this.goalTimer--;
      if (this.goalTimer === 0) {
        this.emitAt('flag-plant', this.goalX, this.goalY);
        this._finished = true;
      }
    }

    // 10. backtrack ratchet + camera. While the boss gates are up the ratchet
    // freezes — the gates own confinement.
    if (!this.gatesUp) {
      this._backLimitX = Math.max(this._backLimitX, this.player.x - BACKTRACK_SLACK);
    }
    const minX = this._backLimitX + this.player.halfW;
    if (this.player.x < minX) {
      this.player.x = minX;
      if (this.player.vx < 0) this.player.vx = 0;
    }
    this.moveCamera();

    // collect player events (see step 2 note), then drop dead entities
    for (const ev of this.player.events) this.events.push(ev);
    if (this.ents.some((e) => !e.alive)) this.ents = this.ents.filter((e) => e.alive);

    return this.events;
  }

  // -------------------------------------------------------------------------
  // THE ONLY damage path.
  // -------------------------------------------------------------------------
  private damagePlayer(fromX: number): void {
    if (this.player.dead) return;
    const hurt = this.player.hurt(fromX);
    if (!hurt) return;
    if (this.player.dead) {
      // 'die' was already raised by the player itself
      this.stats.deaths++;
      this.deathTimer = RESPAWN_DELAY;
    }
  }

  /** Instant death (lava, void): bypasses sizes and invulnerability. */
  private kill(): void {
    if (this.player.dead) return;
    this.player.dead = true;
    this.player.vx = 0;
    this.events.push('die');
    this.stats.deaths++;
    this.deathTimer = RESPAWN_DELAY;
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
  // Step 3: bumped tiles
  // -------------------------------------------------------------------------
  private resolveBump(tx: number, ty: number): void {
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
        if (this.player.size !== 'small') {
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
  // Step 4: entity contact resolution
  // -------------------------------------------------------------------------
  private resolveContact(contact: Contact, e: EntityLike): void {
    if (contact !== 'none' && this.player.dead) return; // dead player is inert
    switch (contact) {
      case 'none':
        return;
      case 'stomped': {
        // a pollster mutates itself into a 'shell' on stomp — then the stomp
        // is bounce-only; likewise stomping a shell parks it, no squash
        if (e.kind !== 'shell') e.dyingT = ENEMY_DYING_FRAMES;
        this.player.bounce(this.jumpHeld);
        this.emitAt('stomp', e.x, e.y);
        return;
      }
      case 'hurt':
        this.damagePlayer(e.x);
        return;
      case 'kill':
        this.kill();
        return;
      case 'pickup':
        this.resolvePickup(e);
        return;
      default: {
        const _x: never = contact;
        throw new Error(`unhandled contact ${String(_x)}`);
      }
    }
  }

  /** input.jump for the current step, captured in update() for bounce height. */
  private jumpHeld = false;

  private resolvePickup(e: EntityLike): void {
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
        this.player.grow(e.powerup);
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
  private updatePensAndShells(input: InputState): void {
    // throw
    if (input.firePressed && !this.player.dead && this.player.size === 'goldpen') {
      const live = this.ents.reduce((n, e) => n + (e.alive && e.kind === 'pen' ? 1 : 0), 0);
      if (live < PHYS.penMax) {
        this.ents.push(spawnPen(this.player.x, this.player.y, this.player.facing));
        this.events.push('pen-throw'); // at the player, no source entry
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

    if (
      boss.phase === 'off' &&
      !this.player.dead &&
      this.player.x > this.arena.x0 + BOSS_TRIGGER_DEPTH
    ) {
      boss.phase = 'intro';
      this.raiseGates();
      // 'boss-intro' is emitted by the boss itself on its first intro tick
      // (same frame — update() below); Level only slams the gates.
      this.emitAt('gate-slam', this.arena.x0, (this.arena.floorRow - GATE_H / 2) * TILE);
    }

    if (boss.phase === 'off') return;

    const contact = boss.update(this.ctx);
    if (!this.player.dead) {
      switch (contact) {
        case 'none':
          break;
        case 'stomped': {
          // The boss owns the stomp hit: it decrements its OWN hp, tracks its
          // stagger and emits 'boss-hit' before reporting 'stomped'. Level
          // only bounces the player and arms the pen-hit mirror stagger.
          this.bossStaggerT = BOSS_PEN_STAGGER;
          this.player.bounce(true);
          break;
        }
        case 'hurt':
          this.damagePlayer(boss.x);
          break;
        case 'kill':
          this.kill();
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
  // Step 7: hazard tiles + void
  // -------------------------------------------------------------------------
  private checkHazards(): void {
    const p = this.player;
    if (p.dead) return;

    // void first: below the map nothing else matters
    if (p.y > this.map.pixelH + VOID_MARGIN) {
      this.kill();
      return;
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
      this.kill();
    } else if (spike) {
      this.damagePlayer(p.x); // neutral knockback
    }
  }

  // -------------------------------------------------------------------------
  // Step 8: crumble tiles
  // -------------------------------------------------------------------------
  private updateCrumble(): void {
    const p = this.player;
    if (!p.dead && p.grounded) {
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
  // Step 10: camera
  // -------------------------------------------------------------------------
  private cameraTarget(): { x: number; y: number } {
    return {
      x: clamp(this.player.x - CAMERA.anchorX, 0, Math.max(0, this.map.pixelW - VIEW_W)),
      y: clamp(
        this.player.y - CAMERA.anchorY,
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
