import type { LevelId, ProgressData, WorldMapDef, WorldNo } from '../core/types.ts';

// ============================================================================
// The campaign graph — 30 acts across 4 worlds, SMB3-style. Branch nodes give
// a choice of route; `optional` acts sit on spurs and are never required.
// Node positions are map-screen pixels (640x360, HUD strip on top).
// Castle = the last act of each world (boss). Clearing it unlocks the next
// world's entry node.
// ============================================================================

export const WORLD_MAPS: readonly WorldMapDef[] = [
  {
    world: 1,
    name: 'MUSHROOM HEIGHTS',
    producer: 'M. ESTRADA',
    theme: 'meadow',
    entry: 'w1a1',
    nodes: [
      { levelId: 'w1a1', x: 80, y: 230, next: ['w1a2'] },
      { levelId: 'w1a2', x: 170, y: 230, next: ['w1a3', 'w1a4'] },
      { levelId: 'w1a3', x: 260, y: 150, next: ['w1a5'] },            // high road
      { levelId: 'w1a4', x: 260, y: 300, next: ['w1a5'], optional: true }, // low road
      { levelId: 'w1a5', x: 350, y: 230, next: ['w1a6', 'w1a7'] },
      { levelId: 'w1a6', x: 400, y: 310, next: [], optional: true },  // spur
      { levelId: 'w1a7', x: 470, y: 210, next: [] },                  // CASTLE
    ],
  },
  {
    world: 2,
    name: 'THE MONEY PIPES',
    producer: 'P. IMPEACH',
    theme: 'sewer',
    entry: 'w2a1',
    nodes: [
      { levelId: 'w2a1', x: 70, y: 200, next: ['w2a2'] },
      { levelId: 'w2a2', x: 150, y: 250, next: ['w2a3', 'w2a4'] },
      { levelId: 'w2a3', x: 240, y: 170, next: ['w2a5'] },
      { levelId: 'w2a4', x: 240, y: 310, next: ['w2a5'], optional: true },
      { levelId: 'w2a5', x: 330, y: 240, next: ['w2a6', 'w2a7'] },
      { levelId: 'w2a6', x: 370, y: 320, next: [], optional: true },  // dungeon-door detour
      { levelId: 'w2a7', x: 430, y: 200, next: ['w2a8'] },
      { levelId: 'w2a8', x: 520, y: 230, next: [] },                  // CASTLE
    ],
  },
  {
    world: 3,
    name: 'CASINO PENINSULA',
    producer: 'P. IMPEACH (again)',
    theme: 'casino',
    entry: 'w3a1',
    nodes: [
      { levelId: 'w3a1', x: 70, y: 240, next: ['w3a2'] },
      { levelId: 'w3a2', x: 155, y: 200, next: ['w3a3', 'w3a4'] },
      { levelId: 'w3a3', x: 245, y: 130, next: ['w3a5'] },            // high roller rooftops
      { levelId: 'w3a4', x: 245, y: 280, next: ['w3a5'], optional: true },
      { levelId: 'w3a5', x: 335, y: 210, next: ['w3a6', 'w3a7'] },
      { levelId: 'w3a6', x: 380, y: 300, next: [], optional: true },  // the vault
      { levelId: 'w3a7', x: 440, y: 170, next: ['w3a8'] },
      { levelId: 'w3a8', x: 530, y: 220, next: [] },                  // CASTLE
    ],
  },
  {
    world: 4,
    name: "BOWSONARO'S GRAND PALACE",
    producer: 'BOWSONARO',
    theme: 'castle',
    entry: 'w4a1',
    nodes: [
      { levelId: 'w4a1', x: 80, y: 250, next: ['w4a2'] },
      { levelId: 'w4a2', x: 170, y: 210, next: ['w4a3', 'w4a4'] },
      { levelId: 'w4a3', x: 260, y: 140, next: ['w4a5'] },
      { levelId: 'w4a4', x: 260, y: 290, next: ['w4a5'], optional: true },
      { levelId: 'w4a5', x: 355, y: 220, next: ['w4a6', 'w4a7'] },
      { levelId: 'w4a6', x: 400, y: 310, next: [], optional: true },  // panic room
      { levelId: 'w4a7', x: 500, y: 200, next: [] },                  // FINAL CASTLE
    ],
  },
];

/** Castle (final) act of each world — clearing it unlocks the next world. */
export const CASTLES: Record<WorldNo, LevelId> = {
  1: 'w1a7', 2: 'w2a8', 3: 'w3a8', 4: 'w4a7',
};

export function worldOf(id: LevelId): WorldNo {
  return Number(id[1]) as WorldNo;
}

export function mapOf(world: WorldNo): WorldMapDef {
  const m = WORLD_MAPS.find(m => m.world === world);
  if (!m) throw new Error(`no map for world ${world}`);
  return m;
}

export function nodeOf(id: LevelId): { map: WorldMapDef; node: WorldMapDef['nodes'][number] } {
  const map = mapOf(worldOf(id));
  const node = map.nodes.find(n => n.levelId === id);
  if (!node) throw new Error(`level ${id} is not on the world map`);
  return { map, node };
}

/** Graph unlock: w1a1 always; any cleared node unlocks its `next`; a cleared
 *  castle unlocks the next world's entry. Cleared nodes stay enterable
 *  (replay from the map is a feature, not a cheat). */
export function unlockedIds(progress: ProgressData): Set<LevelId> {
  const open = new Set<LevelId>(['w1a1']);
  for (const map of WORLD_MAPS) {
    for (const node of map.nodes) {
      if (progress.cleared[node.levelId]) {
        open.add(node.levelId);
        for (const n of node.next) open.add(n);
      }
    }
    const castle = CASTLES[map.world];
    if (progress.cleared[castle]) {
      const nextMap = WORLD_MAPS.find(m => m.world === map.world + 1);
      if (nextMap) open.add(nextMap.entry);
    }
  }
  return open;
}

/** Where START should drop the player: the first unlocked-uncleared node in
 *  roster order, else the last castle (postgame free play). */
export function continueAtMap(progress: ProgressData): LevelId {
  const open = unlockedIds(progress);
  for (const map of WORLD_MAPS) {
    for (const node of map.nodes) {
      if (open.has(node.levelId) && !progress.cleared[node.levelId]) return node.levelId;
    }
  }
  return CASTLES[4];
}

/** Map focus after clearing an act: its first forward node, or itself. */
export function nextAfter(id: LevelId): LevelId {
  const { map, node } = nodeOf(id);
  if (node.next[0]) return node.next[0];
  const castle = CASTLES[map.world];
  if (id === castle) {
    const nextMap = WORLD_MAPS.find(m => m.world === map.world + 1);
    if (nextMap) return nextMap.entry;
  }
  return id;
}
