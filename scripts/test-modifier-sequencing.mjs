import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-modifier-sequence-'));
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
  const protocol = await import(pathToFileURL(join(outDir, 'protocol/src/index.js')).href);
  const { DraftrollRenderer } = await import(
    pathToFileURL(join(outDir, 'renderer/src/index.js')).href
  );
  const { Draftroll } = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);
  const { DiceEngine } = core;

  const rollWith = (expression, values) =>
    new DiceEngine({ rng: new SequenceRng(values) }).roll(expression);

  const shorthandExplosion = rollWith('2d4e', [4, 2, 4, 3]);
  assert.equal(shorthandExplosion.total, 13, 'bare e must explode on the maximum face');
  assert.deepEqual(
    shorthandExplosion.dice.map((die) => die.result),
    [4, 2, 4, 3],
  );
  assert.deepEqual(
    shorthandExplosion.dice.map((die) => die.generatedFromDieId),
    [undefined, undefined, 'die_1', 'die_3'],
  );
  assert.deepEqual(shorthandExplosion.operations[0].selector, { type: 'literal', target: 4 });

  const explosionWithModifier = rollWith('1d4e + 2', [3]);
  assert.equal(
    explosionWithModifier.total,
    5,
    'bare e must not consume the following arithmetic operator as a selector',
  );

  const explicitExplosion = rollWith('2d4e3', [3, 1, 2]);
  assert.equal(explicitExplosion.total, 6, 'explicit explosion selectors must remain supported');
  assert.equal(explicitExplosion.operations[0].selector.target, 3);

  const fateExplosion = rollWith('1dFe', [1, -1]);
  assert.equal(fateExplosion.total, 0, 'bare Fate explosion must use +1 as the maximum face');
  assert.deepEqual(
    fateExplosion.dice.map((die) => die.result),
    [1, -1],
  );

  const rerollOnce = rollWith('2d6ro<3', [1, 4, 2]);
  assert.equal(rerollOnce.total, 6);
  assert.deepEqual(
    rerollOnce.dice.map((die) => ({
      result: die.result,
      kept: die.kept,
      generatedBy: die.generatedBy,
      generatedFromDieId: die.generatedFromDieId,
    })),
    [
      { result: 1, kept: false, generatedBy: 'initial', generatedFromDieId: undefined },
      { result: 4, kept: true, generatedBy: 'initial', generatedFromDieId: undefined },
      { result: 2, kept: true, generatedBy: 'reroll', generatedFromDieId: 'die_1' },
    ],
    'reroll-once must preserve the visibly failed first result and add one replacement',
  );

  protocol.assertNormalizedRollResult(rerollOnce);

  const revisionEngine = new DiceEngine({ rng: new SequenceRng([2, 4, 5]) });
  const revisionBase = revisionEngine.roll('2d6');
  const rerollRevision = revisionEngine.update(revisionBase, {}, { reroll: ['die_1'] });
  assert.equal(
    rerollRevision.metadata.rerollRevision,
    rerollRevision.revision,
    'room-compatible reroll updates must identify the exact reroll revision',
  );
  assert.deepEqual(rerollRevision.metadata.rerolledDice, ['die_1']);
  const ordinaryRevision = revisionEngine.update(rerollRevision, { annotation: 'After reroll' });
  assert.notEqual(
    ordinaryRevision.metadata.rerollRevision,
    ordinaryRevision.revision,
    'later non-reroll revisions must not be mistaken for another physical reroll',
  );

  const externallyNormalizedReroll = core.normalizeExternalRoll({
    name: 'External reroll',
    expression: '2d6ro<3',
    total: rerollOnce.total,
    dice: rerollOnce.dice.map((die) => ({
      id: die.id,
      type: die.type,
      sides: die.sides,
      result: die.result,
      numericValue: die.numericValue,
      kept: die.kept,
      sourceRollIndex: die.sourceRollIndex,
      generatedBy: die.generatedBy,
      generatedFromDieId: die.generatedFromDieId,
    })),
  });
  assert.deepEqual(
    externallyNormalizedReroll.dice.map((die) => ({
      generatedBy: die.generatedBy,
      generatedFromDieId: die.generatedFromDieId,
    })),
    rerollOnce.dice.map((die) => ({
      generatedBy: die.generatedBy,
      generatedFromDieId: die.generatedFromDieId,
    })),
    'display-mode normalization must preserve modifier provenance for staged rendering',
  );
  protocol.assertNormalizedRollResult(externallyNormalizedReroll);

  const calls = [];
  const quantityCalls = [];
  const themeCalls = [];
  const pending = [];
  const lifecycle = [];
  const bridge = {
    roll(request) {
      calls.push(request);
      return new Promise((settle) =>
        pending.push(() =>
          settle({ results: request.results ?? [], total: 0, replay: { stage: calls.length } }),
        ),
      );
    },
    setDie() {},
    setQuantity(count) {
      quantityCalls.push(count);
    },
    setTheme(theme) {
      themeCalls.push(theme);
    },
    getThemes() {
      return [{ id: 'dragon', name: 'Wyrmfire' }];
    },
  };
  const renderer = new DraftrollRenderer({ bridge });
  renderer.on('started', () => lifecycle.push('started'));
  renderer.on('settled', () => lifecycle.push('settled'));
  renderer.on('completed', () => lifecycle.push('completed'));

  let presentationFinished = false;
  const presentation = renderer.playRoll(rerollOnce).then((completion) => {
    presentationFinished = true;
    return completion;
  });
  await waitFor(() => calls.length === 1);
  assert.deepEqual(
    calls[0].results,
    [1, 4],
    'the failed initial result must be physically rolled first',
  );
  assert.equal(calls[0].tableMode, 'replace');
  assert.equal(calls[0].context.modifierSequencePending, true);
  assert.equal(
    calls[0].context.normalizedTotal,
    undefined,
    'the final total must stay hidden before follow-up dice settle',
  );
  assert.deepEqual(calls[0].context.renderedDieIds, ['die_1', 'die_2']);
  assert.deepEqual(
    calls[0].context.renderedDice.map(({ id, kept, generatedBy }) => ({ id, kept, generatedBy })),
    [
      { id: 'die_1', kept: false, generatedBy: 'initial' },
      { id: 'die_2', kept: true, generatedBy: 'initial' },
    ],
    'the visual host receives enough state to label the visibly failed die as discarded',
  );
  assert.equal(presentationFinished, false);

  pending.shift()();
  await waitFor(() => calls.length === 2);
  assert.deepEqual(calls[1].results, [2], 'the replacement must be a separate follow-up throw');
  assert.equal(calls[1].tableMode, 'add');
  assert.equal(calls[1].context.modifierSequencePending, false);
  assert.equal(
    calls[1].context.normalizedTotal,
    6,
    'the full total is exposed only on the final stage',
  );
  assert.deepEqual(calls[1].context.renderedDieIds, ['die_3']);
  assert.deepEqual(
    calls[1].context.renderedDice.map(({ id, kept, generatedBy }) => ({ id, kept, generatedBy })),
    [
      { id: 'die_1', kept: false, generatedBy: 'initial' },
      { id: 'die_3', kept: true, generatedBy: 'reroll' },
    ],
    'follow-up context includes the discarded causal parent without rendering it twice',
  );
  assert.equal(presentationFinished, false);

  pending.shift()();
  const completion = await presentation;
  assert.deepEqual(
    quantityCalls,
    [2],
    'additive reroll stages must not call setQuantity because the browser bridge rebuilds the table',
  );
  assert.deepEqual(
    themeCalls,
    ['dragon'],
    'additive reroll stages must not retheme or rebuild settled dice',
  );
  assert.deepEqual(completion.results, [1, 4, 2]);
  assert.equal(completion.total, 6);
  assert.deepEqual(
    lifecycle,
    ['started', 'settled', 'completed'],
    'a modifier sequence remains one logical presentation',
  );

  const explosionCalls = [];
  const immediateBridge = {
    async roll(request) {
      explosionCalls.push(request);
      return { results: request.results ?? [], total: 0, replay: { stage: explosionCalls.length } };
    },
    setDie() {},
    setQuantity() {},
    setTheme() {},
    getThemes() {
      return [{ id: 'dragon', name: 'Wyrmfire' }];
    },
  };
  const explosionRenderer = new DraftrollRenderer({ bridge: immediateBridge });

  const sdkCalls = [];
  const sdkBridge = {
    async roll(request) {
      sdkCalls.push(request);
      return {
        results: request.results ?? [],
        total: Number(request.context?.normalizedTotal ?? 0),
        replay: { stage: sdkCalls.length },
      };
    },
    setDie() {},
    setQuantity() {},
    setTheme() {},
    clear() {},
    getThemes() {
      return [{ id: 'dragon', name: 'Wyrmfire' }];
    },
  };
  const sdkRenderer = new DraftrollRenderer({ bridge: sdkBridge });
  const sdk = new Draftroll({
    engine: new DiceEngine({ rng: new SequenceRng([2, 4, 5, 6, 3, 1, 2]) }),
    renderer: sdkRenderer,
  });
  const original = sdk.roll('2d6');
  await original.wait();
  const singleReroll = original.rerollDie('die_1');
  const singleCompletion = await singleReroll.wait();
  assert.deepEqual(
    sdkCalls.map((request) => request.results),
    [[2, 4], [5]],
    'an individual reroll must append only the replacement die',
  );
  assert.deepEqual(
    sdkCalls.map((request) => request.tableMode),
    ['replace', 'add'],
    'an individual reroll must preserve the existing table by default',
  );
  assert.equal(sdkCalls[1].context.modifierSequencePending, false);
  assert.deepEqual(sdkCalls[1].context.renderedDieIds.length, 1);
  const rerollState = new Map(sdkCalls[1].context.renderedDice.map((die) => [die.id, die]));
  assert.equal(
    rerollState.get('die_1').kept,
    false,
    'the previous physical die remains visible but is marked discarded',
  );
  assert.equal(rerollState.get('die_2').kept, true, 'untouched dice retain their logical state');
  const replacementState = sdkCalls[1].context.renderedDice.find(
    (die) => die.generatedBy === 'reroll',
  );
  assert.ok(replacementState, 'the appended physical die is identified as the reroll replacement');
  assert.equal(replacementState.generatedFromDieId, 'die_1');
  assert.deepEqual(
    singleCompletion.results,
    singleReroll.result.dice.map((die) => die.result),
    'presentation-only history must not leak into the logical completion',
  );
  assert.equal(singleCompletion.total, singleReroll.total);

  const repeatedReroll = singleReroll.rerollDie('die_1');
  await repeatedReroll.wait();
  assert.equal(sdkCalls[2].tableMode, 'add');
  assert.deepEqual(sdkCalls[2].results, [6]);
  const repeatedStates = sdkCalls[2].context.renderedDice.filter(
    (die) => die.id === 'die_1' || die.generatedBy === 'reroll',
  );
  assert.equal(
    repeatedStates.filter((die) => die.kept === false).length,
    2,
    'the original and prior replacement remain visible as discarded history',
  );
  assert.equal(
    repeatedStates.filter((die) => die.kept === true && die.generatedBy === 'reroll').length,
    1,
    'only the newest replacement remains active',
  );

  sdkRenderer.clear();
  const restoredReroll = repeatedReroll.rerollDie('die_1');
  await restoredReroll.wait();
  assert.equal(
    sdkCalls[3].tableMode,
    'replace',
    'after clear, a reroll safely falls back to a complete replacement presentation',
  );
  assert.deepEqual(
    sdkCalls[3].results,
    [3, 4],
    'the replacement fallback renders the complete logical result, not an orphaned die',
  );

  const rerollAfterFallback = restoredReroll.rerollDie('die_1');
  await rerollAfterFallback.wait();
  assert.equal(
    sdkCalls[4].tableMode,
    'add',
    'once the complete fallback is visible, later rerolls append normally again',
  );
  assert.deepEqual(sdkCalls[4].results, [1]);
  assert.equal(
    sdkCalls[4].context.renderedDice.length,
    3,
    'a replacement fallback resets hidden presentation history to the dice actually on screen',
  );

  const replacingReroll = rerollAfterFallback.rerollDie('die_1', {
    renderer: { preservePreviousDice: false },
  });
  await replacingReroll.wait();
  assert.equal(
    sdkCalls[5].tableMode,
    'replace',
    'hosts can explicitly opt out of persistent reroll history',
  );
  assert.deepEqual(sdkCalls[5].results, [2]);

  const retryCalls = [];
  let rejectNextAppend = true;
  const retryBridge = {
    async roll(request) {
      retryCalls.push(request);
      if (request.tableMode === 'add' && rejectNextAppend) {
        rejectNextAppend = false;
        throw new Error('Active table visual limit exceeded');
      }
      return {
        results: request.results ?? [],
        total: Number(request.context?.normalizedTotal ?? 0),
        replay: null,
      };
    },
    setDie() {},
    setQuantity() {},
    setTheme() {},
    clear() {},
    getThemes() {
      return [{ id: 'dragon', name: 'Wyrmfire' }];
    },
  };
  const retryRenderer = new DraftrollRenderer({ bridge: retryBridge });
  const retrySdk = new Draftroll({
    engine: new DiceEngine({ rng: new SequenceRng([2, 4, 5, 6]) }),
    renderer: retryRenderer,
  });
  const retryOriginal = retrySdk.roll('2d6');
  await retryOriginal.wait();
  const retriedReroll = retryOriginal.rerollDie('die_1');
  const retriedCompletion = await retriedReroll.wait();
  assert.deepEqual(
    retryCalls.map((request) => request.tableMode),
    ['replace', 'add', 'replace'],
    'a raced clear or full table must retry the revised roll as a complete replacement',
  );
  assert.deepEqual(retryCalls[2].results, [5, 4]);
  assert.equal(retriedCompletion.presentationMode, 'replace');
  const afterRetry = retriedReroll.rerollDie('die_1');
  await afterRetry.wait();
  assert.equal(
    retryCalls[3].tableMode,
    'add',
    'presentation history must recover after a replacement fallback',
  );
  assert.equal(retryCalls[3].context.renderedDice.length, 3);

  await explosionRenderer.playRoll(shorthandExplosion);
  assert.deepEqual(
    explosionCalls.map((request) => request.results),
    [[4, 2], [4], [3]],
    'recursive explosions must roll one causal wave at a time',
  );
  assert.deepEqual(
    explosionCalls.map((request) => request.tableMode),
    ['replace', 'add', 'add'],
  );
  assert.deepEqual(
    explosionCalls.map((request) => request.context.modifierSequencePending),
    [true, true, false],
  );

  explosionCalls.length = 0;
  await explosionRenderer.playRoll(fateExplosion);
  assert.deepEqual(
    explosionCalls.map((request) => request.fallbacks?.map((fallback) => fallback.result)),
    [[1], [-1]],
    'fallback-only explosions must also preserve prior visuals and append causal waves',
  );
  assert.deepEqual(
    explosionCalls.map((request) => request.tableMode),
    ['replace', 'add'],
  );

  explosionCalls.length = 0;
  await explosionRenderer.playRoll(externallyNormalizedReroll);
  assert.deepEqual(
    explosionCalls.map((request) => request.results),
    [[1, 4], [2]],
    'external/display rolls must retain causal staging',
  );

  explosionCalls.length = 0;
  await explosionRenderer.playRoll(rerollOnce, { table: { mode: 'concurrent' } });
  assert.deepEqual(
    explosionCalls.map((request) => request.tableMode),
    ['add', 'add'],
    'concurrent modifier sequences must append every stage to the active table',
  );

  explosionCalls.length = 0;
  await explosionRenderer.playRoll(rerollOnce, {
    elapsedMs: 120,
    animationDurationMs: 2_800,
    startTime: Date.now() - 120,
  });
  assert.deepEqual(
    explosionCalls.map((request) => request.results),
    [[1, 4], [2]],
    'ordinary realtime latency must not collapse rerolls into one constrained-looking throw',
  );
  assert.equal(
    explosionCalls[0].seekToMs,
    120,
    'the synchronized initial wave may seek to its current progress',
  );
  assert.equal(
    explosionCalls[1].seekToMs,
    0,
    'a follow-up die starts a fresh throw after its source wave settles',
  );
  assert.equal(
    explosionCalls[1].startAtMs,
    undefined,
    'follow-up waves must not reuse the already-past authoritative start time',
  );
  assert.notEqual(
    explosionCalls[0].seed,
    explosionCalls[1].seed,
    'each generated wave gets a deterministic stage-specific launch seed',
  );

  explosionCalls.length = 0;
  await explosionRenderer.playRoll(rerollOnce, { elapsedMs: 2_500, animationDurationMs: 2_800 });
  assert.deepEqual(
    explosionCalls.map((request) => request.results),
    [[1, 4, 2]],
    'events already beyond the settled threshold may catch up directly to their final state',
  );

  explosionCalls.length = 0;
  await explosionRenderer.playRoll(shorthandExplosion, { modifierSequence: 'simultaneous' });
  assert.deepEqual(
    explosionCalls.map((request) => request.results),
    [[4, 2, 4, 3]],
    'hosts can opt into the legacy simultaneous presentation',
  );

  const rendererSource = await readFile(
    join(projectRoot, 'packages/renderer/src/index.ts'),
    'utf8',
  );
  assert.match(
    rendererSource,
    /numericResults\.length > 0 && presentationMode === 'replace'/,
    'additive stages must bypass bridge setters that rebuild the table',
  );
  const browserHostSource = await readFile(join(projectRoot, 'src/main.ts'), 'utf8');
  assert.match(browserHostSource, /modifierSequencePending/);
  assert.match(browserHostSource, /\(discarded\)/);
  assert.match(browserHostSource, /\(reroll\)/);
  assert.match(browserHostSource, /\(explosion\)/);
  assert.match(browserHostSource, /function mergeTableRollGroups/);
  assert.match(
    browserHostSource,
    /entry\.groupId === addition\.groupId/,
    'repeated rerolls must remain in one logical table group',
  );
  assert.match(
    browserHostSource,
    /incomingTableRolls\(activeContext, 0, physicalStart, 0, fallbackStart\)/,
    'the original visible dice must be included in the persistent logical group',
  );
  assert.match(
    browserHostSource,
    /function mergeRenderedDiceState/,
    'repeated state updates must replace prior context entries instead of duplicating them',
  );
  assert.match(
    browserHostSource,
    /dice\.length === 0 && activeFallbackSpecs\.length === 0/,
    'fallback-only modifier chains must remain appendable',
  );
  assert.match(
    browserHostSource,
    /createStaticTablePlan/,
    'fallback-only follow-up waves must keep prior visuals static',
  );
  const overlaySource = await readFile(join(projectRoot, 'packages/overlay/src/index.ts'), 'utf8');
  assert.match(
    overlaySource,
    /preservePreviousDice: options\.preservePreviousDice/,
    'iframe overlays must forward persistent-table intent',
  );
  assert.ok(
    overlaySource.indexOf('const generation = ++this.presentationGeneration') <
      overlaySource.indexOf('await this.mount(options.signal)'),
    'a presentation must synchronously cancel deferred pointer dismissal before any mount or theme await',
  );
  assert.match(
    overlaySource,
    /Results hidden until all dice settle/,
    'the overlay result panel must not disclose future modifier dice while rolling',
  );
  assert.match(
    overlaySource,
    /stateDieIds: options\.stateDieIds/,
    'iframe overlays must forward prior die-state updates',
  );
  assert.match(
    overlaySource,
    /replaceFallbackResult: options\.replaceFallbackResult/,
    'iframe overlays must forward the safe full-result fallback',
  );
  const overlayRuntimeSource = await readFile(join(projectRoot, 'src/overlay.ts'), 'utf8');
  assert.match(
    overlayRuntimeSource,
    /\.\.\.message\.options/,
    'the iframe runtime must pass serialized persistence options to the renderer',
  );
  const demoSource = await readFile(join(projectRoot, 'src/sdk-demo.ts'), 'utf8');
  assert.match(
    demoSource,
    /Results hidden until all dice settle/,
    'the demo roll log must not reveal the final modifier die count before settlement',
  );
  const fallbackVisualSource = await readFile(join(projectRoot, 'src/fallback-visuals.ts'), 'utf8');
  assert.match(fallbackVisualSource, /private settled = false/);
  assert.match(
    fallbackVisualSource,
    /if \(this\.settled\) return/,
    'settled fallback visuals must remain fixed while later waves animate',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        shorthandExplosion: shorthandExplosion.dice.map((die) => die.result),
        rerollStages: calls.map((request) => request.results),
        explosionStages: [[4, 2], [4], [3]],
        individualRerollStages: sdkCalls.map((request) => request.results),
        lifecycle,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((settle) => setTimeout(settle, 0));
  }
  throw new Error('Timed out waiting for test condition');
}
