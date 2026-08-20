/**
 * Worker entrypoint and persistence-boundary hardening.
 *
 * The room implementation stays in `index.ts`. This deployment entrypoint validates persisted
 * replay identity/continuity before the implementation caches Durable Object state. It also
 * independently verifies the D1 replay window before an events response leaves the worker.
 */

import RoomWorker, { DiceRoomObject as RoomObject } from './index';
import {
  findDurableReplayIssue,
  hardenReplayEnvelope,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  sanitizeEventBuffer,
  stallReplayEnvelope,
  type DurableReplayRow,
  type ReplayEnvelope,
} from './replay-integrity';

export default RoomWorker;

interface ReplayQueryRow {
  event_sequence: number;
  event_json: string;
}

interface HibernatableWebSocket extends WebSocket {
  deserializeAttachment(): unknown;
}

const DEFAULT_REPLAY_LIMIT = 500;
const MIN_REPLAY_LIMIT = 1;
const MAX_REPLAY_LIMIT = 1_000;

/** Durable Object implementation with fail-closed persistence boundaries. */
export class DiceRoomObject extends RoomObject {
  private readonly boundaryState: DurableObjectState;
  private readonly boundaryDb: D1Database;
  private replayBoundaryInitialized = false;

  constructor(...args: ConstructorParameters<typeof RoomObject>) {
    super(...args);
    this.boundaryState = args[0];
    this.boundaryDb = args[1].DB;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomId = roomIdFromUrl(url);
    if (roomId !== null && !this.replayBoundaryInitialized) {
      await this.initializeReplayBoundary(roomId);
    }

    const response = await super.fetch(request);
    if (
      roomId === null ||
      request.method !== 'GET' ||
      !url.pathname.endsWith('/events') ||
      !response.ok
    ) {
      return response;
    }
    return this.hardenDurableReplayResponse(response, roomId, url);
  }

  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const roomId = roomIdFromSocket(socket);
    if (roomId !== null && !this.replayBoundaryInitialized) {
      await this.initializeReplayBoundary(roomId);
    }
    return super.webSocketMessage(socket, raw);
  }

  private async initializeReplayBoundary(roomId: string): Promise<void> {
    const [stored, latestRaw, markerRaw] = await Promise.all([
      this.boundaryState.storage.get('eventBuffer'),
      this.boundaryState.storage.get('eventSequence'),
      this.boundaryState.storage.get('eventBufferRecoverySequence'),
    ]);
    const latestEventSequence = isNonNegativeSafeInteger(latestRaw) ? latestRaw : 0;
    const sanitized = sanitizeEventBuffer(stored, roomId, latestEventSequence);
    if (sanitized.changed && sanitized.recoverySequence !== null) {
      const recoverySequence = isPositiveSafeInteger(markerRaw)
        ? Math.min(markerRaw, sanitized.recoverySequence)
        : sanitized.recoverySequence;
      await this.boundaryState.storage.put({
        eventBuffer: sanitized.events,
        eventBufferRecoverySequence: recoverySequence,
      });
      logReplayBoundaryFailure('durable_object_buffer', roomId, recoverySequence, sanitized.reason);
    }
    this.replayBoundaryInitialized = true;
  }

  private async hardenDurableReplayResponse(
    response: Response,
    roomId: string,
    url: URL,
  ): Promise<Response> {
    let envelope: ReplayEnvelope;
    try {
      const value: unknown = await response.clone().json();
      if (!isRecord(value)) return response;
      envelope = value;
    } catch {
      return response;
    }

    const afterEventSequence = parseNonNegativeInteger(
      url.searchParams.get('afterEventSequence'),
      0,
    );
    const limit = clampInteger(
      url.searchParams.get('limit'),
      MIN_REPLAY_LIMIT,
      MAX_REPLAY_LIMIT,
      DEFAULT_REPLAY_LIMIT,
    );
    const earliestEventSequence = isPositiveSafeInteger(envelope.earliestEventSequence)
      ? envelope.earliestEventSequence
      : 1;

    const query = await this.boundaryDb
      .prepare(`
        SELECT event_sequence, event_json
        FROM room_events
        WHERE room_id = ? AND event_sequence > ?
        ORDER BY event_sequence ASC
        LIMIT ?
      `)
      .bind(roomId, afterEventSequence, limit)
      .all<ReplayQueryRow>();
    const rows: DurableReplayRow[] = (query.results ?? []).map((row) => ({
      event_sequence: row.event_sequence,
      event_json: row.event_json,
    }));
    const replayIssue = findDurableReplayIssue(rows, {
      roomId,
      afterEventSequence,
      earliestEventSequence,
    });
    if (replayIssue === null) return response;

    if (replayIssue.kind === 'gap') {
      logReplayBoundaryStall(roomId, replayIssue.eventSequence);
      const stalled = stallReplayEnvelope(envelope, replayIssue.eventSequence);
      return replayResponse(response, stalled);
    }

    logReplayBoundaryFailure('d1_replay', roomId, replayIssue.eventSequence, replayIssue.reason);
    const hardened = hardenReplayEnvelope(envelope, replayIssue.eventSequence);
    return replayResponse(response, hardened);
  }
}

function roomIdFromUrl(url: URL): string | null {
  const match = /^\/rooms\/([^/]+)\//.exec(url.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function roomIdFromSocket(socket: WebSocket): string | null {
  try {
    // The Workers runtime provides this hibernation helper; the standard WebSocket type omits it.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const attachment = (socket as HibernatableWebSocket).deserializeAttachment();
    return isRecord(attachment) && typeof attachment.roomId === 'string' ? attachment.roomId : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseNonNegativeInteger(value: string | null, fallback: number): number {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return isNonNegativeSafeInteger(parsed) ? parsed : fallback;
}

function clampInteger(
  value: string | null,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function replayResponse(response: Response, envelope: ReplayEnvelope): Response {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(envelope), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function logReplayBoundaryStall(roomId: string, eventSequence: number): void {
  console.warn(
    JSON.stringify({
      event: 'room.replay_boundary_stalled',
      source: 'd1_replay',
      roomId,
      eventSequence,
      reason: 'D1 replay sequence is not persisted yet',
    }),
  );
}

function logReplayBoundaryFailure(
  source: 'durable_object_buffer' | 'd1_replay',
  roomId: string,
  recoverySequence: number,
  reason?: string,
): void {
  console.error(
    JSON.stringify({
      event: 'room.replay_boundary_invalid',
      source,
      roomId,
      recoverySequence,
      reason,
    }),
  );
}
