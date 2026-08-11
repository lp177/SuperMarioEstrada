// ============================================================================
// Entities — every non-player, non-boss thing that lives in a level.
// Factories return objects implementing EntityLike; the Level owns the list.
//
// House rules honored here:
// - animT free-runs on EVERY update, even while dying (visuals never read a
//   clock gameplay rewinds).
// - dyingT > 0 means the death animation is playing: AI and contacts are
//   skipped; alive flips false when it reaches 0.
// - Contact DECISION lives here; Level.damagePlayer is the only code path that
//   acts on it. Hurt-boxes are shrunk 2px per side — generous to the player.
// - A player with Parliamentary Immunity flips enemies dead ('enemy-flip').
// - No Math.random / Date.now / DOM. Randomness would come from ctx.rand()
//   (none of the current kinds need it — their motion is fully positional).
// - spawn* dispatch is exhaustive with `never` guards: unknown ids THROW.
// ============================================================================

import type {
  Contact,
  EnemyKind,
  EntityCtx,
  EntityKind,
  EntityLike,
  PlayerLike,
  PowerupKind,
  TileMapLike,
} from '../core/types.ts';
import { AMBIENT_RANGE, PHYS, TILE } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Entity tuning. These numbers have no home in constants.ts (which is frozen
// during parallel work); they live here as the single named table for this
// module. Units: pixels, pixels/frame, frames at 60 Hz.
// ---------------------------------------------------------------------------
const ENT = {
  /** Gravity for everything that falls (entities are floatier than the hero). */
  gravity: 0.25,
  maxFall: 6,
  /** Squash-death animation length; flipped corpses get double (arc reads). */
  dyingFrames: 20,
  /** Center this far below the map bottom => silently despawn. */
  despawnBelowPx: 100,
  /** Enemy hurt-boxes shrink this much per side — generous to the player. */
  hurtShrink: 2,
  /** Pickup boxes GROW this much per side — also generous to the player. */
  pickupGrow: 2,
  /** Minimum downward player speed for a contact to count as a stomp. */
  stompMinVy: 0.5,
  /** Player feet may be this far below the enemy center and still stomp. */
  stompSlackPx: 3,
  /** Immunity flip: corpse launch velocities. */
  flipVx: 1.5,
  flipVy: -3,

  lobbyistSpeed: 0.4,
  pollsterSpeed: 0.5,
  shellSpeed: 4,
  shellHalfH: 6,
  ratSpeed: 1.1,

  lawyerRiseFrames: 60,
  lawyerHoldFrames: 45,
  lawyerHiddenFrames: 90,
  /** Classic mercy: the plant stays hidden while the player is this close. */
  lawyerMercyPx: 24,
  lawyerRisePx: 28,

  papSpeed: 0.8,
  papAmpPx: 24,
  papFreq: 0.05,
  papRetargetFrames: 180,

  chipHopEvery: 90,
  chipHopVx: 0.9,
  chipHopVy: -4.5,

  gavelTriggerPx: 40,
  gavelAccel: 0.55,
  gavelMaxVy: 8,
  gavelPauseFrames: 45,
  gavelRisePerFrame: 1.5,

  penGravity: 0.15,
  penBounceVy: -2.5,

  powerupEmergeFrames: 32,
  powerupEmergeVy: 0.5,
  powerupWalkSpeed: 0.6,
  immunityBounceVx: 0.8,
  immunityBounceVy: -3.5,

  /** Spring feet-detection band around the spring's top surface. */
  springGrabAbovePx: 2,
  springGrabBelowPx: 10,
} as const;

/** What a standard enemy touch resolved to, before kind-specific effects. */
type Touch = 'none' | 'stomp' | 'side';

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

abstract class BaseEntity implements EntityLike {
  kind: EntityKind;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  animT = 0;
  dyingT = 0;
  alive = true;
  index?: number;
  powerup?: PowerupKind;
  halfW: number;
  halfH: number;
  /** Flipped corpses keep ballistic motion while dying; squashed ones freeze. */
  private dyingBallistic = false;

  constructor(kind: EntityKind, x: number, y: number, halfW: number, halfH: number) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.halfW = halfW;
    this.halfH = halfH;
  }

  update(ctx: EntityCtx): Contact {
    this.animT++; // free-running, never reset
    if (!this.alive) return 'none';
    if (this.dyingT > 0) {
      if (this.dyingBallistic) {
        this.vy = Math.min(this.vy + ENT.gravity, ENT.maxFall);
        this.x += this.vx;
        this.y += this.vy;
      }
      this.dyingT--;
      if (this.dyingT <= 0) this.alive = false;
      return 'none';
    }
    const contact = this.tick(ctx);
    if (this.y > ctx.map.pixelH + ENT.despawnBelowPx) this.alive = false;
    return contact;
  }

  /** Per-kind AI + contact decision. Only runs while alive and not dying. */
  protected abstract tick(ctx: EntityCtx): Contact;

  // -- geometry helpers -----------------------------------------------------

  /** AABB overlap vs the player. Positive `shrink` narrows OUR box (hurt),
   *  negative grows it (pickups). A dead player overlaps nothing. */
  protected overlapsPlayer(p: PlayerLike, shrink: number): boolean {
    return (
      !p.dead &&
      Math.abs(p.x - this.x) < p.halfW + this.halfW - shrink &&
      Math.abs(p.y - this.y) < p.halfH + this.halfH - shrink
    );
  }

  protected stompCondition(p: PlayerLike): boolean {
    return p.vy > ENT.stompMinVy && p.y + p.halfH < this.y + ENT.stompSlackPx;
  }

  /** The standard enemy contact decision. Handles immunity (enemy dies, no
   *  contact) and the stomp-vs-side call. Kind-specific effects stay in tick. */
  protected touchEnemy(ctx: EntityCtx, stompable: boolean): Touch {
    const p = ctx.player;
    if (!this.overlapsPlayer(p, ENT.hurtShrink)) return 'none';
    if (p.immunityT > 0) {
      this.flipDie(ctx);
      return 'none';
    }
    if (stompable && this.stompCondition(p)) return 'stomp';
    return 'side';
  }

  /** Squash in place (stomped). */
  protected squashDie(): void {
    this.dyingT = ENT.dyingFrames;
    this.vx = 0;
    this.vy = 0;
  }

  /** Knocked flying (immunity, shells, pens — Level may call the same idea). */
  protected flipDie(ctx: EntityCtx): void {
    this.dyingT = ENT.dyingFrames * 2;
    this.dyingBallistic = true;
    this.vx = (this.x < ctx.player.x ? -1 : 1) * ENT.flipVx;
    this.vy = ENT.flipVy;
    ctx.emit('enemy-flip', this.x, this.y);
  }

  // -- tile probes (simple and slow — one center + feet probe) --------------

  protected wallAhead(map: TileMapLike): boolean {
    return map.solidAtPx(this.x + this.facing * (this.halfW + 1), this.y) === 'solid';
  }

  protected groundAhead(map: TileMapLike): boolean {
    const s = map.solidAtPx(this.x + this.facing * (this.halfW + 1), this.y + this.halfH + 2);
    return s === 'solid' || s === 'oneway';
  }

  /** Gravity + feet snap. Returns grounded. Onways catch us only when the
   *  feet just crossed their top edge (no teleporting up through platforms). */
  protected fall(map: TileMapLike): boolean {
    this.vy = Math.min(this.vy + ENT.gravity, ENT.maxFall);
    this.y += this.vy;
    const feet = this.y + this.halfH;
    const s = map.solidAtPx(this.x, feet);
    const onewayCatch = s === 'oneway' && this.vy >= 0 && feet % TILE <= this.vy + 1;
    if (s === 'solid' || onewayCatch) {
      this.y = Math.floor(feet / TILE) * TILE - this.halfH;
      this.vy = 0;
      return true;
    }
    return false;
  }

  /** One horizontal walk step with wall (and optional ledge) turnaround. */
  protected walk(map: TileMapLike, speed: number, turnAtLedges: boolean, grounded: boolean): void {
    this.vx = this.facing * speed;
    this.x += this.vx;
    if (this.wallAhead(map)) {
      this.x -= this.vx;
      this.turn();
    } else if (turnAtLedges && grounded && !this.groundAhead(map)) {
      this.turn();
    }
  }

  protected turn(): void {
    this.facing = this.facing === 1 ? -1 : 1;
  }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

/** Walking briefcase. Turns at walls AND ledges — too careerist to fall. */
class Lobbyist extends BaseEntity {
  constructor(x: number, y: number) {
    super('lobbyist', x, y, 7, 7);
  }
  protected override tick(ctx: EntityCtx): Contact {
    const grounded = this.fall(ctx.map);
    this.walk(ctx.map, ENT.lobbyistSpeed, true, grounded);
    const t = this.touchEnemy(ctx, true);
    if (t === 'stomp') {
      this.squashDie();
      return 'stomped';
    }
    return t === 'side' ? 'hurt' : 'none';
  }
}

/** Turtle with a red cap. Walks off ledges (no situational awareness).
 *  Stomped, it BECOMES a 'shell' (ballot box): stationary until touched,
 *  then kicked; a moving shell hurts on side contact; falls off ledges. */
class Pollster extends BaseEntity {
  constructor(x: number, y: number) {
    super('pollster', x, y, 7, 8);
  }
  protected override tick(ctx: EntityCtx): Contact {
    return this.kind === 'shell' ? this.shellTick(ctx) : this.walkerTick(ctx);
  }

  private walkerTick(ctx: EntityCtx): Contact {
    const grounded = this.fall(ctx.map);
    this.walk(ctx.map, ENT.pollsterSpeed, false, grounded);
    const t = this.touchEnemy(ctx, true);
    if (t === 'stomp') {
      // Become the ballot-box shell: stationary, low box, feet stay level.
      const feet = this.y + this.halfH;
      this.kind = 'shell';
      this.halfH = ENT.shellHalfH;
      this.y = feet - this.halfH;
      this.vx = 0;
      return 'stomped';
    }
    return t === 'side' ? 'hurt' : 'none';
  }

  private shellTick(ctx: EntityCtx): Contact {
    const moving = Math.abs(this.vx) > 0.01;
    this.fall(ctx.map);
    this.x += this.vx;
    if (this.wallAhead(ctx.map)) {
      // Ricochet off walls; ledges are NOT respected (shells fly off and
      // despawn below the map via the base rule).
      this.x -= this.vx;
      this.vx = -this.vx;
      this.turn();
    }
    const p = ctx.player;
    if (!this.overlapsPlayer(p, ENT.hurtShrink)) return 'none';
    if (p.immunityT > 0) {
      this.flipDie(ctx);
      return 'none';
    }
    if (!moving) {
      // Touched a parked shell: kick it away from the player.
      this.facing = p.x < this.x ? 1 : -1;
      this.vx = this.facing * ENT.shellSpeed;
      ctx.emit('shell-kick', this.x, this.y);
      return this.stompCondition(p) ? 'stomped' : 'none';
    }
    if (this.stompCondition(p)) {
      this.vx = 0; // stomping a moving shell parks it
      return 'stomped';
    }
    return 'hurt';
  }
}

/** Carnivorous plant in a pipe. Rise 60f / hold 45f / sink 60f / hidden 90f.
 *  Never stompable; classic mercy keeps it hidden while the player stands
 *  close. Spawn (x, y) is the fully-hidden center at the pipe mouth; it rises
 *  lawyerRisePx above that (the painter clips it to the pipe). */
type LawyerPhase = 'hidden' | 'rising' | 'up' | 'sinking';

class Lawyer extends BaseEntity {
  private lphase: LawyerPhase = 'hidden';
  private phaseT = 0;
  private readonly baseY: number;
  constructor(x: number, y: number) {
    super('lawyer', x, y, 6, 10);
    this.baseY = y;
  }
  protected override tick(ctx: EntityCtx): Contact {
    const p = ctx.player;
    this.phaseT++;
    switch (this.lphase) {
      case 'hidden':
        if (this.phaseT >= ENT.lawyerHiddenFrames && Math.abs(p.x - this.x) >= ENT.lawyerMercyPx) {
          this.lphase = 'rising';
          this.phaseT = 0;
        }
        break;
      case 'rising':
        if (this.phaseT >= ENT.lawyerRiseFrames) {
          this.lphase = 'up';
          this.phaseT = 0;
        }
        break;
      case 'up':
        if (this.phaseT >= ENT.lawyerHoldFrames) {
          this.lphase = 'sinking';
          this.phaseT = 0;
        }
        break;
      case 'sinking':
        if (this.phaseT >= ENT.lawyerRiseFrames) {
          this.lphase = 'hidden';
          this.phaseT = 0;
        }
        break;
      default: {
        const _x: never = this.lphase;
        throw new Error(`unknown lawyer phase: ${String(_x)}`);
      }
    }
    const prevY = this.y;
    this.y = this.baseY - ENT.lawyerRisePx * this.riseFrac();
    this.vy = this.y - prevY;
    if (this.riseFrac() > 0.25 && this.overlapsPlayer(p, ENT.hurtShrink)) {
      if (p.immunityT > 0) {
        this.flipDie(ctx);
        return 'none';
      }
      return 'hurt'; // never stompable, even from above
    }
    return 'none';
  }
  private riseFrac(): number {
    switch (this.lphase) {
      case 'hidden':
        return 0;
      case 'rising':
        return Math.min(1, this.phaseT / ENT.lawyerRiseFrames);
      case 'up':
        return 1;
      case 'sinking':
        return Math.max(0, 1 - this.phaseT / ENT.lawyerRiseFrames);
      default: {
        const _x: never = this.lphase;
        throw new Error(`unknown lawyer phase: ${String(_x)}`);
      }
    }
  }
}

/** Flying camera drone. Horizontal cruise + vertical sine around spawn
 *  height; re-picks which side of the player to fly toward every 180f. */
class Paparazzo extends BaseEntity {
  private readonly baseY: number;
  private retargetT = 0;
  constructor(x: number, y: number) {
    super('paparazzo', x, y, 7, 6);
    this.baseY = y;
  }
  protected override tick(ctx: EntityCtx): Contact {
    if (this.retargetT <= 0) {
      this.facing = ctx.player.x >= this.x ? 1 : -1;
      this.retargetT = ENT.papRetargetFrames;
    }
    this.retargetT--;
    this.vx = this.facing * ENT.papSpeed;
    this.x += this.vx;
    const ny = this.baseY + Math.sin(this.animT * ENT.papFreq) * ENT.papAmpPx;
    this.vy = ny - this.y;
    this.y = ny;
    const t = this.touchEnemy(ctx, true);
    if (t === 'stomp') {
      this.squashDie();
      return 'stomped';
    }
    return t === 'side' ? 'hurt' : 'none';
  }
}

/** Sewer scurrier: fast, small, turns at walls, happily runs off ledges. */
class Rat extends BaseEntity {
  constructor(x: number, y: number) {
    super('rat', x, y, 6, 5);
  }
  protected override tick(ctx: EntityCtx): Contact {
    const grounded = this.fall(ctx.map);
    this.walk(ctx.map, ENT.ratSpeed, false, grounded);
    const t = this.touchEnemy(ctx, true);
    if (t === 'stomp') {
      this.squashDie();
      return 'stomped';
    }
    return t === 'side' ? 'hurt' : 'none';
  }
}

/** Hopping stack of casino chips. Every 90f it lunges toward the player. */
class Chipstack extends BaseEntity {
  private hopT = 0;
  constructor(x: number, y: number) {
    super('chipstack', x, y, 6, 8);
  }
  protected override tick(ctx: EntityCtx): Contact {
    const grounded = this.fall(ctx.map);
    if (grounded) {
      this.vx = 0;
      this.hopT++;
      if (this.hopT >= ENT.chipHopEvery) {
        this.hopT = 0;
        this.facing = ctx.player.x >= this.x ? 1 : -1;
        this.vx = this.facing * ENT.chipHopVx;
        this.vy = ENT.chipHopVy;
      }
    }
    this.x += this.vx;
    if (this.wallAhead(ctx.map)) {
      this.x -= this.vx;
      this.vx = 0;
    }
    const t = this.touchEnemy(ctx, true);
    if (t === 'stomp') {
      this.squashDie();
      return 'stomped';
    }
    return t === 'side' ? 'hurt' : 'none';
  }
}

/** Giant judge gavel (thwomp-class). Hovers at spawn; slams when the player
 *  walks underneath; pauses; rises back. Never stompable. Its slam sound is
 *  AMBIENT: it fires on the gavel's own clock, so the emit is distance-gated
 *  by AMBIENT_RANGE — an idle player far away hears silence. */
type GavelPhase = 'idle' | 'slam' | 'pause' | 'rise';

class Gavel extends BaseEntity {
  private gphase: GavelPhase = 'idle';
  private pauseT = 0;
  private readonly baseY: number;
  constructor(x: number, y: number) {
    super('gavel', x, y, 10, 10);
    this.baseY = y;
  }
  protected override tick(ctx: EntityCtx): Contact {
    const p = ctx.player;
    switch (this.gphase) {
      case 'idle':
        if (!p.dead && Math.abs(p.x - this.x) < ENT.gavelTriggerPx && p.y > this.y) {
          this.gphase = 'slam';
          this.vy = 0;
        }
        break;
      case 'slam': {
        this.vy = Math.min(this.vy + ENT.gavelAccel, ENT.gavelMaxVy);
        this.y += this.vy;
        const feet = this.y + this.halfH;
        if (ctx.map.solidAtPx(this.x, feet) === 'solid') {
          this.y = Math.floor(feet / TILE) * TILE - this.halfH;
          this.vy = 0;
          if (Math.abs(this.x - p.x) < AMBIENT_RANGE) ctx.emit('gavel-slam', this.x, this.y);
          this.gphase = 'pause';
          this.pauseT = ENT.gavelPauseFrames;
        }
        break;
      }
      case 'pause':
        this.pauseT--;
        if (this.pauseT <= 0) this.gphase = 'rise';
        break;
      case 'rise':
        this.y -= ENT.gavelRisePerFrame;
        this.vy = -ENT.gavelRisePerFrame;
        if (this.y <= this.baseY) {
          this.y = this.baseY;
          this.vy = 0;
          this.gphase = 'idle';
        }
        break;
      default: {
        const _x: never = this.gphase;
        throw new Error(`unknown gavel phase: ${String(_x)}`);
      }
    }
    // Not stompable, and too heavy for immunity to flip: an immune player
    // just passes through (they cannot be hurt; the gavel survives).
    if (this.overlapsPlayer(p, ENT.hurtShrink) && p.immunityT <= 0) {
      return 'hurt'; // even mid-slam — 'kill' would be too harsh (generous)
    }
    return 'none';
  }
}

// ---------------------------------------------------------------------------
// Pen projectile — the player's thrown exploding pen. It only flies, bounces
// on floors and dies on walls / after penLife frames. Level resolves
// pen-vs-enemy (it owns the entity list) and emits 'pen-hit'.
// ---------------------------------------------------------------------------

class Pen extends BaseEntity {
  private life = 0;
  constructor(x: number, y: number, dir: 1 | -1) {
    super('pen', x, y, 3, 3);
    this.facing = dir;
    this.vx = dir * PHYS.penSpeed;
  }
  protected override tick(ctx: EntityCtx): Contact {
    this.life++;
    if (this.life > PHYS.penLife) {
      this.alive = false;
      return 'none';
    }
    this.vy = Math.min(this.vy + ENT.penGravity, ENT.maxFall);
    this.x += this.vx;
    this.y += this.vy;
    if (ctx.map.solidAtPx(this.x + this.facing * (this.halfW + 1), this.y) === 'solid') {
      this.alive = false;
      return 'none';
    }
    const feet = this.y + this.halfH;
    if (this.vy > 0 && ctx.map.solidAtPx(this.x, feet) === 'solid') {
      this.y = Math.floor(feet / TILE) * TILE - this.halfH;
      this.vy = ENT.penBounceVy;
    }
    return 'none';
  }
}

// ---------------------------------------------------------------------------
// Powerups
// ---------------------------------------------------------------------------

/** stamp / goldpen emerge from their block then walk (walls turn them, ledges
 *  don't stop them). immunity emerges then bounces around like it owns the
 *  place. Grabbable already while emerging — generous. */
class Powerup extends BaseEntity {
  private emergeT = ENT.powerupEmergeFrames;
  private readonly pkind: PowerupKind;
  constructor(kind: PowerupKind, x: number, y: number) {
    super('powerup', x, y, 7, 7);
    this.pkind = kind;
    this.powerup = kind;
  }
  protected override tick(ctx: EntityCtx): Contact {
    if (this.emergeT > 0) {
      this.emergeT--;
      this.y -= ENT.powerupEmergeVy;
      return this.grabCheck(ctx);
    }
    switch (this.pkind) {
      case 'stamp':
      case 'goldpen': {
        const grounded = this.fall(ctx.map);
        this.walk(ctx.map, ENT.powerupWalkSpeed, false, grounded);
        break;
      }
      case 'immunity': {
        const grounded = this.fall(ctx.map);
        if (grounded) this.vy = ENT.immunityBounceVy;
        this.vx = this.facing * ENT.immunityBounceVx;
        this.x += this.vx;
        if (this.wallAhead(ctx.map)) {
          this.x -= this.vx;
          this.turn();
        }
        break;
      }
      default: {
        const _x: never = this.pkind;
        throw new Error(`unknown powerup kind: ${String(_x)}`);
      }
    }
    return this.grabCheck(ctx);
  }
  private grabCheck(ctx: EntityCtx): Contact {
    if (this.overlapsPlayer(ctx.player, -ENT.pickupGrow)) {
      this.alive = false;
      return 'pickup';
    }
    return 'none';
  }
}

// ---------------------------------------------------------------------------
// Static pickups, spring, checkpoint
// ---------------------------------------------------------------------------

/** coin / goldbar / secret: static, bobbing is the painter's business via
 *  animT. One 'pickup' contact, then gone. */
class Pickup extends BaseEntity {
  protected override tick(ctx: EntityCtx): Contact {
    if (this.overlapsPlayer(ctx.player, -ENT.pickupGrow)) {
      this.alive = false;
      return 'pickup';
    }
    return 'none';
  }
}

/** Spring contract: it NEVER reports a contact. It raises `triggered` for
 *  exactly the steps where the falling player's feet compress it; the Level
 *  reads the flag and owns the launch (PHYS.springVy) and the 'spring' event. */
export interface SpringEntityLike extends EntityLike {
  triggered: boolean;
}

class Spring extends BaseEntity implements SpringEntityLike {
  triggered = false;
  constructor(x: number, y: number) {
    super('spring', x, y, 8, 8);
  }
  protected override tick(ctx: EntityCtx): Contact {
    this.triggered = false;
    const p = ctx.player;
    if (!p.dead && p.vy > 0) {
      const feet = p.y + p.halfH;
      const top = this.y - this.halfH;
      if (
        Math.abs(p.x - this.x) < p.halfW + this.halfW &&
        feet >= top - ENT.springGrabAbovePx &&
        feet <= top + ENT.springGrabBelowPx
      ) {
        this.triggered = true;
      }
    }
    return 'none';
  }
}

/** Checkpoint flag: reports 'pickup' exactly once, then goes inert but stays
 *  alive (and visible — claimed state is the painter's cue via the fields). */
class Checkpoint extends BaseEntity {
  claimed = false;
  constructor(x: number, y: number) {
    super('checkpoint', x, y, 10, 14);
  }
  protected override tick(ctx: EntityCtx): Contact {
    if (this.claimed) return 'none';
    if (this.overlapsPlayer(ctx.player, -ENT.pickupGrow)) {
      this.claimed = true;
      return 'pickup';
    }
    return 'none';
  }
}

// ---------------------------------------------------------------------------
// Factories — the module's public surface. Exhaustive dispatch; unknown ids
// THROW (house rule: no silent fallbacks, ever).
// ---------------------------------------------------------------------------

export function spawnEnemy(kind: EnemyKind, x: number, y: number): EntityLike {
  switch (kind) {
    case 'lobbyist':
      return new Lobbyist(x, y);
    case 'pollster':
      return new Pollster(x, y);
    case 'lawyer':
      return new Lawyer(x, y);
    case 'paparazzo':
      return new Paparazzo(x, y);
    case 'rat':
      return new Rat(x, y);
    case 'chipstack':
      return new Chipstack(x, y);
    case 'gavel':
      return new Gavel(x, y);
    default: {
      const _x: never = kind;
      throw new Error(`spawnEnemy: unknown enemy kind ${String(_x)}`);
    }
  }
}

export function spawnPickup(
  kind: 'coin' | 'goldbar' | 'secret',
  x: number,
  y: number,
  index?: number,
): EntityLike {
  let e: Pickup;
  switch (kind) {
    case 'coin':
      e = new Pickup('coin', x, y, 7, 7);
      break;
    case 'goldbar':
      e = new Pickup('goldbar', x, y, 10, 8);
      break;
    case 'secret':
      e = new Pickup('secret', x, y, 8, 8);
      break;
    default: {
      const _x: never = kind;
      throw new Error(`spawnPickup: unknown pickup kind ${String(_x)}`);
    }
  }
  if (index !== undefined) e.index = index;
  return e;
}

export function spawnSpring(x: number, y: number): SpringEntityLike {
  return new Spring(x, y);
}

export function spawnCheckpoint(x: number, y: number): EntityLike {
  return new Checkpoint(x, y);
}

export function spawnPowerup(kind: PowerupKind, x: number, y: number): EntityLike {
  switch (kind) {
    case 'stamp':
    case 'goldpen':
    case 'immunity':
      return new Powerup(kind, x, y);
    default: {
      const _x: never = kind;
      throw new Error(`spawnPowerup: unknown powerup kind ${String(_x)}`);
    }
  }
}

export function spawnPen(x: number, y: number, dir: 1 | -1): EntityLike {
  return new Pen(x, y, dir);
}
