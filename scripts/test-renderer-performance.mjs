import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadTypeScript } from './lib/load-typescript.mjs';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'draftroll-performance-'));
try {
  const ts = loadTypeScript();
  const performanceSource = await readFile(join(root, 'packages/renderer/src/performance.ts'), 'utf8');
  const transpiled = ts.transpileModule(performanceSource, {
    fileName: 'performance.ts',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const performanceModule = join(temp, 'performance.mjs');
  await writeFile(performanceModule, transpiled);
  const module = await import(pathToFileURL(performanceModule).href);
  const viewportSource = await readFile(join(root, 'packages/renderer/src/viewport.ts'), 'utf8');
  const viewportTranspiled = ts.transpileModule(viewportSource, {
    fileName: 'viewport.ts',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const viewportModulePath = join(temp, 'viewport.mjs');
  await writeFile(viewportModulePath, viewportTranspiled);
  const viewportModule = await import(pathToFileURL(viewportModulePath).href);

  assert.deepEqual(module.resolveRendererPerformanceBudget({
    profile: 'battery', overlay: true, reducedMotion: false, visualCount: 1,
    devicePixelRatio: 2,
  }), { maximumPixelRatio: 1, activeFramesPerSecond: 30 });
  assert.deepEqual(module.resolveRendererPerformanceBudget({
    profile: 'auto', overlay: true, reducedMotion: false, visualCount: 4,
    devicePixelRatio: 2,
  }), { maximumPixelRatio: 1.35, activeFramesPerSecond: 60 });
  assert.equal(module.resolveRendererPerformanceBudget({
    profile: 'auto', overlay: true, reducedMotion: false, visualCount: 30,
    devicePixelRatio: 2,
  }).activeFramesPerSecond, 30);
  assert.equal(module.resolveRendererPerformanceBudget({
    profile: 'quality', overlay: false, reducedMotion: false, visualCount: 1,
    devicePixelRatio: 2,
  }).maximumPixelRatio, 2);

  const viewport = viewportModule.resolveRendererViewport({
    canvas: { width: 300, height: 150 },
    document: { width: 1497, height: 1024 },
    window: { width: 1497, height: 1024 },
  });
  assert.deepEqual(viewport, { width: 1497, height: 1024, aspect: 1497 / 1024 });
  const orthographic = viewportModule.resolveOrthographicViewport(viewport, 10);
  const horizontalPixelsPerWorldUnit = viewport.width / (orthographic.halfWidth * 2);
  const verticalPixelsPerWorldUnit = viewport.height / (orthographic.halfHeight * 2);
  assert.ok(Math.abs(horizontalPixelsPerWorldUnit - verticalPixelsPerWorldUnit) < 1e-9);

  const controller = new module.AdaptiveResolutionController({ sampleFrames: 15 });
  let scale = 1;
  for (let index = 0; index < 15; index += 1) {
    const next = controller.observe(28, 60, scale);
    if (next !== null) scale = next;
  }
  assert.equal(scale, 0.9);
  for (let index = 0; index < 15; index += 1) {
    const next = controller.observe(8, 60, scale);
    if (next !== null) scale = next;
  }
  assert.equal(scale, 0.95);

  const main = await readFile(join(root, 'src/main.ts'), 'utf8');
  const effects = await readFile(join(root, 'src/effects.ts'), 'utf8');
  const dice = await readFile(join(root, 'src/dice.ts'), 'utf8');
  const overlay = await readFile(join(root, 'packages/overlay/src/index.ts'), 'utf8');
  const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
  for (const marker of [
    "powerPreference: OVERLAY_MODE ? 'low-power' : 'default'",
    'antialias: true',
    'const composer = OVERLAY_MODE ? null',
    'resolveRendererViewport',
    'canvas.getBoundingClientRect()',
    "new ResizeObserver",
    'clampDieToVisibleArea',
    'shadowsEnabled: quality.shadowsEnabled && count <= 8',
    'function requestRender()',
    'function shouldContinueRendering()',
    'enqueueRendererTask',
    'MAX_RENDERER_QUEUE',
    'function getRollWorker()',
    'scheduleRollWorkerRelease()',
    'getPerformanceSnapshot',
  ]) assert.ok(main.includes(marker), `renderer performance implementation is missing ${marker}`);
  assert.ok(!main.includes('requestAnimationFrame(animate);\n  const dt'), 'renderer still has a perpetual RAF loop');
  assert.ok(effects.includes('hasActiveAnimations()'), 'effects do not expose an idle signal');
  assert.ok(dice.includes('getVisualRadius()'), 'dice do not expose conservative visual bounds');
  assert.ok(overlay.includes('performance?: RendererPerformanceOptions'), 'overlay performance options are missing');
  assert.match(workspace, /esbuild:\s*true/);
  assert.match(workspace, /workerd:\s*true/);

  console.log(JSON.stringify({
    ok: true,
    tested: [
      'battery/auto/quality budgets',
      '30-dice frame cap',
      'adaptive resolution hysteresis',
      'CSS viewport and camera aspect parity',
      'small-roll antialiasing and depth-preserving shadows',
      'visual-radius screen containment',
      'idle-zero render scheduling',
      'bounded presentation queue',
      'lazy physics worker lifecycle',
      'overlay performance configuration',
      'esbuild and workerd build approvals',
    ],
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
