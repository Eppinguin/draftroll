import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787';

export async function runSmoke(
  baseUrl = process.env.DRAFTROLL_BASE_URL ?? DEFAULT_BASE_URL,
  options = {},
) {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const roomId = `local-smoke-${Date.now()}`;

  const health = await fetchJson(`${normalizedBase}/health`);
  assert.equal(health.ok, true);
  assert.equal(health.protocolVersion, 2);

  const aria = await connectParticipant(normalizedBase, roomId, {
    participantId: 'aria',
    sessionId: 'aria-session',
    name: 'Aria',
  });
  const bram = await connectParticipant(normalizedBase, roomId, {
    participantId: 'bram',
    sessionId: 'bram-session',
    name: 'Bram',
  });

  const ariaState = await aria.messages.next((event) => event.type === 'room_state');
  const bramState = await bram.messages.next((event) => event.type === 'room_state');
  assert.equal(ariaState.roomId, roomId);
  assert.equal(bramState.participants.length, 2);

  const publicRollRequest = {
    type: 'roll_request',
    requestId: 'public-mixed-roll',
    clientRollId: 'attack-42',
    visibility: { type: 'public' },
    input: {
      mode: 'evaluate',
      name: 'Mara Voss',
      expression: '1d20+1d8+2d6+5 [Mixed physical smoke test]',
      metadata: { actionName: 'Mixed attack' },
    },
  };
  aria.socket.send(JSON.stringify(publicRollRequest));

  const ariaPublic = await aria.messages.next(
    (event) => event.type === 'roll_start' && event.clientRollId === 'attack-42',
  );
  const bramPublic = await bram.messages.next(
    (event) => event.type === 'roll_start' && event.rollId === ariaPublic.rollId,
  );
  assert.equal(ariaPublic.requestId, 'public-mixed-roll');
  assert.equal(
    bramPublic.requestId,
    undefined,
    'request IDs must only be visible to the initiating session',
  );
  assert.equal(bramPublic.hidden, false);
  assert.deepEqual(
    ariaPublic.result.dice.map((die) => die.type),
    ['d20', 'd8', 'd6', 'd6'],
  );

  const secretRollRequest = {
    type: 'roll_request',
    requestId: 'secret-roll',
    visibility: { type: 'roller' },
    input: {
      mode: 'evaluate',
      name: 'Aria',
      expression: '1d20+5',
      metadata: { actionName: 'Secret check' },
    },
  };
  aria.socket.send(JSON.stringify(secretRollRequest));
  const ariaSecret = await aria.messages.next(
    (event) => event.type === 'roll_start' && event.requestId === 'secret-roll',
  );
  const bramSecret = await bram.messages.next(
    (event) => event.type === 'roll_start' && event.rollId === ariaSecret.rollId,
  );
  assert.equal(ariaSecret.hidden, false);
  assert.equal(typeof ariaSecret.result.total, 'number');
  assert.equal(bramSecret.hidden, true);
  assert.equal(bramSecret.result, null);
  assert.equal(bramSecret.animationSeed, undefined);
  assert.equal(bramSecret.serverStartTimeMs, undefined);

  if (options.prepareIdempotencyBoundary) {
    await options.prepareIdempotencyBoundary({
      roomId,
      sessionId: 'aria-session',
      publicEvent: ariaPublic,
      secretEvent: ariaSecret,
    });
  }

  bram.socket.send(
    JSON.stringify({
      type: 'update_roll',
      requestId: 'bram-illegal-update',
      rollId: ariaSecret.rollId,
      expectedRevision: 0,
      animate: false,
      update: { annotation: 'Not allowed' },
    }),
  );
  const denied = await bram.messages.next(
    (event) => event.type === 'roll_error' && event.requestId === 'bram-illegal-update',
  );
  assert.equal(denied.code, 'permission_denied');

  aria.socket.send(
    JSON.stringify({
      type: 'update_roll',
      requestId: 'aria-secret-update',
      rollId: ariaSecret.rollId,
      expectedRevision: 0,
      animate: false,
      update: { annotation: 'Private correction' },
    }),
  );
  const ariaUpdated = await aria.messages.next(
    (event) => event.type === 'roll_updated' && event.requestId === 'aria-secret-update',
  );
  const bramUpdated = await bram.messages.next(
    (event) => event.type === 'roll_updated' && event.rollId === ariaSecret.rollId,
  );
  assert.equal(ariaUpdated.result.revision, 1);
  assert.equal(bramUpdated.result, null);

  aria.socket.send(
    JSON.stringify({
      type: 'update_roll',
      requestId: 'stale-update',
      rollId: ariaSecret.rollId,
      expectedRevision: 0,
      animate: false,
      update: {},
    }),
  );
  const conflict = await aria.messages.next(
    (event) => event.type === 'roll_error' && event.requestId === 'stale-update',
  );
  assert.equal(conflict.code, 'revision_conflict');
  assert.equal(conflict.currentRevision, 1);

  aria.socket.send(
    JSON.stringify({
      type: 'set_roll_visibility',
      requestId: 'reveal-secret',
      rollId: ariaSecret.rollId,
      expectedRevision: 1,
      visibility: { type: 'public' },
    }),
  );
  const ariaReveal = await aria.messages.next(
    (event) => event.type === 'roll_visibility_updated' && event.requestId === 'reveal-secret',
  );
  const bramReveal = await bram.messages.next(
    (event) => event.type === 'roll_visibility_updated' && event.rollId === ariaSecret.rollId,
  );
  assert.equal(ariaReveal.result.revision, 2);
  assert.equal(bramReveal.hidden, false);
  assert.equal(typeof bramReveal.result.total, 'number');

  const bramCursor = bramReveal.eventSequence;
  bram.socket.close(1000, 'Reconnect smoke');

  aria.socket.send(
    JSON.stringify({
      type: 'roll_request',
      requestId: 'missed-roll',
      input: { mode: 'evaluate', name: 'Aria', expression: '2d6+3' },
    }),
  );
  const missedRoll = await aria.messages.next(
    (event) => event.type === 'roll_start' && event.requestId === 'missed-roll',
  );

  const bramReconnected = await connectParticipant(normalizedBase, roomId, {
    participantId: 'bram',
    sessionId: 'bram-session',
    name: 'Bram',
    lastEventSequence: bramCursor,
  });
  const recoveredState = await bramReconnected.messages.next(
    (event) => event.type === 'room_state',
  );
  assert.equal(recoveredState.missedEventsTruncated, false);
  assert.ok(recoveredState.recentRolls.some((event) => event.rollId === missedRoll.rollId));

  const historyUrl = authorizedHttpUrl(normalizedBase, roomId, 'history', {
    participantId: 'bram',
    sessionId: 'bram-session',
    name: 'Bram',
  });
  historyUrl.searchParams.set('limit', '10');
  const history = await poll(async () => {
    const response = await fetchJson(historyUrl);
    return response.rolls?.length >= 3 ? response : null;
  }, 5_000);
  const revealedHistory = history.rolls.find((entry) => entry.rollId === ariaSecret.rollId);
  assert.equal(revealedHistory.hidden, false);
  assert.equal(revealedHistory.revision, 2);

  const revisionsUrl = authorizedHttpUrl(
    normalizedBase,
    roomId,
    `rolls/${ariaSecret.rollId}/revisions`,
    {
      participantId: 'bram',
      sessionId: 'bram-session',
      name: 'Bram',
    },
  );
  const revisions = await poll(async () => {
    const response = await fetchJson(revisionsUrl);
    return response.revisions?.length >= 3 ? response : null;
  }, 5_000);
  assert.deepEqual(
    revisions.revisions.map((entry) => entry.revision),
    [0, 1, 2],
  );
  assert.equal(
    revisions.revisions[0].hidden,
    true,
    'older secret revisions remain permission-projected',
  );
  assert.equal(revisions.revisions[2].hidden, false);

  let idempotencyReplayRoll;
  let corruptReplayCode;
  if (options.prepareIdempotencyBoundary) {
    // The local integration test runs with a 10-event Durable Object buffer. Enough new events
    // force both retained responses out of that buffer while their request-cache entries remain.
    for (let index = 0; index < 12; index += 1) {
      const requestId = `idempotency-filler-${index}`;
      aria.socket.send(
        JSON.stringify({
          type: 'roll_request',
          requestId,
          input: { mode: 'evaluate', name: 'Aria', expression: '1d4' },
        }),
      );
      await aria.messages.next(
        (event) => event.type === 'roll_start' && event.requestId === requestId,
      );
    }

    aria.socket.send(JSON.stringify(publicRollRequest));
    const replayedPublic = await aria.messages.next(
      (event) =>
        event.requestId === publicRollRequest.requestId &&
        (event.type === 'roll_start' || event.type === 'roll_error'),
    );
    assert.equal(replayedPublic.type, 'roll_start');
    assert.equal(replayedPublic.rollId, ariaPublic.rollId);
    assert.equal(replayedPublic.replayed, true);
    idempotencyReplayRoll = replayedPublic.rollId;

    aria.socket.send(JSON.stringify(secretRollRequest));
    const rejectedSecret = await aria.messages.next(
      (event) =>
        event.requestId === secretRollRequest.requestId &&
        (event.type === 'roll_start' || event.type === 'roll_error'),
    );
    assert.equal(rejectedSecret.type, 'roll_error');
    assert.equal(rejectedSecret.code, 'idempotency_replay_unavailable');
    corruptReplayCode = rejectedSecret.code;
  }

  aria.socket.close(1000, 'Smoke complete');
  bramReconnected.socket.close(1000, 'Smoke complete');

  const summary = {
    ok: true,
    baseUrl: normalizedBase,
    roomId,
    publicRoll: ariaPublic.rollId,
    secretRoll: ariaSecret.rollId,
    revealedRevision: ariaReveal.result.revision,
    recoveredFromEventSequence: bramCursor,
    persistedRolls: history.rolls.length,
    persistedRevisions: revisions.revisions.length,
    idempotencyReplayRoll,
    corruptReplayCode,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function connectParticipant(baseUrl, roomId, participant) {
  const websocketUrl = new URL(`${baseUrl}/rooms/${encodeURIComponent(roomId)}/connect`);
  websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  websocketUrl.searchParams.set('protocolVersion', '2');
  websocketUrl.searchParams.set('participantId', participant.participantId);
  websocketUrl.searchParams.set('sessionId', participant.sessionId);
  websocketUrl.searchParams.set('name', participant.name);
  if (participant.lastEventSequence !== undefined) {
    websocketUrl.searchParams.set('lastEventSequence', String(participant.lastEventSequence));
  }
  const socket = new WebSocket(websocketUrl);
  const messages = createMessageQueue(socket);
  await waitForOpen(socket);
  const ready = await messages.next((event) => event.type === 'session_ready');
  assert.equal(ready.participant.participantId, participant.participantId);
  return { socket, messages };
}

function authorizedHttpUrl(baseUrl, roomId, path, participant) {
  const url = new URL(`${baseUrl}/rooms/${encodeURIComponent(roomId)}/${path}`);
  url.searchParams.set('protocolVersion', '2');
  url.searchParams.set('participantId', participant.participantId);
  url.searchParams.set('sessionId', participant.sessionId);
  url.searchParams.set('name', participant.name);
  return url;
}

function createMessageQueue(socket) {
  const buffered = [];
  const waiters = [];
  socket.addEventListener('message', async (message) => {
    const text = await messageDataToText(message.data);
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(event));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(event);
      return;
    }
    buffered.push(event);
  });
  return {
    next(predicate, timeoutMs = 5_000) {
      const bufferedIndex = buffered.findIndex(predicate);
      if (bufferedIndex >= 0) return Promise.resolve(buffered.splice(bufferedIndex, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timeout: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(new Error(`Timed out waiting for WebSocket event after ${timeoutMs}ms`));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
  };
}

function waitForOpen(socket, timeoutMs = 5_000) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out opening WebSocket')), timeoutMs);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket connection failed'));
      },
      { once: true },
    );
  });
}

async function messageDataToText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (data && typeof data.text === 'function') return data.text();
  return String(data);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
  return JSON.parse(text);
}

async function poll(operation, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError !== undefined) {
    throw lastError instanceof Error
      ? lastError
      : new Error(typeof lastError === 'string' ? lastError : JSON.stringify(lastError), {
          cause: lastError,
        });
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  runSmoke().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
