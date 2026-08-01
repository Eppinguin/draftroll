import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist-browser',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        host: resolve(import.meta.dirname, 'fixtures/host.html'),
        overlay: resolve(import.meta.dirname, '../../overlay.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/cannon-es')) return 'physics';
          return undefined;
        },
      },
    },
  },
});
