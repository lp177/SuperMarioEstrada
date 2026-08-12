// ============================================================================
// Fixtures proving RULES 11-14 — the richness rules of the act contract
// (playtest 2026-08: "lvl are little and really not vary in terme of gameplay
// purposed, always same ennemies, just necessite basic jump on going go
// straight... no significant relief, no alternative path"):
//
//   rule 11 (relief)          — the mandatory lane must span >= 8 rows and
//     change height (>= 2-row steps) >= 6 times; flat corridors fail,
//   rule 12 (alternate route) — >= 18% of route columns must offer two
//     DISJOINT reachable lanes >= 4 rows apart, with one run >= 12 columns,
//   rule 13 (enemy identity)  — >= 3 distinct kinds; consecutive acts must
//     not repeat a roster and must each debut a kind,
//   rule 14 (the top is earnable) — a launch structure within 8 tiles left
//     of the flagpole must put the certified (>= 90%) grab inside a plain
//     run-jump arc; boss acts have NO pole (door-only ceremony) and are
//     exempt.
//
// SCOPE REMINDER (see actContract.ts header): checkAct runs rules 11-14 for
// CAMPAIGN acts (LEVELS members); fixtures exercise them via checkActRichness
// and auditRichness. The RICH BASELINE below doubles as the wave's executable
// authoring documentation: it passes the FULL contract — rules 0-10 through
// checkAct AND rules 11-14 through checkActRichness — with an 8-row hill
// ridge (relief), a 24-column overhead deck above the valley (alternate
// route), three enemy kinds, and a pre-pole pyramid whose 4-row peak puts the
// certified grab inside the run-jump arc. Castle-act exemptions (no pole; no
// roster-diff clauses) are proven by the boss fixture at the bottom.
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { EnemyKind, LevelDef } from '../src/core/types.ts';
import { auditRichness, checkAct, checkActRichness, RICHNESS } from './actContract.ts';

// ---------------------------------------------------------------------------
// The configurable fixture. Baseline geometry (width 140, lane row 26):
//   0-11   opening runway (start at 2), coins
//   12-19  hill: four 2-row steps up to the ridge at row 18
//   20-31  ridge runway (lane range 26->18 = 8 rows)
//   32-39  four 2-row steps back down
//   40-70  valley floor with the three costumes (cols 44/50/56)
//          + THE DECK: a 24-column platform at row 21 (5 rows over the lane,
//          both lanes flood-reachable) = the parallel path rule 12 wants
//   71-115 goldbar perches 0-4 + secret pockets 0-2 (structure counts)
//   116-139 finale: flat runway, goal at 132 (pole at column 124), and the
//          PYRAMID launch at 118-123 — 2-wide treads up to a 4-row peak at
//          120-121, back down in 2-row steps (rule 8-clean), peak inside the
//          8-tile pole radius: the classic "earn the top" staircase, pyramid
//          form (a sheer-backed classic staircase would be a rule 8 recess).
// Degraders (each breaks exactly one richness rule):
//   flat        -> no hills, no ridge (deck kept): fails 11 and only 11 first
//   noDeck      -> hills kept, deck removed: passes 11, fails 12
//   kinds       -> enemy kind triple override: [a, a, b] fails 13's >= 3
//   noPyramid   -> flat finale: passes 11-13, fails 14
// ---------------------------------------------------------------------------
interface RichOpts {
  id?: 'w1a2' | 'w1a3';
  act?: 2 | 3;
  flat?: boolean;
  noDeck?: boolean;
  kinds?: [EnemyKind, EnemyKind, EnemyKind];
  noPyramid?: boolean;
}

