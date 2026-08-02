/**
 * Server-side room capability token helpers.
 *
 * @remarks
 * Creates and verifies signed room tokens without depending on browser APIs.
 *
 * @packageDocumentation
 */

import {
  DRAFTROLL_PROTOCOL_VERSION,
  decodeRoomCapabilityTokenPayload,
  type RoomCapabilityTokenPayload,
  type RoomPermission,
} from '../../protocol/src/index';

/**
 * Token type marker stored in a Draftroll room capability header.
 *
 * @public
 */
export const DRAFTROLL_ROOM_TOKEN_TYPE = 'DRT';
/**
 * Current compact room-token format version.
 *
 * @public
 */
export const DRAFTROLL_ROOM_TOKEN_FORMAT_VERSION = 1;

/**
 * Protected metadata encoded in a room capability token.
 *
 * @public
 */
export interface RoomTokenHeader {
  typ: typeof DRAFTROLL_ROOM_TOKEN_TYPE;
  alg: 'HS256';
  version: typeof DRAFTROLL_ROOM_TOKEN_FORMAT_VERSION;
  kid?: string;
}

/**
 * Key identifier and secret used to sign a room capability token.
 *
 * @public
 */
export interface RoomTokenSigningKey {
  id: string;
  secret: string;
}

/**
 * Single verification key, key ring, or key resolver accepted during verification.
 *
 * @public
 */
export type RoomTokenVerificationKeySource =
  | string
  | RoomTokenSigningKey
  | readonly RoomTokenSigningKey[]
  | Readonly<Record<string, string>>;

/**
 * Controls room-token lifetime, issuer, audience, identity, and activation time.
 *
 * @public
 */
export interface CreateRoomTokenOptions {
  expiresInSeconds?: number;
  now?: Date;
  issuer?: string;
  audience?: string | string[];
  tokenId?: string;
  notBefore?: Date | number;
}

/**
 * Stable code identifying room token verification failure.
 *
 * @public
 */
export type RoomTokenVerificationFailureCode =
  | 'malformed_token'
  | 'unsupported_token_header'
  | 'unknown_key_id'
  | 'invalid_signature'
  | 'invalid_payload'
  | 'protocol_mismatch'
  | 'room_mismatch'
  | 'token_expired'
  | 'token_not_yet_valid'
  | 'token_issued_in_future'
  | 'token_issuer_mismatch'
  | 'token_audience_mismatch'
  | 'token_id_required'
  | 'token_issued_at_required'
  | 'token_revoked';

/**
 * Defines deployment-specific token verification constraints and revocation checks.
 *
 * @public
 */
export interface VerifyRoomTokenOptions {
  roomId?: string;
  now?: Date;
  issuer?: string;
  audience?: string | readonly string[];
  clockToleranceSeconds?: number;
  requireTokenId?: boolean;
  requireIssuedAt?: boolean;
  isRevoked?: (
    payload: RoomCapabilityTokenPayload,
    header: RoomTokenHeader,
  ) => boolean | Promise<boolean>;
}

/**
 * Verified token header, payload, and signing-key identifier.
 *
 * @public
 */
export interface VerifiedRoomCapabilityToken {
  payload: RoomCapabilityTokenPayload;
  header: RoomTokenHeader;
  legacy: boolean;
  verifiedKeyId?: string;
}

/**
 * Structured success or failure result from detailed token verification.
 *
 * @public
 */
export type VerifyRoomCapabilityTokenResult =
  | { valid: true; token: VerifiedRoomCapabilityToken }
  | { valid: false; code: RoomTokenVerificationFailureCode; message: string };

/**
 * Signs a compact room-scoped capability token.
 *
 * @remarks
 * New tokens use a versioned `header.payload.signature` envelope with an optional key ID.
 * Call this only from trusted server-side code; never ship signing material to a browser.
 *
 * @param payload - Room-scoped claims excluding fields supplied by the token helper.
 * @param key - Signing secret or named signing key.
 * @param options - Lifetime and deployment identity defaults.
 * @returns A URL-safe signed capability token.
 * @throws `Error` when claims or signing-key material are invalid.
 *
 * @public
 */
