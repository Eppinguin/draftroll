import { performance } from 'node:perf_hooks';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'draftroll-sdk-benchmark-'));
const out = join(temp, 'build');
const config = join(temp, 'tsconfig.json');
const outputArg = process.argv.find((argument) => argument.startsWith('--output='));
const outputPath = outputArg ? resolve(root, outputArg.slice('--output='.length)) : null;
const iterations = readPositiveInteger('--iterations=', 1_000);

try {
  await writeFile(config, JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'CommonJS', moduleResolution: 'Node', rootDir: join(root, 'packages'), outDir: out,
      strict: true, skipLibCheck: true, esModuleInterop: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    },
    include: [join(root, 'packages/**/*.ts')],
  }, null, 2));
  const compile = runTsc(['-p', config], { cwd: root });
  if (compile.status !== 0) throw new Error(`${compile.stdout}\n${compile.stderr}`);
  await writeFile(join(out, 'package.json'), '{"type":"commonjs"}\n');

  const core = await import(pathToFileURL(join(out, 'core/src/index.js')).href);
  const themes = await import(pathToFileURL(join(out, 'themes/src/index.js')).href);
  const engine = new core.DiceEngine({ rng: new core.SeededRng('benchmark') });
  const compiled = engine.compile('4d6kh3 + 2d8e8 + 1d20');

  const parse = sample(iterations, () => engine.parse('4d6kh3 + 2d8e8 + 1d20'));
  const validate = sample(iterations, () => engine.validate('4d6kh3 + 2d8e8 + 1d20'));
  const evaluate = sample(iterations, () => compiled.roll());
  const updateBase = engine.roll('20d6');
  const update = sample(Math.min(iterations, 500), () => engine.reroll(updateBase, updateBase.dice[0].id));

  let themeCalls = 0;
  let assetCalls = 0;
  const upstream = {
    async getTheme() {
      themeCalls += 1;
      return {
        schemaVersion: 1, id: 'benchmark-theme', name: 'Benchmark', version: '1',
        material: { surfaceTexture: { src: 'benchmark.bin', mimeType: 'application/octet-stream' } },
      };
    },
    async getAsset() {
      assetCalls += 1;
      return new Uint8Array(256 * 1024).buffer;
    },
  };
  const cached = new themes.CachedThemeProvider(upstream);
  const firstThemeStarted = performance.now();
  await themes.prepareRuntimeTheme(cached, 'benchmark-theme');
  const firstThemeLoadMs = performance.now() - firstThemeStarted;
  const cachedThemeStarted = performance.now();
  await themes.prepareRuntimeTheme(cached, 'benchmark-theme');
  const cachedThemeLoadMs = performance.now() - cachedThemeStarted;

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    methodology: { iterations, warmupIterations: 100, clock: 'node:perf_hooks.performance.now' },
    operations: { parse, validate, evaluate, update },
    themeCache: {
      firstLoadMs: round(firstThemeLoadMs),
      cachedLoadMs: round(cachedThemeLoadMs),
      upstreamThemeCalls: themeCalls,
      upstreamAssetCalls: assetCalls,
      cacheHitVerified: themeCalls === 1 && assetCalls === 1,
    },
    notes: [
      'These are local CPU/API measurements, not network or WebGL measurements.',
      'Compare reports only when Node version, hardware, power state, and benchmark arguments are controlled.',
    ],
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json);
  }
  process.stdout.write(json);
} finally {
  await rm(temp, { recursive: true, force: true });
}

function sample(count, operation) {
  for (let index = 0; index < 100; index += 1) operation();
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    operation();
    values.push(performance.now() - started);
  }
  values.sort((left, right) => left - right);
  return {
    count,
    totalMs: round(values.reduce((sum, value) => sum + value, 0)),
    meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50Ms: round(percentile(values, 0.50)),
    p95Ms: round(percentile(values, 0.95)),
    p99Ms: round(percentile(values, 0.99)),
    maxMs: round(values.at(-1) ?? 0),
  };
}

function percentile(values, percentileValue) {
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * percentileValue) - 1))] ?? 0;
}

function readPositiveInteger(prefix, fallback) {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  const parsed = argument ? Number(argument.slice(prefix.length)) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100_000) throw new Error(`${prefix} must be an integer from 1 to 100000`);
  return parsed;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
