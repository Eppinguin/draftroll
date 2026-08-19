import { DiceEngine, normalizeExternalRoll } from '@draftroll/core';
import {
  verifyRoomCapabilityTokenDetailed,
  type RoomTokenHeader,
  type RoomTokenVerificationKeySource,
} from '@draftroll/server';
import {
  DRAFTROLL_PROTOCOL_VERSION,
  applyRoomPolicyPatch,
  createRoomPolicy,
  DRAFTROLL_SUPPORTED_PROTOCOL_VERSIONS,
  decodeClientToServerEvent,
  decodeNormalizedRollResult,
  decodeRoomPolicy,
  decodeRoomPolicyPatch,
  decodeServerToClientEvent,
  negotiateProtocolVersion,
  parseRuntimeJson,
  type BulkRollUpdatedEvent,
  type ClientToServerEvent,
  type NormalizedRollResult,
  type RollAuditDetails,
  type RollErrorEvent,
  type RollStartEvent,
  type RollUpdatedEvent,
  type RollVisibility,
  type RollVisibilityUpdatedEvent,
  type RoomActor,
  type RoomCapabilityTokenPayload,
  type RoomParticipant,
  type RoomPermission,
  type RoomPolicy,
  type RoomPolicyPreset,
  type RoomPolicyUpdatedEvent,
  type RoomReplayEvent,
  type RoomTokenRevocationTarget,
  type RoomTokenRevokedEvent,
  type RoomRollEvent,
  type RoomStateEvent,
  type ServerToClientEvent,
} from '@draftroll/protocol';

interface Env {
  DICE_ROOMS: DurableObjectNamespace<DiceRoomObject>;
  DB: D1Database;
  DRAFTROLL_ENV: string;
  ALLOWED_ORIGINS: string;
  /** Local development may allow unsigned participants. Secure deployments should disable it. */
  ALLOW_ANONYMOUS?: string;
  /** Legacy HMAC secret. Prefer ROOM_TOKEN_KEYS for key-ID based rotation. */
  ROOM_TOKEN_SECRET?: string;
  /** JSON object mapping verification key IDs to HMAC secrets. */
  ROOM_TOKEN_KEYS?: string;
  /** Required token issuer when configured. */
  ROOM_TOKEN_ISSUER?: string;
  /** Comma-separated accepted token audiences when configured. */
  ROOM_TOKEN_AUDIENCE?: string;
  /** Require jti and iat claims so every token can participate in revocation. */
  ROOM_TOKEN_REQUIRE_JTI?: string;
  EVENT_BUFFER_LIMIT?: string;
  ROOM_POLICY_PRESET?: string;
}

interface RollHistoryRow {
  roll_id: string;
  room_id: string;
  sequence: number;
  revision: number;
  authority: string;
  expression: string | null;
  total: number;
  result_json: string;
  actor_json: string | null;
  visibility_json: string | null;
  created_at: string;
  updated_at: string | null;
}

interface RoomRequestRow {
  event_sequence: number;
}

interface RoomEventRow {
  event_sequence: number;
  event_json: string;
  created_at: string;
}

interface RollRevisionRow {
  revision: number;
  result_json: string;
  actor_json: string | null;
  visibility_json: string | null;
  recorded_at: string;
}

interface ConnectionAttachment extends RoomParticipant {
  roomId: string;
  lastSeenAt: string;
  clientIpHash: string;
  passwordAuthenticated: boolean;
  joined: boolean;
  passwordAttempts: number;
  reconnectAfterEventSequence: number;
  authorizationComplete: boolean;
  tokenAuthenticated: boolean;
  tokenAttempts: number;
  tokenId?: string;
  tokenIssuedAt?: number;
  tokenExpiresAt?: number;
  tokenKeyId?: string;
  tokenIssuer?: string;
  tokenAudience?: string[];
  rendererReady?: boolean;
  themesReady?: boolean;
  roundTripMs?: number;
  clockUncertaintyMs?: number;
}

interface StoredRoomPassword {
  version: 1;
  algorithm: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  hash: string;
  updatedAt: string;
}

interface StoredExactTokenRevocation {
  version: 1;
  type: 'token';
  tokenId: string;
  revokedAt: string;
  expiresAt?: number;
  reason?: string;
  actorParticipantId: string;
}

interface StoredParticipantTokenRevocation {
  version: 1;
  type: 'participant';
  participantId: string;
  issuedAtOrBefore: number;
  revokedAt: string;
  reason?: string;
  actorParticipantId: string;
}

interface StoredRoll {
  result: NormalizedRollResult;
  actor: RoomActor;
  visibility: RollVisibility;
}

interface InternalRoomEventBase {
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  eventSequence: number;
  requestId?: string;
  requesterSessionId?: string;
  clientRollId?: string;
  rollId: string;
  sequence: number;
  actor: RoomActor;
  visibility: RollVisibility;
  result: NormalizedRollResult;
}

interface InternalRollStartEvent extends InternalRoomEventBase {
  type: 'roll_start';
  animationSeed: string;
  serverStartTimeMs: number;
  animationDurationMs: number;
  startBufferMs: number;
}

interface InternalRollUpdatedEvent extends InternalRoomEventBase {
  type: 'roll_updated';
  animate: boolean;
  animationSeed?: string;
  serverStartTimeMs?: number;
  animationDurationMs?: number;
  startBufferMs?: number;
  audit?: RollAuditDetails;
}

interface InternalRollVisibilityUpdatedEvent extends InternalRoomEventBase {
  type: 'roll_visibility_updated';
  previousVisibility: RollVisibility;
  audit?: RollAuditDetails;
}

type InternalRoomRollEvent =
  | InternalRollStartEvent
  | InternalRollUpdatedEvent
  | InternalRollVisibilityUpdatedEvent;

interface InternalRoomPolicyUpdatedEvent {
  type: 'room_policy_updated';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  eventSequence: number;
  requestId?: string;
  revision: number;
  actor: RoomActor;
  policy: RoomPolicy;
  previousPolicy: RoomPolicy;
}

interface InternalRoomTokenRevokedEvent {
  type: 'room_token_revoked';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  eventSequence: number;
  requestId?: string;
  actor: RoomActor;
  target: RoomTokenRevocationTarget;
  revokedAt: string;
  reason?: string;
  disconnectedSessions: number;
}

interface InternalBulkRollUpdatedEvent {
  type: 'bulk_rolls_updated';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  eventSequence: number;
  requestId: string;
  requesterSessionId: string;
  updates: Array<{ rollId: string; revision: number; eventSequence: number }>;
}

type InternalRoomEvent =
  | InternalRoomRollEvent
  | InternalRoomPolicyUpdatedEvent
  | InternalRoomTokenRevokedEvent
  | InternalBulkRollUpdatedEvent;

interface RequestCacheEntry {
  key: string;
  eventSequence: number;
}

interface FixedWindowCounter {
  windowStartedAt: number;
  count: number;
}

interface RollIndexEntry {
  rollId: string;
  sequence: number;
  updatedAt: string;
}

interface PersistenceFailure {
  at: string;
  operation: string;
  rollId?: string;
  message: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const ROOM_PASSWORD_STORAGE_KEY = 'roomPassword';
const ROOM_PASSWORD_MIN_LENGTH = 8;
const ROOM_PASSWORD_MAX_LENGTH = 256;
const ROOM_PASSWORD_PBKDF2_ITERATIONS = 210_000;
const MAX_PASSWORD_ATTEMPTS_PER_SOCKET = 5;
const MAX_TOKEN_ATTEMPTS_PER_SOCKET = 3;
const MIN_ANIMATION_START_BUFFER_MS = 225;
const MAX_ANIMATION_START_BUFFER_MS = 1_500;
const CLIENT_RENDER_PREPARATION_BUDGET_MS = 180;
const TOKEN_REVOCATION_PREFIX = 'tokenRevocation:';
const PARTICIPANT_TOKEN_REVOCATION_PREFIX = 'participantTokenRevocation:';
const MAX_EXACT_TOKEN_REVOCATIONS = 2_000;
const DEFAULT_ANONYMOUS_PERMISSIONS: RoomPermission[] = [
  'roll:create',
  'roll:update-own',
  'roll:reveal-own',
];
const ROOM_PERMISSIONS = new Set<RoomPermission>([
  'roll:create',
  'roll:update-own',
  'roll:update-any',
  'roll:reveal-own',
  'roll:reveal-any',
  'roll:view-hidden',
  'room:manage',
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (!isOriginAllowed(request, env)) {
      return json(
        {
          error: 'origin_not_allowed',
          message: 'The request origin is not allowed by this Draftroll server',
        },
        403,
        cors,
      );
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === 'GET' && url.pathname === '/') {
      return json(
        {
          service: 'draftroll-room',
          protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
          environment: env.DRAFTROLL_ENV,
          access:
            env.ALLOW_ANONYMOUS === 'true' ? 'anonymous-or-capability-token' : 'capability-token',
          endpoints: {
            health: '/health',
            state: '/rooms/:roomId/state',
            history: '/rooms/:roomId/history',
            events: '/rooms/:roomId/events',
            diagnostics: '/rooms/:roomId/diagnostics',
            revisions: '/rooms/:roomId/rolls/:rollId/revisions',
            policy: '/rooms/:roomId/policy',
            websocket: '/rooms/:roomId/connect',
          },
          websocketEvents: [
            'roll_request',
            'display_roll',
            'update_roll',
            'bulk_update_rolls',
            'set_roll_visibility',
            'participant_update',
            'set_room_policy',
            'set_room_password',
            'revoke_room_token',
            'authenticate_room_token',
            'authenticate_room_password',
          ],
        },
        200,
        cors,
      );
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(
        {
          ok: true,
          service: 'draftroll-room',
          protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
          environment: env.DRAFTROLL_ENV,
        },
        200,
        cors,
      );
    }

    const roomMatch =
      /^\/rooms\/([^/]+)\/(connect|state|history|events|diagnostics|policy|rolls\/[^/]+\/revisions)$/.exec(
        url.pathname,
      );
    if (!roomMatch) return json({ error: 'not_found' }, 404, cors);

    const roomId = decodeURIComponent(roomMatch[1]);
    const id = env.DICE_ROOMS.idFromName(roomId);
    const response = await env.DICE_ROOMS.get(id).fetch(request);

    if (response.status === 101) return response;
    return withHeaders(response, cors);
  },
} satisfies ExportedHandler<Env>;

export class DiceRoomObject {
  private readonly engine = new DiceEngine();
  private readonly sessions = new Map<WebSocket, ConnectionAttachment>();
  private eventBufferCache: InternalRoomEvent[] | null = null;
  private eventBufferRecoverySequenceCache: number | null | undefined;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    for (const socket of this.state.getWebSockets('draftroll-room')) {
      const attachment = deserializeAttachment(socket);
      if (attachment) this.sessions.set(socket, attachment);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomId = roomIdFromUrl(url);
    await this.rememberRoomId(roomId);
    await this.markActivity();

    const requestedProtocolVersion = Number(url.searchParams.get('protocolVersion'));
    const protocol = negotiateProtocolVersion(requestedProtocolVersion);
    if (!protocol.success) {
      return json(
        {
          error: 'unsupported_protocol_version',
          message: protocol.error.message,
          issues: protocol.error.issues,
          supportedProtocolVersions: [...DRAFTROLL_SUPPORTED_PROTOCOL_VERSIONS],
        },
        426,
      );
    }

    const isWebSocketUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    let participant: ConnectionAttachment;
    try {
      participant = await authorizeRequest(
        request,
        roomId,
        this.env,
        (payload) => this.isCapabilityTokenRevoked(payload),
        isWebSocketUpgrade,
      );
    } catch (error) {
      const authError =
        error instanceof AuthorizationError
          ? error
          : new AuthorizationError('invalid_authorization', asError(error).message, 401);
      return json({ error: authError.code, message: authError.message }, authError.status);
    }

    const policy = await this.getPolicy();
    participant = {
      ...participant,
      passwordAuthenticated:
        participant.authorizationComplete &&
        (!policy.access.passwordProtected || participant.permissions.includes('room:manage')),
    };
    await this.scheduleMaintenance(policy);
    try {
      assertMetadataSize(
        participant.metadata,
        policy.limits.maximumParticipantMetadataBytes,
        'participant metadata',
      );
      await this.consumeRateLimit(
        `session:${participant.sessionId}:http`,
        policy.rateLimits.commandsPerMinutePerSession,
        'commands_per_minute_per_session',
      );
    } catch (error) {
      return rateLimitedResponse(error);
    }

    if (!isWebSocketUpgrade && !participant.authorizationComplete) {
      return json(
        {
          error: 'token_required',
          message: 'This Draftroll server requires a room capability token',
        },
        401,
      );
    }
    if (!isWebSocketUpgrade && !participant.passwordAuthenticated) {
      const suppliedPassword = request.headers.get('X-Draftroll-Room-Password');
      if (!suppliedPassword) {
        return json(
          { error: 'room_password_required', message: 'This room requires a password' },
          401,
        );
      }
      try {
        await this.consumeRateLimit(
          `ip:${participant.clientIpHash}:password`,
          policy.rateLimits.passwordAttemptsPerMinutePerIp,
          'password_attempts_per_minute_per_ip',
        );
      } catch (error) {
        return rateLimitedResponse(error);
      }
      if (!(await this.verifyRoomPassword(suppliedPassword))) {
        return json(
          { error: 'invalid_room_password', message: 'The room password is incorrect' },
          401,
        );
      }
      participant = { ...participant, passwordAuthenticated: true };
    }

    if (url.pathname.endsWith('/state')) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const lastEventSequence = parseNonNegativeInteger(
        url.searchParams.get('lastEventSequence'),
        0,
      );
      return json(await this.createRoomState(participant, lastEventSequence));
    }

    if (url.pathname.endsWith('/policy')) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      return json({
        roomId,
        revision: await this.getPolicyRevision(),
        policy,
      });
    }

