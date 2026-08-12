// ============================================================================
// The player — Super Mario Estrada himself: a fake hero with real physics.
// THE feel core. Implements PHYS (constants.ts) exactly, fixed 1/60 s steps.
//
// Contract notes (AGENTS.md + types.ts):
// - x,y is the CENTER of the AABB; y grows downward; feet = y + halfH.
// - update() raises ONLY 'jump' | 'land' | 'skid'. 'hurt' / 'die' / 'respawn'
//   are raised by the methods Level calls. Everything else (coins, stomps,
//   springs, hazard tiles...) is Level's business — the player never damages
//   itself; Level.damagePlayer is the one damage path.
// - A dead player is INERT: gravity-only fall through nothing, no collisions,
//   no events; bounce()/grow()/hurt() do nothing on a corpse.
// - Collision: X then Y, 3 sensor points per face. Speed caps stay well below
//   TILE/frame, so single-tile probes suffice (see PHYS comment).
// ============================================================================

import type {
  CharacterId,
  GameEvent,
  InputState,
  PlayerLike,
  PlayerSize,
  PowerupKind,
  SpawnPoint,
  TileMapLike,
} from '../core/types.ts';
import { PHYS, TILE } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Numbers the player spec fixes but the tuning table does not name. Each is a
// deliberate tuning decision documented here — not an accidental magic number.
// ---------------------------------------------------------------------------
/** Raise 'skid' only when reversing above this speed (quiet shuffle turns). */
const SKID_EVENT_MIN_VX = 1.5;
/** Landing raises 'land' only after this many airborne frames (no spam). */
const LAND_EVENT_MIN_AIR = 6;
/** Post-hurt knockback speed, pointed away from the attacker. */
const KNOCKBACK_VX = 2;
/** Respawn grace invulnerability (shorter than a real hit's PHYS.invuln). */
const RESPAWN_INVULN = 90;
/** Collision epsilon: keeps a resolved edge just outside the solid tile. */
const EPS = 0.01;
/** Oneway tolerance: feet at most this far below a tile top still count as
 *  "were above it last step" (float noise from landing snaps). */
const ONEWAY_TOL = 0.01;
/** Sensor inset (px) so face probes never sample the perpendicular faces'
 *  own contact tiles (e.g. the floor the player stands on). */
const SENSOR_INSET = 2;

export class Player implements PlayerLike {
  /** Who this body is drawn as. Solo: Level.swapCharacter toggles it in
   *  place; co-op: fixed per slot (P1 mangiani, P2 estrada). Physics are
   *  IDENTICAL either way — this field is sprite/palette/fiction only. */
  character: CharacterId;
  /** Co-op bubble countdown (see PlayerLike). Solo: always 0. The Level owns
   *  every transition; the player itself never reads or ticks it. */
  bubbleT = 0;
  /** Inside the goal door (end ceremony) — the painter skips hidden bodies.
   *  The Level's ceremony sets it; respawn() clears it. */
  hidden = false;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  grounded = false;
  ducking = false;
  skidding = false;
  size: PlayerSize = 'small';
  immunityT = 0;
  invulnT = 0;
  dead = false;
  events: GameEvent[] = [];
  bumpedTile: { tx: number; ty: number } | null = null;
  halfW: number = PHYS.smallHalf[0];
  halfH: number = PHYS.smallHalf[1];
  /** Free-running animation clock — never reset by gameplay. */
  animT = 0;

  /** Coyote frames left: jump still allowed shortly after leaving a ledge. */
  private coyote = 0;
  /** Buffered-jump frames left: a press shortly before landing still jumps. */
  private jumpBuf = 0;
  /** True from jump initiation until landing/bounce — gates gravHold. */
  private jumping = false;
  /** Airborne frame counter, for the no-landing-spam rule. */
  private airFrames = 0;
  /** Edge latch so one continuous skid raises 'skid' exactly once. */
  private skidLatch = false;

  constructor(at: SpawnPoint, character: CharacterId = 'mangiani') {
    this.x = at.x;
    this.y = at.y;
    this.character = character;
  }

  // -------------------------------------------------------------------------
  // Box management
  // -------------------------------------------------------------------------

