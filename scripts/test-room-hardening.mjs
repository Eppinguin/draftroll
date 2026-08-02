import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-room-hardening-'));
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
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    },
    include: [join(projectRoot, 'packages/protocol/**/*.ts')],
  }, null, 2));

  const compile = runTsc(['-p', configPath], { cwd: projectRoot });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const protocol = await import(pathToFileURL(join(outDir, 'protocol/src/index.js')).href);
  const {
    applyRoomPolicyPatch,
    createRoomPolicy,
    decodeClientToServerEvent,
    decodeRoomPolicy,
    decodeRoomPolicyPatch,
    decodeServerToClientEvent,
  } = protocol;

  const open = createRoomPolicy('open-table');
  const privateGm = createRoomPolicy('private-gm-table');
  const moderated = createRoomPolicy('moderated-public-room');
  assert.equal(decodeRoomPolicy(open).success, true);
  assert.equal(privateGm.authorization.allowOwnRollReveal, false);
  assert.equal(moderated.authorization.allowHiddenRolls, false);
  assert.ok(moderated.rateLimits.commandsPerMinutePerSession < open.rateLimits.commandsPerMinutePerSession);

  const patchResult = decodeRoomPolicyPatch({
    enabled: false,
    shutdownReason: 'Maintenance',
    limits: {
      maximumParticipants: 8,
      maximumRollsRetained: 75,
      maximumRevisionsPerRoll: 12,
    },
    lifecycle: {
      roomIdleExpirySeconds: 600,
      historyRetentionSeconds: 86_400,
      revisionRetentionSeconds: 43_200,
    },
  });
  assert.equal(patchResult.success, true);
  const patched = applyRoomPolicyPatch(open, patchResult.data);
  assert.equal(patched.preset, 'custom');
  assert.equal(patched.enabled, false);
  assert.equal(patched.shutdownReason, 'Maintenance');
  assert.equal(patched.limits.maximumParticipants, 8);

  const invalidLimit = decodeRoomPolicyPatch({ limits: { maximumInboundMessageBytes: 128 } });
  assert.equal(invalidLimit.success, false);
  assert.ok(invalidLimit.error.issues.some((issue) => issue.path.endsWith('.maximumInboundMessageBytes')));

  const command = decodeClientToServerEvent({
    type: 'set_room_policy',
    requestId: 'policy-1',
    expectedRevision: 0,
    policy: { rateLimits: { rollsPerMinutePerRoom: 40 } },
  }, { rejectUnknownFields: true });
  assert.equal(command.success, true);

  const actor = { participantId: 'gm', sessionId: 'gm-session', name: 'GM', roles: ['gm'] };
  const policyEvent = {
    type: 'room_policy_updated',
    protocolVersion: 2,
    roomId: 'table',
    eventSequence: 3,
    requestId: 'policy-1',
    revision: 1,
    actor,
    policy: patched,
    previousPolicy: open,
  };
  assert.equal(decodeServerToClientEvent(policyEvent, { rejectUnknownFields: true }).success, true);

  const state = {
    type: 'room_state',
    protocolVersion: 2,
    roomId: 'table',
    sequence: 0,
    latestRollSequence: 0,
    latestEventSequence: 3,
    eventBufferStartSequence: 3,
    missedEventsTruncated: false,
    policy: patched,
    policyRevision: 1,
    participants: [],
    recentEvents: [{ ...policyEvent, replayed: true }],
    recentRolls: [],
  };
  assert.equal(decodeServerToClientEvent(state, { rejectUnknownFields: true }).success, true);

  const workerSource = await readFile(join(projectRoot, 'apps/worker/src/index.ts'), 'utf8');
  for (const required of [
    'consumeRateLimit(',
    'maximumParticipants',
    'maximumInboundMessageBytes',
    'maximumRollsRetained',
    'maximumRevisionsPerRoll',
    'roomIdleExpirySeconds',
    'historyRetentionSeconds',
    'revisionRetentionSeconds',
    'async alarm()',
    'withD1Retry',
    'persistenceFailures',
    'origin_not_allowed',
  ]) {
    assert.ok(workerSource.includes(required), `worker hardening implementation is missing ${required}`);
  }

  const workspace = await readFile(join(projectRoot, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(workspace, /allowBuilds:/);
  assert.match(workspace, /esbuild:\s*true/);
  assert.match(workspace, /workerd:\s*true/);
  const wrangler = JSON.parse((await readFile(join(projectRoot, 'apps/worker/wrangler.jsonc'), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(wrangler.compatibility_date, '2026-07-29');

  const packagePaths = [
    'package.json',
    'packages/client/package.json',
    'packages/core/package.json',
    'packages/overlay/package.json',
    'packages/protocol/package.json',
    'packages/renderer/package.json',
    'packages/sdk/package.json',
    'packages/server/package.json',
    'packages/themes/package.json',
    'apps/worker/package.json',
  ];
  const versions = await Promise.all(packagePaths.map(async (path) => JSON.parse(await readFile(join(projectRoot, path), 'utf8')).version));
  assert.deepEqual([...new Set(versions)], ['0.1.0'], 'implementation work must not bump package versions');

  console.log(JSON.stringify({
    ok: true,
    tested: [
      'room-policy presets and patch merging',
      'policy runtime validation and bounds',
      'sequenced policy request and replay events',
      'rate-limit, participant, storage, expiry, and retention implementation presence',
      'esbuild/workerd allowBuilds and Wrangler compatibility date',
      'no package version bumps',
    ],
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
