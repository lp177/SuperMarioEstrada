// ============================================================================
// The score of the scam. 12 ORIGINAL chiptune loops — parody the genre, never
// the melodies. Pure data + pure helpers: this module does zero audio work and
// imports clean in plain Node. music.ts is the only consumer that makes sound.
//
// THE FOUR-CHANNEL ECONOMY (house doctrine, from Kondo's own constraints):
// every track is written for exactly the classic chip — TWO pulse channels
// (lead + arp), ONE triangle (bass), ONE noise. The constraint IS the
// aesthetic: each tonal voice is strictly MONOPHONIC (no hold may overlap the
// voice's next onset, loop wrap included — tested), and the MELODY TRADES
// between the two pulse channels somewhere in every loop: each track has at
// least one beat where the arp carries the tune alone and one where the lead
// does (tested). The noise channel drives the rhythmic variation; music.ts
// additionally scales its energy with gameplay intensity (the run heat).
// Idiom: jaunty tropical/calypso swing, marimba-staccato melodies, per-world
// UNAMBIGUOUS mood — sparse underground SPACE for the sewer, swing for the
// casino, a crooked parade for the castle.
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
// 3 = triplets, 4 = sixteenths). A pattern LOOPS independently on its own
// grid; its length in beats (steps / div) must divide bars * 4 so every voice
// realigns at the loop point (the data test enforces this).
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
//
// THE SOUR-NOTE GAG (sourNotes): the pit orchestra is part of the badly-built
// production. A track may declare AT MOST ONE sour note: at schedule time,
// music.ts nudges the named voice's note at pattern index `step` by `semi`
// semitones — DELIBERATELY off-scale, once per loop, fully deterministic.
// This is the single, explicit exemption to the pentatonic-safety rule; the
// data test verifies each sour note genuinely breaks the scale and that no
// track sneaks in more than one. Author them on `lead` only — bass patterns
// are rearranged by the variation engine, which would move the joke around.
//
// THE VARIATION ENGINE (variantOf + arrange): every act plays its world's
// theme, but never the identical arrangement. `variantOf(levelId)` hashes the
// stable string id (FNV-1a) into a 32-bit variant; `arrange(cfg, variant)`
// derives a deterministic arrangement: pentatonic-safe root transposition
// from SAFE_TRANSPOSES, bass rotation/regeneration, lead timbre swap, swing
// delta, arp thinning, percussion rotation. Variant 0 IS the base
// arrangement. Same (track, variant) -> identical arrangement, forever.
// ============================================================================

import type { TrackId } from '../core/types.ts';

export interface Pattern {
  /** Steps per beat: 1 = quarters, 2 = eighths, 3 = triplets, 4 = sixteenths. */
  div: 1 | 2 | 3 | 4;
  /** Space-separated step tokens — grammar documented at the top of file. */
  steps: string;
}

