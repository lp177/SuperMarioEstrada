// ============================================================================
// Sound effects: house chiptune stack, WebAudio, zero samples. Every sound is
// a tiny synth recipe (oscillator or filtered noise + an AD-ish envelope).
//
// RECIPES is EXHAUSTIVE over GameEvent (Record — the compiler refuses a new
// event until it declares a sound here, possibly an explicit null). At runtime
// an id outside the union THROWS: no silent fallbacks, ever. That is the
// house's #1 historical bug class and it dies here by construction.
//
// AudioContext creation is LAZY: ensure() (call on a user gesture) is the only
// place it happens, so this module imports and constructs clean in plain Node.
// ============================================================================

import type { GameEvent, SfxLike } from '../core/types.ts';

export interface Recipe {
  /** Oscillator wave, or 'noise' for a looped noise buffer through a bandpass. */
  wave: OscillatorType | 'noise';
  /** Start frequency, Hz (filter center for noise). */
  f0: number;
  /** End frequency, Hz — only travelled when `slide` is set; else equals f0. */
  f1: number;
  /** Duration in frames at 60 Hz. */
  dur: number;
  /** Peak envelope volume, 0..1 (pre master/headroom). */
  vol: number;
  /** Sequential semitone offsets from f0, evenly spread over `dur`. */
  arp?: readonly number[];
  /** Exponential glide f0 -> f1 over the full duration. */
  slide?: boolean;
  /** Second stacked oscillator (same tune, +4 cents) for brassy thickness. */
  wave2?: OscillatorType;
  /** Start offset in frames — lets layered recipes stagger (thunk THEN ching). */
  delay?: number;
}

/** A GameEvent maps to one recipe, a layered stack of recipes, or an explicit
 *  null (deliberately silent — none today; every event earns a sound). */
export type RecipeSpec = Recipe | readonly Recipe[] | null;

/** Post-recipe headroom so stacked layers cannot clip the master bus. */
const SFX_HEADROOM = 0.5;
/** Simultaneous voice cap: past this, new one-shots are dropped, not queued. */
const MAX_VOICES = 24;

