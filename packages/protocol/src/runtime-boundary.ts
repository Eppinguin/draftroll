/**
 * Public runtime-validation boundary.
 *
 * Builds a bounded detached snapshot of object input before invoking the detailed protocol
 * validators. The snapshot traversal enforces the same top-level runtime budgets early and reads
 * caller-owned accessors at most once, so structured cloning never receives an unbounded or
 * time-of-check/time-of-use-mutated object graph.
 */

import * as runtime from './runtime-internal';
import type { NormalizedRollResult, RollVisibility, ServerToClientEvent } from './index';
import type { DecodeOptions, DecodeResult, RuntimeValidationLimits } from './runtime-internal';

const BOUNDARY_DEPTH_MARGIN = 16;
const BOUNDARY_MINIMUM_NODE_BUDGET = 16_384;
const BOUNDARY_NODE_MULTIPLIER = 16;
const BOUNDARY_PROPERTY_FLOOR = 1_024;
const encoder = new TextEncoder();

type ObjectDecoder<T> = (value: unknown, options?: DecodeOptions) => DecodeResult<T>;
type DecodeFailure = { success: false; error: runtime.DraftrollValidationError };

interface SnapshotBudget {
  maximumBytes: number;
  maximumCollectionLength: number;
  maximumDepth: number;
  maximumNodes: number;
  maximumProperties: number;
  maximumStringLength: number;
  bytes: number;
  nodes: number;
}

function resolveLimits(options: DecodeOptions): RuntimeValidationLimits {
  return { ...runtime.DEFAULT_RUNTIME_VALIDATION_LIMITS, ...options.limits };
}

function boundaryFailure(
  code: 'invalid_value' | 'limit_exceeded' | 'payload_too_large',
  message: string,
  expected?: string,
  received?: string,
): DecodeFailure {
  return {
    success: false,
    error: new runtime.DraftrollValidationError('Value cannot safely cross the runtime boundary', [
      { code, path: '$', message, expected, received },
    ]),
  };
}

function stringBoundaryBytes(value: string): number {
  let bytes = encoder.encode(value).byteLength + 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) bytes += 1;
    else if (code <= 0x1f) bytes += 5;
  }
  return bytes;
}

function addBoundaryBytes(budget: SnapshotBudget, bytes: number): DecodeFailure | null {
  budget.bytes += bytes;
  if (budget.bytes <= budget.maximumBytes) return null;
  return boundaryFailure(
    'payload_too_large',
    `Object graph exceeds the runtime boundary size budget of ${budget.maximumBytes} bytes`,
    `<= ${budget.maximumBytes} bytes`,
    `> ${budget.maximumBytes} bytes`,
  );
}

function createSnapshotBudget(options: DecodeOptions): SnapshotBudget {
  const limits = resolveLimits(options);
  return {
    maximumBytes: limits.maximumJsonBytes,
    maximumCollectionLength: Math.max(
      limits.maximumArrayLength,
      limits.maximumDice,
      limits.maximumOperations,
      limits.maximumCustomDice,
      limits.maximumCustomFaces,
    ),
    maximumDepth:
      Math.max(limits.maximumTreeDepth, limits.maximumMetadataDepth) + BOUNDARY_DEPTH_MARGIN,
    maximumNodes: Math.max(
      BOUNDARY_MINIMUM_NODE_BUDGET,
      limits.maximumArrayLength * BOUNDARY_NODE_MULTIPLIER,
      limits.maximumDice * BOUNDARY_NODE_MULTIPLIER,
      limits.maximumMetadataKeys * BOUNDARY_NODE_MULTIPLIER,
    ),
    maximumProperties: Math.max(
      BOUNDARY_PROPERTY_FLOOR,
      limits.maximumMetadataKeys,
      limits.maximumArrayLength,
    ),
    maximumStringLength: Math.max(limits.maximumStringLength, limits.maximumExpressionLength),
    bytes: 0,
    nodes: 0,
  };
}

