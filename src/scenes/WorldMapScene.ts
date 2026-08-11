import type { LevelId, SceneLike, SceneParams, ThemeId, WorldNo } from '../core/types.ts';
import { VIEW_H, VIEW_W } from '../core/constants.ts';
import type { Game, Services } from '../game/game.ts';
import { LEVELS } from '../levels/index.ts';
import { CASTLES, continueAtMap, mapOf, unlockedIds, worldOf, WORLD_MAPS } from '../levels/maps.ts';
import { MenuNav } from '../ui/menuInput.ts';
import { UI, panel, textShadow } from '../ui/theme.ts';

// ============================================================================
// The conspiracy corkboard. Each world is a board of pinned polaroids (acts)
// tied together with red yarn. Estrada's pin walks the graph; cleared acts
// stay replayable; optional spurs dangle off the route. ESC backs to title.
// ============================================================================

const THEME_TINT: Record<ThemeId, string> = {
  meadow: '#4c8f4c',
  sewer: '#40695c',
  casino: '#6d4a91',
  castle: '#8a4444',
};

export class WorldMapScene implements SceneLike {
  private frame = 0;
  private world: WorldNo;
  private at: LevelId;
  private nav: MenuNav;

  constructor(
    private readonly game: Game,
    private readonly services: Services,
    params: SceneParams['worldmap'],
  ) {
    this.at = params.focus ?? continueAtMap(services.progress);
    this.world = worldOf(this.at);
    this.nav = new MenuNav(services.input);
    services.music.play('title');
  }

  private get map() {
    return mapOf(this.world);
  }

  update(): void {
    this.frame++;
    const { input, sfx, progress } = this.services;
    if (input.edges().size > 0) sfx.ensure();
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

    // Directional navigation: move to the best-matching unlocked neighbour
    // (graph edges are walkable both ways).
    const here = this.map.nodes.find(n => n.levelId === this.at);
    if (!here) return;
    const neighbours = new Set<LevelId>(here.next);
    for (const n of this.map.nodes) if (n.next.includes(this.at)) neighbours.add(n.levelId);
    // Castle bridges to next world entry; entry bridges back.
    if (this.at === CASTLES[this.world] && progress.cleared[this.at]) {
      const nm = WORLD_MAPS.find(m => m.world === this.world + 1);
      if (nm) neighbours.add(nm.entry);
    }
    if (this.at === this.map.entry && this.world > 1) {
      neighbours.add(CASTLES[(this.world - 1) as WorldNo]);
    }

    const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[action];
    if (!dir) return;
    let best: LevelId | null = null;
    let bestScore = Infinity;
    for (const id of neighbours) {
      if (!open.has(id)) continue;
      const other = WORLD_MAPS.flatMap(m => m.nodes).find(n => n.levelId === id);
      if (!other) continue;
      // Cross-world neighbours project beyond the screen edge.
      const sameWorld = worldOf(id) === this.world;
      const ox = sameWorld ? other.x : (worldOf(id) > this.world ? VIEW_W + 80 : -80);
      const oy = sameWorld ? other.y : here.y;
      const dx = ox - here.x;
      const dy = oy - here.y;
      const along = dx * dir[0]! + dy * dir[1]!;
      if (along <= 8) continue; // must actually be in that direction
      const across = Math.abs(dx * dir[1]! + dy * dir[0]!);
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = id; }
    }
    if (best) {
      this.at = best;
      this.world = worldOf(best);
      this.services.sfx.play('ui-move');
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawCorkboard(ctx);

    const { progress } = this.services;
    const open = unlockedIds(progress);
    const map = this.map;

    // Red conspiracy yarn between nodes (dashed when the far node is locked).
    for (const n of map.nodes) {
      for (const nx of n.next) {
        const o = map.nodes.find(m => m.levelId === nx);
        if (!o) continue;
        ctx.strokeStyle = open.has(nx) ? '#c62828' : 'rgba(198,40,40,0.35)';
        ctx.lineWidth = 2;
        ctx.setLineDash(open.has(nx) ? [] : [4, 4]);
        ctx.beginPath();
        // yarn sags a little between pins
        const mx = (n.x + o.x) / 2;
        const my = Math.max(n.y, o.y) + 14;
        ctx.moveTo(n.x, n.y);
        ctx.quadraticCurveTo(mx, my, o.x, o.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    for (const n of map.nodes) this.polaroid(ctx, n.levelId, n.x, n.y, open.has(n.levelId));

    // Header: world name on masking tape + the producer credit.
    ctx.fillStyle = 'rgba(240,230,200,0.92)';
    ctx.fillRect(VIEW_W / 2 - 130, 10, 260, 24);
    ctx.font = UI.fontHead;
    textShadow(ctx, `W${this.world} — ${map.name}`, VIEW_W / 2 - 118, 27, '#4a3320');
    ctx.font = UI.fontSmall;
    textShadow(ctx, `a production of: ${map.producer}`, VIEW_W / 2 - 118, 44, UI.accent);

    // Footer legend + focused level info.
    const def = LEVELS.find(d => d.id === this.at);
    const best = progress.cleared[this.at];
    panel(ctx, 8, VIEW_H - 40, VIEW_W - 16, 32, {});
    ctx.font = UI.fontBody;
    const label = def ? def.title : 'SET STILL UNDER CONSTRUCTION';
    textShadow(ctx, `${this.at.toUpperCase()}  ${label}`, 18, VIEW_H - 20, UI.text);
    if (best) {
      textShadow(
        ctx,
        `best: ¢${best.coins}  ▮${best.goldbars}/5  ★${best.secrets}/3  — replayable`,
        330, VIEW_H - 20, UI.accent,
      );
    }
    ctx.font = UI.fontSmall;
    textShadow(ctx, 'ESC: title', VIEW_W - 70, VIEW_H - 46, UI.textDim);
  }

  private drawCorkboard(ctx: CanvasRenderingContext2D): void {
    // Cork texture: warm base + deterministic speckles.
    ctx.fillStyle = '#8d6b48';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    for (let i = 0; i < 260; i++) {
      const x = (i * 97) % VIEW_W;
      const y = (i * 173 + ((i * i) % 29)) % VIEW_H;
      ctx.fillStyle = i % 3 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, y, 3, 2);
    }
    // Wooden frame.
    ctx.strokeStyle = '#5d4630';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, VIEW_W - 10, VIEW_H - 10);
    // A few stray sticky notes (the conspirators' notes to self).
    const notes: [number, number, string][] = [
      [560, 60, 'DENY'], [40, 90, 'ODDS 1M:1'], [575, 300, 'WIG GLUE'],
    ];
    ctx.font = UI.fontSmall;
    for (const [x, y, t] of notes) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(((x + y) % 7 - 3) * 0.03);
      ctx.fillStyle = '#efe28a';
      ctx.fillRect(-22, -14, 44, 28);
      ctx.fillStyle = '#4a3320';
      ctx.fillText(t, -18, 4);
      ctx.restore();
    }
  }

