import type { ActionId, SceneLike } from '../core/types.ts';
import { VIEW_H, VIEW_W } from '../core/constants.ts';
import type { Game, Services } from '../game/game.ts';
import { continueAtMap } from '../levels/maps.ts';
import { drawTitleArt } from '../render/titleArt.ts';
import { keyLabel } from '../core/keyboardLayout.ts';
import { MenuNav } from '../ui/menuInput.ts';
import { UI, panel, textShadow } from '../ui/theme.ts';

const MAIN_ITEMS = ['START', 'WORLD MAP', 'SETTINGS'] as const;
const REBINDABLE: ActionId[] = ['left', 'right', 'up', 'down', 'jump', 'run', 'pause'];

type Panel = 'main' | 'settings';

export class TitleScene implements SceneLike {
  private frame = 0;
  private sel = 0;
  private panel: Panel = 'main';
  private setSel = 0;
  /** Action currently waiting for a key, if any. */
  private rebinding: ActionId | null = null;
  private nav: MenuNav;

  constructor(private readonly game: Game, private readonly services: Services) {
    this.nav = new MenuNav(services.input);
    services.music.playHome(); // rotating title set — never the same tune twice in a row
  }

  update(): void {
    this.frame++;
    const { input, sfx, settings, saveSettings } = this.services;
    const edges = input.edges();
    if (edges.size > 0) sfx.ensure();

    if (this.rebinding) {
      const code = [...edges][0];
      if (code) {
        if (code !== 'Escape') {
          settings.bindings[this.rebinding] = [code, ...settings.bindings[this.rebinding].filter(c => c !== code)].slice(0, 2);
          saveSettings();
        }
        sfx.play('ui-select');
        this.rebinding = null;
      }
      return;
    }

    const action = this.nav.poll();
    if (!action) return;

    if (this.panel === 'main') this.updateMain(action);
    else this.updateSettings(action);
  }

  private updateMain(action: NonNullable<ReturnType<MenuNav['poll']>>): void {
    const { sfx, progress } = this.services;
    if (action === 'up') { this.sel = (this.sel + MAIN_ITEMS.length - 1) % MAIN_ITEMS.length; sfx.play('ui-move'); }
    else if (action === 'down') { this.sel = (this.sel + 1) % MAIN_ITEMS.length; sfx.play('ui-move'); }
    else if (action === 'select') {
      sfx.play('ui-select');
      const item = MAIN_ITEMS[this.sel];
      if (item === 'START') {
        const at = continueAtMap(progress);
        if (!progress.seen['intro']) {
          this.game.changeScene('cutscene', { id: 'intro', then: { scene: 'worldmap', focus: at } });
        } else {
          this.game.changeScene('worldmap', { focus: at });
        }
      } else if (item === 'WORLD MAP') {
        this.game.changeScene('worldmap', {});
      } else {
        this.panel = 'settings';
        this.setSel = 0;
      }
    }
  }

  private updateSettings(action: NonNullable<ReturnType<MenuNav['poll']>>): void {
    const { sfx, settings, saveSettings, music } = this.services;
    // rows: 0 music vol, 1 sfx vol, 2 reduced motion, 3.. bindings, last: back
    const rows = 3 + REBINDABLE.length + 1;
    if (action === 'back') { this.panel = 'main'; sfx.play('ui-back'); return; }
    if (action === 'up') { this.setSel = (this.setSel + rows - 1) % rows; sfx.play('ui-move'); return; }
    if (action === 'down') { this.setSel = (this.setSel + 1) % rows; sfx.play('ui-move'); return; }

    const dir = action === 'left' ? -1 : action === 'right' ? 1 : 0;
    if (this.setSel === 0 && dir) {
      settings.musicVol = Math.max(0, Math.min(1, settings.musicVol + dir * 0.1));
      music.setVolume(settings.musicVol);
      saveSettings(); sfx.play('ui-move');
    } else if (this.setSel === 1 && dir) {
      settings.sfxVol = Math.max(0, Math.min(1, settings.sfxVol + dir * 0.1));
      sfx.setVolume(settings.sfxVol);
      saveSettings(); sfx.play('coin');
    } else if (this.setSel === 2 && (dir || action === 'select')) {
      settings.reducedMotion = settings.reducedMotion === null ? true
        : settings.reducedMotion ? false : null;
      saveSettings(); sfx.play('ui-select');
    } else if (action === 'select') {
      if (this.setSel >= 3 && this.setSel < 3 + REBINDABLE.length) {
        this.rebinding = REBINDABLE[this.setSel - 3] ?? null;
        sfx.play('ui-select');
      } else if (this.setSel === rows - 1) {
        this.panel = 'main'; sfx.play('ui-back');
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawTitleArt(ctx, this.frame);
    // The art layer may leave textAlign centered; the menu owns its state.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    if (this.panel === 'main') {
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
    } else {
      panel(ctx, 60, 32, VIEW_W - 120, VIEW_H - 64, {});
      ctx.font = UI.fontHead;
      textShadow(ctx, 'SETTINGS — THE FINE PRINT', 80, 56, UI.accent);
      ctx.font = UI.fontBody;
      const rows: [string, string][] = [
        ['MUSIC', bar(this.services.settings.musicVol)],
        ['SFX', bar(this.services.settings.sfxVol)],
        ['REDUCED MOTION', this.services.settings.reducedMotion === null ? 'SYSTEM' : this.services.settings.reducedMotion ? 'ON' : 'OFF'],
        ...REBINDABLE.map((a): [string, string] => [
          a.toUpperCase(),
          this.rebinding === a ? 'PRESS A KEY…' : (this.services.settings.bindings[a] ?? []).map(keyLabel).join(' / '),
        ]),
        ['BACK', ''],
      ];
      let y = 84;
      for (let i = 0; i < rows.length; i++) {
        const [label, value] = rows[i]!;
        const focus = i === this.setSel;
        textShadow(ctx, (focus ? '▶ ' : '  ') + label, 84, y, focus ? UI.accent : UI.text);
        textShadow(ctx, value, 300, y, focus ? UI.text : UI.textDim);
        y += 19;
      }
      ctx.font = UI.fontSmall;
      const pads = this.services.input.padCount();
      textShadow(
        ctx,
        pads > 0 ? `🎮 ${pads} gamepad${pads > 1 ? 's' : ''} connected` : '🎮 no gamepad detected (plug in & press a button)',
        84, VIEW_H - 44, pads > 0 ? UI.ok : UI.textDim,
      );
      textShadow(ctx, 'keys are POSITIONS: labels follow your real layout (AZERTY-safe)', 84, VIEW_H - 56, UI.textDim);
    }
  }
}

function bar(v: number): string {
  const n = Math.round(v * 10);
  return '█'.repeat(n) + '░'.repeat(10 - n);
}