function defineSnapshotProperty(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/**
 * Accepts ordinary records from this or another realm, plus null-prototype records.
 *
 * Looking at the actual prototype chain avoids `Symbol.toStringTag` spoofing and rejects class
 * instances without coupling validation to this realm's `Object.prototype` identity.
 */
function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function snapshotBoundaryValue(value: unknown, options: DecodeOptions): DecodeResult<unknown> {
  const budget = createSnapshotBudget(options);
  const active = new WeakSet<object>();
  const snapshots = new WeakMap<object, object>();

  const snapshot = (candidate: unknown, depth: number): DecodeResult<unknown> => {
    if (depth > budget.maximumDepth) {
      return boundaryFailure(
        'limit_exceeded',
        `Object graph exceeds the runtime boundary depth limit of ${budget.maximumDepth}`,
        `<= ${budget.maximumDepth} levels`,
        `> ${budget.maximumDepth} levels`,
      );
    }

    if (candidate === null) {
      const failure = addBoundaryBytes(budget, 4);
      return failure ?? { success: true, data: null };
    }
    if (typeof candidate === 'string') {
      if (candidate.length > budget.maximumStringLength) {
        return boundaryFailure(
          'limit_exceeded',
          `String exceeds the runtime boundary limit of ${budget.maximumStringLength} characters`,
          `<= ${budget.maximumStringLength} characters`,
          `${candidate.length} characters`,
        );
      }
      const failure = addBoundaryBytes(budget, stringBoundaryBytes(candidate));
      return failure ?? { success: true, data: candidate };
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        return boundaryFailure(
          'invalid_value',
          'Protocol object boundaries require finite numbers',
          'finite number',
          String(candidate),
        );
      }
      const failure = addBoundaryBytes(budget, 24);
      return failure ?? { success: true, data: candidate };
    }
    if (typeof candidate === 'boolean') {
      const failure = addBoundaryBytes(budget, candidate ? 4 : 5);
      return failure ?? { success: true, data: candidate };
    }
    if (typeof candidate === 'undefined') {
      const failure = addBoundaryBytes(budget, 4);
      return failure ?? { success: true, data: undefined };
    }
    if (
      typeof candidate === 'bigint' ||
      typeof candidate === 'symbol' ||
      typeof candidate === 'function'
    ) {
      return boundaryFailure(
        'invalid_value',
        'Protocol object boundaries accept JSON-like data only',
        'objects, arrays, strings, finite numbers, booleans, null, or undefined',
        typeof candidate,
      );
    }

    const existing = snapshots.get(candidate);
    if (existing) {
      if (active.has(candidate)) {
        return boundaryFailure(
          'invalid_value',
          'Protocol object boundaries do not accept cyclic data',
          'acyclic JSON-like data',
          'cyclic object graph',
        );
      }
      return { success: true, data: existing };
    }

    budget.nodes += 1;
    if (budget.nodes > budget.maximumNodes) {
      return boundaryFailure(
        'limit_exceeded',
        `Object graph exceeds the runtime boundary node limit of ${budget.maximumNodes}`,
        `<= ${budget.maximumNodes} object/array nodes`,
        `> ${budget.maximumNodes} nodes`,
      );
    }

    const array = Array.isArray(candidate);
    if (!array && !isPlainRecord(candidate)) {
      return boundaryFailure(
        'invalid_value',
        'Protocol object boundaries accept plain objects and arrays only',
        'plain object | array',
        'special object container',
      );
    }
    if (array && candidate.length > budget.maximumCollectionLength) {
      return boundaryFailure(
        'limit_exceeded',
        `Array exceeds the runtime boundary limit of ${budget.maximumCollectionLength} entries`,
        `<= ${budget.maximumCollectionLength} entries`,
        `${candidate.length} entries`,
      );
    }

    const target: object = array ? [] : {};
    if (Array.isArray(target) && Array.isArray(candidate)) target.length = candidate.length;
    snapshots.set(candidate, target);
    active.add(candidate);
    const containerFailure = addBoundaryBytes(budget, 2 + (array ? candidate.length : 0));
    if (containerFailure) return containerFailure;

    let properties = 0;
    for (const key in candidate) {
      if (!Object.prototype.hasOwnProperty.call(candidate, key)) continue;
      properties += 1;
      if (properties > budget.maximumProperties) {
        return boundaryFailure(
          'limit_exceeded',
          `Object exceeds the runtime boundary property limit of ${budget.maximumProperties}`,
          `<= ${budget.maximumProperties} properties`,
          `> ${budget.maximumProperties} properties`,
        );
      }
      if (key.length > budget.maximumStringLength) {
        return boundaryFailure(
          'limit_exceeded',
          'Object key exceeds the runtime boundary string limit',
          `<= ${budget.maximumStringLength} characters`,
          `${key.length} characters`,
        );
      }
      const keyFailure = addBoundaryBytes(budget, stringBoundaryBytes(key) + 1);
      if (keyFailure) return keyFailure;
      const child = snapshot(Reflect.get(candidate, key), depth + 1);
      if (!child.success) return child;
      defineSnapshotProperty(target, key, child.data);
    }
    active.delete(candidate);
    return { success: true, data: target };
  };

  try {
    return snapshot(value, 0);
  } catch {
    return boundaryFailure(
      'invalid_value',
      'Value cannot be safely inspected at the runtime boundary',
      'non-hostile JSON-like data',
    );
  }
}