function richAct(title: string, opts: RichOpts = {}): LevelDef {
  const kinds = opts.kinds ?? ['lobbyist', 'pollster', 'rat'];
  return {
    id: opts.id ?? 'w1a2',
    world: 1,
    act: opts.act ?? 2,
    title,
    excuse: `The relief was in committee. ${title} has the minutes.`,
    theme: 'meadow',
    width: 140,
    build(b) {
      b.ground(0, 11, 26);
      b.start(2, 25);
      b.coinRow(1, 10, 22); // 10 coins
      if (opts.flat) {
        b.ground(12, 39, 26);
        b.coinRow(21, 30, 22); // 10 coins
      } else {
        // the hill: 2-row treads up to an 8-rows-over-the-valley ridge
        b.ground(12, 13, 24);
        b.ground(14, 15, 22);
        b.ground(16, 17, 20);
        b.ground(18, 19, 18);
        b.ground(20, 31, 18); // the ridge
        b.coinRow(21, 30, 15); // 10 coins
        b.ground(32, 33, 20);
        b.ground(34, 35, 22);
        b.ground(36, 37, 24);
        b.ground(38, 39, 26);
      }
      // the valley, its costumes, and (baseline) the deck over it
      b.ground(40, 70, 26);
      b.enemy(kinds[0], 44, 25); // >= 24 tiles out: idle-silent
      b.enemy(kinds[1], 50, 25);
      b.enemy(kinds[2], 56, 25);
      if (!opts.noDeck) {
        b.platform(42, 65, 21, 'ground'); // 24 dual-lane columns, 5 rows up
        b.coinRow(43, 64, 20); // 22 coins riding the deck
      } else {
        b.coinRow(43, 64, 22); // keep the coin count without the deck
      }
      b.checkpoint(66, 25);
      b.coinRow(67, 69, 25); // 3 coins
      // structure tail: bars and secrets on the proven motif geometry,
      // hand-rolled so this file needs no motif imports
      for (let i = 0; i < 5; i++) {
        const x = 71 + i * 6; // perches at 71/77/83/89/95
        b.ground(x, x + 5, 26);
        b.platform(x + 2, x + 3, 23, 'ground');
        b.goldbar(i, x + 2, 22);
      }
      for (let i = 0; i < 3; i++) {
        const x = 101 + i * 5; // pockets at 101/106/111
        b.ground(x, x, 26);
        b.ground(x + 1, x + 1, 28); // entrance slot: drop 2, hop 2 out
        b.ground(x + 2, x + 3, 29); // pocket floor
        b.platform(x + 2, x + 3, 26, 'brick'); // the lid
        b.ground(x + 4, x + 4, 26);
        b.secret(i, x + 3, 28);
      }
      // finale: flat runway to the edge, goal at 132 -> pole at column 124
      b.ground(116, 139, 26);
      b.goal(132, 25);
      if (!opts.noPyramid) {
        // the pyramid launch: peak 4 rows over the goal line at 120-121,
        // fully left of the pole (124), 2-row treads both sides
        b.ground(118, 119, 24);
        b.ground(120, 121, 22);
        b.ground(122, 123, 24);
      }
    },
  };
}

// A boss-act fixture proving the castle exemptions: door-only ceremony (no
// pole -> rule 14 skipped; topGrab audit is null). Deliberately FLAT so its
// audit also shows rules 11/12 still judge the pre-arena body of boss acts.
const bossAct: LevelDef = {
  id: 'w1a2',
  world: 1,
  act: 2,
  title: 'Fixture Gatehouse',
  excuse: 'The arena double-booked. Bowsonaro kept the deposit.',
  theme: 'meadow',
  width: 90,
  boss: true,
  build(b) {
    b.ground(0, 53, 26);
    b.start(2, 25);
    b.coinRow(3, 44, 22); // 42 coins
    for (let i = 0; i < 5; i++) b.goldbar(i, 6 + i * 4, 24);
    b.secret(0, 24, 24);
    b.secret(1, 26, 24);
    b.secret(2, 28, 24);
    b.checkpoint(40, 25);
    b.enemy('lobbyist', 44, 25);
    b.enemy('pollster', 48, 25);
    b.enemy('rat', 52, 25);
    b.arena(54, 85, 26);
    b.goal(81, 25);
    b.ground(86, 89, 26);
  },
};

// ---------------------------------------------------------------------------
// The rich baseline: full-contract clean (this is the wave's reference act)
// ---------------------------------------------------------------------------
describe('richness rules — the rich baseline', () => {
  const base = richAct('Fixture Ridgeline');

  it('passes rules 0-10 (checkAct — fixture defs are not LEVELS members)', () => {
    expect(() => checkAct(base)).not.toThrow();
  });

  it('passes rules 11-14 (checkActRichness)', () => {
    expect(() => checkActRichness(base)).not.toThrow();
  });

  it('audits the numbers the wave should aim for', () => {
    const a = auditRichness(base);
    expect(a.violations).toEqual([]);
    expect(a.relief.rangeRows).toBeGreaterThanOrEqual(RICHNESS.reliefMinRangeRows);
    expect(a.relief.steps).toBeGreaterThanOrEqual(RICHNESS.reliefMinSteps);
    expect(a.dual.frac).toBeGreaterThanOrEqual(RICHNESS.dualMinFrac);
    expect(a.dual.bestRun).toBeGreaterThanOrEqual(RICHNESS.dualMinRunCols);
    expect(a.kinds).toEqual(['lobbyist', 'pollster', 'rat']);
    expect(a.topGrab).not.toBeNull();
    expect(a.topGrab!.bestFrac).toBeGreaterThanOrEqual(0.9);
    expect(a.topGrab!.poleCol).toBe(124);
    expect(a.topGrab!.best).toMatchObject({ col: 120, row: 22 });
  });
});