    if (url.pathname.endsWith('/history')) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const limit = clampInteger(url.searchParams.get('limit'), 1, 100, 20);
      return json(await this.getHistory(roomId, participant, limit));
    }

    if (url.pathname.endsWith('/events')) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const afterEventSequence = parseNonNegativeInteger(
        url.searchParams.get('afterEventSequence'),
        0,
      );
      const limit = clampInteger(url.searchParams.get('limit'), 1, 1_000, 500);
      return json(await this.getDurableEvents(roomId, participant, afterEventSequence, limit));
    }

    if (url.pathname.endsWith('/diagnostics')) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      if (!participant.permissions.includes('room:manage')) {
        return json(
          { error: 'permission_denied', message: 'Room diagnostics require room:manage' },
          403,
        );
      }
      return json(await this.createDiagnostics(roomId, policy));
    }

    const revisionsMatch = /\/rolls\/([^/]+)\/revisions$/.exec(url.pathname);
    if (revisionsMatch) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      return json(
        await this.getRevisions(roomId, decodeURIComponent(revisionsMatch[1]), participant),
      );
    }

    if (!isWebSocketUpgrade) {
      return json({ error: 'websocket_upgrade_required' }, 426);
    }

    try {
      await this.consumeRateLimit(
        `ip:${participant.clientIpHash}:connections`,
        policy.rateLimits.connectionAttemptsPerMinutePerIp,
        'connection_attempts_per_minute_per_ip',
      );
      this.assertParticipantCapacity(participant, policy);
    } catch (error) {
      return rateLimitedResponse(error);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server, ['draftroll-room']);
    serializeAttachment(server, participant);
    this.sessions.set(server, participant);
    await this.scheduleMaintenance(policy);

    if (!participant.authorizationComplete) {
      sendEvent(server, {
        type: 'roll_error',
        protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
        roomId,
        code: 'token_required',
        message: 'Authenticate with a room capability token before room state can be accessed',
      });
    } else if (participant.passwordAuthenticated) {
      await this.finalizeSession(server, participant);
    } else {
      sendEvent(server, {
        type: 'roll_error',
        protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
        roomId,
        code: 'room_password_required',
        message: 'This room requires a password before room state can be accessed',
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const participant = this.getSession(socket);
    if (!participant) {
      sendEvent(socket, {
        type: 'roll_error',
        protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
        roomId: 'unknown-room',
        code: 'unknown_session',
        message: 'The room session could not be restored',
      });
      socket.close(1011, 'Unknown Draftroll session');
      return;
    }

    const policy = await this.getPolicy();
    const refreshed: ConnectionAttachment = {
      ...participant,
      lastSeenAt: new Date().toISOString(),
    };
    serializeAttachment(socket, refreshed);
    this.sessions.set(socket, refreshed);
    await this.markActivity();

    const rawBytes = runtimePayloadByteLength(raw);
    if (rawBytes > policy.limits.maximumInboundMessageBytes) {
      sendEvent(socket, {
        type: 'roll_error',
        protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
        roomId: participant.roomId,
        code: 'payload_too_large',
        message: `Room command is ${rawBytes} bytes; policy maximum is ${policy.limits.maximumInboundMessageBytes}`,
        limit: 'maximum_inbound_message_bytes',
      });
      socket.close(1009, 'Draftroll command is too large');
      return;
    }

    try {
      await this.consumeRateLimit(
        `session:${participant.sessionId}:commands`,
        policy.rateLimits.commandsPerMinutePerSession,
        'commands_per_minute_per_session',
      );
      await this.consumeRateLimit(
        `ip:${participant.clientIpHash}:commands`,
        policy.rateLimits.commandsPerMinutePerSession,
        'commands_per_minute_per_ip_and_room',
      );
    } catch (error) {
      sendEvent(socket, toRollError(error));
      return;
    }

    const parsedEvent = parseClientEvent(raw, policy.limits.maximumInboundMessageBytes);
    if (!parsedEvent.event) {
      sendEvent(socket, {
        type: 'roll_error',
        protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
        roomId: participant.roomId,
        code: 'invalid_message',
        message:
          parsedEvent.error?.message ?? 'Message must be valid JSON with a supported event type',
        issues: parsedEvent.error?.issues ? [...parsedEvent.error.issues] : undefined,
      });
      return;
    }
    const event = parsedEvent.event;

    if (!refreshed.authorizationComplete) {
      if (event.type !== 'authenticate_room_token') {
        sendEvent(socket, {
          type: 'roll_error',
          protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
          roomId: participant.roomId,
          code: 'token_required',
          message: 'Authenticate with a room capability token before sending room commands',
        });
        return;
      }
      await this.handleTokenAuthentication(socket, refreshed, event.token, policy);
      return;
    }

    if (event.type === 'authenticate_room_token') return;

    if (!refreshed.passwordAuthenticated) {
      if (event.type !== 'authenticate_room_password') {
        sendEvent(socket, {
          type: 'roll_error',
          protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
          roomId: participant.roomId,
          code: 'room_password_required',
          message: 'Authenticate with the room password before sending room commands',
        });
        return;
      }
      await this.handlePasswordAuthentication(socket, refreshed, event.password, policy);
      return;
    }

    if (event.type === 'authenticate_room_password') return;

    if (event.type === 'clock_sync_ping') {
      sendEvent(socket, {
        type: 'clock_sync_pong',
        protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
        roomId: participant.roomId,
        clientTimeMs: event.clientTimeMs,
        serverTimeMs: Date.now(),
        nonce: event.nonce,
      });
      return;
    }

    if (event.type === 'client_ready') {
      const updated: ConnectionAttachment = {
        ...refreshed,
        rendererReady: event.rendererReady,
        themesReady: event.themesReady,
        roundTripMs: event.roundTripMs,
        clockUncertaintyMs: event.clockUncertaintyMs,
      };
      serializeAttachment(socket, updated);
      this.sessions.set(socket, updated);
      return;
    }

    if (event.type === 'participant_update') {
      try {
        await this.handleParticipantUpdate(socket, refreshed, event, policy);
      } catch (error) {
        sendEvent(socket, toRollError(error));
      }
      return;
    }

    let duplicate: InternalRoomEvent | null = null;
    if ('requestId' in event) {
      try {
        duplicate = await this.findDuplicateRequest(participant.sessionId, event.requestId);
      } catch (error) {
        sendEvent(socket, toRollError(error, event.requestId));
        return;
      }
    }
    if (duplicate) {
      const projected =
        duplicate.type === 'bulk_rolls_updated'
          ? projectBulkEvent(duplicate, refreshed, true)
          : projectInternalEvent(duplicate, refreshed, true);
      if (projected) sendEvent(socket, projected);
      else
        sendEvent(socket, {
          type: 'roll_error',
          protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
          roomId: refreshed.roomId,
          requestId: 'requestId' in event ? event.requestId : undefined,
          code: 'permission_denied',
          message: 'The retained response is not visible to this participant',
        });
      return;
    }

    try {
      if (event.type === 'set_room_policy') {
        await this.handlePolicyUpdate(refreshed, event);
        return;
      }
      if (event.type === 'set_room_password') {
        await this.handleRoomPasswordUpdate(refreshed, event);
        return;
      }
      if (event.type === 'revoke_room_token') {
        await this.handleTokenRevocation(refreshed, event, policy);
        return;
      }
      assertRoomEnabled(refreshed, policy);
      await this.consumeRateLimit(
        `participant:${participant.participantId}:mutations`,
        policy.rateLimits.mutationsPerMinutePerParticipant,
        'mutations_per_minute_per_participant',
      );
      if (event.type === 'roll_request' || event.type === 'display_roll') {
        await this.consumeRateLimit(
          'room:rolls',
          policy.rateLimits.rollsPerMinutePerRoom,
          'rolls_per_minute_per_room',
        );
        await this.handleNewRoll(refreshed, event, policy);
      } else if (event.type === 'update_roll') {
        await this.handleRollUpdate(refreshed, event, policy);
      } else if (event.type === 'bulk_update_rolls') {
        await this.handleBulkRollUpdate(socket, refreshed, event, policy);
      } else if (event.type === 'set_roll_visibility') {
        await this.handleVisibilityUpdate(refreshed, event, policy);
      }
    } catch (error) {
      const requestId = 'requestId' in event ? event.requestId : undefined;
      const response = toRollError(error, requestId, 'rollId' in event ? event.rollId : undefined);
      sendEvent(socket, response);
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    const participant = this.getSession(socket);
    this.sessions.delete(socket);
    if (participant?.joined) {
      this.broadcastParticipant(
        {
          type: 'participant_left',
          protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
          roomId: participant.roomId,
          participantId: participant.participantId,
          sessionId: participant.sessionId,
        },
        socket,
      );
    }
    socket.close(code, reason);
  }

  webSocketError(socket: WebSocket): void {
    this.sessions.delete(socket);
    socket.close(1011, 'WebSocket error');
  }

  async alarm(): Promise<void> {
    const policy = await this.getPolicy();
    const now = Date.now();
    const staleBefore = now - policy.lifecycle.staleSessionSeconds * 1_000;
    for (const [socket, participant] of this.getSessions()) {
      if (Date.parse(participant.lastSeenAt) < staleBefore) {
        this.sessions.delete(socket);
        socket.close(4000, 'Draftroll session expired due to inactivity');
        if (participant.joined)
          this.broadcastParticipant(
            {
              type: 'participant_left',
              protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
              roomId: participant.roomId,
              participantId: participant.participantId,
              sessionId: participant.sessionId,
            },
            socket,
          );
      }
    }

    await this.cleanupPersistence(policy);
    await this.cleanupTokenRevocations(now);
    await this.pruneRateCounters(now);

    const lastActivity = await this.state.storage.get<string>('lastActivityAt');
    const idleMs = lastActivity ? now - Date.parse(lastActivity) : 0;
    if (
      this.listParticipants().length === 0 &&
      idleMs >= policy.lifecycle.roomIdleExpirySeconds * 1_000
    ) {
      const roomId = await this.state.storage.get<string>('roomId');
      await this.state.storage.deleteAll();
      if (roomId) await this.state.storage.put('roomId', roomId);
      this.logStructured('room.expired', { roomId, idleMs });
      return;
    }

    await this.scheduleMaintenance(policy);
  }

  private async getPolicy(): Promise<RoomPolicy> {
    const stored = await this.state.storage.get<RoomPolicy>('roomPolicy');
    if (stored) {
      const passwordProtected = Boolean(
        await this.state.storage.get<StoredRoomPassword>(ROOM_PASSWORD_STORAGE_KEY),
      );
      const migrated = {
        ...stored,
        access: { ...stored.access, passwordProtected },
        rateLimits: {
          ...stored.rateLimits,
          passwordAttemptsPerMinutePerIp:
            (stored.rateLimits as Partial<RoomPolicy['rateLimits']>)
              .passwordAttemptsPerMinutePerIp ?? 10,
        },
      } as RoomPolicy;
      const decoded = decodeRoomPolicy(migrated, { rejectUnknownFields: true });
      if (decoded.success) {
        if (JSON.stringify(stored) !== JSON.stringify(decoded.data))
          await this.state.storage.put('roomPolicy', decoded.data);
        return decoded.data;
      }
      this.logStructured('room.policy_invalid_storage', { issues: decoded.error.issues });
    }
    const preset = isRoomPolicyPreset(this.env.ROOM_POLICY_PRESET)
      ? this.env.ROOM_POLICY_PRESET
      : 'open-table';
    const policy = createRoomPolicy(preset);
    policy.access.passwordProtected = Boolean(
      await this.state.storage.get<StoredRoomPassword>(ROOM_PASSWORD_STORAGE_KEY),
    );
    await this.state.storage.put({ roomPolicy: policy, policyRevision: 0 });
    return policy;
  }

  private async getPolicyRevision(): Promise<number> {
    return (await this.state.storage.get<number>('policyRevision')) ?? 0;
  }

  private async markActivity(): Promise<void> {
    await this.state.storage.put('lastActivityAt', new Date().toISOString());
  }

  private async scheduleMaintenance(policy: RoomPolicy): Promise<void> {
    const desired = Date.now() + policy.lifecycle.maintenanceIntervalSeconds * 1_000;
    const existing = await this.state.storage.getAlarm();
    if (existing === null || existing > desired + 1_000 || existing < Date.now()) {
      await this.state.storage.setAlarm(desired);
    }
  }

  private async consumeRateLimit(scope: string, limit: number, limitName: string): Promise<void> {
    const now = Date.now();
    const counters =
      (await this.state.storage.get<Record<string, FixedWindowCounter>>('rateCounters')) ?? {};
    const current = counters[scope];
    const counter =
      !current || now - current.windowStartedAt >= 60_000
        ? { windowStartedAt: now, count: 0 }
        : current;
    if (counter.count >= limit) {
      throw new RateLimitError(limitName, Math.max(1, counter.windowStartedAt + 60_000 - now));
    }
    counter.count += 1;
    counters[scope] = counter;
    await this.state.storage.put('rateCounters', counters);
  }

  private async pruneRateCounters(now = Date.now()): Promise<void> {
    const counters =
      (await this.state.storage.get<Record<string, FixedWindowCounter>>('rateCounters')) ?? {};
    let changed = false;
    for (const [key, counter] of Object.entries(counters)) {
      if (now - counter.windowStartedAt > 120_000) {
        delete counters[key];
        changed = true;
      }
    }
    if (changed) await this.state.storage.put('rateCounters', counters);
  }

  private assertParticipantCapacity(participant: ConnectionAttachment, policy: RoomPolicy): void {
    const existingSession = this.listParticipants().some(
      (entry) => entry.sessionId === participant.sessionId,
    );
    if (!existingSession && this.listParticipants().length >= policy.limits.maximumParticipants) {
      throw new RoomOperationError(
        'room_full',
        `Room participant limit of ${policy.limits.maximumParticipants} has been reached`,
        429,
      );
    }
  }

  private async trackRoll(record: StoredRoll, policy: RoomPolicy): Promise<void> {
    const rollId = record.result.rollId;
    if (!rollId) return;
    const index = (await this.state.storage.get<RollIndexEntry[]>('rollIndex')) ?? [];
    const next: RollIndexEntry = {
      rollId,
      sequence: record.result.sequence ?? 0,
      updatedAt: record.result.updatedAt ?? record.result.createdAt,
    };
    const updated = index.filter((entry) => entry.rollId !== rollId);
    updated.push(next);
    updated.sort((left, right) => left.sequence - right.sequence);
    const removed = updated.splice(
      0,
      Math.max(0, updated.length - policy.limits.maximumRollsRetained),
    );
    await this.state.storage.put('rollIndex', updated);
    if (removed.length)
      await this.state.storage.delete(removed.map((entry) => `roll:${entry.rollId}`));
  }

  private async persistRollSafely(record: StoredRoll, policy: RoomPolicy): Promise<void> {
    try {
      await this.persistRoll(record, policy);
    } catch (error) {
      await this.recordPersistenceFailure('persist_roll', record.result.rollId, error);
    }
  }

  private async recordPersistenceFailure(
    operation: string,
    rollId: string | undefined,
    error: unknown,
  ): Promise<void> {
    const failures =
      (await this.state.storage.get<PersistenceFailure[]>('persistenceFailures')) ?? [];
    const failure: PersistenceFailure = {
      at: new Date().toISOString(),
      operation,
      rollId,
      message: asError(error).message,
    };
    failures.push(failure);
    if (failures.length > 50) failures.splice(0, failures.length - 50);
    await this.state.storage.put('persistenceFailures', failures);
    this.logStructured('persistence.failed', { ...failure });
  }

  private async withD1Retry<T>(operation: string, action: () => Promise<T>): Promise<T> {
    const delays = [0, 25, 100, 250];
    let lastError: unknown;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt] > 0) await sleep(delays[attempt]);
      try {
        return await action();
      } catch (error) {
        lastError = error;
        this.logStructured('persistence.retry', {
          operation,
          attempt: attempt + 1,
          message: asError(error).message,
        });
      }
    }
    throw lastError;
  }

  private logStructured(event: string, details: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        level: event.includes('failed') || event.includes('invalid') ? 'error' : 'info',
        event,
        at: new Date().toISOString(),
        ...details,
      }),
    );
  }

  private async handleParticipantUpdate(
    socket: WebSocket,
    participant: ConnectionAttachment,
    event: Extract<ClientToServerEvent, { type: 'participant_update' }>,
    policy: RoomPolicy,
  ): Promise<void> {
    assertMetadataSize(
      event.metadata,
      policy.limits.maximumParticipantMetadataBytes,
      'participant metadata',
    );
    const updated: ConnectionAttachment = {
      ...participant,
      name: event.name?.trim() || participant.name,
      metadata: event.metadata ?? participant.metadata,
    };
    serializeAttachment(socket, updated);
    this.sessions.set(socket, updated);
    this.broadcastParticipant({
      type: 'participant_updated',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: participant.roomId,
      participant: roomParticipantFromAttachment(updated),
    });
  }

  private async handleNewRoll(
    participant: ConnectionAttachment,
    event: Extract<ClientToServerEvent, { type: 'roll_request' | 'display_roll' }>,
    policy: RoomPolicy,
  ): Promise<void> {
    assertPermission(participant, 'roll:create');
    if (
      !policy.authorization.allowParticipantRolls &&
      !participant.permissions.includes('room:manage')
    ) {
      throw new RoomOperationError(
        'policy_denied',
        'Room policy does not allow participant-created rolls',
        403,
      );
    }
    assertVisibilityAllowed(event.visibility, policy);
    assertRollInputWithinPolicy(event.input, policy);
    await this.waitForRoomReadiness(policy);
    const result =
      event.type === 'display_roll'
        ? normalizeExternalRoll(event.input, { authority: 'external' })
        : event.input.mode === 'display'
          ? normalizeExternalRoll(event.input, { authority: 'external' })
          : this.engine.evaluate(event.input, { authority: 'server' });
    assertResultWithinPolicy(result, policy);

    const rollId = crypto.randomUUID();
    const sequence = await this.nextRollSequence();
    const eventSequence = await this.nextEventSequence();
    result.rollId = rollId;
    result.sequence = sequence;
    result.revision = 0;

    const actor = actorFromParticipant(participant);
    const visibility = normalizeVisibility(event.visibility);
    const record: StoredRoll = { result, actor, visibility };
    const startBufferMs = this.calculateAnimationStartBufferMs();
    const internal: InternalRollStartEvent = {
      type: 'roll_start',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: participant.roomId,
      requestId: event.requestId,
      requesterSessionId: participant.sessionId,
      clientRollId: event.clientRollId,
      eventSequence,
      rollId,
      sequence,
      result,
      actor,
      visibility,
      animationSeed: crypto.randomUUID(),
      serverStartTimeMs: Date.now() + startBufferMs,
      animationDurationMs: 2_800,
      startBufferMs,
    };

    await this.state.storage.put(`roll:${rollId}`, record);
    await this.trackRoll(record, policy);
    await this.appendEvent(internal, policy);
    await this.recordRequest(participant.sessionId, event.requestId, eventSequence);
    this.broadcastRoll(internal);
    this.logStructured('roll.created', {
      roomId: participant.roomId,
      rollId,
      sequence,
      participantId: participant.participantId,
    });
    this.state.waitUntil(this.persistRollSafely(record, policy));
  }

  private async handleRollUpdate(
    participant: ConnectionAttachment,
    event: Extract<ClientToServerEvent, { type: 'update_roll' }>,
    policy: RoomPolicy,
  ): Promise<void> {
    const previous = await this.loadRoll(event.rollId);
    if (!previous)
      throw new RoomOperationError(
        'roll_not_found',
        `Roll '${event.rollId}' was not found in this room`,
        404,
      );
    assertCanMutate(participant, previous, event.reroll ? 'reroll' : 'update', policy);
    assertRollUpdateWithinPolicy(event, policy);
    assertRevision(previous.result, event.expectedRevision, event.rollId);

    const result = this.engine.update(previous.result, event.update, {
      reroll: event.reroll,
      allowGenerateMissing: event.reroll === true,
    });
    assertResultWithinPolicy(result, policy);
    const animate = event.animate ?? false;
    if (animate) await this.waitForRoomReadiness(policy);
    const eventSequence = await this.nextEventSequence();
    const record: StoredRoll = { ...previous, result };
    const startBufferMs = animate ? this.calculateAnimationStartBufferMs() : undefined;
    const internal: InternalRollUpdatedEvent = {
      type: 'roll_updated',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: participant.roomId,
      requestId: event.requestId,
      requesterSessionId: participant.sessionId,
      eventSequence,
      rollId: result.rollId ?? event.rollId,
      sequence: result.sequence ?? previous.result.sequence ?? 0,
      result,
      actor: previous.actor,
      visibility: previous.visibility,
      animate,
      animationSeed: animate ? crypto.randomUUID() : undefined,
      serverStartTimeMs: animate
        ? Date.now() + (startBufferMs ?? MIN_ANIMATION_START_BUFFER_MS)
        : undefined,
      animationDurationMs: animate ? 2_800 : undefined,
      startBufferMs,
      audit: event.audit,
    };

    await this.state.storage.put(`roll:${event.rollId}`, record);
    await this.trackRoll(record, policy);
    await this.appendEvent(internal, policy);
    await this.recordRequest(participant.sessionId, event.requestId, eventSequence);
    this.broadcastRoll(internal);
    this.logStructured('roll.updated', {
      roomId: participant.roomId,
      rollId: event.rollId,
      revision: result.revision,
      participantId: participant.participantId,
      animate,
      auditLabel: event.audit?.label,
      auditReason: event.audit?.reason,
    });
    this.state.waitUntil(this.persistRollSafely(record, policy));
  }

  private async handleBulkRollUpdate(
    socket: WebSocket,
    participant: ConnectionAttachment,
    event: Extract<ClientToServerEvent, { type: 'bulk_update_rolls' }>,
    policy: RoomPolicy,
  ): Promise<void> {
    if (event.updates.length === 0) {
      throw new RoomOperationError(
        'invalid_bulk_update',
        'Bulk updates require at least one roll',
        400,
      );
    }

    // Validate and evaluate every mutation before committing any state. Durable Object
    // multi-key put is atomic, so readers observe either the old batch or the new batch.
    const previousRecords = await Promise.all(
      event.updates.map((item) => this.loadRoll(item.rollId)),
    );
    const prepared = event.updates.map((item, index) => {
      const previous = previousRecords[index];
      if (!previous)
        throw new RoomOperationError(
          'roll_not_found',
          `Roll '${item.rollId}' was not found in this room`,
          404,
        );
      assertCanMutate(participant, previous, item.reroll ? 'reroll' : 'update', policy);
      assertRollUpdateWithinPolicy(item, policy);
      assertRevision(previous.result, item.expectedRevision, item.rollId);
      const result = this.engine.update(previous.result, item.update, {
        reroll: item.reroll,
        allowGenerateMissing: item.reroll === true,
      });
      assertResultWithinPolicy(result, policy);
      return { item, previous, record: { ...previous, result } satisfies StoredRoll };
    });

    if (prepared.some(({ item }) => item.animate)) await this.waitForRoomReadiness(policy);

    const currentEventSequence = await this.getEventSequence();
    let nextEventSequence = currentEventSequence;
    const now = Date.now();
    const internalEvents: InternalRollUpdatedEvent[] = prepared.map(
      ({ item, previous, record }) => {
        const animate = item.animate ?? false;
        const eventSequence = ++nextEventSequence;
        const startBufferMs = animate ? this.calculateAnimationStartBufferMs() : undefined;
        return {
          type: 'roll_updated',
          protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
          roomId: participant.roomId,
          requesterSessionId: participant.sessionId,
          eventSequence,
          rollId: record.result.rollId ?? item.rollId,
          sequence: record.result.sequence ?? previous.result.sequence ?? 0,
          result: record.result,
          actor: previous.actor,
          visibility: previous.visibility,
          animate,
          animationSeed: animate ? crypto.randomUUID() : undefined,
          serverStartTimeMs: animate
            ? now + (startBufferMs ?? MIN_ANIMATION_START_BUFFER_MS)
            : undefined,
          animationDurationMs: animate ? 2_800 : undefined,
          startBufferMs,
          audit: item.audit,
        };
      },
    );
    const acknowledgement: InternalBulkRollUpdatedEvent = {
      type: 'bulk_rolls_updated',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: participant.roomId,
      requestId: event.requestId,
      requesterSessionId: participant.sessionId,
      eventSequence: ++nextEventSequence,
      updates: internalEvents.map((item) => ({
        rollId: item.rollId,
        revision: item.result.revision ?? 0,
        eventSequence: item.eventSequence,
      })),
    };

    const environmentLimit = clampInteger(
      this.env.EVENT_BUFFER_LIMIT ?? null,
      10,
      10_000,
      policy.limits.maximumBufferedEvents,
    );
    const eventLimit = Math.min(environmentLimit, policy.limits.maximumBufferedEvents);
    const eventBuffer = await this.getEventBuffer();
    eventBuffer.push(...internalEvents, acknowledgement);
    if (eventBuffer.length > eventLimit) eventBuffer.splice(0, eventBuffer.length - eventLimit);

    const requestCache = await this.getRequestCache();
    requestCache.push({
      key: `${participant.sessionId}:${event.requestId}`,
      eventSequence: acknowledgement.eventSequence,
    });
    if (requestCache.length > 200) requestCache.splice(0, requestCache.length - 200);

    const rollIndex = (await this.state.storage.get<RollIndexEntry[]>('rollIndex')) ?? [];
    const changedIds = new Set(prepared.map(({ item }) => item.rollId));
    const nextIndex = rollIndex.filter((entry) => !changedIds.has(entry.rollId));
    for (const { item, record } of prepared) {
      nextIndex.push({
        rollId: item.rollId,
        sequence: record.result.sequence ?? 0,
        updatedAt: record.result.updatedAt ?? record.result.createdAt,
      });
    }
    nextIndex.sort((left, right) => left.sequence - right.sequence);
    const removed = nextIndex.splice(
      0,
      Math.max(0, nextIndex.length - policy.limits.maximumRollsRetained),
    );

    const storageEntries: Record<string, unknown> = {
      eventSequence: acknowledgement.eventSequence,
      eventBuffer,
      requestCache,
      rollIndex: nextIndex,
    };
    for (const { item, record } of prepared) storageEntries[`roll:${item.rollId}`] = record;
    await this.state.storage.put(storageEntries);
    this.eventBufferCache = eventBuffer;
    await this.retireEventBufferRecoveryMarker(eventBuffer);
    this.state.waitUntil(
      this.persistRequestRecord(
        participant.sessionId,
        event.requestId,
        acknowledgement.eventSequence,
      ),
    );
    if (removed.length > 0)
      await this.state.storage.delete(removed.map((entry) => `roll:${entry.rollId}`));

    for (const internal of internalEvents) this.broadcastRoll(internal);
    const projectedAcknowledgement = projectBulkEvent(acknowledgement, participant);
    if (!projectedAcknowledgement)
      throw new Error('Bulk acknowledgement requester projection failed');
    sendEvent(socket, projectedAcknowledgement);
    this.logStructured('roll.bulk_updated', {
      roomId: participant.roomId,
      participantId: participant.participantId,
      count: prepared.length,
      rollIds: prepared.map(({ item }) => item.rollId),
    });
    this.state.waitUntil(
      Promise.all([
        ...prepared.map(({ record }) => this.persistRollSafely(record, policy)),
        ...internalEvents.map((internal) => this.persistEventSafely(internal, policy)),
        this.persistEventSafely(acknowledgement, policy),
      ]).then(() => undefined),
    );
  }

  private async handleVisibilityUpdate(
    participant: ConnectionAttachment,
    event: Extract<ClientToServerEvent, { type: 'set_roll_visibility' }>,
    policy: RoomPolicy,
  ): Promise<void> {
    const previous = await this.loadRoll(event.rollId);
    if (!previous)
      throw new RoomOperationError(
        'roll_not_found',
        `Roll '${event.rollId}' was not found in this room`,
        404,
      );
    assertCanMutate(participant, previous, 'reveal', policy);
    assertVisibilityAllowed(event.visibility, policy);
    assertRevision(previous.result, event.expectedRevision, event.rollId);

    const updatedAt = new Date().toISOString();
    const result: NormalizedRollResult = {
      ...previous.result,
      revision: (previous.result.revision ?? 0) + 1,
      updatedAt,
    };
    const visibility = normalizeVisibility(event.visibility);
    const record: StoredRoll = { ...previous, result, visibility };
    const eventSequence = await this.nextEventSequence();
    const internal: InternalRollVisibilityUpdatedEvent = {
      type: 'roll_visibility_updated',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: participant.roomId,
      requestId: event.requestId,
      requesterSessionId: participant.sessionId,
      eventSequence,
      rollId: event.rollId,
      sequence: result.sequence ?? 0,
      result,
      actor: previous.actor,
      visibility,
      previousVisibility: previous.visibility,
      audit: event.audit,
    };

    await this.state.storage.put(`roll:${event.rollId}`, record);
    await this.trackRoll(record, policy);
    await this.appendEvent(internal, policy);
    await this.recordRequest(participant.sessionId, event.requestId, eventSequence);
    this.broadcastRoll(internal);
    this.logStructured('roll.visibility_updated', {
      roomId: participant.roomId,
      rollId: event.rollId,
      revision: result.revision,
      participantId: participant.participantId,
      visibilityType: visibility.type,
      auditLabel: event.audit?.label,
      auditReason: event.audit?.reason,
    });
    this.state.waitUntil(this.persistRollSafely(record, policy));
  }

  private async waitForRoomReadiness(policy: RoomPolicy): Promise<void> {
    const rendererPolicy = policy.renderer;
    if (!rendererPolicy?.requireRendererReady && !rendererPolicy?.requireThemesReady) return;
    const deadline = Date.now() + rendererPolicy.readinessTimeoutMs;
    while (true) {
      const unready = [...this.getSessions().values()].filter((session) => {
        if (!session.joined || !session.passwordAuthenticated) return false;
        if (rendererPolicy.requireRendererReady && !session.rendererReady) return true;
        if (rendererPolicy.requireThemesReady && !session.themesReady) return true;
        return false;
      });
      if (unready.length === 0) return;
      if (Date.now() >= deadline) {
        throw new RoomOperationError(
          'participants_not_ready',
          `${unready.length} participant session${unready.length === 1 ? '' : 's'} did not satisfy the room renderer readiness policy`,
          409,
        );
      }
      await sleep(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }

  private calculateAnimationStartBufferMs(): number {
    let required = MIN_ANIMATION_START_BUFFER_MS;
    for (const participant of this.getSessions().values()) {
      if (!participant.joined || !participant.passwordAuthenticated) continue;
      const roundTripMs = Number.isFinite(participant.roundTripMs)
        ? Math.max(0, participant.roundTripMs ?? 0)
        : 0;
      const uncertaintyMs = Number.isFinite(participant.clockUncertaintyMs)
        ? Math.max(0, participant.clockUncertaintyMs ?? 0)
        : 0;
      const readinessPenalty = participant.rendererReady && participant.themesReady ? 0 : 120;
      required = Math.max(
        required,
        Math.ceil(
          roundTripMs / 2 + uncertaintyMs + CLIENT_RENDER_PREPARATION_BUDGET_MS + readinessPenalty,
        ),
      );
    }
    return Math.min(MAX_ANIMATION_START_BUFFER_MS, required);
  }

  private async finalizeSession(
    socket: WebSocket,
    participant: ConnectionAttachment,
  ): Promise<void> {
    if (participant.joined) return;
    const joined: ConnectionAttachment = {
      ...participant,
      passwordAuthenticated: true,
      joined: true,
      passwordAttempts: 0,
    };
    serializeAttachment(socket, joined);
    this.sessions.set(socket, joined);

    const latestEventSequence = await this.getEventSequence();
    const latestRollSequence = await this.getRollSequence();
    sendEvent(socket, {
      type: 'session_ready',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: joined.roomId,
      participant: roomParticipantFromAttachment(joined),
      latestEventSequence,
      latestRollSequence,
    });
    sendEvent(socket, await this.createRoomState(joined, joined.reconnectAfterEventSequence));
    this.broadcastParticipant(
      {
        type: 'participant_joined',
        protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
        roomId: joined.roomId,
        participant: roomParticipantFromAttachment(joined),
      },
      socket,
    );
  }

  private async handleTokenAuthentication(
    socket: WebSocket,
    participant: ConnectionAttachment,
    token: string,
    policy: RoomPolicy,
  ): Promise<void> {
    try {
      const verified = await verifyCapabilityTokenForRoom(
        token,
        participant.roomId,
        this.env,
        (payload) => this.isCapabilityTokenRevoked(payload),
      );
      const payload = verified.payload;
      const permissions = uniqueStrings(payload.permissions ?? []).filter(isRoomPermission);
      const updated: ConnectionAttachment = {
        ...participant,
        participantId: payload.participantId,
        sessionId: payload.sessionId ?? participant.sessionId,
        name: cleanName(payload.name) ?? participant.name,
        roles: uniqueStrings(payload.roles ?? []),
        permissions,
        metadata: payload.metadata,
        authorizationComplete: true,
        tokenAuthenticated: true,
        tokenAttempts: 0,
        tokenId: payload.jti,
        tokenIssuedAt: payload.iat,
        tokenExpiresAt: payload.exp,
        tokenKeyId: verified.keyId,
        tokenIssuer: payload.iss,
        tokenAudience:
          payload.aud === undefined
            ? undefined
            : Array.isArray(payload.aud)
              ? [...payload.aud]
              : [payload.aud],
        passwordAuthenticated:
          !policy.access.passwordProtected || permissions.includes('room:manage'),
      };
      assertMetadataSize(
        updated.metadata,
        policy.limits.maximumParticipantMetadataBytes,
        'participant metadata',
      );
      serializeAttachment(socket, updated);
      this.sessions.set(socket, updated);
      if (updated.passwordAuthenticated) {
        await this.finalizeSession(socket, updated);
      } else {
        sendEvent(socket, {
          type: 'roll_error',
          protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
          roomId: participant.roomId,
          code: 'room_password_required',
          message: 'This room requires a password before room state can be accessed',
        });
      }
    } catch (error) {
      const authError =
        error instanceof AuthorizationError
          ? error
          : new AuthorizationError('invalid_token', asError(error).message, 401);
      const tokenAttempts = participant.tokenAttempts + 1;
      const updated = { ...participant, tokenAttempts };
      serializeAttachment(socket, updated);
      this.sessions.set(socket, updated);
      sendEvent(socket, {
        type: 'roll_error',
        protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
        roomId: participant.roomId,
        code: authError.code,
        message: authError.message,
      });
      if (tokenAttempts >= MAX_TOKEN_ATTEMPTS_PER_SOCKET) {
        socket.close(4002, 'Too many invalid room capability token attempts');
      }
    }
  }

  private async handlePasswordAuthentication(
    socket: WebSocket,
    participant: ConnectionAttachment,
    password: string,
    policy: RoomPolicy,
  ): Promise<void> {
    try {
      await this.consumeRateLimit(
        `ip:${participant.clientIpHash}:password`,
        policy.rateLimits.passwordAttemptsPerMinutePerIp,
        'password_attempts_per_minute_per_ip',
      );
    } catch (error) {
      sendEvent(socket, toRollError(error));
      return;
    }

    if (!(await this.verifyRoomPassword(password))) {
      const passwordAttempts = participant.passwordAttempts + 1;
      const updated = { ...participant, passwordAttempts };
      serializeAttachment(socket, updated);
      this.sessions.set(socket, updated);
      sendEvent(socket, {
        type: 'roll_error',
        protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
        roomId: participant.roomId,
        code: 'invalid_room_password',
        message: 'The room password is incorrect',
      });
      if (passwordAttempts >= MAX_PASSWORD_ATTEMPTS_PER_SOCKET) {
        socket.close(4003, 'Too many invalid room password attempts');
      }
      return;
    }

    await this.finalizeSession(socket, { ...participant, passwordAuthenticated: true });
  }

  private async verifyRoomPassword(password: string): Promise<boolean> {
    const stored = await this.state.storage.get<StoredRoomPassword>(ROOM_PASSWORD_STORAGE_KEY);
    if (!stored) return true;
    if (stored.version !== 1 || stored.algorithm !== 'PBKDF2-SHA-256') return false;
    const candidate = await deriveRoomPasswordHash(
      password,
      base64UrlToBytes(stored.salt),
      stored.iterations,
    );
    return constantTimeEqual(candidate, base64UrlToBytes(stored.hash));
  }

  private async handleRoomPasswordUpdate(
    participant: ConnectionAttachment,
    event: Extract<ClientToServerEvent, { type: 'set_room_password' }>,
  ): Promise<void> {
    assertPermission(participant, 'room:manage');
    const previousPolicy = await this.getPolicy();
    const previousRevision = await this.getPolicyRevision();
    if (event.expectedRevision !== undefined && event.expectedRevision !== previousRevision) {
      throw new PolicyRevisionConflictError(event.expectedRevision, previousRevision);
    }

    if (event.password !== null) {
      assertRoomPassword(event.password);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await deriveRoomPasswordHash(
        event.password,
        salt,
        ROOM_PASSWORD_PBKDF2_ITERATIONS,
      );
      const stored: StoredRoomPassword = {
        version: 1,
        algorithm: 'PBKDF2-SHA-256',
        iterations: ROOM_PASSWORD_PBKDF2_ITERATIONS,
        salt: bytesToBase64Url(salt),
        hash: bytesToBase64Url(hash),
        updatedAt: new Date().toISOString(),
      };
      await this.state.storage.put(ROOM_PASSWORD_STORAGE_KEY, stored);
    } else {
      await this.state.storage.delete(ROOM_PASSWORD_STORAGE_KEY);
    }

    const policy: RoomPolicy = {
      ...previousPolicy,
      access: { passwordProtected: event.password !== null },
    };
    const decodedPolicy = decodeRoomPolicy(policy, { rejectUnknownFields: true });
    if (!decodedPolicy.success)
      throw new RoomOperationError('invalid_policy', decodedPolicy.error.message, 400);
    const revision = previousRevision + 1;
    const eventSequence = await this.nextEventSequence();
    const internal: InternalRoomPolicyUpdatedEvent = {
      type: 'room_policy_updated',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: participant.roomId,
      eventSequence,
      requestId: event.requestId,
      revision,
      actor: actorFromParticipant(participant),
      policy: decodedPolicy.data,
      previousPolicy,
    };
    await this.state.storage.put({ roomPolicy: decodedPolicy.data, policyRevision: revision });
    await this.appendEvent(internal, decodedPolicy.data);
    await this.recordRequest(participant.sessionId, event.requestId, eventSequence);
    this.broadcastPolicy(internal);
    await this.scheduleMaintenance(decodedPolicy.data);
    this.logStructured('room.password_updated', {
      roomId: participant.roomId,
      revision,
      participantId: participant.participantId,
      passwordProtected: decodedPolicy.data.access.passwordProtected,
    });

    if (event.password === null) {
      for (const [socket, pending] of this.getSessions()) {
        if (!pending.passwordAuthenticated) await this.finalizeSession(socket, pending);
      }
    }
  }

  private async isCapabilityTokenRevoked(payload: RoomCapabilityTokenPayload): Promise<boolean> {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (payload.jti) {
      const key = exactTokenRevocationKey(payload.jti);
      const exact = await this.state.storage.get<StoredExactTokenRevocation>(key);
      if (exact) {
        if (exact.expiresAt !== undefined && exact.expiresAt <= nowSeconds) {
          await this.state.storage.delete(key);
        } else {
          return true;
        }
      }
    }

    const participantRevocation = await this.state.storage.get<StoredParticipantTokenRevocation>(
      participantTokenRevocationKey(payload.participantId),
    );
    if (!participantRevocation) return false;
    // A legacy token without iat cannot prove that it was issued after the cutoff.
    return payload.iat === undefined || payload.iat <= participantRevocation.issuedAtOrBefore;
  }

  private async handleTokenRevocation(
    participant: ConnectionAttachment,
    event: Extract<ClientToServerEvent, { type: 'revoke_room_token' }>,
    policy: RoomPolicy,
  ): Promise<void> {
    assertPermission(participant, 'room:manage');
    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const revokedAt = now.toISOString();
    let target: RoomTokenRevocationTarget;

    if (event.target.type === 'token') {
      if (event.target.expiresAt !== undefined && event.target.expiresAt <= nowSeconds) {
        throw new RoomOperationError(
          'invalid_revocation_target',
          'The token expiry must be in the future',
          400,
        );
      }
      target = {
        type: 'token',
        tokenId: event.target.tokenId,
        ...(event.target.expiresAt !== undefined ? { expiresAt: event.target.expiresAt } : {}),
      };
      const record: StoredExactTokenRevocation = {
        version: 1,
        type: 'token',
        tokenId: target.tokenId,
        revokedAt,
        expiresAt: target.expiresAt,
        reason: event.reason,
        actorParticipantId: participant.participantId,
      };
      await this.assertExactTokenRevocationCapacity(target.tokenId, nowSeconds);
      await this.state.storage.put(exactTokenRevocationKey(target.tokenId), record);
    } else {
      const issuedAtOrBefore = event.target.issuedAtOrBefore ?? nowSeconds;
      const key = participantTokenRevocationKey(event.target.participantId);
      const previous = await this.state.storage.get<StoredParticipantTokenRevocation>(key);
      const cutoff = Math.max(previous?.issuedAtOrBefore ?? 0, issuedAtOrBefore);
      target = {
        type: 'participant',
        participantId: event.target.participantId,
        issuedAtOrBefore: cutoff,
      };
      const record: StoredParticipantTokenRevocation = {
        version: 1,
        type: 'participant',
        participantId: target.participantId,
        issuedAtOrBefore: cutoff,
        revokedAt,
        reason: event.reason,
        actorParticipantId: participant.participantId,
      };
      await this.state.storage.put(key, record);
    }

    const matchingSessions = [...this.getSessions()].filter(
      ([, session]) => session.tokenAuthenticated && tokenSessionMatchesRevocation(session, target),
    );
    const eventSequence = await this.nextEventSequence();
    const internal: InternalRoomTokenRevokedEvent = {
      type: 'room_token_revoked',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: participant.roomId,
      eventSequence,
      requestId: event.requestId,
      actor: actorFromParticipant(participant),
      target,
      revokedAt,
      reason: event.reason,
      disconnectedSessions: matchingSessions.length,
    };
    await this.appendEvent(internal, policy);
    await this.recordRequest(participant.sessionId, event.requestId, eventSequence);
    this.broadcastTokenRevocation(internal);

    for (const [socket, session] of matchingSessions) {
      this.sessions.delete(socket);
      if (session.joined) {
        this.broadcastParticipant(
          {
            type: 'participant_left',
            protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
            roomId: session.roomId,
            participantId: session.participantId,
            sessionId: session.sessionId,
          },
          socket,
        );
      }
      socket.close(4004, 'Draftroll capability token revoked');
    }

    this.logStructured('room.token_revoked', {
      roomId: participant.roomId,
      participantId: participant.participantId,
      targetType: target.type,
      targetId: target.type === 'token' ? target.tokenId : target.participantId,
      disconnectedSessions: matchingSessions.length,
      reason: event.reason,
    });
  }

  private async handlePolicyUpdate(
    participant: ConnectionAttachment,
    event: Extract<ClientToServerEvent, { type: 'set_room_policy' }>,
  ): Promise<void> {
    assertPermission(participant, 'room:manage');
    const decodedPatch = decodeRoomPolicyPatch(event.policy, { rejectUnknownFields: true });
    if (!decodedPatch.success)
      throw new RoomOperationError('invalid_policy', decodedPatch.error.message, 400);
    const previousPolicy = await this.getPolicy();
    const previousRevision = await this.getPolicyRevision();
    if (event.expectedRevision !== undefined && event.expectedRevision !== previousRevision) {
      throw new PolicyRevisionConflictError(event.expectedRevision, previousRevision);
    }
    const policy = applyRoomPolicyPatch(previousPolicy, decodedPatch.data);
    const decodedPolicy = decodeRoomPolicy(policy, { rejectUnknownFields: true });
    if (!decodedPolicy.success)
      throw new RoomOperationError('invalid_policy', decodedPolicy.error.message, 400);
    const revision = previousRevision + 1;
    const eventSequence = await this.nextEventSequence();
    const internal: InternalRoomPolicyUpdatedEvent = {
      type: 'room_policy_updated',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: participant.roomId,
      eventSequence,
      requestId: event.requestId,
      revision,
      actor: actorFromParticipant(participant),
      policy: decodedPolicy.data,
      previousPolicy,
    };
    await this.state.storage.put({ roomPolicy: decodedPolicy.data, policyRevision: revision });
    await this.appendEvent(internal, decodedPolicy.data);
    await this.recordRequest(participant.sessionId, event.requestId, eventSequence);
    this.broadcastPolicy(internal);
    await this.scheduleMaintenance(decodedPolicy.data);
    this.logStructured('room.policy_updated', {
      roomId: participant.roomId,
      revision,
      participantId: participant.participantId,
      preset: decodedPolicy.data.preset,
      enabled: decodedPolicy.data.enabled,
    });
  }

  private broadcastRoll(event: InternalRoomRollEvent): void {
    for (const [socket, participant] of this.getSessions()) {
      if (!participant.joined || !participant.passwordAuthenticated) continue;
      try {
        sendEvent(socket, projectEvent(event, participant));
      } catch {
        // Hibernation API removes disconnected sockets; ignore close races.
      }
    }
  }

  private broadcastPolicy(event: InternalRoomPolicyUpdatedEvent): void {
    for (const [socket, participant] of this.getSessions()) {
      if (!participant.joined || !participant.passwordAuthenticated) continue;
      try {
        sendEvent(socket, projectPolicyEvent(event, participant));
      } catch {
        // Ignore a close race.
      }
    }
  }

  private broadcastTokenRevocation(event: InternalRoomTokenRevokedEvent): void {
    for (const [socket, participant] of this.getSessions()) {
      if (
        !participant.joined ||
        !participant.passwordAuthenticated ||
        !participant.permissions.includes('room:manage')
      )
        continue;
      try {
        sendEvent(socket, projectTokenRevocationEvent(event, participant));
      } catch {
        // Ignore a close race.
      }
    }
  }

  private broadcastParticipant(
    event: Extract<
      ServerToClientEvent,
      { type: 'participant_joined' | 'participant_updated' | 'participant_left' }
    >,
    except?: WebSocket,
  ): void {
    for (const [socket, participant] of this.getSessions()) {
      if (socket === except || !participant.joined || !participant.passwordAuthenticated) continue;
      try {
        sendEvent(socket, event);
      } catch {
        // Ignore a close race.
      }
    }
  }

  private async createDiagnostics(
    roomId: string,
    policy: RoomPolicy,
  ): Promise<Record<string, unknown>> {
    const [
      eventSequence,
      eventBuffer,
      eventBufferRecoverySequence,
      rollIndex,
      persistenceFailures,
      policyRevision,
    ] = await Promise.all([
      this.getEventSequence(),
      this.getEventBuffer(),
      this.getEventBufferRecoverySequence(),
      this.state.storage.get<RollIndexEntry[]>('rollIndex'),
      this.state.storage.get<PersistenceFailure[]>('persistenceFailures'),
      this.getPolicyRevision(),
    ]);
    const sessions = [...this.sessions.values()];
    return {
      roomId,
      collectedAt: new Date().toISOString(),
      policyRevision,
      policyPreset: policy.preset,
      enabled: policy.enabled,
      activeSessions: sessions.length,
      authorizedSessions: sessions.filter(
        (session) => session.authorizationComplete && session.passwordAuthenticated,
      ).length,
      rendererReadySessions: sessions.filter((session) => session.rendererReady).length,
      themesReadySessions: sessions.filter((session) => session.themesReady).length,
      hiddenProjectionEligibleSessions: sessions.filter((session) =>
        session.permissions.includes('roll:view-hidden'),
      ).length,
      latestEventSequence: eventSequence,
      bufferedEvents: eventBuffer.length,
      eventBufferLimit: policy.limits.maximumBufferedEvents,
      eventBufferRecoverySequence,
      retainedRolls: rollIndex?.length ?? 0,
      persistenceFailures: persistenceFailures?.length ?? 0,
      latestPersistenceFailure: persistenceFailures?.at(-1) ?? null,
      limits: {
        maximumParticipants: policy.limits.maximumParticipants,
        maximumInboundMessageBytes: policy.limits.maximumInboundMessageBytes,
        maximumConcurrentVisuals: policy.renderer?.maximumConcurrentVisuals ?? 30,
      },
    };
  }

  private async createRoomState(
    participant: ConnectionAttachment,
    lastEventSequence: number,
  ): Promise<RoomStateEvent> {
    const [eventBuffer, eventBufferRecoverySequence, latestEventSequence, latestRollSequence] =
      await Promise.all([
        this.getEventBuffer(),
        this.getEventBufferRecoverySequence(),
        this.getEventSequence(),
        this.getRollSequence(),
      ]);
    const eventBufferStartSequence = eventBuffer[0]?.eventSequence ?? latestEventSequence + 1;
    const replayCoverageLost =
      eventBufferRecoverySequence !== null && lastEventSequence < eventBufferRecoverySequence;
    const missedEventsTruncated =
      replayCoverageLost ||
      (lastEventSequence > 0 && lastEventSequence < eventBufferStartSequence - 1);
    const recentEvents: RoomReplayEvent[] = eventBuffer
      .filter((event) => event.eventSequence > lastEventSequence)
      .map((event) => projectInternalEvent(event, participant, true))
      .filter((event): event is RoomReplayEvent => event !== null);
    const recentRolls = recentEvents.filter(
      (event): event is RoomRollEvent =>
        event.type === 'roll_start' ||
        event.type === 'roll_updated' ||
        event.type === 'roll_visibility_updated',
    );
    const policy = await this.getPolicy();
    return {
      type: 'room_state',
      protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
      roomId: participant.roomId,
      sequence: latestRollSequence,
      latestRollSequence,
      latestEventSequence,
      eventBufferStartSequence,
      missedEventsTruncated,
      policy,
      policyRevision: await this.getPolicyRevision(),
      participants: this.listParticipants(),
      recentEvents,
      recentRolls,
      recentRoll: recentRolls.at(-1),
    };
  }

  private async getDurableEvents(
    roomId: string,
    participant: ConnectionAttachment,
    afterEventSequence: number,
    limit: number,
  ) {
    const query = await this.env.DB.prepare(`
      SELECT event_sequence, event_json, created_at
      FROM room_events
      WHERE room_id = ? AND event_sequence > ?
      ORDER BY event_sequence ASC
      LIMIT ?
    `)
      .bind(roomId, afterEventSequence, limit)
      .all<RoomEventRow>();
    const earliest = await this.env.DB.prepare(`
      SELECT event_sequence, event_json, created_at
      FROM room_events
      WHERE room_id = ?
      ORDER BY event_sequence ASC
      LIMIT 1
    `)
      .bind(roomId)
      .all<RoomEventRow>();
    const latest = await this.getEventSequence();
    const events: RoomReplayEvent[] = [];
    let nextAfterEventSequence = afterEventSequence;
    let recoveryBlockedAtEventSequence: number | undefined;
    for (const row of query.results ?? []) {
      let internal: InternalRoomEvent;
      try {
        // Deserializes rows this Durable Object previously serialized itself.
        internal = migrateStoredInternalEvent(JSON.parse(row.event_json));
      } catch (error) {
        recoveryBlockedAtEventSequence = row.event_sequence;
        this.logStructured('room.event_storage_invalid', {
          source: 'd1_replay',
          eventSequence: row.event_sequence,
          message: asError(error).message,
        });
        break;
      }

      // Advancing over a validated event is safe even when this participant cannot observe its
      // projection (for example manager-only token revocations or bulk acknowledgements).
      nextAfterEventSequence = row.event_sequence;
      if (internal.type === 'bulk_rolls_updated') continue;
      const projected = projectInternalEvent(internal, participant, true);
      if (projected) events.push(projected);
    }
    const earliestSequence = earliest.results?.[0]?.event_sequence ?? latest + 1;
    return {
      roomId,
      afterEventSequence,
      nextAfterEventSequence,
      earliestEventSequence: earliestSequence,
      latestEventSequence: latest,
      hasMore: recoveryBlockedAtEventSequence !== undefined || nextAfterEventSequence < latest,
      truncated: afterEventSequence > 0 && afterEventSequence < earliestSequence - 1,
      recoveryBlockedAtEventSequence,
      events,
    };
  }

  private async getHistory(roomId: string, participant: ConnectionAttachment, limit: number) {
    const query = await this.env.DB.prepare(`
      SELECT roll_id, room_id, sequence, revision, authority, expression, total, result_json,
             actor_json, visibility_json, created_at, updated_at
      FROM roll_history
      WHERE room_id = ?
      ORDER BY sequence DESC
      LIMIT ?
    `)
      .bind(roomId, limit)
      .all<RollHistoryRow>();

    return {
      roomId,
      rolls: (query.results ?? []).map((row) =>
        projectStoredRoll(rowToStoredRoll(row), participant),
      ),
    };
  }

  private async getRevisions(roomId: string, rollId: string, participant: ConnectionAttachment) {
    const query = await this.env.DB.prepare(`
      SELECT revision, result_json, actor_json, visibility_json, recorded_at
      FROM roll_revisions
      WHERE room_id = ? AND roll_id = ?
      ORDER BY revision ASC
    `)
      .bind(roomId, rollId)
      .all<RollRevisionRow>();
    return {
      roomId,
      rollId,
      // `projectStoredRoll` returns a freshly projected object per row.
      revisions: (query.results ?? []).map((row) =>
        Object.assign(projectStoredRoll(revisionRowToStoredRoll(row), participant), {
          recordedAt: row.recorded_at,
        }),
      ),
    };
  }

  private async rememberRoomId(roomId: string): Promise<void> {
    const existing = await this.state.storage.get<string>('roomId');
    if (existing !== roomId) await this.state.storage.put('roomId', roomId);
  }

  private async loadRoll(rollId: string): Promise<StoredRoll | null> {
    const stored = await this.state.storage.get<StoredRoll>(`roll:${rollId}`);
    if (stored?.result) {
      const decoded = decodeNormalizedRollResult(stored.result, { allowLegacyResults: true });
      if (decoded.success) return { ...stored, result: decoded.data };
    }

    const roomId = (await this.state.storage.get<string>('roomId')) ?? this.state.id.toString();
    const query = await this.env.DB.prepare(`
      SELECT roll_id, room_id, sequence, revision, authority, expression, total, result_json,
             actor_json, visibility_json, created_at, updated_at
      FROM roll_history
      WHERE roll_id = ? AND room_id = ?
      LIMIT 1
    `)
      .bind(rollId, roomId)
      .all<RollHistoryRow>();
    const row = query.results?.[0];
    return row ? rowToStoredRoll(row) : null;
  }

  private async persistEventSafely(event: InternalRoomEvent, policy: RoomPolicy): Promise<void> {
    try {
      await this.persistEvent(event, policy);
    } catch (error) {
      await this.recordPersistenceFailure(
        'persist_event',
        'rollId' in event ? event.rollId : undefined,
        error,
      );
    }
  }

  private async persistEvent(event: InternalRoomEvent, policy: RoomPolicy): Promise<void> {
    const createdAt = new Date().toISOString();
    await this.withD1Retry('room_event_insert', () =>
      this.env.DB.prepare(`
      INSERT INTO room_events (room_id, event_sequence, event_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(room_id, event_sequence) DO UPDATE SET
        event_json = excluded.event_json,
        created_at = excluded.created_at
    `)
        .bind(event.roomId, event.eventSequence, JSON.stringify(event), createdAt)
        .run(),
    );
    const cutoff = new Date(
      Date.now() - policy.lifecycle.historyRetentionSeconds * 1_000,
    ).toISOString();
    await this.withD1Retry('room_event_retention', () =>
      this.env.DB.prepare(`
      DELETE FROM room_events
      WHERE room_id = ? AND (
        created_at < ? OR event_sequence NOT IN (
          SELECT event_sequence FROM room_events
          WHERE room_id = ?
          ORDER BY event_sequence DESC
          LIMIT ?
        )
      )
    `)
        .bind(
          event.roomId,
          cutoff,
          event.roomId,
          Math.max(policy.limits.maximumBufferedEvents * 20, 1_000),
        )
        .run(),
    );
  }

  private async persistRoll(record: StoredRoll, policy: RoomPolicy): Promise<void> {
    const { result, actor, visibility } = record;
    if (!result.rollId || result.sequence === undefined)
      throw new Error('Persisted rolls require rollId and sequence');
    const roomId = (await this.state.storage.get<string>('roomId')) ?? this.state.id.toString();
    await this.withD1Retry('roll_history_upsert', () =>
      this.env.DB.prepare(`
      INSERT INTO roll_history (
        roll_id, room_id, sequence, revision, authority, expression, total, result_json,
        actor_json, visibility_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(roll_id) DO UPDATE SET
        revision = excluded.revision,
        authority = excluded.authority,
        expression = excluded.expression,
        total = excluded.total,
        result_json = excluded.result_json,
        actor_json = excluded.actor_json,
        visibility_json = excluded.visibility_json,
        updated_at = excluded.updated_at
    `)
        .bind(
          result.rollId,
          roomId,
          result.sequence,
          result.revision ?? 0,
          result.authority,
          result.expression ?? null,
          result.total,
          JSON.stringify(result),
          JSON.stringify(actor),
          JSON.stringify(visibility),
          result.createdAt,
          result.updatedAt ?? null,
        )
        .run(),
    );

    await this.withD1Retry('roll_revision_upsert', () =>
      this.env.DB.prepare(`
      INSERT INTO roll_revisions (
        roll_id, room_id, sequence, revision, result_json, actor_json, visibility_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(roll_id, revision) DO UPDATE SET
        result_json = excluded.result_json,
        actor_json = excluded.actor_json,
        visibility_json = excluded.visibility_json,
        recorded_at = excluded.recorded_at
    `)
        .bind(
          result.rollId,
          roomId,
          result.sequence,
          result.revision ?? 0,
          JSON.stringify(result),
          JSON.stringify(actor),
          JSON.stringify(visibility),
          result.updatedAt ?? result.createdAt,
        )
        .run(),
    );

    await this.enforceD1Caps(roomId, result.rollId, policy);
  }

  private async enforceD1Caps(roomId: string, rollId: string, policy: RoomPolicy): Promise<void> {
    await this.withD1Retry('revision_cap', () =>
      this.env.DB.prepare(`
      DELETE FROM roll_revisions
      WHERE room_id = ? AND roll_id = ? AND revision NOT IN (
        SELECT revision FROM roll_revisions
        WHERE room_id = ? AND roll_id = ?
        ORDER BY revision DESC
        LIMIT ?
      )
    `)
        .bind(roomId, rollId, roomId, rollId, policy.limits.maximumRevisionsPerRoll)
        .run(),
    );

    await this.withD1Retry('room_roll_cap', () =>
      this.env.DB.prepare(`
      DELETE FROM roll_history
      WHERE room_id = ? AND roll_id NOT IN (
        SELECT roll_id FROM roll_history
        WHERE room_id = ?
        ORDER BY sequence DESC
        LIMIT ?
      )
    `)
        .bind(roomId, roomId, policy.limits.maximumRollsRetained)
        .run(),
    );

    await this.withD1Retry('orphan_revision_cleanup', () =>
      this.env.DB.prepare(`
      DELETE FROM roll_revisions
      WHERE room_id = ? AND roll_id NOT IN (
        SELECT roll_id FROM roll_history WHERE room_id = ?
      )
    `)
        .bind(roomId, roomId)
        .run(),
    );
  }

  private async cleanupTokenRevocations(nowMs: number): Promise<void> {
    const nowSeconds = Math.floor(nowMs / 1_000);
    const exact = await this.state.storage.list<StoredExactTokenRevocation>({
      prefix: TOKEN_REVOCATION_PREFIX,
    });
    const expired = [...exact.entries()]
      .filter(([, record]) => record.expiresAt !== undefined && record.expiresAt <= nowSeconds)
      .map(([key]) => key);
    if (expired.length > 0) await this.state.storage.delete(expired);
  }

  private async assertExactTokenRevocationCapacity(
    tokenId: string,
    nowSeconds: number,
  ): Promise<void> {
    const exact = await this.state.storage.list<StoredExactTokenRevocation>({
      prefix: TOKEN_REVOCATION_PREFIX,
    });
    const expired = [...exact.entries()]
      .filter(([, record]) => record.expiresAt !== undefined && record.expiresAt <= nowSeconds)
      .map(([key]) => key);
    if (expired.length > 0) {
      await this.state.storage.delete(expired);
      expired.forEach((key) => exact.delete(key));
    }
    if (exact.has(exactTokenRevocationKey(tokenId))) return;
    if (exact.size >= MAX_EXACT_TOKEN_REVOCATIONS) {
      throw new RoomOperationError(
        'token_revocation_limit_exceeded',
        `The room already retains ${MAX_EXACT_TOKEN_REVOCATIONS} exact token revocations. Revoke by participant cutoff or wait for expiring token records to be cleaned up.`,
        409,
      );
    }
  }

  private async cleanupPersistence(policy: RoomPolicy): Promise<void> {
    const roomId = await this.state.storage.get<string>('roomId');
    if (!roomId) return;
    const historyCutoff = new Date(
      Date.now() - policy.lifecycle.historyRetentionSeconds * 1_000,
    ).toISOString();
    const revisionCutoff = new Date(
      Date.now() - policy.lifecycle.revisionRetentionSeconds * 1_000,
    ).toISOString();
    try {
      await this.withD1Retry('history_retention', () =>
        this.env.DB.prepare(`
        DELETE FROM roll_history
        WHERE room_id = ? AND COALESCE(updated_at, created_at) < ?
      `)
          .bind(roomId, historyCutoff)
          .run(),
      );
      await this.withD1Retry('revision_retention', () =>
        this.env.DB.prepare(`
        DELETE FROM roll_revisions
        WHERE room_id = ? AND recorded_at < ?
      `)
          .bind(roomId, revisionCutoff)
          .run(),
      );
      await this.withD1Retry('event_retention', () =>
        this.env.DB.prepare(`
        DELETE FROM room_events
        WHERE room_id = ? AND created_at < ?
      `)
          .bind(roomId, historyCutoff)
          .run(),
      );
      await this.withD1Retry('request_retention', () =>
        this.env.DB.prepare(`
        DELETE FROM room_requests
        WHERE room_id = ? AND created_at < ?
      `)
          .bind(roomId, historyCutoff)
          .run(),
      );
      await this.withD1Retry('retention_orphan_cleanup', () =>
        this.env.DB.prepare(`
        DELETE FROM roll_revisions
        WHERE room_id = ? AND roll_id NOT IN (
          SELECT roll_id FROM roll_history WHERE room_id = ?
        )
      `)
          .bind(roomId, roomId)
          .run(),
      );
    } catch (error) {
      await this.recordPersistenceFailure('retention_cleanup', undefined, error);
    }
  }

  private async appendEvent(event: InternalRoomEvent, policy: RoomPolicy): Promise<void> {
    const environmentLimit = clampInteger(
      this.env.EVENT_BUFFER_LIMIT ?? null,
      10,
      10_000,
      policy.limits.maximumBufferedEvents,
    );
    const limit = Math.min(environmentLimit, policy.limits.maximumBufferedEvents);
    const events = await this.getEventBuffer();
    events.push(event);
    if (events.length > limit) events.splice(0, events.length - limit);
    await this.state.storage.put('eventBuffer', events);
    this.eventBufferCache = events;
    await this.retireEventBufferRecoveryMarker(events);
    this.state.waitUntil(this.persistEventSafely(event, policy));
  }

  private async getEventBufferRecoverySequence(): Promise<number | null> {
    if (this.eventBufferRecoverySequenceCache !== undefined) {
      return this.eventBufferRecoverySequenceCache;
    }
    const stored = await this.state.storage.get('eventBufferRecoverySequence');
    if (stored === undefined) {
      this.eventBufferRecoverySequenceCache = null;
      return null;
    }
    if (typeof stored === 'number' && Number.isSafeInteger(stored) && stored >= 1) {
      this.eventBufferRecoverySequenceCache = stored;
      return stored;
    }
    const fallback = Math.max(1, await this.getEventSequence());
    this.logStructured('room.event_storage_invalid', {
      source: 'durable_object_buffer_marker',
      message: 'Stored event-buffer recovery marker is invalid',
      recoveredAsEventSequence: fallback,
    });
    this.eventBufferRecoverySequenceCache = fallback;
    await this.state.storage.put('eventBufferRecoverySequence', fallback);
    return fallback;
  }

  private async markEventBufferRecoveryRequired(sequence: number): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error('Event-buffer recovery sequence must be a positive safe integer');
    }
    const current = await this.getEventBufferRecoverySequence();
    const next = current === null ? sequence : Math.min(current, sequence);
    if (current === next) return;
    this.eventBufferRecoverySequenceCache = next;
    await this.state.storage.put('eventBufferRecoverySequence', next);
  }

  private async retireEventBufferRecoveryMarker(
    events: readonly InternalRoomEvent[],
  ): Promise<void> {
    const recoverySequence = await this.getEventBufferRecoverySequence();
    if (recoverySequence === null) return;
    const eventBufferStartSequence = events[0]?.eventSequence;
    if (eventBufferStartSequence === undefined || eventBufferStartSequence <= recoverySequence) {
      return;
    }
    this.eventBufferRecoverySequenceCache = null;
    await this.state.storage.delete('eventBufferRecoverySequence');
  }

  private async getEventBuffer(): Promise<InternalRoomEvent[]> {
    if (this.eventBufferCache !== null) return [...this.eventBufferCache];

    const stored = await this.state.storage.get('eventBuffer');
    if (stored === undefined) {
      if ((await this.getEventBufferRecoverySequence()) !== null) {
        this.eventBufferRecoverySequenceCache = null;
        await this.state.storage.delete('eventBufferRecoverySequence');
      }
      this.eventBufferCache = [];
      return [];
    }

    const latestEventSequence = await this.getEventSequence();
    if (!Array.isArray(stored)) {
      this.logStructured('room.event_storage_invalid', {
        source: 'durable_object_buffer',
        message: 'Stored event buffer is not an array',
      });
      await this.markEventBufferRecoveryRequired(Math.max(1, latestEventSequence));
      this.eventBufferCache = [];
      return [];
    }

    const events: InternalRoomEvent[] = [];
    let recoverySequence: number | undefined;
    for (const [index, event] of stored.entries()) {
      const eventSequence =
        isRecord(event) &&
        typeof event.eventSequence === 'number' &&
        Number.isSafeInteger(event.eventSequence) &&
        event.eventSequence >= 1
          ? event.eventSequence
          : undefined;
      try {
        events.push(migrateStoredInternalEvent(event));
      } catch (error) {
        const candidate = eventSequence ?? Math.max(1, latestEventSequence);
        recoverySequence =
          recoverySequence === undefined ? candidate : Math.min(recoverySequence, candidate);
        this.logStructured('room.event_storage_invalid', {
          source: 'durable_object_buffer',
          index,
          eventSequence,
          recoverySequence: candidate,
          message: asError(error).message,
        });
      }
    }
    if (recoverySequence !== undefined) {
      await this.markEventBufferRecoveryRequired(recoverySequence);
    }
    this.eventBufferCache = events;
    return [...events];
  }

  private async getRequestCache(): Promise<RequestCacheEntry[]> {
    const stored = await this.state.storage.get('requestCache');
    if (stored === undefined) return [];
    if (!Array.isArray(stored)) {
      this.logStructured('room.event_storage_invalid', {
        source: 'durable_object_request_cache',
        message: 'Stored request cache is not an array',
      });
      return [];
    }

    const entries: RequestCacheEntry[] = [];
    for (const [index, entry] of stored.entries()) {
      if (
        isRecord(entry) &&
        typeof entry.key === 'string' &&
        entry.key.length > 0 &&
        typeof entry.eventSequence === 'number' &&
        Number.isSafeInteger(entry.eventSequence) &&
        entry.eventSequence >= 1
      ) {
        entries.push({ key: entry.key, eventSequence: entry.eventSequence });
        continue;
      }
      this.logStructured('room.event_storage_invalid', {
        source: 'durable_object_request_cache',
        index,
        message: 'Stored request-cache entry is invalid',
      });
    }
    return entries;
  }

  private async recordRequest(
    sessionId: string,
    requestId: string,
    eventSequence: number,
  ): Promise<void> {
    const entries = await this.getRequestCache();
    entries.push({ key: `${sessionId}:${requestId}`, eventSequence });
    if (entries.length > 200) entries.splice(0, entries.length - 200);
    await this.state.storage.put('requestCache', entries);
    this.state.waitUntil(this.persistRequestRecord(sessionId, requestId, eventSequence));
  }

  private async persistRequestRecord(
    sessionId: string,
    requestId: string,
    eventSequence: number,
  ): Promise<void> {
    const roomId = (await this.state.storage.get<string>('roomId')) ?? this.state.id.toString();
    const createdAt = new Date().toISOString();
    try {
      await this.withD1Retry('request_idempotency_insert', () =>
        this.env.DB.prepare(`
        INSERT INTO room_requests (room_id, session_id, request_id, event_sequence, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(room_id, session_id, request_id) DO UPDATE SET
          event_sequence = excluded.event_sequence,
          created_at = excluded.created_at
      `)
          .bind(roomId, sessionId, requestId, eventSequence, createdAt)
          .run(),
      );
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
      await this.withD1Retry('request_idempotency_retention', () =>
        this.env.DB.prepare(`
        DELETE FROM room_requests
        WHERE room_id = ? AND created_at < ?
      `)
          .bind(roomId, cutoff)
          .run(),
      );
    } catch (error) {
      await this.recordPersistenceFailure('persist_request_idempotency', undefined, error);
    }
  }

  private assertIdempotencyReplayMatches(
    event: InternalRoomEvent,
    roomId: string,
    sessionId: string,
    requestId: string,
  ): InternalRoomEvent {
    const requesterSessionId =
      event.type === 'bulk_rolls_updated'
        ? event.requesterSessionId
        : event.type === 'room_policy_updated' || event.type === 'room_token_revoked'
          ? event.actor.sessionId
          : (event.requesterSessionId ??
            (event.type === 'roll_start' ? event.actor.sessionId : undefined));
    if (
      event.roomId === roomId &&
      event.requestId === requestId &&
      requesterSessionId === sessionId
    ) {
      return event;
    }

    this.logStructured('room.idempotency_replay_mismatch', {
      eventSequence: event.eventSequence,
      expectedRoomId: roomId,
      actualRoomId: event.roomId,
      expectedRequestId: requestId,
      actualRequestId: event.requestId,
      expectedSessionId: sessionId,
      actualSessionId: requesterSessionId,
    });
    throw new RoomOperationError(
      'idempotency_replay_unavailable',
      `Request '${requestId}' was already recorded but its retained response does not match the request`,
      409,
    );
  }

  private async findDuplicateRequest(
    sessionId: string,
    requestId: string,
  ): Promise<InternalRoomEvent | null> {
    const entries = await this.getRequestCache();
    const match = entries.toReversed().find((entry) => entry.key === `${sessionId}:${requestId}`);
    const roomId = (await this.state.storage.get<string>('roomId')) ?? this.state.id.toString();
    if (match) {
      const buffered = (await this.getEventBuffer()).find(
        (event) => event.eventSequence === match.eventSequence,
      );
      if (buffered) {
        return this.assertIdempotencyReplayMatches(buffered, roomId, sessionId, requestId);
      }
    }

    let eventSequence = match?.eventSequence;
    if (eventSequence === undefined) {
      const requestQuery = await this.env.DB.prepare(`
        SELECT event_sequence
        FROM room_requests
        WHERE room_id = ? AND session_id = ? AND request_id = ?
        LIMIT 1
      `)
        .bind(roomId, sessionId, requestId)
        .all<RoomRequestRow>();
      const persistedSequence = requestQuery.results?.[0]?.event_sequence;
      if (persistedSequence === undefined) return null;
      if (!Number.isSafeInteger(persistedSequence) || persistedSequence < 1) {
        this.logStructured('room.event_storage_invalid', {
          source: 'idempotency_request_index',
          requestId,
          eventSequence: persistedSequence,
          message: 'Persisted request index contains an invalid event sequence',
        });
        throw new RoomOperationError(
          'idempotency_replay_unavailable',
          `Request '${requestId}' was already recorded but its retained response index is invalid`,
          409,
        );
      }
      eventSequence = persistedSequence;
    }
    const eventQuery = await this.env.DB.prepare(`
      SELECT event_sequence, event_json, created_at
      FROM room_events
      WHERE room_id = ? AND event_sequence = ?
      LIMIT 1
    `)
      .bind(roomId, eventSequence)
      .all<RoomEventRow>();
    const serialized = eventQuery.results?.[0]?.event_json;
    if (!serialized) {
      throw new RoomOperationError(
        'idempotency_replay_unavailable',
        `Request '${requestId}' was already recorded but its retained response is unavailable`,
        409,
      );
    }
    try {
      // Deserializes storage this Durable Object previously serialized itself.
      const internal = migrateStoredInternalEvent(JSON.parse(serialized));
      return this.assertIdempotencyReplayMatches(internal, roomId, sessionId, requestId);
    } catch (error) {
      if (error instanceof RoomOperationError) throw error;
      this.logStructured('room.event_storage_invalid', {
        source: 'idempotency_replay',
        eventSequence,
        requestId,
        message: asError(error).message,
      });
      throw new RoomOperationError(
        'idempotency_replay_unavailable',
        `Request '${requestId}' was already recorded but its retained response is invalid`,
        409,
      );
    }
  }

  private async nextRollSequence(): Promise<number> {
    const value = (await this.getRollSequence()) + 1;
    await this.state.storage.put('rollSequence', value);
    return value;
  }

  private async getRollSequence(): Promise<number> {
    return (
      (await this.state.storage.get<number>('rollSequence')) ??
      (await this.state.storage.get<number>('sequence')) ??
      0
    );
  }

  private async nextEventSequence(): Promise<number> {
    const value = (await this.getEventSequence()) + 1;
    await this.state.storage.put('eventSequence', value);
    return value;
  }

  private async getEventSequence(): Promise<number> {
    return (await this.state.storage.get<number>('eventSequence')) ?? 0;
  }

  private getSession(socket: WebSocket): ConnectionAttachment | null {
    const existing = this.sessions.get(socket);
    if (existing) return existing;
    const restored = deserializeAttachment(socket);
    if (restored) this.sessions.set(socket, restored);
    return restored;
  }

  private getSessions(): Map<WebSocket, ConnectionAttachment> {
    for (const socket of this.state.getWebSockets('draftroll-room')) this.getSession(socket);
    return this.sessions;
  }

  private listParticipants(): RoomParticipant[] {
    const unique = new Map<string, RoomParticipant>();
    for (const participant of this.getSessions().values()) {
      if (!participant.joined || !participant.passwordAuthenticated) continue;
      unique.set(participant.sessionId, roomParticipantFromAttachment(participant));
    }
    return [...unique.values()];
  }
}