  private polaroid(ctx: CanvasRenderingContext2D, id: LevelId, x: number, y: number, unlocked: boolean): void {
    const { progress } = this.services;
    const map = this.map;
    const node = map.nodes.find(n => n.levelId === id);
    const cleared = !!progress.cleared[id];
    const isCastle = CASTLES[this.world] === id;
    const focus = id === this.at;
    const w = isCastle ? 52 : 42;
    const h = isCastle ? 46 : 38;

    ctx.save();
    ctx.translate(x, y);
    const idn = Number(id[3]) || 0;
    ctx.rotate(((idn % 5) - 2) * 0.035 + (focus ? Math.sin(this.frame / 20) * 0.02 : 0));
    // photo frame
    ctx.fillStyle = focus ? '#fffef5' : '#eae6d8';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // picture area
    ctx.fillStyle = unlocked ? THEME_TINT[map.theme] : '#3a3a3a';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 14);
    ctx.font = UI.fontSmall;
    if (!unlocked) {
      ctx.fillStyle = '#111';
      ctx.fillText('?', -2, 2);
    } else if (isCastle) {
      // tiny castle glyph + red marker circle
      ctx.fillStyle = '#222';
      ctx.fillRect(-8, -10, 16, 12);
      ctx.fillRect(-10, -14, 4, 6);
      ctx.fillRect(6, -14, 4, 6);
      ctx.strokeStyle = '#c62828';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, -2, w / 2 + 5, h / 2 + 4, 0.2, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // tiny hills glyph
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(-6, 0, 6, Math.PI, 0);
      ctx.arc(6, 2, 8, Math.PI, 0);
      ctx.fill();
    }
    // caption
    ctx.fillStyle = '#4a3320';
    ctx.fillText(id.toUpperCase(), -w / 2 + 4, h / 2 - 4);
    // status stamps
    if (cleared) {
      ctx.strokeStyle = '#2e7d32';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 14, -h / 2 + 8);
      ctx.lineTo(w / 2 - 9, -h / 2 + 13);
      ctx.lineTo(w / 2 - 3, -h / 2 + 3);
      ctx.stroke();
    }
    if (node?.optional && unlocked) {
      ctx.fillStyle = '#efe28a';
      ctx.fillRect(-w / 2 - 4, -h / 2 - 6, 30, 10);
      ctx.fillStyle = '#4a3320';
      ctx.fillText('bonus', -w / 2 - 2, -h / 2 + 2);
    }
    // the pin
    ctx.fillStyle = focus ? '#ffca28' : '#c62828';
    ctx.beginPath();
    ctx.arc(0, -h / 2 - 2, focus ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Estrada's cap marks the focused node.
    if (focus) {
      ctx.fillStyle = '#d32f2f';
      ctx.fillRect(x - 8, y - h / 2 - 22 + Math.round(Math.sin(this.frame / 12) * 2), 16, 7);
      ctx.fillStyle = '#fff';
      ctx.font = UI.fontSmall;
      ctx.fillText('E', x - 2, y - h / 2 - 15 + Math.round(Math.sin(this.frame / 12) * 2));
    }
  }
}
