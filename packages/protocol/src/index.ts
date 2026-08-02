/**
 * Versioned Draftroll protocol contracts.
 *
 * @remarks
 * Defines serializable roll, room, policy, visibility, and synchronization messages shared by clients and servers.
 *
 * @packageDocumentation
 */

/**
 * Identifies whether a roll was produced locally, by a server, or externally.
 *
 * @public
 */
export type RollAuthority = 'local' | 'server' | 'external';
/**
 * Selects exact d20 semantics or Draftroll-native parser behavior.
 *
 * @public
 */
export type DiceDialect = 'd20' | 'draftroll';
/**
 * Selects normal, advantage, or disadvantage d20 evaluation.
 *
 * @public
 */
export type AdvantageMode = 'none' | 'advantage' | 'disadvantage';
/**
 * Classifies a normalized roll as ordinary, critical success, or critical failure.
 *
 * @public
 */
export type CriticalType = 'none' | 'critical-success' | 'critical-failure';

export {
  DRAFTROLL_PROTOCOL_VERSION,
  DRAFTROLL_SUPPORTED_PROTOCOL_VERSIONS,
  DRAFTROLL_RESULT_SCHEMA_VERSION,
} from './version';
import { DRAFTROLL_PROTOCOL_VERSION, DRAFTROLL_RESULT_SCHEMA_VERSION } from './version';
export * from './policy';
import type { RoomPolicy, RoomPolicyPatch } from './policy';

/**
 * Capability granted to a participant inside a room.
 *
 * @public
 */
export type RoomPermission =
  | 'roll:create'
  | 'roll:update-own'
  | 'roll:update-any'
  | 'roll:reveal-own'
  | 'roll:reveal-any'
  | 'roll:view-hidden'
  | 'room:manage';

/**
 * Signed capability claims used to authenticate a room participant.
 *
 * @public
 */
export interface RoomCapabilityTokenPayload {
  protocolVersion?: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  participantId: string;
  sessionId?: string;
  name?: string;
  roles?: string[];
  permissions?: RoomPermission[];
  metadata?: Record<string, unknown>;
  /** Token issuer. Deployments can require an exact issuer during verification. */
  iss?: string;
  /** Intended audience or audiences. */
  aud?: string | string[];
  /** Unix timestamp in seconds when the token was issued. */
  iat?: number;
  /** Unix timestamp in seconds before which the token must not be accepted. */
  nbf?: number;
  /** Unique token identifier used for exact revocation. */
  jti?: string;
  /** Unix timestamp in seconds. */
  exp?: number;
}

/**
 * Token or participant scope used for room-token revocation.
 *
 * @public
 */
export type RoomTokenRevocationTarget =
  | {
      type: 'token';
      tokenId: string;
      /** Optional token expiry used to garbage-collect the revocation record sooner. */
      expiresAt?: number;
    }
  | {
      type: 'participant';
      participantId: string;
      /** Revoke tokens issued at or before this Unix timestamp. Defaults to the server time. */
      issuedAtOrBefore?: number;
    };

/**
 * Application-provided participant identity used during room connection.
 *
 * @public
 */
