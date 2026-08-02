import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname);
const temp = await mkdtemp(join(tmpdir(), 'draftroll-completion-api-'));
const out = join(temp, 'build');
const config = join(temp, 'tsconfig.json');

try {
  await writeFile(
    config,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          rootDir: join(root, 'packages'),
          outDir: out,
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        },
        include: [join(root, 'packages/**/*.ts')],
      },
      null,
      2,
    ),
  );
  const compile = runTsc(['-p', config], { cwd: root });
  if (compile.status !== 0) throw new Error(`${compile.stdout}\n${compile.stderr}`);
  await writeFile(join(out, 'package.json'), '{"type":"commonjs"}\n');

  const errors = await load('errors/src/index.js');
  const rendererModule = await load('renderer/src/index.js');
  const sdk = await load('sdk/src/index.js');
  const protocol = await load('protocol/src/index.js');
  const reactModule = await load('react/src/index.js');
  const vueModule = await load('vue/src/index.js');
  const svelteModule = await load('svelte/src/index.js');

  const aborted = new AbortController();
  aborted.abort('test-cancel');
  assert.throws(
    () => errors.throwIfAborted(aborted.signal, 'Completion test'),
    (error) => {
      assert.equal(error.code, errors.DRAFTROLL_ERROR_CODES.aborted);
      assert.equal(error.recoverable, true);
      return true;
    },
  );
  await assert.rejects(
    errors.raceWithAbort(new Promise(() => undefined), aborted.signal, 'Race test'),
    (error) => error instanceof errors.DraftrollAbortError,
  );

  const result = {
    schemaVersion: 1,
    rollId: 'completion-roll',
    sequence: 1,
    revision: 0,
    authority: 'local',
    expression: '1d6',
    total: 6,
    dice: [{ id: 'die-1', type: 'd6', sides: 6, result: 6, kept: true, generatedBy: 'initial' }],
    operations: [],
    createdAt: new Date(0).toISOString(),
    metadata: { participantId: 'player-a' },
  };

  const lifecycle = [];
  const presented = [];
  const text = new rendererModule.DraftrollTextRenderer({
    present: async (value) => presented.push(value.rollId),
  });
  for (const event of [
    'loading',
    'started',
    'settled',
    'completed',
    'paused',
    'resumed',
    'dissolveStarted',
    'dissolveFinished',
    'cleared',
  ]) {
    text.on(event, () => lifecycle.push(event));
  }
  text.on('completed', () => {
    throw new Error('observer failure');
  });
  assert.equal((await text.playRoll(result)).total, 6);
  assert.deepEqual(presented, ['completion-roll']);
  assert.deepEqual(lifecycle.slice(0, 4), ['loading', 'started', 'settled', 'completed']);
  text.pause();
  await assert.rejects(
    text.playRoll(result),
    (error) => error.code === errors.DRAFTROLL_ERROR_CODES.invalidState,
  );
  text.resume();
  text.setParticipantFilter(['player-b']);
  await text.playRoll(result);
  assert.deepEqual(presented, ['completion-roll'], 'participant filter must suppress presentation');
  await text.dismiss();
  assert.ok(lifecycle.includes('dissolveStarted'));
  assert.ok(lifecycle.includes('dissolveFinished'));

  const bridgeCalls = [];
  const bridge = {
    async roll(request) {
      bridgeCalls.push(['roll', request]);
      return { results: request.results ?? [], total: 4, replay: { ok: true } };
    },
    setDie(value) {
      bridgeCalls.push(['setDie', value]);
    },
    setQuantity(value) {
      bridgeCalls.push(['setQuantity', value]);
    },
    setTheme(value) {
      bridgeCalls.push(['setTheme', value]);
    },
    getThemes() {
      return [{ id: 'dragon', name: 'Dragon' }];
    },
    pause() {
      bridgeCalls.push(['pause']);
    },
    resume() {
      bridgeCalls.push(['resume']);
    },
    screenshot() {
      bridgeCalls.push(['screenshot']);
      return Promise.resolve('data:image/png;base64,test');
    },
    configureCamera(value) {
      bridgeCalls.push(['camera', value]);
    },
    resetCamera() {
      bridgeCalls.push(['resetCamera']);
    },
    configureInteractions(value) {
      bridgeCalls.push(['interactions', value]);
    },
  };
  const renderer = new rendererModule.DraftrollRenderer({ bridge });
  const symbolic = {
    ...result,
    rollId: 'symbolic-roll',
    expression: undefined,
    total: 2,
    customDice: [
      {
        id: 'weather',
        renderAs: 'd6',
        faces: Array.from({ length: 6 }, (_, index) => ({
          result: `symbol-${index}`,
          value: index % 3,
        })),
      },
    ],
    dice: [
      {
        id: 'weather-die',
        type: 'weather',
        customDiceId: 'weather',
        result: 'symbol-4',
        numericValue: 1,
        faceIndex: 4,
        kept: true,
        generatedBy: 'initial',
        physics: { sizeScale: 1.2, massScale: 1.5, inertiaScale: 0.8 },
      },
    ],
  };
  const symbolicCompletion = await renderer.playRoll(symbolic, { physicsPreset: 'heavy' });
  assert.equal(symbolicCompletion.total, 2);
  const request = bridgeCalls.find(([name]) => name === 'roll')[1];
  assert.deepEqual(request.results, [5]);
  assert.deepEqual(request.kinds, ['d6']);
  assert.deepEqual(request.physics, [{ sizeScale: 1.2, massScale: 1.5, inertiaScale: 0.8 }]);
  assert.equal(request.physicsPreset, 'heavy');
  await renderer.pause();
  await renderer.resume();
  assert.equal(await renderer.screenshot(), 'data:image/png;base64,test');
  await renderer.configureCamera({ yaw: 0.2, pitch: 0.8, zoom: 1.1, autoRotate: false });
  await renderer.resetCamera();
  await renderer.configureInteractions({ click: 'reroll', draggable: true });
  assert.ok(bridgeCalls.some(([name]) => name === 'pause'));
  assert.ok(bridgeCalls.some(([name]) => name === 'resume'));
  assert.ok(bridgeCalls.some(([name]) => name === 'camera'));
  assert.ok(bridgeCalls.some(([name]) => name === 'resetCamera'));
  assert.ok(bridgeCalls.some(([name]) => name === 'interactions'));

  const bulkDecoded = protocol.decodeClientToServerEvent(
    {
      type: 'bulk_update_rolls',
      requestId: 'batch-1',
      updates: [
        {
          rollId: 'roll-a',
          update: { annotation: 'corrected' },
          expectedRevision: 1,
          audit: { reason: 'GM ruling', label: 'correction' },
        },
      ],
    },
    { rejectUnknownFields: true },
  );
  assert.equal(bulkDecoded.success, true);
  const policy = protocol.createRoomPolicy('open-table');
  assert.equal(policy.renderer.physicsPreset, 'standard');
  const readinessDecoded = protocol.decodeRoomPolicy({
    ...policy,
    renderer: { ...policy.renderer, requireRendererReady: true, readinessTimeoutMs: 5000 },
  });
  if (!readinessDecoded.success) console.error(JSON.stringify(readinessDecoded.error, null, 2));
  assert.equal(readinessDecoded.success, true);

  const session = new sdk.DraftrollSession();
  session.on('roll', () => {
    throw new Error('application observer failure');
  });
  const local = await session.roll('1d1');
  assert.equal(local.total, 1, 'observer exceptions must not alter roll completion');

  const React = createFakeReactRuntime();
  const bindings = reactModule.createDraftrollReactBindings(React.runtime);
  bindings.DraftrollContext._defaultValue = session;
  assert.equal(bindings.useDraftrollSession(), session);
  assert.equal(bindings.useDraftrollSnapshot().status, 'local');
  assert.ok(Array.isArray(bindings.useDraftrollRolls()));
  assert.equal(bindings.useDraftrollRoll(local.id).id, local.id);
  bindings.DraftrollProvider({ session, children: 'child' });
  assert.equal(React.elements.at(-1).props.value, session);

  const scopeDisposers = [];
  const Vue = {
    shallowRef(value) {
      return { value };
    },
    readonly(value) {
      return value;
    },
    onScopeDispose(cleanup) {
      scopeDisposers.push(cleanup);
    },
  };
  const vueState = vueModule.useDraftroll(Vue, session);
  assert.equal(vueState.snapshot.value.status, 'local');
  assert.ok(vueState.rolls.value.length >= 1);
  scopeDisposers.forEach((dispose) => dispose());

  const svelteValues = [];
  const unsubscribe = svelteModule
    .createDraftrollStore(session)
    .subscribe((value) => svelteValues.push(value));
  assert.equal(svelteValues[0].session.status, 'local');
  unsubscribe();
  await session.dispose();

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          'stable shared errors and AbortSignal cancellation',
          'text renderer lifecycle, filtering, pause/resume, and observer isolation',
          'renderer controls and symbolic custom-face physical mapping',
          'per-die physics and room physics preset propagation',
          'bulk/audit/readiness protocol validation',
          'React, Vue, and Svelte generic binding contracts',
          'SDK observer isolation',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

function load(relative) {
  return import(pathToFileURL(join(out, relative)).href);
}

function createFakeReactRuntime() {
  const elements = [];
  return {
    elements,
    runtime: {
      createContext(defaultValue) {
        return { Provider: Symbol('Provider'), _defaultValue: defaultValue };
      },
      createElement(type, props, ...children) {
        const value = { type, props, children };
        elements.push(value);
        return value;
      },
      useContext(context) {
        return context._defaultValue;
      },
      useMemo(factory) {
        return factory();
      },
      useEffect(effect) {
        effect();
      },
      useSyncExternalStore(subscribe, getSnapshot) {
        const stop = subscribe(() => undefined);
        const snapshot = getSnapshot();
        stop();
        return snapshot;
      },
    },
  };
}