// ---------------------------------------------------------------------------
// The synth-recipe table. HOUSE DOCTRINE: sfx are MUSICAL EVENTS — pitched,
// quasi-instrumental, harmonically compatible with the pentatonic score
// (arps favor pentatonic intervals: 2/4/5/7/9/12). The classic idiom rules
// the core verbs: jump = rising pitch-bend pulse blip, pipe = descending
// warble, brick = noise crunch + pitched pop, coin = bright two-tone ding,
// powerups = ascending arpeggios, die = the descending tragicomic run.
// Ambient entries (drip / slot-spin / gavel-slam / lava-bubble) are
// deliberately QUIET — they are scenery, not information.
// ---------------------------------------------------------------------------
const RECIPES: Record<GameEvent, RecipeSpec> = {
  // -- player feel ----------------------------------------------------------
  // THE jump: a two-octave rising pitch-bend on the pulse — the classic
  // upward whip, snappy enough to never smear a bunny-hop chain.
  jump: { wave: 'square', f0: 220, f1: 880, dur: 12, vol: 0.3, slide: true },
  land: { wave: 'noise', f0: 220, f1: 120, dur: 5, vol: 0.12, slide: true },
  skid: { wave: 'noise', f0: 900, f1: 480, dur: 10, vol: 0.1, slide: true },
  // Stomp reads as a musical event now: a quick rising "squish" blip (the
  // bounce, pitched) over a tiny noise click (the costume deflating).
  stomp: [
    { wave: 'square', f0: 180, f1: 560, dur: 7, vol: 0.4, slide: true },
    { wave: 'noise', f0: 2500, f1: 900, dur: 3, vol: 0.25, slide: true }, // click
  ],
  // Quick two-tone morph blip — one hero out, the other in (also the co-op
  // bubble pop): D5 answering a fourth up, with a whisper of poof underneath.
  'hero-swap': [
    { wave: 'square', f0: 587.3, f1: 587.3, dur: 12, vol: 0.3, arp: [0, 5] },
    { wave: 'noise', f0: 1400, f1: 500, dur: 6, vol: 0.12, slide: true }, // poof
  ],

  // -- pickups & blocks -----------------------------------------------------
  // The classic bright two-note ding: E6 then B6 (a fifth up).
  coin: { wave: 'square', f0: 1318.5, f1: 1318.5, dur: 12, vol: 0.3, arp: [0, 7] },
  // Notary STAMP thunk, then the cash register rings up the victim.
  certify: [
    { wave: 'triangle', f0: 160, f1: 55, dur: 7, vol: 0.5, slide: true },
    { wave: 'noise', f0: 800, f1: 300, dur: 4, vol: 0.35, slide: true },
    { wave: 'square', f0: 2093, f1: 2093, dur: 22, vol: 0.3, arp: [0, 0, 5, 12], delay: 8 },
  ],
  // Deep rich 3-note fanfare — a whole gold bar deserves brass.
  goldbar: {
    wave: 'square', wave2: 'triangle',
    f0: 196, f1: 196, dur: 30, vol: 0.4, arp: [0, 7, 12],
  },
  // Mysterious descending arp: you found something they meant to keep hidden.
  secret: { wave: 'square', f0: 1568, f1: 1568, dur: 28, vol: 0.3, arp: [0, -3, -7, -12] },
  'block-bump': { wave: 'square', f0: 180, f1: 140, dur: 6, vol: 0.3, slide: true },
  'block-empty': { wave: 'square', f0: 110, f1: 90, dur: 5, vol: 0.25, slide: true }, // dull thock
  // Classic brick: the noise CRUNCH plus a pitched POP — the rubble jumps a
  // fifth and an octave on the way out. Demolition, but make it musical.
  'brick-break': [
    { wave: 'noise', f0: 1800, f1: 300, dur: 14, vol: 0.4, slide: true },
    { wave: 'square', f0: 480, f1: 480, dur: 8, vol: 0.3, arp: [0, 7, 12] },
  ],
  // The something-is-coming ladder: a full major-pentatonic climb, one
  // octave — the mushroom-out-of-the-block idiom on OUR scale.
  'powerup-appear': {
    wave: 'square', f0: 523.3, f1: 523.3, dur: 24, vol: 0.3,
    arp: [0, 2, 4, 7, 9, 12],
  },
  // Triumphant ascending arpeggio, two octaves — corruption has never felt
  // this empowering.
  'powerup-grab': {
    wave: 'square', f0: 659.3, f1: 659.3, dur: 32, vol: 0.4,
    arp: [0, 4, 7, 12, 16, 19, 24],
  },

  // -- combat ---------------------------------------------------------------
  'pen-throw': { wave: 'square', f0: 700, f1: 1300, dur: 6, vol: 0.25, slide: true },
  'pen-hit': { wave: 'noise', f0: 1200, f1: 400, dur: 8, vol: 0.3, slide: true },
  'shell-kick': { wave: 'square', f0: 200, f1: 520, dur: 7, vol: 0.35, slide: true },
  'enemy-flip': { wave: 'triangle', f0: 350, f1: 700, dur: 8, vol: 0.3, slide: true },
  hurt: { wave: 'sawtooth', f0: 600, f1: 150, dur: 16, vol: 0.4, slide: true },
  // THE DEATH JINGLE (~1.8 s, plays over the solo world-hold while the score
  // ducks — see Level.intensity): an ORIGINAL tragicomic run on the two
  // pulse channels — a hopeful little climb, a beat of doubt, then the
  // two-octave pratfall, with the second pulse tumbling an octave below and
  // six frames behind (the pit band's trombonist is, as ever, late) — capped
  // by one low triangle thud when the career hits the floor.
  die: [
    {
      wave: 'square', f0: 1046.5, f1: 1046.5, dur: 88, vol: 0.35,
      arp: [0, 4, 7, 12, 12, 7, 2, -2, -7, -12, -17, -24],
    },
    {
      wave: 'square', f0: 523.25, f1: 523.25, dur: 88, vol: 0.18, delay: 6,
      arp: [0, 4, 7, 12, 12, 7, 2, -2, -7, -12, -17, -24],
    },
    { wave: 'triangle', f0: 110, f1: 49, dur: 16, vol: 0.5, slide: true, delay: 92 },
  ],
  respawn: { wave: 'triangle', f0: 400, f1: 800, dur: 10, vol: 0.25, slide: true },

  // -- world objects --------------------------------------------------------
  // Boing: a near-three-octave triangle whip up — the spring is an
  // instrument and it only knows glissando.
  spring: { wave: 'triangle', f0: 130, f1: 1000, dur: 14, vol: 0.35, slide: true },
  // The pipe warble: a stepped descending ZIGZAG (down a fourth, up a minor
  // third, repeat) — the classic bubbling-downward transit sound, pitched.
  pipe: {
    wave: 'square', f0: 620, f1: 620, dur: 22, vol: 0.35,
    arp: [0, -5, -2, -7, -4, -9, -6, -11, -8, -14],
  },
  checkpoint: { wave: 'square', f0: 880, f1: 880, dur: 16, vol: 0.3, arp: [0, 5] },
  goal: { wave: 'square', f0: 523.3, f1: 523.3, dur: 40, vol: 0.4, arp: [0, 4, 7, 12, 16] },
  // Flag thunks into the dirt, then a smug little self-awarded "ta-da".
  'flag-plant': [
    { wave: 'triangle', f0: 130, f1: 50, dur: 9, vol: 0.5, slide: true },
    { wave: 'noise', f0: 1500, f1: 400, dur: 4, vol: 0.25, slide: true },
    { wave: 'square', f0: 784, f1: 784, dur: 14, vol: 0.25, arp: [0, 5], delay: 10 },
  ],
  crumble: { wave: 'noise', f0: 500, f1: 200, dur: 12, vol: 0.2, slide: true },
  // Flagpole grab: a long descending ZIP as the hero slides — pitch rides
  // down nearly three octaves with a whisper of friction hiss underneath.
  'pole-slide': [
    { wave: 'square', f0: 1400, f1: 180, dur: 34, vol: 0.25, slide: true },
    { wave: 'noise', f0: 3000, f1: 700, dur: 22, vol: 0.1, slide: true },
  ],
  // The castle door: wooden THUNK, a latch clack, then the hinge CREAKS the
  // hero inside (slow rising saw, quiet — furniture, not fanfare).
  'door-in': [
    { wave: 'triangle', f0: 150, f1: 55, dur: 8, vol: 0.45, slide: true },
    { wave: 'noise', f0: 700, f1: 250, dur: 6, vol: 0.2, slide: true },
    { wave: 'sawtooth', f0: 70, f1: 160, dur: 20, vol: 0.12, slide: true, delay: 6 },
  ],

  // -- ambient (emitters distance-gate; recipes stay QUIET regardless) ------
  drip: { wave: 'triangle', f0: 1200, f1: 400, dur: 6, vol: 0.08, slide: true },
  'slot-spin': { wave: 'square', f0: 1046.5, f1: 1046.5, dur: 20, vol: 0.08, arp: [0, 2, 4, 5, 7] },
  'gavel-slam': { wave: 'noise', f0: 250, f1: 60, dur: 16, vol: 0.15, slide: true },
  'lava-bubble': { wave: 'triangle', f0: 90, f1: 45, dur: 12, vol: 0.1, slide: true },

  // -- boss: big and brassy (square + saw stacks) ---------------------------
  'boss-intro': {
    wave: 'sawtooth', wave2: 'square',
    f0: 110, f1: 110, dur: 50, vol: 0.5, arp: [0, 0, 3, 5],
  },
  'boss-hit': [
    { wave: 'sawtooth', wave2: 'square', f0: 500, f1: 90, dur: 12, vol: 0.5, slide: true },
    { wave: 'noise', f0: 2000, f1: 500, dur: 4, vol: 0.3, slide: true },
  ],
  'boss-shot': { wave: 'square', f0: 250, f1: 180, dur: 8, vol: 0.3, slide: true },
  // He flees upward complaining about the system.
  'boss-escape': { wave: 'sawtooth', f0: 440, f1: 440, dur: 40, vol: 0.4, arp: [0, -5, -10, -15] },
  'boss-defeat': {
    wave: 'sawtooth', wave2: 'square',
    f0: 220, f1: 220, dur: 70, vol: 0.5, arp: [0, -4, -8, -12, -17, -24],
  },
  'gate-slam': [
    { wave: 'square', f0: 100, f1: 45, dur: 10, vol: 0.45, slide: true },
    { wave: 'noise', f0: 400, f1: 80, dur: 12, vol: 0.4, slide: true },
  ],

  // -- UI / cutscene --------------------------------------------------------
  'ui-move': { wave: 'square', f0: 800, f1: 800, dur: 3, vol: 0.15 },
  'ui-select': { wave: 'square', f0: 660, f1: 660, dur: 10, vol: 0.25, arp: [0, 5] },
  'ui-back': { wave: 'square', f0: 500, f1: 300, dur: 8, vol: 0.2, slide: true },
  // "30 Hz-ish tick": what sells the typewriter is the 2-frame shortness, not
  // the pitch — a 110 Hz square this short reads as a pure click (and stays
  // inside the tested 40..8000 Hz band).
  'text-blip': { wave: 'square', f0: 110, f1: 110, dur: 2, vol: 0.15 },
};