/** The one sanctioned scale-rule breaker — see THE SOUR-NOTE GAG above. */
export interface SourNote {
  /** Which tonal voice carries the joke (author 'lead' only — see header). */
  voice: 'bass' | 'lead' | 'arp';
  /** 0-based step index into that voice's parsed pattern. Must hit a note. */
  step: number;
  /** Semitone nudge applied at schedule time; the result must be OFF-scale. */
  semi: number;
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
  /** Max ONE per track. The explicit, tested exemption to pentatonic safety. */
  sourNotes?: readonly SourNote[];
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
// Variety is REAL: 5 scale shapes, 9 roots, subdivisions from lone quarter
// notes (sewer) to swung sixteenth comping (casino). The data test asserts a
// >= 2.5x notes-per-second span across the four LEVEL themes.
//
// TEMPO IS KINETIC: the groove sets the player's stride. At full run the
// stride animation flips every 8 frames (painter: period 4, cycle of 4), so
// footfalls land at 7.5 Hz — which is exactly sixteenth notes at 112.5 bpm.
// The meadow (the game's default gait) sits at 112 so the run locks to the
// groove; everything else stays inside the house band 104..124 so intensity
// modulation (±12% tempo) never leaves it unreadable.
//
// EVERY TRACK IS DIEGETIC — the score the conspirators commissioned for their
// own production, world by world (see AGENTS.md "THE WORLD IS A SET").
// ---------------------------------------------------------------------------

export const TRACKS: Record<TrackId, TrackConfig> = {
  // -- HOME SET: three DISTINCT con-man swagger tunes (title + home-b/c). ----

  // Sunny calypso swagger: oom-pah bass with upbeat pushes, a staccato
  // marimba hook that hands its answer to the high pulse (bar 3 belongs to
  // the steel-ish second pulse). The cruise-ship band of a man who just sold
  // you your own house.
  title: {
    name: "Grifter's Paradise",
    bpm: 114,
    scale: [0, 2, 4, 7, 9],
    root: 47, // B2
    bars: 4,
    swing: 0.24,
    bass: {
      div: 2,
      steps: '0 . 3, . 0 . 3, 3, | 1 . 3, . 1 . 4, . | 0 . 3, . 0 . 3, 3, | 2 . 4, . 0 . 3, .',
    },
    lead: {
      div: 2,
      steps: "4 . 2 . 4 2 0 . | 1 2 1 . 0:2 . . . | . . . . . . . . | 4 . 0' . 4 2 1 .",
    },
    arp: {
      div: 2,
      steps: ". . . . . . . . | . . . . . . 2 4 | 0' . 4 2 4 2 0 . | . . . . . . . .",
    },
    noise: { div: 2, steps: '2 . 0 0 1 . 0 . | 2 . 0 0 1 0 0 .' },
  },

  // Sleazy dominant-pentatonic finger-snap strut, heavier swing, big pauses:
  // the walk of a notary who certifies his own alibis. The second pulse is
  // the entourage snapping back in every hole the lead leaves.
  'home-b': {
    name: 'Notary Public Enemy',
    bpm: 108,
    scale: [0, 2, 4, 7, 10],
    root: 47, // B2
    bars: 4,
    swing: 0.3,
    bass: { div: 2, steps: '0 . . 0 2 . 0 . | 3 . . 3 2 . 1 .' },
    lead: {
      div: 2,
      steps:
        "4 . 4 3:2 . . 2 . | . 2 4 2 1:2 . . . | 4 . 4 3:2 . . 2 . | 4' 3' 2' 4 1:3 . . .",
    },
    arp: {
      div: 2,
      steps: ". . . . 0' . . . | . . . . . . 4 2 | . . . . 0' . . . | . . . . . . 1 0",
    },
    noise: { div: 2, steps: '2 . 0 1 . 0 1 .' },
  },

  // Habanera bass, melodramatic hangs, a little flourish before the turn:
  // a tango danced alone with your signature on the contract.
  'home-c': {
    name: 'Terms of Service Tango',
    bpm: 116,
    scale: [0, 2, 5, 7, 10],
    root: 43, // G2
    bars: 4,
    bass: { div: 2, steps: '0:2 . 4, . 0 . 0 . | 1:2 . 4, . 1 . 0 .' },
    lead: {
      div: 2,
      steps:
        "0' . . 4 3:2 . . . | 3 . . 2 1:2 . . . | 0' . . 4 3 . 4 . | 2':2 . 1' 4:3 . . 0 .",
    },
    arp: { div: 4, steps: '. . . . . . . . . . . . 0 2 4 2' },
    noise: { div: 2, steps: '2 . . 0 1 . 0 . | 2 . . 0 1 . 1 .' },
  },

  // -- LEVEL THEMES ----------------------------------------------------------

  // W1 is Estrada's hero-movie set, and he scored it like the opening number
  // of a beach resort: full calypso — oom-pah bass pushing the upbeats,
  // marimba-staccato hook (short notes, sun between them), the high pulse
  // answering bar 3 like a steel drum. 112 bpm = the full-run footfall lock
  // (see TEMPO IS KINETIC above): running IS keeping time with this tune.
  meadow: {
    name: 'Certified Sunshine (Calypso of the Con)',
    bpm: 112,
    scale: [0, 2, 4, 7, 9],
    root: 45, // A2
    bars: 4,
    swing: 0.26,
    bass: {
      div: 2,
      steps: '0 . . 3, 0 . 3, . | 1 . . 3, 1 . 3, . | 0 . . 3, 0 . 3, . | 4, . 3, . 0 . 0 .',
    },
    lead: {
      div: 2,
      steps: "0' . 4 . 2 4 . . | 1 2 4 . 0:2 . . . | . . . . . . . . | 2 4 2 1 0:2 . . .",
    },
    arp: {
      div: 2,
      steps: ". . . . . . . . | . . . . . . 3 4 | 0' . 4 . 2 4 0 . | . . . . . . . .",
    },
    noise: { div: 2, steps: '2 . 0 0 1 . 0 0 | 2 0 0 0 1 . 0 .' },
  },

  // The underground goes SPARSE — minimalism as strength: a soft triangle
  // heartbeat, two-note pulse stabs, and then SPACE. The second pulse is a
  // literal ECHO — the same stab, one bar later, same pitch, half the gain
  // (arp sits +2 octaves so it is authored a mark lower): laundered money
  // dripping through big empty pipes.
  sewer: {
    name: 'Spin Cycle (Money Laundering Setting)',
    bpm: 104,
    scale: [0, 3, 5, 7, 10],
    root: 41, // F2
    bars: 4,
    bass: { div: 1, steps: '0 . . . 0 . 2 . | 0 . . . 4, . 2 .' },
    lead: {
      div: 2,
      steps: "0' . . 4 . . . . | . . . . . . . . | 2 . . 3 . . . . | . . . . . . . .",
    },
    arp: {
      div: 2,
      steps: '. . . . . . . . | 0 . . 4, . . . . | . . . . . . . . | 2, . . 3, . . . .',
    },
    noise: { div: 1, steps: '. . 0 . . . 0 .' },
  },

  // Swing jazz-chip: walking bass, a swung riff that leaves real holes, and
  // slot-bell runs from the second pulse cashing out in every one of them.
  // The house edge, orchestrated for exactly four channels.
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
      steps: "2' 1' 4 . 2 . 4 . | . . . . . . 1 2 | 2' 1' 4 . 2 4 1 . | 0':2 . . . . . . .",
    },
    arp: {
      div: 2,
      steps: ". . . . . . . . | 0 2 4 2 0' . . . | . . . . . . . . | . . 4 2 1 2 4 0'",
    },
    noise: { div: 2, steps: '0 0 1 0 0 0 1 0' },
  },

  // Bowsonaro's military parade march: oom-pah root-and-fifth bass, fife
  // lead, snare rolls — and ONE sour brass note per loop (step 26, +1 semi):
  // the pit orchestra was hired by the same people who built the cardboard
  // castle. Deterministic, rare, and absolutely in the contract. The second
  // pulse is a piccolo that only knows the two notes it plays into the one
  // hole the fife leaves (end of bar 2) — it still gets parade credit.
  castle: {
    name: 'Motorcade of the Mito',
    bpm: 116,
    scale: [0, 2, 4, 7, 10],
    root: 40, // E2
    bars: 4,
    bass: { div: 2, steps: '0 3, 0 3, 0 3, 0 3, | 0 3, 0 3, 1 1 2 2' },
    lead: {
      div: 2,
      steps:
        "0' 0' 0':2 . 4 3 4 . | 2':2 . 0':2 . 4:2 . . . | 0' 0' 0':2 . 4 3 4 . | 4' . 3' . 2' . 0':2 .",
    },
    arp: {
      div: 2,
      steps: ". . . . . . . . | . . . . . . 4 4' | . . . . . . . . | . . . . . . . .",
    },
    noise: {
      div: 4,
      steps: '2 . . . 1 . 1 1 2 . . . 1 . . . | 2 . . . 1 . 1 1 2 . 1 1 1 . 1 .',
    },
    sourNotes: [{ voice: 'lead', step: 26, semi: 1 }],
  },

  // The parade gone frantic: the castle march's DNA at a dead sprint —
  // sixteenth bass stabs missing the downbeat, snare rolls tumbling over
  // themselves, and the piccolo shrieking the alarm into the lead's last
  // beat. The motorcade has left the road.
  boss: {
    name: 'The Parade Goes Feral',
    bpm: 124,
    scale: [0, 2, 4, 7, 10],
    root: 43, // G2
    bars: 2,
    bass: {
      div: 4,
      steps: '0 . 0 0 . 0 . 0 3, . 3, 3, . 0 0 . | 1 . 1 1 . 1 . 1 2 . 2 2 . 4, 4, .',
    },
    lead: { div: 2, steps: "0' 0' . 4 0' . 4 . | 2' 2' . 1' 2' . . ." },
    arp: { div: 2, steps: ". . . . . . . . | . . . . . . 2' 4'" },
    noise: {
      div: 4,
      steps: '2 . 0 0 1 . 1 1 2 . 0 . 1 1 . 1 | 2 2 0 . 1 . 1 1 2 . 0 0 1 1 1 .',
    },
  },

  // -- SCENE TRACKS ----------------------------------------------------------

  // Silent-movie pit piano, one reel behind the action: stride bass (low
  // note, mid chord), melodramatic runs, a pianist paid in exposure.
  cutscene: {
    name: 'Pit Pianist (Reel 4, Slightly Late)',
    bpm: 104,
    scale: [0, 2, 4, 7, 9],
    root: 57, // A3
    bars: 4,
    swing: 0.18,
    bass: { div: 2, steps: '0, . 2 . 4,, . 2 . | 3, . 2 . 4, . 1 .' },
    lead: {
      div: 2,
      steps:
        "4 . 2 . 0:2 . . . | 1 2 3 . 4:3 . . . | 4 . 2 . 0':2 . . . | 4 3 2 1 0:4 . . .",
    },
    arp: { div: 1, steps: '. 0 2 4' },
  },

  // Triumphant fanfare that keeps slipping off its own pedestal — and the
  // crooked cadence is now literal: ONE flatted note in the fanfare (step 13,
  // -1 semi). The trumpet player also lost money on the bet. Bar 3 leaves a
  // gap where the second trumpet (the arp) holds the ceremony together alone.
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
        "0' 0' 0':2 . . 4 3 . | 2' 2' 2':2 . . 1' 0' . | 4' . 3' . . . 1' . | 0':2 . . 4 2 1 . 0",
    },
    arp: { div: 4, steps: "0 . 4 . . . . . 1 . 4 . 1' . . ." },
    noise: { div: 2, steps: '2 . 1 . 2 . 1 .' },
    sourNotes: [{ voice: 'lead', step: 13, semi: -1 }],
  },

  // -- HOLD SET: call-center muzak for the pause menu. The joke: Estrada has
  // -- put the rescue itself on hold. Cheesy, thin, endlessly patient. -------

  // Thin bossa shuffle, polite noodle lead, chintzy arpeggio comping, NO
  // drums (the phone line did not budget for a drummer).
  'hold-a': {
    name: 'Your Rescue Is Important to Us',
    bpm: 106,
    scale: [0, 2, 4, 7, 9],
    root: 55, // G3
    bars: 4,
    swing: 0.12,
    bass: { div: 1, steps: '0, . 4, . 1, . 4, .' },
    lead: {
      div: 2,
      steps:
        "2 . 4 . 3:2 . . . | . . 2 . 1:2 . . . | 2 . 4 . 0':2 . . . | . . 4 . 2:2 . . .",
    },
    arp: { div: 1, steps: '. 0 2 4 . 0 2 4 . 1 2 4 . 0 2 4' },
  },

  // The other cassette in the hold machine: ritusen politeness, soft hats
  // only, a phrase that resolves just enough to keep you on the line — the
  // chintz arpeggio politely waits out the melody's first beat, then noodles
  // alone through its rests.
  'hold-b': {
    name: 'Please Continue to Hold (Est. Wait: 4 Worlds)',
    bpm: 104,
    scale: [0, 2, 5, 7, 9],
    root: 53, // F3
    bars: 4,
    swing: 0.1,
    bass: { div: 1, steps: '0, . . 2, 3, . . 2, 0, . . 2, 4, . 3, .' },
    lead: {
      div: 2,
      steps:
        "4 3 2:2 . . . . . | 1 2 3:2 . . . . . | 4 3 2:2 . . . . . | 1 . 0':4 . . . . .",
    },
    arp: { div: 2, steps: '. . . 2 . 4 . 2 . . . 3 . 4 . 2' },
    noise: { div: 1, steps: '. 0 . 0 . 0 . 0' },
  },
};

