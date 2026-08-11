import type { LevelId, SceneLike, SceneParams, WorldNo } from '../core/types.ts';
import { VIEW_H, VIEW_W } from '../core/constants.ts';
import type { Game, Services } from '../game/game.ts';
import { LEVELS } from '../levels/index.ts';
import { CASTLES, continueAtMap, mapOf, unlockedIds, worldOf, WORLD_MAPS } from '../levels/maps.ts';
import {
  drawEdgePath, drawFog, drawNode, drawPuff, drawTerrain, drawToken, drawWoodSign,
  edgePoint, listEdges, MAP_W, nodePos,
} from '../render/mapArt.ts';
import { MenuNav } from '../ui/menuInput.ts';
import { UI, panel, textShadow } from '../ui/theme.ts';

// ============================================================================
// The world map: ONE continuous Super-Mario-World-style overworld. All 30
// acts live on a single 2560x360 kingdom (four themed regions), the camera
// smooth-follows Estrada's token, and moving focus WALKS the token along the
// beaded trail to the neighbour (one pending move may queue). Locked future
// regions are visible under fog — the player sees the whole campaign ahead.
// Contract preserved: MenuNav drives the graph both ways, select enters
// unlocked acts only, back -> title, music.playHome() on entry.
// ============================================================================

/** Frames a walk takes per pixel of trail, clamped to a snappy range. */
const WALK_MIN = 12;
const WALK_MAX = 20;
/** Camera smoothing factor per frame. */
const CAM_EASE = 0.12;

