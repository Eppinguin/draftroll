export * from './implementation';

import { parseRuntimeJson } from '../../protocol/src/index';
import { DiceRoom as CoreDiceRoom, type DiceRoomOptions } from './implementation';

const LONG_RANGE_RECOVERY_MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;
const LONG_RANGE_RECOVERY_DEFAULT_PAGE_LIMIT = 1_000;

type DiceRoomPublic = Pick<CoreDiceRoom, keyof CoreDiceRoom>;
type DiceRoomBaseConstructor = new (options: DiceRoomOptions) => DiceRoomPublic;

// The implementation keeps construction private because callers use `DiceRoom.connect()`. The
// public facade deliberately reuses that constructor so it can install transport boundaries before
// the inherited connection lifecycle starts.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const DiceRoomBase = CoreDiceRoom as unknown as DiceRoomBaseConstructor;

interface RecoveryTransportState {
  blocked: boolean;
  socket: WebSocket | null;
}

interface CoreDiceRoomTransportMethods {
  handleMessage(raw: unknown): Promise<void>;
}

// `handleMessage` is an implementation detail. The facade only gates invocation; decoding and state
// mutation remain owned by the core implementation.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const coreHandleMessage = (CoreDiceRoom.prototype as unknown as CoreDiceRoomTransportMethods)
  .handleMessage;

/**
 * Maintains a validated, recoverable connection to a Draftroll room.
 *
 * The public facade installs bounded durable-recovery transport guards before delegating to the
 * implementation. Recoverable persistence stalls close the affected socket and suppress queued
 * messages until a replacement socket opens, so the event cursor cannot jump across a missing row.
 *
 * @public
 */
export class DiceRoom extends DiceRoomBase {
  private readonly recoveryTransportState: RecoveryTransportState;

  private constructor(options: DiceRoomOptions) {
    const state = createRecoveryTransportState();
    super(withRecoveryTransportBoundary(options, state));
    this.recoveryTransportState = state;
  }

  /** Creates and opens a validated realtime room connection. */
  static async connect(options: DiceRoomOptions): Promise<DiceRoom> {
    const room = new DiceRoom(options);
    await room.connect(options.signal);
    return room;
  }

  private handleMessage(raw: unknown): Promise<void> {
    if (this.recoveryTransportState.blocked) return Promise.resolve();
    return coreHandleMessage.call(this, raw);
  }
}

function createRecoveryTransportState(): RecoveryTransportState {
  return { blocked: false, socket: null };
}

function withRecoveryTransportBoundary(
  options: DiceRoomOptions,
  state: RecoveryTransportState,
): DiceRoomOptions {
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return {
    ...options,
    WebSocketImpl: createRecoveryWebSocket(WebSocketImpl, state),
    fetchImpl: createRecoveryFetch(fetchImpl, state),
  };
}

function createRecoveryWebSocket(
  WebSocketImpl: typeof WebSocket,
  state: RecoveryTransportState,
): typeof WebSocket {
  class RecoveryWebSocket extends WebSocketImpl {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (protocols === undefined) super(url);
      else super(url, protocols);
      state.socket = this;
      this.addEventListener(
        'open',
        () => {
          if (state.socket === this) state.blocked = false;
        },
        { once: true },
      );
    }
  }
  return RecoveryWebSocket;
}

