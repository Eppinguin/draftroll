import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTsc } from './lib/load-typescript.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-boundary-safety-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

function createRevokedProxy() {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

function callWithoutThrow(callback) {
  let value;
  assert.doesNotThrow(() => {
    value = callback();
  });
  return value;
}

function assertBoundaryFailure(decoded, label) {
  assert.equal(decoded.success, false, `${label} unexpectedly accepted hostile input`);
  assert.ok(
    decoded.error.issues.some((issue) => issue.code === 'invalid_value' && issue.path === '$'),
    `${label} did not return a structured root boundary failure`,
  );
}

function replayEvent(eventSequence, roomId = 'room') {
  return {
    roomId,
    eventSequence,
    type: 'roll_start',
  };
}

function replayRow(eventSequence, body = replayEvent(eventSequence)) {
  return {
    event_sequence: eventSequence,
    event_json: JSON.stringify(body),
  };
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
          rootDir: projectRoot,
          outDir,
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        },
        include: [
          join(projectRoot, 'packages/protocol/**/*.ts'),
          join(projectRoot, 'apps/worker/src/replay-integrity.ts'),
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

  const protocol = await import(pathToFileURL(join(outDir, 'packages/protocol/src/index.js')).href);
  const replayIntegrity = await import(
    pathToFileURL(join(outDir, 'apps/worker/src/replay-integrity.js')).href
  );

  const objectNonCloneable = { callback: () => {} };
  const arrayNonCloneable = [{ callback: () => {} }];
  const decoderCases = [
    ['decodeRollVisibility', protocol.decodeRollVisibility, objectNonCloneable],
    ['decodeRoomPolicy', protocol.decodeRoomPolicy, objectNonCloneable],
    ['decodeRoomPolicyPatch', protocol.decodeRoomPolicyPatch, objectNonCloneable],
    ['decodeParticipantIdentityInput', protocol.decodeParticipantIdentityInput, objectNonCloneable],
    [
      'decodeRoomCapabilityTokenPayload',
      protocol.decodeRoomCapabilityTokenPayload,
      objectNonCloneable,
    ],
    ['decodeCustomDiceDefinitions', protocol.decodeCustomDiceDefinitions, arrayNonCloneable],
    ['decodeRollInput', protocol.decodeRollInput, objectNonCloneable],
    ['decodeRollUpdateInput', protocol.decodeRollUpdateInput, objectNonCloneable],
    ['decodeNormalizedRollResult', protocol.decodeNormalizedRollResult, objectNonCloneable],
    ['decodeClientToServerEvent', protocol.decodeClientToServerEvent, objectNonCloneable],
    ['decodeServerToClientEvent', protocol.decodeServerToClientEvent, objectNonCloneable],
  ];

  for (const [label, decoder, nonCloneableInput] of decoderCases) {
    assertBoundaryFailure(
      callWithoutThrow(() => decoder(createRevokedProxy())),
      label,
    );
    assertBoundaryFailure(
      callWithoutThrow(() => decoder(nonCloneableInput)),
      label,
    );
  }

  const throwingGetter = {};
  Object.defineProperty(throwingGetter, 'type', {
    enumerable: true,
    get() {
      throw new Error('getter must not escape the protocol boundary');
    },
  });
  assertBoundaryFailure(
    callWithoutThrow(() => protocol.decodeClientToServerEvent(throwingGetter)),
    'decodeClientToServerEvent throwing getter',
  );

  assert.equal(
    callWithoutThrow(() => protocol.parseClientToServerEvent(createRevokedProxy())),
    null,
  );
  assert.equal(
    callWithoutThrow(() => protocol.isRollVisibility(createRevokedProxy())),
    false,
  );

  const exoticMetadata = {
    participantId: 'host',
    metadata: { when: new Date() },
  };
  assertBoundaryFailure(
    protocol.decodeParticipantIdentityInput(exoticMetadata),
    'decodeParticipantIdentityInput special structured-clone container',
  );

  class TaggedVisibility {
    type = 'public';
  }
  const taggedClassInstance = new TaggedVisibility();
  Object.defineProperty(taggedClassInstance, Symbol.toStringTag, { value: 'Object' });
  assertBoundaryFailure(
    protocol.decodeRollVisibility(taggedClassInstance),
    'decodeRollVisibility class instance with spoofed object tag',
  );

  const oversizedVisibility = {
    type: 'roles',
    roles: Array(protocol.DEFAULT_RUNTIME_VALIDATION_LIMITS.maximumArrayLength + 1).fill('gm'),
  };
  const oversizedDecode = protocol.decodeRollVisibility(oversizedVisibility);
  assert.equal(oversizedDecode.success, false);
  assert.ok(
    oversizedDecode.error.issues.some(
      (issue) => issue.code === 'limit_exceeded' && issue.path === '$',
    ),
  );

  let getterReads = 0;
  const getterBackedVisibility = { type: 'roles' };
  Object.defineProperty(getterBackedVisibility, 'roles', {
    enumerable: true,
    get() {
      getterReads += 1;
      return ['gm'];
    },
  });
  const getterDecode = protocol.decodeRollVisibility(getterBackedVisibility);
  assert.equal(getterDecode.success, true);
  assert.equal(getterReads, 1, 'caller-owned accessors must be evaluated at most once');

  const replayWindow = {
    roomId: 'room',
    afterEventSequence: 9,
    earliestEventSequence: 1,
  };

  const bufferGap = replayIntegrity.sanitizeEventBuffer(
    [replayEvent(10), replayEvent(12), replayEvent(13)],
    'room',
    13,
  );
  assert.deepEqual(bufferGap.events, [replayEvent(10)]);
  assert.equal(bufferGap.recoverySequence, 11);

  const staleTail = replayIntegrity.sanitizeEventBuffer(
    [replayEvent(50), replayEvent(51)],
    'room',
    100,
  );
  assert.deepEqual(staleTail.events, [replayEvent(50), replayEvent(51)]);
  assert.equal(staleTail.recoverySequence, 52);
  assert.equal(staleTail.changed, true);

  const emptyStaleBuffer = replayIntegrity.sanitizeEventBuffer([], 'room', 100);
  assert.deepEqual(emptyStaleBuffer.events, []);
  assert.equal(emptyStaleBuffer.recoverySequence, 100);
  assert.equal(emptyStaleBuffer.changed, true);

  assert.deepEqual(
    replayIntegrity.findDurableReplayIssue([replayRow(10), replayRow(12)], replayWindow),
    { kind: 'gap', eventSequence: 11 },
  );
  assert.deepEqual(
    replayIntegrity.findDurableReplayIssue([replayRow(10, replayEvent(99))], replayWindow),
    {
      kind: 'corrupt',
      eventSequence: 10,
      reason: 'D1 replay row sequence does not match its serialized event',
    },
  );
  assert.deepEqual(
    replayIntegrity.findDurableReplayIssue([replayRow(10, replayEvent(10, 'other'))], replayWindow),
    {
      kind: 'corrupt',
      eventSequence: 10,
      reason: 'D1 replay row room identity does not match its query scope',
    },
  );
  assert.equal(
    replayIntegrity.findDurableReplayIssue([replayRow(10)], replayWindow),
    null,
    'a missing D1 tail may be asynchronous persistence lag',
  );
  const stalledReplay = replayIntegrity.stallReplayEnvelope(
    {
      afterEventSequence: 9,
      nextAfterEventSequence: 12,
      latestEventSequence: 12,
      events: [replayEvent(10), replayEvent(12)],
      hasMore: false,
    },
    11,
  );
  assert.deepEqual(stalledReplay.events, [replayEvent(10)]);
  assert.equal(stalledReplay.nextAfterEventSequence, 10);
  assert.equal(stalledReplay.recoveryBlockedAtEventSequence, undefined);
  assert.equal(stalledReplay.hasMore, true);

  const hardenedReplay = replayIntegrity.hardenReplayEnvelope(
    {
      afterEventSequence: 9,
      nextAfterEventSequence: 12,
      latestEventSequence: 12,
      events: [replayEvent(10), replayEvent(12)],
      hasMore: false,
    },
    11,
  );
  assert.deepEqual(hardenedReplay.events, [replayEvent(10)]);
  assert.equal(hardenedReplay.nextAfterEventSequence, 10);
  assert.equal(hardenedReplay.recoveryBlockedAtEventSequence, 11);
  assert.equal(hardenedReplay.hasMore, true);

  const visibility = { type: 'roles', roles: ['gm'] };
  const decodedVisibility = protocol.decodeRollVisibility(visibility);
  assert.equal(decodedVisibility.success, true);
  assert.notEqual(decodedVisibility.data, visibility);
  decodedVisibility.data.roles.push('observer');
  assert.deepEqual(visibility.roles, ['gm']);

  const clientEvent = {
    type: 'participant_update',
    metadata: { nested: { value: 1 } },
  };
  const decodedClientEvent = protocol.decodeClientToServerEvent(clientEvent);
  assert.equal(decodedClientEvent.success, true);
  assert.notEqual(decodedClientEvent.data, clientEvent);
  decodedClientEvent.data.metadata.nested.value = 2;
  assert.equal(clientEvent.metadata.nested.value, 1);

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: [
          'the canonical protocol entrypoint owns runtime boundary safety',
          'all object-facing protocol decoders reject revoked proxies without throwing',
          'non-cloneable values matching each decoder boundary return structured failures',
          'throwing getters return structured boundary failures',
          'special structured-clone containers and class instances are rejected instead of flattened',
          'spoofed Symbol.toStringTag values cannot bypass the plain-object boundary',
          'oversized object graphs fail before structured cloning',
          'caller-owned accessors are read at most once before detailed validation',
          'Durable Object replay buffers stop at gaps, room mismatches, and stale tails',
          'D1 replay gaps stall without advancing while corrupt row identities fail closed',
          'parse/type-guard helpers remain non-throwing',
          'successful public boundary decodes return detached data',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
