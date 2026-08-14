# Room capability-token security

Draftroll room capability tokens are account-independent, room-scoped credentials issued by a trusted embedding application. They authorize a participant inside one room without requiring Draftroll-managed users or sessions.

Package and protocol versions remain unchanged during pre-release implementation. No deployment is performed by this project snapshot.

## Secure credential transport

Browser clients do not place capability tokens in WebSocket or HTTP URLs.

For WebSockets, the client opens a `wss:` connection without the token. A non-secret `authMode=token` hint ensures the credential path is used even on development servers that also permit anonymous rooms. The Durable Object initially exposes no room state and returns `token_required`. The client then submits `authenticate_room_token` inside the encrypted WebSocket session. Only after successful verification does the server send `session_ready`, participant state, reconnect events, or roll history.

For HTTP room requests, `DiceRoom.authorizeHttpRequest()` sends the token through `Authorization: Bearer` and keeps the URL free of credentials:

```ts
const request = room.authorizeHttpRequest('https://dice.example.com/rooms/table-42/history');
const response = await fetch(request);
```

Query-string capability tokens are rejected. WebSocket clients must use the post-open authentication command, and HTTP clients must use the authorization header. Tokens must not be written to access logs, analytics URLs, referrers, or exception messages.

## Claims

New tokens include:

- `roomId`: the only room in which the token is valid
- `participantId`: stable application identity inside the room
- `sessionId`: optional fixed connection identity
- `roles` and `permissions`
- `iss`: optional issuer
- `aud`: optional audience or audience list
- `iat`: issued-at time
- `nbf`: optional not-before time
- `exp`: optional expiry
- `jti`: unique token ID used for exact revocation

Newly created tokens receive `iat` and `jti` automatically. Production issuers should also set `exp`, `iss`, and `aud`.

## Key IDs and rotation

Use a named signing key:

```ts
import { createGameMasterPermissions, createRoomCapabilityToken } from '@draftroll/server';

const token = await createRoomCapabilityToken(
  {
    roomId: 'table-42',
    participantId: user.id,
    name: 'Game Master',
    roles: ['gm'],
    permissions: createGameMasterPermissions(),
  },
  {
    id: '2026-07',
    secret: process.env.DRAFTROLL_ROOM_SIGNING_KEY!,
  },
  {
    expiresInSeconds: 60 * 60,
    issuer: 'https://app.example.com',
    audience: 'draftroll-room',
  },
);
```

The token header contains the key ID. The Worker accepts a verification ring through `ROOM_TOKEN_KEYS`:

```json
{
  "2026-04": "previous-secret-at-least-16-characters",
  "2026-07": "current-secret-at-least-16-characters"
}
```

Rotation procedure:

1. Add the new verification key while retaining the previous key.
2. Begin issuing new tokens with the new key ID.
3. Wait until every token signed by the previous key has expired or been revoked.
4. Remove the previous key from the verification ring.

`ROOM_TOKEN_SECRET` remains a legacy no-key-ID verification fallback. New deployments should prefer `ROOM_TOKEN_KEYS`.

## Issuer and audience enforcement

Configure the Worker with:

- `ROOM_TOKEN_ISSUER`: exact required issuer
- `ROOM_TOKEN_AUDIENCE`: one or more accepted audiences separated by commas
- `ROOM_TOKEN_REQUIRE_JTI=true`: require both `jti` and `iat`

When issuer or audience configuration is present, tokens missing or mismatching those claims are rejected before room state is returned.

## Detailed verification

Trusted server code can inspect stable verification failures:

```ts
import { verifyRoomCapabilityTokenDetailed } from '@draftroll/server';

const verification = await verifyRoomCapabilityTokenDetailed(token, verificationKeys, {
  roomId: 'table-42',
  issuer: 'https://app.example.com',
  audience: 'draftroll-room',
  requireTokenId: true,
  requireIssuedAt: true,
});

if (!verification.valid) {
  console.error(verification.code, verification.message);
}
```

Failures distinguish malformed tokens, unknown key IDs, bad signatures, expiry, not-before time, issuer/audience mismatch, room mismatch, missing revocation claims, and revocation.

## Revocation

Room managers can revoke one token ID:

```ts
await room.revokeToken(
  {
    type: 'token',
    tokenId: compromisedTokenId,
    expiresAt: compromisedTokenExpiry,
  },
  {
    reason: 'Compromised browser session',
  },
);
```

Or revoke all tokens for one participant issued at or before a cutoff:

```ts
await room.revokeToken(
  {
    type: 'participant',
    participantId: removedParticipantId,
    issuedAtOrBefore: Math.floor(Date.now() / 1000),
  },
  {
    reason: 'Removed from table',
  },
);
```

Participant cutoffs allow newly issued tokens to reconnect because their `iat` is later than the cutoff.

The Durable Object:

- stores revocations inside the room
- checks them before returning room state or accepting a WebSocket
- emits a sequenced `room_token_revoked` event to room managers only
- replays that event only to room managers
- immediately closes matching token-authenticated sessions
- never places signing keys or complete tokens in events or logs

Exact revocations with a known token expiry are deleted after expiry. Exact revocations without an expiry remain retained; the room refuses additional exact records at the safety cap rather than silently forgetting an active revocation. Participant cutoffs remain retained until the room expires or is reset.

## Legacy tokens

The verifier continues to accept the earlier two-part `payload.signature` token format during pre-release migration. Legacy tokens do not carry a key ID and may not carry `iat` or `jti`. Configure `ROOM_TOKEN_REQUIRE_JTI=true` after all issuers have migrated when revocation guarantees are required.

## Security boundaries

- Signing material belongs only in trusted server environments.
- Browser applications receive signed tokens, never signing keys.
- Tokens should be short lived and limited to one room.
- Room passwords and capability tokens are independent controls; a manager token can bypass the shared room-password prompt.
- Revoking a token prevents future authorized access. It cannot remove data already delivered while the token was valid.
