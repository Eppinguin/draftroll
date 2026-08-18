/**
 * Runtime validation facade that keeps legacy migration explicit and type guards sound.
 *
 * @remarks
 * The implementation lives in `runtime-internal`. Public decoders preserve legacy migration by
 * default, while strict decoding and type predicates only accept values that already carry the
 * current normalized-result schema version.
 */

export * from './runtime-internal';

import type { NormalizedRollResult, ServerToClientEvent } from './index';
import {
  DraftrollValidationError,
  decodeNormalizedRollResult as decodeNormalizedRollResultInternal,
  decodeServerToClientEvent as decodeServerToClientEventInternal,
  unwrapDecode,
  type DecodeOptions,
  type DecodeResult,
  type RuntimeValidationIssue,
} from './runtime-internal';
import { DRAFTROLL_RESULT_SCHEMA_VERSION } from './version';

/**
 * Decodes and validates a normalized roll result.
 *
 * @remarks
 * Legacy results are migrated on a detached copy when `allowLegacyResults` is enabled. Strict
 * decoding rejects an otherwise-valid legacy result instead of silently narrowing it to the
 * current schema.
 *
 * @public
 */
export function decodeNormalizedRollResult(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<NormalizedRollResult> {
  const decoded = decodeNormalizedRollResultInternal(value, options);
  if (
    decoded.success &&
    (options.allowLegacyResults ?? true) === false &&
    isRecord(value) &&
    value.schemaVersion === undefined
  ) {
    return schemaVersionFailure(
      'Normalized roll result is missing its schema version',
      '$.schemaVersion',
    );
  }
  return decoded;
}

/**
 * Validates a normalized roll result and throws its structured validation error when invalid.
 *
 * @public
 */
export function assertNormalizedRollResult(
  value: unknown,
  options: DecodeOptions = {},
): NormalizedRollResult {
  return unwrapDecode(decodeNormalizedRollResult(value, options));
}

/**
 * Migrates a normalized roll result to the current schema on a detached copy.
 *
 * @public
 */
export function migrateNormalizedRollResult(value: unknown): NormalizedRollResult {
  return assertNormalizedRollResult(value, { allowLegacyResults: true });
}

/**
 * Decodes and validates a server-to-client event.
 *
 * @remarks
 * Strict decoding rejects otherwise-valid events that contain legacy normalized results anywhere
 * in the replayable room-roll payloads.
 *
 * @public
 */
export function decodeServerToClientEvent(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<ServerToClientEvent> {
  const decoded = decodeServerToClientEventInternal(value, options);
  if (decoded.success && (options.allowLegacyResults ?? true) === false) {
    const missingSchemaPath = findMissingNormalizedResultSchemaPath(value);
    if (missingSchemaPath) {
      return schemaVersionFailure(
        'Server event contains a normalized roll result without a schema version',
        missingSchemaPath,
      );
    }
  }
  return decoded;
}

/**
 * Determines whether a value is a current-schema server-to-client event.
 *
 * @public
 */
export function isServerToClientEvent(value: unknown): value is ServerToClientEvent {
  return decodeServerToClientEvent(value, { allowLegacyResults: false }).success;
}

/**
 * Determines whether a value is a current-schema normalized roll result.
 *
 * @public
 */
export function isNormalizedRollResult(value: unknown): value is NormalizedRollResult {
  return decodeNormalizedRollResult(value, { allowLegacyResults: false }).success;
}

function schemaVersionFailure<T>(message: string, path: string): DecodeResult<T> {
  const problem: RuntimeValidationIssue = {
    code: 'invalid_result_schema_version',
    path,
    message,
    expected: String(DRAFTROLL_RESULT_SCHEMA_VERSION),
    received: 'missing',
  };
  return {
    success: false,
    error: new DraftrollValidationError(message, [problem]),
  };
}

function findMissingNormalizedResultSchemaPath(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const direct = findMissingRoomRollResultSchemaPath(value, '$');
  if (direct || value.type !== 'room_state') return direct;

  for (const [field, candidate] of [
    ['recentEvents', value.recentEvents],
    ['recentRolls', value.recentRolls],
  ] as const) {
    if (!Array.isArray(candidate)) continue;
    for (let index = 0; index < candidate.length; index += 1) {
      const nested = findMissingRoomRollResultSchemaPath(candidate[index], `$.${field}.${index}`);
      if (nested) return nested;
    }
  }

  return findMissingRoomRollResultSchemaPath(value.recentRoll, '$.recentRoll');
}

function findMissingRoomRollResultSchemaPath(value: unknown, path: string): string | null {
  if (!isRecord(value)) return null;
  if (
    value.type !== 'roll_start' &&
    value.type !== 'roll_updated' &&
    value.type !== 'roll_visibility_updated'
  ) {
    return null;
  }
  return isRecord(value.result) && value.result.schemaVersion === undefined
    ? `${path}.result.schemaVersion`
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
