# Optional room passwords

Draftroll rooms can require an optional shared password in addition to their normal anonymous participant or signed capability-token authorization.

Passwords are a room access gate, not an account system. Applications that need role assignment, privileged moderation, or hidden-roll permissions should continue to use room-scoped capability tokens.

## Join a protected room

```ts
const room = await draftroll.connectRoom({
  url: 'wss://dice.example.com/rooms/table/connect',
  roomId: 'table',
  roomPassword: passwordFromJoinForm,
  participant: {
    participantId,
    sessionId,
    name: 'Aria',
  },
});
```

`connect()` resolves only after the Durable Object has accepted the password and sent `session_ready`.

When no password is supplied, a protected room rejects with `DiceRoomPasswordRequiredError`. An incorrect password rejects with `DiceRoomPasswordError`.

## Set, replace, or remove a password

A participant with `room:manage` can update the password. The operation uses the room policy revision for optimistic concurrency.

```ts
await room.setPassword('correct horse battery staple', {
  expectedRevision: room.policyRevision,
});

await room.setPassword('a new password');
await room.setPassword(null); // remove password protection
```

Changing the password does not change the room ID. Existing authenticated sockets stay connected. New non-manager connections must use the current password.

## Protected HTTP requests

State, history, policy, and revision endpoints use the `X-Draftroll-Room-Password` header. The password is never placed in a URL.

```ts
const request = room.room.authorizeHttpRequest(
  'https://dice.example.com/rooms/table/history?limit=50',
);
const response = await fetch(request);
```

The lower-level `DiceRoom` exposes the same `authorizeHttpRequest()` helper directly.

## Security behavior

- The client sends the password only after the encrypted WebSocket is open.
- The Durable Object stores a random-salted PBKDF2-SHA-256 verifier, never plaintext.
- Comparisons use a constant-time byte comparison.
- Passwords must contain 8 to 256 characters.
- Attempts are rate-limited per IP and room, with an additional per-socket failure cap.
- Before authentication, a socket receives no room state, participant list, replay events, formulas, totals, dice, or history.
- Events and public policy state expose only `policy.access.passwordProtected`.
- Password material is excluded from structured logs, D1 history, revision history, reconnect buffers, and room events.
- A valid `room:manage` capability bypasses the password gate so trusted administrators and application backends cannot be locked out.

A shared password identifies knowledge of the password, not a specific person. Use short-lived signed capability tokens when an application needs participant-specific permissions, revocation, or stronger identity guarantees.
