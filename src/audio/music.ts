// ============================================================================
// Generative chiptune player. Reads the pure-data TRACKS score (tracks.ts),
// derives per-variant arrangements (arrange()), and schedules square/triangle/
// pulse/noise voices through per-layer gain buses into a gentle master lowpass.
//
// Scheduling: the classic lookahead pattern — a 25 ms interval timer keeps
// the next 120 ms of beats queued on the AudioContext clock, so tab jank
// never audibly stutters the score. The timer exists only after ensure() and
// only while at least one layer is live; this module imports and constructs
// clean in plain Node.
//
// CROSSFADES: every track change (play / playHome / playPause / endPause /
// takeover / release / stop) goes through LAYERS. The outgoing layer keeps
// being scheduled until its fade deadline while its bus gain ramps down
// (setTargetAtTime — a ramp, never a step); the incoming layer's bus ramps up
// from silence over XFADE_S. No hard cuts, no clicks, anywhere.
//
// VARIANTS: play(id, { variant }) — arrangement is derived deterministically
// in tracks.ts (arrange()); this module only realizes it: transposed root,
// swapped lead timbre (pulse-family only: square / built 25%- and 12.5%-duty
// periodic waves), variant swing, rearranged bass/percussion, thinned arps,
// and the sourNotes gag (a single deliberately off-scale nudge, once per
// loop).
//
// Intensity (0..1): scales tempo ±12% around the base bpm, opens the master
// lowpass, and drives the NOISE channel's energy (drum gain rises with heat;
// past HOT_NOISE_AT a ghost hat rides every off-8th — the Kondo-style
// interactive percussion layer that makes charged full-run play audibly
// hotter). Everything moves SMOOTHLY (per-frame easing in update(), FAST
// downward so intensity 0 doubles as a duck — the death jingle plays over a
// score that steps aside) and only affects *future* beats — playheads are
// never reset.
//
// HOME SET: playHome() rotates title/home-b/home-c through a deterministic
// shuffle bag (all 3 before any repeat, never the same twice in a row).
// HOLD SET: playPause() parks the score on rotating call-center hold muzak
// (hold-a/hold-b alternating); endPause() returns to the interrupted
// track+variant (loop restarts from the top — documented, accepted).
//
// SUSPEND: suspend()/resume() freeze/unfreeze the whole audio clock
// (AudioContext.suspend + stopping the lookahead timer so nothing piles up).
// Both are safe no-ops before ensure(); main.ts wires visibilitychange.
//
// takeover()/release() — the big-moment stack. HOUSE RULE (documented choice):
// on release we hand back RE-ROLLED — a level-family track (meadow/sewer/
// casino/castle) resumes as the NEXT family member in a fixed cycle
// (meadow->sewer->casino->castle->meadow), keeping the interrupted VARIANT,
// deterministic, so the ear never gets the identical tune twice around a
// takeover. Scene-bound tracks (title/home/hold/cutscene/ending/boss) resume
// unchanged: swapping those would put the wrong scene's score on screen. An
// unpaired release() THROWS.
// ============================================================================

import type { MusicLike, TrackId } from '../core/types.ts';
import {
  TRACKS,
  arrange,
  degreeToSemitone,
  midiToFreq,
  type Arrangement,
  type StepNote,
  type TrackConfig,
} from './tracks.ts';

const TICK_MS = 25;
const LOOKAHEAD_S = 0.12;
/** Crossfade length for every track change (the brief's ~0.4..0.8 s band). */
const XFADE_S = 0.55;
/** Tempo travels bpm * (1 ± TEMPO_SPAN/2) across intensity 0..1. */
const TEMPO_SPAN = 0.24;
/** Master lowpass: 900 Hz closed .. ~7200 Hz open. */
const FILTER_BASE_HZ = 900;
const FILTER_OCTAVES = 3;
/** Per-frame easing toward the intensity target (60 Hz update()). Rising is
 *  slow (heat builds), falling is FAST — a dropped target reads as a duck
 *  (Level sends 0 during the solo death sequence; the score must bow out
 *  under the jingle within a couple of beats, then come back the slow way). */
