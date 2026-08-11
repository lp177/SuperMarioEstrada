import { defineConfig } from 'vite';

// GitHub Pages serves this repo from a sub-path, so every URL must be relative.
// Build output goes to docs/ — the ONLY folder GitHub Pages can serve besides
// the repo root — and docs/ is committed, never hand-edited.
export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    target: 'es2022',
  },
});
