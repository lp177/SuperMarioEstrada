// ============================================================================
// The score of the scam. 8 ORIGINAL chiptune loops — parody the genre, never
// the melodies. Pure data + pure helpers: this module does zero audio work and
// imports clean in plain Node. music.ts is the only consumer that makes sound.
//
// PATTERN STEP GRAMMAR (compact, whitespace-separated tokens):
//   .        rest (one step)
//   |        bar line, purely cosmetic — ignored by the parser
//   N        scale degree N (0-based index into TrackConfig.scale). Degrees
//            past the scale length wrap upward an octave (deg 5 on a 5-note
//            scale = deg 0 an octave up); negative degrees are not used.
//   N' N''   degree N one / two octaves up
//   N, N,,   degree N one / two octaves down
//   N:L      hold the note for L steps (L >= 1), e.g. 0:4
//   marks combine with holds: 3,:2  2':4
//
// Pattern.div is the subdivision: steps per beat (1 = quarters, 2 = eighths,
// 4 = sixteenths). A pattern LOOPS independently on its own grid; its length
// in beats (steps / div) must divide bars * 4 so every voice realigns at the
// loop point (the data test enforces this).
//
// NOISE patterns reuse the grammar but degrees are DRUMS, a closed set:
//   0 = closed hat (short hiss)   1 = snare (mid crack)   2 = low thud
// Any other noise degree throws in music.ts. Octave marks are meaningless on
// noise and must not be used.
//
// VOICE REGISTERS (applied by music.ts on top of root): bass +0 octaves,
// lead +1, arp +2. Register work beyond that is authored with '/', marks.
//
// An unknown token THROWS. No silent fallbacks.
// ============================================================================

import type { TrackId } from '../core/types.ts';

export interface Pattern {
  /** Steps per beat: 1 = quarter notes, 2 = eighths, 4 = sixteenths. */
  div: 1 | 2 | 3 | 4;
  /** Space-separated step tokens — grammar documented at the top of file. */
  steps: string;
}

export interface TrackConfig {
  name: string;
  /** Base tempo. House band: 104..124 so intensity modulation reads. */
  bpm: number;
  /** Semitone offsets from root, PENTATONIC-SAFE (no semitone pairs, no
   *  tritone against the root). Ascending, starts at 0, all within 0..11. */
  scale: number[];
  /** MIDI note of the tonal center. */
  root: number;
  /** Loop length in 4/4 bars; every pattern's beat-length divides bars*4. */
  bars: number;
  bass: Pattern;
  lead: Pattern;
  arp?: Pattern;
  noise?: Pattern;
  /** 0..0.45: fraction of a step by which odd steps are delayed (swung 8ths
   *  when div=2). Applied per-voice on that voice's own grid. */
  swing?: number;
}

/** One parsed step note. `deg` is the scale-degree index (may exceed the
 *  scale length — wraps up an octave), `oct` the authored octave marks,
 *  `len` the hold in steps. */
export interface StepNote {
  deg: number;
  oct: number;
  len: number;
}

