import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-runtime-validation-'));
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
        include: [
          join(projectRoot, 'packages/protocol/**/*.ts'),
          join(projectRoot, 'packages/core/**/*.ts'),
        ],
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

  const protocol = await import(pathToFileURL(join(outDir, 'protocol/src/index.js')).href);
  const core = await import(pathToFileURL(join(outDir, 'core/src/index.js')).href);
  const {
    DRAFTROLL_RESULT_SCHEMA_VERSION,
    decodeClientToServerEvent,
    decodeNormalizedRollResult,
    decodeRoomPolicy,
    decodeRoomPolicyPatch,
    createRoomPolicy,
    applyRoomPolicyPatch,
    decodeServerToClientEvent,
    negotiateProtocolVersion,
    parseRuntimeJson,
  } = protocol;
  const { DiceEngine } = core;

  const engine = new DiceEngine({ rng: { integer: (minimum) => minimum } });
  const result = engine.roll('1d20+5');
  assert.equal(result.schemaVersion, DRAFTROLL_RESULT_SCHEMA_VERSION);
  assert.equal(decodeNormalizedRollResult(result).success, true);

  const legacy = { ...result };
  delete legacy.schemaVersion;
  const migrated = decodeNormalizedRollResult(legacy, { allowLegacyResults: true });
  assert.equal(migrated.success, true);
  assert.equal(migrated.data.schemaVersion, DRAFTROLL_RESULT_SCHEMA_VERSION);

  const invalidDie = structuredClone(result);
  invalidDie.dice[0].kept = 'yes';
  const invalidResult = decodeNormalizedRollResult(invalidDie);
  assert.equal(invalidResult.success, false);
  assert.ok(invalidResult.error.issues.some((entry) => entry.path.endsWith('.kept')));

  const validCommand = decodeClientToServerEvent(
    {
      type: 'roll_request',
      requestId: 'request-1',
      input: { mode: 'evaluate', expression: '2d6+3' },
      visibility: { type: 'roller' },
    },
    { rejectUnknownFields: true },
  );
  assert.equal(validCommand.success, true);

  const unknownField = decodeClientToServerEvent(
    {
      type: 'client_ready',
      rendererReady: true,
      themesReady: true,
      surprise: true,
    },
    { rejectUnknownFields: true },
  );
  assert.equal(unknownField.success, false);
  assert.ok(unknownField.error.issues.some((entry) => entry.code === 'unknown_field'));

  const deepMetadata = {};
  let cursor = deepMetadata;
  for (let index = 0; index < 12; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  const deepCommand = decodeClientToServerEvent({
    type: 'participant_update',
    metadata: deepMetadata,
  });
  assert.equal(deepCommand.success, false);
  assert.ok(deepCommand.error.issues.some((entry) => entry.code === 'limit_exceeded'));

  const tooLarge = parseRuntimeJson(JSON.stringify({ payload: 'x'.repeat(2_000) }), {
    maximumBytes: 128,
  });
  assert.equal(tooLarge.success, false);
  assert.equal(tooLarge.error.issues[0].code, 'payload_too_large');

  const unsupported = negotiateProtocolVersion(99);
  assert.equal(unsupported.success, false);
  assert.equal(unsupported.error.issues[0].code, 'unsupported_protocol_version');

  const roomPolicy = createRoomPolicy('moderated-public-room');
  assert.equal(decodeRoomPolicy(roomPolicy).success, true);
  const policyPatch = decodeRoomPolicyPatch({
    limits: { maximumParticipants: 24 },
    authorization: { allowWhispers: true },
  });
  assert.equal(policyPatch.success, true);
  const patchedPolicy = applyRoomPolicyPatch(roomPolicy, policyPatch.data);
  assert.equal(patchedPolicy.preset, 'custom');
  assert.equal(patchedPolicy.limits.maximumParticipants, 24);
  assert.equal(patchedPolicy.authorization.allowWhispers, true);
  const invalidPolicy = decodeRoomPolicyPatch({ limits: { maximumParticipants: 0 } });
  assert.equal(invalidPolicy.success, false);
  assert.ok(
    invalidPolicy.error.issues.some((entry) => entry.path.endsWith('.maximumParticipants')),
  );

  const hiddenLeak = decodeServerToClientEvent(
    {
      type: 'roll_start',
      protocolVersion: 2,
      roomId: 'table',
      eventSequence: 1,
      rollId: 'roll-1',
      sequence: 1,
      actor: { participantId: 'a', sessionId: 's', name: 'A', roles: [] },
      visibility: { type: 'hidden' },
      hidden: true,
      summary: {
        rollId: 'roll-1',
        sequence: 1,
        revision: 0,
        actor: { participantId: 'a', sessionId: 's', name: 'A', roles: [] },
        createdAt: result.createdAt,
      },
      result,
    },
    { rejectUnknownFields: true },
  );
  assert.equal(hiddenLeak.success, false);
  assert.ok(
    hiddenLeak.error.issues.some((entry) => entry.message.includes('must not contain a result')),
  );

  // Deterministic malformed-payload corpus. Validators must reject safely and never throw.
  let state = 0x12345678;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const randomValue = (depth = 0) => {
    const choice = Math.floor(random() * (depth > 3 ? 5 : 8));
    if (choice === 0) return null;
    if (choice === 1) return random() < 0.5;
    if (choice === 2) return (random() - 0.5) * 1e9;
    if (choice === 3) return `v-${Math.floor(random() * 10000)}`;
    if (choice === 4) return undefined;
    if (choice === 5)
      return Array.from({ length: Math.floor(random() * 5) }, () => randomValue(depth + 1));
    const object = {};
    for (let index = 0; index < Math.floor(random() * 5); index += 1)
      object[`k${index}`] = randomValue(depth + 1);
    return object;
  };
  for (let index = 0; index < 500; index += 1) {
    const value = randomValue();
    assert.doesNotThrow(() => decodeClientToServerEvent(value, { rejectUnknownFields: true }));
    assert.doesNotThrow(() => decodeServerToClientEvent(value, { rejectUnknownFields: true }));
    assert.doesNotThrow(() => decodeNormalizedRollResult(value));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: [
          'normalized-result schema version and legacy migration',
          'strict client and server event decoding',
          'unknown-field rejection',
          'metadata depth and payload limits',
          'protocol-version negotiation',
          'room-policy presets, patches, and limits',
          'hidden-result leak rejection',
          '500 deterministic malformed payloads',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
