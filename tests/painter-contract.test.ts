// ============================================================================
// tests/painter-contract.test.ts — the presentation-drift gate.
//
// House rule #1: "if it has collision it must be visible". Every id union the
// painter dispatches on must be FULLY covered by its draw tables; this test
// turns forgetting that into a red suite instead of an invisible enemy (the
// house's #1 historical bug class — 39 dangling ids once shipped unnoticed).
//
// Pure data, no canvas: it imports the PAINTED_* listings (derived inside the
// painter from the actual dispatch Records) and holds them against canonical
// literal copies of the unions kept HERE. Both drift directions fail:
//   - types.ts grows a member these canonical lists lack -> the CoversAll
//     assignments below stop compiling (`npm run typecheck` includes tests/);
//   - a canonical member has no draw entry in the painter -> the runtime
//     set-diff below goes red until it is painted.
// Importing the painter into plain Node is itself the module-scope DOM-safety
// proof: a module-level document/canvas touch would throw right here.
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { BossPhase, EnemyKind, EntityKind, ThemeId, TileKind } from '../src/core/types.ts';
import {
  PAINTED_BOSS_PHASES,
  PAINTED_ENEMY_SKINS,
  PAINTED_ENTITY_KINDS,
  PAINTED_TILE_KINDS,
} from '../src/render/painter.ts';

// ---------------------------------------------------------------------------
// Canonical literal lists. `satisfies` rejects strays (typos / non-members);
// CoversAll rejects omissions: if a union member is missing from a list, the
// conditional type collapses to a labeled error tuple and the assignment
// below it stops compiling.
// ---------------------------------------------------------------------------

type CoversAll<L extends readonly unknown[], U extends string> =
  Exclude<U, L[number]> extends never
    ? readonly U[]
    : ['CANONICAL LIST IS MISSING', Exclude<U, L[number]>];

const ALL_ENEMY_KINDS = [
  'lobbyist', 'pollster', 'lawyer', 'paparazzo', 'rat', 'chipstack', 'gavel',
] as const satisfies readonly EnemyKind[];

const ALL_ENTITY_KINDS = [
  ...ALL_ENEMY_KINDS,
  'pen', 'shell', 'powerup', 'coin', 'goldbar', 'secret', 'spring', 'checkpoint',
] as const satisfies readonly EntityKind[];

const ALL_TILE_KINDS = [
  'empty', 'ground', 'bedrock', 'brick', 'qblock', 'usedblock',
  'oneway', 'pipe', 'spike', 'lava', 'crumble',
] as const satisfies readonly TileKind[];

const ALL_BOSS_PHASES = [
  'off', 'intro', 'fight', 'escape', 'defeated',
] as const satisfies readonly BossPhase[];

const ALL_THEMES = [
  'meadow', 'sewer', 'casino', 'castle',
] as const satisfies readonly ThemeId[];

// Completeness proofs — these assignments fail to compile the moment types.ts
// grows a member the lists above do not know. The consts then serve as the
// tests' ground truth.
const ENEMY_CANON: CoversAll<typeof ALL_ENEMY_KINDS, EnemyKind> = ALL_ENEMY_KINDS;
const ENTITY_CANON: CoversAll<typeof ALL_ENTITY_KINDS, EntityKind> = ALL_ENTITY_KINDS;
const TILE_CANON: CoversAll<typeof ALL_TILE_KINDS, TileKind> = ALL_TILE_KINDS;
const PHASE_CANON: CoversAll<typeof ALL_BOSS_PHASES, BossPhase> = ALL_BOSS_PHASES;
const THEME_CANON: CoversAll<typeof ALL_THEMES, ThemeId> = ALL_THEMES;

// ---------------------------------------------------------------------------
// Set comparison with named diffs so a failure says exactly what to paint.
// ---------------------------------------------------------------------------

function expectCovered<T extends string>(
  what: string,
  canon: readonly T[],
  painted: readonly T[],
): void {
  const p = new Set<T>(painted);
  const c = new Set<T>(canon);
  const missing = canon.filter((k) => !p.has(k));
  const stray = painted.filter((k) => !c.has(k));
  expect(missing, `${what}: union members with NO draw entry — paint them`).toEqual([]);
  expect(stray, `${what}: painter entries not in the union — stale?`).toEqual([]);
  expect(p.size, `${what}: duplicate entries in the painter listing`).toBe(painted.length);
}

describe('painter contract (presentation-drift gate)', () => {
  it('draws every EntityKind', () => {
    expectCovered('EntityKind', ENTITY_CANON, PAINTED_ENTITY_KINDS);
  });

  it('draws every TileKind', () => {
    expectCovered('TileKind', TILE_CANON, PAINTED_TILE_KINDS);
  });

  it('draws every BossPhase', () => {
    expectCovered('BossPhase', PHASE_CANON, PAINTED_BOSS_PHASES);
  });

  it('dresses every enemy kind in every theme (entourage disguises)', () => {
    for (const kind of ENEMY_CANON) {
      expectCovered(`enemy skin '${kind}'`, THEME_CANON, PAINTED_ENEMY_SKINS[kind]);
    }
  });

  it('has a skin row for every enemy kind, exactly once', () => {
    expectCovered(
      'enemy skin table',
      ENEMY_CANON,
      Object.keys(PAINTED_ENEMY_SKINS) as EnemyKind[],
    );
  });
});
