import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-room-protocol-test-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

const now = new Date().toISOString();
let globalSequence = 0;

function makePolicy() {
  return {
    schemaVersion: 1,
    preset: 'open-table',
    enabled: true,
    access: { passwordProtected: false },
    authorization: {
      allowParticipantRolls: true,
      allowOwnRollUpdates: true,
      allowOwnRollRerolls: true,
      allowOwnRollReveal: true,
      allowPrivilegedAnyRollUpdates: true,
      allowPrivilegedAnyRollReveal: true,
      allowHiddenRolls: true,
      allowWhispers: true,
    },
    limits: {
      maximumParticipants: 32,
      maximumInboundMessageBytes: 65536,
      maximumExpressionLength: 16384,
      maximumDicePerRoll: 250,
      maximumOperationsPerRoll: 128,
      maximumParticipantMetadataBytes: 8192,
      maximumBufferedEvents: 200,
      maximumRollsRetained: 500,
      maximumRevisionsPerRoll: 50,
    },
    rateLimits: {
      connectionAttemptsPerMinutePerIp: 30,
      passwordAttemptsPerMinutePerIp: 10,
      commandsPerMinutePerSession: 180,
      mutationsPerMinutePerParticipant: 120,
      rollsPerMinutePerRoom: 300,
    },
    lifecycle: {
      staleSessionSeconds: 900,
      roomIdleExpirySeconds: 86400,
      historyRetentionSeconds: 2592000,
      revisionRetentionSeconds: 2592000,
      maintenanceIntervalSeconds: 300,
    },
  };
}

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  static requireToken = false;
  static expectedToken = null;

  constructor(url) {
    super();
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    this.revision = 0;
    this.policyRevision = 0;
    this.policy = makePolicy();
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
      const parsed = new URL(url);
      this.participant = {
        participantId: parsed.searchParams.get('participantId'),
        sessionId: parsed.searchParams.get('sessionId'),
        name: parsed.searchParams.get('name'),
        roles: [], permissions: ['roll:create', 'roll:update-own', 'roll:reveal-own'], connectedAt: now,
      };
      if (MockWebSocket.requireToken) {
        this.serverSend({
          type: 'roll_error',
          code: 'token_required',
          message: 'Room capability token required',
        });
      } else {
        this.finishSession();
      }
    });
  }

  finishSession() {
    const parsed = new URL(this.url);
    this.serverSend({
      type: 'session_ready', protocolVersion: 2, roomId: parsed.searchParams.get('roomId'),
      participant: this.participant, latestEventSequence: 0, latestRollSequence: 0,
    });
    this.serverSend({
      type: 'room_state', protocolVersion: 2, roomId: parsed.searchParams.get('roomId'),
      sequence: 0, latestRollSequence: 0, latestEventSequence: 0,
      eventBufferStartSequence: 0, missedEventsTruncated: false,
      policy: this.policy, policyRevision: this.policyRevision,
      participants: [this.participant], recentEvents: [], recentRolls: [],
    });
  }

  send(value) {
    this.sent.push(value);
    const event = JSON.parse(value);
    if (event.type === 'authenticate_room_token') {
      if (event.token === MockWebSocket.expectedToken) {
        this.finishSession();
      } else {
        this.serverSend({
          type: 'roll_error',
          code: 'invalid_room_token',
          message: 'Invalid room capability token',
        });
      }
      return;
    }
    if (event.type === 'clock_sync_ping') {
      this.serverSend({ ...event, type: 'clock_sync_pong', protocolVersion: 2, roomId: new URL(this.url).searchParams.get('roomId'), serverTimeMs: Date.now() });
      return;
    }
    if (event.type === 'roll_request' || event.type === 'display_roll') {
      this.revision = 0;
      this.serverSend(makeRoomEvent({
        requestId: event.requestId,
        clientRollId: event.clientRollId,
        eventSequence: ++globalSequence,
        rollId: 'roll-1',
        revision: 0,
        visibility: event.visibility ?? { type: 'public' },
      }));
      return;
    }
    if (event.type === 'update_roll') {
      if (event.expectedRevision !== this.revision) {
        this.serverSend({
          type: 'roll_error', requestId: event.requestId, rollId: event.rollId,
          code: 'revision_conflict', message: 'stale revision', currentRevision: this.revision,
        });
        return;
      }
      this.revision += 1;
      const result = makeResult(this.revision);
      result.annotation = event.update.annotation ?? result.annotation;
      this.serverSend({
        ...makeRoomEvent({ requestId: event.requestId, eventSequence: ++globalSequence, rollId: event.rollId, revision: this.revision }),
        type: 'roll_updated', result, summary: summary(result), animate: event.animate ?? false,
      });
      return;
    }
    if (event.type === 'set_roll_visibility') {
      if (event.expectedRevision !== this.revision) {
        this.serverSend({
          type: 'roll_error', requestId: event.requestId, rollId: event.rollId,
          code: 'revision_conflict', message: 'stale revision', currentRevision: this.revision,
        });
        return;
      }
      this.revision += 1;
      const result = makeResult(this.revision);
      this.serverSend({
        ...makeRoomEvent({ requestId: event.requestId, eventSequence: ++globalSequence, rollId: event.rollId, revision: this.revision, visibility: event.visibility }),
        type: 'roll_visibility_updated', result, summary: summary(result), previousVisibility: { type: 'roller' },
        animationSeed: undefined, serverStartTimeMs: undefined, animationDurationMs: undefined,
      });
    }
    if (event.type === 'revoke_room_token') {
      this.serverSend({
        type: 'room_token_revoked',
        protocolVersion: 2,
        roomId: new URL(this.url).searchParams.get('roomId'),
        eventSequence: ++globalSequence,
        requestId: event.requestId,
        actor: actor('aria', 'Aria'),
        target: event.target,
        revokedAt: now,
        reason: event.reason,
        disconnectedSessions: 1,
      });
      return;
    }
    if (event.type === 'set_room_policy') {
      if (event.expectedRevision !== this.policyRevision) {
        this.serverSend({
          type: 'roll_error', requestId: event.requestId,
          code: 'policy_revision_conflict', message: 'stale policy revision', currentRevision: this.policyRevision,
        });
        return;
      }
      const previousPolicy = structuredClone(this.policy);
      const patch = event.policy;
      this.policy = {
        ...this.policy,
        preset: patch.preset ?? (Object.keys(patch).length > 0 ? 'custom' : this.policy.preset),
        enabled: patch.enabled ?? this.policy.enabled,
        ...(patch.shutdownReason === null ? { shutdownReason: undefined } : patch.shutdownReason ? { shutdownReason: patch.shutdownReason } : {}),
        authorization: { ...this.policy.authorization, ...patch.authorization },
        limits: { ...this.policy.limits, ...patch.limits },
        rateLimits: { ...this.policy.rateLimits, ...patch.rateLimits },
        lifecycle: { ...this.policy.lifecycle, ...patch.lifecycle },
      };
      this.policyRevision += 1;
      this.serverSend({
        type: 'room_policy_updated', protocolVersion: 2, roomId: new URL(this.url).searchParams.get('roomId'),
        eventSequence: ++globalSequence, requestId: event.requestId, revision: this.policyRevision,
        actor: actor('aria', 'Aria'), policy: this.policy, previousPolicy,
      });
    }
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    const closeEvent = new Event('close');
    Object.assign(closeEvent, { code, reason });
    this.dispatchEvent(closeEvent);
  }

  serverSend(data) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  addEventListener(...args) { return super.addEventListener(...args); }
  removeEventListener(...args) { return super.removeEventListener(...args); }
}

