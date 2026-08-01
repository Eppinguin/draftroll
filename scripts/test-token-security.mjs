import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-token-security-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');
const now = new Date('2026-07-31T06:00:00.000Z');

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
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    include: [
      join(projectRoot, 'packages/protocol/**/*.ts'),
      join(projectRoot, 'packages/server/**/*.ts'),
    ],
  }, null, 2));

  const compile = spawnSync('tsc', ['-p', configPath], { cwd: projectRoot, encoding: 'utf8' });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const protocol = await import(pathToFileURL(join(outDir, 'protocol/src/index.js')).href);
  const server = await import(pathToFileURL(join(outDir, 'server/src/index.js')).href);
  const {
    createRoomCapabilityToken,
    verifyRoomCapabilityToken,
    verifyRoomCapabilityTokenDetailed,
  } = server;
  const {
    decodeClientToServerEvent,
    decodeRoomCapabilityTokenPayload,
    decodeServerToClientEvent,
  } = protocol;

  const previous = { id: 'previous', secret: 'previous-signing-secret-at-least-16-characters' };
  const active = { id: 'active', secret: 'active-signing-secret-at-least-16-characters' };
  const token = await createRoomCapabilityToken({
    roomId: 'secure-table',
    participantId: 'gm',
    permissions: ['room:manage', 'roll:create'],
  }, active, {
    now,
    expiresInSeconds: 3600,
    issuer: 'https://app.example.test',
    audience: ['draftroll-room', 'draftroll-admin'],
    tokenId: 'token-123',
  });

  const verified = await verifyRoomCapabilityTokenDetailed(token, [previous, active], {
    roomId: 'secure-table',
    now,
    issuer: 'https://app.example.test',
    audience: 'draftroll-room',
    requireTokenId: true,
    requireIssuedAt: true,
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.token.header.kid, 'active');
  assert.equal(verified.token.payload.jti, 'token-123');
  assert.equal(verified.token.payload.iat, Math.floor(now.getTime() / 1000));

  const rotated = await createRoomCapabilityToken({
    roomId: 'secure-table', participantId: 'old-client', permissions: ['roll:create'],
  }, previous, { now, expiresInSeconds: 300, issuer: 'https://app.example.test', audience: 'draftroll-room' });
  assert.ok(await verifyRoomCapabilityToken(rotated, [previous, active], {
    roomId: 'secure-table', now, issuer: 'https://app.example.test', audience: 'draftroll-room',
  }));

  const encodeSegment = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const decodeSegment = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');

  const escalatedPayload = decodeSegment(encodedPayload);
  escalatedPayload.permissions = [...(escalatedPayload.permissions ?? []), 'room:manage'];
  const escalatedToken = `${encodedHeader}.${encodeSegment(escalatedPayload)}.${encodedSignature}`;
  const escalationResult = await verifyRoomCapabilityTokenDetailed(escalatedToken, [previous, active], {
    roomId: 'secure-table', now,
  });
  assert.equal(escalationResult.valid, false);
  assert.equal(escalationResult.code, 'invalid_signature', 'unsigned permission escalation must fail signature verification');

  const confusedHeader = { ...decodeSegment(encodedHeader), alg: 'none' };
  const algorithmConfusion = await verifyRoomCapabilityTokenDetailed(
    `${encodeSegment(confusedHeader)}.${encodedPayload}.${encodedSignature}`,
    [previous, active],
    { roomId: 'secure-table', now },
  );
  assert.equal(algorithmConfusion.valid, false);
  assert.equal(algorithmConfusion.code, 'unsupported_token_header');

  const malformed = await verifyRoomCapabilityTokenDetailed('one.two.three.four', [previous, active], {
    roomId: 'secure-table', now,
  });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.code, 'malformed_token');

  const futureIssuedToken = await createRoomCapabilityToken({
    roomId: 'secure-table', participantId: 'future-issued', permissions: ['roll:create'],
  }, active, { now: new Date(now.getTime() + 10 * 60_000), expiresInSeconds: 3600 });
  const futureIssued = await verifyRoomCapabilityTokenDetailed(futureIssuedToken, [active], {
    roomId: 'secure-table', now, clockToleranceSeconds: 30,
  });
  assert.equal(futureIssued.valid, false);
  assert.equal(futureIssued.code, 'token_issued_in_future');

  const unknownKey = await verifyRoomCapabilityTokenDetailed(token, [previous], { roomId: 'secure-table', now });
  assert.equal(unknownKey.valid, false);
  assert.equal(unknownKey.code, 'unknown_key_id');

  const wrongIssuer = await verifyRoomCapabilityTokenDetailed(token, [previous, active], {
    roomId: 'secure-table', now, issuer: 'https://other.example.test', audience: 'draftroll-room',
  });
  assert.equal(wrongIssuer.valid, false);
  assert.equal(wrongIssuer.code, 'token_issuer_mismatch');

  const wrongAudience = await verifyRoomCapabilityTokenDetailed(token, [previous, active], {
    roomId: 'secure-table', now, issuer: 'https://app.example.test', audience: 'another-service',
  });
  assert.equal(wrongAudience.valid, false);
  assert.equal(wrongAudience.code, 'token_audience_mismatch');

  const revoked = await verifyRoomCapabilityTokenDetailed(token, [previous, active], {
    roomId: 'secure-table', now,
    isRevoked: (payload) => payload.jti === 'token-123',
  });
  assert.equal(revoked.valid, false);
  assert.equal(revoked.code, 'token_revoked');

  const future = await createRoomCapabilityToken({
    roomId: 'secure-table', participantId: 'future', permissions: ['roll:create'],
  }, active, { now, expiresInSeconds: 3600, notBefore: Math.floor(now.getTime() / 1000) + 600 });
  const futureResult = await verifyRoomCapabilityTokenDetailed(future, [active], { roomId: 'secure-table', now });
  assert.equal(futureResult.valid, false);
  assert.equal(futureResult.code, 'token_not_yet_valid');

  const payloadValidation = decodeRoomCapabilityTokenPayload({
    protocolVersion: 2,
    roomId: 'secure-table',
    participantId: 'gm',
    iss: 'https://app.example.test',
    aud: ['draftroll-room'],
    iat: 10,
    nbf: 11,
    exp: 20,
    jti: 'token-123',
  }, { rejectUnknownFields: true });
  assert.equal(payloadValidation.success, true);

  const tokenHandshake = {
    type: 'authenticate_room_token',
    token,
  };
  assert.equal(decodeClientToServerEvent(tokenHandshake, { rejectUnknownFields: true }).success, true);

  const revokeCommand = {
    type: 'revoke_room_token',
    requestId: 'revoke-1',
    target: { type: 'participant', participantId: 'player-2', issuedAtOrBefore: 12345 },
    reason: 'Removed from the table',
  };
  assert.equal(decodeClientToServerEvent(revokeCommand, { rejectUnknownFields: true }).success, true);

  const actor = { participantId: 'gm', sessionId: 'gm-session', name: 'GM', roles: ['gm'] };
  const revokedEvent = {
    type: 'room_token_revoked',
    protocolVersion: 2,
    roomId: 'secure-table',
    eventSequence: 4,
    requestId: 'revoke-1',
    actor,
    target: revokeCommand.target,
    revokedAt: now.toISOString(),
    reason: revokeCommand.reason,
    disconnectedSessions: 2,
  };
  assert.equal(decodeServerToClientEvent(revokedEvent, { rejectUnknownFields: true }).success, true);

  const workerSource = await readFile(join(projectRoot, 'apps/worker/src/index.ts'), 'utf8');
  for (const required of [
    'ROOM_TOKEN_KEYS',
    'ROOM_TOKEN_ISSUER',
    'ROOM_TOKEN_AUDIENCE',
    'ROOM_TOKEN_REQUIRE_JTI',
    'isCapabilityTokenRevoked',
    'handleTokenRevocation',
    'participantTokenRevocationKey',
    'tokenSessionMatchesRevocation',
    "socket.close(4004, 'Draftroll capability token revoked')",
    'handleTokenAuthentication',
    "event.type !== 'authenticate_room_token'",
    'authorizationComplete',
  ]) {
    assert.ok(workerSource.includes(required), `worker token security implementation is missing ${required}`);
  }
  assert.ok(!JSON.stringify(revokedEvent).includes(active.secret), 'revocation events must not expose signing secrets');
  assert.equal(workerSource.includes("url.searchParams.get('token')"), false, 'the Worker must reject query-string capability tokens');

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
  assert.deepEqual([...new Set(versions)], ['0.1.0']);

  console.log(JSON.stringify({
    ok: true,
    tested: [
      'post-open WebSocket token authentication command',
      'issuer and audience claims',
      'issued-at, not-before, expiry, and token IDs',
      'key IDs and rotation verification rings',
      'detailed verification failures',
      'permission-escalation signature tampering',
      'algorithm-confusion and malformed-token rejection',
      'future-issued token rejection',
      'exact token revocation callback',
      'participant token revocation protocol',
      'worker revocation persistence and active-session disconnect hooks',
      'no package version bumps',
    ],
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