const INTENSITY_EASE_UP = 0.05;
const INTENSITY_EASE_DOWN = 0.12;
const MASTER_HEADROOM = 0.9;

// -- the Kondo-style interactive NOISE layer (see header) --------------------
/** Drum gain multiplier travels floor..ceil across intensity 0..1. */
const NOISE_GAIN_FLOOR = 0.7;
const NOISE_GAIN_CEIL = 1.3;
/** Above this eased intensity the noise channel gets its ghost-hat lift.
 *  Calibrated against Level.intensity: charged full run reaches ~0.75, every
 *  non-boss state below full run stays under ~0.5 — only the run state (and
 *  hot boss play) crosses it. */
const HOT_NOISE_AT = 0.7;
/** Ghost hats ride at half the (already intensity-scaled) hat gain. */
const GHOST_HAT_GAIN = 0.5;

/** Home-screen rotation set (shuffle-bag; see playHome()). */
export const HOME_SET: readonly TrackId[] = ['title', 'home-b', 'home-c'];
/** Pause-menu hold-muzak rotation (alternating; see playPause()). */
export const HOLD_SET: readonly TrackId[] = ['hold-a', 'hold-b'];

type VoiceName = 'bass' | 'lead' | 'arp' | 'noise';

interface TonalSpec {
  wave: OscillatorType;
  gain: number;
  /** Register offset in octaves, applied on top of the track root. */
  oct: number;
}

/** Exhaustive over VoiceName; noise is null because it dispatches to drums.
 *  THE FOUR CHANNELS (house doctrine, see tracks.ts): lead + arp are the TWO
 *  pulse channels (variants only ever swap the lead between pulse duties),
 *  bass is THE one triangle, noise is the drum kit. The lead's wave is the
 *  BASE timbre — variants may override it (pulse-family only). */
const TONAL: Record<VoiceName, TonalSpec | null> = {
  bass: { wave: 'triangle', gain: 0.3, oct: 0 },
  lead: { wave: 'square', gain: 0.16, oct: 1 },
  arp: { wave: 'square', gain: 0.08, oct: 2 },
  noise: null,
};

/** The closed drum set for noise-pattern degrees (see tracks.ts grammar). */
const DRUMS: Record<number, { filter: BiquadFilterType; freq: number; durS: number; gain: number }> = {
  0: { filter: 'highpass', freq: 6000, durS: 0.035, gain: 0.1 }, // closed hat
  1: { filter: 'bandpass', freq: 1900, durS: 0.09, gain: 0.16 }, // snare
  2: { filter: 'lowpass', freq: 220, durS: 0.1, gain: 0.3 }, // low thud
};

/** Re-roll table for release() — exhaustive, deterministic (no Math.random
 *  in anything the sim might share a frame with). Level family cycles;
 *  scene-bound tracks (incl. the home and hold sets) map to themselves. */
const HANDBACK: Record<TrackId, TrackId> = {
  meadow: 'sewer',
  sewer: 'casino',
  casino: 'castle',
  castle: 'meadow',
  title: 'title',
  'home-b': 'home-b',
  'home-c': 'home-c',
  'hold-a': 'hold-a',
  'hold-b': 'hold-b',
  cutscene: 'cutscene',
  ending: 'ending',
  boss: 'boss',
};

interface ParsedVoice {
  name: VoiceName;
  div: number;
  steps: (StepNote | null)[];
}

/** What is (or should be) playing: a track id plus its arrangement variant. */
interface Slot {
  id: TrackId;
  variant: number;
}

/** One live scheduled instance of a track: its own bus, its own playhead.
 *  Crossfades = one layer ramping in while the old ones ramp out. */
interface Layer {
  slot: Slot;
  cfg: TrackConfig;
  arr: Arrangement;
  voices: ParsedVoice[];
  bus: GainNode;
  beat: number;
  nextBeatTime: number;
  /** null = the active layer. Set = fading out; no beats past this time. */
  fadeEnd: number | null;
}

export class Music implements MusicLike {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private pulse25: PeriodicWave | null = null;
  private pulse125: PeriodicWave | null = null;
  private timer: number | null = null;

