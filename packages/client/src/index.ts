/**
 * Realtime room client for synchronized Draftroll sessions.
 *
 * @remarks
 * Connects to a Draftroll room, validates protocol messages, recovers missed events, and exposes synchronized roll operations.
 *
 * @packageDocumentation
 */

import {
  DRAFTROLL_ERROR_CODES,
  DraftrollAbortError,
  DraftrollError,
  raceWithAbort,
  throwIfAborted,
} from '../../errors/src/index';
import {
  connectionRecommendations,
  type DiceRoomConnectionDiagnostic,
  type DiceRoomConnectionState,
} from './diagnostics';
export * from './diagnostics';
import {
  DRAFTROLL_PROTOCOL_VERSION,
  decodeClientToServerEvent,
  decodeParticipantIdentityInput,
  decodeServerToClientEvent,
  parseRuntimeJson,
  type BulkRollUpdatedEvent,
  type BulkRollUpdateItem,
  type ClientToServerEvent,
  type DisplayRollInput,
  type ParticipantIdentityInput,
  type RollInput,
  type RollAuditDetails,
  type RollStartEvent,
  type RollUpdatedEvent,
  type RollUpdateInput,
  type RollVisibility,
  type RollVisibilityUpdatedEvent,
  type RoomPolicy,
  type RoomPolicyPatch,
  type RoomPolicyUpdatedEvent,
  type RoomTokenRevocationTarget,
  type RoomTokenRevokedEvent,
  type RoomParticipant,
  type RoomRollEvent,
  type ServerToClientEvent,
} from '../../protocol/src/index';

/**
 * Configures a realtime room connection, identity, recovery, and request behavior.
 *
 * @public
 */
export interface DiceRoomOptions {
  url: string;
  roomId: string;
  participant?: ParticipantIdentityInput;
  /** Signed room-scoped capability token. Never expose its signing secret to browsers. */
  token?: string;
  /** Optional room password. Sent only inside the encrypted WebSocket session, never in the URL. */
  roomPassword?: string;
  reconnect?: boolean;
  reconnectDelayMs?: number;
  clockSyncSamples?: number;
  requestTimeoutMs?: number;
  lastEventSequence?: number;
  WebSocketImpl?: typeof WebSocket;
  /** Cancels the initial connection and disables reconnect once aborted. */
  signal?: AbortSignal;
  reconnectMaximumDelayMs?: number;
  reconnectBackoffFactor?: number;
  /** Fetch durable missed events from the Worker when the in-memory replay buffer was truncated. */
  longRangeRecovery?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Request latency and outcome metrics collected by a room connection.
 *
 * @public
 */
export interface DiceRoomRequestMetrics {
  requestsStarted: number;
  requestsCompleted: number;
  requestsFailed: number;
  requestsTimedOut: number;
  requestsAborted: number;
  revisionConflicts: number;
  reconnectAttempts: number;
  replayedEvents: number;
  replayTruncations: number;
  longRangeRecoveries: number;
  hiddenProjections: number;
  averageRequestLatencyMs: number;
  maximumRequestLatencyMs: number;
  lastFailureCode?: string;
  lastFailureAt?: string;
}

/**
 * Authoritative roll-start event translated to the client clock.
 *
 * @public
 */
export interface SynchronizedRollStart extends RollStartEvent {
  localStartTimeMs?: number;
  elapsedMs: number;
  /** Elapsed fraction of the advertised animation duration. May exceed 1. */
  animationProgress: number;
}

/**
 * Authoritative roll revision translated to the client clock.
 *
 * @public
 */
export interface SynchronizedRollUpdate extends RollUpdatedEvent {
  localStartTimeMs?: number;
  elapsedMs: number;
  /** Elapsed fraction of the advertised animation duration. May exceed 1. */
  animationProgress: number;
}

/**
 * Authoritative visibility revision translated to the client clock.
 *
 * @public
 */
export interface SynchronizedVisibilityUpdate extends RollVisibilityUpdatedEvent {
  elapsedMs: number;
}

/**
 * Room-policy revision translated to the client clock.
 *
 * @public
 */
export interface SynchronizedRoomPolicyUpdate extends RoomPolicyUpdatedEvent {
  elapsedMs: number;
}

/**
 * Room-token revocation translated to the client clock.
 *
 * @public
 */
export interface SynchronizedRoomTokenRevocation extends RoomTokenRevokedEvent {
  elapsedMs: number;
}

/**
 * Union of supported synchronized room roll events.
 *
 * @public
 */
export type SynchronizedRoomRollEvent =
  | SynchronizedRollStart
  | SynchronizedRollUpdate
  | SynchronizedVisibilityUpdate;

/**
 * Union of supported synchronized room events.
 *
 * @public
 */
export type SynchronizedRoomEvent =
  | SynchronizedRoomRollEvent
  | SynchronizedRoomPolicyUpdate
  | SynchronizedRoomTokenRevocation;

/**
 * Maps realtime room event names to their payloads.
 *
 * @public
 */
export interface DiceRoomEvents {
  open: { roomId: string };
  close: { code: number; reason: string };
  error: { error: Error };
  sessionReady: Extract<ServerToClientEvent, { type: 'session_ready' }>;
  participantJoined: Extract<ServerToClientEvent, { type: 'participant_joined' }>;
  participantUpdated: Extract<ServerToClientEvent, { type: 'participant_updated' }>;
  participantLeft: Extract<ServerToClientEvent, { type: 'participant_left' }>;
  rollStart: SynchronizedRollStart;
  rollUpdate: SynchronizedRollUpdate;
  rollVisibilityUpdate: SynchronizedVisibilityUpdate;
  roomState: Extract<ServerToClientEvent, { type: 'room_state' }>;
  roomPolicyUpdated: SynchronizedRoomPolicyUpdate;
  roomTokenRevoked: SynchronizedRoomTokenRevocation;
  bulkRollUpdate: BulkRollUpdatedEvent;
  rollError: Extract<ServerToClientEvent, { type: 'roll_error' }>;
  clockSync: { offsetMs: number; roundTripMs: number; uncertaintyMs: number };
  connectionState: DiceRoomConnectionDiagnostic;
}

type EventHandler<T> = (event: T) => void;
type PendingRoomEvent = SynchronizedRoomEvent | BulkRollUpdatedEvent;

interface PendingRequest {
  resolve: (event: PendingRoomEvent) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  cleanupAbort?: () => void;
  startedAt: number;
}

/**
 * Maintains a validated, recoverable connection to a Draftroll room.
 *
 * @remarks
 * Incoming messages are runtime-validated before state changes. Reconnect recovery advances the
 * event cursor only after each page has been decoded and applied.
 *
 * @example
 * ```ts
 * import { DiceRoom } from '@draftroll/client';
 *
 * const room = await DiceRoom.connect({
 *   url: 'wss://example.test/rooms',
 *   roomId: 'table-1',
 * });
 * const event = await room.roll({ mode: 'evaluate', expression: '1d20+5' });
 * room.close();
 * ```
 *
 * @public
 */
export class DiceRoom {
  private readonly options: Required<Pick<DiceRoomOptions, 'reconnect' | 'reconnectDelayMs' | 'reconnectMaximumDelayMs' | 'reconnectBackoffFactor' | 'clockSyncSamples' | 'requestTimeoutMs' | 'longRangeRecovery'>> & DiceRoomOptions;
  private readonly handlers = new Map<keyof DiceRoomEvents, Set<EventHandler<never>>>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly participantsBySession = new Map<string, RoomParticipant>();
  private readonly rollEventsById = new Map<string, SynchronizedRoomRollEvent>();
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private closedIntentionally = false;
  private clockOffsetMs = 0;
  private clockRoundTripMs = 0;
  private clockUncertaintyMs = 0;
  private pendingPings = new Map<string, { sentAt: number; resolve: (sample: ClockSample) => void }>();
  private requestCounter = 0;
  private lastEventSequence: number;
  private roomPolicy: RoomPolicy | null = null;
  private roomPolicyRevision = 0;
  private connectionReady: { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> } | null = null;
  private passwordSubmitted = false;
  private tokenSubmitted = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionDiagnostic!: DiceRoomConnectionDiagnostic;
  private readonly metricsState: DiceRoomRequestMetrics = {
    requestsStarted: 0,
    requestsCompleted: 0,
    requestsFailed: 0,
    requestsTimedOut: 0,
    requestsAborted: 0,
    revisionConflicts: 0,
    reconnectAttempts: 0,
    replayedEvents: 0,
    replayTruncations: 0,
    longRangeRecoveries: 0,
    hiddenProjections: 0,
    averageRequestLatencyMs: 0,
    maximumRequestLatencyMs: 0,
  };
  private totalRequestLatencyMs = 0;
  private messageQueue: Promise<void> = Promise.resolve();
  private readonly participantIdentity: Required<Pick<ParticipantIdentityInput, 'participantId' | 'sessionId' | 'name'>> & ParticipantIdentityInput;

