import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-runtime-themes-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

try {
  await writeFile(configPath, JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'Node',
      rootDir: join(projectRoot, 'packages'),
      outDir,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    include: [join(projectRoot, 'packages/**/*.ts')],
  }, null, 2));

  const compile = spawnSync('tsc', ['-p', configPath], { cwd: projectRoot, encoding: 'utf8' });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const themesModule = await import(pathToFileURL(join(outDir, 'themes/src/index.js')).href);
  const rendererModule = await import(pathToFileURL(join(outDir, 'renderer/src/index.js')).href);
  const {
    BundledThemeProvider,
    CachedThemeProvider,
    DRAFTROLL_THEME_SCHEMA_VERSION,
    InvalidThemeError,
    ThemeAssetLimitError,
    decodeDiceTheme,
    prepareRuntimeTheme,
  } = themesModule;
  const { DraftrollRenderer } = rendererModule;

  const manifest = {
    schemaVersion: DRAFTROLL_THEME_SCHEMA_VERSION,
    id: 'test-obsidian',
    name: 'Test Obsidian',
    version: '1.2.3',
    availableDice: ['d6', 'd20'],
    previews: { d20: '/previews/test-obsidian-d20.webp' },
    material: {
      color: '#17131f',
      roughness: 0.44,
      metalness: 0.3,
      surfaceTexture: { src: 'assets/obsidian.webp', mimeType: 'image/webp' },
    },
    labels: {
      color: '#ffffff',
      atlas: { src: 'assets/labels.png', mimeType: 'image/png' },
    },
    effects: { positive: 'major-burst', neutral: 'subtle-pulse', negative: 'void-fracture' },
    metadata: { rendererThemeId: 'test-obsidian' },
  };
  const provider = new CachedThemeProvider(new BundledThemeProvider(
    [manifest],
    [
      ['assets/obsidian.webp', new Uint8Array([1, 2, 3, 4]).buffer],
      ['assets/labels.png', new Uint8Array([5, 6, 7]).buffer],
    ],
  ));

  const events = [];
  const bundle = await prepareRuntimeTheme(provider, manifest.id, { onEvent: (event) => events.push(event) });
  assert.equal(bundle.manifest.id, manifest.id);
  assert.deepEqual(Object.keys(bundle.assets).sort(), ['assets/labels.png', 'assets/obsidian.webp']);
  assert.equal(events.at(-1).type, 'complete');
  assert.equal(events.filter((event) => event.type === 'asset-complete').length, 2);

  const bridgeCalls = [];
  const bridgeThemes = new Map([['dragon', { id: 'dragon', name: 'Wyrmfire' }]]);
  const bridge = {
    async roll(request) {
      bridgeCalls.push(['roll', request]);
      return { results: request.results ?? [], total: 12, replay: null };
    },
    setDie() {},
    setQuantity() {},
    setTheme(themeId) { bridgeCalls.push(['setTheme', themeId]); },
    getThemes() { return [...bridgeThemes.values()]; },
    installTheme(runtimeBundle) {
      bridgeCalls.push(['installTheme', runtimeBundle.manifest.id]);
      const installed = {
        id: runtimeBundle.manifest.id,
        name: runtimeBundle.manifest.name,
        version: runtimeBundle.manifest.version,
        previews: runtimeBundle.manifest.previews,
        availableDice: runtimeBundle.manifest.availableDice,
      };
      bridgeThemes.set(installed.id, installed);
      return installed;
    },
  };

  const rendererEvents = [];
  const renderer = new DraftrollRenderer({ bridge, themeProvider: provider, onThemeLoad: (event) => rendererEvents.push(event) });
  await renderer.warmup([manifest.id]);
  assert.deepEqual(bridgeCalls.slice(0, 2), [['installTheme', manifest.id], ['setTheme', manifest.id]]);
  assert.equal(rendererEvents.at(-1).type, 'complete');

  await renderer.playRoll({
    authority: 'local',
    expression: '1d20',
    total: 12,
    dice: [{ id: 'die_1', type: 'd20', sides: 20, result: 12, kept: true, themeId: manifest.id }],
    operations: [],
    createdAt: new Date(0).toISOString(),
  });
  assert.equal(bridgeCalls.filter(([name]) => name === 'installTheme').length, 1, 'theme should only install once');
  assert.deepEqual(bridgeCalls.find(([name]) => name === 'roll')[1].themes, [manifest.id]);

  assert.throws(() => decodeDiceTheme({ ...manifest, schemaVersion: 99 }), InvalidThemeError);
  await assert.rejects(
    () => prepareRuntimeTheme(provider, manifest.id, { maximumAssetBytes: 2 }),
    ThemeAssetLimitError,
  );

  console.log(JSON.stringify({
    ok: true,
    themeId: manifest.id,
    assets: Object.keys(bundle.assets),
    progressEvents: events.length,
    installs: bridgeCalls.filter(([name]) => name === 'installTheme').length,
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
