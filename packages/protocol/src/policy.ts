/**
 * Current room-policy schema version.
 *
 * @public
 */
export const DRAFTROLL_ROOM_POLICY_SCHEMA_VERSION = 1 as const;

/**
 * Built-in room-policy starting points.
 *
 * @public
 */
export type RoomPolicyPreset = 'open-table' | 'private-gm-table' | 'moderated-public-room';

/**
 * Policy settings for room access.
 *
 * @public
 */
export interface RoomAccessPolicy {
  /** Public access state only. Password material is never included in policy events. */
  passwordProtected: boolean;
}

/**
 * Policy settings for room authorization.
 *
 * @public
 */
export interface RoomAuthorizationPolicy {
  allowParticipantRolls: boolean;
  allowOwnRollUpdates: boolean;
  allowOwnRollRerolls: boolean;
  allowOwnRollReveal: boolean;
  allowPrivilegedAnyRollUpdates: boolean;
  allowPrivilegedAnyRollReveal: boolean;
  allowHiddenRolls: boolean;
  allowWhispers: boolean;
}

/**
 * Policy settings for room limit.
 *
 * @public
 */
export interface RoomLimitPolicy {
  maximumParticipants: number;
  maximumInboundMessageBytes: number;
  maximumExpressionLength: number;
  maximumDicePerRoll: number;
  maximumOperationsPerRoll: number;
  maximumParticipantMetadataBytes: number;
  maximumBufferedEvents: number;
  maximumRollsRetained: number;
  maximumRevisionsPerRoll: number;
}

/**
 * Policy settings for room rate limit.
 *
 * @public
 */
export interface RoomRateLimitPolicy {
  connectionAttemptsPerMinutePerIp: number;
  passwordAttemptsPerMinutePerIp: number;
  commandsPerMinutePerSession: number;
  mutationsPerMinutePerParticipant: number;
  rollsPerMinutePerRoom: number;
}

/**
 * Policy settings for room lifecycle.
 *
 * @public
 */
export interface RoomLifecyclePolicy {
  staleSessionSeconds: number;
  roomIdleExpirySeconds: number;
  historyRetentionSeconds: number;
  revisionRetentionSeconds: number;
  maintenanceIntervalSeconds: number;
}

/**
 * Policy settings for room renderer.
 *
 * @public
 */
export interface RoomRendererPolicy {
  defaultThemeId?: string;
  performanceProfile: 'auto' | 'battery' | 'quality';
  concurrentTableRolls: boolean;
  maximumConcurrentVisuals: number;
  autoClearMs?: number;
  reducedMotion: boolean;
  /** Require all connected visual clients to report renderer readiness before synchronized starts. */
  requireRendererReady: boolean;
  /** Require all connected visual clients to report theme readiness before synchronized starts. */
  requireThemesReady: boolean;
  /** Maximum time a roll command waits for required readiness before failing. */
  readinessTimeoutMs: number;
  /** Shared presentation tuning preset; authorization remains independent. */
  physicsPreset: 'standard' | 'compact' | 'heavy' | 'low-gravity';
}

/**
 * Complete room authorization, limits, lifecycle, rate-limit, and renderer policy.
 *
 * @public
 */
export interface RoomPolicy {
  schemaVersion: typeof DRAFTROLL_ROOM_POLICY_SCHEMA_VERSION;
  preset: RoomPolicyPreset | 'custom';
  /** Emergency switch. Managers may still connect and update policy while disabled. */
  enabled: boolean;
  shutdownReason?: string;
  access: RoomAccessPolicy;
  authorization: RoomAuthorizationPolicy;
  limits: RoomLimitPolicy;
  rateLimits: RoomRateLimitPolicy;
  lifecycle: RoomLifecyclePolicy;
  /** Presentation defaults only; never used for authorization decisions. */
  renderer?: RoomRendererPolicy;
}

/**
 * Partial update for room authorization policy.
 *
 * @public
 */