  private constructor(options: DiceRoomOptions) {
    const decodedParticipant = decodeParticipantIdentityInput(options.participant ?? {});
    if (!decodedParticipant.success) throw new DiceRoomProtocolError(decodedParticipant.error.message, decodedParticipant.error.issues);
    const participant = decodedParticipant.data;
    const participantId = participant.participantId ?? createId('participant');
    const sessionId = participant.sessionId ?? createId('session');
    this.participantIdentity = {
      ...participant,
      participantId,
      sessionId,
      name: participant.name?.trim() || 'Anonymous',
    };
    this.lastEventSequence = Math.max(0, options.lastEventSequence ?? 0);
    this.options = {
      ...options,
      reconnect: options.reconnect ?? true,
      reconnectDelayMs: options.reconnectDelayMs ?? 1_000,
      reconnectMaximumDelayMs: options.reconnectMaximumDelayMs ?? 30_000,
      reconnectBackoffFactor: options.reconnectBackoffFactor ?? 1.8,
      clockSyncSamples: options.clockSyncSamples ?? 5,
      requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
      longRangeRecovery: options.longRangeRecovery ?? true,
    };
    this.connectionDiagnostic = this.createConnectionDiagnostic('idle', { recoverable: true });
  }

  /**
   * Creates and opens a validated realtime room connection.
   */
  static async connect(options: DiceRoomOptions): Promise<DiceRoom> {
    const room = new DiceRoom(options);
    await room.connect(options.signal);
    return room;
  }

  /**
   * Subscribes to a room event and returns an unsubscribe function.
   */
  on<K extends keyof DiceRoomEvents>(event: K, handler: EventHandler<DiceRoomEvents[K]>): () => void {
    const set = this.handlers.get(event) ?? new Set<EventHandler<never>>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  /**
   * Creates and opens a validated realtime room connection.
   */
  async connect(signal: AbortSignal | undefined = this.options.signal): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return raceWithAbort(this.connecting, signal, 'Dice room connection');
    throwIfAborted(signal, 'Dice room connection');
    this.closedIntentionally = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const state: DiceRoomConnectionState = this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting';
    this.transitionConnection(state, { recoverable: true });
    this.connecting = this.openSocket(signal).then(() => {
      this.reconnectAttempt = 0;
    }).catch((error) => {
      if (error instanceof DraftrollAbortError) {
        this.closedIntentionally = true;
        this.transitionConnection('closed', { code: error.code, reason: error.message, recoverable: true });
      } else {
        const normalized = asError(error);
        this.transitionConnection('failed', {
          code: error instanceof DraftrollError ? error.code : DRAFTROLL_ERROR_CODES.roomConnectionFailed,
          reason: normalized.message,
          recoverable: this.options.reconnect,
        });
      }
      throw error;
    }).finally(() => { this.connecting = null; });
    return raceWithAbort(this.connecting, signal, 'Dice room connection', () => {
      this.closedIntentionally = true;
      this.socket?.close(1000, 'Connection aborted');
    });
  }

  /**
   * Closes the connection and rejects outstanding requests.
   */
  close(code = 1000, reason = 'Client closed room'): void {
    this.closedIntentionally = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(code, reason);
    this.socket = null;
    this.rejectPending(new DiceRoomConnectionError(DRAFTROLL_ERROR_CODES.roomConnectionClosed, 'Dice room was closed', true));
    this.transitionConnection('closed', { code: DRAFTROLL_ERROR_CODES.roomConnectionClosed, reason, recoverable: true, closeCode: code });
  }

  /**
   * Current room identifier.
   */
  get roomId(): string {
    return this.options.roomId;
  }

  /**
   * Current authenticated participant, when ready.
   */
  get participant(): ParticipantIdentityInput & { participantId: string; sessionId: string; name: string } {
    return { ...this.participantIdentity };
  }

  /**
   * Snapshot of participants currently known to the client.
   */
  get participants(): readonly RoomParticipant[] {
    return [...this.participantsBySession.values()];
  }

  /**
   * Snapshot of synchronized roll events retained by the client.
   */
  get rollEvents(): readonly SynchronizedRoomRollEvent[] {
    return [...this.rollEventsById.values()];
  }

  /**
   * Current room policy snapshot.
   */
  get policy(): RoomPolicy | null {
    return this.roomPolicy ? structuredClone(this.roomPolicy) : null;
  }