// ===========================================================================
// THE VARIATION ENGINE — pure, deterministic, tested without an AudioContext.
// ===========================================================================

/** FNV-1a 32-bit hash of a string id ('w1a2', ...). Stable forever; this is
 *  how acts get their variant number. variantOf('') is the FNV offset basis. */
export function variantOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h = (h ^ id.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Root transpositions variants may pick from. All small (|t| <= 5), all
 *  NONZERO — a nonzero variant always moves the key — and all verified by the
 *  data test to keep every authored voice inside the audible register. A
 *  transposition shifts the whole scale, so pentatonic safety is preserved
 *  by construction. */
export const SAFE_TRANSPOSES: readonly number[] = [2, 3, -2, -3, 5, -4];

/** Lead timbres the variation engine may swap in. ALL pulse-family — the
 *  four-channel economy says the two melodic channels are PULSES (the one
 *  triangle belongs to the bass); 'pulse25'/'pulse125' are 25%/12.5%-duty
 *  pulses built as periodic waves by music.ts. The base arrangement (variant
 *  0) is always 'square' (a 50%-duty pulse) — the TONAL table's house lead. */
export type LeadTimbre = 'square' | 'pulse25' | 'pulse125';

export interface VoiceArrangement {
  div: 1 | 2 | 3 | 4;
  steps: (StepNote | null)[];
}

/** A concrete, fully-derived arrangement of one track for one variant.
 *  Everything music.ts needs to schedule; everything the tests can diff. */
export interface Arrangement {
  variant: number;
  /** Semitones added to the track root. 0, or a SAFE_TRANSPOSES member. */
  transpose: number;
  leadTimbre: LeadTimbre;
  /** Effective swing (base +/- a small delta, clamped to 0..0.45). */
  swing: number;
  bass: VoiceArrangement;
  /** The lead is the THEME's identity — never rearranged, only re-voiced. */
  lead: VoiceArrangement;
  arp: VoiceArrangement | null;
  noise: VoiceArrangement | null;
}

/** House seeded stream (LCG, same constants as the noise buffers). Returns
 *  uint32 draws; identical seed -> identical draws, no Math.random anywhere. */
function lcgStream(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

/** Rotate a pattern by whole beats, picking the first rotation (starting from
 *  a draw-derived offset) that actually CHANGES the sequence — a periodic
 *  pattern must not silently rotate onto itself. Falls back to a copy of the
 *  original only if every rotation is an identity (fully uniform pattern —
 *  none are authored). */
function rotateSteps(steps: (StepNote | null)[], div: number, draw: number): (StepNote | null)[] {
  const beats = steps.length / div;
  if (beats < 2) return steps.slice();
  const key = JSON.stringify(steps);
  for (let i = 0; i < beats - 1; i++) {
    const r = 1 + ((draw + i) % (beats - 1));
    const k = (r * div) % steps.length;
    const rot = steps.slice(k).concat(steps.slice(0, k));
    if (JSON.stringify(rot) !== key) return rot;
  }
  return steps.slice();
}

/** Regenerate a bass line as a straight-eighths pump of each beat's sounding
 *  degree (carrying held/previous notes through rests). A REAL structural
 *  rewrite — different rhythm, same harmonic skeleton, still 100% on-scale. */
function pumpBass(steps: (StepNote | null)[], div: number): (StepNote | null)[] {
  const beats = steps.length / div;
  let deg = 0;
  let oct = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const n = steps[i];
    if (n) {
      deg = n.deg;
      oct = n.oct;
      break;
    }
  }
  const out: (StepNote | null)[] = [];
  for (let b = 0; b < beats; b++) {
    for (let s = 0; s < div; s++) {
      const n = steps[b * div + s];
      if (n) {
        deg = n.deg;
        oct = n.oct;
        break;
      }
    }
    out.push({ deg, oct, len: 1 }, { deg, oct, len: 1 });
  }
  return out;
}

/** Thin an arp to every other onset (rests preserved) — density variation. */
function thinArp(steps: (StepNote | null)[]): (StepNote | null)[] {
  let k = 0;
  return steps.map((n) => (n === null ? null : k++ % 2 === 0 ? n : null));
}

/** Derive the concrete arrangement of `cfg` for `variant`. Deterministic:
 *  same inputs -> deep-equal output, forever. Variant 0 = the base score
 *  exactly as authored. Nonzero variants ALWAYS differ structurally: nonzero
 *  transpose, rotated-or-regenerated bass, rotated percussion — plus freely
 *  drawn lead timbre, swing delta and arp density. */
export function arrange(cfg: TrackConfig, variant: number): Arrangement {
  const v = variant >>> 0;
  const bass = parsePattern(cfg.bass);
  const lead = parsePattern(cfg.lead);
  const arp = cfg.arp ? parsePattern(cfg.arp) : null;
  const noise = cfg.noise ? parsePattern(cfg.noise) : null;

  if (v === 0) {
    return {
      variant: 0,
      transpose: 0,
      leadTimbre: 'square',
      swing: cfg.swing ?? 0,
      bass: { div: cfg.bass.div, steps: bass },
      lead: { div: cfg.lead.div, steps: lead },
      arp: cfg.arp && arp ? { div: cfg.arp.div, steps: arp } : null,
      noise: cfg.noise && noise ? { div: cfg.noise.div, steps: noise } : null,
    };
  }

  const draw = lcgStream(v);
  const transpose = SAFE_TRANSPOSES[draw() % SAFE_TRANSPOSES.length]!;
  const rotatedBass = rotateSteps(bass, cfg.bass.div, draw());
  const bassArr: VoiceArrangement =
    draw() % 3 === 0
      ? { div: 2, steps: pumpBass(rotatedBass, cfg.bass.div) }
      : { div: cfg.bass.div, steps: rotatedBass };
  const timbres: readonly LeadTimbre[] = ['square', 'pulse25', 'pulse125'];
  const leadTimbre = timbres[draw() % timbres.length]!;
  const deltas = [0.06, 0.1, -0.06, -0.1];
  const swing = Math.min(0.45, Math.max(0, (cfg.swing ?? 0) + deltas[draw() % deltas.length]!));
  const arpKeep = draw() % 2 === 0 ? 1 : 2;
  const arpArr: VoiceArrangement | null =
    cfg.arp && arp ? { div: cfg.arp.div, steps: arpKeep === 1 ? arp : thinArp(arp) } : null;
  const noiseArr: VoiceArrangement | null =
    cfg.noise && noise ? { div: cfg.noise.div, steps: rotateSteps(noise, cfg.noise.div, draw()) } : null;

  return {
    variant: v,
    transpose,
    leadTimbre,
    swing,
    bass: bassArr,
    lead: { div: cfg.lead.div, steps: lead },
    arp: arpArr,
    noise: noiseArr,
  };
}
