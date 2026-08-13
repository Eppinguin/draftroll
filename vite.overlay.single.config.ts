import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function singleOverlay(): Plugin {
  return {
    name: 'draftroll-single-overlay',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const entries = Object.values(bundle);
      const htmlEntry = entries.find((entry) => entry.type === 'asset' && entry.fileName.endsWith('.html'));
      if (!htmlEntry || htmlEntry.type !== 'asset' || typeof htmlEntry.source !== 'string') {
        throw new Error('Single-overlay build did not emit HTML');
      }
      const scripts = entries.filter((entry) => entry.type === 'chunk' && entry.isEntry);
      if (scripts.length !== 1 || scripts[0].type !== 'chunk') {
        throw new Error(`Single-overlay build expected one entry script, found ${scripts.length}`);
      }
      const styles = entries.filter((entry) => entry.type === 'asset' && entry.fileName.endsWith('.css'));

      let html = htmlEntry.source;
      for (const style of styles) {
        if (style.type !== 'asset') continue;
        const css = typeof style.source === 'string' ? style.source : new TextDecoder().decode(style.source);
        const href = `./${style.fileName}`;
        html = html.replace(`<link rel="stylesheet" crossorigin href="${href}">`, `<style>${css}</style>`);
        delete bundle[style.fileName];
      }

      const script = scripts[0];
      const src = `./${script.fileName}`;
      html = html.replace(
        `<script type="module" crossorigin src="${src}"></script>`,
        `<script type="module>${script.code}</script>`,
      );
      delete bundle[script.fileName];

      if (html.includes('./assets/')) throw new Error('Single-overlay HTML still references emitted assets');
      delete bundle[htmlEntry.fileName];
      this.emitFile({ type: 'asset', fileName: 'draftroll-overlay.html', source: html });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [singleOverlay()],
  build: {
    outDir: 'dist-single-overlay',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'overlay.html'),
      output: { inlineDynamicImports: true },
    },
  },
});