export async function createRoomCapabilityToken(
  payload: Omit<RoomCapabilityTokenPayload, 'protocolVersion' | 'exp' | 'iat' | 'jti'> &
    Partial<Pick<RoomCapabilityTokenPayload, 'exp' | 'iat' | 'jti'>>,
  key: string | RoomTokenSigningKey,
  options: CreateRoomTokenOptions = {},
): Promise<string> {
  const signingKey = normalizeSigningKey(key);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const complete: RoomCapabilityTokenPayload = {
    ...payload,
    protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
    iss: payload.iss ?? options.issuer,
    aud: payload.aud ?? options.audience,
    iat: payload.iat ?? nowSeconds,
    nbf: payload.nbf ?? normalizeUnixTime(options.notBefore),
    jti: payload.jti ?? options.tokenId ?? crypto.randomUUID(),
    exp:
      payload.exp ??
      (options.expiresInSeconds === undefined ? undefined : nowSeconds + options.expiresInSeconds),
  };
  const validated = decodeRoomCapabilityTokenPayload(complete);
  if (!validated.success) throw validated.error;

  const header: RoomTokenHeader = {
    typ: DRAFTROLL_ROOM_TOKEN_TYPE,
    alg: 'HS256',
    version: DRAFTROLL_ROOM_TOKEN_FORMAT_VERSION,
    ...(signingKey.id ? { kid: signingKey.id } : {}),
  };
  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(validated.data);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await sign(signingInput, signingKey.secret);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Verifies and decodes a room capability token without collapsing failure reasons.
 *
 * @param token - Compact token received from an untrusted caller.
 * @param keySource - Verification secret, key ring, or key-ID mapping.
 * @param options - Expected room and deployment claims plus optional revocation lookup.
 * @returns A discriminated verification result; ordinary verification failures do not throw.
 *
 * @public
 */
export async function verifyRoomCapabilityTokenDetailed(
  token: string,
  keySource: RoomTokenVerificationKeySource,
  options: VerifyRoomTokenOptions = {},
): Promise<VerifyRoomCapabilityTokenResult> {
  const parts = token.split('.');
  const legacy = parts.length === 2;
  if (!(legacy || parts.length === 3)) {
    return invalid(
      'malformed_token',
      'Room capability tokens must contain two legacy parts or three versioned parts',
    );
  }

  let header: RoomTokenHeader;
  let payloadPart: string;
  let signaturePart: string;
  let signingInput: string;
  if (legacy) {
    header = {
      typ: DRAFTROLL_ROOM_TOKEN_TYPE,
      alg: 'HS256',
      version: DRAFTROLL_ROOM_TOKEN_FORMAT_VERSION,
    };
    payloadPart = parts[0]!;
    signaturePart = parts[1]!;
    signingInput = payloadPart;
  } else {
    const parsedHeader = decodeJson(parts[0]);
    if (!isRoomTokenHeader(parsedHeader)) {
      return invalid(
        'unsupported_token_header',
        'The room capability token header is invalid or unsupported',
      );
    }
    header = parsedHeader;
    payloadPart = parts[1]!;
    signaturePart = parts[2]!;
    signingInput = `${parts[0]}.${payloadPart}`;
  }

  const keys = normalizeVerificationKeys(keySource);
  const candidates = header.kid ? keys.filter((candidate) => candidate.id === header.kid) : keys;
  if (candidates.length === 0) {
    return invalid(
      'unknown_key_id',
      header.kid
        ? `No verification key is configured for key ID '${header.kid}'`
        : 'No room token verification key is configured',
    );
  }

  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(signaturePart);
  } catch {
    return invalid('malformed_token', 'The room capability token signature is not valid base64url');
  }

  let verifiedKey: RoomTokenSigningKey | undefined;
  for (const candidate of candidates) {
    if (await verifySignature(signingInput, signature, candidate.secret)) {
      verifiedKey = candidate;
      break;
    }
  }
  if (!verifiedKey)
    return invalid('invalid_signature', 'The room capability token signature is invalid');

  const parsedPayload = decodeJson(payloadPart);
  if (parsedPayload === null)
    return invalid('invalid_payload', 'The room capability token payload is not valid JSON');
  const decoded = decodeRoomCapabilityTokenPayload(parsedPayload);
  if (!decoded.success) return invalid('invalid_payload', decoded.error.message);
  const payload = decoded.data;

  if (
    payload.protocolVersion !== undefined &&
    payload.protocolVersion !== DRAFTROLL_PROTOCOL_VERSION
  ) {
    return invalid(
      'protocol_mismatch',
      'The room capability token uses an unsupported Draftroll protocol version',
    );
  }
  if (options.roomId !== undefined && payload.roomId !== options.roomId) {
    return invalid('room_mismatch', 'The room capability token is not valid for this room');
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const tolerance = Math.max(0, Math.floor(options.clockToleranceSeconds ?? 0));
  if (payload.exp !== undefined && payload.exp <= nowSeconds - tolerance) {
    return invalid('token_expired', 'The room capability token has expired');
  }
  if (payload.nbf !== undefined && payload.nbf > nowSeconds + tolerance) {
    return invalid('token_not_yet_valid', 'The room capability token is not valid yet');
  }
  if (payload.iat !== undefined && payload.iat > nowSeconds + tolerance) {
    return invalid('token_issued_in_future', 'The room capability token was issued in the future');
  }
  if (options.issuer !== undefined && payload.iss !== options.issuer) {
    return invalid(
      'token_issuer_mismatch',
      'The room capability token issuer does not match this deployment',
    );
  }
  if (options.audience !== undefined && !audienceMatches(payload.aud, options.audience)) {
    return invalid(
      'token_audience_mismatch',
      'The room capability token audience does not match this deployment',
    );
  }
  if (options.requireTokenId && !payload.jti) {
    return invalid(
      'token_id_required',
      'This deployment requires room capability tokens to include a token ID',
    );
  }
  if (options.requireIssuedAt && payload.iat === undefined) {
    return invalid(
      'token_issued_at_required',
      'This deployment requires room capability tokens to include an issued-at time',
    );
  }
  if (options.isRevoked && (await options.isRevoked(payload, header))) {
    return invalid('token_revoked', 'The room capability token has been revoked');
  }

  return {
    valid: true,
    token: {
      payload,
      header,
      legacy,
      verifiedKeyId: verifiedKey.id || undefined,
    },
  };
}

/**
 * Verifies a room token and returns only its claims for backwards compatibility.
 *
 * @param token - Compact token received from an untrusted caller.
 * @param keySource - Verification secret, key ring, or key-ID mapping.
 * @param options - Expected room and deployment constraints.
 * @returns Verified claims, or `null` for any ordinary verification failure.
 *
 * @public
 */
export async function verifyRoomCapabilityToken(
  token: string,
  keySource: RoomTokenVerificationKeySource,
  options: VerifyRoomTokenOptions = {},
): Promise<RoomCapabilityTokenPayload | null> {
  const result = await verifyRoomCapabilityTokenDetailed(token, keySource, options);
  return result.valid ? result.token.payload : null;
}

/**
 * Creates default participant permissions.
 *
 * @public
 */
export function createDefaultParticipantPermissions(): RoomPermission[] {
  return ['roll:create', 'roll:update-own', 'roll:reveal-own'];
}

/**
 * Creates game master permissions.
 *
 * @public
 */
export function createGameMasterPermissions(): RoomPermission[] {
  return [
    'roll:create',
    'roll:update-own',
    'roll:update-any',
    'roll:reveal-own',
    'roll:reveal-any',
    'roll:view-hidden',
    'room:manage',
  ];
}

function normalizeSigningKey(key: string | RoomTokenSigningKey): RoomTokenSigningKey {
  if (typeof key === 'string') {
    assertSecret(key);
    return { id: '', secret: key };
  }
  assertSecret(key.secret);
  if (!key.id.trim()) throw new Error('Draftroll room token key IDs must not be empty');
  return { id: key.id.trim(), secret: key.secret };
}

function normalizeVerificationKeys(source: RoomTokenVerificationKeySource): RoomTokenSigningKey[] {
  if (typeof source === 'string') return [normalizeSigningKey(source)];
  if (Array.isArray(source)) return source.map((key) => normalizeSigningKey(key));
  if (isSigningKey(source)) return [normalizeSigningKey(source)];
  return Object.entries(source).map(([id, secret]) => normalizeSigningKey({ id, secret }));
}

function isSigningKey(value: unknown): value is RoomTokenSigningKey {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'secret' in value);
}

