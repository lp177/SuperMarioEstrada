// ============================================================================
// Generative chiptune player. Reads the pure-data TRACKS score (tracks.ts)
// and schedules square/triangle/noise voices through a gentle master lowpass.
//
// Scheduling: the classic lookahead pattern — a 25 ms interval timer keeps
// the next 120 ms of beats queued on the AudioContext clock, so tab jank
// never audibly stutters the score. The timer exists only after ensure() and
// only while a track plays; this module imports and constructs clean in Node.
//
// Intensity (0..1): scales tempo ±12% around the base bpm and opens the
// master lowpass. Both move SMOOTHLY (per-frame easing in update()) and only
// affect *future* beats — the playhead is never reset.
//
// takeover()/release() — the big-moment stack. HOUSE RULE (documented choice):
// on release we hand back RE-ROLLED — a level-family track (meadow/sewer/
// casino/castle) resumes as the NEXT family member in a fixed cycle
// (meadow->sewer->casino->castle->meadow), deterministic, so the ear never
// gets the identical tune twice around a takeover. Scene-bound tracks
// (title/cutscene/ending/boss) resume unchanged: swapping those would put the
// wrong scene's score on screen. An unpaired release() THROWS.
// ============================================================================

import type { MusicLike, TrackId } from '../core/types.ts';
import {
  TRACKS,
  parsePattern,
  degreeToSemitone,
  midiToFreq,
  type StepNote,
  type TrackConfig,
} from './tracks.ts';

const TICK_MS = 25;
const LOOKAHEAD_S = 0.12;
/** Tempo travels bpm * (1 ± TEMPO_SPAN/2) across intensity 0..1. */
const TEMPO_SPAN = 0.24;
/** Master lowpass: 900 Hz closed .. ~7200 Hz open. */
const FILTER_BASE_HZ = 900;
const FILTER_OCTAVES = 3;
/** Per-frame easing toward the intensity target (60 Hz update()). */
const INTENSITY_EASE = 0.05;
const MASTER_HEADROOM = 0.9;

type VoiceName = 'bass' | 'lead' | 'arp' | 'noise';

interface TonalSpec {
  wave: OscillatorType;
  gain: number;
  /** Register offset in octaves, applied on top of the track root. */
  oct: number;
}

/** Exhaustive over VoiceName; noise is null because it dispatches to drums. */
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
 *  scene-bound tracks map to themselves. */
const HANDBACK: Record<TrackId, TrackId> = {
  meadow: 'sewer',
  sewer: 'casino',
  casino: 'castle',
  castle: 'meadow',
  title: 'title',
  cutscene: 'cutscene',
  ending: 'ending',
  boss: 'boss',
};

interface ParsedVoice {
  name: VoiceName;
  div: number;
  steps: (StepNote | null)[];
}

export class Music implements MusicLike {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  /** Per-play bus: killing it silences everything already queued. */
  private bus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: number | null = null;

  private current: TrackId | null = null;
  /** Takeover stack; null marks "nothing was playing" so release() can stop. */
  private stack: (TrackId | null)[] = [];

  private beat = 0;
  private nextBeatTime = 0;

  private volume = 0.8;
  private intensityTarget = 0.5;
  private intensityCur = 0.5;

  private cache = new Map<TrackId, ParsedVoice[]>();

