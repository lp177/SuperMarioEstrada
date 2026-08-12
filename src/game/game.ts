import type {
  GameLike, ProgressData, SceneLike, SceneName, SceneParams, SettingsData,
} from '../core/types.ts';
import type { Input } from '../core/input.ts';
import type { Sfx } from '../audio/sfx.ts';
import type { Music } from '../audio/music.ts';

/** Shared services handed to every scene. Sfx/Music are singletons created in
 *  main.ts — scenes must never construct their own (WebAudio unlock lives on
 *  the one instance). */
export interface Services {
  input: Input;
  sfx: Sfx;
  music: Music;
  settings: SettingsData;
  saveSettings: () => void;
  progress: ProgressData;
  setProgress: (p: ProgressData) => void;
  reducedMotion: () => boolean;
  /** Session mode: false = solo (Mangiani + swap key), true = local co-op
   *  (P2 = Estrada on secondary keys / second gamepad). Set by the title
   *  menu, read by the level scene. */
  coop: boolean;
}

export type SceneFactory = {
  [S in SceneName]: (game: Game, services: Services, params: SceneParams[S]) => SceneLike;
};

const STEP_MS = 1000 / 60;
/** A slow frame dilates time instead of spiralling: at most 6 steps per rAF. */
const MAX_ACC_MS = 100;
/** Scene-fade duration in fixed steps (runs inside update, so it is
 *  refresh-rate independent — an improvement over the house ancestor). */
const FADE_STEPS = 18;

export class Game implements GameLike {
  frame = 0;
  private scene: SceneLike;
  private acc = 0;
  private last = -1;
  /** null = no transition; otherwise counts fade-out then fade-in. */
  private fade: { out: number; in: number; swap: (() => SceneLike) | null } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly services: Services,
    private readonly factories: SceneFactory,
    first: SceneName = 'title',
  ) {
    // Exhaustive registry: constructing the first scene proves the name maps.
    this.scene = this.build(first, {} as SceneParams[typeof first]);
  }

  private build<S extends SceneName>(name: S, params: SceneParams[S]): SceneLike {
    const f = this.factories[name];
    return f(this, this.services, params);
  }

  changeScene<S extends SceneName>(name: S, params: SceneParams[S]): void {
    if (this.fade) return; // self-guard re-entry during a transition
    this.fade = { out: FADE_STEPS, in: FADE_STEPS, swap: () => this.build(name, params) };
  }

  /** One fixed 1/60s step. Public so tests and probes can drive it headless. */
  step(): void {
    this.frame++;
    // Arm WebAudio on the first real user gesture — ONE owner for the unlock,
    // covering every scene (scenes' own sfx.ensure() calls are idempotent).
    if (this.services.input.edges().size > 0) {
      this.services.sfx.ensure();
      this.services.music.ensure();
    }
    if (this.fade) {
      if (this.fade.out > 0) {
        this.fade.out--;
        this.scene.update(); // outgoing scene keeps running under the fade
        if (this.fade.out === 0 && this.fade.swap) {
          this.scene = this.fade.swap();
          this.fade.swap = null;
          // A level build may have taken real time — discard it, don't burst.
          this.acc = 0;
        }
      } else if (this.fade.in > 0) {
        this.fade.in--;
        this.scene.update();
        if (this.fade.in === 0) this.fade = null;
      }
    } else {
      this.scene.update();
    }
    this.services.input.endFrame();
  }

  /** rAF driver. Only called in the browser (main.ts). */
  tick = (now: number): void => {
    if (this.last < 0) this.last = now;
    this.acc += Math.min(now - this.last, MAX_ACC_MS);
    this.last = now;
    while (this.acc >= STEP_MS) {
      this.step();
      this.acc -= STEP_MS;
    }
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      this.scene.render(ctx);
      if (this.fade) {
        const a = this.fade.out > 0
          ? 1 - this.fade.out / FADE_STEPS
          : this.fade.in / FADE_STEPS;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();
      }
    }
    requestAnimationFrame(this.tick);
  };

  get currentScene(): SceneLike {
    return this.scene;
  }
}