function roomParticipantFromAttachment(participant: ConnectionAttachment): RoomParticipant {
  return {
    participantId: participant.participantId,
    sessionId: participant.sessionId,
    name: participant.name,
    roles: [...participant.roles],
    permissions: [...participant.permissions],
    metadata: participant.metadata,
    connectedAt: participant.connectedAt,
  };
}

const STORED_ROLL_COMMON_FIELDS = [
  'type',
  'protocolVersion',
  'roomId',
  'eventSequence',
  'requestId',
  'requesterSessionId',
  'clientRollId',
  'rollId',
  'sequence',
  'actor',
  'visibility',
  'result',
] as const;

function migrateStoredInternalEvent(event: unknown): InternalRoomEvent {
  if (!isRecord(event) || typeof event.type !== 'string') {
    throw new Error('Stored room event is not a valid object');
  }
  switch (event.type) {
    case 'roll_start':
    case 'roll_updated':
    case 'roll_visibility_updated':
      return migrateStoredRollEvent(event, event.type);
    case 'room_policy_updated': {
      assertStoredEventFields(event, [
        'type',
        'protocolVersion',
        'roomId',
        'eventSequence',
        'requestId',
        'revision',
        'actor',
        'policy',
        'previousPolicy',
      ]);
      const decoded = decodeStoredServerEvent({ ...event, replayed: true }, 'room_policy_updated');
      if (decoded.type !== 'room_policy_updated')
        throw new Error('Stored policy event type mismatch');
      return {
        type: 'room_policy_updated',
        protocolVersion: decoded.protocolVersion,
        roomId: decoded.roomId,
        eventSequence: decoded.eventSequence,
        requestId: decoded.requestId,
        revision: decoded.revision,
        actor: decoded.actor,
        policy: decoded.policy,
        previousPolicy: decoded.previousPolicy,
      };
    }
    case 'room_token_revoked': {
      assertStoredEventFields(event, [
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
      ]);
      const decoded = decodeStoredServerEvent({ ...event, replayed: true }, 'room_token_revoked');
      if (decoded.type !== 'room_token_revoked')
        throw new Error('Stored token event type mismatch');
      return {
        type: 'room_token_revoked',
        protocolVersion: decoded.protocolVersion,
        roomId: decoded.roomId,
        eventSequence: decoded.eventSequence,
        requestId: decoded.requestId,
        actor: decoded.actor,
        target: decoded.target,
        revokedAt: decoded.revokedAt,
        reason: decoded.reason,
        disconnectedSessions: decoded.disconnectedSessions,
      };
    }
    case 'bulk_rolls_updated': {
      assertStoredEventFields(event, [
        'type',
        'protocolVersion',
        'roomId',
        'eventSequence',
        'requestId',
        'requesterSessionId',
        'updates',
      ]);
      const requesterSessionId = readStoredIdentifier(
        event.requesterSessionId,
        'requesterSessionId',
        true,
      );
      const projected: Record<string, unknown> = { ...event, replayed: true };
      delete projected.requesterSessionId;
      const decoded = decodeStoredServerEvent(projected, 'bulk_rolls_updated');
      if (decoded.type !== 'bulk_rolls_updated' || requesterSessionId === undefined) {
        throw new Error('Stored bulk event is invalid');
      }
      return {
        type: 'bulk_rolls_updated',
        protocolVersion: decoded.protocolVersion,
        roomId: decoded.roomId,
        eventSequence: decoded.eventSequence,
        requestId: decoded.requestId,
        requesterSessionId,
        updates: decoded.updates,
      };
    }
    default:
      throw new Error(`Stored room event has unsupported type '${event.type}'`);
  }
}

