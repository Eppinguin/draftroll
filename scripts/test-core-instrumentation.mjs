import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-instrumentation-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

class SequenceRng {
  constructor(values) {
    this.values = [...values];
  }
  integer(min, max) {
    const value = this.values.shift();
    if (value === undefined) throw new Error(`Sequence RNG exhausted for ${min}..${max}`);
    if (value < min || value > max)
      throw new Error(`Sequence value ${value} outside ${min}..${max}`);
    return value;
  }
}

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

  const core = await import(pathToFileURL(join(outDir, 'core/src/index.js')).href);
  const sdk = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);
  const { DiceEngine, DiceLimitError, parseDiceExpression } = core;
  const { Draftroll } = sdk;

  const profiles = [];
  let clock = 10;
  const instrumentation = {
    now: () => (clock += 0.25),
    onProfile: (profile) => profiles.push(profile),
  };
  const engine = new DiceEngine({ instrumentation });

  const first = engine.roll('2d6rr<3 + 1', { rng: new SequenceRng([1, 2, 4, 5]) });
  assert.equal(first.total, 10);
  assert.equal(profiles.length, 2);

  const parseMiss = profiles[0];
  assert.equal(parseMiss.kind, 'parse');
  assert.equal(parseMiss.status, 'success');
  assert.equal(parseMiss.cache, 'miss');
  assert.equal(parseMiss.dialect, 'd20');
  assert.equal(parseMiss.sourceLength, 11);
  assert.equal(parseMiss.expressionLength, 11);
  assert.equal(parseMiss.astNodes, 3);
  assert.equal(parseMiss.maxAstDepth, 2);
  assert.equal(parseMiss.diceNodes, 1);
  assert.equal(parseMiss.initialDice, 2);
  assert.equal(parseMiss.modifiers, 1);
  assert.equal(parseMiss.annotations, 0);
  assert.equal(parseMiss.durationMs, 0.25);
  assert.ok(Object.isFrozen(parseMiss));

  const evaluate = profiles[1];
  assert.equal(evaluate.kind, 'evaluate');
  assert.equal(evaluate.status, 'success');
  assert.equal(evaluate.mode, 'expression');
  assert.equal(evaluate.initialDice, 2);
  assert.equal(evaluate.generatedDice, 2);
  assert.equal(evaluate.resultDice, 4);
  assert.equal(evaluate.astNodesVisited, 3);
  assert.equal(evaluate.evaluationSteps, 4);
  assert.equal(evaluate.modifiersApplied, 1);
  assert.equal(evaluate.rerolls, 2);
  assert.equal(evaluate.explosions, 0);
  assert.equal(evaluate.durationMs, 0.25);

  engine.roll('2d6rr<3 + 1', { rng: new SequenceRng([3, 4]) });
  assert.equal(profiles[2].kind, 'parse');
  assert.equal(profiles[2].cache, 'hit');
  assert.equal(profiles[3].kind, 'evaluate');
  assert.equal(profiles[3].generatedDice, 0);

  const invalid = engine.validate('2d6kh');
  assert.equal(invalid.valid, false);
  const parseError = profiles.at(-1);
  assert.equal(parseError.kind, 'parse');
  assert.equal(parseError.status, 'error');
  assert.equal(parseError.cache, 'miss');
  assert.equal(parseError.error.name, 'DiceSyntaxError');
  assert.equal(typeof parseError.error.code, 'string');

  const directProfiles = [];
  parseDiceExpression('1d8 [cold]', undefined, {
    instrumentation: { onProfile: (profile) => directProfiles.push(profile) },
  });
  assert.equal(directProfiles.length, 1);
  assert.equal(directProfiles[0].kind, 'parse');
  assert.equal(directProfiles[0].cache, 'bypass');
  assert.equal(directProfiles[0].annotations, 1);

  const structuredProfiles = [];
  const structured = new DiceEngine().evaluate(
    {
      mode: 'evaluate',
      dice: [
        { id: 'a', type: 'd6', result: 1 },
        { id: 'b', type: 'd6', result: 6 },
      ],
      operations: [{ type: 'reroll-once', comparator: '<', target: 3 }],
    },
    {
      rng: new SequenceRng([4]),
      instrumentation: { onProfile: (profile) => structuredProfiles.push(profile) },
    },
  );
  assert.equal(structured.total, 10);
  assert.equal(structuredProfiles.length, 1);
  assert.deepEqual(
    {
      kind: structuredProfiles[0].kind,
      status: structuredProfiles[0].status,
      mode: structuredProfiles[0].mode,
      initialDice: structuredProfiles[0].initialDice,
      generatedDice: structuredProfiles[0].generatedDice,
      resultDice: structuredProfiles[0].resultDice,
      evaluationSteps: structuredProfiles[0].evaluationSteps,
      modifiersApplied: structuredProfiles[0].modifiersApplied,
      rerolls: structuredProfiles[0].rerolls,
    },
    {
      kind: 'evaluate',
      status: 'success',
      mode: 'structured',
      initialDice: 2,
      generatedDice: 1,
      resultDice: 3,
      evaluationSteps: 1,
      modifiersApplied: 1,
      rerolls: 1,
    },
  );

  const failedProfiles = [];
  const limited = new DiceEngine({
    limits: { maxOperations: 1 },
    instrumentation: { onProfile: (profile) => failedProfiles.push(profile) },
  });
  assert.throws(() => limited.roll('1 + 2'), DiceLimitError);
  assert.equal(failedProfiles.length, 2);
  assert.equal(failedProfiles[0].kind, 'parse');
  assert.equal(failedProfiles[1].kind, 'evaluate');
  assert.equal(failedProfiles[1].status, 'error');
  assert.equal(failedProfiles[1].error.name, 'DiceLimitError');
  assert.equal(failedProfiles[1].evaluationSteps, 2);

  const compiledProfiles = [];
  const compiledEngine = new DiceEngine({
    instrumentation: { onProfile: (profile) => compiledProfiles.push(profile) },
  });
  const compiled = compiledEngine.compile('1d4 + 2');
  compiled.roll({ rng: new SequenceRng([3]) });
  assert.deepEqual(
    compiledProfiles.map((profile) => profile.kind),
    ['parse', 'evaluate'],
  );

  const sdkProfiles = [];
  const draftroll = new Draftroll({
    instrumentation: { onProfile: (profile) => sdkProfiles.push(profile) },
  });
  draftroll.roll('1d6', { render: false, rng: new SequenceRng([5]) });
  assert.deepEqual(
    sdkProfiles.map((profile) => profile.kind),
    ['parse', 'evaluate'],
  );

  const structuredSdkProfiles = [];
  new Draftroll().rollDice({
    dice: [{ id: 'sdk_die', type: 'd6' }],
    rng: new SequenceRng([2]),
    render: false,
    instrumentation: { onProfile: (profile) => structuredSdkProfiles.push(profile) },
  });
  assert.equal(structuredSdkProfiles.length, 1);
  assert.equal(structuredSdkProfiles[0].mode, 'structured');

  const observerFailureEngine = new DiceEngine({
    instrumentation: {
      now: () => {
        throw new Error('clock failed');
      },
      onProfile: () => {
        throw new Error('observer failed');
      },
    },
  });
  assert.equal(observerFailureEngine.roll('1d6', { rng: new SequenceRng([6]) }).total, 6);

  console.log('core instrumentation tests passed');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
