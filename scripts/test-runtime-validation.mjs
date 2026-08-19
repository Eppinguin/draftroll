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

function callWithoutThrow(callback) {
  let value;
  assert.doesNotThrow(() => {
    value = callback();
  });
  return value;
}

function assertIssue(decoded, code, path) {
  assert.equal(decoded.success, false);
  assert.ok(
    decoded.error.issues.some(
      (entry) => entry.code === code && (path === undefined || entry.path === path),
    ),
  );
}

function createRevokedProxy() {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

function roomStateRollSlots(roomState) {
  return [
    ['$.recentEvents.0', roomState.recentEvents[0]],
    ['$.recentRolls.0', roomState.recentRolls[0]],
    ['$.recentRoll', roomState.recentRoll],
  ];
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
    DRAFTROLL_PROTOCOL_VERSION,
    DRAFTROLL_RESULT_SCHEMA_VERSION,
    decodeClientToServerEvent,
    decodeCustomDiceDefinitions,
    decodeNormalizedRollResult,
    decodeRoomPolicy,
    decodeRoomPolicyPatch,
    createRoomPolicy,
    applyRoomPolicyPatch,
    decodeServerToClientEvent,
    isNormalizedRollResult,
    isServerToClientEvent,
    negotiateProtocolVersion,
    parseRuntimeJson,
  } = protocol;
  const { DiceEngine, evaluateParsedExpression } = core;

  const engine = new DiceEngine({ rng: { integer: (minimum) => minimum } });
  const result = engine.roll('1d20+5');
  assert.equal(result.schemaVersion, DRAFTROLL_RESULT_SCHEMA_VERSION);
  assert.equal(decodeNormalizedRollResult(result).success, true);
  assert.equal(isNormalizedRollResult(result), true);

  const legacy = { ...result };
  delete legacy.schemaVersion;
  const migrated = decodeNormalizedRollResult(legacy, { allowLegacyResults: true });
  assert.equal(migrated.success, true);
  assert.equal(migrated.data.schemaVersion, DRAFTROLL_RESULT_SCHEMA_VERSION);
  assert.equal(Object.hasOwn(legacy, 'schemaVersion'), false);

  const strictLegacy = decodeNormalizedRollResult(legacy, { allowLegacyResults: false });
  assertIssue(strictLegacy, 'invalid_result_schema_version', '$.schemaVersion');
  assert.equal(isNormalizedRollResult(legacy), false);
  assert.equal(Object.hasOwn(legacy, 'schemaVersion'), false);

  const nonCloneableArray = [() => {}];
  const nonCloneableArrayDecode = callWithoutThrow(() =>
    decodeNormalizedRollResult(nonCloneableArray),
  );
  assert.equal(nonCloneableArrayDecode.success, false);
  assert.equal(callWithoutThrow(() => isNormalizedRollResult(nonCloneableArray)), false);

  const nonCloneableResult = {
    ...result,
    metadata: { callback: () => {} },
  };
  const nonCloneableResultDecode = callWithoutThrow(() =>
    decodeNormalizedRollResult(nonCloneableResult),
  );
  assertIssue(nonCloneableResultDecode, 'invalid_value', '$');
  assert.equal(callWithoutThrow(() => isNormalizedRollResult(nonCloneableResult)), false);

  const nonCloneableCustomDice = [
    {
      id: 'non-cloneable',
      faces: [{ result: 1 }],
      metadata: { callback: () => {} },
    },
  ];
  const nonCloneableCustomDiceDecode = callWithoutThrow(() =>
    decodeCustomDiceDefinitions(nonCloneableCustomDice),
  );
  assertIssue(nonCloneableCustomDiceDecode, 'invalid_value', '$');

  const revokedNormalizedResult = createRevokedProxy();
  const revokedNormalizedDecode = callWithoutThrow(() =>
    decodeNormalizedRollResult(revokedNormalizedResult),
  );
  assertIssue(revokedNormalizedDecode, 'invalid_value', '$');
  assert.equal(callWithoutThrow(() => isNormalizedRollResult(revokedNormalizedResult)), false);

  const revokedCustomDice = createRevokedProxy();
  const revokedCustomDiceDecode = callWithoutThrow(() =>
    decodeCustomDiceDefinitions(revokedCustomDice),
  );
  assertIssue(revokedCustomDiceDecode, 'invalid_value', '$');

  const revokedServerEvent = createRevokedProxy();
  const revokedServerEventDecode = callWithoutThrow(() =>
    decodeServerToClientEvent(revokedServerEvent),
  );
  assertIssue(revokedServerEventDecode, 'invalid_value', '$');
  assert.equal(callWithoutThrow(() => isServerToClientEvent(revokedServerEvent)), false);

  const invalidLegacy = structuredClone(legacy);
  invalidLegacy.dice[0].kept = 'yes';
  const strictInvalidLegacy = decodeNormalizedRollResult(invalidLegacy, {
    allowLegacyResults: false,
  });
  assertIssue(strictInvalidLegacy, 'invalid_result_schema_version', '$.schemaVersion');
  assert.ok(strictInvalidLegacy.error.issues.some((entry) => entry.path.endsWith('.kept')));

  const parsed = engine.parse('1d20+5');
  const parsedSnapshot = structuredClone(parsed);
  const maximumRng = { integer: (_minimum, maximum) => maximum };
  const advantageResult = evaluateParsedExpression(parsed, maximumRng, undefined, {
    advantage: 'advantage',
  });
  assert.equal(advantageResult.dice.length, 2);
  assert.deepEqual(parsed, parsedSnapshot);
  const disadvantageResult = evaluateParsedExpression(parsed, maximumRng, undefined, {
    advantage: 'disadvantage',
  });
  assert.equal(disadvantageResult.dice.length, 2);
  assert.deepEqual(parsed, parsedSnapshot);
  const normalResult = evaluateParsedExpression(parsed, maximumRng);
  assert.equal(normalResult.dice.length, 1);
  assert.deepEqual(parsed, parsedSnapshot);

  const createLegacyEvent = () => ({
    type: 'roll_start',
    protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
    roomId: 'table',
    eventSequence: 1,
    rollId: 'roll-legacy',
    sequence: 1,
    actor: { participantId: 'a', sessionId: 's', name: 'A', roles: [] },
    visibility: { type: 'public' },
    hidden: false,
    summary: {
      rollId: 'roll-legacy',
      sequence: 1,
      revision: 0,
      actor: { participantId: 'a', sessionId: 's', name: 'A', roles: [] },
      createdAt: result.createdAt,
    },
    result: structuredClone(legacy),
  });
  const createPolicyReplayEvent = () => {
    const policy = createRoomPolicy('open-table');
    return {
      type: 'room_policy_updated',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: 'table',
      eventSequence: 2,
      revision: 1,
      actor: { participantId: 'a', sessionId: 's', name: 'A', roles: [] },
      policy,
      previousPolicy: structuredClone(policy),
    };
  };
  const createTokenReplayEvent = () => ({
    type: 'room_token_revoked',
    protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
    roomId: 'table',
    eventSequence: 3,
    actor: { participantId: 'a', sessionId: 's', name: 'A', roles: [] },
    target: { type: 'token', tokenId: 'token-1' },
    revokedAt: result.createdAt,
    disconnectedSessions: 0,
  });

  const legacyEvent = createLegacyEvent();
  assert.equal(
    decodeServerToClientEvent(legacyEvent, { allowLegacyResults: true }).success,
    true,
  );
  const strictLegacyEvent = decodeServerToClientEvent(legacyEvent, {
    allowLegacyResults: false,
  });
  assert.equal(strictLegacyEvent.success, false);
  assert.ok(
    strictLegacyEvent.error.issues.some((entry) => entry.path === '$.result.schemaVersion'),
  );
  assert.equal(isServerToClientEvent(legacyEvent), false);
  assert.equal(Object.hasOwn(legacyEvent.result, 'schemaVersion'), false);

  const nonCloneableEvent = createLegacyEvent();
  nonCloneableEvent.result = structuredClone(result);
  nonCloneableEvent.result.metadata = { callback: () => {} };
  const nonCloneableEventDecode = callWithoutThrow(() =>
    decodeServerToClientEvent(nonCloneableEvent),
  );
  assertIssue(nonCloneableEventDecode, 'invalid_value', '$');
  assert.equal(callWithoutThrow(() => isServerToClientEvent(nonCloneableEvent)), false);

  const legacyRoomState = {
    type: 'room_state',
    protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
    roomId: 'table',
    sequence: 1,
    latestRollSequence: 1,
    latestEventSequence: 1,
    eventBufferStartSequence: 1,
    missedEventsTruncated: false,
    policy: createRoomPolicy('open-table'),
    policyRevision: 0,
    participants: [],
    recentEvents: [createLegacyEvent()],
    recentRolls: [createLegacyEvent()],
    recentRoll: createLegacyEvent(),
  };

  const migratedRoomState = decodeServerToClientEvent(legacyRoomState, {
    allowLegacyResults: true,
  });
  assert.equal(migratedRoomState.success, true);
  for (const [, event] of roomStateRollSlots(migratedRoomState.data)) {
    assert.equal(event.result.schemaVersion, DRAFTROLL_RESULT_SCHEMA_VERSION);
  }
  for (const [, event] of roomStateRollSlots(legacyRoomState)) {
    assert.equal(Object.hasOwn(event.result, 'schemaVersion'), false);
  }

  const strictLegacyRoomState = decodeServerToClientEvent(legacyRoomState, {
    allowLegacyResults: false,
  });
  assert.equal(strictLegacyRoomState.success, false);
  for (const [path] of roomStateRollSlots(legacyRoomState)) {
    assertIssue(
      strictLegacyRoomState,
      'invalid_result_schema_version',
      `${path}.result.schemaVersion`,
    );
  }
  assert.equal(isServerToClientEvent(legacyRoomState), false);
  for (const [, event] of roomStateRollSlots(legacyRoomState)) {
    assert.equal(Object.hasOwn(event.result, 'schemaVersion'), false);
  }

  for (const [path] of roomStateRollSlots(legacyRoomState)) {
    const field = path.startsWith('$.recentEvents')
      ? ['recentEvents', 0]
      : path.startsWith('$.recentRolls')
        ? ['recentRolls', 0]
        : ['recentRoll'];
    for (const protocolVersion of [undefined, DRAFTROLL_PROTOCOL_VERSION + 1]) {
      const invalidProtocolState = structuredClone(legacyRoomState);
      const nestedEvent =
        field.length === 2
          ? invalidProtocolState[field[0]][field[1]]
          : invalidProtocolState[field[0]];
      if (protocolVersion === undefined) delete nestedEvent.protocolVersion;
      else nestedEvent.protocolVersion = protocolVersion;
      const decoded = decodeServerToClientEvent(invalidProtocolState, {
        allowLegacyResults: true,
      });
      assertIssue(
        decoded,
        protocolVersion === undefined ? 'invalid_protocol_version' : 'unsupported_protocol_version',
        `${path}.protocolVersion`,
      );
    }
  }

  for (const createReplayEvent of [createPolicyReplayEvent, createTokenReplayEvent]) {
    for (const protocolVersion of [undefined, DRAFTROLL_PROTOCOL_VERSION + 1]) {
      const invalidProtocolState = structuredClone(legacyRoomState);
      const replayEvent = createReplayEvent();
      if (protocolVersion === undefined) delete replayEvent.protocolVersion;
      else replayEvent.protocolVersion = protocolVersion;
      invalidProtocolState.recentEvents = [replayEvent];
      const decoded = decodeServerToClientEvent(invalidProtocolState, {
        allowLegacyResults: true,
      });
      assertIssue(
        decoded,
        protocolVersion === undefined ? 'invalid_protocol_version' : 'unsupported_protocol_version',
        '$.recentEvents.0.protocolVersion',
      );
    }
  }

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
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
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
          'normalized-result schema version, strict guards, migration, and combined diagnostics',
          'non-record inputs, revoked proxies, and clone failures reject without decoder exceptions',
          'clone-safe custom-dice, normalized-result, and server-event boundaries',
          'parsed-expression immutability across advantage and disadvantage evaluation',
          'strict client and server event decoding',
          'legacy result rejection across direct and independent nested room-state events',
          'nested room-state protocol-version enforcement',
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