function migrateStoredRollEvent(
  event: Record<string, unknown>,
  type: 'roll_start' | 'roll_updated' | 'roll_visibility_updated',
): InternalRoomRollEvent {
  const extraFields =
    type === 'roll_start'
      ? ['animationSeed', 'serverStartTimeMs', 'animationDurationMs', 'startBufferMs']
      : type === 'roll_updated'
        ? [
            'animate',
            'animationSeed',
            'serverStartTimeMs',
            'animationDurationMs',
            'startBufferMs',
            'audit',
          ]
        : ['previousVisibility', 'audit'];
  assertStoredEventFields(event, [...STORED_ROLL_COMMON_FIELDS, ...extraFields]);

  const requesterSessionId = readStoredIdentifier(event.requesterSessionId, 'requesterSessionId');
  const result = decodeNormalizedRollResult(event.result, { allowLegacyResults: true });
  if (!result.success) {
    throw new Error(`Stored room event contains an invalid roll result: ${result.error.message}`);
  }

  const projected: Record<string, unknown> = {
    ...event,
    result: result.data,
    hidden: false,
    summary: {
      rollId: event.rollId,
      sequence: event.sequence,
      revision: result.data.revision ?? 0,
      name: result.data.name,
      actor: event.actor,
      createdAt: result.data.createdAt,
      updatedAt: result.data.updatedAt,
    },
  };
  delete projected.requesterSessionId;

  const decoded = decodeStoredServerEvent(projected, type);
  if (
    decoded.type !== 'roll_start' &&
    decoded.type !== 'roll_updated' &&
    decoded.type !== 'roll_visibility_updated'
  ) {
    throw new Error('Stored roll event type mismatch');
  }
  if (decoded.type !== type || decoded.result === null) {
    throw new Error('Stored roll event does not contain a visible normalized result');
  }
  const visibility = requireStoredVisibility(decoded.visibility, 'visibility');
  if (decoded.result.rollId !== decoded.rollId || decoded.result.sequence !== decoded.sequence) {
    throw new Error('Stored roll event result identifiers do not match the event');
  }

  const common = {
    protocolVersion: decoded.protocolVersion,
    roomId: decoded.roomId,
    eventSequence: decoded.eventSequence,
    requestId: decoded.requestId,
    requesterSessionId,
    clientRollId: decoded.clientRollId,
    rollId: decoded.rollId,
    sequence: decoded.sequence,
    actor: decoded.actor,
    visibility,
    result: decoded.result,
  };

  if (decoded.type === 'roll_start') {
    if (
      decoded.animationSeed === undefined ||
      decoded.serverStartTimeMs === undefined ||
      decoded.animationDurationMs === undefined ||
      decoded.startBufferMs === undefined
    ) {
      throw new Error('Stored roll_start event is missing required animation fields');
    }
    return {
      type: 'roll_start',
      ...common,
      animationSeed: decoded.animationSeed,
      serverStartTimeMs: decoded.serverStartTimeMs,
      animationDurationMs: decoded.animationDurationMs,
      startBufferMs: decoded.startBufferMs,
    };
  }
  if (decoded.type === 'roll_updated') {
    return {
      type: 'roll_updated',
      ...common,
      animate: decoded.animate,
      animationSeed: decoded.animationSeed,
      serverStartTimeMs: decoded.serverStartTimeMs,
      animationDurationMs: decoded.animationDurationMs,
      startBufferMs: decoded.startBufferMs,
      audit: decoded.audit,
    };
  }
  return {
    type: 'roll_visibility_updated',
    ...common,
    previousVisibility: requireStoredVisibility(decoded.previousVisibility, 'previousVisibility'),
    audit: decoded.audit,
  };
}