export interface RoomAuthorizationPolicyPatch extends Partial<RoomAuthorizationPolicy> {}
/**
 * Partial update for room limit policy.
 *
 * @public
 */
export interface RoomLimitPolicyPatch extends Partial<RoomLimitPolicy> {}
/**
 * Partial update for room rate limit policy.
 *
 * @public
 */
export interface RoomRateLimitPolicyPatch extends Partial<RoomRateLimitPolicy> {}
/**
 * Partial update for room lifecycle policy.
 *
 * @public
 */
export interface RoomLifecyclePolicyPatch extends Partial<RoomLifecyclePolicy> {}
/**
 * Partial update for room renderer policy.
 *
 * @public
 */
export interface RoomRendererPolicyPatch extends Partial<RoomRendererPolicy> {}

/**
 * Partial room-policy update accepted by the protocol.
 *
 * @public
 */
export interface RoomPolicyPatch {
  /** Start from a named preset before applying the rest of this patch. */
  preset?: RoomPolicyPreset;
  enabled?: boolean;
  shutdownReason?: string | null;
  authorization?: RoomAuthorizationPolicyPatch;
  limits?: RoomLimitPolicyPatch;
  rateLimits?: RoomRateLimitPolicyPatch;
  lifecycle?: RoomLifecyclePolicyPatch;
  renderer?: RoomRendererPolicyPatch;
}

const OPEN_TABLE_POLICY: RoomPolicy = {
  schemaVersion: DRAFTROLL_ROOM_POLICY_SCHEMA_VERSION,
  preset: 'open-table',
  enabled: true,
  access: {
    passwordProtected: false,
  },
  authorization: {
    allowParticipantRolls: true,
    allowOwnRollUpdates: true,
    allowOwnRollRerolls: true,
    allowOwnRollReveal: true,
    allowPrivilegedAnyRollUpdates: true,
    allowPrivilegedAnyRollReveal: true,
    allowHiddenRolls: true,
    allowWhispers: true,
  },
  limits: {
    maximumParticipants: 32,
    maximumInboundMessageBytes: 64 * 1024,
    maximumExpressionLength: 16_384,
    maximumDicePerRoll: 250,
    maximumOperationsPerRoll: 128,
    maximumParticipantMetadataBytes: 8 * 1024,
    maximumBufferedEvents: 200,
    maximumRollsRetained: 500,
    maximumRevisionsPerRoll: 50,
  },
  rateLimits: {
    connectionAttemptsPerMinutePerIp: 30,
    passwordAttemptsPerMinutePerIp: 10,
    commandsPerMinutePerSession: 180,
    mutationsPerMinutePerParticipant: 120,
    rollsPerMinutePerRoom: 300,
  },
  lifecycle: {
    staleSessionSeconds: 15 * 60,
    roomIdleExpirySeconds: 24 * 60 * 60,
    historyRetentionSeconds: 30 * 24 * 60 * 60,
    revisionRetentionSeconds: 30 * 24 * 60 * 60,
    maintenanceIntervalSeconds: 5 * 60,
  },
  renderer: {
    defaultThemeId: 'dragon',
    performanceProfile: 'auto',
    concurrentTableRolls: true,
    maximumConcurrentVisuals: 30,
    reducedMotion: false,
    requireRendererReady: false,
    requireThemesReady: false,
    readinessTimeoutMs: 1_500,
    physicsPreset: 'standard',
  },
};

const PRIVATE_GM_TABLE_POLICY: RoomPolicy = {
  ...OPEN_TABLE_POLICY,
  preset: 'private-gm-table',
  authorization: {
    ...OPEN_TABLE_POLICY.authorization,
    allowOwnRollReveal: false,
  },
  limits: {
    ...OPEN_TABLE_POLICY.limits,
    maximumParticipants: 16,
  },
};