/** Recipe lookup for tests and tools. Throws on ids outside the union —
 *  a renamed event must fail LOUDLY, not lose its sound. */
export function sfxRecipeFor(ev: GameEvent): RecipeSpec {
  const r: RecipeSpec | undefined = RECIPES[ev];
  if (r === undefined) throw new Error(`sfx: no recipe for unknown event "${String(ev)}"`);
  return r;
}

/** Runtime list of every event id, derived from the compile-checked table. */
export function allSfxEvents(): GameEvent[] {
  return Object.keys(RECIPES) as GameEvent[];
}

// ---------------------------------------------------------------------------
// The player. One AudioContext, one master gain, a shared seeded noise buffer.
// ---------------------------------------------------------------------------

export class Sfx implements SfxLike {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private volume = 1;
  private live = 0;

  /** Create/resume the AudioContext. Call on a user gesture before play().
   *  The ONLY place audio state is created — never at import or construct. */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return; // platform without WebAudio: stays silent (lifecycle, not an id fallback)
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.noiseBuf = makeNoiseBuffer(ctx);
    if (ctx.state === 'suspended') void ctx.resume();
  }

  /** 0..1 master sfx volume (prefs calls this; sfx never imports prefs). */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  play(ev: GameEvent): void {
    const spec = sfxRecipeFor(ev); // throws on unknown id
    if (spec === null) return; // explicitly-declared silence
    if (!this.ctx || !this.master) return; // ensure() not called yet (pre-gesture)
    const layers: readonly Recipe[] = Array.isArray(spec) ? spec : [spec as Recipe];
    for (const r of layers) this.voice(this.ctx, this.master, r);
  }

  private voice(ctx: AudioContext, master: GainNode, r: Recipe): void {
    if (this.live >= MAX_VOICES) return;
    const t = ctx.currentTime + (r.delay ?? 0) / 60;
    const durS = r.dur / 60;
    const g = ctx.createGain();
    // Retro rawness: INSTANT attack — 1.5 ms anti-click ramp only.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(r.vol * SFX_HEADROOM, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durS);
    g.connect(master);

    if (r.wave === 'noise') {
      const buf = this.noiseBuf;
      if (!buf) return; // cannot happen after ensure(); guarded for the types
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.9;
      f.frequency.setValueAtTime(r.f0, t);
      if (r.slide && r.f1 !== r.f0) f.frequency.exponentialRampToValueAtTime(r.f1, t + durS);
      src.connect(f);
      f.connect(g);
      this.startStop(src, t, durS);
    } else {
      this.osc(ctx, r.wave, r, g, t, durS, 0);
      if (r.wave2) this.osc(ctx, r.wave2, r, g, t, durS, 4);
    }
  }

  private osc(
    ctx: AudioContext,
    wave: OscillatorType,
    r: Recipe,
    out: GainNode,
    t: number,
    durS: number,
    detune: number,
  ): void {
    const o = ctx.createOscillator();
    o.type = wave;
    o.detune.value = detune;
    if (r.arp && r.arp.length > 0) {
      const step = durS / r.arp.length;
      r.arp.forEach((semi, i) => {
        o.frequency.setValueAtTime(r.f0 * Math.pow(2, semi / 12), t + i * step);
      });
    } else if (r.slide) {
      o.frequency.setValueAtTime(r.f0, t);
      o.frequency.exponentialRampToValueAtTime(r.f1, t + durS);
    } else {
      o.frequency.setValueAtTime(r.f0, t);
    }
    o.connect(out);
    this.startStop(o, t, durS);
  }

  private startStop(node: AudioScheduledSourceNode, t: number, durS: number): void {
    this.live++;
    node.onended = () => {
      this.live--;
    };
    node.start(t);
    node.stop(t + durS + 0.05);
  }
}

/** 1 s of seeded LCG noise — deterministic, no Math.random anywhere. */
function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = 0x02f6e2b1;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = (s / 4294967296) * 2 - 1;
  }
  return buf;
}