function makeRoomEvent({ requestId, clientRollId, eventSequence, rollId, revision, visibility = { type: 'roller' } }) {
  const result = makeResult(revision);
  result.rollId = rollId;
  return {
    type: 'roll_start', protocolVersion: 2, roomId: 'table', requestId, clientRollId,
    eventSequence, rollId, sequence: 1, actor: actor('aria', 'Aria'), visibility,
    hidden: false, result, summary: summary(result), animationSeed: 'seed',
    serverStartTimeMs: Date.now() + 10, animationDurationMs: 100,
  };
}

function makeResult(revision) {
  return {
    schemaVersion: 1,
    rollId: 'roll-1', sequence: 1, revision, authority: 'server', expression: '1d20+5', total: 17,
    dice: [{ id: 'die_1', type: 'd20', sides: 20, result: 12, kept: true, generatedBy: 'initial' }],
    operations: [], createdAt: now, updatedAt: revision ? now : undefined,
  };
}

function actor(participantId, name) {
  return { participantId, sessionId: `${participantId}-session`, name, roles: [] };
}

function summary(result) {
  return {
    rollId: result.rollId, sequence: result.sequence, revision: result.revision,
    actor: actor('aria', 'Aria'), createdAt: result.createdAt, updatedAt: result.updatedAt,
  };
}

