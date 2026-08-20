/**
 * Worker deployment entrypoint.
 *
 * Replay integrity is enforced inside the Durable Object before serialization. Keeping the
 * deployment entrypoint as a transparent re-export avoids reparsing and rebuilding every `/events`
 * response after the core worker has already validated it.
 */
export { default, DiceRoomObject } from './index';
