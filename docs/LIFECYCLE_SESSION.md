# Lifecycle-managed SDK session

`DraftrollSession` is the stable application-facing object for integrations that need to move between local and realtime rolling or enable and disable rendering at runtime.

The session retains one `DiceEngine`, one underlying `Draftroll` instance, local history, custom-die registrations, event subscriptions, and a unified roll-handle log across lifecycle transitions.

## Local to realtime to local

```ts
import { DraftrollSession } from '@draftroll/sdk';

const session = new DraftrollSession();

session.on('state', (state) => {
  console.log(state.status, state.mode, state.rendererEnabled, state.roomId);
});

session.on('roll', (roll) => {
  console.log(roll.id, roll.result.total);
});

const local = await session.roll('1d20+5');

await session.connectRoom({
  url: 'wss://dice.example/rooms/table/connect',
  roomId: 'table',
  participant: { name: 'Aria' },
});

const authoritative = await session.roll('1d20+5', {
  visibility: { type: 'public' },
  clientRollId: crypto.randomUUID(),
});

session.useLocal();
const localAgain = await session.roll('2d6+3');
```

`session.roll()` always returns a promise because realtime evaluation is asynchronous. In local mode it resolves immediately to an `SdkRollResponse`; in realtime mode it resolves to a stable `DraftrollRoomRoll`.

The lower-level APIs remain available through:

```ts
session.draftroll; // stable local engine, history, formatting, custom dice
session.room; // active DraftrollRoomSession, or null in local mode
```

## Renderer on and off

Attach a renderer without replacing the engine, room connection, log, or subscriptions:

```ts
await session.setRenderer(renderer);
await session.roll('1d20');
await session.disableRenderer();
```

Renderer ownership is explicit:

```ts
await session.setRenderer(renderer, { owned: true });
```

An owned renderer is cleared and then destroyed or disposed when replaced or when the session is disposed. Externally owned renderers are cleared but not destroyed unless `disposePrevious: true` is requested.

When an active room exists, renderer changes also update the participant readiness signal sent to the room.

## Browser overlay convenience

```ts
const session = await DraftrollSession.createOverlay({
  overlay: {
    src: '/draftroll/overlay.html',
    results: { position: 'top-right' },
  },
  warmupThemes: ['dragon'],
});
```

Or add an owned overlay later:

```ts
await session.enableOverlay({ src: '/draftroll/overlay.html' }, ['dragon']);
await session.disableRenderer(); // clears and destroys the owned overlay
```

The headless entry point keeps overlay loading behind a dynamic import. Constructing `DraftrollSession` does not load renderer, overlay, Three.js, or Cannon-es runtime code.

## Unified events and history

A subscription made once remains active through local/realtime transitions:

```ts
const unsubscribe = session.on('roll', (roll) => {
  renderApplicationLog(roll.id, roll.result);
});
```

`session.rollLog` stores stable local and room handles in first-seen order. A room result that is automatically mirrored through the local presentation layer retains the richer `DraftrollRoomRoll` identity rather than being replaced by a presentation-only local handle.

Lifecycle state values are:

- `local`
- `connecting`
- `realtime`
- `disposed`

## Cleanup

```ts
await session.dispose();
```

Disposal closes the active room, clears the current renderer, destroys it only when session-owned, releases internal subscriptions, and rejects later operations.