export interface ParticipantIdentityInput {
  /** Stable identity within an embedding application. Generated when omitted. */
  participantId?: string;
  /** Connection/session identity. Generated when omitted and reused across reconnects. */
  sessionId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Serializable identity attached to an authoritative room event.
 *
 * @public
 */
export interface RoomActor {
  participantId: string;
  sessionId: string;
  name: string;
  roles: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Connected room actor plus effective permissions and connection time.
 *
 * @public
 */
export interface RoomParticipant extends RoomActor {
  permissions: RoomPermission[];
  connectedAt: string;
}

/**
 * Audience policy applied to an authoritative room roll.
 *
 * @public
 */
export type RollVisibility =
  | { type: 'public' }
  | { type: 'roller' }
  | { type: 'roles'; roles: string[] }
  | { type: 'participants'; participantIds: string[] }
  | { type: 'participants-and-roles'; participantIds: string[]; roles: string[] };

/**
 * Visibility exposed to clients that are not allowed to inspect the real policy.
 *
 * @public
 */
export type ProjectedRollVisibility = RollVisibility | { type: 'hidden' };

/**
 * Lightweight room-roll metadata without the complete result payload.
 *
 * @public
 */
export interface RollSummary {
  rollId: string;
  sequence: number;
  revision: number;
  name?: string;
  actor: RoomActor;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Standard physical and fallback die identifiers.
 *
 * @public
 */
export type StandardDieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100' | 'dF';

/**
 * Per-die physical scaling overrides.
 *
 * @public
 */
export interface DicePhysicsProperties {
  /** Visual and collider scale, constrained by runtime validation. */
  sizeScale?: number;
  /** Relative mass/weight scale. */
  massScale?: number;
  /** Relative rotational inertia scale. */
  inertiaScale?: number;
}

/**
 * Per-die material and color overrides.
 *
 * @public
 */
export interface DiceAppearance {
  primaryColor?: string;
  secondaryColor?: string;
  materialId?: string;
}

/**
 * Canonical result for one physical or symbolic die.
 *
 * @public
 */
export interface NormalizedDieResult {
  id: string;
  type: string;
  sides?: number;
  result: number | string;
  /** Numeric contribution used for totals and selectors when result is symbolic. */
  numericValue?: number;
  faceIndex?: number;
  faceLabel?: string;
  /** Metadata belonging to the selected custom face, separate from host die metadata. */
  faceMetadata?: Record<string, unknown>;
  kept: boolean;
  themeId?: string;
  customDiceId?: string;
  appearance?: DiceAppearance;
  physics?: DicePhysicsProperties;
  sourceRollIndex?: number;
  generatedBy?: 'initial' | 'reroll' | 'reroll-add' | 'explosion' | 'external';
  /** Immediate causal predecessor for staged reroll/explosion presentation. */
  generatedFromDieId?: string;
  annotations?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Normalized modifier operation identifiers.
 *
 * @public
 */
export type RollOperationType =
  | 'keep'
  | 'drop'
  | 'keep-highest'
  | 'keep-lowest'
  | 'drop-highest'
  | 'drop-lowest'
  | 'reroll'
  | 'reroll-once'
  | 'reroll-add'
  | 'explode'
  | 'minimum'
  | 'maximum'
  | 'success-count';

/**
 * Selector predicate identifiers accepted by roll operations.
 *
 * @public
 */
export type RollSelectorType =
  | 'literal'
  | 'highest'
  | 'lowest'
  | 'greater'
  | 'less'
  | 'greater-equal'
  | 'less-equal'
  | 'not-equal';

/**
 * Selector predicate and target used by a roll operation.
 *
 * @public
 */
export interface RollSelector {
  type: RollSelectorType;
  target: number;
}

/**
 * Normalized modifier operation recorded in a roll result.
 *
 * @public
 */
export interface RollOperation {
  type: RollOperationType;
  count?: number;
  comparator?: ComparisonOperator;
  target?: number;
  selector?: RollSelector;
  notation?: string;
  appliedTo: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Comparison operators supported by expressions and selectors.
 *
 * @public
 */
export type ComparisonOperator = '=' | '==' | '!=' | '<' | '<=' | '>' | '>=';

/**
 * Fields shared by every evaluated roll-tree node.
 *
 * @public
 */
export interface RollTreeNodeBase {
  id: string;
  value: number;
  kept: boolean;
  annotations: string[];
  diceIds: string[];
}

/**
 * Evaluated numeric literal in a normalized roll tree.
 *
 * @public
 */
export interface RollLiteralTreeNode extends RollTreeNodeBase {
  kind: 'literal';
  literal: number;
}

/**
 * Evaluated single-die node in a normalized roll tree.
 *
 * @public
 */
export interface RollDieTreeNode extends RollTreeNodeBase {
  kind: 'die';
  dieId: string;
  sides: number | 'F' | (string & {});
  generatedBy: NonNullable<NormalizedDieResult['generatedBy']>;
}

/**
 * Evaluated dice-pool node containing generated die children.
 *
 * @public
 */
export interface RollDiceTreeNode extends RollTreeNodeBase {
  kind: 'dice';
  count: number;
  sides: number | 'F' | (string & {});
  percentile?: boolean;
  children: RollDieTreeNode[];
}

/**
 * Evaluated set node after keep, drop, reroll, or counting operations.
 *
 * @public
 */
export interface RollSetTreeNode extends RollTreeNodeBase {
  kind: 'set';
  children: RollTreeNode[];
}

/**
 * Evaluated parenthesized subtree.
 *
 * @public
 */
export interface RollParentheticalTreeNode extends RollTreeNodeBase {
  kind: 'parenthetical';
  child: RollTreeNode;
}

/**
 * Evaluated unary-operation subtree.
 *
 * @public
 */
export interface RollUnaryTreeNode extends RollTreeNodeBase {
  kind: 'unary';
  operator: '+' | '-';
  child: RollTreeNode;
}

/**
 * Evaluated binary-operation subtree.
 *
 * @public
 */
export interface RollBinaryTreeNode extends RollTreeNodeBase {
  kind: 'binary';
  operator: '+' | '-' | '*' | '/' | '//' | '%' | '==' | '=' | '!=' | '<' | '<=' | '>' | '>=';
  left: RollTreeNode;
  right: RollTreeNode;
}

/**
 * Union of evaluated roll-tree node shapes.
 *
 * @public
 */
export type RollTreeNode =
  | RollLiteralTreeNode
  | RollDieTreeNode
  | RollDiceTreeNode
  | RollSetTreeNode
  | RollParentheticalTreeNode
  | RollUnaryTreeNode
  | RollBinaryTreeNode;

/**
 * Canonical, serializable result produced by every Draftroll evaluation path.
 *
 * @public
 */
export interface NormalizedRollResult {
  /** Version of the serialized normalized-result contract. */
  schemaVersion: typeof DRAFTROLL_RESULT_SCHEMA_VERSION;
  rollId?: string;
  sequence?: number;
  /** Starts at 0 for the original result and increments when the same log entry is revised. */
  revision?: number;
  /** Timestamp of the latest revision. createdAt always remains the original roll time. */
  updatedAt?: string;
  authority: RollAuthority;
  /** Human-readable actor or roll label, such as a character name. */
  name?: string;
  expression?: string;
  /** Exact evaluated numeric value. */
  total: number;
  /** d20-compatible total, truncated toward zero. */
  integerTotal?: number;
  dice: NormalizedDieResult[];
  operations: RollOperation[];
  modifier?: number;
  annotation?: string | null;
  comment?: string | null;
  critical?: CriticalType;
  dialect?: DiceDialect;
  advantage?: AdvantageMode;
  tree?: RollTreeNode;
  themeId?: string;
  metadata?: Record<string, unknown>;
  /** Portable definitions required to replay or revise structured custom dice. */
  customDice?: CustomDiceDefinition[];
  createdAt: string;
}

/**
 * Structured input for evaluating planned dice and modifier operations.
 *
 * @public
 */
export interface EvaluateRollInput {
  mode: 'evaluate';
  name?: string;
  expression?: string;
  dice?: PlannedDie[];
  operations?: StructuredRollOperation[];
  modifier?: number;
  themeId?: string;
  dialect?: DiceDialect;
  advantage?: AdvantageMode;
  allowComments?: boolean;
  /** Inline weighted/symbolic dice definitions for portable or server-authoritative rolls. */
  customDice?: CustomDiceDefinition[];
  metadata?: Record<string, unknown>;
}

/**
 * Externally supplied roll result that should be normalized without evaluation.
 *
 * @public
 */
export interface DisplayRollInput {
  mode: 'display';
  name?: string;
  dice: ExternalDieResult[];
  total?: number;
  expression?: string;
  themeId?: string;
  annotation?: string | null;
  comment?: string | null;
  /** Definitions retained when an external custom result may later be rerolled or revised. */
  customDice?: CustomDiceDefinition[];
  metadata?: Record<string, unknown>;
}

/**
 * Input accepted by the SDK roll boundary.
 *
 * @public
 */
export type RollInput = EvaluateRollInput | DisplayRollInput;

/**
 * One weighted numeric or symbolic face in a custom die.
 *
 * @public
 */
export interface CustomDieFace {
  result: number | string;
  /** Numeric contribution; defaults to result for numeric faces and 0 for symbols. */
  value?: number;
  weight?: number;
  label?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Defines a reusable custom die with weighted numeric or symbolic faces.
 *
 * @public
 */
export interface CustomDiceDefinition {
  id: string;
  faces: CustomDieFace[];
  /** Optional physical fallback such as d6, token, or spinner. */
  renderAs?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Stable structured description of one die to generate.
 *
 * @public
 */
export interface PlannedDie {
  id: string;
  type: string;
  sides?: number;
  result?: number | string;
  numericValue?: number;
  /** Selects a specific repeated/custom face when result alone is ambiguous. */
  faceIndex?: number;
  themeId?: string;
  customDiceId?: string;
  appearance?: DiceAppearance;
  physics?: DicePhysicsProperties;
  annotations?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Trusted externally generated die result accepted for normalization.
 *
 * @public
 */
export interface ExternalDieResult extends PlannedDie {
  result: number | string;
  kept?: boolean;
  sourceRollIndex?: number;
  generatedBy?: NormalizedDieResult['generatedBy'];
  generatedFromDieId?: string;
}

/**
 * Modifier operation accepted by structured evaluation.
 *
 * @public
 */
export interface StructuredRollOperation {
  type: RollOperationType;
  count?: number;
  dice?: string[];
  comparator?: ComparisonOperator;
  target?: number;
  selector?: RollSelector;
  notation?: string;
}

/**
 * Explicit correction or metadata patch for one normalized die.
 *
 * @public
 */
export interface RollDieUpdate {
  id: string;
  type?: string;
  sides?: number;
  result?: number | string;
  numericValue?: number;
  faceIndex?: number;
  kept?: boolean;
  themeId?: string | null;
  customDiceId?: string | null;
  appearance?: DiceAppearance | null;
  physics?: DicePhysicsProperties | null;
  annotations?: string[] | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Patch an existing normalized roll. Undefined fields are preserved. A null
 * expression removes the formula and turns the revision into a structured or
 * externally maintained result.
 *
 * @public
 */
export interface RollUpdateInput {
  name?: string | null;
  expression?: string | null;
  dice?: RollDieUpdate[];
  /** Remove dice by ID when revising structured or external rolls. */
  removeDice?: string[];
  total?: number;
  modifier?: number | null;
  annotation?: string | null;
  comment?: string | null;
  themeId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Whether a revision updates history only or animates selected dice.
 *
 * @public
 */
export type RollUpdateAnimationMode = 'animate' | 'log-only';

/**
 * Fields shared by every sequenced room event.
 *
 * @public
 */
export interface RoomEventBase {
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  /** Monotonic for every persisted room event, including updates and reveals. */
  eventSequence: number;
  requestId?: string;
  clientRollId?: string;
  replayed?: boolean;
}

/**
 * Fields shared by room events associated with a logical roll.
 *
 * @public
 */
export interface RoomRollEventBase extends RoomEventBase {
  rollId: string;
  /** Stable creation-order sequence for the logical roll. */
  sequence: number;
  actor: RoomActor;
  visibility: ProjectedRollVisibility;
  hidden: boolean;
  summary: RollSummary;
  /** Null when the current participant is not authorized to receive the result. */
  result: NormalizedRollResult | null;
}

/**
 * Protocol payload for a roll start event.
 *
 * @public
 */
export interface RollStartEvent extends RoomRollEventBase {
  type: 'roll_start';
  animationSeed?: string;
  serverStartTimeMs?: number;
  animationDurationMs?: number;
  /** Buffer selected by the room before the synchronized animation starts. */
  startBufferMs?: number;
}

/**
 * Protocol payload for a roll request event.
 *
 * @public
 */
export interface RollRequestEvent {
  type: 'roll_request';
  requestId: string;
  clientRollId?: string;
  input: RollInput;
  visibility?: RollVisibility;
}

/**
 * Protocol payload for a display roll event.
 *
 * @public
 */
export interface DisplayRollEvent {
  type: 'display_roll';
  requestId: string;
  clientRollId?: string;
  input: DisplayRollInput;
  visibility?: RollVisibility;
}

/**
 * Application-supplied reason and labels recorded with a roll revision.
 *
 * @public
 */
export interface RollAuditDetails {
  /** Human-readable operator reason, suitable for privileged history views. */
  reason?: string;
  /** Short application-defined category such as correction, reveal, moderation, or migration. */
  label?: string;
}

/**
 * Protocol payload for a roll update request event.
 *
 * @public
 */
export interface RollUpdateRequestEvent {
  type: 'update_roll';
  requestId: string;
  rollId: string;
  update: RollUpdateInput;
  /** Reject the update when the current revision differs. */
  expectedRevision?: number;
  /** Re-evaluate all dice, selected IDs, or preserve existing values by default. */
  reroll?: boolean | string[];
  /** When true, broadcast a synchronized physical replay; otherwise update result/log state only. */
  animate?: boolean;
  audit?: RollAuditDetails;
}

/**
 * One expected-revision update inside an atomic room batch.
 *
 * @public
 */
export interface BulkRollUpdateItem {
  rollId: string;
  update: RollUpdateInput;
  expectedRevision?: number;
  reroll?: boolean | string[];
  animate?: boolean;
  audit?: RollAuditDetails;
}

/**
 * Protocol payload for a bulk roll update request event.
 *
 * @public
 */
export interface BulkRollUpdateRequestEvent {
  type: 'bulk_update_rolls';
  requestId: string;
  /** All updates are validated before any are committed. */
  updates: BulkRollUpdateItem[];
}

/**
 * Protocol payload for a set roll visibility request event.
 *
 * @public
 */
export interface SetRollVisibilityRequestEvent {
  type: 'set_roll_visibility';
  requestId: string;
  rollId: string;
  visibility: RollVisibility;
  expectedRevision?: number;
  audit?: RollAuditDetails;
}

/**
 * Protocol payload for a participant update request event.
 *
 * @public
 */
export interface ParticipantUpdateRequestEvent {
  type: 'participant_update';
  name?: string;
  metadata?: Record<string, unknown>;
}


/**
 * Protocol payload for a authenticate room token event.
 *
 * @public
 */
export interface AuthenticateRoomTokenEvent {
  type: 'authenticate_room_token';
  /** Signed capability token. Sent only inside the encrypted WebSocket session. */
  token: string;
}

/**
 * Protocol payload for a authenticate room password event.
 *
 * @public
 */
export interface AuthenticateRoomPasswordEvent {
  type: 'authenticate_room_password';
  password: string;
}

/**
 * Protocol payload for a set room password request event.
 *
 * @public
 */
export interface SetRoomPasswordRequestEvent {
  type: 'set_room_password';
  requestId: string;
  /** Null removes the password requirement. Password text is never included in server events. */
  password: string | null;
  expectedRevision?: number;
}

/**
 * Protocol payload for a set room policy request event.
 *
 * @public
 */
export interface SetRoomPolicyRequestEvent {
  type: 'set_room_policy';
  requestId: string;
  policy: RoomPolicyPatch;
  expectedRevision?: number;
}

/**
 * Protocol payload for a revoke room token request event.
 *
 * @public
 */
export interface RevokeRoomTokenRequestEvent {
  type: 'revoke_room_token';
  requestId: string;
  target: RoomTokenRevocationTarget;
  /** Optional operator-provided audit reason. */
  reason?: string;
}

/**
 * Protocol payload for a roll updated event.
 *
 * @public
 */
export interface RollUpdatedEvent extends RoomRollEventBase {
  type: 'roll_updated';
  animate: boolean;
  audit?: RollAuditDetails;
  animationSeed?: string;
  serverStartTimeMs?: number;
  animationDurationMs?: number;
  /** Buffer selected by the room before the synchronized animation starts. */
  startBufferMs?: number;
}

/**
 * Protocol payload for a roll visibility updated event.
 *
 * @public
 */
export interface RollVisibilityUpdatedEvent extends RoomRollEventBase {
  type: 'roll_visibility_updated';
  previousVisibility: ProjectedRollVisibility;
  audit?: RollAuditDetails;
}

/**
 * Protocol payload for a bulk roll updated event.
 *
 * @public
 */
export interface BulkRollUpdatedEvent {
  type: 'bulk_rolls_updated';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  requestId: string;
  /** Sequence of the atomic batch acknowledgement. Individual roll events have earlier sequences. */
  eventSequence: number;
  updates: Array<{ rollId: string; revision: number; eventSequence: number }>;
  replayed?: boolean;
}

/**
 * Protocol payload for a clock sync ping event.
 *
 * @public
 */
export interface ClockSyncPingEvent {
  type: 'clock_sync_ping';
  clientTimeMs: number;
  nonce: string;
}

/**
 * Protocol payload for a clock sync pong event.
 *
 * @public
 */
export interface ClockSyncPongEvent {
  type: 'clock_sync_pong';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  clientTimeMs: number;
  serverTimeMs: number;
  nonce: string;
}

/**
 * Protocol payload for a client ready event.
 *
 * @public
 */
export interface ClientReadyEvent {
  type: 'client_ready';
  rendererReady: boolean;
  themesReady: boolean;
  /** Best measured WebSocket round-trip time after clock synchronization. */
  roundTripMs?: number;
  /** Estimated one-way clock uncertainty derived from sample jitter. */
  clockUncertaintyMs?: number;
}

/**
 * Protocol payload for a session ready event.
 *
 * @public
 */
export interface SessionReadyEvent {
  type: 'session_ready';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  participant: RoomParticipant;
  latestEventSequence: number;
  latestRollSequence: number;
}

/**
 * Protocol payload for a participant joined event.
 *
 * @public
 */
export interface ParticipantJoinedEvent {
  type: 'participant_joined';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  participant: RoomParticipant;
}

/**
 * Protocol payload for a participant updated event.
 *
 * @public
 */
export interface ParticipantUpdatedEvent {
  type: 'participant_updated';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  participant: RoomParticipant;
}

/**
 * Protocol payload for a participant left event.
 *
 * @public
 */
export interface ParticipantLeftEvent {
  type: 'participant_left';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  participantId: string;
  sessionId: string;
}

/**
 * Protocol payload for a room policy updated event.
 *
 * @public
 */
export interface RoomPolicyUpdatedEvent {
  type: 'room_policy_updated';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  eventSequence: number;
  requestId?: string;
  revision: number;
  actor: RoomActor;
  policy: RoomPolicy;
  previousPolicy: RoomPolicy;
  replayed?: boolean;
}

/**
 * Protocol payload for a room token revoked event.
 *
 * @public
 */
export interface RoomTokenRevokedEvent {
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
  replayed?: boolean;
}

/**
 * Union of supported room replay events.
 *
 * @public
 */
export type RoomReplayEvent = RoomRollEvent | RoomPolicyUpdatedEvent | RoomTokenRevokedEvent;

/**
 * Union of supported room roll events.
 *
 * @public
 */
export type RoomRollEvent = RollStartEvent | RollUpdatedEvent | RollVisibilityUpdatedEvent;

/**
 * Protocol payload for a room state event.
 *
 * @public
 */
export interface RoomStateEvent {
  type: 'room_state';
  protocolVersion: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId: string;
  /** Backwards-compatible alias for latestRollSequence. */
  sequence: number;
  latestRollSequence: number;
  latestEventSequence: number;
  /** Oldest event still available for automatic reconnect replay. */
  eventBufferStartSequence: number;
  /** True when the reconnect cursor predates the retained event buffer. */
  missedEventsTruncated: boolean;
  defaultThemeId?: string;
  policy: RoomPolicy;
  policyRevision: number;
  participants: RoomParticipant[];
  /** Sequenced roll and policy events newer than the client's lastEventSequence. */
  recentEvents: RoomReplayEvent[];
  /** Backwards-compatible roll-only replay list. */
  recentRolls: RoomRollEvent[];
  /** Last projected event, retained for simple integrations. */
  recentRoll?: RoomRollEvent;
}

/**
 * Protocol payload for a roll error event.
 *
 * @public
 */
export interface RollErrorEvent {
  type: 'roll_error';
  protocolVersion?: typeof DRAFTROLL_PROTOCOL_VERSION;
  roomId?: string;
  requestId?: string;
  code: string;
  message: string;
  rollId?: string;
  currentRevision?: number;
  issues?: import('./runtime').RuntimeValidationIssue[];
  supportedProtocolVersions?: number[];
  retryAfterMs?: number;
  limit?: string;
}

/**
 * Messages accepted by a Draftroll room server.
 *
 * @public
 */
export type ClientToServerEvent =
  | RollRequestEvent
  | DisplayRollEvent
  | RollUpdateRequestEvent
  | BulkRollUpdateRequestEvent
  | SetRollVisibilityRequestEvent
  | ParticipantUpdateRequestEvent
  | SetRoomPolicyRequestEvent
  | RevokeRoomTokenRequestEvent
  | AuthenticateRoomTokenEvent
  | AuthenticateRoomPasswordEvent
  | SetRoomPasswordRequestEvent
  | ClockSyncPingEvent
  | ClientReadyEvent;

/**
 * Messages emitted by a Draftroll room server.
 *
 * @public
 */
export type ServerToClientEvent =
  | RollStartEvent
  | RollUpdatedEvent
  | BulkRollUpdatedEvent
  | RollVisibilityUpdatedEvent
  | ClockSyncPongEvent
  | RoomStateEvent
  | SessionReadyEvent
  | ParticipantJoinedEvent
  | ParticipantUpdatedEvent
  | ParticipantLeftEvent
  | RoomPolicyUpdatedEvent
  | RoomTokenRevokedEvent
  | RollErrorEvent;

export * from './runtime';
