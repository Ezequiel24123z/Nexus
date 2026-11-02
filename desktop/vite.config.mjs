import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  // Desktop uses plain CSS; do not inherit the web app's parent PostCSS config.
  css: { postcss: { plugins: [] } },
  build: { outDir: 'ui', emptyOutDir: true }
});
