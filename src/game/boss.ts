// ============================================================================
// Bowsonaro — the staged castle "fight". Bolsonaro in a spiked shell, hopping
// around an arena, throwing paper "decrees" at the fake hero. Three of the
// four fights are theater: at 0 hp he pulls a jetpack and escapes (the show
// must go on). Only the rage fight (world 4) ends in an actual defeat.
//
// Phase flow: 'off' -> (Level flips to 'intro' when the player crosses
// arena.x0) -> 'fight' after 120f -> 'escape' | 'defeated' at hp 0.
// Pens: the Level resolves pen hits by decrementing `hp` directly; this class
// notices hp <= 0 at the top of the next fight tick and transitions — so the
// stomp path and the pen path converge on one exit.
//
// animT NEVER resets (house rule: visuals never read a clock gameplay
// rewinds); it free-runs across every phase, including 'off'.
// ============================================================================

import type { BossLike, BossPhase, Contact, EntityCtx, PlayerLike, TileMapLike } from '../core/types.ts';
import { BOSS, TILE } from '../core/constants.ts';

/** Boss tuning without a slot in constants.ts (frozen during parallel work).
 *  Units: pixels, pixels/frame, frames at 60 Hz. */
const B = {
  halfW: 13,
  halfH: 15,
  gravity: 0.3,
  maxFall: 7,
  /** Frames between hops (counted while grounded and un-staggered). */
  hopEvery: 70,
  hopVy: -5,
  /** Chance a hop goes toward the player (else theatrically away). */
  towardBias: 0.65,
  introFrames: 120,
  /** No movement after taking a stomp — the player gets a clean retreat. */
  staggerFrames: 45,
  /** Decree (paper missile) ballistics. */
  shotVx: 2.2,
  shotVy: -3,
  shotGravity: 0.12,
  shotLifeFrames: 240,
  shotHalf: 4,
  /** Muzzle offset above his center. */
  shotMouthDy: 6,
  /** Jetpack exit (staged fights only). */
  escapeFrames: 90, // legacy floor; the real exit condition is escapeOffscreenY
  /** He is "gone" once this far above the map top — outside any camera view
   *  (the camera can only overscroll CAMERA.overscrollTop=48px above row 0). */
  escapeOffscreenY: 120,
  escapeVx: 2.5,
  escapeVy: -2.2,
  /** Same generous contact rules as regular enemies. */
  stompMinVy: 0.5,
  stompSlackPx: 3,
  hurtShrink: 2,
  /** Spawn distance from the right arena gate. */
  spawnFromRight: 48,
} as const;

interface BossShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export class Bowsonaro implements BossLike {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = -1;
  phase: BossPhase = 'off';
  hp: number;
  animT = 0;
  readonly halfW = B.halfW;
  readonly halfH = B.halfH;

  private readonly arena: { x0: number; x1: number; floorRow: number };
  private readonly rage: boolean;
  private readonly floorY: number;
  private shotsArr: BossShot[] = [];
  private introT = 0;
  private introEmitted = false;
  private hopT = 0;
  private shotT = 0;
  private staggerT = 0;
  private escapeT = 0;
  private grounded = true;

  constructor(arena: { x0: number; x1: number; floorRow: number }, rage: boolean) {
    this.arena = arena;
    this.rage = rage;
    this.hp = rage ? BOSS.rageHp : BOSS.hp;
    this.floorY = arena.floorRow * TILE;
    this.x = arena.x1 - B.spawnFromRight;
    this.y = this.floorY - B.halfH;
  }

  get shots(): readonly { x: number; y: number; vx: number; vy: number }[] {
    return this.shotsArr;
  }

  update(ctx: EntityCtx): Contact {
    this.animT++; // free-running, never reset, in every phase
    switch (this.phase) {
      case 'off':
        return 'none';
      case 'intro':
        return this.introTick(ctx);
      case 'fight':
        return this.fightTick(ctx);
      case 'escape':
        return this.escapeTick();
      case 'defeated':
        return 'none'; // collapsed heap; the painter reads animT for the slump
      default: {
        const _x: never = this.phase;
        throw new Error(`Bowsonaro: unknown phase ${String(_x)}`);
      }
    }
  }

  // -- intro: 120f of roaring at the camera ---------------------------------

  private introTick(ctx: EntityCtx): Contact {
    if (!this.introEmitted) {
      this.introEmitted = true;
      ctx.emit('boss-intro', this.x, this.y);
    }
    this.facing = ctx.player.x >= this.x ? 1 : -1;
    this.introT++;
    if (this.introT >= B.introFrames) this.phase = 'fight';
    return 'none';
  }

  // -- fight ----------------------------------------------------------------

