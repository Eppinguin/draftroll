# Realtime diagnostics and recovery

`DiceRoom` exposes connection-state diagnostics, request metrics, bounded WebSocket replay, and optional durable long-range recovery.

## Connection diagnostics

```ts
room.on('connectionState', (diagnostic) => {
  console.log(diagnostic.state, diagnostic.code, diagnostic.recommendations);
});

console.log(room.connectionDiagnostics);
```

States are `idle`, `connecting`, `authenticating`, `synchronizing`, `open`, `reconnecting`, `closed`, and `failed`. Diagnostics include reconnect attempt, last event sequence, round-trip time, clock uncertainty, close code, backoff, and suggested corrective actions.

## Reconnect and long-range recovery

The client reconnects with capped exponential backoff. It sends the last applied event sequence. When the Durable Object's in-memory replay buffer no longer covers the gap, `room_state.missedEventsTruncated` triggers an authenticated request to `/rooms/:roomId/events`. Durable events are projected through the same visibility rules as live WebSocket traffic.

```ts
const room = await DiceRoom.connect({
  url,
  roomId,
  reconnect: true,
  reconnectDelayMs: 500,
  reconnectBackoffFactor: 1.8,
  reconnectMaximumDelayMs: 30_000,
  longRangeRecovery: true,
  token,
});
```

Event handling is serialized, de-duplicated by sequence, and ordered before the current room-state tail is applied.

Durable replay uses the current protocol-versioned pagination envelope only. Responses are read through a bounded streaming boundary, and each page must correlate its room, request cursor, next cursor, retained range, and room head. A persistence stall reconnects without advancing the cursor; corrupt data or a retention-truncated gap fails closed. Messages already queued on the affected socket are invalidated before they can cross that gap.

## Request metrics

```ts
const metrics = room.getRequestMetrics();
```

Metrics include started/completed/failed/timed-out/aborted requests, revision conflicts, request latency, reconnect attempts, replayed events, replay truncations, long-range recoveries, and hidden projections. These are process-local counters intended for host telemetry; the Worker manager diagnostics endpoint reports room-side state.

## Ambiguous outcomes

A network disconnect can occur after the Worker committed a request but before the acknowledgement reached the caller. Recent requests and bulk batches are idempotent, and longer request records are persisted in D1. Reuse a stable application request/client roll ID where provided, reconnect, and read the current authoritative roll before issuing a non-idempotent replacement.