const TOKEN_RE = /^(\d+)(''|'|,,|,)?(?::(\d+))?$/;

/** Parse a pattern into one entry per step (null = rest). Throws on any
 *  token the grammar does not cover — a typo must never become silence. */
export function parsePattern(p: Pattern): (StepNote | null)[] {
  const out: (StepNote | null)[] = [];
  for (const tok of p.steps.trim().split(/\s+/)) {
    if (tok === '|') continue;
    if (tok === '.') {
      out.push(null);
      continue;
    }
    const m = TOKEN_RE.exec(tok);
    if (!m) throw new Error(`parsePattern: bad token "${tok}" in "${p.steps}"`);
    const deg = Number(m[1]);
    const marks = m[2] ?? '';
    const oct = marks === '' ? 0 : marks.startsWith("'") ? marks.length : -marks.length;
    const len = m[3] === undefined ? 1 : Number(m[3]);
    if (!Number.isInteger(len) || len < 1) {
      throw new Error(`parsePattern: bad hold length in "${tok}"`);
    }
    out.push({ deg, oct, len });
  }
  if (out.length === 0) throw new Error('parsePattern: empty pattern');
  return out;
}

/** Scale degree -> semitone offset from root. Degrees wrap with octave carry:
 *  deg 5 on a 5-note scale = scale[0] + 12. */
export function degreeToSemitone(scale: readonly number[], deg: number, oct: number): number {
  const n = scale.length;
  if (n === 0) throw new Error('degreeToSemitone: empty scale');
  const idx = ((deg % n) + n) % n;
  const base = scale[idx];
  if (base === undefined) throw new Error(`degreeToSemitone: unreachable index ${idx}`);
  return base + 12 * (Math.floor(deg / n) + oct);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Scales in use (all pentatonic-safe):
//   minor pent    [0,3,5,7,10]   dominant pent [0,2,4,7,10]
//   ritusen       [0,2,5,7,9]    egyptian/sus  [0,2,5,7,10]
//   major pent    [0,2,4,7,9]
// Variety is REAL: 5 scale shapes, 7 roots, subdivisions from lone quarter
// notes (sewer) to swung sixteenth comping (casino). The data test asserts a
// >= 2.5x notes-per-second span; the actual span is ~9x.
// ---------------------------------------------------------------------------

export const TRACKS: Record<TrackId, TrackConfig> = {
  // Swaggering con-man strut: minor-pentatonic bluesy swagger over a lazy
  // swung backbeat. The sound of a man who just sold you your own house.
  title: {
    name: "The Grifter's Strut",
    bpm: 112,
    scale: [0, 3, 5, 7, 10],
    root: 45, // A2
    bars: 4,
    swing: 0.2,
    bass: { div: 2, steps: '0 . 0 . 2 . 3 . | 0 . 0 . 4 . 3 .' },
    lead: {
      div: 2,
      steps:
        "0' . . 4 . 3 4 . | 2:3 . . 0 . . 2 3 | 0' . . 4 . 3 4 . | 2':4 . . . 4 3 2 0",
    },
    noise: { div: 2, steps: '2 . 0 . 1 . 0 .' },
  },

  // Sunny oom-pah with a flat seventh rotting in the middle of it — the
  // kingdom looks fine until you read the foreclosure signs.
  meadow: {
    name: 'Foreclosure Sunshine',
    bpm: 118,
    scale: [0, 2, 4, 7, 10],
    root: 48, // C3
    bars: 4,
    bass: { div: 2, steps: '0, 3, 0, 3, 0, 3, 0, 3, | 1, 3, 1, 3, 0, 3, 0, 3,' },
    lead: {
      div: 2,
      steps:
        '2 . 2 3 2 1 0 . | 4 . 4 . 3 2 3 . | 2 . 2 3 2 1 0 . | 1 2 1 0 4, . 0 .',
    },
    noise: { div: 2, steps: '2 . 0 . 1 . 0 0' },
  },

  // Dripping minor pentatonic, quarter notes only, holes everywhere. Money
  // gets laundered slowly down here.
  sewer: {
    name: 'Coin Laundry Blues',
    bpm: 104,
    scale: [0, 3, 5, 7, 10],
    root: 41, // F2
    bars: 4,
    bass: { div: 1, steps: '0:2 . 2:2 . 0:2 . 1:2 .' },
    lead: { div: 1, steps: '. 4 . 3 | . . 2:2 . | . . 4, . | . 2:3 . .' },
    noise: { div: 1, steps: '. . 0 . . 0 . .' },
  },

  // Swing jazz-chip: walking bass, swung comping sixteenths, hats on
  // everything. The house edge, orchestrated.
  casino: {
    name: 'The House Always Wins',
    bpm: 124,
    scale: [0, 2, 5, 7, 9],
    root: 50, // D3
    bars: 4,
    swing: 0.33,
    bass: { div: 1, steps: '0, 1, 2, 3, 4, 3, 2, 1,' },
    lead: {
      div: 2,
      steps:
        "4 3 2 . 1 2 3 . | 4 . 2' . 1' 4 2 . | 4 3 2 . 1 2 3 4 | 1':2 . . 0' 4 2 1 .",
    },
    arp: { div: 4, steps: '0 2 4 2 0 2 4 2 1 2 4 2 1 2 4 2' },
    noise: { div: 2, steps: '0 0 1 0 0 0 1 0' },
  },

  // Pounding low square eighths under a hollow suspended scale; snare on the
  // backbeat like a gavel. Gold statues of Impeach line the halls.
  castle: {
    name: 'Palace of Perfectly Legal Gold',
    bpm: 116,
    scale: [0, 2, 5, 7, 10],
    root: 40, // E2
    bars: 4,
    bass: { div: 2, steps: '0 0 0 0 0 0 1 1 | 0 0 0 0 3 3 1 1' },
    lead: {
      div: 2,
      steps:
        "0' . . 0' . 4 3 . | 4:3 . . . 3 . 1 . | 0' . . 0' . 4 3 . | 1:2 . 2:2 . 3:2 . . .",
    },
    noise: { div: 2, steps: '2 . 1 . 2 . 1 0' },
  },

  // Aggressive syncopation: sixteenth-note bass stabs that keep missing the
  // downbeat, exactly like the man's relationship with the truth.
  boss: {
    name: 'Shell Game Showdown',
    bpm: 124,
    scale: [0, 3, 5, 7, 10],
    root: 43, // G2
    bars: 2,
    bass: { div: 4, steps: '0 . 0 0 . 0 . 0 2 . 2 2 . 3 3 .' },
    lead: { div: 2, steps: "4 4 . 3 . 4:2 . . | 2 2 . 1 . 2':2 . ." },
    noise: { div: 4, steps: '2 . 0 0 1 . 0 . 2 2 0 . 1 . 0 0' },
  },

  // A music box in 4/4 with a light swung limp — pretty, patient, and lying
  // to you. Chords on 2-3-4 give it the waltz-ish sway.
  cutscene: {
    name: 'A Music Box Full of Lies',
    bpm: 104,
    scale: [0, 2, 4, 7, 9],
    root: 57, // A3
    bars: 4,
    swing: 0.15,
    bass: { div: 1, steps: '0, . 3,, . 0, . 4,, .' },
    lead: {
      div: 2,
      steps:
        "0' . 4 . 2 . 4 . | 1' . 4 . 2:3 . . . | 0' . 4 . 2 . 4 . | 1 . 2 . 0:3 . . .",
    },
    arp: { div: 1, steps: '. 0 2 4' },
  },

  // Triumphant fanfare that keeps slipping off its own pedestal: big major
  // pentatonic shouts, then the phrase stumbles downstairs at the cadence.
  ending: {
    name: 'Triumph (Terms and Conditions Apply)',
    bpm: 120,
    scale: [0, 2, 4, 7, 9],
    root: 50, // D3
    bars: 4,
    bass: { div: 2, steps: '0, . 0, . 3, . 3, . | 1, . 1, . 0, . 2, .' },
    lead: {
      div: 2,
      steps:
        "0' 0' 0':2 . . 4 3 . | 2' 2' 2':2 . . 1' 0' . | 4' . 3' . 2' . 1' . | 0':2 . . 4 2 1 . 0:2",
    },
    arp: { div: 4, steps: "0 . 4 . 0' . 4 . 1 . 4 . 1' . 4 ." },
    noise: { div: 2, steps: '2 . 1 . 2 . 1 .' },
  },
};
