/**
 * Current realtime wire-protocol version.
 *
 * @public
 */
export const DRAFTROLL_PROTOCOL_VERSION = 2 as const;
/**
 * Protocol versions accepted by this build.
 *
 * @public
 */
export const DRAFTROLL_SUPPORTED_PROTOCOL_VERSIONS = [DRAFTROLL_PROTOCOL_VERSION] as const;
/**
 * Current normalized-roll schema version.
 *
 * @public
 */
export const DRAFTROLL_RESULT_SCHEMA_VERSION = 1 as const;
