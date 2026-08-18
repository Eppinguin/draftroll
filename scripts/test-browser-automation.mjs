import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadTypeScript } from './lib/load-typescript.mjs';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert(packageJson.version === '0.1.0', 'root package version must remain unchanged');
assert(packageJson.devDependencies?.['@playwright/test'], '@playwright/test is missing');
for (const script of [
  'test:browser',
  'test:browser:build',
  'test:browser:chromium',
  'test:browser:install',
]) {
  assert(typeof packageJson.scripts?.[script] === 'string', `missing package script ${script}`);
}

const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
assert(
  /allowBuilds:\s*[\s\S]*esbuild:\s*true/.test(workspace),
  'esbuild build approval is missing',
);
assert(
  /allowBuilds:\s*[\s\S]*workerd:\s*true/.test(workspace),
  'workerd build approval is missing',
);
const wrangler = readFileSync(join(root, 'apps/worker/wrangler.jsonc'), 'utf8');
assert(
  wrangler.includes('"compatibility_date": "2026-07-29"'),
  'Wrangler compatibility date changed',
);
assert(
  wrangler.includes('http://127.0.0.1:4173'),
  'browser fixture origin is not allowlisted locally',
);

const overlayRenderer = readFileSync(join(root, 'packages/overlay/src/index.ts'), 'utf8');
assert(
  overlayRenderer.includes('physicalModels: cloneOverlayPhysicalModels(options.physicalModels)'),
  'overlay play serialization drops physicalModels',
);
assert(
  overlayRenderer.includes('clonePhysicalDieDefinition(model.definition)'),
  'overlay physical models are not defensively cloned',
);

const server = readFileSync(join(root, 'tests/browser/serve-fixtures.mjs'), 'utf8');
for (const directive of [
  'frame-src',
  'connect-src',
  'frame-ancestors',
  "object-src 'none'",
  "base-uri 'none'",
]) {
  assert(server.includes(directive), `CSP fixture is missing ${directive}`);
}
assert(server.includes("pathname === '/blocked.html'"), 'blocked frame fixture is missing');
assert(
  server.includes("pathname === '/connect-blocked.html'"),
  'blocked connect fixture is missing',
);

const browserVite = readFileSync(join(root, 'tests/browser/vite.config.ts'), 'utf8');
assert(
  browserVite.includes("'../../cards.html'"),
  'cards browser fixture is not included in the test build',
);

const specs = collectFiles(join(root, 'tests/browser/specs'), '.ts');
assert(specs.length >= 3, 'browser spec suite is incomplete');
const combinedSpecs = specs.map((file) => readFileSync(file, 'utf8')).join('\n');
for (const marker of [
  'cross-origin overlay',
  'roller-only values',
  'catches up from the event cursor',
  'three participants',
  'frame-src policy',
  'idle-zero render loop',
  'Renderer is busy',
  '30-dice benchmark',
  'near-simultaneous room rolls',
  'a later room roll joins the active table world',
  'a new room roll can strike dice that already settled',
  '20d20 predetermined pool uses one continuous staged trajectory',
  'HTTP state, D1 history, durable events, and revisions never expose roller-only values',
  'mixed physical and fallback benchmark completes in one synchronized presentation',
  'accessible text fallback works with reduced motion and no WebGL',
  'host-supplied custom physical model through the shared planner',
  'authoritative outcomes for generated non-standard physical dice',
  'additive generated physical roll preserves settled canonical dice',
  'generated physical dice receive heavy and low-gravity planner presets',
  'generated physical dice remain draggable after settlement',
  'cards demo draws through the real overlay',
]) {
  assert(combinedSpecs.includes(marker), `browser suite is missing coverage: ${marker}`);
}

const ts = loadTypeScript();
const sources = [
  join(root, 'playwright.config.ts'),
  join(root, 'tests/browser/vite.config.ts'),
  ...collectFiles(join(root, 'tests/browser/fixtures'), '.ts'),
  ...collectFiles(join(root, 'tests/browser/specs'), '.ts'),
  ...collectFiles(join(root, 'tests/browser/support'), '.ts'),
  // Declaration files carry no emit, so `transpileModule` fails on them.
].filter((file) => !file.endsWith('.d.ts'));
for (const file of sources) {
  const source = readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert(
    errors.length === 0,
    `${file} has TypeScript syntax errors: ${errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('; ')}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      browserSpecs: specs.length,
      transpiledSources: sources.length,
      projects: ['chromium', 'firefox', 'webkit', 'mobile-chromium'],
      coverage: [
        'WebGL overlay',
        'cross-origin iframe',
        'CSP',
        'dismiss passthrough',
        'hidden/reveal',
        'reconnect replay',
        'three participants',
        'idle-zero renderer',
        'serialized presentations',
        'simultaneous table rolls',
        'in-flight additive table rolls',
        'settled-table additive rolls',
        '20d20 continuous trajectory',
        '30-dice diagnostics',
        'mixed physical/fallback performance',
        'HTTP/D1 hidden projection boundaries',
        'reduced-motion and no-WebGL fallback',
        'host-supplied custom physical model',
        'generated authoritative physical outcomes',
        'generated physical replay after resize',
        'generated additive table preservation',
        'generated physical planner presets',
        'generated settled dragging',
        'stateful card overlay integration',
      ],
    },
    null,
    2,
  ),
);

function collectFiles(directory, suffix) {
  const output = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) output.push(...collectFiles(path, suffix));
    else if (path.endsWith(suffix)) output.push(path);
  }
  return output;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
