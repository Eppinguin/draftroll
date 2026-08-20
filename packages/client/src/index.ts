/**
 * Realtime room client for synchronized Draftroll sessions.
 *
 * @packageDocumentation
 */

export * from './diagnostics';
export {
  DiceRoom,
  DiceRoomConnectionError,
  DiceRoomPasswordError,
  DiceRoomPasswordRequiredError,
  DiceRoomProtocolError,
  DiceRoomRequestError,
  DiceRoomTokenError,
  DiceRoomTokenRequiredError,
  synchronizeRoomEvent,
  type DiceRoomEvents,
  type DiceRoomOptions,
  type DiceRoomRequestMetrics,
  type SynchronizedRollStart,
  type SynchronizedRollUpdate,
  type SynchronizedVisibilityUpdate,
  type SynchronizedRoomPolicyUpdate,
  type SynchronizedRoomTokenRevocation,
  type SynchronizedRoomRollEvent,
  type SynchronizedRoomEvent,
} from './implementation';