function decodeStoredServerEvent(
  value: unknown,
  expectedType: ServerToClientEvent['type'],
): ServerToClientEvent {
  const decoded = decodeServerToClientEvent(value, {
    rejectUnknownFields: true,
    allowLegacyResults: false,
  });
  if (!decoded.success) {
    throw new Error(`Stored room event is invalid: ${decoded.error.message}`);
  }
  if (decoded.data.type !== expectedType) {
    throw new Error(
      `Stored room event type '${decoded.data.type}' does not match '${expectedType}'`,
    );
  }
  return decoded.data;
}

function assertStoredEventFields(
  event: Record<string, unknown>,
  allowedFields: readonly string[],
): void {
  const unexpected = Object.keys(event).find((field) => !allowedFields.includes(field));
  if (unexpected !== undefined) {
    throw new Error(`Stored room event contains unexpected field '${unexpected}'`);
  }
}

function readStoredIdentifier(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined) {
    if (required) throw new Error(`Stored room event is missing '${field}'`);
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new Error(`Stored room event has invalid '${field}'`);
  }
  return value;
}

function requireStoredVisibility(
  value: RoomRollEvent['visibility'],
  field: string,
): RollVisibility {
  if (value.type === 'hidden') {
    throw new Error(`Stored room event '${field}' cannot be hidden`);
  }
  return value;
}

