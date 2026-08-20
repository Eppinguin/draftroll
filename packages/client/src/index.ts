/**
 * Realtime room client for synchronized Draftroll sessions.
 *
 * @packageDocumentation
 */

import { DiceRoom as CoreDiceRoom, type DiceRoomOptions } from './implementation';
import { withRecoveryTransportBoundary } from './recovery-transport';

export * from './diagnostics';
export {
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

// Keep the implementation class as the one public DiceRoom identity. Only its static factory is
// decorated, so consumers do not observe a facade subclass or an unsafe constructor cast.
const connectCoreDiceRoom = CoreDiceRoom.connect.bind(CoreDiceRoom);
CoreDiceRoom.connect = async (options: DiceRoomOptions): Promise<CoreDiceRoom> =>
  connectCoreDiceRoom(withRecoveryTransportBoundary(options));

export { CoreDiceRoom as DiceRoom };
