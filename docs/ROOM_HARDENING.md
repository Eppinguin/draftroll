# Room policies and service hardening

Draftroll rooms use a versioned `RoomPolicy` that is stored and enforced inside the room Durable Object. Applications receive the current policy in `room_state`, and policy changes are sequenced, request-correlated room events.

This work is pre-release. Package versions and protocol version remain unchanged, and nothing in this project snapshot is deployed automatically.

## Policy presets

Draftroll includes three generic presets:

- `open-table`: participants can roll, update and reroll their own rolls, reveal their own hidden rolls, and use hidden or targeted visibility.
- `private-gm-table`: participants can roll and revise their own rolls, but revealing hidden rolls is controlled by privileged participants.
- `moderated-public-room`: hidden/targeted rolls and participant-owned revisions are disabled, with tighter rate and result limits.

Create or customize a policy:

```ts
import { applyRoomPolicyPatch, createRoomPolicy } from '@draftroll/protocol';

const base = createRoomPolicy('moderated-public-room');
const policy = applyRoomPolicyPatch(base, {
  limits: {
    maximumParticipants: 24,
    maximumDicePerRoll: 80,
  },
  rateLimits: {
    rollsPerMinutePerRoom: 120,
  },
});
```

A customized preset is reported as `preset: "custom"`.

## Realtime policy API

Policy changes require the `room:manage` capability and use optimistic concurrency:

```ts
const updated = await room.setPolicy(
  {
    authorization: {
      allowWhispers: false,
    },
    limits: {
      maximumParticipants: 12,
    },
  },
  {
    expectedRevision: room.policyRevision,
  },
);

console.log(updated.revision);
console.log(updated.policy);
```

The higher-level SDK exposes the same operation:

```ts
await session.setPolicy({
  rateLimits: {
    rollsPerMinutePerRoom: 60,
  },
});
```

Every successful update produces `room_policy_updated`. It is included in reconnect replay and in `room_state.recentEvents`. `room_state.recentRolls` remains available as a roll-only compatibility view.

## Optional room passwords

A room may use an optional password as a secondary access gate. Passwords do not replace participant capability tokens: capabilities determine identity and permissions, while the room password determines whether a non-manager connection may enter the room.

Set, replace, or remove the password through a participant with `room:manage`:

```ts
await room.setPassword('correct horse battery staple', {
  expectedRevision: room.policyRevision,
});

await room.setPassword(null); // remove protection
```

Connect through the lower-level client or high-level SDK:

```ts
const room = await DiceRoom.connect({
  url: 'wss://dice.example.com/rooms/table/connect',
  roomId: 'table',
  roomPassword: enteredPassword,
  participant: { name: 'Aria' },
});
```

Security behavior:

- The password is sent only after the encrypted WebSocket has opened. It is never placed in the URL.
- The Durable Object stores a random-salted PBKDF2-SHA-256 verifier, not plaintext.
- Comparisons use a constant-time byte comparison.
- Password attempts are rate-limited per IP and room; one socket is closed after repeated failures.
- Before authentication, the socket receives no participant list, room state, roll history, replay events, formulas, totals, or dice results.
- Room events and policy state expose only `access.passwordProtected`; they never contain password material.
- Trusted `room:manage` capability tokens bypass the password so an application backend or room administrator cannot be locked out.
- Existing authenticated sockets remain connected when a password is changed. New non-manager connections must use the new password.

Passwords must contain 8 to 256 characters.

Protected HTTP state/history requests use a header rather than a query parameter:

```ts
const response = await fetch(
  room.authorizeHttpRequest('https://dice.example.com/rooms/table/history?limit=50'),
);
```

The helper sends `X-Draftroll-Room-Password` when the room client was configured with `roomPassword`.

## Authorization controls

A policy controls:

- participant-created rolls
- own-roll updates
- own-roll rerolls
- own-roll reveal/visibility changes
- privileged updates of any roll
- privileged reveal of any roll
- hidden rolls
- role- or participant-targeted whisper rolls

Capability permissions and room policy are both required. A token cannot grant an action that the current room policy disables.

## Resource limits

The Durable Object enforces:

- maximum participants
- maximum inbound WebSocket message bytes
- maximum expression length
- maximum dice per result
- maximum operations per result
- maximum participant metadata bytes
- maximum replay-buffer events
- maximum retained logical rolls
- maximum retained revisions per roll

Limits are checked before evaluation where possible and again against the normalized authoritative result.

## Rate limits

Fixed one-minute limits are maintained in Durable Object storage for:

- connection attempts per IP and room
- room-password attempts per IP and room
- commands per session
- mutations per participant
- new rolls per room

A rejected realtime request returns `roll_error` with:

```ts
{
  code: 'rate_limited',
  retryAfterMs: 12000,
  limit: 'rolls_per_minute_per_room'
}
```

The current per-IP counter is scoped to a room Durable Object. A deployment needing one IP limit across all rooms should add Cloudflare's edge Rate Limiting binding in front of the Worker.

## Presence and room expiry

The policy configures:

- stale session timeout
- room idle expiry
- maintenance-alarm cadence

Each command refreshes the session's `lastSeenAt` value. Durable Object alarms close stale sockets. An idle room with no participants has its Durable Object state removed after the configured expiry. Persisted D1 history follows the separate history-retention policy.

## History and revision retention

D1 persistence uses bounded retry/backoff. After a successful write, Draftroll enforces:

- maximum logical rolls retained for a room
- maximum revisions retained for a roll
- time-based current-roll retention
- time-based revision retention
- orphaned revision cleanup

Persistence failures are recorded in a capped Durable Object failure list and emitted as structured logs. They do not block the hot realtime broadcast path.

## Emergency shutdown

Managers can disable a room without deleting it:

```ts
await room.setPolicy({
  enabled: false,
  shutdownReason: 'Table paused by moderator',
});
```

Non-manager roll mutations are rejected while disabled. A manager can remain connected and re-enable the room.

## Origin enforcement

Browser requests and WebSocket upgrades are rejected when their `Origin` is not included in `ALLOWED_ORIGINS`. Requests without an `Origin`, such as trusted server-to-server clients, remain supported.

Local Wrangler configuration uses:

```json
{
  "ALLOWED_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173",
  "ROOM_POLICY_PRESET": "open-table"
}
```

See `TOKEN_SECURITY.md` for issuer/audience claims, key rotation, and revocation.

## Deployment-owner follow-through

Repository-level hardening is implemented. Operators still need to:

- add edge-wide per-IP limiting if one shared budget across all room Durable Objects is required
- populate real environment secrets, D1 IDs, origins, and domains
- run the provided staging/production smoke, monitoring, and rotation procedures
- install browser dependencies and retain controlled performance/security reports

Persistent D1 idempotency, long-range event recovery, renderer policy defaults, request metrics, manager diagnostics, alert guidance, incident response, and rollback procedures are implemented.
