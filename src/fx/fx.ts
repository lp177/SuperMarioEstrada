// ============================================================================
// FxSystem — ALL the game juice: particles, screen shake (trauma model),
// hit-stop, full-screen flash. Deterministic: owns a seeded RNG stream and
// NEVER calls Math.random. Importable in plain Node — the only DOM types here
// are the ctx parameters, which callers provide.
//
// House policy (enforced by tests/fx.test.ts):
//   - Hit-stop comes ONLY from the HIT_STOP allow-list in constants.ts —
//     hits the player LANDS. Damage taken ('hurt','die') never freezes.
//   - 'hurt', 'die', 'boss-shot' and every ambient event: shake <= 0.3.
//   - Ambient events (drip/slot-spin/gavel-slam/lava-bubble) shake ZERO —
//     their source may be AMBIENT_RANGE-away; a camera kick from off-screen
//     reads as a bug, not juice.
//   - Reduced motion: shake adds -> 0, particle counts halved, flash alpha
//     halved, hit-stop clamped to JUICE.reducedHitStop (never zero — freeze
//     reads as weight, not motion).
// ============================================================================

import type { CameraState, FxLike, GameEvent } from '../core/types.ts';
import { HIT_STOP, JUICE, VIEW_H, VIEW_W } from '../core/constants.ts';
import { createRng, RNG_STREAM, type Rng } from '../core/rng.ts';

// ---------------------------------------------------------------------------
// Local tuning. Nothing here duplicates constants.ts — trauma/flash/pool
// numbers are fx-internal by design (spec'd in the module brief).
// ---------------------------------------------------------------------------
const FX_SEED = 1234567;
/** Particle pool hard cap; oldest particles are evicted first. */
const POOL_CAP = 400;
/** Trauma lost per frame (decays ALWAYS, even during hit-stop). */
const TRAUMA_DECAY = 0.02;
/** Default flash alpha lost per frame. */
const FLASH_DECAY = 0.03;
/** 'die' gets a slower, mournful fade. */
const FLASH_DECAY_SLOW = 0.012;
/** Cull margin around the camera viewport, px. */
const CULL_PAD = 40;

// ---------------------------------------------------------------------------
// Spec types (fx-internal; other modules only import the FxSystem class).
// ---------------------------------------------------------------------------
export type ParticleKind = 'burst' | 'shard' | 'dust' | 'sparkle' | 'paper' | 'ring';

export interface ParticleSpec {
  kind: ParticleKind;
  n: number;
  colors: readonly string[];
  /** Rough speed scale, px/frame-ish; per-kind spawners interpret it. */
  spread: number;
  gravity?: number;
  /** Placement/velocity pattern override for special shapes. */
  pattern?: 'spiral' | 'fountain';
}

export interface FxSpec {
  particles?: readonly ParticleSpec[];
  /** Trauma added (0..1). Amplitude on screen = trauma^2 * JUICE.maxShake. */
  shake?: number;
  flash?: { color: string; alpha: number; slow?: boolean };
}

