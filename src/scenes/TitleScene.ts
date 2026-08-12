import type { SceneLike } from '../core/types.ts';
import { VIEW_H, VIEW_W } from '../core/constants.ts';
import type { Game, Services } from '../game/game.ts';
import { continueAtMap } from '../levels/maps.ts';
import { drawTitleArt } from '../render/titleArt.ts';
import { MenuNav } from '../ui/menuInput.ts';
import { SettingsPanel } from '../ui/settingsPanel.ts';
import { UI, textShadow } from '../ui/theme.ts';

const MAIN_ITEMS = ['START', '2 PLAYERS', 'WORLD MAP', 'SETTINGS'] as const;

export class TitleScene implements SceneLike {
  private frame = 0;
  private sel = 0;
  private settings: SettingsPanel | null = null;
  private nav: MenuNav;

  constructor(private readonly game: Game, private readonly services: Services) {
    this.nav = new MenuNav(services.input);
    services.music.playHome(); // rotating title set — never the same tune twice in a row
  }

  update(): void {
    this.frame++;
    const { input, sfx } = this.services;
    if (input.edges().size > 0) sfx.ensure();

    if (this.settings) {
      if (!this.settings.update()) this.settings = null;
      return;
    }

    const action = this.nav.poll();
    if (!action) return;

    const { progress } = this.services;
    if (action === 'up') { this.sel = (this.sel + MAIN_ITEMS.length - 1) % MAIN_ITEMS.length; sfx.play('ui-move'); }
    else if (action === 'down') { this.sel = (this.sel + 1) % MAIN_ITEMS.length; sfx.play('ui-move'); }
    else if (action === 'select') {
      sfx.play('ui-select');
      const item = MAIN_ITEMS[this.sel];
      if (item === 'START' || item === '2 PLAYERS') {
        this.services.coop = item === '2 PLAYERS';
        const at = continueAtMap(progress);
        if (!progress.seen['intro']) {
          this.game.changeScene('cutscene', { id: 'intro', then: { scene: 'worldmap', focus: at } });
        } else {
          this.game.changeScene('worldmap', { focus: at });
        }
      } else if (item === 'WORLD MAP') {
        this.game.changeScene('worldmap', {});
      } else {
        this.settings = new SettingsPanel(this.services, this.nav);
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawTitleArt(ctx, this.frame);
    // The art layer may leave textAlign centered; the menu owns its state.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    if (this.settings) {
      this.settings.render(ctx);
      return;
    }

    const x = VIEW_W / 2 - 80;
    let y = VIEW_H - 96;
    ctx.font = UI.fontHead;
    for (let i = 0; i < MAIN_ITEMS.length; i++) {
      const focus = i === this.sel;
      if (focus && this.frame % 30 < 20) textShadow(ctx, '▶', x - 22, y, UI.accent);
      textShadow(ctx, MAIN_ITEMS[i] ?? '', x, y, focus ? UI.accent : UI.text);
      y += 26;
    }
    ctx.font = UI.fontSmall;
    textShadow(ctx, 'a parody — not affiliated with nintendo', VIEW_W / 2 - 110, VIEW_H - 8, UI.textDim);
  }
}