const MODERATED_PUBLIC_ROOM_POLICY: RoomPolicy = {
  ...OPEN_TABLE_POLICY,
  preset: 'moderated-public-room',
  authorization: {
    ...OPEN_TABLE_POLICY.authorization,
    allowOwnRollUpdates: false,
    allowOwnRollRerolls: false,
    allowOwnRollReveal: false,
    allowHiddenRolls: false,
    allowWhispers: false,
  },
  limits: {
    ...OPEN_TABLE_POLICY.limits,
    maximumParticipants: 64,
    maximumDicePerRoll: 100,
    maximumOperationsPerRoll: 64,
    maximumBufferedEvents: 300,
    maximumRollsRetained: 1_000,
    maximumRevisionsPerRoll: 20,
  },
  rateLimits: {
    connectionAttemptsPerMinutePerIp: 12,
    passwordAttemptsPerMinutePerIp: 6,
    commandsPerMinutePerSession: 90,
    mutationsPerMinutePerParticipant: 30,
    rollsPerMinutePerRoom: 180,
  },
};

/**
 * Built-in room-policy presets.
 *
 * @public
 */
export const ROOM_POLICY_PRESETS: Readonly<Record<RoomPolicyPreset, RoomPolicy>> = Object.freeze({
  'open-table': OPEN_TABLE_POLICY,
  'private-gm-table': PRIVATE_GM_TABLE_POLICY,
  'moderated-public-room': MODERATED_PUBLIC_ROOM_POLICY,
});

/**
 * Default complete room policy.
 *
 * @public
 */
export const DEFAULT_ROOM_POLICY: Readonly<RoomPolicy> = Object.freeze(
  cloneRoomPolicy(OPEN_TABLE_POLICY),
);

/**
 * Creates a complete room policy from a preset and optional patch.
 *
 * @public
 */
export function createRoomPolicy(preset: RoomPolicyPreset = 'open-table'): RoomPolicy {
  return cloneRoomPolicy(ROOM_POLICY_PRESETS[preset]);
}

/**
 * Applies a validated partial update to a room policy.
 *
 * @public
 */
export function applyRoomPolicyPatch(current: RoomPolicy, patch: RoomPolicyPatch): RoomPolicy {
  const base = patch.preset ? createRoomPolicy(patch.preset) : cloneRoomPolicy(current);
  const enabled = patch.enabled ?? base.enabled;
  const shutdownReason =
    patch.shutdownReason === null ? undefined : (patch.shutdownReason ?? base.shutdownReason);
  return {
    ...base,
    preset: hasCustomPolicyFields(patch) ? 'custom' : (patch.preset ?? base.preset),
    enabled,
    ...(shutdownReason ? { shutdownReason } : {}),
    access: { ...current.access },
    authorization: { ...base.authorization, ...patch.authorization },
    limits: { ...base.limits, ...patch.limits },
    rateLimits: { ...base.rateLimits, ...patch.rateLimits },
    lifecycle: { ...base.lifecycle, ...patch.lifecycle },
    renderer:
      base.renderer || patch.renderer
        ? { ...(base.renderer ?? OPEN_TABLE_POLICY.renderer!), ...patch.renderer }
        : undefined,
  };
}

/**
 * Creates a detached copy of a room policy.
 *
 * @public
 */
export function cloneRoomPolicy(policy: RoomPolicy): RoomPolicy {
  return {
    ...policy,
    access: { ...policy.access },
    authorization: { ...policy.authorization },
    limits: { ...policy.limits },
    rateLimits: { ...policy.rateLimits },
    lifecycle: { ...policy.lifecycle },
    renderer: policy.renderer ? { ...policy.renderer } : undefined,
  };
}

function hasCustomPolicyFields(patch: RoomPolicyPatch): boolean {
  return (
    patch.enabled !== undefined ||
    patch.shutdownReason !== undefined ||
    patch.authorization !== undefined ||
    patch.limits !== undefined ||
    patch.rateLimits !== undefined ||
    patch.lifecycle !== undefined ||
    patch.renderer !== undefined
  );
}
