import { initKeyboardLayout } from './core/keyboardLayout.ts';
import { Input } from './core/input.ts';
import { effectiveReducedMotion, loadSettings, saveSettings } from './core/prefs.ts';
import { loadProgress, saveProgress } from './game/progress.ts';
import { Game, type SceneFactory, type Services } from './game/game.ts';
import { Sfx } from './audio/sfx.ts';
import { Music } from './audio/music.ts';
import { TitleScene } from './scenes/TitleScene.ts';
import { WorldMapScene } from './scenes/WorldMapScene.ts';
import { CutsceneScene } from './scenes/CutsceneScene.ts';
import { LevelScene } from './scenes/LevelScene.ts';

const canvas = document.getElementById('stage') as HTMLCanvasElement;

const settings = loadSettings();
const input = new Input(() => settings.bindings);
const sfx = new Sfx();
const music = new Music();
sfx.setVolume(settings.sfxVol);
music.setVolume(settings.musicVol);

const services: Services = {
  input,
  sfx,
  music,
  settings,
  saveSettings: () => saveSettings(settings),
  progress: loadProgress(),
  setProgress: p => {
    services.progress = p;
    saveProgress(p);
  },
  reducedMotion: () => effectiveReducedMotion(settings),
  coop: false,
};

// Exhaustive scene registry — a SceneName missing here fails to compile.
const factories: SceneFactory = {
  title: (g, s) => new TitleScene(g, s),
  worldmap: (g, s, p) => new WorldMapScene(g, s, p),
  cutscene: (g, s, p) => new CutsceneScene(g, s, p),
  level: (g, s, p) => new LevelScene(g, s, p),
};

void initKeyboardLayout();
input.attach(window);
canvas.focus();

// An unfocused tab plays no music: suspend the audio clock, resume on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) music.suspend();
  else music.resume();
});

const game = new Game(canvas, services, factories, 'title');
requestAnimationFrame(game.tick);

// Debug handle for browser probes (house convention).
Object.assign(window, { __game: game, __services: services });
