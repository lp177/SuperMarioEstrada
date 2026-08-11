import type { LevelDef } from '../core/types.ts';

// PLACEHOLDER world — one hand-rolled dev act so the engine integrates.
// The content workflow replaces this file with 4 authored acts.
export const world1: LevelDef[] = [
  {
    id: 'w1a1',
    world: 1,
    act: 1,
    title: 'Foreclosure Fields',
    excuse: 'A notary never runs. It devalues the stamp.',
    theme: 'meadow',
    width: 160,
    build(b) {
      b.ground(0, 40, 26);
      b.start(3, 25);
      b.coinRow(8, 14, 22);
      b.qblock(16, 22, 'coin');
      b.qblock(18, 22, 'stamp');
      b.brick(17, 22);
      b.enemy('lobbyist', 24, 25);
      b.ground(44, 70, 26);
      b.coinRow(46, 50, 21);
      b.enemy('pollster', 55, 25);
      b.goldbar(0, 47, 20);
      b.steps(62, 25, 4, 1);
      b.ground(70, 100, 24);
      b.pipe(76, 20, 4, { lawyer: true });
      b.checkpoint(84, 23);
      b.goldbar(1, 90, 18);
      b.enemy('lobbyist', 92, 23);
      b.enemy('lobbyist', 95, 23);
      b.ground(102, 159, 26);
      b.oneway(104, 110, 20);
      b.goldbar(2, 107, 18);
      b.coinRow(104, 110, 19);
      b.spring(116, 25);
      b.platform(118, 122, 18, 'brick');
      b.goldbar(3, 120, 16);
      b.enemy('rat', 124, 25);
      b.secret(0, 128, 24);
      b.secret(1, 132, 24);
      b.secret(2, 136, 24);
      b.goldbar(4, 140, 22);
      b.coinRow(126, 140, 22);
      b.goal(150, 25);
    },
  },
];
