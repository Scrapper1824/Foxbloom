import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';

// Samsung Tizen 3.0 TVs ship Chromium 47, which already parses arrows and classes; 'ie 11' is in the list to force a full
// ES5 build (global constraint), so no ES2015+ syntax survives in the output.
export default defineConfig({
  base: './',
  plugins: [legacy({ targets: ['chrome >= 47', 'ie 11'], renderModernChunks: false })],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: { outDir: 'dist' },
  test: { environment: 'jsdom' },
});
