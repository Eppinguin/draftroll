import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        playground: resolve(import.meta.dirname, 'index.html'),
        cards: resolve(import.meta.dirname, 'cards.html'),
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
