// ============================================================================
// PURE DATA audio tests — no AudioContext, plain Node. Exhaustiveness of the
// tables is compile-enforced (Record<TrackId,...> / Record<GameEvent,...>);
// here we test the MUSICAL rules: pentatonic safety (with the one sanctioned
// sour-note exemption), tempo band, pattern grammar, real (not parametric)
// variety, the deterministic variation engine, the home/hold rotations, and
// sane sfx recipe numbers.
// ============================================================================

import { describe, it, expect } from 'vitest';
import type { GameEvent, ThemeId, TrackId } from '../src/core/types.ts';
import {
  TRACKS,
  SAFE_TRANSPOSES,
  arrange,
  degreeToSemitone,
  midiToFreq,
  parsePattern,
  variantOf,
  type Pattern,
  type TrackConfig,
} from '../src/audio/tracks.ts';
import { Sfx, sfxRecipeFor, allSfxEvents, type Recipe } from '../src/audio/sfx.ts';
import { Music, HOME_SET, HOLD_SET } from '../src/audio/music.ts';

const IDS = Object.keys(TRACKS) as TrackId[];
const LEVEL_THEMES: readonly ThemeId[] = ['meadow', 'sewer', 'casino', 'castle'];

type VoiceName = 'bass' | 'lead' | 'arp' | 'noise';
function voicesOf(cfg: TrackConfig): { name: VoiceName; p: Pattern }[] {
  const v: { name: VoiceName; p: Pattern }[] = [
    { name: 'bass', p: cfg.bass },
    { name: 'lead', p: cfg.lead },
  ];
  if (cfg.arp) v.push({ name: 'arp', p: cfg.arp });
  if (cfg.noise) v.push({ name: 'noise', p: cfg.noise });
  return v;
}

const ser = (x: unknown): string => JSON.stringify(x);

describe('tracks: shape', () => {
  it('has all 12 tracks with satire-voiced names', () => {
    expect(IDS.length).toBe(12);
    for (const id of IDS) expect(TRACKS[id].name.length).toBeGreaterThan(3);
  });

  it('keeps every base tempo inside the house band 104..124', () => {
    for (const id of IDS) {
      expect(TRACKS[id].bpm, id).toBeGreaterThanOrEqual(104);
      expect(TRACKS[id].bpm, id).toBeLessThanOrEqual(124);
    }
  });

  it('keeps swing sane (0..0.45) where present', () => {
    for (const id of IDS) {
      const s = TRACKS[id].swing;
      if (s !== undefined) {
        expect(s, id).toBeGreaterThanOrEqual(0);
        expect(s, id).toBeLessThanOrEqual(0.45);
      }
    }
  });

  it('the home and hold sets are wholly distinct tunes, not knob-twists', () => {
    for (const set of [HOME_SET, HOLD_SET]) {
      // Distinct lead melodies AND at least two distinct (scale, root) pairs:
      // the sets must be different SONGS, not the same song re-keyed.
      const leads = new Set(set.map((id) => TRACKS[id].lead.steps));
      expect(leads.size, set.join()).toBe(set.length);
      const keys = new Set(set.map((id) => `${TRACKS[id].scale.join()}@${TRACKS[id].root}`));
      expect(keys.size, set.join()).toBeGreaterThanOrEqual(Math.min(set.length, 2));
    }
  });
});

describe('tracks: pentatonic safety', () => {
  it('scales are ascending, root-anchored, within one octave', () => {
    for (const id of IDS) {
      const sc = TRACKS[id].scale;
      expect(sc[0], id).toBe(0);
      for (let i = 0; i < sc.length; i++) {
        const v = sc[i]!;
        expect(Number.isInteger(v), `${id} degree ${i}`).toBe(true);
        expect(v, id).toBeGreaterThanOrEqual(0);
        expect(v, id).toBeLessThan(12);
        if (i > 0) expect(v, `${id} ascending`).toBeGreaterThan(sc[i - 1]!);
      }
    }
  });

  it('no two scale degrees a semitone apart (incl. octave wrap)', () => {
    for (const id of IDS) {
      const sc = TRACKS[id].scale;
      for (let i = 0; i < sc.length; i++) {
        for (let j = i + 1; j < sc.length; j++) {
          const d = (((sc[j]! - sc[i]!) % 12) + 12) % 12;
          expect(d === 1 || d === 11, `${id}: ${sc[i]}~${sc[j]} clash`).toBe(false);
        }
      }
    }
  });

  it('no tritone against the root', () => {
    for (const id of IDS) {
      for (const s of TRACKS[id].scale) {
        expect(s % 12, `${id}: tritone degree ${s}`).not.toBe(6);
      }
    }
  });
});

