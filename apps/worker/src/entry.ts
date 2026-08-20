/**
 * Worker deployment entrypoint.
 *
 * Persistence-boundary validation lives in `DiceRoomObject` so HTTP replay, WebSocket recovery,
 * local tests, and deployed Workers all enforce the same invariants. Keeping this entrypoint as a
 * thin re-export avoids duplicate D1 replay queries and response re-parsing.
 */
export { default, DiceRoomObject } from './index';