  /**
   * Revision number associated with the current room policy.
   */
  get policyRevision(): number {
    return this.roomPolicyRevision;
  }

  /**
   * Returns the highest room-event sequence applied by the client.
   */
  getLastEventSequence(): number {
    return this.lastEventSequence;
  }

  /**
   * Returns current connection state and recovery guidance.
   */
  get connectionDiagnostics(): DiceRoomConnectionDiagnostic {
    return { ...this.connectionDiagnostic, recommendations: [...this.connectionDiagnostic.recommendations] };
  }

  /**
   * Adds room authentication data to a same-origin HTTP URL.
   */
  authorizeHttpUrl(input: string | URL): URL {
    const url = new URL(input.toString());
    url.searchParams.set('protocolVersion', String(DRAFTROLL_PROTOCOL_VERSION));
    url.searchParams.set('participantId', this.participantIdentity.participantId);
    url.searchParams.set('sessionId', this.participantIdentity.sessionId);
    url.searchParams.set('name', this.participantIdentity.name);
    return url;
  }

  /** Creates an authorized HTTP request. Secrets are carried in headers, never query strings. */
  authorizeHttpRequest(input: string | URL, init: RequestInit = {}): Request {
    const headers = new Headers(init.headers);
    if (this.options.token) headers.set('Authorization', `Bearer ${this.options.token}`);
    if (this.options.roomPassword) headers.set('X-Draftroll-Room-Password', this.options.roomPassword);
    return new Request(this.authorizeHttpUrl(input), { ...init, headers });
  }

  /**
   * Requests an authoritative room roll and resolves with its synchronized event.
   */
  async roll(
    input: string | RollInput,
    options: { visibility?: RollVisibility; clientRollId?: string; signal?: AbortSignal } = {},
  ): Promise<SynchronizedRollStart> {
    const normalized: RollInput = typeof input === 'string' ? { mode: 'evaluate', expression: input } : input;
    const requestId = this.nextRequestId();
    const event = await this.dispatchRequest(requestId, {
      type: 'roll_request',
      requestId,
      clientRollId: options.clientRollId,
      input: normalized,
      visibility: options.visibility,
    }, options.signal);
    if (event.type !== 'roll_start') throw new Error(`Expected roll_start for ${requestId}`);
    return event;
  }

  /**
   * Publishes an externally evaluated roll to the room.
   */
  async displayRoll(
    input: Omit<DisplayRollInput, 'mode'> | DisplayRollInput,
    options: { visibility?: RollVisibility; clientRollId?: string; signal?: AbortSignal } = {},
  ): Promise<SynchronizedRollStart> {
    const requestId = this.nextRequestId();
    const event = await this.dispatchRequest(requestId, {
      type: 'display_roll',
      requestId,
      clientRollId: options.clientRollId,
      input: { ...input, mode: 'display' },
      visibility: options.visibility,
    }, options.signal);
    if (event.type !== 'roll_start') throw new Error(`Expected roll_start for ${requestId}`);
    return event;
  }

  /**
   * Applies one authoritative revision to an existing room roll.
   */
  async updateRoll(
    rollId: string,
    update: RollUpdateInput,
    options: {
      reroll?: boolean | string[];
      animate?: boolean;
      expectedRevision?: number;
      signal?: AbortSignal;
      audit?: RollAuditDetails;
    } = {},
  ): Promise<SynchronizedRollUpdate> {
    const requestId = this.nextRequestId();
    const event = await this.dispatchRequest(requestId, {
      type: 'update_roll',
      requestId,
      rollId,
      update,
      expectedRevision: options.expectedRevision,
      reroll: options.reroll,
      animate: options.animate ?? false,
      audit: options.audit,
    }, options.signal);
    if (event.type !== 'roll_updated') throw new Error(`Expected roll_updated for ${requestId}`);
    return event;
  }

  /**
   * Applies a validated batch of room-roll revisions atomically.
   */
  async bulkUpdateRolls(
    updates: readonly BulkRollUpdateItem[],
    options: { signal?: AbortSignal } = {},
  ): Promise<BulkRollUpdatedEvent> {
    const requestId = this.nextRequestId();
    const event = await this.dispatchRequest(requestId, {
      type: 'bulk_update_rolls',
      requestId,
      updates: updates.map((update) => ({ ...update })),
    }, options.signal);
    if (event.type !== 'bulk_rolls_updated') {
      throw new DiceRoomProtocolError(`Expected bulk_rolls_updated for ${requestId}`);
    }
    return event;
  }

  /**
   * Changes the visibility policy for an existing roll.
   */
  async setRollVisibility(
    rollId: string,
    visibility: RollVisibility,
    options: { expectedRevision?: number; signal?: AbortSignal; audit?: RollAuditDetails } = {},
  ): Promise<SynchronizedVisibilityUpdate> {
    const requestId = this.nextRequestId();
    const event = await this.dispatchRequest(requestId, {
      type: 'set_roll_visibility',
      requestId,
      rollId,
      visibility,
      expectedRevision: options.expectedRevision,
      audit: options.audit,
    }, options.signal);
    if (event.type !== 'roll_visibility_updated') {
      throw new Error(`Expected roll_visibility_updated for ${requestId}`);
    }
    return event;
  }

  /**
   * Makes an existing roll public.
   */
  revealRoll(rollId: string, options: { expectedRevision?: number; signal?: AbortSignal; audit?: RollAuditDetails } = {}): Promise<SynchronizedVisibilityUpdate> {
    return this.setRollVisibility(rollId, { type: 'public' }, options);
  }

  /**
   * Creates, changes, or removes the room password.
   */
  async setPassword(
    password: string | null,
    options: { expectedRevision?: number; signal?: AbortSignal } = {},
  ): Promise<SynchronizedRoomPolicyUpdate> {
    const requestId = this.nextRequestId();
    const event = await this.dispatchRequest(requestId, {
      type: 'set_room_password',
      requestId,
      password,
      expectedRevision: options.expectedRevision ?? this.roomPolicyRevision,
    }, options.signal);
    if (event.type !== 'room_policy_updated') throw new Error(`Expected room_policy_updated for ${requestId}`);
    return event;
  }

  /**
   * Applies a partial room-policy update.
   */
  async setPolicy(
    policy: RoomPolicyPatch,
    options: { expectedRevision?: number; signal?: AbortSignal } = {},
  ): Promise<SynchronizedRoomPolicyUpdate> {
    const requestId = this.nextRequestId();
    const event = await this.dispatchRequest(requestId, {
      type: 'set_room_policy',
      requestId,
      policy,
      expectedRevision: options.expectedRevision ?? this.roomPolicyRevision,
    }, options.signal);
    if (event.type !== 'room_policy_updated') throw new Error(`Expected room_policy_updated for ${requestId}`);
    return event;
  }

