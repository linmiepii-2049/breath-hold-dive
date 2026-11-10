import { defineConfig } from 'vite';

// Project site: https://linmiepii-2049.github.io/breath-hold-dive/
export default defineConfig({
  base: '/breath-hold-dive/',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
