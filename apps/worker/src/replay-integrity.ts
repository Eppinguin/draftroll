/**
 * Storage/replay correlation checks shared by the worker persistence boundary.
 *
 * These helpers intentionally validate identity and sequence invariants only. The protocol runtime
 * remains the canonical structural decoder for event payloads.
 */

const MAXIMUM_STORED_REPLAY_EVENT_BYTES = 512 * 1024;
const encoder = new TextEncoder();

export interface DurableReplayRow {
  event_sequence: unknown;
  event_json: unknown;
}

export interface DurableReplayWindow {
  roomId: string;
  afterEventSequence: number;
  earliestEventSequence: number;
  /** Authoritative Durable Object event head when available. */
  latestEventSequence?: number;
}

export type DurableReplayIssue =
  | { kind: 'gap'; eventSequence: number; rowIndex: number }
  | { kind: 'corrupt'; eventSequence: number; rowIndex: number; reason: string };

export interface ParsedDurableReplayRow {
  eventSequence: number;
  event: Record<string, unknown>;
}

export interface DurableReplayScan {
  rows: ParsedDurableReplayRow[];
  issue: DurableReplayIssue | null;
}

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

function failedBuffer(recoverySequence: number, reason: string): EventBufferSanitization {
  // The Durable Object caller intentionally quarantines the whole hot buffer once continuity is
  // uncertain. Returning a prefix here suggested a recovery contract the caller could not safely
  // honor and caused two different notions of "sanitized" state.
  return { events: [], recoverySequence, changed: true, reason };
}

/**
 * Validates a persisted Durable Object event buffer as one contiguous room-local snapshot.
 *
 * The hot buffer is all-or-quarantine: if any slot is invalid, discontinuous, belongs to another
 * room, advances beyond the room head, or fails to reach that head, no prefix is returned. The
 * first untrusted sequence becomes the durable-recovery marker.
 */