function projectInternalEvent(
  event: InternalRoomEvent,
  participant: ConnectionAttachment,
  replayed = false,
): RoomReplayEvent | null {
  if (event.type === 'bulk_rolls_updated') return null;
  if (event.type === 'room_policy_updated') return projectPolicyEvent(event, participant, replayed);
  if (event.type === 'room_token_revoked') {
    return participant.permissions.includes('room:manage')
      ? projectTokenRevocationEvent(event, participant, replayed)
      : null;
  }
  return projectEvent(event, participant, replayed);
}

function projectBulkEvent(
  event: InternalBulkRollUpdatedEvent,
  participant: ConnectionAttachment,
  replayed = false,
): BulkRollUpdatedEvent | null {
  if (participant.sessionId !== event.requesterSessionId) return null;
  return {
    type: 'bulk_rolls_updated',
    protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
    roomId: event.roomId,
    requestId: event.requestId,
    eventSequence: event.eventSequence,
    updates: event.updates.map((update) => ({ ...update })),
    replayed,
  };
}

function projectTokenRevocationEvent(
  event: InternalRoomTokenRevokedEvent,
  participant: ConnectionAttachment,
  replayed = false,
): RoomTokenRevokedEvent {
  const isRequester = participant.sessionId === event.actor.sessionId;
  return {
    type: 'room_token_revoked',
    protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
    roomId: event.roomId,
    eventSequence: event.eventSequence,
    requestId: isRequester ? event.requestId : undefined,
    actor: event.actor,
    target: event.target,
    revokedAt: event.revokedAt,
    reason: event.reason,
    disconnectedSessions: event.disconnectedSessions,
    replayed,
  };
}

