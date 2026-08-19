import type {
  ClientToServerEvent,
  CustomDiceDefinition,
  NormalizedRollResult,
  ParticipantIdentityInput,
  RollInput,
  RoomCapabilityTokenPayload,
  RollUpdateInput,
  RollVisibility,
  ServerToClientEvent,
} from './index';
import type { RoomPolicy, RoomPolicyPatch } from './policy';
import { DRAFTROLL_ROOM_POLICY_SCHEMA_VERSION } from './policy';
import {
  DRAFTROLL_PROTOCOL_VERSION,
  DRAFTROLL_RESULT_SCHEMA_VERSION,
  DRAFTROLL_SUPPORTED_PROTOCOL_VERSIONS,
} from './version';

/**
 * Bounds applied while decoding untrusted protocol payloads.
 *
 * @public
 */
export interface RuntimeValidationLimits {
  maximumJsonBytes: number;
  maximumStringLength: number;
  maximumExpressionLength: number;
  maximumArrayLength: number;
  maximumDice: number;
  maximumOperations: number;
  maximumCustomDice: number;
  maximumCustomFaces: number;
  maximumMetadataBytes: number;
  maximumMetadataDepth: number;
  maximumMetadataKeys: number;
  maximumTreeDepth: number;
}

/**
 * Default bounds for untrusted protocol decoding.
 *
 * @public
 */
export const DEFAULT_RUNTIME_VALIDATION_LIMITS: Readonly<RuntimeValidationLimits> = Object.freeze({
  maximumJsonBytes: 512 * 1024,
  maximumStringLength: 16_384,
  maximumExpressionLength: 16_384,
  maximumArrayLength: 4_096,
  maximumDice: 1_000,
  maximumOperations: 512,
  maximumCustomDice: 128,
  maximumCustomFaces: 1_000,
  maximumMetadataBytes: 32 * 1024,
  maximumMetadataDepth: 8,
  maximumMetadataKeys: 512,
  maximumTreeDepth: 64,
});

/**
 * Stable category assigned to a runtime-validation issue.
 *
 * @public
 */
export type RuntimeValidationCode =
  | 'invalid_json'
  | 'payload_too_large'
  | 'invalid_type'
  | 'missing_field'
  | 'unknown_field'
  | 'invalid_value'
  | 'invalid_protocol_version'
  | 'unsupported_protocol_version'
  | 'invalid_result_schema_version'
  | 'limit_exceeded';

/**
 * One structured problem found while decoding untrusted protocol input.
 *
 * @public
 */
export interface RuntimeValidationIssue {
  code: RuntimeValidationCode;
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

/**
 * Error containing structured runtime-validation issues.
 *
 * @public
 */
export class DraftrollValidationError extends Error {
  readonly code = 'DRAFTROLL_VALIDATION_ERROR';

