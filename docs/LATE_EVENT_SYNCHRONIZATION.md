# Late-event synchronization

Draftroll uses a server-authoritative start time, deterministic animation seed, measured client clock offset, and an adaptive room start buffer so connected participants begin a roll as closely together as practical. When a participant receives an event after the scheduled start, the renderer catches up instead of replaying stale motion from the beginning.

## Synchronized room events

The room service includes these animation fields on authorized animated events:

```ts
{
  animationSeed: '...',
  serverStartTimeMs: 1785486600000,
  animationDurationMs: 2800,
  startBufferMs: 475,
}
```

The browser client estimates its offset from the Durable Object clock. It translates `serverStartTimeMs` into `localStartTimeMs` and exposes:

```ts
{
  localStartTimeMs,
  elapsedMs,
  animationProgress,
}
```

The high-level `DraftrollRoomSession` forwards these values to the renderer automatically. Applications using `Draftroll.connectRoom()` do not need to calculate offsets, correlate events, or schedule timers themselves.

## Adaptive start buffer

The Durable Object chooses a bounded start buffer for each animated roll. It considers joined authenticated participants and uses:

- half of the reported round-trip time
- measured clock uncertainty
- a renderer preparation allowance
- an additional allowance when a participant has not reported renderer or theme readiness

The current buffer is bounded between 225 ms and 1,500 ms. It is included in the event as `startBufferMs` for diagnostics. The buffer is a coordination aid, not a guarantee that every browser will render the same frame at the same wall-clock instant.

Clients report readiness and timing diagnostics through `client_ready`. The SDK does this automatically when creating a high-level room session.

## Late-event modes

The renderer supports four late-event policies:

```ts
const presentation = draftroll.present(result, {
  startTime: localStartTimeMs,
  animationSeed,
  elapsedMs,
  animationDurationMs,
  lateEvent: {
    mode: 'auto',
    settleAfterProgress: 0.78,
  },
});
```

### `auto`

Default behavior:

- An on-time event waits for the synchronized start.
- A moderately late event seeks into the deterministic replay.
- Once the configured fraction of the animation has elapsed, Draftroll presents the final settled state instead of showing a very short tail of stale motion.

The default settled threshold is 78%.

### `seek`

Always seeks to the elapsed position and continues the remaining replay, even when most of the animation has elapsed.

```ts
lateEvent: { mode: 'seek' }
```

### `settled`

Immediately presents the final settled result. This is useful for compact logs, reduced-motion experiences, or applications that never want catch-up motion.

```ts
lateEvent: { mode: 'settled' }
```

### `replay`

Starts the deterministic replay from frame zero regardless of how late the event arrived. This is an explicit presentation choice and should not be used for synchronized table state by default.

```ts
lateEvent: { mode: 'replay' }
```

## Reconnect behavior

Reconnect responses may contain multiple missed roll and revision events. Replaying every historical animation would create a long visual backlog, so the high-level SDK:

1. applies all replayed events to logical roll state and logs;
2. identifies the newest replayed event that requested animation;
3. visually presents only that event;
4. seeks or settles it according to its actual elapsed time.

Older events remain available through the room log without being physically replayed.

## Seeking details

The physical animation is planned deterministically before display. When seeking:

- transform playback begins at the matching replay time;
- fallback coin, spinner, token, and card visuals begin at matching progress;
- impact sounds and effects that occurred before the seek point are skipped;
- the initial throw whoosh is not replayed during catch-up;
- result context and final values remain identical to an on-time playback.

If planning itself finishes after the scheduled start, Draftroll recalculates the elapsed time and catches up before showing the first visible frame.

## Low-level helpers

Applications using lower-level packages can use:

```ts
import { synchronizeRoomEvent } from '@draftroll/client';
import { resolveLateEventPresentation } from '@draftroll/renderer';
```

`synchronizeRoomEvent()` translates a room event using the measured clock offset. `resolveLateEventPresentation()` resolves `auto`, `seek`, `settled`, or `replay` into a replay seek position and settled-state decision.

## Limitations

- Network, browser scheduling, graphics initialization, and device performance can still introduce small visible differences.
- The current clock estimate is based on WebSocket round-trip samples rather than a dedicated high-frequency synchronization protocol.
- Late-event seeking requires the deterministic replay to be planned locally; it does not stream authoritative transform frames from the server.
- Browser-driven multi-device latency measurements remain part of the performance and integration test roadmap.