  /**
   * Revokes a room capability token or participant token set.
   */
  async revokeToken(
    target: RoomTokenRevocationTarget,
    options: { reason?: string; signal?: AbortSignal } = {},
  ): Promise<SynchronizedRoomTokenRevocation> {
    const requestId = this.nextRequestId();
    const event = await this.dispatchRequest(requestId, {
      type: 'revoke_room_token',
      requestId,
      target,
      reason: options.reason,
    }, options.signal);
    if (event.type !== 'room_token_revoked') throw new Error(`Expected room_token_revoked for ${requestId}`);
    return event;
  }

  /**
   * Updates the current participant profile.
   */
  updateParticipant(update: { name?: string; metadata?: Record<string, unknown> }): void {
    if (update.name?.trim()) this.participantIdentity.name = update.name.trim();
    if (update.metadata !== undefined) this.participantIdentity.metadata = update.metadata;
    this.send({ type: 'participant_update', ...update });
  }

  /**
   * Reports renderer readiness to the room.
   */
  markReady(rendererReady = true, themesReady = true): void {
    this.send({
      type: 'client_ready',
      rendererReady,
      themesReady,
      roundTripMs: this.clockRoundTripMs,
      clockUncertaintyMs: this.clockUncertaintyMs,
    });
  }

  /**
   * Returns the estimated server-to-client clock offset.
   */
  getClockOffsetMs(): number {
    return this.clockOffsetMs;
  }

  /**
   * Estimates current server time from the synchronized clock.
   */
  estimatedServerTimeMs(): number {
    return Date.now() + this.clockOffsetMs;
  }

  /**
   * Returns request latency and outcome metrics.
   */
  getRequestMetrics(): Readonly<DiceRoomRequestMetrics> {
    return { ...this.metricsState };
  }

  /**
   * Returns clock synchronization quality diagnostics.
   */
  getClockDiagnostics(): { offsetMs: number; roundTripMs: number; uncertaintyMs: number } {
    return {
      offsetMs: this.clockOffsetMs,
      roundTripMs: this.clockRoundTripMs,
      uncertaintyMs: this.clockUncertaintyMs,
    };
  }