function createRecoveryFetch(
  fetchImpl: typeof fetch,
  state: RecoveryTransportState,
): typeof fetch {
  return async (input, init) => {
    const initialUrl = requestUrl(input);
    if (!initialUrl || !initialUrl.pathname.endsWith('/events')) return fetchImpl(input, init);

    let url = initialUrl;
    let pageLimit = readPageLimit(url.searchParams.get('limit'));
    while (true) {
      const response = await fetchImpl(url, init);
      if (!response.ok) return response;

      let raw: Uint8Array;
      try {
        raw = await readBoundedResponseBody(response, LONG_RANGE_RECOVERY_MAXIMUM_RESPONSE_BYTES);
      } catch (error) {
        if (error instanceof RecoveryPayloadTooLargeError && pageLimit > 1) {
          pageLimit = Math.max(1, Math.floor(pageLimit / 2));
          url = new URL(url);
          url.searchParams.set('limit', String(pageLimit));
          continue;
        }
        state.blocked = true;
        return corruptRecoveryResponse(
          response,
          url,
          nextSequence(readRequestedCursor(url)),
          error instanceof Error ? error.message : 'Durable recovery response is too large',
        );
      }

      const parsed = parseRuntimeJson(raw, {
        maximumBytes: LONG_RANGE_RECOVERY_MAXIMUM_RESPONSE_BYTES,
      });
      if (!parsed.success) {
        state.blocked = true;
        return corruptRecoveryResponse(
          response,
          url,
          nextSequence(readRequestedCursor(url)),
          parsed.error.message,
        );
      }

      const inspection = inspectRecoveryEnvelope(parsed.data, url, pageLimit);
      if (inspection.corruptAtEventSequence !== undefined) {
        state.blocked = true;
        return corruptRecoveryResponse(
          response,
          url,
          inspection.corruptAtEventSequence,
          inspection.reason ?? 'Durable recovery response failed boundary validation',
          inspection.latestEventSequence,
        );
      }
      if (inspection.recoveryBlockedAtEventSequence !== undefined) state.blocked = true;
      if (inspection.stalled) blockRecoverably(state);

      return new Response(raw, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
  };
}

interface RecoveryInspection {
  latestEventSequence?: number;
  recoveryBlockedAtEventSequence?: number;
  corruptAtEventSequence?: number;
  reason?: string;
  stalled: boolean;
}

function inspectRecoveryEnvelope(
  value: unknown,
  requestUrlValue: URL,
  pageLimit: number,
): RecoveryInspection {
  const requestedAfter = readRequestedCursor(requestUrlValue);
  const corrupt = (
    eventSequence: number,
    reason: string,
    latestEventSequence?: number,
  ): RecoveryInspection => ({
    latestEventSequence,
    corruptAtEventSequence: eventSequence,
    reason,
    stalled: false,
  });

  if (!isRecord(value)) {
    return corrupt(nextSequence(requestedAfter), 'Durable recovery response is not an object');
  }
  const envelope = value;

  if (envelope.roomId !== undefined) {
    const expectedRoomId = roomIdFromRecoveryUrl(requestUrlValue);
    if (typeof envelope.roomId !== 'string' || envelope.roomId !== expectedRoomId) {
      return corrupt(nextSequence(requestedAfter), 'Durable recovery room identity does not match');
    }
  }
  if (
    envelope.afterEventSequence !== undefined &&
    (!isNonNegativeSafeInteger(envelope.afterEventSequence) ||
      envelope.afterEventSequence !== requestedAfter)
  ) {
    return corrupt(nextSequence(requestedAfter), 'Durable recovery cursor does not match the request');
  }
  if (envelope.hasMore !== undefined && typeof envelope.hasMore !== 'boolean') {
    return corrupt(nextSequence(requestedAfter), 'Durable recovery hasMore flag is invalid');
  }

  const latestEventSequence =
    envelope.latestEventSequence === undefined
      ? undefined
      : isNonNegativeSafeInteger(envelope.latestEventSequence)
        ? envelope.latestEventSequence
        : null;
  if (latestEventSequence === null) {
    return corrupt(nextSequence(requestedAfter), 'Durable recovery room head is invalid');
  }
  if (latestEventSequence !== undefined && requestedAfter > latestEventSequence) {
    return corrupt(
      nextSequence(latestEventSequence),
      'Durable recovery cursor advances beyond the room head',
      latestEventSequence,
    );
  }

  const nextAfterEventSequence =
    envelope.nextAfterEventSequence === undefined
      ? undefined
      : isNonNegativeSafeInteger(envelope.nextAfterEventSequence)
        ? envelope.nextAfterEventSequence
        : null;
  if (nextAfterEventSequence === null) {
    return corrupt(
      nextSequence(requestedAfter),
      'Durable recovery next cursor is invalid',
      latestEventSequence,
    );
  }
  if (nextAfterEventSequence !== undefined && nextAfterEventSequence < requestedAfter) {
    return corrupt(
      nextSequence(requestedAfter),
      'Durable recovery cursor moved backwards',
      latestEventSequence,
    );
  }
  if (
    nextAfterEventSequence !== undefined &&
    latestEventSequence !== undefined &&
    nextAfterEventSequence > latestEventSequence
  ) {
    return corrupt(
      nextSequence(latestEventSequence),
      'Durable recovery next cursor advances beyond the room head',
      latestEventSequence,
    );
  }

  if (envelope.events !== undefined && !Array.isArray(envelope.events)) {
    return corrupt(
      nextSequence(requestedAfter),
      'Durable recovery events must be an array',
      latestEventSequence,
    );
  }
  const events = envelope.events ?? [];
  if (events.length > pageLimit) {
    return corrupt(
      nextSequence(requestedAfter),
      `Durable recovery returned ${events.length} events for a page limit of ${pageLimit}`,
      latestEventSequence,
    );
  }

  let lastVisibleEventSequence = requestedAfter;
  for (const event of events) {
    if (!isRecord(event) || !isPositiveSafeInteger(event.eventSequence)) {
      return corrupt(
        nextSequence(lastVisibleEventSequence),
        'Durable recovery event has an invalid sequence',
        latestEventSequence,
      );
    }
    if (event.eventSequence <= lastVisibleEventSequence) {
      return corrupt(
        nextSequence(lastVisibleEventSequence),
        'Durable recovery events are duplicated or out of order',
        latestEventSequence,
      );
    }
    if (latestEventSequence !== undefined && event.eventSequence > latestEventSequence) {
      return corrupt(
        event.eventSequence,
        'Durable recovery event advances beyond the room head',
        latestEventSequence,
      );
    }
    lastVisibleEventSequence = event.eventSequence;
  }

  const derivedNext = nextAfterEventSequence ?? lastVisibleEventSequence;
  if (derivedNext < lastVisibleEventSequence) {
    return corrupt(
      nextSequence(derivedNext),
      'Durable recovery next cursor does not cover its visible events',
      latestEventSequence,
    );
  }

  const recoveryBlockedAtEventSequence =
    envelope.recoveryBlockedAtEventSequence === undefined
      ? undefined
      : isPositiveSafeInteger(envelope.recoveryBlockedAtEventSequence)
        ? envelope.recoveryBlockedAtEventSequence
        : null;
  if (recoveryBlockedAtEventSequence === null) {
    return corrupt(
      nextSequence(requestedAfter),
      'Durable recovery corruption marker is invalid',
      latestEventSequence,
    );
  }

  const hasMore =
    typeof envelope.hasMore === 'boolean'
      ? envelope.hasMore
      : latestEventSequence !== undefined
        ? derivedNext < latestEventSequence
        : events.length >= pageLimit;

  return {
    latestEventSequence,
    recoveryBlockedAtEventSequence,
    stalled:
      recoveryBlockedAtEventSequence === undefined && hasMore && derivedNext <= requestedAfter,
  };
}

function blockRecoverably(state: RecoveryTransportState): void {
  state.blocked = true;
  const socket = state.socket;
  if (!socket || socket.readyState >= WebSocket.CLOSING) return;
  socket.close(1012, 'Long-range room recovery must retry');
}

function corruptRecoveryResponse(
  response: Response,
  requestUrlValue: URL,
  blockedAtEventSequence: number,
  reason: string,
  latestEventSequence?: number,
): Response {
  const afterEventSequence = readRequestedCursor(requestUrlValue);
  const roomId = roomIdFromRecoveryUrl(requestUrlValue);
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'room.client_recovery_boundary_invalid',
      at: new Date().toISOString(),
      roomId,
      eventSequence: blockedAtEventSequence,
      message: reason,
    }),
  );
  return new Response(
    JSON.stringify({
      roomId,
      afterEventSequence,
      nextAfterEventSequence: afterEventSequence,
      latestEventSequence: latestEventSequence ?? Math.max(afterEventSequence, blockedAtEventSequence),
      hasMore: true,
      recoveryBlockedAtEventSequence: blockedAtEventSequence,
      events: [],
    }),
    { status: response.status, statusText: response.statusText, headers },
  );
}