  private layers: Layer[] = [];
  /** Desired current slot; also the pre-ensure() memory. null = silence. */
  private want: Slot | null = null;
  /** Takeover stack; null marks "nothing was playing" so release() can stop. */
  private stack: (Slot | null)[] = [];
  /** Set while parked on hold muzak; remembers what to come back to. */
  private pauseHold: { back: Slot | null } | null = null;
  /** Which HOLD_SET entry the next pause gets (alternates). */
  private holdIdx = 0;
  /** Shuffle bag for playHome(); drawn by pop() from the end. */
  private homeBag: TrackId[] = [];
  private homeLast: TrackId | null = null;
  /** Seeded LCG state for the shuffle bag — deterministic, no Math.random. */
  private bagState = 0x5ee0ded;
  /** Explicit tab-hidden state (visibilitychange), distinct from the
   *  autoplay-policy 'suspended' the browser starts contexts in. */
  private suspended = false;

  private volume = 0.8;
  private intensityTarget = 0.5;
  private intensityCur = 0.5;

  /** Arrangement + parsed voices per `${id}#${variant}`. */
  private cache = new Map<string, { arr: Arrangement; voices: ParsedVoice[] }>();

  /** Create/resume the AudioContext. Call on a user gesture. A play() issued
   *  before ensure() is remembered and starts here. */
  ensure(): void {
    if (this.ctx) {
      if (!this.suspended && this.ctx.state === 'suspended') void this.ctx.resume();
      if (!this.suspended) this.startWant();
      return;
    }
    const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return; // platform without WebAudio: silent (lifecycle, not an id fallback)
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = this.volume * MASTER_HEADROOM;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.value = this.cutoffHz();
    filter.connect(master);
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.filter = filter;
    this.noiseBuf = makeNoiseBuffer(ctx);
    this.pulse25 = makePulseWave(ctx, 0.25);
    this.pulse125 = makePulseWave(ctx, 0.125);
    if (!this.suspended && ctx.state === 'suspended') void ctx.resume();
    if (!this.suspended) this.startWant();
  }

  /** Crossfade to track `id` (arrangement per `variant`, default 0 = base).
   *  Unknown ids throw. Re-playing the already-active slot is a no-op — the
   *  loop keeps rolling (so w1a1 -> w1a2 with equal variants never restarts). */
  play(id: TrackId, opts?: { variant?: number }): void {
    const cfg: TrackConfig | undefined = TRACKS[id];
    if (cfg === undefined) throw new Error(`Music.play: unknown track "${String(id)}"`);
    this.want = { id, variant: (opts?.variant ?? 0) >>> 0 };
    if (!this.ctx || this.suspended) return; // remembered; ensure()/resume() starts it
    this.startWant();
  }

  /** Home-screen rotation: deterministic shuffle bag over HOME_SET — all
   *  three con-man tunes before any repeat, never the same twice running. */
  playHome(): void {
    this.play(this.nextHome());
  }

  /** Pause menu: park the score on the next hold-muzak cassette (alternating
   *  hold-a/hold-b) and remember what was interrupted. Re-entrant calls while
   *  already on hold are no-ops. */
  playPause(): void {
    if (this.pauseHold) return;
    this.pauseHold = { back: this.want };
    const id = HOLD_SET[this.holdIdx % HOLD_SET.length]!;
    this.holdIdx++;
    this.play(id);
  }

  /** Leave the pause menu: crossfade back to the interrupted track+variant
   *  (its loop restarts from the top — documented, accepted). Safe when not
   *  paused (no-op) and when pause interrupted silence (fades back to it). */
  endPause(): void {
    const hold = this.pauseHold;
    if (!hold) return;
    this.pauseHold = null;
    if (hold.back) this.play(hold.back.id, { variant: hold.back.variant });
    else this.fadeToSilence();
  }

