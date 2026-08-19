/**
 * Runtime-safe public protocol facade.
 *
 * Re-exports runtime values explicitly while ensuring object-facing decoders detach untrusted input
 * before structural validation. Type declarations remain sourced from `index.d.ts`, so this module
 * only owns the JavaScript package boundary and does not shadow star exports.
 */

import type {
  ClientToServerEvent,
  DecodeOptions,
  DecodeResult,
  ParticipantIdentityInput,
  RollInput,
  RollUpdateInput,
  RollVisibility,
  RoomCapabilityTokenPayload,
  RoomPolicy,
  RoomPolicyPatch,
} from './index';
import {
  DraftrollValidationError,
  decodeClientToServerEvent as decodeClientToServerEventInternal,
  decodeParticipantIdentityInput as decodeParticipantIdentityInputInternal,
  decodeRollInput as decodeRollInputInternal,
  decodeRollUpdateInput as decodeRollUpdateInputInternal,
  decodeRollVisibility as decodeRollVisibilityInternal,
  decodeRoomCapabilityTokenPayload as decodeRoomCapabilityTokenPayloadInternal,
  decodeRoomPolicy as decodeRoomPolicyInternal,
  decodeRoomPolicyPatch as decodeRoomPolicyPatchInternal,
} from './runtime';

export {
  DRAFTROLL_PROTOCOL_VERSION,
  DRAFTROLL_RESULT_SCHEMA_VERSION,
  DRAFTROLL_SUPPORTED_PROTOCOL_VERSIONS,
} from './version';
export {
  DEFAULT_ROOM_POLICY,
  DRAFTROLL_ROOM_POLICY_SCHEMA_VERSION,
  ROOM_POLICY_PRESETS,
  applyRoomPolicyPatch,
  cloneRoomPolicy,
  createRoomPolicy,
} from './policy';
export {
  DEFAULT_RUNTIME_VALIDATION_LIMITS,
  DraftrollValidationError,
  assertNormalizedRollResult,
  decodeCustomDiceDefinitions,
  decodeNormalizedRollResult,
  decodeServerToClientEvent,
  isNormalizedRollResult,
  isServerToClientEvent,
  migrateNormalizedRollResult,
  negotiateProtocolVersion,
  parseRuntimeJson,
  unwrapDecode,
} from './runtime';

type BoundaryDecoder<T> = (value: unknown, options?: DecodeOptions) => DecodeResult<T>;

function cloneBoundaryValue(value: unknown): DecodeResult<unknown> {
  try {
    return {
      success: true,
      data: value !== null && typeof value === 'object' ? structuredClone(value) : value,
    };
  } catch {
    return {
      success: false,
      error: new DraftrollValidationError('Value cannot be safely cloned for validation', [
        {
          code: 'invalid_value',
          path: '$',
          message: 'Value contains data that cannot cross the runtime boundary',
          expected: 'structured-cloneable data',
        },
      ]),
    };
  }
}

function decodeBoundary<T>(
  value: unknown,
  options: DecodeOptions,
  decoder: BoundaryDecoder<T>,
): DecodeResult<T> {
  const cloned = cloneBoundaryValue(value);
  if (!cloned.success) return cloned;
  return decoder(cloned.data, options);
}

/** Decodes roll visibility from a detached boundary value. @public */
export function decodeRollVisibility(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RollVisibility> {
  return decodeBoundary(value, options, decodeRollVisibilityInternal);
}

/** Decodes room policy from a detached boundary value. @public */
export function decodeRoomPolicy(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RoomPolicy> {
  return decodeBoundary(value, options, decodeRoomPolicyInternal);
}

/** Decodes a room-policy patch from a detached boundary value. @public */
export function decodeRoomPolicyPatch(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RoomPolicyPatch> {
  return decodeBoundary(value, options, decodeRoomPolicyPatchInternal);
}

/** Decodes participant identity from a detached boundary value. @public */
export function decodeParticipantIdentityInput(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<ParticipantIdentityInput> {
  return decodeBoundary(value, options, decodeParticipantIdentityInputInternal);
}

/** Decodes room capability-token claims from a detached boundary value. @public */
export function decodeRoomCapabilityTokenPayload(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RoomCapabilityTokenPayload> {
  return decodeBoundary(value, options, decodeRoomCapabilityTokenPayloadInternal);
}

/** Decodes roll input from a detached boundary value. @public */
export function decodeRollInput(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RollInput> {
  return decodeBoundary(value, options, decodeRollInputInternal);
}

/** Decodes roll-update input from a detached boundary value. @public */
export function decodeRollUpdateInput(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RollUpdateInput> {
  return decodeBoundary(value, options, decodeRollUpdateInputInternal);
}

/** Decodes a client-to-server event from a detached boundary value. @public */
export function decodeClientToServerEvent(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<ClientToServerEvent> {
  return decodeBoundary(value, options, decodeClientToServerEventInternal);
}

/** Parses a client event without throwing for hostile input. @public */
export function parseClientToServerEvent(value: unknown): ClientToServerEvent | null {
  const decoded = decodeClientToServerEvent(value);
  return decoded.success ? decoded.data : null;
}

/** Checks roll visibility without throwing for hostile input. @public */
export function isRollVisibility(value: unknown): value is RollVisibility {
  return decodeRollVisibility(value).success;
}