/** Narrows an unknown value to an indexable object without asserting a shape. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRoomTokenHeader(value: unknown): value is RoomTokenHeader {
  if (!isRecord(value) || Array.isArray(value)) return false;
  const record = value;
  const allowed = new Set(['typ', 'alg', 'version', 'kid']);
  if (Object.keys(record).some((key) => !allowed.has(key))) return false;
  return (
    record.typ === DRAFTROLL_ROOM_TOKEN_TYPE &&
    record.alg === 'HS256' &&
    record.version === DRAFTROLL_ROOM_TOKEN_FORMAT_VERSION &&
    (record.kid === undefined ||
      (typeof record.kid === 'string' && record.kid.length > 0 && record.kid.length <= 200))
  );
}

function audienceMatches(
  tokenAudience: string | string[] | undefined,
  expected: string | readonly string[],
): boolean {
  if (tokenAudience === undefined) return false;
  const actual = Array.isArray(tokenAudience) ? tokenAudience : [tokenAudience];
  const wanted = Array.isArray(expected) ? expected : [expected];
  return wanted.some((audience) => actual.includes(audience));
}

function normalizeUnixTime(value: Date | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value instanceof Date ? Math.floor(value.getTime() / 1_000) : Math.floor(value);
}

function invalid(
  code: RoomTokenVerificationFailureCode,
  message: string,
): VerifyRoomCapabilityTokenResult {
  return { valid: false, code, message };
}

async function sign(value: string, secret: string): Promise<ArrayBuffer> {
  const key = await importHmacKey(secret, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
}

async function verifySignature(
  value: string,
  signature: Uint8Array,
  secret: string,
): Promise<boolean> {
  const key = await importHmacKey(secret, ['verify']);
  return crypto.subtle.verify(
    'HMAC',
    key,
    copyToArrayBuffer(signature),
    new TextEncoder().encode(value),
  );
}

function copyToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
  } catch {
    return null;
  }
}

function base64UrlEncode(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid base64url');
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function assertSecret(secret: string): void {
  if (!secret || secret.length < 16)
    throw new Error('Draftroll room token secrets must contain at least 16 characters');
}