function once(room, eventName) {
  return new Promise((settle) => {
    const off = room.on(eventName, (event) => { off(); settle(event); });
  });
}

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
    include: [join(projectRoot, 'packages/**/*.ts')],
  }, null, 2));

  const compile = runTsc(['-p', configPath], { cwd: projectRoot });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const clientModule = await import(pathToFileURL(join(outDir, 'client/src/index.js')).href);
  const sdkModule = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);
  const serverModule = await import(pathToFileURL(join(outDir, 'server/src/index.js')).href);
  const { DiceRoom, DiceRoomRequestError } = clientModule;
  const { Draftroll } = sdkModule;
  const {
    createRoomCapabilityToken,
    verifyRoomCapabilityToken,
    verifyRoomCapabilityTokenDetailed,
    createGameMasterPermissions,
  } = serverModule;

  const oldTokenKey = { id: '2026-01', secret: 'old-room-test-secret-at-least-16-characters' };
  const activeTokenKey = { id: '2026-07', secret: 'active-room-test-secret-at-least-16-characters' };
  const token = await createRoomCapabilityToken({
    roomId: 'table', participantId: 'gm', name: 'Game Master', roles: ['gm'],
    permissions: createGameMasterPermissions(),
  }, activeTokenKey, {
    expiresInSeconds: 300,
    issuer: 'draftroll-test',
    audience: ['draftroll-room', 'draftroll-admin'],
    tokenId: 'token-gm-1',
  });
  assert.equal(token.split('.').length, 3, 'new tokens use a versioned header.payload.signature envelope');
  const verifiedToken = await verifyRoomCapabilityToken(token, [oldTokenKey, activeTokenKey], {
    roomId: 'table',
    issuer: 'draftroll-test',
    audience: 'draftroll-room',
    requireTokenId: true,
    requireIssuedAt: true,
  });
  assert.equal(verifiedToken.participantId, 'gm');
  assert.equal(verifiedToken.jti, 'token-gm-1');
  assert.equal(verifiedToken.iss, 'draftroll-test');
  assert.ok(verifiedToken.permissions.includes('roll:view-hidden'));
  assert.equal(await verifyRoomCapabilityToken(token, [oldTokenKey, activeTokenKey], { roomId: 'other' }), null);

  const wrongAudience = await verifyRoomCapabilityTokenDetailed(token, [oldTokenKey, activeTokenKey], {
    roomId: 'table',
    issuer: 'draftroll-test',
    audience: 'different-service',
  });
  assert.equal(wrongAudience.valid, false);
  assert.equal(wrongAudience.code, 'token_audience_mismatch');

  const unknownKey = await verifyRoomCapabilityTokenDetailed(token, [oldTokenKey], { roomId: 'table' });
  assert.equal(unknownKey.valid, false);
  assert.equal(unknownKey.code, 'unknown_key_id');

  const revoked = await verifyRoomCapabilityTokenDetailed(token, [oldTokenKey, activeTokenKey], {
    roomId: 'table',
    isRevoked: (payload) => payload.jti === 'token-gm-1',
  });
  assert.equal(revoked.valid, false);
  assert.equal(revoked.code, 'token_revoked');

  const rotatedToken = await createRoomCapabilityToken({
    roomId: 'table', participantId: 'player', permissions: ['roll:create'],
  }, oldTokenKey, { expiresInSeconds: 300, issuer: 'draftroll-test', audience: 'draftroll-room' });
  assert.ok(await verifyRoomCapabilityToken(rotatedToken, [oldTokenKey, activeTokenKey], {
    roomId: 'table', issuer: 'draftroll-test', audience: 'draftroll-room',
  }), 'retired verification keys remain valid during rotation');

  const browserToken = 'signed-browser-token-value';
  MockWebSocket.requireToken = true;
  MockWebSocket.expectedToken = browserToken;
  const tokenRoom = await DiceRoom.connect({
    url: 'wss://draftroll.test/rooms/secure/connect',
    roomId: 'secure',
    token: browserToken,
    participant: { participantId: 'secure-user', sessionId: 'secure-session', name: 'Secure User' },
    reconnect: false,
    clockSyncSamples: 1,
    WebSocketImpl: MockWebSocket,
  });
  const tokenSocket = MockWebSocket.instances.at(-1);
  assert.equal(new URL(tokenSocket.url).searchParams.has('token'), false, 'capability tokens must not appear in WebSocket URLs');
  assert.equal(new URL(tokenSocket.url).searchParams.get('authMode'), 'token', 'a non-secret auth-mode hint forces token authentication even when anonymous rooms are enabled');
  assert.equal(tokenSocket.url.includes(browserToken), false, 'capability tokens must not leak into WebSocket URLs');
  const tokenMessages = tokenSocket.sent.map((value) => JSON.parse(value));
  assert.deepEqual(
    tokenMessages.find((event) => event.type === 'authenticate_room_token'),
    { type: 'authenticate_room_token', token: browserToken },
    'capability token is submitted only after the encrypted WebSocket opens',
  );
  const authorizedUrl = tokenRoom.authorizeHttpUrl('https://draftroll.test/rooms/secure/history');
  assert.equal(authorizedUrl.toString().includes(browserToken), false, 'capability tokens must not appear in HTTP URLs');
  const authorizedRequest = tokenRoom.authorizeHttpRequest('https://draftroll.test/rooms/secure/history');
  assert.equal(authorizedRequest.headers.get('Authorization'), `Bearer ${browserToken}`);
  assert.equal(authorizedRequest.url.includes(browserToken), false);
  tokenRoom.close();
  MockWebSocket.requireToken = false;
  MockWebSocket.expectedToken = null;

  const room = await DiceRoom.connect({
    url: 'ws://draftroll.test/rooms/table/connect',
    roomId: 'table',
    participant: { participantId: 'aria', sessionId: 'aria-session', name: 'Aria' },
    reconnect: false,
    clockSyncSamples: 1,
    WebSocketImpl: MockWebSocket,
  });

  assert.equal(room.participant.participantId, 'aria');
  assert.equal(room.participants[0].name, 'Aria');

  assert.equal(room.policy.preset, 'open-table');
  const policyUpdate = await room.setPolicy({
    limits: { maximumParticipants: 12 },
    authorization: { allowWhispers: false },
  });
  assert.equal(policyUpdate.revision, 1);
  assert.equal(room.policyRevision, 1);
  assert.equal(room.policy.limits.maximumParticipants, 12);
  assert.equal(room.policy.authorization.allowWhispers, false);

  const revokedEvent = await room.revokeToken(
    { type: 'token', tokenId: 'token-player-1', expiresAt: Math.floor(Date.now() / 1000) + 300 },
    { reason: 'Compromised browser session' },
  );
  assert.equal(revokedEvent.target.type, 'token');
  assert.equal(revokedEvent.target.tokenId, 'token-player-1');
  assert.equal(revokedEvent.disconnectedSessions, 1);
  assert.equal(revokedEvent.reason, 'Compromised browser session');

  const started = await room.roll('1d20+5', {
    clientRollId: 'attack-1',
    visibility: { type: 'roller' },
  });
  assert.match(started.requestId, /^request_/);
  assert.equal(started.clientRollId, 'attack-1');
  assert.equal(started.result.total, 17);
  assert.equal(started.hidden, false);
  assert.equal(room.getLastEventSequence(), 3);

  const updated = await room.updateRoll(started.rollId, { annotation: 'GM correction' }, {
    expectedRevision: 0,
    animate: false,
  });
  assert.equal(updated.result.revision, 1);
  assert.equal(updated.result.annotation, 'GM correction');

  await assert.rejects(
    room.updateRoll(started.rollId, {}, { expectedRevision: 0 }),
    (error) => error instanceof DiceRoomRequestError
      && error.code === 'revision_conflict'
      && error.currentRevision === 1,
  );

  const revealed = await room.revealRoll(started.rollId, { expectedRevision: 1 });
  assert.equal(revealed.result.revision, 2);
  assert.equal(revealed.visibility.type, 'public');

  const hiddenEventPromise = once(room, 'rollStart');
  MockWebSocket.instances.at(-1).serverSend({
    ...makeRoomEvent({ requestId: undefined, eventSequence: ++globalSequence, rollId: 'secret-other', revision: 0 }),
    hidden: true,
    visibility: { type: 'hidden' },
    result: null,
    actor: actor('other', 'Other'),
    summary: {
      rollId: 'secret-other', sequence: 2, revision: 0, actor: actor('other', 'Other'), createdAt: now,
    },
    animationSeed: undefined,
    serverStartTimeMs: undefined,
    animationDurationMs: undefined,
  });
  const hiddenEvent = await hiddenEventPromise;
  assert.equal(hiddenEvent.hidden, true);
  assert.equal(hiddenEvent.result, null);
  assert.equal(hiddenEvent.animationSeed, undefined);

  const draftroll = new Draftroll();
  const session = await draftroll.connectRoom({
    url: 'ws://draftroll.test/rooms/sdk/connect',
    roomId: 'sdk',
    participant: { participantId: 'dev', sessionId: 'dev-session', name: 'Developer' },
    reconnect: false,
    clockSyncSamples: 1,
    autoPresent: false,
    WebSocketImpl: MockWebSocket,
  });
  const sdkPolicy = await session.setPolicy({ rateLimits: { rollsPerMinutePerRoom: 42 } });
  assert.equal(sdkPolicy.policy.rateLimits.rollsPerMinutePerRoom, 42);
  assert.equal(session.policy.rateLimits.rollsPerMinutePerRoom, 42);

  const sdkRevocation = await session.revokeToken(
    { type: 'participant', participantId: 'removed-player', issuedAtOrBefore: Math.floor(Date.now() / 1000) },
    { reason: 'Removed from table' },
  );
  assert.equal(sdkRevocation.target.type, 'participant');
  assert.equal(sdkRevocation.target.participantId, 'removed-player');

  const handle = await session.roll({ mode: 'evaluate', expression: '2d6+2', name: 'Damage' });
  assert.equal(handle.id, 'roll-1');
  assert.equal(handle.result.total, 17);
  const revised = await handle.updateLog({ annotation: 'Adjusted' });
  assert.equal(revised, handle, 'logical roll handles stay stable across revisions');
  assert.equal(handle.revision, 1);
  assert.equal(handle.result.annotation, 'Adjusted');
  await handle.reveal();
  assert.equal(handle.revision, 2);
  assert.equal(handle.visibility.type, 'public');

  const sent = MockWebSocket.instances.at(-1).sent.map((value) => JSON.parse(value));
  const updateRequest = sent.find((event) => event.type === 'update_roll');
  assert.equal(updateRequest.expectedRevision, 0, 'room handles apply optimistic revision checks by default');
  const visibilityRequest = sent.find((event) => event.type === 'set_roll_visibility');
  assert.equal(visibilityRequest.expectedRevision, 1);

  room.close();
  session.close();

  console.log(JSON.stringify({
    ok: true,
    tested: [
      'signed room capability tokens',
      'encrypted WebSocket token handshake without URL leakage',
      'HTTP bearer-token authorization without URL leakage',
      'issuer and audience validation',
      'key IDs and verification-key rotation',
      'exact and participant token revocation',
      'participant identity',
      'correlated request promises',
      'client roll IDs',
      'hidden projections',
      'revision conflicts',
      'visibility revisions',
      'versioned room policy state and updates',
      'policy revision correlation',
      'stable high-level room handles',
    ],
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