function projectPolicyEvent(
  event: InternalRoomPolicyUpdatedEvent,
  participant: ConnectionAttachment,
  replayed = false,
): RoomPolicyUpdatedEvent {
  const isRequester = participant.sessionId === event.actor.sessionId;
  return {
    type: 'room_policy_updated',
    protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
    roomId: event.roomId,
    eventSequence: event.eventSequence,
    requestId: isRequester ? event.requestId : undefined,
    revision: event.revision,
    actor: event.actor,
    policy: event.policy,
    previousPolicy: event.previousPolicy,
    replayed,
  };
}

function projectEvent(
  event: InternalRoomRollEvent,
  participant: ConnectionAttachment,
  replayed = false,
): RoomRollEvent {
  const authorized = canViewRoll(participant, event.actor, event.visibility);
  const summary = createSummary(event.result, event.actor);
  const isRequester = participant.sessionId === (event.requesterSessionId ?? event.actor.sessionId);
  const canViewAudit =
    isRequester ||
    participant.permissions.includes('room:manage') ||
    participant.permissions.includes('roll:view-hidden');
  const common = {
    protocolVersion: DRAFTROLL_PROTOCOL_VERSION,
    roomId: event.roomId,
    eventSequence: event.eventSequence,
    requestId: isRequester ? event.requestId : undefined,
    clientRollId: isRequester ? event.clientRollId : undefined,
    replayed,
    rollId: event.rollId,
    sequence: event.sequence,
    actor: event.actor,
    visibility: authorized ? event.visibility : ({ type: 'hidden' } as const),
    hidden: !authorized,
    summary,
    result: authorized ? event.result : null,
  };

  if (event.type === 'roll_start') {
    const projected: RollStartEvent = {
      type: 'roll_start',
      ...common,
      animationSeed: authorized ? event.animationSeed : undefined,
      serverStartTimeMs: authorized ? event.serverStartTimeMs : undefined,
      animationDurationMs: authorized ? event.animationDurationMs : undefined,
      startBufferMs: authorized ? event.startBufferMs : undefined,
    };
    return projected;
  }
  if (event.type === 'roll_updated') {
    const projected: RollUpdatedEvent = {
      type: 'roll_updated',
      ...common,
      animate: authorized && event.animate,
      animationSeed: authorized ? event.animationSeed : undefined,
      serverStartTimeMs: authorized ? event.serverStartTimeMs : undefined,
      animationDurationMs: authorized ? event.animationDurationMs : undefined,
      startBufferMs: authorized ? event.startBufferMs : undefined,
      audit: canViewAudit ? event.audit : undefined,
    };
    return projected;
  }
  const projected: RollVisibilityUpdatedEvent = {
    type: 'roll_visibility_updated',
    ...common,
    previousVisibility: authorized ? event.previousVisibility : { type: 'hidden' },
    audit: canViewAudit ? event.audit : undefined,
  };
  return projected;
}

function projectStoredRoll(record: StoredRoll, participant: ConnectionAttachment) {
  const authorized = canViewRoll(participant, record.actor, record.visibility);
  return {
    rollId: record.result.rollId,
    sequence: record.result.sequence,
    revision: record.result.revision ?? 0,
    actor: record.actor,
    visibility: authorized ? record.visibility : ({ type: 'hidden' } as const),
    hidden: !authorized,
    summary: createSummary(record.result, record.actor),
    result: authorized ? record.result : null,
  };
}

function createSummary(result: NormalizedRollResult, actor: RoomActor) {
  return {
    // Stored rolls always carry an id; fall back rather than emitting `undefined`.
    rollId: result.rollId ?? '',
    sequence: result.sequence ?? 0,
    revision: result.revision ?? 0,
    name: result.name,
    actor,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  };
}

function canViewRoll(
  participant: ConnectionAttachment,
  actor: RoomActor,
  visibility: RollVisibility,
): boolean {
  if (
    participant.permissions.includes('roll:view-hidden') ||
    participant.permissions.includes('room:manage')
  )
    return true;
  if (visibility.type === 'public') return true;
  if (visibility.type === 'roller') return participant.participantId === actor.participantId;
  if (visibility.type === 'roles') return intersects(participant.roles, visibility.roles);
  if (visibility.type === 'participants')
    return visibility.participantIds.includes(participant.participantId);
  return (
    visibility.participantIds.includes(participant.participantId) ||
    intersects(participant.roles, visibility.roles)
  );
}

function assertCanMutate(
  participant: ConnectionAttachment,
  record: StoredRoll,
  operation: 'update' | 'reroll' | 'reveal',
  policy: RoomPolicy,
): void {
  const own = participant.participantId === record.actor.participantId;
  const anyPermission = operation === 'reveal' ? 'roll:reveal-any' : 'roll:update-any';
  const ownPermission = operation === 'reveal' ? 'roll:reveal-own' : 'roll:update-own';
  const privilegedAllowed =
    operation === 'reveal'
      ? policy.authorization.allowPrivilegedAnyRollReveal
      : policy.authorization.allowPrivilegedAnyRollUpdates;
  const ownAllowed =
    operation === 'reveal'
      ? policy.authorization.allowOwnRollReveal
      : operation === 'reroll'
        ? policy.authorization.allowOwnRollRerolls
        : policy.authorization.allowOwnRollUpdates;

  const privileged =
    participant.permissions.includes('room:manage') ||
    participant.permissions.includes(anyPermission);
  const ownPermissionGranted = own && participant.permissions.includes(ownPermission);
  if (!privileged && !ownPermissionGranted) {
    const message = own
      ? `Missing room permission '${ownPermission}' or '${anyPermission}'`
      : `Missing room permission '${anyPermission}'`;
    throw new RoomOperationError('permission_denied', message, 403);
  }
  if (privileged && privilegedAllowed) return;
  if (ownPermissionGranted && ownAllowed) return;
  throw new RoomOperationError(
    'policy_denied',
    `Room policy does not allow participant '${participant.participantId}' to ${operation} roll '${record.result.rollId}'`,
    403,
  );
}

function assertRoomEnabled(participant: ConnectionAttachment, policy: RoomPolicy): void {
  if (policy.enabled || participant.permissions.includes('room:manage')) return;
  throw new RoomOperationError(
    'room_disabled',
    policy.shutdownReason
      ? `Room is disabled: ${policy.shutdownReason}`
      : 'Room is disabled by policy',
    403,
  );
}

function assertVisibilityAllowed(visibility: RollVisibility | undefined, policy: RoomPolicy): void {
  const normalized = normalizeVisibility(visibility);
  if (normalized.type === 'public') return;
  if (!policy.authorization.allowHiddenRolls) {
    throw new RoomOperationError(
      'hidden_rolls_disabled',
      'Room policy does not allow hidden rolls',
      403,
    );
  }
  if (normalized.type !== 'roller' && !policy.authorization.allowWhispers) {
    throw new RoomOperationError(
      'whispers_disabled',
      'Room policy does not allow participant- or role-targeted rolls',
      403,
    );
  }
}

function assertRollInputWithinPolicy(
  input: Extract<ClientToServerEvent, { type: 'roll_request' | 'display_roll' }>['input'],
  policy: RoomPolicy,
): void {
  if (
    'expression' in input &&
    typeof input.expression === 'string' &&
    input.expression.length > policy.limits.maximumExpressionLength
  ) {
    throw new RoomOperationError(
      'policy_limit_exceeded',
      `Expression exceeds room maximum of ${policy.limits.maximumExpressionLength} characters`,
      413,
    );
  }
  if (
    'dice' in input &&
    Array.isArray(input.dice) &&
    input.dice.length > policy.limits.maximumDicePerRoll
  ) {
    throw new RoomOperationError(
      'policy_limit_exceeded',
      `Roll exceeds room maximum of ${policy.limits.maximumDicePerRoll} dice`,
      413,
    );
  }
  if (
    'operations' in input &&
    Array.isArray(input.operations) &&
    input.operations.length > policy.limits.maximumOperationsPerRoll
  ) {
    throw new RoomOperationError(
      'policy_limit_exceeded',
      `Roll exceeds room maximum of ${policy.limits.maximumOperationsPerRoll} operations`,
      413,
    );
  }
}

function assertRollUpdateWithinPolicy(
  event: {
    update: Extract<ClientToServerEvent, { type: 'update_roll' }>['update'];
    reroll?: boolean | string[];
  },
  policy: RoomPolicy,
): void {
  if (
    typeof event.update.expression === 'string' &&
    event.update.expression.length > policy.limits.maximumExpressionLength
  ) {
    throw new RoomOperationError(
      'policy_limit_exceeded',
      `Expression exceeds room maximum of ${policy.limits.maximumExpressionLength} characters`,
      413,
    );
  }
  if (
    (event.update.dice?.length ?? 0) > policy.limits.maximumDicePerRoll ||
    (event.update.removeDice?.length ?? 0) > policy.limits.maximumDicePerRoll ||
    (Array.isArray(event.reroll) && event.reroll.length > policy.limits.maximumDicePerRoll)
  ) {
    throw new RoomOperationError(
      'policy_limit_exceeded',
      `Update exceeds room maximum of ${policy.limits.maximumDicePerRoll} dice`,
      413,
    );
  }
}

function assertResultWithinPolicy(result: NormalizedRollResult, policy: RoomPolicy): void {
  if (result.dice.length > policy.limits.maximumDicePerRoll) {
    throw new RoomOperationError(
      'policy_limit_exceeded',
      `Evaluated result contains ${result.dice.length} dice; room maximum is ${policy.limits.maximumDicePerRoll}`,
      413,
    );
  }
  if (result.operations.length > policy.limits.maximumOperationsPerRoll) {
    throw new RoomOperationError(
      'policy_limit_exceeded',
      `Evaluated result contains ${result.operations.length} operations; room maximum is ${policy.limits.maximumOperationsPerRoll}`,
      413,
    );
  }
}

function assertMetadataSize(
  metadata: Record<string, unknown> | undefined,
  maximumBytes: number,
  label: string,
): void {
  if (!metadata) return;
  const bytes = new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
  if (bytes > maximumBytes) {
    throw new RoomOperationError(
      'policy_limit_exceeded',
      `${label} is ${bytes} bytes; room maximum is ${maximumBytes}`,
      413,
    );
  }
}

function assertPermission(participant: ConnectionAttachment, permission: RoomPermission): void {
  if (
    participant.permissions.includes(permission) ||
    participant.permissions.includes('room:manage')
  )
    return;
  throw new RoomOperationError('permission_denied', `Missing room permission '${permission}'`, 403);
}

function assertRevision(
  result: NormalizedRollResult,
  expected: number | undefined,
  rollId: string,
): void {
  if (expected === undefined) return;
  const current = result.revision ?? 0;
  if (expected !== current) {
    throw new RevisionConflictError(rollId, expected, current);
  }
}

function actorFromParticipant(participant: ConnectionAttachment): RoomActor {
  return {
    participantId: participant.participantId,
    sessionId: participant.sessionId,
    name: participant.name,
    roles: [...participant.roles],
    metadata: participant.metadata,
  };
}

function normalizeVisibility(visibility: RollVisibility | undefined): RollVisibility {
  if (!visibility) return { type: 'public' };
  if (visibility.type === 'roles') return { type: 'roles', roles: uniqueStrings(visibility.roles) };
  if (visibility.type === 'participants') {
    return { type: 'participants', participantIds: uniqueStrings(visibility.participantIds) };
  }
  if (visibility.type === 'participants-and-roles') {
    return {
      type: 'participants-and-roles',
      participantIds: uniqueStrings(visibility.participantIds),
      roles: uniqueStrings(visibility.roles),
    };
  }
  return visibility;
}

async function authorizeRequest(
  request: Request,
  roomId: string,
  env: Env,
  isRevoked: (
    payload: RoomCapabilityTokenPayload,
    header: RoomTokenHeader,
  ) => boolean | Promise<boolean>,
  allowPendingToken = false,
): Promise<ConnectionAttachment> {
  const url = new URL(request.url);
  const token = bearerToken(request.headers.get('Authorization'));
  const tokenRequested = url.searchParams.get('authMode') === 'token';
  let payload: RoomCapabilityTokenPayload | null = null;
  let tokenKeyId: string | undefined;

  if (token) {
    const verified = await verifyCapabilityTokenForRoom(token, roomId, env, isRevoked);
    payload = verified.payload;
    tokenKeyId = verified.keyId;
  } else if (env.ALLOW_ANONYMOUS !== 'true' && !allowPendingToken) {
    throw new AuthorizationError(
      'token_required',
      'This Draftroll server requires a room capability token',
      401,
    );
  }

  const authorizationComplete =
    payload !== null || (env.ALLOW_ANONYMOUS === 'true' && !tokenRequested);
  const participantId =
    payload?.participantId ??
    cleanIdentifier(url.searchParams.get('participantId')) ??
    crypto.randomUUID();
  const sessionId =
    payload?.sessionId ?? cleanIdentifier(url.searchParams.get('sessionId')) ?? crypto.randomUUID();
  const name = cleanName(payload?.name ?? url.searchParams.get('name')) ?? 'Anonymous';
  const roles = uniqueStrings(payload?.roles ?? []);
  const permissions = payload
    ? uniqueStrings(payload.permissions ?? []).filter(isRoomPermission)
    : authorizationComplete
      ? [...DEFAULT_ANONYMOUS_PERMISSIONS]
      : [];
  const queryMetadata = safeJsonParse(url.searchParams.get('participantMetadata') ?? '');
  const metadata = payload?.metadata ?? (isRecord(queryMetadata) ? queryMetadata : undefined);

  const connectedAt = new Date().toISOString();
  const clientAddress =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown';
  return {
    roomId,
    participantId,
    sessionId,
    name,
    roles,
    permissions,
    metadata,
    connectedAt,
    lastSeenAt: connectedAt,
    clientIpHash: await hashClientAddress(clientAddress),
    passwordAuthenticated: false,
    joined: false,
    passwordAttempts: 0,
    reconnectAfterEventSequence: parseNonNegativeInteger(
      url.searchParams.get('lastEventSequence'),
      0,
    ),
    authorizationComplete,
    tokenAuthenticated: payload !== null,
    tokenAttempts: 0,
    tokenId: payload?.jti,
    tokenIssuedAt: payload?.iat,
    tokenExpiresAt: payload?.exp,
    tokenKeyId,
    tokenIssuer: payload?.iss,
    tokenAudience:
      payload?.aud === undefined
        ? undefined
        : Array.isArray(payload.aud)
          ? [...payload.aud]
          : [payload.aud],
    rendererReady: false,
    themesReady: false,
  };
}