  /**
   * Creates a DraftrollValidationError instance.
   */
  constructor(
    message: string,
    public readonly issues: readonly RuntimeValidationIssue[],
  ) {
    super(message);
    this.name = 'DraftrollValidationError';
  }
}

/**
 * Discriminated success or failure result returned by protocol decoders.
 *
 * @public
 */
export type DecodeResult<T> =
  | { success: true; data: T }
  | { success: false; error: DraftrollValidationError };

/**
 * Controls strictness and validation limits for one decode operation.
 *
 * @public
 */
export interface DecodeOptions {
  limits?: Partial<RuntimeValidationLimits>;
  /** Accept pre-schema Draftroll results and migrate them to the current schema. */
  allowLegacyResults?: boolean;
  /** Reject unrecognized top-level fields. Defaults to true at protocol boundaries. */
  rejectUnknownFields?: boolean;
}

/**
 * Controls byte and structural limits when parsing JSON.
 *
 * @public
 */
export interface RuntimeJsonOptions {
  maximumBytes?: number;
}

/**
 * Parses bounded JSON and reports structured runtime-validation failures.
 *
 * @public
 */
export function parseRuntimeJson(
  raw: string | ArrayBuffer | ArrayBufferView,
  options: RuntimeJsonOptions = {},
): DecodeResult<unknown> {
  const maximumBytes = options.maximumBytes ?? DEFAULT_RUNTIME_VALIDATION_LIMITS.maximumJsonBytes;
  const bytes = byteLength(raw);
  if (bytes > maximumBytes) {
    return failure('Payload exceeds the maximum JSON size', [
      {
        code: 'payload_too_large',
        path: '$',
        message: `JSON payload is ${bytes} bytes; maximum is ${maximumBytes}`,
        expected: `<= ${maximumBytes} bytes`,
        received: `${bytes} bytes`,
      },
    ]);
  }
  try {
    const text =
      typeof raw === 'string'
        ? raw
        : raw instanceof ArrayBuffer
          ? new TextDecoder().decode(raw)
          : new TextDecoder().decode(
              raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
            );
    return { success: true, data: JSON.parse(text) as unknown };
  } catch (error) {
    return failure('Payload is not valid JSON', [
      {
        code: 'invalid_json',
        path: '$',
        message: error instanceof Error ? error.message : 'JSON parsing failed',
      },
    ]);
  }
}

/**
 * Selects a mutually supported protocol version.
 *
 * @public
 */
export function negotiateProtocolVersion(
  value: unknown,
): DecodeResult<typeof DRAFTROLL_PROTOCOL_VERSION> {
  if (!Number.isSafeInteger(value)) {
    return failure('Protocol version is invalid', [
      issue(
        'invalid_protocol_version',
        '$.protocolVersion',
        'Protocol version must be an integer',
        'integer',
        value,
      ),
    ]);
  }
  if (value !== DRAFTROLL_PROTOCOL_VERSION) {
    return failure('Protocol version is unsupported', [
      {
        code: 'unsupported_protocol_version',
        path: '$.protocolVersion',
        message: `Protocol version ${String(value)} is not supported`,
        expected: DRAFTROLL_SUPPORTED_PROTOCOL_VERSIONS.join(' | '),
        received: String(value),
      },
    ]);
  }
  return { success: true, data: DRAFTROLL_PROTOCOL_VERSION };
}

/**
 * Decodes and validates roll visibility.
 *
 * @public
 */
export function decodeRollVisibility(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RollVisibility> {
  const context = createContext({ rejectUnknownFields: true, ...options });
  validateRollVisibility(value, '$', context);
  return context.result<RollVisibility>(value, 'Roll visibility is invalid');
}

/**
 * Decodes and validates room policy.
 *
 * @public
 */
export function decodeRoomPolicy(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RoomPolicy> {
  const context = createContext({ rejectUnknownFields: true, ...options });
  validateRoomPolicy(value, '$', context, false);
  return context.result<RoomPolicy>(value, 'Room policy is invalid');
}

/**
 * Decodes and validates room policy patch.
 *
 * @public
 */
export function decodeRoomPolicyPatch(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RoomPolicyPatch> {
  const context = createContext({ rejectUnknownFields: true, ...options });
  validateRoomPolicy(value, '$', context, true);
  return context.result<RoomPolicyPatch>(value, 'Room policy patch is invalid');
}

/**
 * Decodes and validates participant identity input.
 *
 * @public
 */
export function decodeParticipantIdentityInput(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<ParticipantIdentityInput> {
  const context = createContext({ rejectUnknownFields: true, ...options });
  if (expectRecord(value, '$', context)) {
    unknownFields(value, ['participantId', 'sessionId', 'name', 'metadata'], '$', context);
    readOptionalIdentifier(value.participantId, '$.participantId', context);
    readOptionalIdentifier(value.sessionId, '$.sessionId', context);
    if (value.name !== undefined) readString(value.name, '$.name', context, { maximum: 200 });
    validateOptionalMetadata(value.metadata, '$.metadata', context);
  }
  return context.result<ParticipantIdentityInput>(value, 'Participant identity is invalid');
}

/**
 * Decodes and validates room capability token payload.
 *
 * @public
 */
export function decodeRoomCapabilityTokenPayload(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RoomCapabilityTokenPayload> {
  const context = createContext({ rejectUnknownFields: true, ...options });
  if (expectRecord(value, '$', context)) {
    unknownFields(
      value,
      [
        'protocolVersion',
        'roomId',
        'participantId',
        'sessionId',
        'name',
        'roles',
        'permissions',
        'metadata',
        'iss',
        'aud',
        'iat',
        'nbf',
        'jti',
        'exp',
      ],
      '$',
      context,
    );
    if (value.protocolVersion !== undefined)
      validateProtocolVersion(value.protocolVersion, '$.protocolVersion', context);
    readIdentifier(value.roomId, '$.roomId', context, true);
    readIdentifier(value.participantId, '$.participantId', context, true);
    readOptionalIdentifier(value.sessionId, '$.sessionId', context);
    if (value.name !== undefined) readString(value.name, '$.name', context, { maximum: 200 });
    if (value.roles !== undefined) validateStringArray(value.roles, '$.roles', context, 128);
    if (value.permissions !== undefined) {
      validateStringArray(value.permissions, '$.permissions', context, 64);
      if (Array.isArray(value.permissions)) {
        const known = new Set([
          'roll:create',
          'roll:update-own',
          'roll:update-any',
          'roll:reveal-own',
          'roll:reveal-any',
          'roll:view-hidden',
          'room:manage',
        ]);
        value.permissions.forEach((permission, index) => {
          if (typeof permission === 'string' && !known.has(permission))
            context.add(
              issue(
                'invalid_value',
                `$.permissions.${index}`,
                'Unknown room permission',
                [...known].join(' | '),
                permission,
              ),
            );
        });
      }
    }
    validateOptionalMetadata(value.metadata, '$.metadata', context);
    if (value.iss !== undefined) readString(value.iss, '$.iss', context, { maximum: 500 });
    if (value.aud !== undefined) {
      if (typeof value.aud === 'string') readString(value.aud, '$.aud', context, { maximum: 500 });
      else validateStringArray(value.aud, '$.aud', context, 32, true);
    }
    if (value.iat !== undefined) readNonNegativeInteger(value.iat, '$.iat', context, true);
    if (value.nbf !== undefined) readNonNegativeInteger(value.nbf, '$.nbf', context, true);
    if (value.jti !== undefined) readIdentifier(value.jti, '$.jti', context, true);
    if (value.exp !== undefined) readNonNegativeInteger(value.exp, '$.exp', context, true);
    if (typeof value.nbf === 'number' && typeof value.exp === 'number' && value.nbf > value.exp) {
      context.add(
        issue(
          'invalid_value',
          '$.nbf',
          'Token not-before time must not be after expiration',
          '<= $.exp',
          value.nbf,
        ),
      );
    }
    if (typeof value.iat === 'number' && typeof value.exp === 'number' && value.iat > value.exp) {
      context.add(
        issue(
          'invalid_value',
          '$.iat',
          'Token issued-at time must not be after expiration',
          '<= $.exp',
          value.iat,
        ),
      );
    }
  }
  return context.result<RoomCapabilityTokenPayload>(
    value,
    'Room capability token payload is invalid',
  );
}

/**
 * Decodes and validates custom dice definitions.
 *
 * @public
 */
export function decodeCustomDiceDefinitions(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<CustomDiceDefinition[]> {
  const context = createContext({ rejectUnknownFields: true, ...options });
  const candidate = structuredCloneIfObject(value);
  validateCustomDice(candidate, '$', context);
  return context.result<CustomDiceDefinition[]>(candidate, 'Invalid custom dice definitions');
}

/**
 * Decodes and validates roll input.
 *
 * @public
 */
export function decodeRollInput(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RollInput> {
  const context = createContext({ rejectUnknownFields: true, ...options });
  validateRollInput(value, '$', context);
  return context.result<RollInput>(value, 'Roll input is invalid');
}

/**
 * Decodes and validates roll update input.
 *
 * @public
 */
export function decodeRollUpdateInput(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<RollUpdateInput> {
  const context = createContext({ rejectUnknownFields: true, ...options });
  validateRollUpdate(value, '$', context);
  return context.result<RollUpdateInput>(value, 'Roll update is invalid');
}

/**
 * Decodes and validates normalized roll result.
 *
 * @public
 */
export function decodeNormalizedRollResult(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<NormalizedRollResult> {
  const cloned = isRecord(value) ? structuredClone(value) : value;
  const context = createContext({ rejectUnknownFields: true, ...options });
  validateNormalizedResult(cloned, '$', context);
  return context.result<NormalizedRollResult>(cloned, 'Normalized roll result is invalid');
}

/**
 * Validates normalized roll result and throws when invalid.
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
 * Migrates normalized roll result to the current schema.
 *
 * @public
 */
export function migrateNormalizedRollResult(value: unknown): NormalizedRollResult {
  return assertNormalizedRollResult(value, { allowLegacyResults: true });
}

/**
 * Decodes and validates client to server event.
 *
 * @public
 */
export function decodeClientToServerEvent(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<ClientToServerEvent> {
  const context = createContext({ rejectUnknownFields: true, ...options });
  validateClientEvent(value, '$', context);
  return context.result<ClientToServerEvent>(value, 'Client room event is invalid');
}

/**
 * Decodes and validates server to client event.
 *
 * @public
 */
export function decodeServerToClientEvent(
  value: unknown,
  options: DecodeOptions = {},
): DecodeResult<ServerToClientEvent> {
  const cloned = structuredCloneIfObject(value);
  const context = createContext({ rejectUnknownFields: true, ...options });
  validateServerEvent(cloned, '$', context);
  return context.result<ServerToClientEvent>(cloned, 'Server room event is invalid');
}

/**
 * Parses client to server event.
 *
 * @public
 */
export function parseClientToServerEvent(value: unknown): ClientToServerEvent | null {
  const decoded = decodeClientToServerEvent(value);
  return decoded.success ? decoded.data : null;
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

/**
 * Determines whether a value is roll visibility.
 *
 * @public
 */
export function isRollVisibility(value: unknown): value is RollVisibility {
  return decodeRollVisibility(value).success;
}

/**
 * Returns a decoded value or throws its structured validation error.
 *
 * @public
 */
export function unwrapDecode<T>(decoded: DecodeResult<T>): T {
  if (decoded.success) return decoded.data;
  throw decoded.error;
}

interface ValidationContext {
  readonly issues: RuntimeValidationIssue[];
  readonly limits: RuntimeValidationLimits;
  readonly rejectUnknownFields: boolean;
  readonly allowLegacyResults: boolean;
  add(issue: RuntimeValidationIssue): void;
  /**
   * Produces the decode result for a validated value.
   *
   * The caller passes the still-`unknown` input: this returns the typed success
   * branch only when the preceding `validate*` pass recorded no issues, so the
   * single narrowing below is the one place that relationship is asserted.
   */
  result<T>(data: unknown, message: string): DecodeResult<T>;
}

function createContext(options: DecodeOptions): ValidationContext {
  const limits = { ...DEFAULT_RUNTIME_VALIDATION_LIMITS, ...options.limits };
  const issues: RuntimeValidationIssue[] = [];
  return {
    issues,
    limits,
    rejectUnknownFields: options.rejectUnknownFields ?? false,
    allowLegacyResults: options.allowLegacyResults ?? true,
    add(problem) {
      if (issues.length < 100) issues.push(problem);
    },
    result<T>(data: unknown, message: string): DecodeResult<T> {
      // Safe by construction: the success branch is only reachable once the
      // matching `validate*` call has confirmed the shape of `data`. This is the
      // single trusted narrowing point for every `decode*` entry point.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return issues.length ? failure(message, issues) : { success: true, data: data as T };
    },
  };
}

function validateClientEvent(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  const type = readString(value.type, `${path}.type`, context, { required: true, maximum: 64 });
  switch (type) {
    case 'roll_request':
      unknownFields(
        value,
        ['type', 'requestId', 'clientRollId', 'input', 'visibility'],
        path,
        context,
      );
      readIdentifier(value.requestId, `${path}.requestId`, context, true);
      readOptionalIdentifier(value.clientRollId, `${path}.clientRollId`, context);
      validateRollInput(value.input, `${path}.input`, context);
      if (value.visibility !== undefined)
        validateRollVisibility(value.visibility, `${path}.visibility`, context);
      return;
    case 'display_roll':
      unknownFields(
        value,
        ['type', 'requestId', 'clientRollId', 'input', 'visibility'],
        path,
        context,
      );
      readIdentifier(value.requestId, `${path}.requestId`, context, true);
      readOptionalIdentifier(value.clientRollId, `${path}.clientRollId`, context);
      validateDisplayInput(value.input, `${path}.input`, context);
      if (value.visibility !== undefined)
        validateRollVisibility(value.visibility, `${path}.visibility`, context);
      return;
    case 'update_roll':
      unknownFields(
        value,
        ['type', 'requestId', 'rollId', 'update', 'expectedRevision', 'reroll', 'animate', 'audit'],
        path,
        context,
      );
      readIdentifier(value.requestId, `${path}.requestId`, context, true);
      readIdentifier(value.rollId, `${path}.rollId`, context, true);
      validateRollUpdate(value.update, `${path}.update`, context);
      readOptionalNonNegativeInteger(value.expectedRevision, `${path}.expectedRevision`, context);
      if (value.animate !== undefined) readBoolean(value.animate, `${path}.animate`, context);
      if (value.reroll !== undefined && typeof value.reroll !== 'boolean')
        validateStringArray(value.reroll, `${path}.reroll`, context, context.limits.maximumDice);
      if (value.audit !== undefined) validateRollAudit(value.audit, `${path}.audit`, context);
      return;
    case 'bulk_update_rolls':
      unknownFields(value, ['type', 'requestId', 'updates'], path, context);
      readIdentifier(value.requestId, `${path}.requestId`, context, true);
      validateArray(
        value.updates,
        `${path}.updates`,
        context,
        50,
        (item, itemPath, itemContext) => {
          if (!expectRecord(item, itemPath, itemContext)) return;
          unknownFields(
            item,
            ['rollId', 'update', 'expectedRevision', 'reroll', 'animate', 'audit'],
            itemPath,
            itemContext,
          );
          readIdentifier(item.rollId, `${itemPath}.rollId`, itemContext, true);
          validateRollUpdate(item.update, `${itemPath}.update`, itemContext);
          readOptionalNonNegativeInteger(
            item.expectedRevision,
            `${itemPath}.expectedRevision`,
            itemContext,
          );
          if (item.animate !== undefined)
            readBoolean(item.animate, `${itemPath}.animate`, itemContext);
          if (item.reroll !== undefined && typeof item.reroll !== 'boolean')
            validateStringArray(
              item.reroll,
              `${itemPath}.reroll`,
              itemContext,
              itemContext.limits.maximumDice,
            );
          if (item.audit !== undefined)
            validateRollAudit(item.audit, `${itemPath}.audit`, itemContext);
        },
        true,
      );
      if (Array.isArray(value.updates)) {
        const ids = value.updates
          .map((item) => (isRecord(item) ? item.rollId : undefined))
          .filter((id): id is string => typeof id === 'string');
        if (new Set(ids).size !== ids.length)
          context.add(
            issue(
              'invalid_value',
              `${path}.updates`,
              'Bulk updates must contain unique roll IDs',
              'unique roll IDs',
              ids,
            ),
          );
      }
      return;
    case 'set_roll_visibility':
      unknownFields(
        value,
        ['type', 'requestId', 'rollId', 'visibility', 'expectedRevision', 'audit'],
        path,
        context,
      );
      readIdentifier(value.requestId, `${path}.requestId`, context, true);
      readIdentifier(value.rollId, `${path}.rollId`, context, true);
      validateRollVisibility(value.visibility, `${path}.visibility`, context);
      readOptionalNonNegativeInteger(value.expectedRevision, `${path}.expectedRevision`, context);
      if (value.audit !== undefined) validateRollAudit(value.audit, `${path}.audit`, context);
      return;
    case 'participant_update':
      unknownFields(value, ['type', 'name', 'metadata'], path, context);
      if (value.name !== undefined)
        readString(value.name, `${path}.name`, context, { maximum: 200 });
      validateOptionalMetadata(value.metadata, `${path}.metadata`, context);
      return;
    case 'authenticate_room_token':
      unknownFields(value, ['type', 'token'], path, context);
      readString(value.token, `${path}.token`, context, { required: true, maximum: 16_384 });
      return;
    case 'authenticate_room_password':
      unknownFields(value, ['type', 'password'], path, context);
      validateRoomPassword(value.password, `${path}.password`, context, false);
      return;
    case 'set_room_password':
      unknownFields(value, ['type', 'requestId', 'password', 'expectedRevision'], path, context);
      readIdentifier(value.requestId, `${path}.requestId`, context, true);
      validateRoomPassword(value.password, `${path}.password`, context, true);
      readOptionalNonNegativeInteger(value.expectedRevision, `${path}.expectedRevision`, context);
      return;
    case 'set_room_policy':
      unknownFields(value, ['type', 'requestId', 'policy', 'expectedRevision'], path, context);
      readIdentifier(value.requestId, `${path}.requestId`, context, true);
      validateRoomPolicy(value.policy, `${path}.policy`, context, true);
      readOptionalNonNegativeInteger(value.expectedRevision, `${path}.expectedRevision`, context);
      return;
    case 'revoke_room_token':
      unknownFields(value, ['type', 'requestId', 'target', 'reason'], path, context);
      readIdentifier(value.requestId, `${path}.requestId`, context, true);
      validateRoomTokenRevocationTarget(value.target, `${path}.target`, context);
      if (value.reason !== undefined)
        readString(value.reason, `${path}.reason`, context, { maximum: 500 });
      return;
    case 'clock_sync_ping':
      unknownFields(value, ['type', 'clientTimeMs', 'nonce'], path, context);
      readFiniteNumber(value.clientTimeMs, `${path}.clientTimeMs`, context, true);
      readIdentifier(value.nonce, `${path}.nonce`, context, true);
      return;
    case 'client_ready':
      unknownFields(
        value,
        ['type', 'rendererReady', 'themesReady', 'roundTripMs', 'clockUncertaintyMs'],
        path,
        context,
      );
      readBoolean(value.rendererReady, `${path}.rendererReady`, context, true);
      readBoolean(value.themesReady, `${path}.themesReady`, context, true);
      if (value.roundTripMs !== undefined)
        readRange(value.roundTripMs, `${path}.roundTripMs`, context, 0, 60_000);
      if (value.clockUncertaintyMs !== undefined)
        readRange(value.clockUncertaintyMs, `${path}.clockUncertaintyMs`, context, 0, 30_000);
      return;
    case undefined:
      // `readString` already recorded the missing/invalid-type issue.
      return;
    default:
      context.add(
        issue(
          'invalid_value',
          `${path}.type`,
          'Unsupported client event type',
          'known client event type',
          type,
        ),
      );
  }
}

function validateServerEvent(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  const type = readString(value.type, `${path}.type`, context, { required: true, maximum: 64 });
  if (type !== 'roll_error')
    validateProtocolVersion(value.protocolVersion, `${path}.protocolVersion`, context);
  switch (type) {
    case 'roll_start':
    case 'roll_updated':
    case 'roll_visibility_updated':
      validateRoomRollEvent(value, path, context, type);
      return;
    case 'bulk_rolls_updated':
      unknownFields(
        value,
        ['type', 'protocolVersion', 'roomId', 'requestId', 'eventSequence', 'updates', 'replayed'],
        path,
        context,
      );
      readIdentifier(value.roomId, `${path}.roomId`, context, true);
      readIdentifier(value.requestId, `${path}.requestId`, context, true);
      readNonNegativeInteger(value.eventSequence, `${path}.eventSequence`, context, true);
      validateArray(
        value.updates,
        `${path}.updates`,
        context,
        50,
        (item, itemPath, itemContext) => {
          if (!expectRecord(item, itemPath, itemContext)) return;
          unknownFields(item, ['rollId', 'revision', 'eventSequence'], itemPath, itemContext);
          readIdentifier(item.rollId, `${itemPath}.rollId`, itemContext, true);
          readNonNegativeInteger(item.revision, `${itemPath}.revision`, itemContext, true);
          readNonNegativeInteger(
            item.eventSequence,
            `${itemPath}.eventSequence`,
            itemContext,
            true,
          );
        },
        true,
      );
      if (value.replayed !== undefined) readBoolean(value.replayed, `${path}.replayed`, context);
      return;
    case 'clock_sync_pong':
      unknownFields(
        value,
        ['type', 'protocolVersion', 'roomId', 'clientTimeMs', 'serverTimeMs', 'nonce'],
        path,
        context,
      );
      readIdentifier(value.roomId, `${path}.roomId`, context, true);
      readFiniteNumber(value.clientTimeMs, `${path}.clientTimeMs`, context, true);
      readFiniteNumber(value.serverTimeMs, `${path}.serverTimeMs`, context, true);
      readIdentifier(value.nonce, `${path}.nonce`, context, true);
      return;
    case 'room_state':
      validateRoomState(value, path, context);
      return;
    case 'session_ready':
      unknownFields(
        value,
        [
          'type',
          'protocolVersion',
          'roomId',
          'participant',
          'latestEventSequence',
          'latestRollSequence',
        ],
        path,
        context,
      );
      readIdentifier(value.roomId, `${path}.roomId`, context, true);
      validateParticipant(value.participant, `${path}.participant`, context);
      readNonNegativeInteger(
        value.latestEventSequence,
        `${path}.latestEventSequence`,
        context,
        true,
      );
      readNonNegativeInteger(value.latestRollSequence, `${path}.latestRollSequence`, context, true);
      return;
    case 'participant_joined':
    case 'participant_updated':
      unknownFields(value, ['type', 'protocolVersion', 'roomId', 'participant'], path, context);
      readIdentifier(value.roomId, `${path}.roomId`, context, true);
      validateParticipant(value.participant, `${path}.participant`, context);
      return;
    case 'participant_left':
      unknownFields(
        value,
        ['type', 'protocolVersion', 'roomId', 'participantId', 'sessionId'],
        path,
        context,
      );
      readIdentifier(value.roomId, `${path}.roomId`, context, true);
      readIdentifier(value.participantId, `${path}.participantId`, context, true);
      readIdentifier(value.sessionId, `${path}.sessionId`, context, true);
      return;
    case 'room_policy_updated':
      validateRoomPolicyUpdatedEvent(value, path, context);
      return;
    case 'room_token_revoked':
      validateRoomTokenRevokedEvent(value, path, context);
      return;
    case 'roll_error':
      unknownFields(
        value,
        [
          'type',
          'protocolVersion',
          'roomId',
          'requestId',
          'code',
          'message',
          'rollId',
          'currentRevision',
          'issues',
          'supportedProtocolVersions',
          'retryAfterMs',
          'limit',
        ],
        path,
        context,
      );
      if (value.protocolVersion !== undefined)
        validateProtocolVersion(value.protocolVersion, `${path}.protocolVersion`, context);
      if (value.roomId !== undefined) readIdentifier(value.roomId, `${path}.roomId`, context, true);
      readOptionalIdentifier(value.requestId, `${path}.requestId`, context);
      readIdentifier(value.code, `${path}.code`, context, true);
      readString(value.message, `${path}.message`, context, { required: true, maximum: 2_000 });
      readOptionalIdentifier(value.rollId, `${path}.rollId`, context);
      readOptionalNonNegativeInteger(value.currentRevision, `${path}.currentRevision`, context);
      if (value.issues !== undefined)
        validateValidationIssues(value.issues, `${path}.issues`, context);
      if (value.supportedProtocolVersions !== undefined)
        validateNumberArray(
          value.supportedProtocolVersions,
          `${path}.supportedProtocolVersions`,
          context,
          16,
        );
      readOptionalNonNegativeInteger(value.retryAfterMs, `${path}.retryAfterMs`, context);
      readOptionalIdentifier(value.limit, `${path}.limit`, context);
      return;
    case undefined:
      // `readString` already recorded the missing/invalid-type issue.
      return;
    default:
      context.add(
        issue(
          'invalid_value',
          `${path}.type`,
          'Unsupported server event type',
          'known server event type',
          type,
        ),
      );
  }
}

function validateRoomRollEvent(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
  type: 'roll_start' | 'roll_updated' | 'roll_visibility_updated',
): void {
  const common = [
    'type',
    'protocolVersion',
    'roomId',
    'eventSequence',
    'requestId',
    'clientRollId',
    'replayed',
    'rollId',
    'sequence',
    'actor',
    'visibility',
    'hidden',
    'summary',
    'result',
  ];
  const extra =
    type === 'roll_updated'
      ? [
          'animate',
          'animationSeed',
          'serverStartTimeMs',
          'animationDurationMs',
          'startBufferMs',
          'audit',
        ]
      : type === 'roll_start'
        ? ['animationSeed', 'serverStartTimeMs', 'animationDurationMs', 'startBufferMs']
        : ['previousVisibility', 'audit'];
  unknownFields(value, [...common, ...extra], path, context);
  readIdentifier(value.roomId, `${path}.roomId`, context, true);
  readNonNegativeInteger(value.eventSequence, `${path}.eventSequence`, context, true);
  readOptionalIdentifier(value.requestId, `${path}.requestId`, context);
  readOptionalIdentifier(value.clientRollId, `${path}.clientRollId`, context);
  if (value.replayed !== undefined) readBoolean(value.replayed, `${path}.replayed`, context);
  readIdentifier(value.rollId, `${path}.rollId`, context, true);
  readNonNegativeInteger(value.sequence, `${path}.sequence`, context, true);
  validateActor(value.actor, `${path}.actor`, context);
  validateProjectedVisibility(value.visibility, `${path}.visibility`, context);
  readBoolean(value.hidden, `${path}.hidden`, context, true);
  validateRollSummary(value.summary, `${path}.summary`, context);
  if (value.result !== null) validateNormalizedResult(value.result, `${path}.result`, context);
  if (value.hidden === true && value.result !== null) {
    context.add(
      issue(
        'invalid_value',
        `${path}.result`,
        'Hidden projections must not contain a result',
        'null',
        value.result,
      ),
    );
  }
  if (value.hidden === false && value.result === null) {
    context.add(
      issue(
        'invalid_value',
        `${path}.result`,
        'Visible roll events require a normalized result',
        'NormalizedRollResult',
        value.result,
      ),
    );
  }
  if (type === 'roll_updated') readBoolean(value.animate, `${path}.animate`, context, true);
  if (type === 'roll_visibility_updated')
    validateProjectedVisibility(value.previousVisibility, `${path}.previousVisibility`, context);
  if (value.audit !== undefined) validateRollAudit(value.audit, `${path}.audit`, context);
  if (value.animationSeed !== undefined)
    readIdentifier(value.animationSeed, `${path}.animationSeed`, context, true);
  if (value.serverStartTimeMs !== undefined)
    readFiniteNumber(value.serverStartTimeMs, `${path}.serverStartTimeMs`, context, true);
  if (value.animationDurationMs !== undefined)
    readRange(value.animationDurationMs, `${path}.animationDurationMs`, context, 0, 120_000);
  if (value.startBufferMs !== undefined)
    readRange(value.startBufferMs, `${path}.startBufferMs`, context, 0, 10_000);
}

function validateRoomState(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
): void {
  unknownFields(
    value,
    [
      'type',
      'protocolVersion',
      'roomId',
      'sequence',
      'latestRollSequence',
      'latestEventSequence',
      'eventBufferStartSequence',
      'missedEventsTruncated',
      'defaultThemeId',
      'policy',
      'policyRevision',
      'participants',
      'recentEvents',
      'recentRolls',
      'recentRoll',
    ],
    path,
    context,
  );
  readIdentifier(value.roomId, `${path}.roomId`, context, true);
  readNonNegativeInteger(value.sequence, `${path}.sequence`, context, true);
  readNonNegativeInteger(value.latestRollSequence, `${path}.latestRollSequence`, context, true);
  readNonNegativeInteger(value.latestEventSequence, `${path}.latestEventSequence`, context, true);
  readNonNegativeInteger(
    value.eventBufferStartSequence,
    `${path}.eventBufferStartSequence`,
    context,
    true,
  );
  readBoolean(value.missedEventsTruncated, `${path}.missedEventsTruncated`, context, true);
  readOptionalIdentifier(value.defaultThemeId, `${path}.defaultThemeId`, context);
  validateRoomPolicy(value.policy, `${path}.policy`, context, false);
  readNonNegativeInteger(value.policyRevision, `${path}.policyRevision`, context, true);
  validateArray(value.participants, `${path}.participants`, context, 512, validateParticipant);
  validateArray(
    value.recentEvents,
    `${path}.recentEvents`,
    context,
    context.limits.maximumArrayLength,
    validateReplayEvent,
    true,
  );
  validateArray(
    value.recentRolls,
    `${path}.recentRolls`,
    context,
    context.limits.maximumArrayLength,
    (item, itemPath, itemContext) => {
      if (!expectRecord(item, itemPath, itemContext)) return;
      const eventType = item.type;
      if (
        eventType !== 'roll_start' &&
        eventType !== 'roll_updated' &&
        eventType !== 'roll_visibility_updated'
      ) {
        itemContext.add(
          issue(
            'invalid_value',
            `${itemPath}.type`,
            'Room state contains a non-roll event',
            'room roll event',
            eventType,
          ),
        );
        return;
      }
      validateRoomRollEvent(item, itemPath, itemContext, eventType);
    },
  );
  if (value.recentRoll !== undefined) {
    if (!expectRecord(value.recentRoll, `${path}.recentRoll`, context)) return;
    const eventType = value.recentRoll.type;
    if (
      eventType === 'roll_start' ||
      eventType === 'roll_updated' ||
      eventType === 'roll_visibility_updated'
    ) {
      validateRoomRollEvent(value.recentRoll, `${path}.recentRoll`, context, eventType);
    } else {
      context.add(
        issue(
          'invalid_value',
          `${path}.recentRoll.type`,
          'recentRoll must be a room roll event',
          'room roll event',
          eventType,
        ),
      );
    }
  }
}

function validateRoomPolicyUpdatedEvent(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
): void {
  unknownFields(
    value,
    [
      'type',
      'protocolVersion',
      'roomId',
      'eventSequence',
      'requestId',
      'revision',
      'actor',
      'policy',
      'previousPolicy',
      'replayed',
    ],
    path,
    context,
  );
  readIdentifier(value.roomId, `${path}.roomId`, context, true);
  readNonNegativeInteger(value.eventSequence, `${path}.eventSequence`, context, true);
  readOptionalIdentifier(value.requestId, `${path}.requestId`, context);
  readNonNegativeInteger(value.revision, `${path}.revision`, context, true);
  validateActor(value.actor, `${path}.actor`, context);
  validateRoomPolicy(value.policy, `${path}.policy`, context, false);
  validateRoomPolicy(value.previousPolicy, `${path}.previousPolicy`, context, false);
  if (value.replayed !== undefined) readBoolean(value.replayed, `${path}.replayed`, context);
}

function validateRoomTokenRevocationTarget(
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  if (!expectRecord(value, path, context)) return;
  const type = readString(value.type, `${path}.type`, context, { required: true, maximum: 64 });
  if (type === 'token') {
    unknownFields(value, ['type', 'tokenId', 'expiresAt'], path, context);
    readIdentifier(value.tokenId, `${path}.tokenId`, context, true);
    readOptionalNonNegativeInteger(value.expiresAt, `${path}.expiresAt`, context);
    return;
  }
  if (type === 'participant') {
    unknownFields(value, ['type', 'participantId', 'issuedAtOrBefore'], path, context);
    readIdentifier(value.participantId, `${path}.participantId`, context, true);
    readOptionalNonNegativeInteger(value.issuedAtOrBefore, `${path}.issuedAtOrBefore`, context);
    return;
  }
  context.add(
    issue(
      'invalid_value',
      `${path}.type`,
      'Unknown room token revocation target',
      'token | participant',
      type,
    ),
  );
}

function validateRoomTokenRevokedEvent(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
): void {
  unknownFields(
    value,
    [
      'type',
      'protocolVersion',
      'roomId',
      'eventSequence',
      'requestId',
      'actor',
      'target',
      'revokedAt',
      'reason',
      'disconnectedSessions',
      'replayed',
    ],
    path,
    context,
  );
  readIdentifier(value.roomId, `${path}.roomId`, context, true);
  readNonNegativeInteger(value.eventSequence, `${path}.eventSequence`, context, true);
  readOptionalIdentifier(value.requestId, `${path}.requestId`, context);
  validateActor(value.actor, `${path}.actor`, context);
  validateRoomTokenRevocationTarget(value.target, `${path}.target`, context);
  readIsoDate(value.revokedAt, `${path}.revokedAt`, context, true);
  if (value.reason !== undefined)
    readString(value.reason, `${path}.reason`, context, { maximum: 500 });
  readNonNegativeInteger(value.disconnectedSessions, `${path}.disconnectedSessions`, context, true);
  if (value.replayed !== undefined) readBoolean(value.replayed, `${path}.replayed`, context);
}

function validateReplayEvent(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  const eventType = value.type;
  if (
    eventType === 'roll_start' ||
    eventType === 'roll_updated' ||
    eventType === 'roll_visibility_updated'
  ) {
    validateRoomRollEvent(value, path, context, eventType);
  } else if (eventType === 'room_policy_updated') {
    validateRoomPolicyUpdatedEvent(value, path, context);
  } else if (eventType === 'room_token_revoked') {
    validateRoomTokenRevokedEvent(value, path, context);
  } else {
    context.add(
      issue(
        'invalid_value',
        `${path}.type`,
        'Room state contains an unsupported replay event',
        'room roll, policy, or token-revocation event',
        eventType,
      ),
    );
  }
}

function validateRoomPolicy(
  value: unknown,
  path: string,
  context: ValidationContext,
  patch: boolean,
): void {
  if (!expectRecord(value, path, context)) return;
  const fullFields = [
    'schemaVersion',
    'preset',
    'enabled',
    'shutdownReason',
    'access',
    'authorization',
    'limits',
    'rateLimits',
    'lifecycle',
    'renderer',
  ];
  const patchFields = [
    'preset',
    'enabled',
    'shutdownReason',
    'authorization',
    'limits',
    'rateLimits',
    'lifecycle',
    'renderer',
  ];
  unknownFields(value, patch ? patchFields : fullFields, path, context);
  if (!patch) {
    if (value.schemaVersion !== DRAFTROLL_ROOM_POLICY_SCHEMA_VERSION) {
      context.add(
        issue(
          'invalid_value',
          `${path}.schemaVersion`,
          'Unsupported room-policy schema version',
          String(DRAFTROLL_ROOM_POLICY_SCHEMA_VERSION),
          value.schemaVersion,
        ),
      );
    }
  }
  if (value.preset !== undefined) {
    const allowed = patch
      ? ['open-table', 'private-gm-table', 'moderated-public-room']
      : ['open-table', 'private-gm-table', 'moderated-public-room', 'custom'];
    if (!isOneOf(value.preset, allowed))
      context.add(
        issue(
          'invalid_value',
          `${path}.preset`,
          'Unknown room policy preset',
          allowed.join(' | '),
          value.preset,
        ),
      );
  } else if (!patch) {
    context.add(
      issue(
        'missing_field',
        `${path}.preset`,
        'Room policy preset is required',
        'room policy preset',
        value.preset,
      ),
    );
  }
  if (value.enabled !== undefined) readBoolean(value.enabled, `${path}.enabled`, context, true);
  else if (!patch)
    context.add(
      issue(
        'missing_field',
        `${path}.enabled`,
        'Room enabled state is required',
        'boolean',
        value.enabled,
      ),
    );
  if (value.shutdownReason !== undefined && value.shutdownReason !== null)
    readString(value.shutdownReason, `${path}.shutdownReason`, context, { maximum: 500 });
  validatePolicyAccess(value.access, `${path}.access`, context, patch);
  validatePolicyAuthorization(value.authorization, `${path}.authorization`, context, patch);
  validatePolicyLimits(value.limits, `${path}.limits`, context, patch);
  validatePolicyRateLimits(value.rateLimits, `${path}.rateLimits`, context, patch);
  validatePolicyLifecycle(value.lifecycle, `${path}.lifecycle`, context, patch);
  validatePolicyRenderer(value.renderer, `${path}.renderer`, context, true);
}

function validateRollAudit(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(value, ['reason', 'label'], path, context);
  if (value.reason !== undefined)
    readString(value.reason, `${path}.reason`, context, { maximum: 500 });
  if (value.label !== undefined)
    readString(value.label, `${path}.label`, context, { maximum: 100 });
}

function validatePolicyRenderer(
  value: unknown,
  path: string,
  context: ValidationContext,
  optional: boolean,
): void {
  if (value === undefined && optional) return;
  if (!expectRecord(value, path, context)) return;
  unknownFields(
    value,
    [
      'defaultThemeId',
      'performanceProfile',
      'concurrentTableRolls',
      'maximumConcurrentVisuals',
      'autoClearMs',
      'reducedMotion',
      'requireRendererReady',
      'requireThemesReady',
      'readinessTimeoutMs',
      'physicsPreset',
    ],
    path,
    context,
  );
  if (value.defaultThemeId !== undefined)
    readIdentifier(value.defaultThemeId, `${path}.defaultThemeId`, context, true);
  if (
    value.performanceProfile !== undefined &&
    !isOneOf(value.performanceProfile, ['auto', 'battery', 'quality'])
  ) {
    context.add(
      issue(
        'invalid_value',
        `${path}.performanceProfile`,
        'Unknown renderer performance profile',
        'auto | battery | quality',
        value.performanceProfile,
      ),
    );
  }
  if (value.concurrentTableRolls !== undefined)
    readBoolean(value.concurrentTableRolls, `${path}.concurrentTableRolls`, context, true);
  if (value.maximumConcurrentVisuals !== undefined)
    readBoundedInteger(
      value.maximumConcurrentVisuals,
      `${path}.maximumConcurrentVisuals`,
      context,
      1,
      250,
    );
  if (value.autoClearMs !== undefined)
    readBoundedInteger(value.autoClearMs, `${path}.autoClearMs`, context, 0, 24 * 60 * 60 * 1000);
  if (value.reducedMotion !== undefined)
    readBoolean(value.reducedMotion, `${path}.reducedMotion`, context, true);
  if (value.requireRendererReady !== undefined)
    readBoolean(value.requireRendererReady, `${path}.requireRendererReady`, context, true);
  if (value.requireThemesReady !== undefined)
    readBoolean(value.requireThemesReady, `${path}.requireThemesReady`, context, true);
  if (value.readinessTimeoutMs !== undefined)
    readBoundedInteger(value.readinessTimeoutMs, `${path}.readinessTimeoutMs`, context, 0, 30_000);
  if (
    value.physicsPreset !== undefined &&
    !isOneOf(value.physicsPreset, ['standard', 'compact', 'heavy', 'low-gravity'])
  ) {
    context.add(
      issue(
        'invalid_value',
        `${path}.physicsPreset`,
        'Unknown room physics preset',
        'standard | compact | heavy | low-gravity',
        value.physicsPreset,
      ),
    );
  }
}

function validatePolicyAccess(
  value: unknown,
  path: string,
  context: ValidationContext,
  patch: boolean,
): void {
  if (value === undefined && patch) return;
  if (!expectRecord(value, path, context)) return;
  unknownFields(value, ['passwordProtected'], path, context);
  if (value.passwordProtected !== undefined)
    readBoolean(value.passwordProtected, `${path}.passwordProtected`, context, true);
  else if (!patch)
    context.add(
      issue(
        'missing_field',
        `${path}.passwordProtected`,
        'Room password protection state is required',
        'boolean',
        value.passwordProtected,
      ),
    );
}

function validatePolicyAuthorization(
  value: unknown,
  path: string,
  context: ValidationContext,
  patch: boolean,
): void {
  if (value === undefined && patch) return;
  if (!expectRecord(value, path, context)) return;
  const fields = [
    'allowParticipantRolls',
    'allowOwnRollUpdates',
    'allowOwnRollRerolls',
    'allowOwnRollReveal',
    'allowPrivilegedAnyRollUpdates',
    'allowPrivilegedAnyRollReveal',
    'allowHiddenRolls',
    'allowWhispers',
  ];
  unknownFields(value, fields, path, context);
  for (const field of fields) {
    if (value[field] !== undefined) readBoolean(value[field], `${path}.${field}`, context, true);
    else if (!patch)
      context.add(
        issue(
          'missing_field',
          `${path}.${field}`,
          `Room authorization field '${field}' is required`,
          'boolean',
          value[field],
        ),
      );
  }
}

function validatePolicyLimits(
  value: unknown,
  path: string,
  context: ValidationContext,
  patch: boolean,
): void {
  if (value === undefined && patch) return;
  if (!expectRecord(value, path, context)) return;
  const ranges: Record<string, [number, number]> = {
    maximumParticipants: [1, 1_000],
    maximumInboundMessageBytes: [1_024, 512 * 1024],
    maximumExpressionLength: [1, 65_536],
    maximumDicePerRoll: [1, 10_000],
    maximumOperationsPerRoll: [0, 5_000],
    maximumParticipantMetadataBytes: [0, 32 * 1024],
    maximumBufferedEvents: [10, 10_000],
    maximumRollsRetained: [1, 100_000],
    maximumRevisionsPerRoll: [1, 10_000],
  };
  unknownFields(value, Object.keys(ranges), path, context);
  for (const [field, [minimum, maximum]] of Object.entries(ranges)) {
    if (value[field] !== undefined)
      readBoundedInteger(value[field], `${path}.${field}`, context, minimum, maximum);
    else if (!patch)
      context.add(
        issue(
          'missing_field',
          `${path}.${field}`,
          `Room limit '${field}' is required`,
          `${minimum}..${maximum}`,
          value[field],
        ),
      );
  }
}

function validatePolicyRateLimits(
  value: unknown,
  path: string,
  context: ValidationContext,
  patch: boolean,
): void {
  if (value === undefined && patch) return;
  if (!expectRecord(value, path, context)) return;
  const fields = [
    'connectionAttemptsPerMinutePerIp',
    'passwordAttemptsPerMinutePerIp',
    'commandsPerMinutePerSession',
    'mutationsPerMinutePerParticipant',
    'rollsPerMinutePerRoom',
  ];
  unknownFields(value, fields, path, context);
  for (const field of fields) {
    if (value[field] !== undefined)
      readBoundedInteger(value[field], `${path}.${field}`, context, 1, 100_000);
    else if (!patch)
      context.add(
        issue(
          'missing_field',
          `${path}.${field}`,
          `Room rate limit '${field}' is required`,
          '1..100000',
          value[field],
        ),
      );
  }
}

function validatePolicyLifecycle(
  value: unknown,
  path: string,
  context: ValidationContext,
  patch: boolean,
): void {
  if (value === undefined && patch) return;
  if (!expectRecord(value, path, context)) return;
  const ranges: Record<string, [number, number]> = {
    staleSessionSeconds: [30, 7 * 24 * 60 * 60],
    roomIdleExpirySeconds: [60, 365 * 24 * 60 * 60],
    historyRetentionSeconds: [60, 10 * 365 * 24 * 60 * 60],
    revisionRetentionSeconds: [60, 10 * 365 * 24 * 60 * 60],
    maintenanceIntervalSeconds: [30, 24 * 60 * 60],
  };
  unknownFields(value, Object.keys(ranges), path, context);
  for (const [field, [minimum, maximum]] of Object.entries(ranges)) {
    if (value[field] !== undefined)
      readBoundedInteger(value[field], `${path}.${field}`, context, minimum, maximum);
    else if (!patch)
      context.add(
        issue(
          'missing_field',
          `${path}.${field}`,
          `Room lifecycle field '${field}' is required`,
          `${minimum}..${maximum}`,
          value[field],
        ),
      );
  }
}

function validateRoomPassword(
  value: unknown,
  path: string,
  context: ValidationContext,
  nullable: boolean,
): void {
  if (nullable && value === null) return;
  const password = readString(value, path, context, { required: true, maximum: 256 });
  if (password !== undefined && password.length < 8) {
    context.add(
      issue(
        'invalid_value',
        path,
        'Room passwords must contain at least 8 characters',
        '8..256 characters',
        password.length,
      ),
    );
  }
}

function validateRollInput(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  if (value.mode === 'evaluate') validateEvaluateInput(value, path, context);
  else if (value.mode === 'display') validateDisplayInput(value, path, context);
  else
    context.add(
      issue(
        'invalid_value',
        `${path}.mode`,
        'Roll input mode is unsupported',
        'evaluate | display',
        value.mode,
      ),
    );
}

function validateEvaluateInput(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
): void {
  unknownFields(
    value,
    [
      'mode',
      'name',
      'expression',
      'dice',
      'operations',
      'modifier',
      'themeId',
      'dialect',
      'advantage',
      'allowComments',
      'customDice',
      'metadata',
    ],
    path,
    context,
  );
  if (value.mode !== 'evaluate')
    context.add(
      issue('invalid_value', `${path}.mode`, 'Expected evaluate mode', 'evaluate', value.mode),
    );
  validateCommonRollInput(value, path, context);
  if (value.expression !== undefined)
    readString(value.expression, `${path}.expression`, context, {
      maximum: context.limits.maximumExpressionLength,
    });
  const hasExpression = value.expression !== undefined;
  const hasDice = value.dice !== undefined;
  if (hasExpression === hasDice) {
    context.add(
      issue(
        hasExpression ? 'invalid_value' : 'missing_field',
        path,
        hasExpression
          ? 'Evaluate input must use either expression or structured dice, not both'
          : 'Evaluate input requires exactly one of expression or dice',
        'exactly one of expression | dice',
        value,
      ),
    );
  }
  if (value.dice !== undefined) {
    validateArray(
      value.dice,
      `${path}.dice`,
      context,
      context.limits.maximumDice,
      validatePlannedDie,
    );
    validateUniqueObjectIds(value.dice, `${path}.dice`, context, 'die');
  }
  if (value.operations !== undefined)
    validateStructuredOperations(value.operations, `${path}.operations`, context);
  if (value.modifier !== undefined)
    readFiniteNumber(value.modifier, `${path}.modifier`, context, true);
  if (hasExpression) {
    if (value.operations !== undefined)
      context.add(
        issue(
          'invalid_value',
          `${path}.operations`,
          'Expression rolls cannot also define structured operations',
          'undefined',
          value.operations,
        ),
      );
    if (value.modifier !== undefined)
      context.add(
        issue(
          'invalid_value',
          `${path}.modifier`,
          'Expression rolls cannot also define a structured modifier',
          'undefined',
          value.modifier,
        ),
      );
  }
  if (value.dialect !== undefined && value.dialect !== 'd20' && value.dialect !== 'draftroll') {
    context.add(
      issue(
        'invalid_value',
        `${path}.dialect`,
        'Unknown dice dialect',
        'd20 | draftroll',
        value.dialect,
      ),
    );
  }
  if (
    value.advantage !== undefined &&
    !isOneOf(value.advantage, ['none', 'advantage', 'disadvantage'])
  ) {
    context.add(
      issue(
        'invalid_value',
        `${path}.advantage`,
        'Unknown advantage mode',
        'none | advantage | disadvantage',
        value.advantage,
      ),
    );
  }
  if (value.allowComments !== undefined)
    readBoolean(value.allowComments, `${path}.allowComments`, context);
  if (hasDice) {
    if (value.dialect !== undefined)
      context.add(
        issue(
          'invalid_value',
          `${path}.dialect`,
          'Structured dice do not use an expression dialect',
          'undefined',
          value.dialect,
        ),
      );
    if (value.allowComments !== undefined)
      context.add(
        issue(
          'invalid_value',
          `${path}.allowComments`,
          'Structured dice do not parse expression comments',
          'undefined',
          value.allowComments,
        ),
      );
    if (value.advantage !== undefined && value.advantage !== 'none') {
      context.add(
        issue(
          'invalid_value',
          `${path}.advantage`,
          'Structured dice require explicit keep/drop operations instead of advantage inference',
          'none | explicit operation',
          value.advantage,
        ),
      );
    }
  }
}

function validateDisplayInput(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(
    value,
    [
      'mode',
      'name',
      'dice',
      'total',
      'expression',
      'themeId',
      'annotation',
      'comment',
      'customDice',
      'metadata',
    ],
    path,
    context,
  );
  if (value.mode !== 'display')
    context.add(
      issue('invalid_value', `${path}.mode`, 'Expected display mode', 'display', value.mode),
    );
  validateCommonRollInput(value, path, context);
  validateArray(
    value.dice,
    `${path}.dice`,
    context,
    context.limits.maximumDice,
    validateExternalDie,
    true,
  );
  validateUniqueObjectIds(value.dice, `${path}.dice`, context, 'die');
  if (value.total !== undefined) readFiniteNumber(value.total, `${path}.total`, context, true);
  if (value.expression !== undefined)
    readString(value.expression, `${path}.expression`, context, {
      maximum: context.limits.maximumExpressionLength,
    });
  readNullableText(value.annotation, `${path}.annotation`, context);
  readNullableText(value.comment, `${path}.comment`, context);
}

function validateCommonRollInput(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
): void {
  if (value.name !== undefined) readString(value.name, `${path}.name`, context, { maximum: 200 });
  readOptionalIdentifier(value.themeId, `${path}.themeId`, context);
  if (value.customDice !== undefined)
    validateCustomDice(value.customDice, `${path}.customDice`, context);
  validateOptionalMetadata(value.metadata, `${path}.metadata`, context);
}

function validateRollUpdate(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(
    value,
    [
      'name',
      'expression',
      'dice',
      'removeDice',
      'total',
      'modifier',
      'annotation',
      'comment',
      'themeId',
      'metadata',
    ],
    path,
    context,
  );
  readNullableText(value.name, `${path}.name`, context, 200);
  readNullableText(
    value.expression,
    `${path}.expression`,
    context,
    context.limits.maximumExpressionLength,
  );
  if (value.dice !== undefined)
    validateArray(
      value.dice,
      `${path}.dice`,
      context,
      context.limits.maximumDice,
      validateDieUpdate,
    );
  if (value.removeDice !== undefined)
    validateStringArray(
      value.removeDice,
      `${path}.removeDice`,
      context,
      context.limits.maximumDice,
    );
  if (value.total !== undefined) readFiniteNumber(value.total, `${path}.total`, context, true);
  if (value.modifier !== undefined && value.modifier !== null)
    readFiniteNumber(value.modifier, `${path}.modifier`, context, true);
  readNullableText(value.annotation, `${path}.annotation`, context);
  readNullableText(value.comment, `${path}.comment`, context);
  if (value.themeId !== undefined && value.themeId !== null)
    readIdentifier(value.themeId, `${path}.themeId`, context, true);
  validateOptionalMetadata(value.metadata, `${path}.metadata`, context);
}

function validateNormalizedResult(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  if (value.schemaVersion === undefined) {
    if (context.allowLegacyResults) {
      value.schemaVersion = DRAFTROLL_RESULT_SCHEMA_VERSION;
    } else {
      context.add(
        issue(
          'invalid_result_schema_version',
          `${path}.schemaVersion`,
          'Normalized roll result is missing its schema version',
          String(DRAFTROLL_RESULT_SCHEMA_VERSION),
          'missing',
        ),
      );
    }
  }
  unknownFields(
    value,
    [
      'schemaVersion',
      'rollId',
      'sequence',
      'revision',
      'updatedAt',
      'authority',
      'name',
      'expression',
      'total',
      'integerTotal',
      'dice',
      'operations',
      'modifier',
      'annotation',
      'comment',
      'critical',
      'dialect',
      'advantage',
      'tree',
      'themeId',
      'metadata',
      'customDice',
      'createdAt',
    ],
    path,
    context,
  );
  if (
    value.schemaVersion !== undefined &&
    value.schemaVersion !== DRAFTROLL_RESULT_SCHEMA_VERSION
  ) {
    context.add(
      issue(
        'invalid_result_schema_version',
        `${path}.schemaVersion`,
        'Unsupported normalized-result schema version',
        String(DRAFTROLL_RESULT_SCHEMA_VERSION),
        value.schemaVersion,
      ),
    );
  }
  readOptionalIdentifier(value.rollId, `${path}.rollId`, context);
  readOptionalNonNegativeInteger(value.sequence, `${path}.sequence`, context);
  readOptionalNonNegativeInteger(value.revision, `${path}.revision`, context);
  readOptionalIsoDate(value.updatedAt, `${path}.updatedAt`, context);
  if (!isOneOf(value.authority, ['local', 'server', 'external'])) {
    context.add(
      issue(
        'invalid_value',
        `${path}.authority`,
        'Unknown roll authority',
        'local | server | external',
        value.authority,
      ),
    );
  }
  if (value.name !== undefined) readString(value.name, `${path}.name`, context, { maximum: 200 });
  if (value.expression !== undefined)
    readString(value.expression, `${path}.expression`, context, {
      maximum: context.limits.maximumExpressionLength,
    });
  readFiniteNumber(value.total, `${path}.total`, context, true);
  if (value.integerTotal !== undefined)
    readSafeInteger(value.integerTotal, `${path}.integerTotal`, context);
  validateArray(
    value.dice,
    `${path}.dice`,
    context,
    context.limits.maximumDice,
    validateNormalizedDie,
    true,
  );
  validateArray(
    value.operations,
    `${path}.operations`,
    context,
    context.limits.maximumOperations,
    validateOperation,
    true,
  );
  if (value.modifier !== undefined)
    readFiniteNumber(value.modifier, `${path}.modifier`, context, true);
  readNullableText(value.annotation, `${path}.annotation`, context);
  readNullableText(value.comment, `${path}.comment`, context);
  if (
    value.critical !== undefined &&
    !isOneOf(value.critical, ['none', 'critical-success', 'critical-failure'])
  ) {
    context.add(
      issue(
        'invalid_value',
        `${path}.critical`,
        'Unknown critical state',
        'none | critical-success | critical-failure',
        value.critical,
      ),
    );
  }
  if (value.dialect !== undefined && value.dialect !== 'd20' && value.dialect !== 'draftroll') {
    context.add(
      issue(
        'invalid_value',
        `${path}.dialect`,
        'Unknown dice dialect',
        'd20 | draftroll',
        value.dialect,
      ),
    );
  }
  if (
    value.advantage !== undefined &&
    !isOneOf(value.advantage, ['none', 'advantage', 'disadvantage'])
  ) {
    context.add(
      issue(
        'invalid_value',
        `${path}.advantage`,
        'Unknown advantage mode',
        'none | advantage | disadvantage',
        value.advantage,
      ),
    );
  }
  if (value.tree !== undefined) validateTree(value.tree, `${path}.tree`, context, 0);
  readOptionalIdentifier(value.themeId, `${path}.themeId`, context);
  validateOptionalMetadata(value.metadata, `${path}.metadata`, context);
  if (value.customDice !== undefined)
    validateCustomDice(value.customDice, `${path}.customDice`, context);
  readIsoDate(value.createdAt, `${path}.createdAt`, context, true);
}

function validateNormalizedDie(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(
    value,
    [
      'id',
      'type',
      'sides',
      'result',
      'numericValue',
      'faceIndex',
      'faceLabel',
      'faceMetadata',
      'kept',
      'themeId',
      'customDiceId',
      'appearance',
      'physics',
      'sourceRollIndex',
      'generatedBy',
      'generatedFromDieId',
      'annotations',
      'metadata',
    ],
    path,
    context,
  );
  readIdentifier(value.id, `${path}.id`, context, true);
  readIdentifier(value.type, `${path}.type`, context, true);
  if (value.sides !== undefined) readPositiveInteger(value.sides, `${path}.sides`, context);
  validateResultScalar(value.result, `${path}.result`, context, true);
  if (value.numericValue !== undefined)
    readFiniteNumber(value.numericValue, `${path}.numericValue`, context, true);
  readOptionalNonNegativeInteger(value.faceIndex, `${path}.faceIndex`, context);
  if (value.faceLabel !== undefined)
    readString(value.faceLabel, `${path}.faceLabel`, context, { maximum: 500 });
  validateOptionalMetadata(value.faceMetadata, `${path}.faceMetadata`, context);
  readBoolean(value.kept, `${path}.kept`, context, true);
  readOptionalIdentifier(value.themeId, `${path}.themeId`, context);
  readOptionalIdentifier(value.customDiceId, `${path}.customDiceId`, context);
  if (value.appearance !== undefined)
    validateAppearance(value.appearance, `${path}.appearance`, context);
  if (value.physics !== undefined)
    validatePhysicsProperties(value.physics, `${path}.physics`, context);
  readOptionalNonNegativeInteger(value.sourceRollIndex, `${path}.sourceRollIndex`, context);
  if (
    value.generatedBy !== undefined &&
    !isOneOf(value.generatedBy, ['initial', 'reroll', 'reroll-add', 'explosion', 'external'])
  ) {
    context.add(
      issue(
        'invalid_value',
        `${path}.generatedBy`,
        'Unknown die generation source',
        'known generatedBy value',
        value.generatedBy,
      ),
    );
  }
  readOptionalIdentifier(value.generatedFromDieId, `${path}.generatedFromDieId`, context);
  if (value.annotations !== undefined)
    validateStringArray(value.annotations, `${path}.annotations`, context, 128);
  validateOptionalMetadata(value.metadata, `${path}.metadata`, context);
}

function validateOperation(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(
    value,
    ['type', 'count', 'comparator', 'target', 'selector', 'notation', 'appliedTo', 'metadata'],
    path,
    context,
  );
  const type = readString(value.type, `${path}.type`, context, { required: true, maximum: 64 });
  const supportedTypes = [
    'keep',
    'drop',
    'keep-highest',
    'keep-lowest',
    'drop-highest',
    'drop-lowest',
    'reroll',
    'reroll-once',
    'reroll-add',
    'explode',
    'minimum',
    'maximum',
    'success-count',
  ];
  if (type !== undefined && !supportedTypes.includes(type))
    context.add(
      issue(
        'invalid_value',
        `${path}.type`,
        'Unknown roll operation',
        supportedTypes.join(' | '),
        type,
      ),
    );
  readOptionalNonNegativeInteger(value.count, `${path}.count`, context);
  if (
    value.comparator !== undefined &&
    !isOneOf(value.comparator, ['=', '==', '!=', '<', '<=', '>', '>='])
  ) {
    context.add(
      issue(
        'invalid_value',
        `${path}.comparator`,
        'Unknown comparator',
        '= | == | != | < | <= | > | >=',
        value.comparator,
      ),
    );
  }
  if (value.target !== undefined) readFiniteNumber(value.target, `${path}.target`, context, true);
  if (value.selector !== undefined) validateSelector(value.selector, `${path}.selector`, context);
  if (value.notation !== undefined)
    readString(value.notation, `${path}.notation`, context, { maximum: 1_000 });
  validateStringArray(
    value.appliedTo,
    `${path}.appliedTo`,
    context,
    context.limits.maximumDice,
    true,
  );
  validateOptionalMetadata(value.metadata, `${path}.metadata`, context);
}

function validateTree(
  value: unknown,
  path: string,
  context: ValidationContext,
  depth: number,
): void {
  if (depth > context.limits.maximumTreeDepth) {
    context.add(
      issue(
        'limit_exceeded',
        path,
        'Result tree exceeds maximum depth',
        `<= ${context.limits.maximumTreeDepth}`,
        depth,
      ),
    );
    return;
  }
  if (!expectRecord(value, path, context)) return;
  readIdentifier(value.id, `${path}.id`, context, true);
  readFiniteNumber(value.value, `${path}.value`, context, true);
  readBoolean(value.kept, `${path}.kept`, context, true);
  validateStringArray(value.annotations, `${path}.annotations`, context, 128, true);
  validateStringArray(value.diceIds, `${path}.diceIds`, context, context.limits.maximumDice, true);
  const kind = readString(value.kind, `${path}.kind`, context, { required: true, maximum: 32 });
  if (kind === 'literal') readFiniteNumber(value.literal, `${path}.literal`, context, true);
  else if (kind === 'die') {
    readIdentifier(value.dieId, `${path}.dieId`, context, true);
    if (!(typeof value.sides === 'number' || typeof value.sides === 'string'))
      context.add(
        issue(
          'invalid_type',
          `${path}.sides`,
          'Die tree sides must be numeric or string',
          'number | string',
          value.sides,
        ),
      );
    readIdentifier(value.generatedBy, `${path}.generatedBy`, context, true);
  } else if (kind === 'dice') {
    readNonNegativeInteger(value.count, `${path}.count`, context, true);
    if (!(typeof value.sides === 'number' || value.sides === 'F'))
      context.add(
        issue(
          'invalid_type',
          `${path}.sides`,
          'Dice tree sides must be numeric or F',
          'number | F',
          value.sides,
        ),
      );
    if (value.percentile !== undefined)
      readBoolean(value.percentile, `${path}.percentile`, context);
    validateArray(
      value.children,
      `${path}.children`,
      context,
      context.limits.maximumDice,
      (item, itemPath, itemContext) => validateTree(item, itemPath, itemContext, depth + 1),
      true,
    );
  } else if (kind === 'set') {
    validateArray(
      value.children,
      `${path}.children`,
      context,
      context.limits.maximumArrayLength,
      (item, itemPath, itemContext) => validateTree(item, itemPath, itemContext, depth + 1),
      true,
    );
  } else if (kind === 'parenthetical' || kind === 'unary') {
    if (kind === 'unary' && value.operator !== '+' && value.operator !== '-')
      context.add(
        issue(
          'invalid_value',
          `${path}.operator`,
          'Unary operator is invalid',
          '+ | -',
          value.operator,
        ),
      );
    validateTree(value.child, `${path}.child`, context, depth + 1);
  } else if (kind === 'binary') {
    readIdentifier(value.operator, `${path}.operator`, context, true);
    validateTree(value.left, `${path}.left`, context, depth + 1);
    validateTree(value.right, `${path}.right`, context, depth + 1);
  } else {
    context.add(
      issue(
        'invalid_value',
        `${path}.kind`,
        'Unknown result tree node kind',
        'literal | die | dice | set | parenthetical | unary | binary',
        kind,
      ),
    );
  }
}

function validatePlannedDie(
  value: unknown,
  path: string,
  context: ValidationContext,
  external = false,
): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(
    value,
    [
      'id',
      'type',
      'sides',
      'result',
      'numericValue',
      'faceIndex',
      ...(external ? ['kept', 'sourceRollIndex', 'generatedBy', 'generatedFromDieId'] : []),
      'themeId',
      'customDiceId',
      'appearance',
      'physics',
      'annotations',
      'metadata',
    ],
    path,
    context,
  );
  readIdentifier(value.id, `${path}.id`, context, true);
  readIdentifier(value.type, `${path}.type`, context, true);
  if (value.sides !== undefined) readPositiveInteger(value.sides, `${path}.sides`, context);
  if (value.result !== undefined)
    validateResultScalar(value.result, `${path}.result`, context, true);
  if (value.numericValue !== undefined)
    readFiniteNumber(value.numericValue, `${path}.numericValue`, context, true);
  readOptionalNonNegativeInteger(value.faceIndex, `${path}.faceIndex`, context);
  readOptionalIdentifier(value.themeId, `${path}.themeId`, context);
  readOptionalIdentifier(value.customDiceId, `${path}.customDiceId`, context);
  if (value.appearance !== undefined)
    validateAppearance(value.appearance, `${path}.appearance`, context);
  if (value.physics !== undefined && value.physics !== null)
    validatePhysicsProperties(value.physics, `${path}.physics`, context);
  if (external) {
    readOptionalNonNegativeInteger(value.sourceRollIndex, `${path}.sourceRollIndex`, context);
    if (
      value.generatedBy !== undefined &&
      !isOneOf(value.generatedBy, ['initial', 'reroll', 'reroll-add', 'explosion', 'external'])
    ) {
      context.add(
        issue(
          'invalid_value',
          `${path}.generatedBy`,
          'Unknown die generation source',
          'known generatedBy value',
          value.generatedBy,
        ),
      );
    }
    readOptionalIdentifier(value.generatedFromDieId, `${path}.generatedFromDieId`, context);
  }
  if (value.annotations !== undefined)
    validateStringArray(value.annotations, `${path}.annotations`, context, 128);
  validateOptionalMetadata(value.metadata, `${path}.metadata`, context);
}

function validateExternalDie(value: unknown, path: string, context: ValidationContext): void {
  validatePlannedDie(value, path, context, true);
  if (isRecord(value)) {
    validateResultScalar(value.result, `${path}.result`, context, true);
    if (value.kept !== undefined) readBoolean(value.kept, `${path}.kept`, context);
  }
}

function validateDieUpdate(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(
    value,
    [
      'id',
      'type',
      'sides',
      'result',
      'numericValue',
      'faceIndex',
      'kept',
      'themeId',
      'customDiceId',
      'appearance',
      'physics',
      'annotations',
      'metadata',
    ],
    path,
    context,
  );
  readIdentifier(value.id, `${path}.id`, context, true);
  if (value.type !== undefined) readIdentifier(value.type, `${path}.type`, context, true);
  if (value.sides !== undefined) readPositiveInteger(value.sides, `${path}.sides`, context);
  if (value.result !== undefined)
    validateResultScalar(value.result, `${path}.result`, context, true);
  if (value.numericValue !== undefined)
    readFiniteNumber(value.numericValue, `${path}.numericValue`, context, true);
  readOptionalNonNegativeInteger(value.faceIndex, `${path}.faceIndex`, context);
  if (value.kept !== undefined) readBoolean(value.kept, `${path}.kept`, context);
  for (const key of ['themeId', 'customDiceId'] as const) {
    if (value[key] !== undefined && value[key] !== null)
      readIdentifier(value[key], `${path}.${key}`, context, true);
  }
  if (value.appearance !== undefined && value.appearance !== null)
    validateAppearance(value.appearance, `${path}.appearance`, context);
  if (value.physics !== undefined && value.physics !== null)
    validatePhysicsProperties(value.physics, `${path}.physics`, context);
  if (value.annotations !== undefined && value.annotations !== null)
    validateStringArray(value.annotations, `${path}.annotations`, context, 128);
  if (value.metadata !== undefined && value.metadata !== null)
    validateMetadata(value.metadata, `${path}.metadata`, context);
}

function validateStructuredOperations(
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  const rankTypes = new Set(['keep-highest', 'keep-lowest', 'drop-highest', 'drop-lowest']);
  const selectorTypes = new Set([
    'keep',
    'drop',
    'reroll',
    'reroll-once',
    'reroll-add',
    'explode',
    'minimum',
    'maximum',
    'success-count',
  ]);
  validateArray(
    value,
    path,
    context,
    context.limits.maximumOperations,
    (item, itemPath, itemContext) => {
      if (!expectRecord(item, itemPath, itemContext)) return;
      unknownFields(
        item,
        ['type', 'count', 'dice', 'comparator', 'target', 'selector', 'notation'],
        itemPath,
        itemContext,
      );
      const type = readString(item.type, `${itemPath}.type`, itemContext, {
        required: true,
        maximum: 64,
      });
      if (type !== undefined && !rankTypes.has(type) && !selectorTypes.has(type)) {
        itemContext.add(
          issue(
            'invalid_value',
            `${itemPath}.type`,
            'Unknown structured roll operation',
            'known roll operation type',
            type,
          ),
        );
        return;
      }
      if (item.dice !== undefined) {
        validateStringArray(
          item.dice,
          `${itemPath}.dice`,
          itemContext,
          itemContext.limits.maximumDice,
        );
        validateUniqueStrings(item.dice, `${itemPath}.dice`, itemContext, 'die id');
      }
      if (item.notation !== undefined)
        readString(item.notation, `${itemPath}.notation`, itemContext, { maximum: 1_000 });

      if (type !== undefined && rankTypes.has(type)) {
        if (item.count !== undefined)
          readOptionalNonNegativeInteger(item.count, `${itemPath}.count`, itemContext);
        for (const field of ['comparator', 'target', 'selector'] as const) {
          if (item[field] !== undefined)
            itemContext.add(
              issue(
                'invalid_value',
                `${itemPath}.${field}`,
                `Operation '${type}' uses count rather than ${field}`,
                'undefined',
                item[field],
              ),
            );
        }
        return;
      }

      if (item.count !== undefined)
        itemContext.add(
          issue(
            'invalid_value',
            `${itemPath}.count`,
            `Operation '${String(type)}' does not accept count`,
            'undefined',
            item.count,
          ),
        );
      const hasSelector = item.selector !== undefined;
      const hasTarget = item.target !== undefined;
      const hasComparator = item.comparator !== undefined;
      if (hasSelector) validateSelector(item.selector, `${itemPath}.selector`, itemContext);
      if (
        hasComparator &&
        !['=', '==', '!=', '<', '<=', '>', '>='].includes(String(item.comparator))
      ) {
        itemContext.add(
          issue(
            'invalid_value',
            `${itemPath}.comparator`,
            'Unknown comparator',
            '= | == | != | < | <= | > | >=',
            item.comparator,
          ),
        );
      }
      if (hasTarget) readFiniteNumber(item.target, `${itemPath}.target`, itemContext, true);
      if (hasComparator && !hasTarget)
        itemContext.add(
          issue(
            'missing_field',
            `${itemPath}.target`,
            'A comparator requires a target',
            'finite number',
            item.target,
          ),
        );
      if (!hasSelector && !hasTarget && type !== undefined) {
        itemContext.add(
          issue(
            'missing_field',
            itemPath,
            `Operation '${type}' requires a selector or target`,
            'selector | target',
            item,
          ),
        );
      }
      if (hasSelector && (hasComparator || hasTarget)) {
        itemContext.add(
          issue(
            'invalid_value',
            itemPath,
            'Use either selector or comparator/target shorthand, not both',
            'selector | comparator+target',
            item,
          ),
        );
      }
    },
  );
}

function validateSelector(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(value, ['type', 'target'], path, context);
  const type = readString(value.type, `${path}.type`, context, { required: true, maximum: 64 });
  const supported = [
    'literal',
    'highest',
    'lowest',
    'greater',
    'less',
    'greater-equal',
    'less-equal',
    'not-equal',
  ];
  if (type !== undefined && !supported.includes(type)) {
    context.add(
      issue('invalid_value', `${path}.type`, 'Unknown roll selector', supported.join(' | '), type),
    );
  }
  if (type === 'highest' || type === 'lowest')
    readNonNegativeInteger(value.target, `${path}.target`, context, true);
  else readFiniteNumber(value.target, `${path}.target`, context, true);
}

function validateCustomDice(value: unknown, path: string, context: ValidationContext): void {
  validateArray(
    value,
    path,
    context,
    context.limits.maximumCustomDice,
    (item, itemPath, itemContext) => {
      if (!expectRecord(item, itemPath, itemContext)) return;
      unknownFields(item, ['id', 'faces', 'renderAs', 'metadata'], itemPath, itemContext);
      readIdentifier(item.id, `${itemPath}.id`, itemContext, true);
      validateArray(
        item.faces,
        `${itemPath}.faces`,
        itemContext,
        itemContext.limits.maximumCustomFaces,
        (face, facePath, faceContext) => {
          if (!expectRecord(face, facePath, faceContext)) return;
          unknownFields(
            face,
            ['result', 'value', 'weight', 'label', 'metadata'],
            facePath,
            faceContext,
          );
          validateResultScalar(face.result, `${facePath}.result`, faceContext, true);
          if (face.value !== undefined)
            readFiniteNumber(face.value, `${facePath}.value`, faceContext, true);
          if (face.weight !== undefined)
            readPositiveSafeInteger(face.weight, `${facePath}.weight`, faceContext);
          if (face.label !== undefined)
            readString(face.label, `${facePath}.label`, faceContext, { maximum: 500 });
          validateOptionalMetadata(face.metadata, `${facePath}.metadata`, faceContext);
        },
        true,
      );
      if (Array.isArray(item.faces)) {
        let totalWeight = 0;
        let safe = true;
        for (const face of item.faces) {
          if (!isRecord(face)) continue;
          const weight = face.weight ?? 1;
          if (typeof weight !== 'number' || !Number.isSafeInteger(weight) || weight < 1) {
            safe = false;
            continue;
          }
          totalWeight += weight;
          if (!Number.isSafeInteger(totalWeight)) safe = false;
        }
        if (!safe)
          itemContext.add(
            issue(
              'invalid_value',
              `${itemPath}.faces`,
              'Custom-die weights must have a positive safe-integer total',
              `total <= ${Number.MAX_SAFE_INTEGER}`,
              totalWeight,
            ),
          );
      }
      readOptionalIdentifier(item.renderAs, `${itemPath}.renderAs`, itemContext);
      validateOptionalMetadata(item.metadata, `${itemPath}.metadata`, itemContext);
    },
  );
  validateUniqueObjectIds(value, path, context, 'custom die');
}

function validatePhysicsProperties(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(value, ['sizeScale', 'massScale', 'inertiaScale'], path, context);
  if (value.sizeScale !== undefined)
    readRange(value.sizeScale, `${path}.sizeScale`, context, 0.5, 2);
  if (value.massScale !== undefined)
    readRange(value.massScale, `${path}.massScale`, context, 0.25, 4);
  if (value.inertiaScale !== undefined)
    readRange(value.inertiaScale, `${path}.inertiaScale`, context, 0.25, 4);
}

function validateAppearance(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(value, ['primaryColor', 'secondaryColor', 'materialId'], path, context);
  if (value.primaryColor !== undefined)
    readString(value.primaryColor, `${path}.primaryColor`, context, { maximum: 128 });
  if (value.secondaryColor !== undefined)
    readString(value.secondaryColor, `${path}.secondaryColor`, context, { maximum: 128 });
  readOptionalIdentifier(value.materialId, `${path}.materialId`, context);
}

function validateRollVisibility(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  const type = readString(value.type, `${path}.type`, context, { required: true, maximum: 64 });
  if (type === 'public' || type === 'roller') {
    unknownFields(value, ['type'], path, context);
  } else if (type === 'roles') {
    unknownFields(value, ['type', 'roles'], path, context);
    validateStringArray(value.roles, `${path}.roles`, context, 128, true);
  } else if (type === 'participants') {
    unknownFields(value, ['type', 'participantIds'], path, context);
    validateStringArray(value.participantIds, `${path}.participantIds`, context, 512, true);
  } else if (type === 'participants-and-roles') {
    unknownFields(value, ['type', 'participantIds', 'roles'], path, context);
    validateStringArray(value.participantIds, `${path}.participantIds`, context, 512, true);
    validateStringArray(value.roles, `${path}.roles`, context, 128, true);
  } else {
    context.add(
      issue(
        'invalid_value',
        `${path}.type`,
        'Unknown roll visibility policy',
        'public | roller | roles | participants | participants-and-roles',
        type,
      ),
    );
  }
}

function validateProjectedVisibility(
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  if (isRecord(value) && value.type === 'hidden') {
    unknownFields(value, ['type'], path, context);
    return;
  }
  validateRollVisibility(value, path, context);
}

function validateActorFields(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
): void {
  readIdentifier(value.participantId, `${path}.participantId`, context, true);
  readIdentifier(value.sessionId, `${path}.sessionId`, context, true);
  readString(value.name, `${path}.name`, context, { required: true, maximum: 200 });
  validateStringArray(value.roles, `${path}.roles`, context, 128, true);
  validateOptionalMetadata(value.metadata, `${path}.metadata`, context);
}

function validateActor(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(value, ['participantId', 'sessionId', 'name', 'roles', 'metadata'], path, context);
  validateActorFields(value, path, context);
}

function validateParticipant(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(
    value,
    ['participantId', 'sessionId', 'name', 'roles', 'metadata', 'permissions', 'connectedAt'],
    path,
    context,
  );
  validateActorFields(value, path, context);
  validateStringArray(value.permissions, `${path}.permissions`, context, 64, true);
  readIsoDate(value.connectedAt, `${path}.connectedAt`, context, true);
}

function validateRollSummary(value: unknown, path: string, context: ValidationContext): void {
  if (!expectRecord(value, path, context)) return;
  unknownFields(
    value,
    ['rollId', 'sequence', 'revision', 'name', 'actor', 'createdAt', 'updatedAt'],
    path,
    context,
  );
  readIdentifier(value.rollId, `${path}.rollId`, context, true);
  readNonNegativeInteger(value.sequence, `${path}.sequence`, context, true);
  readNonNegativeInteger(value.revision, `${path}.revision`, context, true);
  if (value.name !== undefined) readString(value.name, `${path}.name`, context, { maximum: 200 });
  validateActor(value.actor, `${path}.actor`, context);
  readIsoDate(value.createdAt, `${path}.createdAt`, context, true);
  readOptionalIsoDate(value.updatedAt, `${path}.updatedAt`, context);
}

function validateValidationIssues(value: unknown, path: string, context: ValidationContext): void {
  validateArray(value, path, context, 100, (item, itemPath, itemContext) => {
    if (!expectRecord(item, itemPath, itemContext)) return;
    unknownFields(item, ['code', 'path', 'message', 'expected', 'received'], itemPath, itemContext);
    readIdentifier(item.code, `${itemPath}.code`, itemContext, true);
    readString(item.path, `${itemPath}.path`, itemContext, { required: true, maximum: 1_000 });
    readString(item.message, `${itemPath}.message`, itemContext, {
      required: true,
      maximum: 2_000,
    });
    if (item.expected !== undefined)
      readString(item.expected, `${itemPath}.expected`, itemContext, { maximum: 1_000 });
    if (item.received !== undefined)
      readString(item.received, `${itemPath}.received`, itemContext, { maximum: 1_000 });
  });
}

function validateProtocolVersion(value: unknown, path: string, context: ValidationContext): void {
  if (!Number.isSafeInteger(value)) {
    context.add(
      issue(
        'invalid_protocol_version',
        path,
        'Protocol version must be an integer',
        'integer',
        value,
      ),
    );
  } else if (value !== DRAFTROLL_PROTOCOL_VERSION) {
    context.add(
      issue(
        'unsupported_protocol_version',
        path,
        `Protocol version ${String(value)} is unsupported`,
        DRAFTROLL_SUPPORTED_PROTOCOL_VERSIONS.join(' | '),
        value,
      ),
    );
  }
}

function validateOptionalMetadata(value: unknown, path: string, context: ValidationContext): void {
  if (value !== undefined) validateMetadata(value, path, context);
}

function validateMetadata(value: unknown, path: string, context: ValidationContext): void {
  if (!isRecord(value)) {
    context.add(issue('invalid_type', path, 'Metadata must be an object', 'object', value));
    return;
  }
  let encoded = '';
  try {
    encoded = JSON.stringify(value);
  } catch {
    context.add(
      issue('invalid_value', path, 'Metadata must be JSON serializable', 'JSON object', value),
    );
    return;
  }
  const bytes = new TextEncoder().encode(encoded).byteLength;
  if (bytes > context.limits.maximumMetadataBytes) {
    context.add(
      issue(
        'limit_exceeded',
        path,
        'Metadata exceeds maximum encoded size',
        `<= ${context.limits.maximumMetadataBytes} bytes`,
        `${bytes} bytes`,
      ),
    );
  }
  const state = { keys: 0 };
  validateJsonValue(value, path, context, 0, state);
}

function validateJsonValue(
  value: unknown,
  path: string,
  context: ValidationContext,
  depth: number,
  state: { keys: number },
): void {
  if (depth > context.limits.maximumMetadataDepth) {
    context.add(
      issue(
        'limit_exceeded',
        path,
        'Metadata exceeds maximum nesting depth',
        `<= ${context.limits.maximumMetadataDepth}`,
        depth,
      ),
    );
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > context.limits.maximumStringLength)
      context.add(
        issue(
          'limit_exceeded',
          path,
          'Metadata string is too long',
          `<= ${context.limits.maximumStringLength}`,
          value.length,
        ),
      );
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      context.add(
        issue('invalid_value', path, 'Metadata numbers must be finite', 'finite number', value),
      );
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > context.limits.maximumArrayLength)
      context.add(
        issue(
          'limit_exceeded',
          path,
          'Metadata array is too long',
          `<= ${context.limits.maximumArrayLength}`,
          value.length,
        ),
      );
    value.forEach((item, index) =>
      validateJsonValue(item, `${path}.${index}`, context, depth + 1, state),
    );
    return;
  }
  if (!isRecord(value)) {
    context.add(
      issue('invalid_type', path, 'Metadata contains a non-JSON value', 'JSON value', value),
    );
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    state.keys += 1;
    if (state.keys > context.limits.maximumMetadataKeys) {
      context.add(
        issue(
          'limit_exceeded',
          path,
          'Metadata has too many keys',
          `<= ${context.limits.maximumMetadataKeys}`,
          state.keys,
        ),
      );
      return;
    }
    if (key.length > 256)
      context.add(
        issue(
          'limit_exceeded',
          `${path}.${key}`,
          'Metadata key is too long',
          '<= 256 characters',
          key.length,
        ),
      );
    validateJsonValue(item, `${path}.${key}`, context, depth + 1, state);
  }
}

function validateArray(
  value: unknown,
  path: string,
  context: ValidationContext,
  maximum: number,
  validateItem: (item: unknown, path: string, context: ValidationContext) => void,
  required = false,
): void {
  if (value === undefined && !required) return;
  if (!Array.isArray(value)) {
    context.add(
      issue(
        required && value === undefined ? 'missing_field' : 'invalid_type',
        path,
        'Expected an array',
        'array',
        value,
      ),
    );
    return;
  }
  if (value.length > maximum)
    context.add(
      issue('limit_exceeded', path, 'Array exceeds maximum length', `<= ${maximum}`, value.length),
    );
  value
    .slice(0, maximum + 1)
    .forEach((item, index) => validateItem(item, `${path}.${index}`, context));
}

function validateUniqueObjectIds(
  value: unknown,
  path: string,
  context: ValidationContext,
  label: string,
): void {
  if (!Array.isArray(value)) return;
  const seen = new Map<string, number>();
  value.forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string') return;
    const first = seen.get(item.id);
    if (first !== undefined)
      context.add(
        issue(
          'invalid_value',
          `${path}.${index}.id`,
          `Duplicate ${label} id '${item.id}'`,
          `unique id; first used at ${path}.${first}.id`,
          item.id,
        ),
      );
    else seen.set(item.id, index);
  });
}

function validateUniqueStrings(
  value: unknown,
  path: string,
  context: ValidationContext,
  label: string,
): void {
  if (!Array.isArray(value)) return;
  const seen = new Map<string, number>();
  value.forEach((item, index) => {
    if (typeof item !== 'string') return;
    const first = seen.get(item);
    if (first !== undefined)
      context.add(
        issue(
          'invalid_value',
          `${path}.${index}`,
          `Duplicate ${label} '${item}'`,
          `unique value; first used at ${path}.${first}`,
          item,
        ),
      );
    else seen.set(item, index);
  });
}

function readPositiveSafeInteger(
  value: unknown,
  path: string,
  context: ValidationContext,
): number | undefined {
  const result = readSafeInteger(value, path, context);
  if (result !== undefined && result < 1)
    context.add(
      issue(
        'invalid_value',
        path,
        'Expected a positive safe integer',
        '1..Number.MAX_SAFE_INTEGER',
        result,
      ),
    );
  return result;
}

function validateStringArray(
  value: unknown,
  path: string,
  context: ValidationContext,
  maximum: number,
  required = false,
): void {
  validateArray(
    value,
    path,
    context,
    maximum,
    (item, itemPath, itemContext) =>
      readString(item, itemPath, itemContext, { required: true, maximum: 500 }),
    required,
  );
}

function validateNumberArray(
  value: unknown,
  path: string,
  context: ValidationContext,
  maximum: number,
): void {
  validateArray(value, path, context, maximum, (item, itemPath, itemContext) =>
    readSafeInteger(item, itemPath, itemContext),
  );
}

function validateResultScalar(
  value: unknown,
  path: string,
  context: ValidationContext,
  required = false,
): void {
  if (value === undefined && required)
    context.add(issue('missing_field', path, 'A die result is required', 'number | string', value));
  else if (!(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))))
    context.add(
      issue(
        'invalid_type',
        path,
        'Die result must be a finite number or string',
        'number | string',
        value,
      ),
    );
  else if (typeof value === 'string' && value.length > context.limits.maximumStringLength)
    context.add(
      issue(
        'limit_exceeded',
        path,
        'Die result string is too long',
        `<= ${context.limits.maximumStringLength}`,
        value.length,
      ),
    );
}

function expectRecord(
  value: unknown,
  path: string,
  context: ValidationContext,
): value is Record<string, unknown> {
  if (isRecord(value)) return true;
  context.add(
    issue(
      value === undefined ? 'missing_field' : 'invalid_type',
      path,
      'Expected an object',
      'object',
      value,
    ),
  );
  return false;
}

function unknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  context: ValidationContext,
): void {
  if (!context.rejectUnknownFields) return;
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key))
      context.add(
        issue('unknown_field', `${path}.${key}`, `Unknown field '${key}'`, allowed.join(', '), key),
      );
  }
}

/**
 * Reports whether an untrusted value is one of the allowed string literals.
 *
 * Compares only genuine strings: coercing with `String()` first would let a
 * non-string (an object with a crafted `toString`, for instance) satisfy the
 * check, and would stringify objects to a useless `[object Object]`.
 */
function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function readString(
  value: unknown,
  path: string,
  context: ValidationContext,
  options: { required?: boolean; maximum?: number } = {},
): string | undefined {
  if (value === undefined) {
    if (options.required)
      context.add(issue('missing_field', path, 'Required string is missing', 'string', value));
    return undefined;
  }
  if (typeof value !== 'string') {
    context.add(issue('invalid_type', path, 'Expected a string', 'string', value));
    return undefined;
  }
  const maximum = options.maximum ?? context.limits.maximumStringLength;
  if (value.length > maximum)
    context.add(
      issue('limit_exceeded', path, 'String exceeds maximum length', `<= ${maximum}`, value.length),
    );
  return value;
}

function readIdentifier(
  value: unknown,
  path: string,
  context: ValidationContext,
  required = false,
): string | undefined {
  const text = readString(value, path, context, { required, maximum: 500 });
  if (text !== undefined && !text.trim())
    context.add(
      issue('invalid_value', path, 'Identifier must not be blank', 'non-empty string', text),
    );
  return text;
}

function readOptionalIdentifier(value: unknown, path: string, context: ValidationContext): void {
  if (value !== undefined) readIdentifier(value, path, context, true);
}

function readBoolean(
  value: unknown,
  path: string,
  context: ValidationContext,
  required = false,
): boolean | undefined {
  if (value === undefined) {
    if (required)
      context.add(issue('missing_field', path, 'Required boolean is missing', 'boolean', value));
    return undefined;
  }
  if (typeof value !== 'boolean')
    context.add(issue('invalid_type', path, 'Expected a boolean', 'boolean', value));
  return typeof value === 'boolean' ? value : undefined;
}

function readFiniteNumber(
  value: unknown,
  path: string,
  context: ValidationContext,
  required = false,
): number | undefined {
  if (value === undefined) {
    if (required)
      context.add(
        issue('missing_field', path, 'Required number is missing', 'finite number', value),
      );
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value))
    context.add(issue('invalid_type', path, 'Expected a finite number', 'finite number', value));
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readSafeInteger(
  value: unknown,
  path: string,
  context: ValidationContext,
): number | undefined {
  const number = readFiniteNumber(value, path, context, true);
  if (number !== undefined && !Number.isSafeInteger(number))
    context.add(issue('invalid_value', path, 'Expected a safe integer', 'safe integer', number));
  return number;
}

function readNonNegativeInteger(
  value: unknown,
  path: string,
  context: ValidationContext,
  required = false,
): number | undefined {
  if (value === undefined && !required) return undefined;
  const number = readSafeInteger(value, path, context);
  if (number !== undefined && number < 0)
    context.add(issue('invalid_value', path, 'Expected a non-negative integer', '>= 0', number));
  return number;
}

function readOptionalNonNegativeInteger(
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  if (value !== undefined) readNonNegativeInteger(value, path, context, true);
}

function readPositiveInteger(value: unknown, path: string, context: ValidationContext): void {
  const number = readSafeInteger(value, path, context);
  if (number !== undefined && number < 1)
    context.add(issue('invalid_value', path, 'Expected a positive integer', '>= 1', number));
}

function readBoundedInteger(
  value: unknown,
  path: string,
  context: ValidationContext,
  minimum: number,
  maximum: number,
): void {
  const number = readSafeInteger(value, path, context);
  if (number !== undefined && (number < minimum || number > maximum)) {
    context.add(
      issue(
        'invalid_value',
        path,
        'Integer is outside the supported range',
        `${minimum}..${maximum}`,
        number,
      ),
    );
  }
}

function readRange(
  value: unknown,
  path: string,
  context: ValidationContext,
  minimum: number,
  maximum: number,
): void {
  const number = readFiniteNumber(value, path, context, true);
  if (number !== undefined && (number < minimum || number > maximum))
    context.add(
      issue(
        'invalid_value',
        path,
        'Number is outside the supported range',
        `${minimum}..${maximum}`,
        number,
      ),
    );
}

function readNullableText(
  value: unknown,
  path: string,
  context: ValidationContext,
  maximum?: number,
): void {
  if (value !== undefined && value !== null) readString(value, path, context, { maximum });
}

function readIsoDate(
  value: unknown,
  path: string,
  context: ValidationContext,
  required = false,
): void {
  const text = readString(value, path, context, { required, maximum: 64 });
  if (text !== undefined && Number.isNaN(Date.parse(text)))
    context.add(issue('invalid_value', path, 'Expected an ISO date string', 'ISO-8601 date', text));
}

function readOptionalIsoDate(value: unknown, path: string, context: ValidationContext): void {
  if (value !== undefined) readIsoDate(value, path, context, true);
}

function failure<T>(message: string, issues: readonly RuntimeValidationIssue[]): DecodeResult<T> {
  return { success: false, error: new DraftrollValidationError(message, [...issues]) };
}

function issue(
  code: RuntimeValidationCode,
  path: string,
  message: string,
  expected?: string,
  received?: unknown,
): RuntimeValidationIssue {
  return {
    code,
    path,
    message,
    expected,
    received: received === undefined ? undefined : summarize(received),
  };
}

function summarize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length > 100 ? `${value.slice(0, 97)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function byteLength(raw: string | ArrayBuffer | ArrayBufferView): number {
  if (typeof raw === 'string') return new TextEncoder().encode(raw).byteLength;
  return raw.byteLength;
}

function structuredCloneIfObject<T>(value: T): T {
  return value && typeof value === 'object' ? structuredClone(value) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
