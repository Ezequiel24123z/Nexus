import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Desktop uses plain CSS; do not inherit the web app's parent PostCSS config.
  css: { postcss: { plugins: [] } },
  build: {
    outDir: 'ui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'icons-vendor', test: /node_modules[\\/]lucide-react[\\/]/, priority: 25 },
            { name: 'katex-vendor', test: /node_modules[\\/]katex[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
});