  private async openSocket(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal, 'Dice room connection');
    const WebSocketClass = this.options.WebSocketImpl ?? WebSocket;
    const url = new URL(this.options.url);
    url.searchParams.set('roomId', this.options.roomId);
    url.searchParams.set('protocolVersion', String(DRAFTROLL_PROTOCOL_VERSION));
    url.searchParams.set('participantId', this.participantIdentity.participantId);
    url.searchParams.set('sessionId', this.participantIdentity.sessionId);
    url.searchParams.set('name', this.participantIdentity.name);
    url.searchParams.set('lastEventSequence', String(this.lastEventSequence));
    if (this.options.token) url.searchParams.set('authMode', 'token');
    if (this.participantIdentity.metadata) {
      url.searchParams.set('participantMetadata', JSON.stringify(this.participantIdentity.metadata));
    }
    const socket = new WebSocketClass(url.toString());
    const abortSocket = () => socket.close(1000, 'Connection aborted');
    signal?.addEventListener('abort', abortSocket, { once: true });
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      this.messageQueue = this.messageQueue
        .then(() => this.handleMessage(event.data))
        .catch((error) => this.emit('error', { error: asError(error) }));
    });
    socket.addEventListener('close', (event) => this.handleClose(event.code, event.reason));
    socket.addEventListener('error', () => this.emit('error', { error: new Error('WebSocket error') }));

    this.transitionConnection('authenticating', { recoverable: true });
    const sessionReady = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.connectionReady) this.connectionReady = null;
        reject(new Error('Dice room authentication timed out'));
      }, this.options.requestTimeoutMs);
      this.connectionReady = { resolve, reject, timeout };
    });

    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('WebSocket connection failed'));
      };
      const cleanup = () => {
        socket.removeEventListener('open', handleOpen);
        socket.removeEventListener('error', handleError);
      };
      socket.addEventListener('open', handleOpen);
      socket.addEventListener('error', handleError);
    });

    await raceWithAbort(sessionReady, signal, 'Dice room authentication', abortSocket);
    this.transitionConnection('synchronizing', { recoverable: true });
    this.emit('open', { roomId: this.options.roomId });
    await this.synchronizeClock(signal);
    // Raw/headless clients still report timing quality. Renderer-aware facades may
    // call markReady again after their visual resources are prepared.
    this.markReady(false, false);
    signal?.removeEventListener('abort', abortSocket);
    this.transitionConnection('open', { recoverable: true });
  }

  private async synchronizeClock(signal?: AbortSignal): Promise<void> {
    const samples: ClockSample[] = [];
    for (let index = 0; index < this.options.clockSyncSamples; index += 1) {
      samples.push(await this.sendClockPing(signal));
    }
    samples.sort((left, right) => left.roundTripMs - right.roundTripMs);
    const best = samples.slice(0, Math.max(1, Math.ceil(samples.length / 2)));
    this.clockOffsetMs = best.reduce((sum, sample) => sum + sample.offsetMs, 0) / best.length;
    this.clockRoundTripMs = best.reduce((sum, sample) => sum + sample.roundTripMs, 0) / best.length;
    const offsetJitter = best.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample.offsetMs - this.clockOffsetMs)), 0);
    this.clockUncertaintyMs = Math.max(this.clockRoundTripMs / 2, offsetJitter);
    this.emit('clockSync', {
      offsetMs: this.clockOffsetMs,
      roundTripMs: this.clockRoundTripMs,
      uncertaintyMs: this.clockUncertaintyMs,
    });
  }

  private sendClockPing(signal?: AbortSignal): Promise<ClockSample> {
    throwIfAborted(signal, 'Clock synchronization');
    const nonce = createId('clock');
    const clientTimeMs = Date.now();
    return new Promise<ClockSample>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', handleAbort);
      const handleAbort = () => {
        clearTimeout(timeout);
        this.pendingPings.delete(nonce);
        cleanup();
        reject(new DraftrollAbortError('Clock synchronization', signal?.reason));
      };
      const timeout = setTimeout(() => {
        this.pendingPings.delete(nonce);
        cleanup();
        reject(new DiceRoomConnectionError(DRAFTROLL_ERROR_CODES.roomRequestTimeout, 'Clock synchronization timed out', true));
      }, 3_000);
      signal?.addEventListener('abort', handleAbort, { once: true });
      this.pendingPings.set(nonce, {
        sentAt: clientTimeMs,
        resolve: (sample) => {
          clearTimeout(timeout);
          cleanup();
          resolve(sample);
        },
      });
      this.send({ type: 'clock_sync_ping', clientTimeMs, nonce });
    });
  }

  private async handleMessage(raw: unknown): Promise<void> {
    if (!(typeof raw === 'string' || raw instanceof ArrayBuffer || ArrayBuffer.isView(raw))) {
      this.emit('error', { error: new DiceRoomProtocolError('Received unsupported WebSocket payload type') });
      return;
    }
    const parsed = parseRuntimeJson(raw, { maximumBytes: 512 * 1024 });
    if (!parsed.success) {
      this.emit('error', { error: new DiceRoomProtocolError(parsed.error.message, parsed.error.issues) });
      return;
    }
    const decoded = decodeServerToClientEvent(parsed.data, { rejectUnknownFields: true, allowLegacyResults: true });
    if (!decoded.success) {
      this.emit('error', { error: new DiceRoomProtocolError(decoded.error.message, decoded.error.issues) });
      return;
    }
    const event = decoded.data;

    if (event.type === 'clock_sync_pong') {
      const pending = this.pendingPings.get(event.nonce);
      if (!pending) return;
      this.pendingPings.delete(event.nonce);
      const receivedAt = Date.now();
      const roundTripMs = receivedAt - pending.sentAt;
      const midpoint = pending.sentAt + roundTripMs / 2;
      pending.resolve({ roundTripMs, offsetMs: event.serverTimeMs - midpoint });
      return;
    }

    if (event.type === 'session_ready') {
      this.participantsBySession.set(event.participant.sessionId, event.participant);
      if (this.connectionReady) {
        clearTimeout(this.connectionReady.timeout);
        this.connectionReady.resolve();
        this.connectionReady = null;
      }
      this.passwordSubmitted = false;
      this.tokenSubmitted = false;
      this.emit('sessionReady', event);
      return;
    }

    if (event.type === 'participant_joined') {
      this.participantsBySession.set(event.participant.sessionId, event.participant);
      this.emit('participantJoined', event);
      return;
    }
    if (event.type === 'participant_updated') {
      this.participantsBySession.set(event.participant.sessionId, event.participant);
      this.emit('participantUpdated', event);
      return;
    }
    if (event.type === 'participant_left') {
      this.participantsBySession.delete(event.sessionId);
      this.emit('participantLeft', event);
      return;
    }

    if (event.type === 'room_state') {
      if (event.missedEventsTruncated) {
        this.metricsState.replayTruncations += 1;
        await this.recoverLongRangeEvents(this.lastEventSequence);
      }
      this.participantsBySession.clear();
      event.participants.forEach((participant) => this.participantsBySession.set(participant.sessionId, participant));
      this.roomPolicy = event.policy;
      this.roomPolicyRevision = event.policyRevision;
      this.emit('roomState', event);
      this.metricsState.replayedEvents += event.recentEvents.length;
      for (const replayed of event.recentEvents.toSorted((left, right) => left.eventSequence - right.eventSequence)) {
        if (replayed.type === 'room_policy_updated') {
          this.processRoomPolicyEvent({ ...replayed, replayed: true, elapsedMs: 0 });
        } else if (replayed.type === 'room_token_revoked') {
          this.processRoomTokenRevocation({ ...replayed, replayed: true, elapsedMs: 0 });
        } else {
          this.processRoomRollEvent({ ...replayed, replayed: true });
        }
      }
      this.lastEventSequence = Math.max(this.lastEventSequence, event.latestEventSequence);
      return;
    }

    if (event.type === 'roll_error') {
      if (event.code === 'token_required' && this.connectionReady) {
        if (this.options.token && !this.tokenSubmitted) {
          this.tokenSubmitted = true;
          this.send({ type: 'authenticate_room_token', token: this.options.token });
          return;
        }
        const error = new DiceRoomTokenRequiredError(event.message);
        clearTimeout(this.connectionReady.timeout);
        this.connectionReady.reject(error);
        this.connectionReady = null;
        this.closedIntentionally = true;
        this.socket?.close(4002, 'Room capability token required');
        return;
      }
      if (isTokenAuthenticationError(event.code) && this.connectionReady) {
        const error = new DiceRoomTokenError(event.code, event.message);
        clearTimeout(this.connectionReady.timeout);
        this.connectionReady.reject(error);
        this.connectionReady = null;
        this.closedIntentionally = true;
        this.socket?.close(4002, 'Invalid room capability token');
        return;
      }
      if (event.code === 'room_password_required' && this.connectionReady) {
        if (this.options.roomPassword && !this.passwordSubmitted) {
          this.passwordSubmitted = true;
          this.send({ type: 'authenticate_room_password', password: this.options.roomPassword });
          return;
        }
        const error = new DiceRoomPasswordRequiredError(event.message);
        clearTimeout(this.connectionReady.timeout);
        this.connectionReady.reject(error);
        this.connectionReady = null;
        this.closedIntentionally = true;
        this.socket?.close(4001, 'Room password required');
        return;
      }
      if (event.code === 'invalid_room_password' && this.connectionReady) {
        const error = new DiceRoomPasswordError(event.message);
        clearTimeout(this.connectionReady.timeout);
        this.connectionReady.reject(error);
        this.connectionReady = null;
        this.closedIntentionally = true;
        this.socket?.close(4003, 'Invalid room password');
        return;
      }
      const pending = event.requestId ? this.pendingRequests.get(event.requestId) : undefined;
      if (pending && event.requestId) {
        clearTimeout(pending.timeout);
        pending.cleanupAbort?.();
        this.pendingRequests.delete(event.requestId);
        this.recordRequestFailure(pending, event.code);
        pending.reject(new DiceRoomRequestError(event));
      }
      this.emit('rollError', event);
      return;
    }

    if (event.type === 'bulk_rolls_updated') {
      this.processBulkRollUpdate(event);
      return;
    }

    if (event.type === 'room_policy_updated') {
      this.processRoomPolicyEvent({ ...event, elapsedMs: 0 });
      return;
    }
    if (event.type === 'room_token_revoked') {
      this.processRoomTokenRevocation({ ...event, elapsedMs: 0 });
      return;
    }

    this.processRoomRollEvent(event);
  }

  private processBulkRollUpdate(event: BulkRollUpdatedEvent): void {
    const pending = this.pendingRequests.get(event.requestId);
    if (event.eventSequence <= this.lastEventSequence && !pending) return;
    this.lastEventSequence = Math.max(this.lastEventSequence, event.eventSequence);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.cleanupAbort?.();
      this.pendingRequests.delete(event.requestId);
      this.recordRequestSuccess(pending);
      pending.resolve(event);
    }
    this.emit('bulkRollUpdate', event);
  }

  private processRoomPolicyEvent(event: SynchronizedRoomPolicyUpdate): void {
    const hasPendingRequest = Boolean(event.requestId && this.pendingRequests.has(event.requestId));
    if (event.eventSequence <= this.lastEventSequence && !hasPendingRequest) return;
    this.lastEventSequence = Math.max(this.lastEventSequence, event.eventSequence);
    this.roomPolicy = event.policy;
    this.roomPolicyRevision = event.revision;
    const pending = event.requestId ? this.pendingRequests.get(event.requestId) : undefined;
    if (pending && event.requestId) {
      clearTimeout(pending.timeout);
      pending.cleanupAbort?.();
      this.pendingRequests.delete(event.requestId);
      this.recordRequestSuccess(pending);
      pending.resolve(event);
    }
    this.emit('roomPolicyUpdated', event);
  }

  private processRoomTokenRevocation(event: SynchronizedRoomTokenRevocation): void {
    const hasPendingRequest = Boolean(event.requestId && this.pendingRequests.has(event.requestId));
    if (event.eventSequence <= this.lastEventSequence && !hasPendingRequest) return;
    this.lastEventSequence = Math.max(this.lastEventSequence, event.eventSequence);
    const pending = event.requestId ? this.pendingRequests.get(event.requestId) : undefined;
    if (pending && event.requestId) {
      clearTimeout(pending.timeout);
      pending.cleanupAbort?.();
      this.pendingRequests.delete(event.requestId);
      this.recordRequestSuccess(pending);
      pending.resolve(event);
    }
    this.emit('roomTokenRevoked', event);
  }

  private processRoomRollEvent(event: RoomRollEvent): void {
    const hasPendingRequest = Boolean(event.requestId && this.pendingRequests.has(event.requestId));
    if (event.eventSequence <= this.lastEventSequence && !hasPendingRequest) return;
    this.lastEventSequence = Math.max(this.lastEventSequence, event.eventSequence);
    const synchronized = synchronizeRoomEvent(event, this.clockOffsetMs);
    this.rollEventsById.set(event.rollId, synchronized);
    if (event.hidden) this.metricsState.hiddenProjections += 1;

    const pending = event.requestId ? this.pendingRequests.get(event.requestId) : undefined;
    if (pending && event.requestId) {
      clearTimeout(pending.timeout);
      pending.cleanupAbort?.();
      this.pendingRequests.delete(event.requestId);
      this.recordRequestSuccess(pending);
      pending.resolve(synchronized);
    }

    if (synchronized.type === 'roll_start') this.emit('rollStart', synchronized);
    else if (synchronized.type === 'roll_updated') this.emit('rollUpdate', synchronized);
    else this.emit('rollVisibilityUpdate', synchronized);
  }

  private handleClose(code: number, reason: string): void {
    this.socket = null;
    const message = `Dice room connection closed (${code}${reason ? `: ${reason}` : ''})`;
    const error = new DiceRoomConnectionError(DRAFTROLL_ERROR_CODES.roomConnectionClosed, message, !this.closedIntentionally && this.options.reconnect, { closeCode: code });
    if (this.connectionReady) {
      clearTimeout(this.connectionReady.timeout);
      this.connectionReady.reject(error);
      this.connectionReady = null;
    }
    this.emit('close', { code, reason });
    this.rejectPending(error);
    if (!this.closedIntentionally && this.options.reconnect && !this.options.signal?.aborted) {
      this.reconnectAttempt += 1;
      this.metricsState.reconnectAttempts += 1;
      const delay = Math.min(
        this.options.reconnectMaximumDelayMs,
        Math.round(this.options.reconnectDelayMs * this.options.reconnectBackoffFactor ** Math.max(0, this.reconnectAttempt - 1)),
      );
      this.transitionConnection('reconnecting', {
        code: error.code,
        reason: message,
        recoverable: true,
        retryAfterMs: delay,
        closeCode: code,
      });
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.connect(this.options.signal).catch((connectError) => this.emit('error', { error: asError(connectError) }));
      }, delay);
      return;
    }
    this.transitionConnection(this.closedIntentionally ? 'closed' : 'failed', {
      code: error.code,
      reason: message,
      recoverable: false,
      closeCode: code,
    });
  }

  private send(event: ClientToServerEvent): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new DiceRoomConnectionError(DRAFTROLL_ERROR_CODES.roomNotConnected, 'Dice room is not connected', true);
    const decoded = decodeClientToServerEvent(event, { rejectUnknownFields: true });
    if (!decoded.success) throw new DiceRoomProtocolError(decoded.error.message, decoded.error.issues);
    const payload = JSON.stringify(decoded.data);
    const bytes = new TextEncoder().encode(payload).byteLength;
    if (bytes > 64 * 1024) {
      throw new DiceRoomProtocolError(`Client room command exceeds 65536 bytes (${bytes})`);
    }
    this.socket.send(payload);
  }

  private dispatchRequest(requestId: string, event: ClientToServerEvent, signal?: AbortSignal): Promise<PendingRoomEvent> {
    const pending = this.waitForRequest(requestId, signal);
    try {
      this.send(event);
    } catch (error) {
      const request = this.pendingRequests.get(requestId);
      if (request) {
        clearTimeout(request.timeout);
        request.cleanupAbort?.();
        this.pendingRequests.delete(requestId);
        this.recordRequestFailure(request, error instanceof DraftrollError ? error.code : DRAFTROLL_ERROR_CODES.roomNotConnected);
      }
      throw error;
    }
    return pending;
  }

  private waitForRequest(requestId: string, signal?: AbortSignal): Promise<PendingRoomEvent> {
    throwIfAborted(signal, `Room request '${requestId}'`);
    this.metricsState.requestsStarted += 1;
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const cleanupAbort = () => signal?.removeEventListener('abort', handleAbort);
      const handleAbort = () => {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        cleanupAbort();
        this.metricsState.requestsAborted += 1;
        this.recordRequestFailure({ startedAt }, DRAFTROLL_ERROR_CODES.aborted, false);
        reject(new DraftrollAbortError(`Room request '${requestId}'`, signal?.reason));
      };
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        cleanupAbort();
        this.metricsState.requestsTimedOut += 1;
        this.recordRequestFailure({ startedAt }, DRAFTROLL_ERROR_CODES.roomRequestTimeout, false);
        reject(new DiceRoomConnectionError(DRAFTROLL_ERROR_CODES.roomRequestTimeout, `Room request '${requestId}' timed out`, true));
      }, this.options.requestTimeoutMs);
      signal?.addEventListener('abort', handleAbort, { once: true });
      this.pendingRequests.set(requestId, { resolve, reject, timeout, cleanupAbort, startedAt });
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.cleanupAbort?.();
      this.recordRequestFailure(pending, error instanceof DraftrollError ? error.code : DRAFTROLL_ERROR_CODES.roomConnectionClosed);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private recordRequestSuccess(pending: Pick<PendingRequest, 'startedAt'>): void {
    const latency = Math.max(0, Date.now() - pending.startedAt);
    this.metricsState.requestsCompleted += 1;
    this.totalRequestLatencyMs += latency;
    this.metricsState.averageRequestLatencyMs = this.totalRequestLatencyMs / this.metricsState.requestsCompleted;
    this.metricsState.maximumRequestLatencyMs = Math.max(this.metricsState.maximumRequestLatencyMs, latency);
  }

  private recordRequestFailure(
    pending: Pick<PendingRequest, 'startedAt'>,
    code: string,
    incrementFailed = true,
  ): void {
    if (incrementFailed) this.metricsState.requestsFailed += 1;
    if (code === DRAFTROLL_ERROR_CODES.revisionConflict) this.metricsState.revisionConflicts += 1;
    this.metricsState.lastFailureCode = code;
    this.metricsState.lastFailureAt = new Date().toISOString();
    const latency = Math.max(0, Date.now() - pending.startedAt);
    this.metricsState.maximumRequestLatencyMs = Math.max(this.metricsState.maximumRequestLatencyMs, latency);
  }

  private async recoverLongRangeEvents(afterEventSequence: number): Promise<void> {
    if (!this.options.longRangeRecovery) return;
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) return;
    let cursor = Math.max(0, afterEventSequence);
    let recoveredCount = 0;
    let pages = 0;
    let complete = false;
    const maximumPages = 10_000;
    const pageLimit = 1_000;

    while (pages < maximumPages) {
      pages += 1;
      const url = new URL(this.options.url);
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      url.pathname = `/rooms/${encodeURIComponent(this.options.roomId)}/events`;
      url.search = '';
      url.searchParams.set('protocolVersion', String(DRAFTROLL_PROTOCOL_VERSION));
      url.searchParams.set('participantId', this.participantIdentity.participantId);
      url.searchParams.set('sessionId', this.participantIdentity.sessionId);
      url.searchParams.set('name', this.participantIdentity.name);
      url.searchParams.set('afterEventSequence', String(cursor));
      url.searchParams.set('limit', String(pageLimit));
      const headers: Record<string, string> = {};
      if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`;
      if (this.options.roomPassword) headers['X-Draftroll-Room-Password'] = this.options.roomPassword;
      const response = await fetchImpl(url, { headers });
      if (!response.ok) throw new DiceRoomConnectionError('long_range_recovery_failed', `Long-range room recovery failed with HTTP ${response.status}`, true);
      const payload = await response.json() as {
        events?: unknown[];
        nextAfterEventSequence?: number;
        latestEventSequence?: number;
        hasMore?: boolean;
      };
      for (const rawEvent of payload.events ?? []) {
        const decoded = decodeServerToClientEvent(rawEvent, { rejectUnknownFields: true, allowLegacyResults: true });
        if (!decoded.success) throw new DiceRoomProtocolError(decoded.error.message, decoded.error.issues);
        const recovered = decoded.data;
        if (recovered.type === 'roll_start' || recovered.type === 'roll_updated' || recovered.type === 'roll_visibility_updated') {
          this.processRoomRollEvent({ ...recovered, replayed: true });
          recoveredCount += 1;
        } else if (recovered.type === 'room_policy_updated') {
          this.processRoomPolicyEvent({ ...recovered, replayed: true, elapsedMs: 0 });
          recoveredCount += 1;
        } else if (recovered.type === 'room_token_revoked') {
          this.processRoomTokenRevocation({ ...recovered, replayed: true, elapsedMs: 0 });
          recoveredCount += 1;
        }
      }
      const events = payload.events ?? [];
      const nextCursor = isSafeInteger(payload.nextAfterEventSequence)
        ? Math.max(cursor, payload.nextAfterEventSequence)
        : Math.max(cursor, ...events.map((event) => {
            const sequence: unknown = isRecord(event) ? event.eventSequence : undefined;
            return isSafeInteger(sequence) ? sequence : cursor;
          }));
      const latestMetadata = isSafeInteger(payload.latestEventSequence) ? payload.latestEventSequence : undefined;
      const hasLatestMetadata = latestMetadata !== undefined;
      const latest = latestMetadata ?? nextCursor;
      // Older compatible endpoints may not include pagination metadata. In that
      // case, a full page means there may be another page; one final empty page
      // safely confirms completion without advancing past unprocessed events.
      const hasMore = typeof payload.hasMore === 'boolean'
        ? payload.hasMore
        : hasLatestMetadata
          ? nextCursor < latest
          : events.length >= pageLimit;
      if (!hasMore || (hasLatestMetadata && nextCursor >= latest)) {
        complete = true;
        break;
      }
      if (nextCursor <= cursor) {
        throw new DiceRoomConnectionError('long_range_recovery_stalled', `Long-range recovery made no progress after event ${cursor}`, true);
      }
      cursor = nextCursor;
    }
    if (!complete && pages >= maximumPages) {
      throw new DiceRoomConnectionError('long_range_recovery_limit', `Long-range recovery exceeded ${maximumPages} pages`, true);
    }
    this.metricsState.replayedEvents += recoveredCount;
    this.metricsState.longRangeRecoveries += 1;
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `request_${Date.now().toString(36)}_${this.requestCounter.toString(36)}`;
  }

  private createConnectionDiagnostic(
    state: DiceRoomConnectionState,
    details: {
      code?: string;
      reason?: string;
      recoverable: boolean;
      retryAfterMs?: number;
      closeCode?: number;
    },
  ): DiceRoomConnectionDiagnostic {
    return {
      state,
      attempt: this.reconnectAttempt,
      changedAt: new Date().toISOString(),
      roomId: this.options.roomId,
      code: details.code,
      reason: details.reason,
      recoverable: details.recoverable,
      retryAfterMs: details.retryAfterMs,
      closeCode: details.closeCode,
      lastEventSequence: this.lastEventSequence,
      roundTripMs: this.clockRoundTripMs || undefined,
      clockUncertaintyMs: this.clockUncertaintyMs || undefined,
      recommendations: connectionRecommendations({
        code: details.code,
        closeCode: details.closeCode,
        retryAfterMs: details.retryAfterMs,
        reconnectEnabled: this.options.reconnect,
      }),
    };
  }

  private transitionConnection(
    state: DiceRoomConnectionState,
    details: {
      code?: string;
      reason?: string;
      recoverable: boolean;
      retryAfterMs?: number;
      closeCode?: number;
    },
  ): void {
    this.connectionDiagnostic = this.createConnectionDiagnostic(state, details);
    this.emit('connectionState', this.connectionDiagnostics);
  }

  private emit<K extends keyof DiceRoomEvents>(event: K, payload: DiceRoomEvents[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        (handler as EventHandler<DiceRoomEvents[K]>)(payload);
      } catch {
        // Observer failures cannot corrupt transport state or request correlation.
      }
    }
  }
}

/**
 * Error raised for dice room connection failures.
 *
 * @public
 */
export class DiceRoomConnectionError extends DraftrollError {
  /**
   * Creates a DiceRoomConnectionError instance.
   */
  constructor(
    code: string,
    message: string,
    recoverable = true,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(code, message, { package: 'realtime', recoverable, details });
    this.name = 'DiceRoomConnectionError';
  }
}

/**
 * Error raised for dice room protocol failures.
 *
 * @public
 */
export class DiceRoomProtocolError extends DraftrollError {
  /**
   * Creates a DiceRoomProtocolError instance.
   */
  constructor(
    message: string,
    public readonly issues: readonly import('../../protocol/src/index').RuntimeValidationIssue[] = [],
  ) {
    super(DRAFTROLL_ERROR_CODES.invalidProtocolPayload, message, {
      package: 'realtime',
      recoverable: true,
      details: issues.length > 0 ? { issues } : undefined,
    });
    this.name = 'DiceRoomProtocolError';
  }
}

/**
 * Error raised for dice room token required failures.
 *
 * @public
 */
export class DiceRoomTokenRequiredError extends DraftrollError {
  /**
   * Creates a DiceRoomTokenRequiredError instance.
   */
  constructor(message = 'This Draftroll room requires a capability token') {
    super('token_required', message, { package: 'realtime', recoverable: true });
    this.name = 'DiceRoomTokenRequiredError';
  }
}

/**
 * Error raised for dice room token failures.
 *
 * @public
 */
export class DiceRoomTokenError extends DraftrollError {
  /**
   * Creates a DiceRoomTokenError instance.
   */
  constructor(code: string, message = 'The Draftroll room capability token is invalid') {
    super(code, message, { package: 'realtime', recoverable: true });
    this.name = 'DiceRoomTokenError';
  }
}

/**
 * Error raised for dice room password required failures.
 *
 * @public
 */
export class DiceRoomPasswordRequiredError extends DraftrollError {
  /**
   * Creates a DiceRoomPasswordRequiredError instance.
   */
  constructor(message = 'This Draftroll room requires a password') {
    super('room_password_required', message, { package: 'realtime', recoverable: true });
    this.name = 'DiceRoomPasswordRequiredError';
  }
}

/**
 * Error raised for dice room password failures.
 *
 * @public
 */
export class DiceRoomPasswordError extends DraftrollError {
  /**
   * Creates a DiceRoomPasswordError instance.
   */
  constructor(message = 'The Draftroll room password is incorrect') {
    super('invalid_room_password', message, { package: 'realtime', recoverable: true });
    this.name = 'DiceRoomPasswordError';
  }
}

/**
 * Error raised for dice room request failures.
 *
 * @public
 */
export class DiceRoomRequestError extends DraftrollError {
  readonly requestId?: string;
  readonly rollId?: string;
  readonly currentRevision?: number;
  readonly limit?: string;

  /**
   * Creates a DiceRoomRequestError instance.
   */
  constructor(event: Extract<ServerToClientEvent, { type: 'roll_error' }>) {
    super(event.code, event.message, {
      package: 'realtime',
      recoverable: isRecoverableRequestCode(event.code),
      retryAfterMs: event.retryAfterMs,
      details: {
        requestId: event.requestId,
        rollId: event.rollId,
        currentRevision: event.currentRevision,
        limit: event.limit,
      },
    });
    this.name = 'DiceRoomRequestError';
    this.requestId = event.requestId;
    this.rollId = event.rollId;
    this.currentRevision = event.currentRevision;
    this.limit = event.limit;
  }
}

function isRecoverableRequestCode(code: string): boolean {
  return code === 'revision_conflict'
    || code === 'rate_limited'
    || code === 'request_timeout'
    || code === 'room_password_required'
    || code === 'invalid_room_password'
    || code === 'token_required'
    || code === 'token_expired'
    || code === 'token_revoked';
}

interface ClockSample {
  offsetMs: number;
  roundTripMs: number;
}

/**
 * Converts a server room event into client-relative synchronized timing.
 *
 * @public
 */
export function synchronizeRoomEvent(event: RoomRollEvent, clockOffsetMs: number, nowMs = Date.now()): SynchronizedRoomRollEvent {
  if (event.type === 'roll_start') {
    const localStartTimeMs = event.serverStartTimeMs === undefined
      ? undefined
      : event.serverStartTimeMs - clockOffsetMs;
    const elapsedMs = localStartTimeMs === undefined ? 0 : Math.max(0, nowMs - localStartTimeMs);
    return {
      ...event,
      localStartTimeMs,
      elapsedMs,
      animationProgress: event.animationDurationMs && event.animationDurationMs > 0
        ? elapsedMs / event.animationDurationMs
        : 0,
    };
  }
  if (event.type === 'roll_updated') {
    const localStartTimeMs = event.animate && event.serverStartTimeMs !== undefined
      ? event.serverStartTimeMs - clockOffsetMs
      : undefined;
    const elapsedMs = localStartTimeMs === undefined ? 0 : Math.max(0, nowMs - localStartTimeMs);
    return {
      ...event,
      localStartTimeMs,
      elapsedMs,
      animationProgress: event.animationDurationMs && event.animationDurationMs > 0
        ? elapsedMs / event.animationDurationMs
        : 0,
    };
  }
  return { ...event, elapsedMs: 0 };
}

function isTokenAuthenticationError(code: string): boolean {
  return code === 'invalid_token'
    || code === 'malformed_token'
    || code === 'unsupported_token_header'
    || code === 'unknown_key_id'
    || code === 'invalid_signature'
    || code === 'invalid_payload'
    || code === 'protocol_mismatch'
    || code === 'room_mismatch'
    || code === 'token_expired'
    || code === 'token_not_yet_valid'
    || code === 'token_issued_in_future'
    || code === 'token_issuer_mismatch'
    || code === 'token_audience_mismatch'
    || code === 'token_id_required'
    || code === 'token_issued_at_required'
    || code === 'token_revoked'
    || code === 'token_verification_unavailable'
    || code === 'token_key_configuration_invalid';
}

function createId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Narrowing counterpart to `Number.isSafeInteger`, which does not narrow on its own. */
function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Narrows an unknown value to an indexable object without asserting a shape. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