class RecoveryPayloadTooLargeError extends Error {
  constructor(readonly maximumBytes: number) {
    super(`Durable recovery response exceeds ${maximumBytes} bytes`);
    this.name = 'RecoveryPayloadTooLargeError';
  }
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) {
      throw new RecoveryPayloadTooLargeError(maximumBytes);
    }
  }

  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > maximumBytes) throw new RecoveryPayloadTooLargeError(maximumBytes);
    return body;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new RecoveryPayloadTooLargeError(maximumBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    return new URL(input instanceof Request ? input.url : input.toString());
  } catch {
    return null;
  }
}

function readRequestedCursor(url: URL): number {
  const value = Number(url.searchParams.get('afterEventSequence') ?? 0);
  return isNonNegativeSafeInteger(value) ? value : 0;
}

function readPageLimit(value: string | null): number {
  const parsed = Number(value ?? LONG_RANGE_RECOVERY_DEFAULT_PAGE_LIMIT);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return LONG_RANGE_RECOVERY_DEFAULT_PAGE_LIMIT;
  return Math.min(1_000, parsed);
}

function roomIdFromRecoveryUrl(url: URL): string {
  const match = /^\/rooms\/([^/]+)\/events$/.exec(url.pathname);
  return match ? decodeURIComponent(match[1]) : '';
}

function nextSequence(sequence: number): number {
  return sequence >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Math.max(1, sequence + 1);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