// ---------------------------------------------------------------------------
// THE TABLE. Exhaustive over GameEvent — a new event does not compile until
// it declares its juice here, even if that declaration is an explicit null.
// Hit-stop is NOT declared here: it comes only from HIT_STOP (constants.ts).
// ---------------------------------------------------------------------------
export const FX_TABLE: Record<GameEvent, FxSpec | null> = {
  // player feel
  jump: { particles: [{ kind: 'dust', n: 3, colors: ['#c9bfae'], spread: 0.8 }] },
  land: { particles: [{ kind: 'dust', n: 4, colors: ['#c9bfae', '#a89f8e'], spread: 1.2 }] },
  skid: { particles: [{ kind: 'dust', n: 3, colors: ['#d8cebd'], spread: 1.7 }] },
  stomp: {
    particles: [{ kind: 'dust', n: 8, colors: ['#cfc5b4', '#a89f8e'], spread: 1.8 }],
    shake: 0.15,
  },
  // Hero morph / co-op bubble pop: a small white puff + ring. Deliberately NO
  // shake and NO hit-stop (not in HIT_STOP) — swapping is a costume change,
  // not an impact.
  'hero-swap': {
    particles: [
      { kind: 'dust', n: 6, colors: ['#ffffff', '#e8e8e8'], spread: 1.3 },
      { kind: 'ring', n: 1, colors: ['#ffffff'], spread: 2 },
    ],
  },
  // pickups & blocks
  coin: { particles: [{ kind: 'sparkle', n: 6, colors: ['#ffd54a', '#ffea90'], spread: 1 }] },
  certify: {
    // Red stamp-burst ring + paper burst. The 'CERTIFIÉ!' text is the HUD's job.
    particles: [
      { kind: 'ring', n: 1, colors: ['#e53030'], spread: 2.2 },
      { kind: 'paper', n: 8, colors: ['#fff6e0', '#e53030'], spread: 1.6 },
    ],
  },
  goldbar: {
    particles: [{ kind: 'burst', n: 18, colors: ['#ffd54a', '#ffb300', '#fff3b0'], spread: 2.6 }],
    flash: { color: '#ffd54a', alpha: 0.25 },
    shake: 0.25,
  },
  secret: {
    particles: [
      { kind: 'sparkle', n: 12, colors: ['#43d675', '#a5f2c0'], spread: 1.4, pattern: 'spiral' },
    ],
  },
  'block-bump': { particles: [{ kind: 'dust', n: 3, colors: ['#b8ae9c'], spread: 0.9 }] },
  'block-empty': null, // deliberate: the dull "it's empty" thunk is sfx's joke
  'brick-break': {
    particles: [{ kind: 'shard', n: 4, colors: ['#8a5a2b', '#6e4520'], spread: 1.8, gravity: 0.3 }],
    shake: 0.2,
  },
  'powerup-appear': {
    particles: [{ kind: 'sparkle', n: 8, colors: ['#ffffff', '#ffe08a'], spread: 1 }],
  },
  'powerup-grab': { particles: [{ kind: 'ring', n: 1, colors: ['#ffffff'], spread: 2.4 }] },
  // combat
  'pen-throw': { particles: [{ kind: 'dust', n: 2, colors: ['#3a6ea5'], spread: 0.6 }] },
  'pen-hit': {
    particles: [{ kind: 'burst', n: 10, colors: ['#2b4d8f', '#3a6ea5', '#16305e'], spread: 2 }],
  },
  'shell-kick': {
    // ballot-box shell: white paper-ballot confetti
    particles: [{ kind: 'paper', n: 10, colors: ['#ffffff', '#f2f2f2'], spread: 1.8 }],
  },
  'enemy-flip': { particles: [{ kind: 'burst', n: 6, colors: ['#ffffff'], spread: 1.6 }] },
  hurt: { flash: { color: '#e53030', alpha: 0.3 }, shake: 0.25 },
  die: { flash: { color: '#e53030', alpha: 0.4, slow: true } },
  respawn: { particles: [{ kind: 'dust', n: 6, colors: ['#ffffff', '#cfcfcf'], spread: 1.2 }] },
  // world objects
  spring: { particles: [{ kind: 'ring', n: 1, colors: ['#7fd4ff'], spread: 2 }] },
  pipe: { particles: [{ kind: 'dust', n: 4, colors: ['#9ec9a0'], spread: 1 }] },
  checkpoint: { particles: [{ kind: 'dust', n: 4, colors: ['#ffe08a'], spread: 1 }] },
  goal: {
    // confetti fountain — the fake triumph, in five patriotic-ish colors
    particles: [
      {
        kind: 'paper',
        n: 40,
        colors: ['#e53030', '#ffd54a', '#43d675', '#7fd4ff', '#ffffff'],
        spread: 2.4,
        pattern: 'fountain',
      },
    ],
  },
  'flag-plant': {
    particles: [{ kind: 'burst', n: 10, colors: ['#ffffff', '#e53030'], spread: 2 }],
    flash: { color: '#ffffff', alpha: 0.2 },
  },
  crumble: {
    particles: [
      { kind: 'shard', n: 5, colors: ['#d8cebd', '#b8ae9c'], spread: 1.2, gravity: 0.25 },
    ],
  },
  // Flagpole slide: gold sparkles rubbed off the pole at the grab point.
  // Deliberately NO shake and NO hit-stop — triumph, not impact.
  'pole-slide': {
    particles: [
      { kind: 'sparkle', n: 10, colors: ['#ffd54a', '#fff3b0', '#ffffff'], spread: 1.2 },
    ],
  },
  // A dust puff at the doorstep as a hero disappears inside. Small and dry;
  // no shake — a door closing is furniture, not an explosion.
  'door-in': {
    particles: [{ kind: 'dust', n: 6, colors: ['#c9bfae', '#8a5a2b'], spread: 1.3 }],
  },
  // ambient — tiny LOCAL particles only, ZERO shake: the emitter may be
  // hundreds of px away; an off-screen source must never kick the camera.
  drip: { particles: [{ kind: 'dust', n: 2, colors: ['#7fd4ff'], spread: 0.5 }] },
  'slot-spin': { particles: [{ kind: 'sparkle', n: 2, colors: ['#ffd54a'], spread: 0.5 }] },
  'gavel-slam': { particles: [{ kind: 'dust', n: 4, colors: ['#a89f8e'], spread: 1.4 }] },
  'lava-bubble': {
    particles: [{ kind: 'sparkle', n: 2, colors: ['#ff7a3c', '#ffb300'], spread: 0.7 }],
  },
  // boss
  'boss-intro': { shake: 0.25 },
  'boss-hit': {
    // confetti of shredded decrees
    particles: [{ kind: 'paper', n: 14, colors: ['#fff6e0', '#ffffff'], spread: 2.2 }],
    flash: { color: '#ffffff', alpha: 0.3 },
    shake: 0.5,
  },
  'boss-shot': { particles: [{ kind: 'dust', n: 3, colors: ['#fff6e0'], spread: 0.8 }] },
  'boss-escape': {
    // jetpack smoke trail
    particles: [{ kind: 'dust', n: 16, colors: ['#9c9c9c', '#6e6e6e', '#c9c9c9'], spread: 2 }],
    shake: 0.3,
  },
  'boss-defeat': {
    particles: [{ kind: 'burst', n: 30, colors: ['#ffd54a', '#e53030', '#fff3b0'], spread: 3 }],
    flash: { color: '#ffffff', alpha: 0.35 },
    shake: 0.7,
  },
  'gate-slam': {
    particles: [{ kind: 'dust', n: 8, colors: ['#a89f8e', '#7d7669'], spread: 1.8 }],
    shake: 0.4,
  },
  // UI / cutscene — no world position, no juice, on purpose
  'ui-move': null,
  'ui-select': null,
  'ui-back': null,
  'text-blip': null,
};

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------
interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Frames remaining; dead at 0. */
  life: number;
  maxLife: number;
  color: string;
  /** Px. For 'ring' this is the current radius. */
  size: number;
  gravity: number;
  /** Kind-specific: paper flutter amount, ring growth px/frame. */
  spin: number;
}