  private halfHFor(size: PlayerSize, ducking: boolean): number {
    switch (size) {
      case 'small':
        return PHYS.smallHalf[1];
      case 'certified':
      case 'goldpen':
        return ducking ? PHYS.duckHalf[1] : PHYS.bigHalf[1];
      default: {
        const _x: never = size;
        throw new Error(`unknown player size: ${String(_x)}`);
      }
    }
  }

  /** Change size/duck state, preserving the feet line (y is the center). */
  private setBox(size: PlayerSize, ducking: boolean): void {
    const feet = this.y + this.halfH;
    this.size = size;
    this.ducking = ducking;
    this.halfH = this.halfHFor(size, ducking);
    this.y = feet - this.halfH;
  }

  /** Would the full-height box fit if we unducked right now? Probes the band
   *  of space the taller box would newly occupy above the current head. */
  private canStandUp(map: TileMapLike): boolean {
    const feet = this.y + this.halfH;
    const tallHalf = this.halfHFor(this.size, false);
    const newTop = feet - tallHalf * 2;
    const oldTop = this.y - this.halfH;
    if (newTop >= oldTop) return true; // not actually growing
    const band = oldTop - newTop;
    const ys = [newTop + 1, newTop + band / 2, oldTop - 1];
    const xs = [this.x - this.halfW + 1, this.x, this.x + this.halfW - 1];
    for (const sy of ys) {
      for (const sx of xs) {
        if (map.solidAtPx(sx, sy) === 'solid') return false;
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Sensors
  // -------------------------------------------------------------------------

  /** Any 'solid' along a vertical face at x-position px? (oneway, spike and
   *  lava never block sideways movement — hazards are Level's damage path). */
  private sideBlocked(map: TileMapLike, px: number): boolean {
    const ys = [
      this.y - this.halfH + SENSOR_INSET,
      this.y,
      this.y + this.halfH - SENSOR_INSET,
    ];
    for (const sy of ys) {
      if (map.solidAtPx(px, sy) === 'solid') return true;
    }
    return false;
  }

  private faceXs(): number[] {
    return [this.x - this.halfW + 1, this.x, this.x + this.halfW - 1];
  }

  // -------------------------------------------------------------------------
  // The fixed step
  // -------------------------------------------------------------------------

  update(input: InputState, map: TileMapLike): void {
    // (1) fresh step: clear per-step outputs
    this.events.length = 0;
    this.bumpedTile = null;
    this.animT++;

    if (this.dead) {
      // Dead physics: an inert corpse. Gravity-only fall through nothing —
      // no collisions, no input, no events. Level owns the respawn timer.
      this.vy = Math.min(this.vy + PHYS.grav, PHYS.maxFall);
      this.x += this.vx;
      this.y += this.vy;
      return;
    }

    if (this.invulnT > 0) this.invulnT--;
    if (this.immunityT > 0) this.immunityT--;

    // (2) horizontal intent ---------------------------------------------------
    const dir = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) as -1 | 0 | 1;
    if (dir !== 0) this.facing = dir;
    this.skidding = false;

    if (dir === 0 || this.ducking) {
      // No intent (or ducking, which kills acceleration but keeps friction).
      if (this.grounded) {
        if (this.vx > 0) this.vx = Math.max(0, this.vx - PHYS.frc);
        else if (this.vx < 0) this.vx = Math.min(0, this.vx + PHYS.frc);
      }
    } else {
      const max = input.run ? PHYS.runMax : PHYS.walkMax;
      const a =
        (this.grounded ? PHYS.acc : PHYS.airAcc) *
        (input.run ? PHYS.runBoost : 1);
      const along = this.vx * dir; // signed speed toward the intent
      if (along < 0) {
        // Reversing against current motion.
        if (this.grounded) {
          this.skidding = true;
          if (-along > SKID_EVENT_MIN_VX && !this.skidLatch) {
            this.skidLatch = true;
            this.events.push('skid');
          }
          this.vx += dir * PHYS.skid;
          if (this.vx * dir > 0) this.vx = 0; // don't overshoot rest in one step
        } else {
          this.vx += dir * a; // air control, no skid
        }
      } else if (along < max) {
        this.vx = dir * Math.min(along + a, max);
      }
      // along >= max: NO CLAMP. Springs/shells may push |vx| past the cap;
      // holding the key must never eat that speed (the historical
      // spring-eating bug — do not accelerate, do not reduce).
    }
    if (!this.skidding) this.skidLatch = false;

    // (3) jumping -------------------------------------------------------------
    if (this.grounded) this.coyote = PHYS.coyote;
    else if (this.coyote > 0) this.coyote--;
    if (input.jumpPressed) this.jumpBuf = PHYS.jumpBuffer;
    else if (this.jumpBuf > 0) this.jumpBuf--;

    if (this.jumpBuf > 0 && this.coyote > 0) {
      // Takeoff scales LINEARLY with ground speed (SMW model) — no threshold
      // step — saturating at jumpBonusAtVx so any committed movement earns
      // the full calibrated takeoff.
      this.vy =
        PHYS.jump +
        PHYS.jumpRunBonus * Math.min(1, Math.abs(this.vx) / PHYS.jumpBonusAtVx);
      this.jumpBuf = 0;
      this.coyote = 0;
      this.jumping = true;
      this.grounded = false;
      this.events.push('jump');
    }

    // Variable jump height, two mechanisms working together:
    // - light gravity while rising with jump held (the stretch), and
    // - a jump-CUT on release: letting go while still rising clamps upward
    //   speed, so a tap gives a genuine short hop. Real jumps only
    //   (this.jumping) — bounces/springs clear the flag and keep their arc.
    if (!input.jump && this.jumping && this.vy < -PHYS.jumpCut) {
      this.vy = -PHYS.jumpCut;
    }
    // Three-phase gravity (SMW research): light while rising held, HEAVY
    // while rising released (fast apex turnover), and a fall gravity between
    // the two — descents float relative to the post-release rise.
    const g =
      this.vy < 0
        ? input.jump && this.jumping
          ? PHYS.gravHold
          : PHYS.gravRise
        : PHYS.grav;
    this.vy = Math.min(this.vy + g, PHYS.maxFall);

    // (4) ducking -------------------------------------------------------------
    if (!this.ducking) {
      if (input.down && this.grounded && this.size !== 'small') {
        this.setBox(this.size, true);
      }
    } else if (this.size === 'small') {
      // Shrunk while ducked: small never ducks (same box height, no probe).
      this.setBox('small', false);
    } else if (!input.down) {
      if (this.canStandUp(map)) this.setBox(this.size, false);
      // else: pinned under a low ceiling — stay ducked.
    }

    // (5) move & collide: X then Y -------------------------------------------
    const prevFeet = this.y + this.halfH;

    this.x += this.vx;
    if (this.vx > 0) {
      const edge = this.x + this.halfW;
      if (this.sideBlocked(map, edge)) {
        this.x = Math.floor(edge / TILE) * TILE - this.halfW - EPS;
        this.vx = 0;
      }
    } else if (this.vx < 0) {
      const edge = this.x - this.halfW;
      if (this.sideBlocked(map, edge)) {
        this.x = (Math.floor(edge / TILE) + 1) * TILE + this.halfW + EPS;
        this.vx = 0;
      }
    }

    const wasGrounded = this.grounded;
    this.y += this.vy;
    if (this.vy >= 0) {
      // Falling (or resting): feet probe.
      const feetY = this.y + this.halfH;
      const ty = Math.floor(feetY / TILE);
      let landed = false;
      for (const sx of this.faceXs()) {
        const s = map.solidAtPx(sx, feetY);
        if (
          s === 'solid' ||
          (s === 'oneway' && prevFeet <= ty * TILE + ONEWAY_TOL)
        ) {
          landed = true;
          break;
        }
      }
      if (landed) {
        this.y = ty * TILE - this.halfH;
        this.vy = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    } else {
      // Rising: head probe.
      this.grounded = false;
      const headY = this.y - this.halfH;
      const ty = Math.floor(headY / TILE);
      const hitTxs: number[] = [];
      for (const sx of this.faceXs()) {
        if (map.solidAtPx(sx, headY) === 'solid') {
          hitTxs.push(Math.floor(sx / TILE));
        }
      }
      if (hitTxs.length > 0) {
        this.y = (ty + 1) * TILE + this.halfH + EPS;
        this.vy = 0;
        // Head-bump: of the hit tiles, take the one nearest the head center;
        // if it is bumpable, report it — Level mutates the tile and scores.
        let best = hitTxs[0]!;
        let bestD = Infinity;
        for (const tx of hitTxs) {
          const d = Math.abs((tx + 0.5) * TILE - this.x);
          if (d < bestD) {
            bestD = d;
            best = tx;
          }
        }
        const kind = map.tileAt(best, ty);
        if (kind === 'brick' || kind === 'qblock') {
          this.bumpedTile = { tx: best, ty };
        }
      }
    }

    // (6) grounded-transition bookkeeping
    if (this.grounded) {
      if (!wasGrounded && this.airFrames >= LAND_EVENT_MIN_AIR) {
        this.events.push('land');
      }
      this.airFrames = 0;
      this.jumping = false;
    } else {
      this.airFrames++;
    }
  }

  // -------------------------------------------------------------------------
  // Level-driven verbs
  // -------------------------------------------------------------------------

  /** Bounce after stomping something (or off a spring). Sets vy directly and
   *  clears the jumping flag so gravHold can't stretch it. Raises nothing —
   *  Level raises the matching event. */
  bounce(strong: boolean): void {
    if (this.dead) return;
    this.vy = strong ? PHYS.bounceHold : PHYS.bounce;
    this.jumping = false;
    this.grounded = false;
  }

  /** The one damage path (Level calls this). goldpen->certified->small->dead.
   *  Returns true only if it actually hurt. */
  hurt(fromX: number): boolean {
    if (this.dead || this.invulnT > 0 || this.immunityT > 0) return false;
    const away: 1 | -1 = this.x < fromX ? -1 : 1;
    switch (this.size) {
      case 'goldpen':
        this.setBox('certified', this.ducking);
        this.invulnT = PHYS.invuln;
        this.vx = away * KNOCKBACK_VX;
        this.events.push('hurt');
        return true;
      case 'certified':
        this.setBox('small', false);
        this.invulnT = PHYS.invuln;
        this.vx = away * KNOCKBACK_VX;
        this.events.push('hurt');
        return true;
      case 'small':
        this.dead = true;
        this.grounded = false;
        this.skidding = false;
        this.vx = 0;
        this.vy = PHYS.jump; // classic corpse pop, then gravity-only fall
        this.events.push('die');
        return true;
      default: {
        const _x: never = this.size;
        throw new Error(`unknown player size: ${String(_x)}`);
      }
    }
  }

  /** Powerup effect. Raises nothing — Level raises 'powerup-grab' + scores. */
  grow(kind: PowerupKind): void {
    if (this.dead) return;
    switch (kind) {
      case 'stamp':
        // Officially Certified. Already certified/goldpen: Level scores it.
        if (this.size === 'small') this.setBox('certified', false);
        break;
      case 'goldpen':
        this.setBox('goldpen', this.size === 'small' ? false : this.ducking);
        break;
      case 'immunity':
        this.immunityT = PHYS.immunity;
        break;
      default: {
        const _x: never = kind;
        throw new Error(`unknown powerup: ${String(_x)}`);
      }
    }
  }

  /** Back to the checkpoint, small and classic, with a short grace window. */
  respawn(at: SpawnPoint): void {
    this.x = at.x;
    this.y = at.y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.size = 'small';
    this.halfW = PHYS.smallHalf[0];
    this.halfH = PHYS.smallHalf[1];
    this.grounded = false;
    this.ducking = false;
    this.skidding = false;
    this.dead = false;
    this.jumping = false;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.airFrames = 0;
    this.skidLatch = false;
    this.immunityT = 0;
    this.invulnT = RESPAWN_INVULN;
    this.bumpedTile = null;
    // animT NOT reset — the animation clock free-runs (house rule).
    this.events.push('respawn');
  }
}