describe('tracks: the sour-note gag (the ONE sanctioned scale breaker)', () => {
  it('at most one sour note per track, and it must land on a real note', () => {
    for (const id of IDS) {
      const sour = TRACKS[id].sourNotes;
      if (!sour) continue;
      expect(sour.length, `${id}: sourNotes is a gag, not a genre`).toBeLessThanOrEqual(1);
      for (const sn of sour) {
        const cfg = TRACKS[id];
        const p = sn.voice === 'bass' ? cfg.bass : sn.voice === 'lead' ? cfg.lead : cfg.arp;
        expect(p, `${id}: sour voice ${sn.voice} missing`).toBeDefined();
        const steps = parsePattern(p!);
        expect(sn.step, `${id}: sour step out of range`).toBeLessThan(steps.length);
        expect(steps[sn.step], `${id}: sour step is a rest`).not.toBeNull();
        expect(Number.isInteger(sn.semi), id).toBe(true);
        expect(Math.abs(sn.semi), `${id}: sour |semi| must be 1..2`).toBeGreaterThanOrEqual(1);
        expect(Math.abs(sn.semi), `${id}: sour |semi| must be 1..2`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('every declared sour note GENUINELY breaks the scale (or it is not sour)', () => {
    for (const id of IDS) {
      const cfg = TRACKS[id];
      if (!cfg.sourNotes) continue;
      const pcs = new Set(cfg.scale.map((s) => s % 12));
      for (const sn of cfg.sourNotes) {
        const p = sn.voice === 'bass' ? cfg.bass : sn.voice === 'lead' ? cfg.lead : cfg.arp!;
        const n = parsePattern(p)[sn.step]!;
        const pc = ((degreeToSemitone(cfg.scale, n.deg, n.oct) + sn.semi) % 12 + 12) % 12;
        expect(pcs.has(pc), `${id}: sour note pc ${pc} is still in scale — not sour`).toBe(false);
      }
    }
  });

  it('the castle march and the ending fanfare each carry exactly one', () => {
    expect(TRACKS.castle.sourNotes?.length).toBe(1);
    expect(TRACKS.ending.sourNotes?.length).toBe(1);
    expect(TRACKS.ending.sourNotes![0]!.semi).toBeLessThan(0); // flatted, per the brief
  });
});

describe('tracks: patterns', () => {
  it('every pattern parses and its beat-length divides the loop', () => {
    for (const id of IDS) {
      const cfg = TRACKS[id];
      const loopBeats = cfg.bars * 4;
      for (const { name, p } of voicesOf(cfg)) {
        const steps = parsePattern(p);
        expect(steps.length % p.div, `${id}.${name} ragged beat`).toBe(0);
        const beats = steps.length / p.div;
        expect(loopBeats % beats, `${id}.${name} does not divide ${loopBeats} beats`).toBe(0);
      }
    }
  });

  it('tonal notes land on scale tones; holds are >= 1 step', () => {
    for (const id of IDS) {
      const cfg = TRACKS[id];
      const pitchClasses = new Set(cfg.scale.map((s) => s % 12));
      for (const { name, p } of voicesOf(cfg)) {
        if (name === 'noise') continue;
        for (const n of parsePattern(p)) {
          if (n === null) continue;
          expect(n.len, `${id}.${name}`).toBeGreaterThanOrEqual(1);
          const semi = degreeToSemitone(cfg.scale, n.deg, n.oct);
          const pc = ((semi % 12) + 12) % 12;
          // Patterns are degree-indexed, so they CANNOT go off-scale; the
          // sourNotes field (tested above) is the one runtime exemption.
          expect(pitchClasses.has(pc), `${id}.${name} off-scale pc ${pc}`).toBe(true);
        }
      }
    }
  });

  it('noise patterns use only the closed drum set 0/1/2, no octave marks', () => {
    for (const id of IDS) {
      const p = TRACKS[id].noise;
      if (!p) continue;
      for (const n of parsePattern(p)) {
        if (n === null) continue;
        expect([0, 1, 2], `${id}.noise drum ${n.deg}`).toContain(n.deg);
        expect(n.oct, `${id}.noise octave mark`).toBe(0);
      }
    }
  });

  it('all voiced notes sit in an audible register (E1..C8)', () => {
    for (const id of IDS) {
      const cfg = TRACKS[id];
      const regOct: Record<Exclude<VoiceName, 'noise'>, number> = { bass: 0, lead: 1, arp: 2 };
      for (const { name, p } of voicesOf(cfg)) {
        if (name === 'noise') continue;
        for (const n of parsePattern(p)) {
          if (n === null) continue;
          const midi = cfg.root + degreeToSemitone(cfg.scale, n.deg, n.oct) + 12 * regOct[name];
          const hz = midiToFreq(midi);
          expect(hz, `${id}.${name} too low (${hz.toFixed(1)} Hz)`).toBeGreaterThanOrEqual(41);
          expect(hz, `${id}.${name} too high (${hz.toFixed(1)} Hz)`).toBeLessThanOrEqual(4200);
        }
      }
    }
  });

  it('the parser throws on garbage — typos never become silence', () => {
    expect(() => parsePattern({ div: 2, steps: '0 X 2' })).toThrow();
    expect(() => parsePattern({ div: 2, steps: '0:0' })).toThrow();
    expect(() => parsePattern({ div: 2, steps: '' })).toThrow();
  });
});

describe('tracks: variety is real, not parametric', () => {
  /** Track note density: summed onsets/second across voices at base bpm. */
  function nps(cfg: TrackConfig): number {
    let total = 0;
    for (const { p } of voicesOf(cfg)) {
      const steps = parsePattern(p);
      const onsets = steps.filter((s) => s !== null).length;
      const seconds = (steps.length / p.div) * (60 / cfg.bpm);
      total += onsets / seconds;
    }
    return total;
  }

  it('notes-per-second spans at least 2.5x across the four LEVEL themes', () => {
    const densities = LEVEL_THEMES.map((id) => nps(TRACKS[id]));
    const min = Math.min(...densities);
    const max = Math.max(...densities);
    expect(min).toBeGreaterThan(0);
    expect(max / min, `span ${min.toFixed(2)}..${max.toFixed(2)} n/s`).toBeGreaterThanOrEqual(2.5);
  });

  it('uses several distinct scale shapes, roots and subdivisions', () => {
    const shapes = new Set(IDS.map((id) => TRACKS[id].scale.join(',')));
    const roots = new Set(IDS.map((id) => TRACKS[id].root));
    const divs = new Set(IDS.flatMap((id) => voicesOf(TRACKS[id]).map((v) => v.p.div)));
    expect(shapes.size).toBeGreaterThanOrEqual(4);
    expect(roots.size).toBeGreaterThanOrEqual(5);
    expect(divs.size).toBeGreaterThanOrEqual(3);
  });
});

describe('variation engine: deterministic, distinct, pentatonic-safe', () => {
  it('variantOf is FNV-1a: stable, well-known vectors, no act-id collisions', () => {
    expect(variantOf('w1a2')).toBe(variantOf('w1a2'));
    expect(variantOf('')).toBe(0x811c9dc5); // FNV offset basis
    expect(variantOf('a')).toBe(0xe40c292c); // published FNV-1a test vector
    const actIds: string[] = [];
    for (let w = 1; w <= 4; w++) for (let a = 1; a <= 8; a++) actIds.push(`w${w}a${a}`);
    const hashes = new Set(actIds.map(variantOf));
    expect(hashes.size, 'act-id hash collision').toBe(actIds.length);
    for (const id of actIds) expect(variantOf(id), id).not.toBe(0); // 0 is the base
  });

  it('same (track, variant) -> the identical arrangement, forever', () => {
    for (const id of IDS) {
      for (const v of [0, 7, variantOf('w1a2'), variantOf(`x-${id}`)]) {
        expect(ser(arrange(TRACKS[id], v)), `${id}#${v}`).toBe(ser(arrange(TRACKS[id], v)));
      }
    }
  });

  it('variant 0 IS the base arrangement', () => {
    for (const id of IDS) {
      const cfg = TRACKS[id];
      const a = arrange(cfg, 0);
      expect(a.transpose, id).toBe(0);
      expect(a.leadTimbre, id).toBe('square');
      expect(a.swing, id).toBe(cfg.swing ?? 0);
      expect(ser(a.bass.steps), id).toBe(ser(parsePattern(cfg.bass)));
      expect(ser(a.lead.steps), id).toBe(ser(parsePattern(cfg.lead)));
      if (cfg.noise) expect(ser(a.noise!.steps), id).toBe(ser(parsePattern(cfg.noise)));
    }
  });

  it("variantOf('w1a2') differs from the base in >= 3 structural properties", () => {
    const cfg = TRACKS.meadow; // w1 acts play the meadow theme
    const base = arrange(cfg, 0);
    const varr = arrange(cfg, variantOf('w1a2'));
    const diffs: string[] = [];
    if (varr.transpose !== base.transpose) diffs.push('transpose');
    if (varr.leadTimbre !== base.leadTimbre) diffs.push('leadTimbre');
    if (varr.swing !== base.swing) diffs.push('swing');
    if (ser(varr.bass) !== ser(base.bass)) diffs.push('bass');
    if (ser(varr.noise) !== ser(base.noise)) diffs.push('noise');
    if (ser(varr.arp) !== ser(base.arp)) diffs.push('arp');
    expect(varr.transpose, 'nonzero variants always re-key').not.toBe(0);
    expect(ser(varr.bass.steps), 'bass line must be rearranged').not.toBe(ser(base.bass.steps));
    expect(diffs.length, `only differs in: ${diffs.join(', ')}`).toBeGreaterThanOrEqual(3);
  });

  it('every level theme gets a structurally different bass AND drums per variant', () => {
    const variants = [variantOf('w1a2'), variantOf('w2a3'), variantOf('w3a5'), variantOf('w4a7'), 7, 123];
    for (const theme of LEVEL_THEMES) {
      const cfg = TRACKS[theme];
      const base = arrange(cfg, 0);
      for (const v of variants) {
        const a = arrange(cfg, v);
        expect(ser(a.bass), `${theme}#${v} bass unchanged`).not.toBe(ser(base.bass));
        expect(ser(a.noise), `${theme}#${v} drums unchanged`).not.toBe(ser(base.noise));
      }
    }
  });

  it('transpositions come only from the safe set and keep every voice audible', () => {
    for (const t of SAFE_TRANSPOSES) {
      expect(Number.isInteger(t)).toBe(true);
      expect(t).not.toBe(0);
      expect(Math.abs(t)).toBeLessThanOrEqual(5);
    }
    for (let v = 1; v <= 40; v++) {
      const a = arrange(TRACKS.meadow, v);
      expect(SAFE_TRANSPOSES, `variant ${v}`).toContain(a.transpose);
    }
    // Register safety under EVERY allowed transpose, for EVERY track.
    const regOct: Record<Exclude<VoiceName, 'noise'>, number> = { bass: 0, lead: 1, arp: 2 };
    for (const id of IDS) {
      const cfg = TRACKS[id];
      for (const t of [0, ...SAFE_TRANSPOSES]) {
        for (const { name, p } of voicesOf(cfg)) {
          if (name === 'noise') continue;
          for (const n of parsePattern(p)) {
            if (n === null) continue;
            const midi = cfg.root + t + degreeToSemitone(cfg.scale, n.deg, n.oct) + 12 * regOct[name];
            const hz = midiToFreq(midi);
            expect(hz, `${id}.${name} @${t} low`).toBeGreaterThanOrEqual(41);
            expect(hz, `${id}.${name} @${t} high`).toBeLessThanOrEqual(4200);
          }
        }
      }
    }
  });

  it('arranged voices still divide the loop and stay on the pentatonic grid', () => {
    for (const id of IDS) {
      const cfg = TRACKS[id];
      const loopBeats = cfg.bars * 4;
      const pcs = new Set(cfg.scale.map((s) => s % 12));
      for (const v of [0, 5, variantOf(id), variantOf('w2a4')]) {
        const a = arrange(cfg, v);
        const arranged = [
          { name: 'bass', va: a.bass },
          { name: 'lead', va: a.lead },
          ...(a.arp ? [{ name: 'arp', va: a.arp }] : []),
          ...(a.noise ? [{ name: 'noise', va: a.noise }] : []),
        ];
        for (const { name, va } of arranged) {
          expect(va.steps.length % va.div, `${id}#${v}.${name} ragged`).toBe(0);
          const beats = va.steps.length / va.div;
          expect(loopBeats % beats, `${id}#${v}.${name} loop misfit`).toBe(0);
          for (const n of va.steps) {
            if (n === null) continue;
            if (name === 'noise') {
              expect([0, 1, 2], `${id}#${v} drum`).toContain(n.deg);
            } else {
              const pc = ((degreeToSemitone(cfg.scale, n.deg, n.oct) % 12) + 12) % 12;
              expect(pcs.has(pc), `${id}#${v}.${name} off-scale`).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('home shuffle-bag and pause hold (pure, pre-ensure)', () => {
  it('plays all 3 home tunes before any repeat and never back-to-back', () => {
    const m = new Music();
    const seq: TrackId[] = [];
    for (let i = 0; i < 12; i++) {
      m.playHome();
      seq.push(m.nowPlaying()!.id);
    }
    for (let i = 0; i < seq.length; i += 3) {
      const chunk = new Set(seq.slice(i, i + 3));
      expect(chunk.size, `bag ${i / 3} incomplete: ${seq.join(' ')}`).toBe(3);
      for (const id of chunk) expect(HOME_SET).toContain(id);
    }
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i], `repeat at ${i}: ${seq.join(' ')}`).not.toBe(seq[i - 1]);
    }
  });

  it('the home rotation is deterministic (seeded, no Math.random)', () => {
    const seq = (): string => {
      const m = new Music();
      const out: TrackId[] = [];
      for (let i = 0; i < 9; i++) {
        m.playHome();
        out.push(m.nowPlaying()!.id);
      }
      return out.join(',');
    };
    expect(seq()).toBe(seq());
  });

  it('playPause parks on rotating hold muzak; endPause restores track+variant', () => {
    const m = new Music();
    m.play('casino', { variant: 9 });
    m.playPause();
    const hold1 = m.nowPlaying()!.id;
    expect(HOLD_SET).toContain(hold1);
    m.playPause(); // re-entrant: still on the same hold cassette
    expect(m.nowPlaying()!.id).toBe(hold1);
    m.endPause();
    expect(m.nowPlaying()).toEqual({ id: 'casino', variant: 9 });
    m.playPause();
    const hold2 = m.nowPlaying()!.id;
    expect(HOLD_SET).toContain(hold2);
    expect(hold2, 'hold cassette must rotate').not.toBe(hold1);
    m.endPause();
    expect(m.nowPlaying()).toEqual({ id: 'casino', variant: 9 });
    m.endPause(); // not paused: safe no-op
    expect(m.nowPlaying()).toEqual({ id: 'casino', variant: 9 });
  });

  it('pausing over silence returns to silence', () => {
    const m = new Music();
    m.playPause();
    expect(HOLD_SET).toContain(m.nowPlaying()!.id);
    m.endPause();
    expect(m.nowPlaying()).toBeNull();
  });

  it('takeover/release re-rolls the level family but KEEPS the act variant', () => {
    const m = new Music();
    m.play('meadow', { variant: 4 });
    m.takeover('boss');
    expect(m.nowPlaying()).toEqual({ id: 'boss', variant: 0 });
    m.release();
    expect(m.nowPlaying()).toEqual({ id: 'sewer', variant: 4 }); // the HANDBACK cycle
  });
});

describe('sfx: recipe table', () => {
  const events = allSfxEvents();

  function layersOf(ev: GameEvent): readonly Recipe[] {
    const spec = sfxRecipeFor(ev);
    if (spec === null) return [];
    return Array.isArray(spec) ? spec : [spec as Recipe];
  }

  it('covers the whole GameEvent union (compile-checked; sanity here)', () => {
    expect(events.length).toBeGreaterThanOrEqual(40);
    expect(new Set(events).size).toBe(events.length);
  });

  it('every non-null recipe has dur>0, vol in (0,1], freqs in 40..8000', () => {
    for (const ev of events) {
      for (const r of layersOf(ev)) {
        expect(r.dur, ev).toBeGreaterThan(0);
        expect(r.vol, ev).toBeGreaterThan(0);
        expect(r.vol, ev).toBeLessThanOrEqual(1);
        expect(r.delay ?? 0, ev).toBeGreaterThanOrEqual(0);
        for (const f of [r.f0, r.f1]) {
          expect(f, `${ev} freq`).toBeGreaterThanOrEqual(40);
          expect(f, `${ev} freq`).toBeLessThanOrEqual(8000);
        }
        for (const semi of r.arp ?? []) {
          const hz = r.f0 * Math.pow(2, semi / 12);
          expect(hz, `${ev} arp step ${semi}`).toBeGreaterThanOrEqual(40);
          expect(hz, `${ev} arp step ${semi}`).toBeLessThanOrEqual(8000);
        }
      }
    }
  });

  it('ambient recipes stay QUIET (scenery, not information)', () => {
    for (const ev of ['drip', 'slot-spin', 'gavel-slam', 'lava-bubble'] as const) {
      for (const r of layersOf(ev)) expect(r.vol, ev).toBeLessThanOrEqual(0.15);
    }
  });

  it('signature moments keep their brief: ~1s death arp, snappy text blip', () => {
    const die = layersOf('die');
    expect(Math.max(...die.map((r) => r.dur + (r.delay ?? 0)))).toBeGreaterThanOrEqual(50);
    for (const r of layersOf('text-blip')) expect(r.dur).toBeLessThanOrEqual(4);
    // coin brief is literal: bright two-note ding E6 -> B6
    const coin = layersOf('coin');
    expect(coin[0]?.f0).toBeCloseTo(1318.5, 0);
    expect(coin[0]?.arp).toEqual([0, 7]);
  });

  it('an id outside the union THROWS — no silent fallback', () => {
    expect(() => sfxRecipeFor('covfefe' as unknown as GameEvent)).toThrow(/unknown event/);
  });
});

describe('audio modules are Node-clean and lazy', () => {
  it('Sfx constructs and pre-gesture play() is a safe no-op', () => {
    const sfx = new Sfx();
    expect(() => sfx.play('coin')).not.toThrow(); // no ctx yet: silent by design
    expect(() => sfx.setVolume(0.3)).not.toThrow();
  });

  it('Music constructs; play/takeover/release/update are safe pre-ensure', () => {
    const m = new Music();
    expect(() => m.play('meadow')).not.toThrow(); // remembered for ensure()
    expect(() => m.play('meadow', { variant: variantOf('w1a3') })).not.toThrow();
    expect(() => m.setIntensity(1)).not.toThrow();
    expect(() => m.update()).not.toThrow();
    expect(() => m.takeover('boss')).not.toThrow();
    expect(() => m.release()).not.toThrow(); // hands back re-rolled
    expect(() => m.stop()).not.toThrow();
    expect(() => m.play('nope' as unknown as TrackId)).toThrow(/unknown track/);
  });

  it('playHome/playPause/endPause/suspend/resume are safe pre-ensure', () => {
    const m = new Music();
    expect(() => m.suspend()).not.toThrow();
    expect(() => m.resume()).not.toThrow();
    expect(() => m.playHome()).not.toThrow();
    expect(() => m.playPause()).not.toThrow();
    expect(() => m.endPause()).not.toThrow();
    expect(() => m.suspend()).not.toThrow(); // suspend while "playing" (pre-ctx)
    expect(() => m.play('castle')).not.toThrow(); // remembered even while suspended
    expect(() => m.resume()).not.toThrow();
    expect(() => m.stop()).not.toThrow();
  });

  it('an unpaired release() throws loudly', () => {
    const m = new Music();
    expect(() => m.release()).toThrow(/without a matching takeover/);
  });
});
