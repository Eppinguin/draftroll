import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runTsc } from './lib/load-typescript.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-state-isolation-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

try {
  await writeFile(
    configPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          rootDir: join(projectRoot, 'packages'),
          outDir,
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        },
        include: [join(projectRoot, 'packages/**/*.ts')],
      },
      null,
      2,
    ),
  );

  const compile = runTsc(['-p', configPath], { cwd: projectRoot });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const sdk = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);
  const { Draftroll } = sdk;

  const draftroll = new Draftroll();
  const roll = draftroll.roll('1d1', { render: false });
  const rollId = roll.id;
  const dieId = roll.dice[0].id;

  // The response is a detached public snapshot. Mutating it must never alter retained state.
  roll.result.total = 999;
  roll.result.dice[0].result = 999;
  assert.equal(draftroll.getRoll(rollId).total, 1);
  assert.equal(draftroll.getRoll(rollId).dice[0].result, 1);

  // Every public history accessor returns detached data, not aliases into internal maps.
  const logSnapshot = draftroll.rollLog[0];
  logSnapshot.total = 777;
  logSnapshot.dice[0].result = 777;
  assert.equal(draftroll.getRoll(rollId).total, 1);
  assert.equal(draftroll.getRoll(rollId).dice[0].result, 1);

  const revisionSnapshot = draftroll.getRollRevisions(rollId)[0];
  revisionSnapshot.total = 555;
  assert.equal(draftroll.getRollRevisions(rollId)[0].total, 1);

  const lastSnapshot = draftroll.lastResult;
  assert.ok(lastSnapshot);
  lastSnapshot.total = 333;
  assert.equal(draftroll.lastResult.total, 1);

  const directSnapshot = draftroll.getRoll(rollId);
  assert.ok(directSnapshot);
  directSnapshot.total = 222;
  assert.equal(draftroll.getRoll(rollId).total, 1);

  // Handle methods close over the private canonical result, not the mutable public snapshot.
  const revision = roll.setDieResult(dieId, 1, { mode: 'log-only' });
  assert.equal(revision.total, 1);
  assert.equal(revision.result.dice[0].result, 1);
  assert.equal(revision.result.revision, 1);
  assert.equal(draftroll.getRoll(rollId).revision, 1);

  // A returned revision is detached as well.
  revision.result.total = 444;
  assert.equal(draftroll.getRoll(rollId).total, 1);

  console.log('SDK public state isolation passed.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