function clampCam(x: number): number {
  return Math.max(0, Math.min(MAP_W - VIEW_W, x));
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

export class WorldMapScene implements SceneLike {
  private frame = 0;
  private at: LevelId;
  private nav: MenuNav;
  private camX: number;
  private token: { x: number; y: number };
  private facing: 1 | -1 = 1;
  private walk: { from: LevelId; to: LevelId; t: number; dur: number } | null = null;
  private pending: LevelId | null = null;
  private puffs: { x: number; y: number; age: number }[] = [];

  constructor(
    private readonly game: Game,
    private readonly services: Services,
    params: SceneParams['worldmap'],
  ) {
    this.at = params.focus ?? continueAtMap(services.progress);
    this.nav = new MenuNav(services.input);
    this.token = nodePos(this.at);
    this.camX = clampCam(this.token.x - VIEW_W * 0.5);
    services.music.playHome();
  }

  update(): void {
    this.frame++;
    const { input, sfx, progress } = this.services;
    if (input.edges().size > 0) sfx.ensure();

    // advance the walk (and the dust it kicks up)
    if (this.walk) {
      const w = this.walk;
      w.t++;
      if (w.t >= w.dur) {
        this.token = nodePos(w.to);
        this.walk = null;
        if (this.pending) {
          const next = this.pending;
          this.pending = null;
          this.startWalk(next);
        }
      } else {
        const p = edgePoint(w.from, w.to, easeInOut(w.t / w.dur));
        this.token = p;
        if (w.t % 3 === 0 && !this.services.reducedMotion()) {
          this.puffs.push({ x: p.x - this.facing * 5, y: p.y - 4, age: 0 });
        }
      }
    }
    for (const p of this.puffs) p.age++;
    this.puffs = this.puffs.filter(p => p.age < 18);

    // camera smooth-follows the token, clamped to the kingdom
    const target = clampCam(this.token.x - VIEW_W * 0.5);
    this.camX += (target - this.camX) * CAM_EASE;
    if (Math.abs(target - this.camX) < 0.4) this.camX = target;

    const action = this.nav.poll();
    if (!action) return;
    const open = unlockedIds(progress);

    if (action === 'back') {
      sfx.play('ui-back');
      this.game.changeScene('title', {});
      return;
    }
    if (action === 'select') {
      const def = LEVELS.find(d => d.id === this.at);
      if (def && open.has(this.at)) {
        sfx.play('ui-select');
        this.game.changeScene('level', { levelId: this.at });
      } else {
        sfx.play('ui-back'); // not authored yet or locked: polite denial
      }
      return;
    }

    // Directional navigation from the logical focus (the walk's destination
    // while walking). At most ONE move queues behind an in-flight walk.
    const best = this.pickNeighbour(this.at, action, open);
    if (!best) return;
    if (this.walk) {
      if (!this.pending) this.pending = best;
      return;
    }
    this.startWalk(best);
  }

  private startWalk(to: LevelId): void {
    const from = this.at;
    const a = nodePos(from);
    const b = nodePos(to);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    this.walk = {
      from,
      to,
      t: 0,
      dur: Math.max(WALK_MIN, Math.min(WALK_MAX, Math.round(dist / 7))),
    };
    this.facing = b.x >= a.x ? 1 : -1;
    this.at = to;
    this.services.sfx.play('ui-move');
  }

  /** Best unlocked neighbour of `from` in the pressed direction. Graph edges
   *  are walkable both ways; castles bridge to the next world's entry and
   *  entries bridge back — all in continuous kingdom coordinates. */
  private pickNeighbour(
    from: LevelId,
    action: 'up' | 'down' | 'left' | 'right',
    open: ReadonlySet<LevelId>,
  ): LevelId | null {
    const world = worldOf(from);
    const map = mapOf(world);
    const here = map.nodes.find(n => n.levelId === from);
    if (!here) return null;
    const neighbours = new Set<LevelId>(here.next);
    for (const m of WORLD_MAPS) {
      for (const n of m.nodes) if (n.next.includes(from)) neighbours.add(n.levelId);
    }
    if (from === CASTLES[world]) {
      const nm = WORLD_MAPS.find(m => m.world === world + 1);
      if (nm) neighbours.add(nm.entry);
    }
    if (from === map.entry && world > 1) {
      neighbours.add(CASTLES[(world - 1) as WorldNo]);
    }

    const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[action];
    const p0 = nodePos(from);
    let best: LevelId | null = null;
    let bestScore = Infinity;
    for (const id of neighbours) {
      if (!open.has(id)) continue;
      const p1 = nodePos(id);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const along = dx * dir[0]! + dy * dir[1]!;
      if (along <= 8) continue; // must actually be in that direction
      const across = Math.abs(dx * dir[1]! + dy * dir[0]!);
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const camX = Math.round(this.camX);
    const { progress } = this.services;
    const open = unlockedIds(progress);
    let maxWorld: WorldNo = 1;
    for (const id of open) {
      const w = worldOf(id);
      if (w > maxWorld) maxWorld = w;
    }

    drawTerrain(ctx, camX, this.frame);

    // trails, then the fog of the future, then every node crisp on top
    for (const e of listEdges()) {
      drawEdgePath(ctx, camX, e.a, e.b, open.has(e.a) && open.has(e.b));
    }
    drawFog(ctx, camX, this.frame, maxWorld);
    for (const map of WORLD_MAPS) {
      const castleId = CASTLES[map.world];
      for (const n of map.nodes) {
        drawNode(ctx, camX, n.levelId, {
          unlocked: open.has(n.levelId),
          cleared: !!progress.cleared[n.levelId],
          focus: n.levelId === this.at,
          optional: n.optional === true,
          castle: n.levelId === castleId,
          final: n.levelId === CASTLES[4],
        }, this.frame);
      }
    }

    for (const p of this.puffs) drawPuff(ctx, camX, p.x, p.y, p.age);
    drawToken(ctx, camX, this.token.x, this.token.y, this.frame, {
      walking: this.walk !== null,
      facing: this.facing,
      bob: !this.services.reducedMotion(),
    });

    this.drawHud(ctx);
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    const { progress } = this.services;
    const open = unlockedIds(this.services.progress);
    const map = mapOf(worldOf(this.at));

    drawWoodSign(
      ctx, VIEW_W / 2,
      `W${map.world} — ${map.name}`,
      `a production of: ${map.producer}`,
    );

    const def = LEVELS.find(d => d.id === this.at);
    const best = progress.cleared[this.at];
    panel(ctx, 8, VIEW_H - 34, VIEW_W - 16, 26, {});
    ctx.font = UI.fontBody;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const label = def ? def.title : 'SET STILL UNDER CONSTRUCTION';
    textShadow(ctx, `${this.at.toUpperCase()}  ${label}`, 18, VIEW_H - 16, UI.text);
    ctx.textAlign = 'right';
    if (best) {
      textShadow(
        ctx,
        `best: ¢${best.coins}  ▮${best.goldbars}/5  ★${best.secrets}/3 — replayable`,
        VIEW_W - 18, VIEW_H - 16, UI.accent,
      );
    } else if (open.has(this.at)) {
      textShadow(ctx, 'princess not yet rescued (as planned)', VIEW_W - 18, VIEW_H - 16, UI.textDim);
    } else {
      textShadow(ctx, 'locked — clear the route first', VIEW_W - 18, VIEW_H - 16, UI.textDim);
    }
    // controls hint: top-right corner, clear of the sign and the info panel
    ctx.font = UI.fontSmall;
    textShadow(ctx, 'ENTER: enter set · ESC: title', VIEW_W - 8, 14, UI.textDim);
    ctx.textAlign = 'left';
  }
}