/** Which render pass a particle kind belongs to. Ground fx (dust, shards)
 *  draw before entities; airborne fx (sparkles, confetti…) after. */
const LAYER_OF: Record<ParticleKind, 'ground' | 'air'> = {
  burst: 'air',
  shard: 'ground',
  dust: 'ground',
  sparkle: 'air',
  paper: 'air',
  ring: 'air',
};

/** Deterministic integer hash -> [0,1). Same finalizer family as rng.ts, but
 *  stateless: shakeOffset(frame) must be pure-ish (frame in, offset out). */
function hash01(n: number): number {
  let t = (Math.imul(n | 0, 0x9e3779b1) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------
export class FxSystem implements FxLike {
  private readonly rng: Rng;
  private readonly reducedMotion: () => boolean;
  private readonly pool: Particle[] = [];
  /** Screen-shake trauma, 0..1. Amplitude = trauma^2 * JUICE.maxShake. */
  private trauma = 0;
  /** Hit-stop frames remaining. */
  private freezeT = 0;
  private flashState: { color: string; alpha: number; decay: number } | null = null;

  constructor(reducedMotion: () => boolean) {
    this.reducedMotion = reducedMotion;
    this.rng = createRng(FX_SEED ^ RNG_STREAM.fx);
  }

  // -- events ---------------------------------------------------------------

  onEvent(ev: GameEvent, x: number, y: number): void {
    const spec = FX_TABLE[ev];
    if (spec === undefined) throw new Error(`FxSystem.onEvent: unknown event '${String(ev)}'`);
    const rm = this.reducedMotion(); // evaluated per event, never cached

    // Hit-stop comes ONLY from the constants.ts allow-list. Freezes never
    // stack: take max(current, new); each entry is <= JUICE.maxHitStop so the
    // total can never exceed the cap, however hard the frame spams.
    const stop = HIT_STOP[ev];
    if (stop !== undefined) {
      const cap = rm ? JUICE.reducedHitStop : JUICE.maxHitStop;
      this.freezeT = Math.max(this.freezeT, Math.min(stop, cap));
    }

    if (spec === null) return; // deliberate: no visual juice for this event

    if (spec.shake !== undefined && !rm) {
      this.trauma = Math.min(1, this.trauma + spec.shake);
    }
    if (spec.flash !== undefined) {
      const alpha = rm ? spec.flash.alpha * 0.5 : spec.flash.alpha;
      // A weaker flash never downgrades a stronger active one.
      if (this.flashState === null || alpha >= this.flashState.alpha) {
        this.flashState = {
          color: spec.flash.color,
          alpha,
          decay: spec.flash.slow === true ? FLASH_DECAY_SLOW : FLASH_DECAY,
        };
      }
    }
    if (spec.particles !== undefined) {
      for (const ps of spec.particles) this.spawn(ps, x, y, rm);
    }
  }

  // -- per-frame ------------------------------------------------------------

  /** Advance fx state. Particles age ONLY while not frozen; trauma and flash
   *  decay ALWAYS (shake continuing through hit-stop is what sells it). */
  update(): void {
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY);
    if (this.flashState !== null) {
      this.flashState.alpha -= this.flashState.decay;
      if (this.flashState.alpha <= 0) this.flashState = null;
    }
    if (this.freezeT > 0) return;

    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      if (p === undefined) continue;
      p.life--;
      if (p.life <= 0) {
        this.pool.splice(i, 1);
        continue;
      }
      const age = p.maxLife - p.life;
      switch (p.kind) {
        case 'ring':
          p.size += p.spin;
          break;
        case 'paper':
          p.vy = Math.min(p.vy + p.gravity, 2.2);
          p.vx *= 0.985;
          p.x += p.vx + Math.sin(age * 0.22) * p.spin * 2;
          p.y += p.vy;
          break;
        case 'dust':
          p.vx *= 0.92;
          p.vy += p.gravity;
          p.x += p.vx;
          p.y += p.vy;
          break;
        case 'burst':
        case 'shard':
        case 'sparkle':
          p.vy += p.gravity;
          p.x += p.vx;
          p.y += p.vy;
          break;
        default: {
          const _x: never = p.kind;
          throw new Error(`FxSystem.update: unknown particle kind ${String(_x)}`);
        }
      }
    }
  }

  /** Decrement the hit-stop counter; true while the world is frozen. The
   *  level scene skips physics while this returns true. */
  tickFreeze(): boolean {
    if (this.freezeT > 0) {
      this.freezeT--;
      return true;
    }
    return false;
  }

  /** Camera shake offset. Pure-ish: direction comes from a deterministic hash
   *  of the frame number (NOT the rng — calling this twice for one frame must
   *  not perturb anything), amplitude from trauma^2 * JUICE.maxShake. */
  shakeOffset(frame: number): { x: number; y: number } {
    if (this.trauma <= 0 || this.reducedMotion()) return { x: 0, y: 0 };
    const amp = this.trauma * this.trauma * JUICE.maxShake;
    return {
      x: (hash01(frame * 2) * 2 - 1) * amp,
      y: (hash01(frame * 2 + 1) * 2 - 1) * amp,
    };
  }

  flash(): { alpha: number; color: string } | null {
    if (this.flashState === null || this.flashState.alpha <= 0) return null;
    return { alpha: this.flashState.alpha, color: this.flashState.color };
  }

  // -- rendering ------------------------------------------------------------

  /** Ground-level fx (dust, shards): drawn BEFORE entities. */
  renderGround(ctx: CanvasRenderingContext2D, cam: CameraState): void {
    this.renderLayer(ctx, cam, 'ground');
  }

  /** Airborne fx (sparkles, confetti, rings, bursts): drawn AFTER the player. */
  renderAir(ctx: CanvasRenderingContext2D, cam: CameraState): void {
    this.renderLayer(ctx, cam, 'air');
  }

  private renderLayer(ctx: CanvasRenderingContext2D, cam: CameraState, layer: 'ground' | 'air'): void {
    for (const p of this.pool) {
      if (LAYER_OF[p.kind] !== layer) continue;
      const sx = p.x - cam.x;
      const sy = p.y - cam.y;
      if (sx < -CULL_PAD || sx > VIEW_W + CULL_PAD || sy < -CULL_PAD || sy > VIEW_H + CULL_PAD) {
        continue;
      }
      this.drawParticle(ctx, p, sx, sy);
    }
  }

  private drawParticle(ctx: CanvasRenderingContext2D, p: Particle, sx: number, sy: number): void {
    const frac = p.life / p.maxLife; // 1 fresh -> 0 dead
    const age = p.maxLife - p.life;
    ctx.save();
    ctx.fillStyle = p.color;
    switch (p.kind) {
      case 'burst': {
        ctx.globalAlpha = frac;
        const s = Math.max(1, p.size * frac);
        ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
        break;
      }
      case 'shard': {
        ctx.globalAlpha = 0.5 + 0.5 * frac;
        ctx.translate(sx, sy);
        ctx.rotate(age * 0.2 * (p.spin >= 0 ? 1 : -1));
        ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
        break;
      }
      case 'dust': {
        ctx.globalAlpha = 0.6 * frac;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * (1.6 - 0.6 * frac), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'sparkle': {
        // twinkling diamond
        ctx.globalAlpha = frac * (0.55 + 0.45 * Math.sin(age * 0.9));
        ctx.translate(sx, sy);
        ctx.rotate(Math.PI / 4);
        const s = p.size;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        break;
      }
      case 'paper': {
        ctx.globalAlpha = Math.min(1, frac * 2); // fade only near the end
        ctx.translate(sx, sy);
        ctx.rotate(age * p.spin * 1.5);
        ctx.fillRect(-p.size / 2, -p.size * 0.7, p.size, p.size * 1.4);
        break;
      }
      case 'ring': {
        ctx.globalAlpha = frac;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      default: {
        const _x: never = p.kind;
        throw new Error(`FxSystem.drawParticle: unknown particle kind ${String(_x)}`);
      }
    }
    ctx.restore();
  }

  // -- spawning -------------------------------------------------------------

  private spawn(spec: ParticleSpec, x: number, y: number, rm: boolean): void {
    if (spec.colors.length === 0) throw new Error('FxSystem.spawn: empty colors list');
    const n = rm ? Math.ceil(spec.n / 2) : spec.n;
    for (let i = 0; i < n; i++) {
      const color = spec.colors[i % spec.colors.length];
      if (color === undefined) throw new Error('FxSystem.spawn: color index out of range');
      const p = this.makeParticle(spec, x, y, color, i, n);
      while (this.pool.length >= POOL_CAP) this.pool.shift(); // evict oldest
      this.pool.push(p);
    }
  }

  private makeParticle(
    spec: ParticleSpec,
    x: number,
    y: number,
    color: string,
    i: number,
    n: number,
  ): Particle {
    const r = this.rng;
    switch (spec.kind) {
      case 'burst': {
        const a = r() * Math.PI * 2;
        const sp = spec.spread * (0.6 + r() * 0.8);
        const life = 16 + Math.floor(r() * 12);
        return {
          kind: 'burst', x, y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life, maxLife: life, color,
          size: 3 + r() * 2, gravity: spec.gravity ?? 0.04, spin: 0,
        };
      }
      case 'shard': {
        const life = 30 + Math.floor(r() * 18);
        return {
          kind: 'shard', x, y,
          vx: (r() * 2 - 1) * spec.spread, vy: -(1 + r() * 2.2),
          life, maxLife: life, color,
          size: 3 + r() * 2, gravity: spec.gravity ?? 0.28, spin: r() * 2 - 1,
        };
      }
      case 'dust': {
        const a = r() * Math.PI * 2;
        const life = 14 + Math.floor(r() * 10);
        return {
          kind: 'dust', x, y,
          vx: Math.cos(a) * spec.spread * (0.3 + r() * 0.5),
          vy: -(0.2 + r() * 0.5),
          life, maxLife: life, color,
          size: 1.5 + r() * 1.5, gravity: spec.gravity ?? 0, spin: 0,
        };
      }
      case 'sparkle': {
        const life = 24 + Math.floor(r() * 14);
        if (spec.pattern === 'spiral') {
          // evenly fanned angles + rise: reads as a spiral bloom
          const a = (i / Math.max(1, n)) * Math.PI * 2 + r() * 0.3;
          return {
            kind: 'sparkle', x, y,
            vx: Math.cos(a) * spec.spread,
            vy: Math.sin(a) * spec.spread * 0.5 - 0.9,
            life, maxLife: life, color,
            size: 2 + r() * 1.5, gravity: spec.gravity ?? 0, spin: 0,
          };
        }
        return {
          kind: 'sparkle', x, y,
          vx: (r() * 2 - 1) * spec.spread * 0.5,
          vy: -(0.6 + r() * 0.9),
          life, maxLife: life, color,
          size: 2 + r() * 1.5, gravity: spec.gravity ?? 0, spin: 0,
        };
      }
      case 'paper': {
        const fountain = spec.pattern === 'fountain';
        const life = 45 + Math.floor(r() * 30);
        return {
          kind: 'paper', x, y,
          vx: (r() * 2 - 1) * spec.spread * (fountain ? 0.55 : 1),
          vy: fountain ? -(2.2 + r() * 2.2) : -(0.8 + r() * 1.6),
          life, maxLife: life, color,
          size: 2 + r() * 2, gravity: spec.gravity ?? 0.09, spin: (r() * 2 - 1) * 0.3,
        };
      }
      case 'ring': {
        return {
          kind: 'ring', x, y, vx: 0, vy: 0,
          life: 16, maxLife: 16, color,
          size: 3, gravity: 0, spin: spec.spread,
        };
      }
      default: {
        const _x: never = spec.kind;
        throw new Error(`FxSystem.makeParticle: unknown particle kind ${String(_x)}`);
      }
    }
  }

  // -- test/debug surface ---------------------------------------------------

  /** Serializable copy of the live pool (determinism & policy tests). */
  snapshot(): ReadonlyArray<{
    kind: ParticleKind;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    color: string;
    size: number;
  }> {
    return this.pool.map((p) => ({
      kind: p.kind, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      life: p.life, color: p.color, size: p.size,
    }));
  }
}
