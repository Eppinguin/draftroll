import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// With multiple HTML inputs Vite keeps each entry's path relative to the project
// root, which would emit the host fixture as tests/browser/fixtures/host.html.
// serve-fixtures.mjs serves flat root URLs (/host.html), so flatten it back.
// Asset references are absolute because base is '/', so moving the file is safe.
function flattenHtmlEntries(): Plugin {
  return {
    name: 'draftroll-flatten-html-entries',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'asset' || !fileName.endsWith('.html')) continue;
        const flattened = fileName.split('/').pop();
        if (!flattened || flattened === fileName) continue;
        delete bundle[fileName];
        chunk.fileName = flattened;
        bundle[flattened] = chunk;
      }
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [flattenHtmlEntries()],
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
