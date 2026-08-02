import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadTypeScript } from './lib/load-typescript.mjs';

const root = resolve(import.meta.dirname, '..');
const examples = {
  'framework-free': ['index.html', 'main.ts'],
  react: ['App.tsx'],
  headless: ['server.mjs'],
  vtt: ['integration.ts'],
  bot: ['room-bot.mjs'],
  'stream-overlay': ['index.html', 'main.ts'],
  'hidden-roll': ['index.html', 'main.ts'],
  'cross-origin': ['index.html', 'main.ts'],
  'custom-symbolic': ['main.ts'],
};
for (const [directory, files] of Object.entries(examples)) {
  for (const file of files)
    assert.ok(
      statSync(join(root, 'examples', directory, file)).isFile(),
      `missing examples/${directory}/${file}`,
    );
}
const sourceFiles = Object.entries(examples).flatMap(([directory, files]) =>
  files.map((file) => join(root, 'examples', directory, file)),
);
const combined = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
for (const marker of [
  '@draftroll/sdk/browser',
  '@draftroll/sdk/headless',
  '@draftroll/react',
  'DraftrollTextRenderer',
  'connectRoom',
  "visibility: { type: 'roller' }",
  'targetOrigin',
  'Content-Security-Policy',
  "renderAs: 'd6'",
  "metadata: { source: 'vtt'",
])
  assert.ok(combined.includes(marker), `generic integration examples are missing ${marker}`);
for (const forbidden of ['Draftsheet', '@draftsheet/', 'campaignId:', 'characterId:']) {
  assert.equal(
    combined.includes(forbidden),
    false,
    `examples contain product-specific assumption: ${forbidden}`,
  );
}
const ts = loadTypeScript();
for (const file of sourceFiles.filter((candidate) => /\.(?:ts|tsx)$/.test(candidate))) {
  const result = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(
    errors.length,
    0,
    `${file} has TypeScript syntax errors: ${errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('; ')}`,
  );
}
console.log(
  JSON.stringify(
    {
      ok: true,
      examples: Object.keys(examples),
      generic: true,
      transpiledSources: sourceFiles.filter((file) => /\.(?:ts|tsx)$/.test(file)).length,
    },
    null,
    2,
  ),
);