  /** Create/resume the AudioContext. Call on a user gesture. A play() issued
   *  before ensure() is remembered and starts here. */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (this.current !== null && this.bus === null) this.start();
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
    if (ctx.state === 'suspended') void ctx.resume();
    if (this.current !== null) this.start();
  }

  /** Stop the current track and loop `id` from its top. Unknown ids throw. */
  play(id: TrackId): void {
    const cfg: TrackConfig | undefined = TRACKS[id];
    if (cfg === undefined) throw new Error(`Music.play: unknown track "${String(id)}"`);
    this.current = id;
    if (!this.ctx) return; // remembered; ensure() will start it
    this.start();
  }

  stop(): void {
    this.current = null;
    this.stack = [];
    this.killBus();
    this.stopTimer();
  }

  /** 0..1 gameplay intensity; eased in update(), applied to future beats. */
  setIntensity(v: number): void {
    this.intensityTarget = Math.min(1, Math.max(0, v));
  }

  /** Push the current track and play `id` (boss intro, gold-bar fanfares...). */
  takeover(id: TrackId): void {
    this.stack.push(this.current);
    this.play(id);
  }

  /** Pop the takeover stack and hand back — re-rolled via HANDBACK (see
   *  header). Popping an empty stack is a programming error and THROWS. */
  release(): void {
    const prev = this.stack.pop();
    if (prev === undefined) throw new Error('Music.release() without a matching takeover()');
    if (prev === null) {
      // takeover happened over silence; hand silence back
      this.current = null;
      this.killBus();
      this.stopTimer();
      return;
    }
    this.play(HANDBACK[prev]);
  }

  /** 0..1 music volume (prefs calls this; music never imports prefs). */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.volume * MASTER_HEADROOM, this.ctx.currentTime, 0.02);
    }
  }

  /** Per-frame hook: ONLY parameter ramps (intensity easing -> filter/tempo).
   *  All note scheduling lives on the interval timer, never here. */
  update(): void {
    this.intensityCur += (this.intensityTarget - this.intensityCur) * INTENSITY_EASE;
    if (this.ctx && this.filter) {
      this.filter.frequency.setTargetAtTime(this.cutoffHz(), this.ctx.currentTime, 0.05);
    }
  }

  // -- internals ------------------------------------------------------------

  private tempoScale(): number {
    return 1 + (this.intensityCur - 0.5) * TEMPO_SPAN;
  }

  private cutoffHz(): number {
    return FILTER_BASE_HZ * Math.pow(2, this.intensityCur * FILTER_OCTAVES);
  }

  private start(): void {
    const ctx = this.ctx;
    if (!ctx || this.current === null) return;
    this.killBus();
    const bus = ctx.createGain();
    bus.gain.value = 1;
    if (this.filter) bus.connect(this.filter);
    this.bus = bus;
    this.beat = 0;
    this.nextBeatTime = ctx.currentTime + 0.06;
    this.startTimer();
    this.tick(); // fill the lookahead window immediately
  }

  private killBus(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    this.bus = null;
    if (!ctx || !bus) return;
    // Quick fade kills queued-but-unplayed notes without a click, then the
    // branch is dropped whole.
    bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
    setTimeout(() => bus.disconnect(), 250);
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(this.tick, TICK_MS) as unknown as number;
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Arrow property: stable identity for setInterval. */
  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || this.bus === null || this.current === null) return;
    const cfg = TRACKS[this.current];
    const voices = this.voicesOf(this.current);
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    while (this.nextBeatTime < horizon) {
      const beatDur = 60 / (cfg.bpm * this.tempoScale());
      this.scheduleBeat(cfg, voices, this.beat, this.nextBeatTime, beatDur);
      this.nextBeatTime += beatDur;
      this.beat++;
    }
  };

  private voicesOf(id: TrackId): ParsedVoice[] {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const cfg = TRACKS[id];
    const v: ParsedVoice[] = [
      { name: 'bass', div: cfg.bass.div, steps: parsePattern(cfg.bass) },
      { name: 'lead', div: cfg.lead.div, steps: parsePattern(cfg.lead) },
    ];
    if (cfg.arp) v.push({ name: 'arp', div: cfg.arp.div, steps: parsePattern(cfg.arp) });
    if (cfg.noise) v.push({ name: 'noise', div: cfg.noise.div, steps: parsePattern(cfg.noise) });
    this.cache.set(id, v);
    return v;
  }

  private scheduleBeat(
    cfg: TrackConfig,
    voices: ParsedVoice[],
    beat: number,
    tBeat: number,
    beatDur: number,
  ): void {
    for (const v of voices) {
      const stepDur = beatDur / v.div;
      for (let s = 0; s < v.div; s++) {
        const idx = (beat * v.div + s) % v.steps.length;
        const note = v.steps[idx];
        if (note === null || note === undefined) continue;
        const swung = s % 2 === 1 ? (cfg.swing ?? 0) * stepDur : 0;
        const t = tBeat + s * stepDur + swung;
        if (v.name === 'noise') this.drum(note, t);
        else this.note(cfg, v.name, note, t, stepDur);
      }
    }
  }

  private note(cfg: TrackConfig, name: VoiceName, n: StepNote, t: number, stepDur: number): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    const spec = TONAL[name];
    if (spec === null) throw new Error(`music: voice "${name}" is not tonal`);
    const midi = cfg.root + degreeToSemitone(cfg.scale, n.deg, n.oct) + 12 * spec.oct;
    const freq = midiToFreq(midi);
    const durS = Math.max(0.04, n.len * stepDur * 0.92);
    const o = ctx.createOscillator();
    o.type = spec.wave;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(spec.gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durS);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + durS + 0.03);
  }

  private drum(n: StepNote, t: number): void {
    const ctx = this.ctx;
    const bus = this.bus;
    const buf = this.noiseBuf;
    if (!ctx || !bus || !buf) return;
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
    g.gain.setValueAtTime(kind.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + kind.durS);
    src.connect(f);
    f.connect(g);
    g.connect(bus);
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
