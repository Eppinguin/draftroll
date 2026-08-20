/**
 * Worker deployment entrypoint.
 *
 * The Durable Object implementation validates stored replay rows before projection. This outer
 * deployment boundary additionally correlates the emitted replay cursor with the authoritative room
 * head so a stale or inconsistent D1 row can never escape through `/events`.
 */
import worker, { DiceRoomObject as CoreDiceRoomObject } from './index';
import {
  hardenReplayEnvelope,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  type ReplayEnvelope,
} from './replay-integrity';

export default worker;

export class DiceRoomObject extends CoreDiceRoomObject {
  override async fetch(request: Request): Promise<Response> {
    const response = await super.fetch(request);
    if (response.status === 101 || request.method !== 'GET' || !response.ok) return response;

    const url = new URL(request.url);
    if (!url.pathname.endsWith('/events')) return response;
    return hardenDurableReplayResponse(request, response);
  }
}

async function hardenDurableReplayResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const requestedAfter = readRequestedCursor(requestUrl.searchParams.get('afterEventSequence'));
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return blockedReplayResponse(
      response,
      requestUrl,
      requestedAfter,
      nextSequence(requestedAfter),
      'Durable replay response is not valid JSON',
    );
  }

  if (!isRecord(parsed)) {
    return blockedReplayResponse(
      response,
      requestUrl,
      requestedAfter,
      nextSequence(requestedAfter),
      'Durable replay response is not an object',
    );
  }

  const envelope: ReplayEnvelope = parsed;
  const afterEventSequence = isNonNegativeSafeInteger(envelope.afterEventSequence)
    ? envelope.afterEventSequence
    : requestedAfter;
  const latestEventSequence = isNonNegativeSafeInteger(envelope.latestEventSequence)
    ? envelope.latestEventSequence
    : undefined;

  let blockedAtEventSequence: number | undefined;
  let reason: string | undefined;
  const block = (sequence: number, message: string) => {
    if (blockedAtEventSequence === undefined || sequence < blockedAtEventSequence) {
      blockedAtEventSequence = sequence;
      reason = message;
    }
  };

  if (!isNonNegativeSafeInteger(envelope.afterEventSequence)) {
    block(nextSequence(requestedAfter), 'Durable replay response has an invalid cursor');
  } else if (afterEventSequence !== requestedAfter) {
    block(nextSequence(requestedAfter), 'Durable replay response cursor does not match the request');
  }

  if (latestEventSequence === undefined) {
    block(nextSequence(afterEventSequence), 'Durable replay response has an invalid room head');
  } else if (afterEventSequence > latestEventSequence) {
    block(nextSequence(latestEventSequence), 'Durable replay cursor advances beyond the room head');
  }

  if (
    envelope.earliestEventSequence !== undefined &&
    !isPositiveSafeInteger(envelope.earliestEventSequence)
  ) {
    block(nextSequence(afterEventSequence), 'Durable replay response has an invalid retention head');
  }

  if (!isNonNegativeSafeInteger(envelope.nextAfterEventSequence)) {
    block(nextSequence(afterEventSequence), 'Durable replay response has an invalid next cursor');
  } else if (
    latestEventSequence !== undefined &&
    envelope.nextAfterEventSequence > latestEventSequence
  ) {
    block(
      nextSequence(latestEventSequence),
      'Durable replay next cursor advances beyond the room head',
    );
  }

  if (!Array.isArray(envelope.events)) {
    block(nextSequence(afterEventSequence), 'Durable replay response events are not an array');
  } else if (latestEventSequence !== undefined) {
    for (const event of envelope.events) {
      const eventSequence = isRecord(event) ? event.eventSequence : undefined;
      if (!isPositiveSafeInteger(eventSequence)) {
        block(nextSequence(afterEventSequence), 'Durable replay event has an invalid sequence');
        break;
      }
      if (eventSequence > latestEventSequence) {
        block(eventSequence, 'Durable replay event advances beyond the room head');
        break;
      }
    }
  }

  if (
    envelope.recoveryBlockedAtEventSequence !== undefined &&
    !isPositiveSafeInteger(envelope.recoveryBlockedAtEventSequence)
  ) {
    block(nextSequence(afterEventSequence), 'Durable replay response has an invalid corruption marker');
  }

  if (blockedAtEventSequence === undefined) {
    return new Response(raw, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  console.error(
    JSON.stringify({
      level: 'error',
      event: 'room.replay_response_invalid',
      at: new Date().toISOString(),
      roomId: roomIdFromUrl(requestUrl),
      eventSequence: blockedAtEventSequence,
      message: reason,
    }),
  );
  return replayResponse(
    response,
    hardenReplayEnvelope(envelope, blockedAtEventSequence),
  );
}

function blockedReplayResponse(
  response: Response,
  requestUrl: URL,
  afterEventSequence: number,
  blockedAtEventSequence: number,
  reason: string,
): Response {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'room.replay_response_invalid',
      at: new Date().toISOString(),
      roomId: roomIdFromUrl(requestUrl),
      eventSequence: blockedAtEventSequence,
      message: reason,
    }),
  );
  return replayResponse(response, {
    roomId: roomIdFromUrl(requestUrl),
    afterEventSequence,
    nextAfterEventSequence: afterEventSequence,
    latestEventSequence: afterEventSequence,
    hasMore: true,
    recoveryBlockedAtEventSequence: blockedAtEventSequence,
    events: [],
  });
}

function replayResponse(response: Response, envelope: ReplayEnvelope): Response {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(envelope, null, 2), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function readRequestedCursor(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return isNonNegativeSafeInteger(parsed) ? parsed : 0;
}

function nextSequence(sequence: number): number {
  return sequence >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Math.max(1, sequence + 1);
}

function roomIdFromUrl(url: URL): string {
  const match = /^\/rooms\/([^/]+)/.exec(url.pathname);
  return match ? decodeURIComponent(match[1]) : 'unknown-room';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
