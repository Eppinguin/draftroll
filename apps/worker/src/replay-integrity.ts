/**
 * Storage/replay correlation checks shared by the worker persistence boundary.
 *
 * These helpers intentionally validate identity and sequence invariants only. The protocol runtime
 * remains the canonical structural decoder for event payloads.
 */

export interface DurableReplayRow {
  event_sequence: unknown;
  event_json: unknown;
}

export interface DurableReplayWindow {
  roomId: string;
  afterEventSequence: number;
  earliestEventSequence: number;
}

export type DurableReplayIssue =
  | { kind: 'gap'; eventSequence: number; rowIndex: number }
  | { kind: 'corrupt'; eventSequence: number; rowIndex: number; reason: string };

export interface EventBufferSanitization {
  events: unknown[];
  recoverySequence: number | null;
  changed: boolean;
  reason?: string;
}

export interface ReplayEnvelope extends Record<string, unknown> {
  afterEventSequence?: unknown;
  nextAfterEventSequence?: unknown;
  latestEventSequence?: unknown;
  earliestEventSequence?: unknown;
  recoveryBlockedAtEventSequence?: unknown;
  events?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function fallbackRecoverySequence(latestEventSequence: number): number {
  return Math.max(1, latestEventSequence);
}

function failedBuffer(
  prefix: unknown[],
  recoverySequence: number,
  reason: string,
): EventBufferSanitization {
  return { events: prefix, recoverySequence, changed: true, reason };
}

/**
 * Keeps only the contiguous, room-correlated prefix of a persisted Durable Object event buffer.
 *
 * The first invalid slot becomes the recovery marker. Events after that slot are deliberately
 * discarded from the hot buffer so clients can only recover them through the durable replay path.
 * A persisted hot buffer must also reach the current room head; otherwise callers could mistake a
 * stale but internally contiguous snapshot for complete replay coverage.
 */
export function sanitizeEventBuffer(
  stored: unknown,
  roomId: string,
  latestEventSequence: number,
): EventBufferSanitization {
  if (stored === undefined) return { events: [], recoverySequence: null, changed: false };
  if (!Array.isArray(stored)) {
    return failedBuffer(
      [],
      fallbackRecoverySequence(latestEventSequence),
      'Stored event buffer is not an array',
    );
  }

  const prefix: unknown[] = [];
  let previousSequence: number | undefined;

  for (const event of stored) {
    const expectedSequence = previousSequence === undefined ? undefined : previousSequence + 1;
    if (!isRecord(event)) {
      return failedBuffer(
        prefix,
        expectedSequence ?? fallbackRecoverySequence(latestEventSequence),
        'Stored event buffer contains a non-object event',
      );
    }

    const sequence = event.eventSequence;
    if (!isPositiveSafeInteger(sequence)) {
      return failedBuffer(
        prefix,
        expectedSequence ?? fallbackRecoverySequence(latestEventSequence),
        'Stored event buffer contains an invalid event sequence',
      );
    }
    if (event.roomId !== roomId) {
      return failedBuffer(
        prefix,
        sequence,
        'Stored event buffer contains an event for another room',
      );
    }
    if (sequence > latestEventSequence) {
      return failedBuffer(
        prefix,
        expectedSequence ?? fallbackRecoverySequence(latestEventSequence),
        'Stored event buffer advances beyond the room event sequence',
      );
    }
    if (expectedSequence !== undefined && sequence !== expectedSequence) {
      return failedBuffer(
        prefix,
        expectedSequence,
        'Stored event buffer contains a sequence gap, duplicate, or reordering',
      );
    }

    prefix.push(event);
    previousSequence = sequence;
  }

  if (latestEventSequence > 0 && previousSequence !== latestEventSequence) {
    return failedBuffer(
      [...stored],
      previousSequence === undefined
        ? fallbackRecoverySequence(latestEventSequence)
        : previousSequence + 1,
      'Stored event buffer does not reach the room event sequence',
    );
  }

  return { events: [...stored], recoverySequence: null, changed: false };
}

function parseStoredReplayEvent(row: DurableReplayRow): Record<string, unknown> | null {
  if (typeof row.event_json !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(row.event_json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Returns the first D1 replay sequence that is absent or cannot be trusted.
 *
 * `rowIndex` is the number of leading rows that are safe to consume before the issue. A gap before
 * the earliest retained row is expected retention truncation. A gap inside the retained range is
 * treated as a recoverable persistence stall because event writes are asynchronous. Invalid row
 * identities, duplicate/reordered rows, and malformed serialized events are corruption and fail
 * closed.
 */
export function findDurableReplayIssue(
  rows: readonly DurableReplayRow[],
  window: DurableReplayWindow,
): DurableReplayIssue | null {
  const retentionTruncated =
    window.afterEventSequence > 0 && window.afterEventSequence < window.earliestEventSequence - 1;
  let expectedSequence =
    window.afterEventSequence === 0 || retentionTruncated
      ? Math.max(1, window.earliestEventSequence)
      : window.afterEventSequence + 1;

  for (const [rowIndex, row] of rows.entries()) {
    if (!isPositiveSafeInteger(row.event_sequence)) {
      return {
        kind: 'corrupt',
        eventSequence: expectedSequence,
        rowIndex,
        reason: 'D1 replay row has an invalid event sequence',
      };
    }
    if (row.event_sequence > expectedSequence) {
      return { kind: 'gap', eventSequence: expectedSequence, rowIndex };
    }
    if (row.event_sequence < expectedSequence) {
      return {
        kind: 'corrupt',
        eventSequence: expectedSequence,
        rowIndex,
        reason: 'D1 replay rows are duplicated or out of order',
      };
    }

    const event = parseStoredReplayEvent(row);
    if (!event) {
      return {
        kind: 'corrupt',
        eventSequence: row.event_sequence,
        rowIndex,
        reason: 'D1 replay row does not contain a valid serialized event object',
      };
    }
    if (event.roomId !== window.roomId) {
      return {
        kind: 'corrupt',
        eventSequence: row.event_sequence,
        rowIndex,
        reason: 'D1 replay row room identity does not match its query scope',
      };
    }
    if (event.eventSequence !== row.event_sequence) {
      return {
        kind: 'corrupt',
        eventSequence: row.event_sequence,
        rowIndex,
        reason: 'D1 replay row sequence does not match its serialized event',
      };
    }

    expectedSequence = row.event_sequence + 1;
  }

  // A missing tail can be normal persistence lag because D1 writes are asynchronous. Absence at
  // the tail remains a recoverable stall in the client's existing no-progress handling.
  return null;
}

function eventSequenceOf(value: unknown): number | null {
  if (!isRecord(value)) return null;
  return isPositiveSafeInteger(value.eventSequence) ? value.eventSequence : null;
}

function clampReplayEnvelope(
  envelope: ReplayEnvelope,
  stopBeforeEventSequence: number,
): ReplayEnvelope {
  const afterEventSequence = isNonNegativeSafeInteger(envelope.afterEventSequence)
    ? envelope.afterEventSequence
    : 0;
  const currentCursor = isNonNegativeSafeInteger(envelope.nextAfterEventSequence)
    ? envelope.nextAfterEventSequence
    : afterEventSequence;
  const events = Array.isArray(envelope.events)
    ? envelope.events.filter((event) => {
        const sequence = eventSequenceOf(event);
        return sequence !== null && sequence < stopBeforeEventSequence;
      })
    : [];

  return {
    ...envelope,
    events,
    nextAfterEventSequence: Math.max(
      afterEventSequence,
      Math.min(currentCursor, stopBeforeEventSequence - 1),
    ),
    hasMore: true,
  };
}

/** Stops a replay page before a missing sequence without classifying async lag as corruption. */
export function stallReplayEnvelope(
  envelope: ReplayEnvelope,
  missingEventSequence: number,
): ReplayEnvelope {
  return clampReplayEnvelope(envelope, missingEventSequence);
}

/** Applies a fail-closed recovery marker without exposing events at or beyond the corrupt slot. */
export function hardenReplayEnvelope(
  envelope: ReplayEnvelope,
  blockedAtEventSequence: number,
): ReplayEnvelope {
  const hardened = clampReplayEnvelope(envelope, blockedAtEventSequence);
  const existingBlock = isPositiveSafeInteger(envelope.recoveryBlockedAtEventSequence)
    ? envelope.recoveryBlockedAtEventSequence
    : blockedAtEventSequence;
  return {
    ...hardened,
    recoveryBlockedAtEventSequence: Math.min(existingBlock, blockedAtEventSequence),
  };
}