  /** Tab hidden: freeze the audio clock and stop the lookahead timer so no
   *  work piles up while nobody is listening. Safe no-op before ensure(). */
  suspend(): void {
    this.suspended = true;
    this.stopTimer();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** Tab visible again: unfreeze the clock and pick the score back up where
   *  it stopped. Safe no-op before ensure(). */
  resume(): void {
    this.suspended = false;
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startWant(); // starts anything requested while suspended
    if (this.layers.length > 0) {
      this.startTimer();
      this.tick();
    }
  }

  /** Fade everything out (still a crossfade — to silence) and forget state. */
  stop(): void {
    this.want = null;
    this.stack = [];
    this.pauseHold = null;
    this.fadeToSilence();
  }

  /** 0..1 gameplay intensity; eased in update(), applied to future beats. */
  setIntensity(v: number): void {
    this.intensityTarget = Math.min(1, Math.max(0, v));
  }

  /** Push the current slot and play `id` (boss intro, gold-bar fanfares...). */
  takeover(id: TrackId): void {
    this.stack.push(this.want);
    this.play(id);
  }

  /** Pop the takeover stack and hand back — re-rolled via HANDBACK, keeping
   *  the interrupted variant (see header). Popping an empty stack is a
   *  programming error and THROWS. */
  release(): void {
    const prev = this.stack.pop();
    if (prev === undefined) throw new Error('Music.release() without a matching takeover()');
    if (prev === null) {
      // takeover happened over silence; hand silence back
      this.want = null;
      this.fadeToSilence();
      return;
    }
    this.play(HANDBACK[prev.id], { variant: prev.variant });
  }

  /** 0..1 music volume (prefs calls this; music never imports prefs). */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.volume * MASTER_HEADROOM, this.ctx.currentTime, 0.02);
    }
  }

  /** Per-frame hook: ONLY parameter ramps (intensity easing -> filter/tempo).
   *  All note scheduling lives on the interval timer, never here. Easing is
   *  asymmetric: heat builds slowly, but drops FAST — that is the duck. */
  update(): void {
    const d = this.intensityTarget - this.intensityCur;
    this.intensityCur += d * (d < 0 ? INTENSITY_EASE_DOWN : INTENSITY_EASE_UP);
    if (this.ctx && this.filter) {
      this.filter.frequency.setTargetAtTime(this.cutoffHz(), this.ctx.currentTime, 0.05);
    }
  }

  /** What the module wants playing right now (works pre-ensure, for tests
   *  and probes). Extra API beyond MusicLike, like setVolume. */
  nowPlaying(): { id: TrackId; variant: number } | null {
    return this.want ? { id: this.want.id, variant: this.want.variant } : null;
  }

  // -- internals ------------------------------------------------------------

  private tempoScale(): number {
    return 1 + (this.intensityCur - 0.5) * TEMPO_SPAN;
  }

  private cutoffHz(): number {
    return FILTER_BASE_HZ * Math.pow(2, this.intensityCur * FILTER_OCTAVES);
  }

  /** Draw one uint32 from the shuffle-bag stream. */
  private bagDraw(): number {
    this.bagState = (Math.imul(this.bagState, 1664525) + 1013904223) >>> 0;
    return this.bagState;
  }

  private nextHome(): TrackId {
    if (this.homeBag.length === 0) {
      const bag = [...HOME_SET];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = this.bagDraw() % (i + 1);
        const a = bag[i]!;
        bag[i] = bag[j]!;
        bag[j] = a;
      }
      // Bag boundary: never the same tune twice in a row (we pop the tail).
      if (bag.length > 1 && bag[bag.length - 1] === this.homeLast) {
        const a = bag[bag.length - 1]!;
        bag[bag.length - 1] = bag[0]!;
        bag[0] = a;
      }
      this.homeBag = bag;
    }
    const id = this.homeBag.pop()!;
    this.homeLast = id;
    return id;
  }

  /** The layer currently ramping in / holding (not fading), if any. */
  private topLive(): Layer | null {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i]!;
      if (l.fadeEnd === null) return l;
    }
    return null;
  }

  /** Bring reality in line with `want`: crossfade the live layers out and a
   *  fresh layer of the wanted slot in. No-op when it already plays. */
  private startWant(): void {
    const ctx = this.ctx;
    if (!ctx || this.suspended) return;
    const want = this.want;
    if (want === null) {
      this.fadeToSilence();
      return;
    }
    const top = this.topLive();
    if (top && top.slot.id === want.id && top.slot.variant === want.variant) return;
    const now = ctx.currentTime;
    this.fadeLive(now);
    const { arr, voices } = this.arrangementOf(want);
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(1, now + XFADE_S);
    if (this.filter) bus.connect(this.filter);
    this.layers.push({
      slot: { id: want.id, variant: want.variant },
      cfg: TRACKS[want.id],
      arr,
      voices,
      bus,
      beat: 0,
      nextBeatTime: now + 0.06,
      fadeEnd: null,
    });
    this.startTimer();
    this.tick(); // fill the lookahead window immediately
  }

  /** Ramp every live layer's bus down over the crossfade window and give it a
   *  scheduling deadline. Gains RAMP (setTargetAtTime), never step. */
  private fadeLive(now: number): void {
    for (const l of this.layers) {
      if (l.fadeEnd !== null) continue;
      l.fadeEnd = now + XFADE_S;
      const g = l.bus.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
      if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
      g.setTargetAtTime(0.0001, now, XFADE_S / 4);
    }
  }

  private fadeToSilence(): void {
    const ctx = this.ctx;
    this.want = null;
    if (!ctx) return;
    this.fadeLive(ctx.currentTime);
    // The timer keeps running so fading layers finish their last scheduled
    // beats; tick() prunes them and stops itself when the room is empty.
  }

  private arrangementOf(slot: Slot): { arr: Arrangement; voices: ParsedVoice[] } {
    const key = `${slot.id}#${slot.variant}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const arr = arrange(TRACKS[slot.id], slot.variant);
    const voices: ParsedVoice[] = [
      { name: 'bass', div: arr.bass.div, steps: arr.bass.steps },
      { name: 'lead', div: arr.lead.div, steps: arr.lead.steps },
    ];
    if (arr.arp) voices.push({ name: 'arp', div: arr.arp.div, steps: arr.arp.steps });
    if (arr.noise) voices.push({ name: 'noise', div: arr.noise.div, steps: arr.noise.steps });
    const entry = { arr, voices };
    this.cache.set(key, entry);
    return entry;
  }

  private startTimer(): void {
    if (this.timer !== null || this.suspended) return;
    this.timer = setInterval(this.tick, TICK_MS) as unknown as number;
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Arrow property: stable identity for setInterval. Schedules EVERY live
   *  layer (that is what makes crossfades overlap musically), prunes layers
   *  whose fade has finished, and stops itself when nothing remains. */
  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD_S;
    for (const l of this.layers) {
      const limit = l.fadeEnd === null ? horizon : Math.min(horizon, l.fadeEnd);
      while (l.nextBeatTime < limit) {
        const beatDur = 60 / (l.cfg.bpm * this.tempoScale());
        this.scheduleBeat(l, l.beat, l.nextBeatTime, beatDur);
        l.nextBeatTime += beatDur;
        l.beat++;
      }
    }
    let pruned = false;
    for (const l of this.layers) {
      if (l.fadeEnd !== null && now > l.fadeEnd + 0.25) {
        l.bus.disconnect();
        pruned = true;
      }
    }
    if (pruned) {
      this.layers = this.layers.filter((l) => !(l.fadeEnd !== null && now > l.fadeEnd + 0.25));
    }
    if (this.layers.length === 0) this.stopTimer();
  };

  private scheduleBeat(l: Layer, beat: number, tBeat: number, beatDur: number): void {
    // The noise channel is the INTERACTIVE layer: its energy follows the
    // eased gameplay intensity (evaluated at schedule time — deterministic
    // for a given intensity trajectory, and never touching the sim).
    const noiseEnergy =
      NOISE_GAIN_FLOOR + (NOISE_GAIN_CEIL - NOISE_GAIN_FLOOR) * this.intensityCur;
    let hasNoise = false;
    for (const v of l.voices) {
      if (v.name === 'noise') hasNoise = true;
      const stepDur = beatDur / v.div;
      for (let s = 0; s < v.div; s++) {
        const idx = (beat * v.div + s) % v.steps.length;
        const note = v.steps[idx];
        if (note === null || note === undefined) continue;
        const swung = s % 2 === 1 ? l.arr.swing * stepDur : 0;
        const t = tBeat + s * stepDur + swung;
        if (v.name === 'noise') this.drum(l, note, t, noiseEnergy);
        else this.note(l, v.name, note, idx, t, stepDur);
      }
    }
    // Charged-run heat: a soft ghost hat rides the (swung) off-8th of every
    // beat. Tracks without a drummer (hold-a's gag) keep their silence.
    if (hasNoise && this.intensityCur >= HOT_NOISE_AT) {
      const t = tBeat + beatDur * 0.5 * (1 + l.arr.swing);
      this.drum(l, { deg: 0, oct: 0, len: 1 }, t, noiseEnergy * GHOST_HAT_GAIN);
    }
  }

  private note(l: Layer, name: VoiceName, n: StepNote, idx: number, t: number, stepDur: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const spec = TONAL[name];
    if (spec === null) throw new Error(`music: voice "${name}" is not tonal`);
    let midi = l.cfg.root + l.arr.transpose + degreeToSemitone(l.cfg.scale, n.deg, n.oct) + 12 * spec.oct;
    // THE SOUR-NOTE GAG: at most one declared off-scale nudge per track,
    // applied at this exact pattern index — once per loop, deterministic.
    const sour = l.cfg.sourNotes?.find((sn) => sn.voice === name && sn.step === idx);
    if (sour) midi += sour.semi;
    const freq = midiToFreq(midi);
    const durS = Math.max(0.04, n.len * stepDur * 0.92);
    const o = ctx.createOscillator();
    if (name === 'lead') {
      // Exhaustive over LeadTimbre — all pulse-family (channel discipline).
      switch (l.arr.leadTimbre) {
        case 'square':
          o.type = 'square';
          break;
        case 'pulse25':
          if (this.pulse25 !== null) o.setPeriodicWave(this.pulse25);
          else o.type = 'square';
          break;
        case 'pulse125':
          if (this.pulse125 !== null) o.setPeriodicWave(this.pulse125);
          else o.type = 'square';
          break;
        default: {
          const _x: never = l.arr.leadTimbre;
          throw new Error(`music: unknown lead timbre ${String(_x)}`);
        }
      }
    } else {
      o.type = spec.wave;
    }
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(spec.gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durS);
    o.connect(g);
    g.connect(l.bus);
    o.start(t);
    o.stop(t + durS + 0.03);
  }

  /** One drum hit. `energy` is the intensity-driven gain multiplier — the
   *  noise channel is the score's interactive layer (see scheduleBeat). */
  private drum(l: Layer, n: StepNote, t: number, energy: number): void {
    const ctx = this.ctx;
    const buf = this.noiseBuf;
    if (!ctx || !buf) return;
    const kind = DRUMS[n.deg];
    if (kind === undefined) {
      throw new Error(`music: noise degree ${n.deg} is not a drum (0=hat, 1=snare, 2=thud)`);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = kind.filter;
    f.frequency.value = kind.freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(kind.gain * energy, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + kind.durS);
    src.connect(f);
    f.connect(g);
    g.connect(l.bus);
    src.start(t);
    src.stop(t + kind.durS + 0.02);
  }
}

/** 1 s of seeded LCG noise — deterministic, no Math.random. (Duplicated in
 *  sfx.ts on purpose: the modules share no state, only the house sound.) */
function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = 0x1badb002;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = (s / 4294967296) * 2 - 1;
  }
  return buf;
}

/** Pulse wave of the given duty as a periodic wave (Fourier magnitudes
 *  sin(nπd)/n). The variation engine's lead timbres are ALL pulse-family
 *  (square = 50%, plus 25% and 12.5% — nasal and reedy respectively), so the
 *  two melodic channels always read as the classic chip's two pulses. */
function makePulseWave(ctx: AudioContext, duty: number): PeriodicWave {
  const N = 32;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  }
  return ctx.createPeriodicWave(real, imag);
}