export function sanitizeEventBuffer(
  stored: unknown,
  roomId: string,
  latestEventSequence: number,
): EventBufferSanitization {
  if (stored === undefined) return { events: [], recoverySequence: null, changed: false };
  if (!Array.isArray(stored)) {
    return failedBuffer(
      fallbackRecoverySequence(latestEventSequence),
      'Stored event buffer is not an array',
    );
  }

  let previousSequence: number | undefined;
  for (const event of stored) {
    const expectedSequence = previousSequence === undefined ? undefined : previousSequence + 1;
    if (!isRecord(event)) {
      return failedBuffer(
        expectedSequence ?? fallbackRecoverySequence(latestEventSequence),
        'Stored event buffer contains a non-object event',
      );
    }

    const sequence = event.eventSequence;
    if (!isPositiveSafeInteger(sequence)) {
      return failedBuffer(
        expectedSequence ?? fallbackRecoverySequence(latestEventSequence),
        'Stored event buffer contains an invalid event sequence',
      );
    }
    if (event.roomId !== roomId) {
      return failedBuffer(sequence, 'Stored event buffer contains an event for another room');
    }
    if (sequence > latestEventSequence) {
      return failedBuffer(
        expectedSequence ?? fallbackRecoverySequence(latestEventSequence),
        'Stored event buffer advances beyond the room event sequence',
      );
    }
    if (expectedSequence !== undefined && sequence !== expectedSequence) {
      return failedBuffer(
        expectedSequence,
        'Stored event buffer contains a sequence gap, duplicate, or reordering',
      );
    }

    previousSequence = sequence;
  }

  if (latestEventSequence > 0 && previousSequence !== latestEventSequence) {
    return failedBuffer(
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
  if (encoder.encode(row.event_json).byteLength > MAXIMUM_STORED_REPLAY_EVENT_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(row.event_json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parses and validates the trusted prefix of a D1 replay page.
 *
 * `rowIndex` is the number of leading rows that are safe to consume before the issue. A gap before
 * the earliest retained row is expected retention truncation. A gap inside the retained range is
 * treated as a recoverable persistence stall because event writes are asynchronous. Invalid row
 * identities, duplicate/reordered rows, oversized rows, and malformed serialized events are
 * corruption and fail closed. Parsed events are returned with the scan so the replay consumer does
 * not deserialize the same D1 payload a second time.
 */
export function scanDurableReplayRows(
  rows: readonly DurableReplayRow[],
  window: DurableReplayWindow,
): DurableReplayScan {
  const parsedRows: ParsedDurableReplayRow[] = [];
  const latestEventSequence = window.latestEventSequence;
  if (latestEventSequence !== undefined && window.afterEventSequence > latestEventSequence) {
    return {
      rows: parsedRows,
      issue: {
        kind: 'corrupt',
        eventSequence: nextSequence(latestEventSequence),
        rowIndex: 0,
        reason: 'D1 replay cursor advances beyond the room event sequence',
      },
    };
  }

  const retentionTruncated = window.afterEventSequence < window.earliestEventSequence - 1;
  let expectedSequence =
    window.afterEventSequence === 0 || retentionTruncated
      ? Math.max(1, window.earliestEventSequence)
      : nextSequence(window.afterEventSequence);

  for (const [rowIndex, row] of rows.entries()) {
    if (!isPositiveSafeInteger(row.event_sequence)) {
      return {
        rows: parsedRows,
        issue: {
          kind: 'corrupt',
          eventSequence: expectedSequence,
          rowIndex,
          reason: 'D1 replay row has an invalid event sequence',
        },
      };
    }
    if (latestEventSequence !== undefined && row.event_sequence > latestEventSequence) {
      return {
        rows: parsedRows,
        issue: {
          kind: 'corrupt',
          eventSequence: row.event_sequence,
          rowIndex,
          reason: 'D1 replay row advances beyond the room event sequence',
        },
      };
    }
    if (row.event_sequence > expectedSequence) {
      return {
        rows: parsedRows,
        issue: { kind: 'gap', eventSequence: expectedSequence, rowIndex },
      };
    }
    if (row.event_sequence < expectedSequence) {
      return {
        rows: parsedRows,
        issue: {
          kind: 'corrupt',
          eventSequence: expectedSequence,
          rowIndex,
          reason: 'D1 replay rows are duplicated or out of order',
        },
      };
    }

    const event = parseStoredReplayEvent(row);
    if (!event) {
      return {
        rows: parsedRows,
        issue: {
          kind: 'corrupt',
          eventSequence: row.event_sequence,
          rowIndex,
          reason: 'D1 replay row does not contain a bounded valid serialized event object',
        },
      };
    }
    if (event.roomId !== window.roomId) {
      return {
        rows: parsedRows,
        issue: {
          kind: 'corrupt',
          eventSequence: row.event_sequence,
          rowIndex,
          reason: 'D1 replay row room identity does not match its query scope',
        },
      };
    }
    if (event.eventSequence !== row.event_sequence) {
      return {
        rows: parsedRows,
        issue: {
          kind: 'corrupt',
          eventSequence: row.event_sequence,
          rowIndex,
          reason: 'D1 replay row sequence does not match its serialized event',
        },
      };
    }
    parsedRows.push({ eventSequence: row.event_sequence, event });
    if (row.event_sequence === Number.MAX_SAFE_INTEGER && rowIndex < rows.length - 1) {
      return {
        rows: parsedRows,
        issue: {
          kind: 'corrupt',
          eventSequence: row.event_sequence,
          rowIndex: rowIndex + 1,
          reason: 'D1 replay sequence space is exhausted',
        },
      };
    }

    expectedSequence = nextSequence(row.event_sequence);
  }

  // A missing tail can be normal persistence lag because D1 writes are asynchronous. Absence at
  // the tail remains a recoverable stall in the client's existing no-progress handling.
  return { rows: parsedRows, issue: null };
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

function nextSequence(sequence: number): number {
  return sequence >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Math.max(1, sequence + 1);
}
