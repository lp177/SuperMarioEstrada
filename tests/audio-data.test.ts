// ============================================================================
// PURE DATA audio tests — no AudioContext, plain Node. Exhaustiveness of the
// tables is compile-enforced (Record<TrackId,...> / Record<GameEvent,...>);
// here we test the MUSICAL rules: pentatonic safety, tempo band, pattern
// grammar, real (not parametric) variety, and sane sfx recipe numbers.
// ============================================================================

import { describe, it, expect } from 'vitest';
import type { GameEvent, TrackId } from '../src/core/types.ts';
import {
  TRACKS,
  parsePattern,
  degreeToSemitone,
  midiToFreq,
  type Pattern,
  type TrackConfig,
} from '../src/audio/tracks.ts';
import { Sfx, sfxRecipeFor, allSfxEvents, type Recipe } from '../src/audio/sfx.ts';
import { Music } from '../src/audio/music.ts';

const IDS = Object.keys(TRACKS) as TrackId[];

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

describe('tracks: shape', () => {
  it('has all 8 tracks with satire-voiced names', () => {
    expect(IDS.length).toBe(8);
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

  it('notes-per-second spans at least 2.5x from sparsest to densest', () => {
    const densities = IDS.map((id) => nps(TRACKS[id]));
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
    expect(() => m.setIntensity(1)).not.toThrow();
    expect(() => m.update()).not.toThrow();
    expect(() => m.takeover('boss')).not.toThrow();
    expect(() => m.release()).not.toThrow(); // hands back re-rolled
    expect(() => m.stop()).not.toThrow();
    expect(() => m.play('nope' as unknown as TrackId)).toThrow(/unknown track/);
  });

  it('an unpaired release() throws loudly', () => {
    const m = new Music();
    expect(() => m.release()).toThrow(/without a matching takeover/);
  });
});