  private fightTick(ctx: EntityCtx): Contact {
    const p = ctx.player;
    // Pen hits decrement hp externally; both damage paths converge here.
    if (this.hp <= 0) {
      this.finishFight(ctx);
      return 'none';
    }
    this.facing = p.x >= this.x ? 1 : -1;

    if (this.staggerT > 0) {
      // Staggered: no hops, no decrees, no body contact — a clean beat for
      // the player to retreat after landing a hit. Gravity still applies.
      this.staggerT--;
      this.physics();
      this.updateShots(ctx.map);
      return this.shotContact(p);
    }

    this.hopT++;
    if (this.grounded && this.hopT >= B.hopEvery) {
      this.hopT = 0;
      const toward = ctx.rand() < B.towardBias ? 1 : -1;
      const dir = ((p.x >= this.x ? 1 : -1) * toward) as 1 | -1;
      this.vx = dir * (this.rage ? BOSS.rageHopVx : BOSS.hopVx);
      this.vy = B.hopVy;
      this.grounded = false;
    }
    this.physics();

    this.shotT++;
    if (this.shotT >= (this.rage ? BOSS.rageShotEvery : BOSS.shotEvery)) {
      this.shotT = 0;
      this.shotsArr.push({
        x: this.x,
        y: this.y - B.shotMouthDy,
        vx: B.shotVx * (p.x >= this.x ? 1 : -1),
        vy: B.shotVy,
        life: 0,
      });
      ctx.emit('boss-shot', this.x, this.y);
    }
    this.updateShots(ctx.map);

    // Body contact. Stomp wins over everything; immunity does not one-shot a
    // boss — while immune, non-stomp body overlap is simply harmless.
    if (!p.dead && this.overlapsPlayer(p)) {
      if (p.vy > B.stompMinVy && p.y + p.halfH < this.y + B.stompSlackPx) {
        this.hp--;
        this.staggerT = B.staggerFrames;
        this.vx = 0;
        ctx.emit('boss-hit', this.x, this.y - this.halfH);
        return 'stomped'; // Level bounces the player
      }
      if (p.immunityT <= 0) return 'hurt';
    }
    return this.shotContact(p);
  }

  private finishFight(ctx: EntityCtx): void {
    this.shotsArr = [];
    this.vx = 0;
    this.vy = 0;
    if (this.rage) {
      // The real fight: he actually goes down.
      this.phase = 'defeated';
      ctx.emit('boss-defeat', this.x, this.y);
    } else {
      // The staged fights: jetpack, up-right, "you'll never audit me!"
      this.phase = 'escape';
      this.escapeT = 0;
      ctx.emit('boss-escape', this.x, this.y);
    }
  }

  private physics(): void {
    this.vy = Math.min(this.vy + B.gravity, B.maxFall);
    this.x += this.vx;
    this.y += this.vy;
    const minX = this.arena.x0 + this.halfW;
    const maxX = this.arena.x1 - this.halfW;
    if (this.x < minX) this.x = minX;
    if (this.x > maxX) this.x = maxX;
    if (this.y + this.halfH >= this.floorY) {
      this.y = this.floorY - this.halfH;
      this.vy = 0;
      if (!this.grounded) this.vx = 0; // landing ends the hop
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }

  private updateShots(map: TileMapLike): void {
    for (const s of this.shotsArr) {
      s.vy += B.shotGravity;
      s.x += s.vx;
      s.y += s.vy;
      s.life++;
    }
    this.shotsArr = this.shotsArr.filter((s) => {
      if (s.life > B.shotLifeFrames) return false;
      const sol = map.solidAtPx(s.x, s.y);
      return sol === 'pass' || sol === 'oneway'; // paper stops at floors/walls
    });
  }

  private shotContact(p: PlayerLike): Contact {
    if (p.dead || p.immunityT > 0) return 'none';
    for (let i = 0; i < this.shotsArr.length; i++) {
      const s = this.shotsArr[i]!;
      if (Math.abs(s.x - p.x) < p.halfW + B.shotHalf && Math.abs(s.y - p.y) < p.halfH + B.shotHalf) {
        this.shotsArr.splice(i, 1); // the decree crumples on impact
        return 'hurt';
      }
    }
    return 'none';
  }

  private overlapsPlayer(p: PlayerLike): boolean {
    return (
      Math.abs(p.x - this.x) < p.halfW + this.halfW - B.hurtShrink &&
      Math.abs(p.y - this.y) < p.halfH + this.halfH - B.hurtShrink
    );
  }

  // -- escape: jetpack up-right until fully OFF-SCREEN, then inert ----------
  // (A fixed 90-frame flight once parked him hovering in the top-right corner
  // of the camera, visibly stuck — playtest report. He now keeps flying until
  // he is well above any possible camera view; the painter culls him there.)

  private escapeTick(): Contact {
    const gone = this.y < -B.escapeOffscreenY;
    if (!gone) {
      this.escapeT++;
      this.vx = B.escapeVx;
      this.vy = B.escapeVy;
      this.x += this.vx;
      this.y += this.vy;
    } else {
      this.vx = 0;
      this.vy = 0;
    }
    return 'none';
  }
}