function decodeBoundary<T>(
  value: unknown,
  options: DecodeOptions,
  decoder: ObjectDecoder<T>,
): DecodeResult<T> {
  const snapshot = snapshotBoundaryValue(value, options);
  if (!snapshot.success) return snapshot;
  return decoder(snapshot.data, options);
}

/**
 * Decodes roll visibility through the bounded public object boundary.
 *
 * @public
 */
export function decodeRollVisibility(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeRollVisibility> {
  return decodeBoundary(value, options, runtime.decodeRollVisibility);
}

/**
 * Decodes room policy through the bounded public object boundary.
 *
 * @public
 */
export function decodeRoomPolicy(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeRoomPolicy> {
  return decodeBoundary(value, options, runtime.decodeRoomPolicy);
}

/**
 * Decodes a room-policy patch through the bounded public object boundary.
 *
 * @public
 */
export function decodeRoomPolicyPatch(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeRoomPolicyPatch> {
  return decodeBoundary(value, options, runtime.decodeRoomPolicyPatch);
}

/**
 * Decodes participant identity through the bounded public object boundary.
 *
 * @public
 */
export function decodeParticipantIdentityInput(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeParticipantIdentityInput> {
  return decodeBoundary(value, options, runtime.decodeParticipantIdentityInput);
}

/**
 * Decodes a room capability token through the bounded public object boundary.
 *
 * @public
 */
export function decodeRoomCapabilityTokenPayload(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeRoomCapabilityTokenPayload> {
  return decodeBoundary(value, options, runtime.decodeRoomCapabilityTokenPayload);
}

/**
 * Decodes custom-dice definitions through the bounded public object boundary.
 *
 * @public
 */
export function decodeCustomDiceDefinitions(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeCustomDiceDefinitions> {
  return decodeBoundary(value, options, runtime.decodeCustomDiceDefinitions);
}

/**
 * Decodes roll input through the bounded public object boundary.
 *
 * @public
 */
export function decodeRollInput(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeRollInput> {
  return decodeBoundary(value, options, runtime.decodeRollInput);
}

/**
 * Decodes roll-update input through the bounded public object boundary.
 *
 * @public
 */
export function decodeRollUpdateInput(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeRollUpdateInput> {
  return decodeBoundary(value, options, runtime.decodeRollUpdateInput);
}

/**
 * Decodes a normalized result through the bounded public object boundary.
 *
 * @public
 */
export function decodeNormalizedRollResult(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeNormalizedRollResult> {
  return decodeBoundary(value, options, runtime.decodeNormalizedRollResult);
}

/**
 * Asserts a normalized result after bounded public decoding.
 *
 * @public
 */
export function assertNormalizedRollResult(
  value: unknown,
  options: DecodeOptions = {},
): NormalizedRollResult {
  return runtime.unwrapDecode(decodeNormalizedRollResult(value, options));
}

/**
 * Migrates a legacy normalized result after bounded public decoding.
 *
 * @public
 */
export function migrateNormalizedRollResult(value: unknown): NormalizedRollResult {
  return assertNormalizedRollResult(value, { allowLegacyResults: true });
}

/**
 * Decodes a client event through the bounded public object boundary.
 *
 * @public
 */
export function decodeClientToServerEvent(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeClientToServerEvent> {
  return decodeBoundary(value, options, runtime.decodeClientToServerEvent);
}

/**
 * Decodes a server event through the bounded public object boundary.
 *
 * @public
 */
export function decodeServerToClientEvent(
  value: unknown,
  options: DecodeOptions = {},
): ReturnType<typeof runtime.decodeServerToClientEvent> {
  return decodeBoundary(value, options, runtime.decodeServerToClientEvent);
}

/**
 * Parses a client event without throwing at the public boundary.
 *
 * @public
 */
export function parseClientToServerEvent(
  value: unknown,
): ReturnType<typeof runtime.parseClientToServerEvent> {
  const decoded = decodeClientToServerEvent(value);
  return decoded.success ? decoded.data : null;
}

/**
 * Tests whether a value is a current-schema server event.
 *
 * @public
 */
export function isServerToClientEvent(value: unknown): value is ServerToClientEvent {
  return decodeServerToClientEvent(value, { allowLegacyResults: false }).success;
}

/**
 * Tests whether a value is a current-schema normalized result.
 *
 * @public
 */
export function isNormalizedRollResult(value: unknown): value is NormalizedRollResult {
  return decodeNormalizedRollResult(value, { allowLegacyResults: false }).success;
}

/**
 * Tests whether a value is valid roll visibility.
 *
 * @public
 */
export function isRollVisibility(value: unknown): value is RollVisibility {
  return decodeRollVisibility(value).success;
}