// ---------------------------------------------------------------------------
// Rule 11 — relief
// ---------------------------------------------------------------------------
describe('rule 11 (relief)', () => {
  it('rejects a flat corridor, naming range, steps and columns', () => {
    expect(() => checkActRichness(richAct('Fixture Flatline', { flat: true }))).toThrow(
      /w1a2: rule 11 \(relief\).*vertical range is \d+ row\(s\) \(need >= 8\).*only \d+ time\(s\) \(need >= 6\).*across columns 2\.\.123/s,
    );
  });

  it('accepts the 8-row hill ridge with 8 height steps (audit shows no rule-11 entry)', () => {
    const a = auditRichness(richAct('Fixture Hills Only', { noDeck: true }));
    expect(a.relief.rangeRows).toBeGreaterThanOrEqual(8);
    expect(a.relief.steps).toBeGreaterThanOrEqual(6);
    expect(a.violations.some((v) => v.includes('rule 11'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 12 — alternate route
// ---------------------------------------------------------------------------
describe('rule 12 (alternate route)', () => {
  it('rejects a single-lane act (hills alone are not a parallel path)', () => {
    expect(() => checkActRichness(richAct('Fixture Single File', { noDeck: true }))).toThrow(
      /w1a2: rule 12 \(alternate route\).*columns \(0\.0%\) offer two reachable standable lanes.*need >= 18%.*longest contiguous dual-lane stretch is 0/s,
    );
  });

  it('accepts the 24-column deck (the baseline passes; the deck IS the dual stretch)', () => {
    const a = auditRichness(richAct('Fixture Decked'));
    expect(a.dual.bestRunAt).toMatchObject({ x0: 42, x1: 65 });
    expect(a.violations.some((v) => v.includes('rule 12'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 13 — enemy identity
// ---------------------------------------------------------------------------
describe('rule 13 (enemy identity)', () => {
  it('rejects an act with only two distinct kinds', () => {
    const twoKinds = richAct('Fixture Monoculture', {
      kinds: ['lobbyist', 'lobbyist', 'pollster'],
    });
    expect(() => checkActRichness(twoKinds)).toThrow(
      /w1a2: rule 13 \(enemy identity\).*only 2 distinct enemy kind\(s\) \[lobbyist, pollster\] \(need >= 3\)/s,
    );
  });

  it('rejects identical consecutive rosters within a world', () => {
    const a2 = richAct('Fixture Act Two');
    const a3 = richAct('Fixture Act Three', { id: 'w1a3', act: 3 });
    expect(() => checkActRichness(a3, a2)).toThrow(
      /w1a3: rule 13 \(enemy identity\).*\[lobbyist, pollster, rat\] is IDENTICAL to w1a2/s,
    );
  });

  it('rejects a roster that debuts nothing (proper subset of the predecessor)', () => {
    // predecessor fields four kinds; the follow-up reuses three of them
    const a2 = richAct('Fixture Full Cast');
    a2.build = ((orig) => (b: Parameters<LevelDef['build']>[0]) => {
      orig(b);
      b.enemy('chipstack', 62, 25); // 4th kind, still idle-safe (60 tiles out)
    })(a2.build);
    const a3 = richAct('Fixture Rerun', { id: 'w1a3', act: 3 });
    expect(() => checkActRichness(a3, a2)).toThrow(
      /w1a3: rule 13 \(enemy identity\).*already walked w1a2.*must place at least one kind/s,
    );
  });

  it('accepts a follow-up roster that debuts a kind', () => {
    const a2 = richAct('Fixture Old Cast');
    const a3 = richAct('Fixture Fresh Face', {
      id: 'w1a3',
      act: 3,
      kinds: ['lobbyist', 'pollster', 'chipstack'],
    });
    expect(() => checkActRichness(a3, a2)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 14 — the top is earnable
// ---------------------------------------------------------------------------
describe('rule 14 (the top is earnable)', () => {
  it('rejects a flat finale: the pole top is out of jump reach', () => {
    expect(() => checkActRichness(richAct('Fixture No Ladder', { noPyramid: true }))).toThrow(
      /w1a2: rule 14 \(the top is earnable\).*within 8 tiles left of the pole \(column 124\).*below the certified 90%.*raise a launch structure/s,
    );
  });

  it('accepts the pyramid finale (baseline): 4-row peak puts the grab at >= 90%', () => {
    const a = auditRichness(richAct('Fixture Ladder'));
    expect(a.topGrab!.bestFrac).toBeGreaterThanOrEqual(0.9);
    expect(a.violations.some((v) => v.includes('rule 14'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Castle exemptions
// ---------------------------------------------------------------------------
describe('castle exemptions', () => {
  it('boss acts have no pole: rule 14 is skipped, topGrab audits null', () => {
    const a = auditRichness(bossAct);
    expect(a.topGrab).toBeNull();
    expect(a.violations.some((v) => v.includes('rule 14'))).toBe(false);
    // ...but rules 11/12 still judge the pre-arena body of a boss act
    expect(a.violations.some((v) => v.includes('rule 11'))).toBe(true);
    expect(a.violations.some((v) => v.includes('rule 12'))).toBe(true);
  });
});