async function verifyCapabilityTokenForRoom(
  token: string,
  roomId: string,
  env: Env,
  isRevoked: (
    payload: RoomCapabilityTokenPayload,
    header: RoomTokenHeader,
  ) => boolean | Promise<boolean>,
): Promise<{ payload: RoomCapabilityTokenPayload; keyId?: string }> {
  const keySource = parseRoomTokenVerificationKeys(env);
  if (!keySource) {
    throw new AuthorizationError(
      'token_verification_unavailable',
      'ROOM_TOKEN_KEYS or ROOM_TOKEN_SECRET must be configured to verify room tokens',
      503,
    );
  }
  const verified = await verifyRoomCapabilityTokenDetailed(token, keySource, {
    roomId,
    issuer: env.ROOM_TOKEN_ISSUER?.trim() || undefined,
    audience: splitConfiguredValues(env.ROOM_TOKEN_AUDIENCE),
    clockToleranceSeconds: 30,
    requireTokenId: env.ROOM_TOKEN_REQUIRE_JTI === 'true',
    requireIssuedAt: env.ROOM_TOKEN_REQUIRE_JTI === 'true',
    isRevoked,
  });
  if (!verified.valid) {
    throw new AuthorizationError(verified.code, verified.message, 401);
  }
  return {
    payload: verified.token.payload,
    keyId: verified.token.header.kid ?? verified.token.verifiedKeyId,
  };
}

function parseRoomTokenVerificationKeys(env: Env): RoomTokenVerificationKeySource | null {
  const keys: Array<{ id: string; secret: string }> = [];
  if (env.ROOM_TOKEN_KEYS?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.ROOM_TOKEN_KEYS);
    } catch {
      throw new AuthorizationError(
        'token_key_configuration_invalid',
        'ROOM_TOKEN_KEYS must be a JSON object',
        503,
      );
    }
    if (!isRecord(parsed)) {
      throw new AuthorizationError(
        'token_key_configuration_invalid',
        'ROOM_TOKEN_KEYS must map key IDs to secrets',
        503,
      );
    }
    for (const [id, secret] of Object.entries(parsed)) {
      if (!id.trim() || typeof secret !== 'string' || secret.length < 16) {
        throw new AuthorizationError(
          'token_key_configuration_invalid',
          'Every ROOM_TOKEN_KEYS entry must have a non-empty key ID and a secret of at least 16 characters',
          503,
        );
      }
      keys.push({ id: id.trim(), secret });
    }
  }
  if (env.ROOM_TOKEN_SECRET) keys.push({ id: '', secret: env.ROOM_TOKEN_SECRET });
  return keys.length > 0 ? keys : null;
}

function splitConfiguredValues(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values && values.length > 0 ? values : undefined;
}

function exactTokenRevocationKey(tokenId: string): string {
  return `${TOKEN_REVOCATION_PREFIX}${encodeURIComponent(tokenId)}`;
}

function participantTokenRevocationKey(participantId: string): string {
  return `${PARTICIPANT_TOKEN_REVOCATION_PREFIX}${encodeURIComponent(participantId)}`;
}

function tokenSessionMatchesRevocation(
  session: ConnectionAttachment,
  target: RoomTokenRevocationTarget,
): boolean {
  if (!session.tokenAuthenticated) return false;
  if (target.type === 'token') return session.tokenId === target.tokenId;
  if (session.participantId !== target.participantId) return false;
  const cutoff = target.issuedAtOrBefore ?? Number.MAX_SAFE_INTEGER;
  return session.tokenIssuedAt === undefined || session.tokenIssuedAt <= cutoff;
}

function rowToStoredRoll(row: RollHistoryRow): StoredRoll {
  const decoded = decodeNormalizedRollResult(safeJsonParse(row.result_json), {
    allowLegacyResults: true,
  });
  if (!decoded.success)
    throw new Error(`Stored roll '${row.roll_id}' is invalid: ${decoded.error.message}`);
  return {
    result: decoded.data,
    actor: parseActor(row.actor_json),
    visibility: parseVisibility(row.visibility_json),
  };
}

function revisionRowToStoredRoll(row: RollRevisionRow): StoredRoll {
  const decoded = decodeNormalizedRollResult(safeJsonParse(row.result_json), {
    allowLegacyResults: true,
  });
  if (!decoded.success)
    throw new Error(`Stored roll revision '${row.revision}' is invalid: ${decoded.error.message}`);
  return {
    result: decoded.data,
    actor: parseActor(row.actor_json),
    visibility: parseVisibility(row.visibility_json),
  };
}

function parseActor(value: string | null): RoomActor {
  const parsed = value ? safeJsonParse(value) : null;
  if (
    isRecord(parsed) &&
    typeof parsed.participantId === 'string' &&
    typeof parsed.sessionId === 'string' &&
    typeof parsed.name === 'string'
  ) {
    return {
      participantId: parsed.participantId,
      sessionId: parsed.sessionId,
      name: parsed.name,
      roles: Array.isArray(parsed.roles)
        ? parsed.roles.filter((role): role is string => typeof role === 'string')
        : [],
      metadata: isRecord(parsed.metadata) ? parsed.metadata : undefined,
    };
  }
  return { participantId: 'legacy', sessionId: 'legacy', name: 'Unknown', roles: [] };
}

function parseVisibility(value: string | null): RollVisibility {
  const parsed = value ? safeJsonParse(value) : null;
  if (isRecord(parsed) && typeof parsed.type === 'string') {
    if (parsed.type === 'public' || parsed.type === 'roller') return { type: parsed.type };
    if (parsed.type === 'roles' && Array.isArray(parsed.roles)) {
      return {
        type: 'roles',
        roles: parsed.roles.filter((role): role is string => typeof role === 'string'),
      };
    }
    if (parsed.type === 'participants' && Array.isArray(parsed.participantIds)) {
      return {
        type: 'participants',
        participantIds: parsed.participantIds.filter((id): id is string => typeof id === 'string'),
      };
    }
    if (
      parsed.type === 'participants-and-roles' &&
      Array.isArray(parsed.participantIds) &&
      Array.isArray(parsed.roles)
    ) {
      return {
        type: 'participants-and-roles',
        participantIds: parsed.participantIds.filter((id): id is string => typeof id === 'string'),
        roles: parsed.roles.filter((role): role is string => typeof role === 'string'),
      };
    }
  }
  return { type: 'public' };
}

function parseClientEvent(
  raw: string | ArrayBuffer,
  maximumBytes: number,
): { event?: ClientToServerEvent; error?: import('@draftroll/protocol').DraftrollValidationError } {
  const parsed = parseRuntimeJson(raw, { maximumBytes });
  if (!parsed.success) return { error: parsed.error };
  const decoded = decodeClientToServerEvent(parsed.data, { rejectUnknownFields: true });
  return decoded.success ? { event: decoded.data } : { error: decoded.error };
}

function sendEvent(socket: WebSocket, event: ServerToClientEvent): void {
  const decoded = decodeServerToClientEvent(event, {
    rejectUnknownFields: true,
    allowLegacyResults: false,
  });
  if (!decoded.success) {
    console.error('Draftroll attempted to send an invalid server event', decoded.error.issues);
    socket.close(1011, 'Invalid Draftroll server event');
    return;
  }
  const payload = JSON.stringify(decoded.data);
  if (new TextEncoder().encode(payload).byteLength > 512 * 1024) {
    console.error('Draftroll server event exceeds the maximum payload size');
    socket.close(1009, 'Draftroll event is too large');
    return;
  }
  socket.send(payload);
}

/** The Workers runtime augments WebSocket with hibernation attachment helpers. */
interface HibernatableWebSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

function serializeAttachment(socket: WebSocket, participant: ConnectionAttachment): void {
  // The Workers runtime provides these methods; the standard WebSocket type omits them.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  (socket as HibernatableWebSocket).serializeAttachment(participant);
}

function deserializeAttachment(socket: WebSocket): ConnectionAttachment | null {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const value = (socket as HibernatableWebSocket).deserializeAttachment();
  if (
    !isRecord(value) ||
    typeof value.roomId !== 'string' ||
    typeof value.participantId !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof value.name !== 'string'
  )
    return null;
  const connectedAt =
    typeof value.connectedAt === 'string' ? value.connectedAt : new Date().toISOString();
  return {
    // The guards above establish every required participant field; the spread carries
    // the remaining optional state that hibernation round-tripped.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    ...(value as unknown as RoomParticipant),
    roomId: value.roomId,
    connectedAt,
    lastSeenAt: typeof value.lastSeenAt === 'string' ? value.lastSeenAt : connectedAt,
    clientIpHash: typeof value.clientIpHash === 'string' ? value.clientIpHash : 'legacy',
    authorizationComplete:
      value.authorizationComplete === true || value.tokenAuthenticated === true,
    passwordAuthenticated: value.passwordAuthenticated === true,
    joined: value.joined === true,
    tokenAttempts:
      typeof value.tokenAttempts === 'number' && Number.isSafeInteger(value.tokenAttempts)
        ? Math.max(0, value.tokenAttempts)
        : 0,
    passwordAttempts:
      typeof value.passwordAttempts === 'number' && Number.isSafeInteger(value.passwordAttempts)
        ? Math.max(0, value.passwordAttempts)
        : 0,
    reconnectAfterEventSequence:
      typeof value.reconnectAfterEventSequence === 'number' &&
      Number.isSafeInteger(value.reconnectAfterEventSequence)
        ? Math.max(0, value.reconnectAfterEventSequence)
        : 0,
    tokenAuthenticated: value.tokenAuthenticated === true,
    tokenId: typeof value.tokenId === 'string' ? value.tokenId : undefined,
    tokenIssuedAt:
      typeof value.tokenIssuedAt === 'number' && Number.isSafeInteger(value.tokenIssuedAt)
        ? value.tokenIssuedAt
        : undefined,
    tokenExpiresAt:
      typeof value.tokenExpiresAt === 'number' && Number.isSafeInteger(value.tokenExpiresAt)
        ? value.tokenExpiresAt
        : undefined,
    tokenKeyId: typeof value.tokenKeyId === 'string' ? value.tokenKeyId : undefined,
    tokenIssuer: typeof value.tokenIssuer === 'string' ? value.tokenIssuer : undefined,
    tokenAudience: Array.isArray(value.tokenAudience)
      ? value.tokenAudience.filter((audience): audience is string => typeof audience === 'string')
      : undefined,
    rendererReady: value.rendererReady === true,
    themesReady: value.themesReady === true,
    roundTripMs:
      typeof value.roundTripMs === 'number' && Number.isFinite(value.roundTripMs)
        ? Math.max(0, value.roundTripMs)
        : undefined,
    clockUncertaintyMs:
      typeof value.clockUncertaintyMs === 'number' && Number.isFinite(value.clockUncertaintyMs)
        ? Math.max(0, value.clockUncertaintyMs)
        : undefined,
  };
}

function toRollError(error: unknown, requestId?: string, rollId?: string): RollErrorEvent {
  if (error instanceof RateLimitError) {
    return {
      type: 'roll_error',
      requestId,
      rollId,
      code: 'rate_limited',
      message: error.message,
      retryAfterMs: error.retryAfterMs,
      limit: error.limitName,
    };
  }
  if (error instanceof PolicyRevisionConflictError) {
    return {
      type: 'roll_error',
      requestId,
      code: 'policy_revision_conflict',
      message: error.message,
      currentRevision: error.currentRevision,
    };
  }
  if (error instanceof RevisionConflictError) {
    return {
      type: 'roll_error',
      requestId,
      rollId: error.rollId,
      code: 'revision_conflict',
      message: error.message,
      currentRevision: error.currentRevision,
    };
  }
  if (error instanceof RoomOperationError) {
    return { type: 'roll_error', requestId, rollId, code: error.code, message: error.message };
  }
  return {
    type: 'roll_error',
    requestId,
    rollId,
    code: 'invalid_roll',
    message: asError(error).message,
  };
}

class RoomOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'RoomOperationError';
  }
}

class RateLimitError extends Error {
  constructor(
    readonly limitName: string,
    readonly retryAfterMs: number,
  ) {
    super(
      `Rate limit '${limitName}' exceeded; retry in ${Math.ceil(retryAfterMs / 1_000)} seconds`,
    );
    this.name = 'RateLimitError';
  }
}

class PolicyRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Room policy is at revision ${currentRevision}, not expected revision ${expectedRevision}`,
    );
    this.name = 'PolicyRevisionConflictError';
  }
}

class RevisionConflictError extends Error {
  constructor(
    readonly rollId: string,
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Roll '${rollId}' is at revision ${currentRevision}, not expected revision ${expectedRevision}`,
    );
    this.name = 'RevisionConflictError';
  }
}

class AuthorizationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

function assertRoomPassword(password: string): void {
  if (password.length < ROOM_PASSWORD_MIN_LENGTH || password.length > ROOM_PASSWORD_MAX_LENGTH) {
    throw new RoomOperationError(
      'invalid_room_password',
      `Room passwords must contain ${ROOM_PASSWORD_MIN_LENGTH} to ${ROOM_PASSWORD_MAX_LENGTH} characters`,
      400,
    );
  }
}

/**
 * Copies into a freshly allocated `ArrayBuffer` so Web Crypto receives a `BufferSource`
 * that is provably not backed by a `SharedArrayBuffer`.
 */
function copyToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function deriveRoomPasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: copyToArrayBuffer(salt), iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function roomIdFromUrl(url: URL): string {
  const match = /^\/rooms\/([^/]+)/.exec(url.pathname);
  return match ? decodeURIComponent(match[1]) : 'unknown-room';
}

function clampInteger(value: string | null, min: number, max: number, fallback: number): number {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function parseNonNegativeInteger(value: string | null, fallback: number): number {
  return clampInteger(value, 0, Number.MAX_SAFE_INTEGER, fallback);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  const allowed = new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return allowed.has('*') || allowed.has(origin);
}

function rateLimitedResponse(error: unknown): Response {
  if (error instanceof RateLimitError) {
    return json(
      {
        error: 'rate_limited',
        message: error.message,
        retryAfterMs: error.retryAfterMs,
        limit: error.limitName,
      },
      429,
      { 'retry-after': String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))) },
    );
  }
  if (error instanceof RoomOperationError) {
    return json({ error: error.code, message: error.message }, error.status);
  }
  return json({ error: 'request_failed', message: asError(error).message }, 500);
}

function runtimePayloadByteLength(raw: string | ArrayBuffer): number {
  return typeof raw === 'string' ? new TextEncoder().encode(raw).byteLength : raw.byteLength;
}

function isRoomPolicyPreset(value: string | undefined): value is RoomPolicyPreset {
  return (
    value === 'open-table' || value === 'private-gm-table' || value === 'moderated-public-room'
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function hashClientAddress(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, x-draftroll-room-password',
    'access-control-max-age': '86400',
    vary: 'Origin',
  });

  const origin = request.headers.get('Origin');
  const allowed = new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (origin && (allowed.has('*') || allowed.has(origin))) {
    headers.set('access-control-allow-origin', origin);
  }
  return headers;
}

function json(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((headerValue, key) => headers.set(key, headerValue));
  }
  return new Response(JSON.stringify(value, null, 2), { status, headers });
}

function withHeaders(response: Response, extraHeaders: HeadersInit): Response {
  const headers = new Headers(response.headers);
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const set = new Set(left);
  return right.some((value) => set.has(value));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cleanIdentifier(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length <= 200 ? normalized : null;
}

function cleanName(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : null;
}

function bearerToken(value: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
  return match?.[1] ?? null;
}

/** Type predicate narrowing an untrusted string to a known room permission. */
function isRoomPermission(value: string): value is RoomPermission {
  return (ROOM_PERMISSIONS as ReadonlySet<string>).has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
