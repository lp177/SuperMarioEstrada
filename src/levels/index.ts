import type { LevelDef, LevelId } from '../core/types.ts';
import { world1 } from './world1.ts';
import { world2 } from './world2.ts';
import { world3 } from './world3.ts';
import { world4 } from './world4.ts';

/** The campaign roster. Progress is keyed by string id (never index), so
 *  appending is always safe; REORDERING existing acts is still forbidden
 *  because unlock order follows this array. */
export const LEVELS: readonly LevelDef[] = [...world1, ...world2, ...world3, ...world4];

export const LEVEL_ORDER: readonly LevelId[] = LEVELS.map(d => d.id);
