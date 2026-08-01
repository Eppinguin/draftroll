# Realtime identities, permissions, and hidden rolls

Draftroll rooms are anonymous by default in local development, but they are not identity-free. Every connection has an ephemeral participant and session identity. This lets the room correlate requests, assign roll ownership, enforce revisions, recover missed events, and project hidden results without requiring user accounts.

## High-level SDK usage

```ts
import { Draftroll } from '@draftroll/sdk';

const draftroll = await Draftroll.createOverlay({
  overlay: { src: '/draftroll/overlay.html' },
});

const room = await draftroll.connectRoom({
  url: 'wss://dice.example.com/rooms/table/connect',
  roomId: 'table',
  token: roomCapabilityToken,
  participant: {
    participantId: playerId,
    sessionId: browserSessionId,
    name: characterName,
    metadata: { avatarUrl },
  },
});

const attack = await room.roll(
  {
    mode: 'evaluate',
    expression: '2d20kh1+7',
    name: 'Longsword attack',
    metadata: {
      characterId,
      gameSystem: 'dnd5e',
      actionId: 'longsword',
    },
  },
  {
    clientRollId: crypto.randomUUID(),
    visibility: { type: 'public' },
  },
);

await attack.rerollDie('die_1');
await attack.updateLog({ annotation: 'Corrected by the GM' });
await attack.setFormula('2d20kh1+8');
```

The application metadata is stored and transported without Draftroll interpreting character, campaign, action, or game-system fields.

## Visibility policies

```ts
type RollVisibility =
  | { type: 'public' }
  | { type: 'roller' }
  | { type: 'roles'; roles: string[] }
  | { type: 'participants'; participantIds: string[] }
  | {
      type: 'participants-and-roles';
      participantIds: string[];
      roles: string[];
    };
```

Examples:

```ts
// Only the participant who owns the roll.
const secret = await room.roll('1d20+5', {
  visibility: { type: 'roller' },
});

// The roller and anyone with a GM capability.
const gmRoll = await room.roll('1d20+5', {
  visibility: { type: 'roles', roles: ['gm'] },
});

// A selected subset of participants.
const whisper = await room.roll('2d6+3', {
  visibility: {
    type: 'participants',
    participantIds: ['player-a', 'player-b'],
  },
});
```

## What an unauthorized participant receives

The Durable Object keeps the complete normalized result internally. Before sending an event to a WebSocket or returning history, it checks the current participant against the roll policy.

An authorized projection contains the normalized result and animation data:

```ts
{
  hidden: false,
  result: {
    total: 18,
    dice: [/* complete results */],
    expression: '1d20+5',
    // ...
  },
  animationSeed: '...',
  serverStartTimeMs: 1785456000000,
}
```

An unauthorized projection contains no result-bearing data:

```ts
{
  hidden: true,
  result: null,
  visibility: { type: 'hidden' },
  summary: {
    rollId: '...',
    revision: 0,
    name: 'Secret perception',
    actor: { participantId: '...', name: 'Aria' },
    createdAt: '...',
  },
}
```

The hidden projection excludes:

- die results and numeric values
- totals and integer totals
- expressions, operations, trees, and critical state
- annotations and result metadata
- custom-die definitions
- animation seeds and synchronized animation timing
- the real visibility rule

Client code does not receive a complete result and then hide it with CSS. Permission filtering occurs inside the Durable Object before each socket send and before HTTP history or revision responses.

## Revealing or changing access

Visibility changes revise the existing logical roll:

```ts
await secret.reveal();

await secret.setVisibility({
  type: 'participants',
  participantIds: ['player-a'],
});
```

The same `rollId` remains in use, `revision` increments, and newly authorized clients receive the complete current result through `roll_visibility_updated`.

Restricting a roll after it was public only affects future events, reconnects, history, and revision reads. Data already delivered to a client cannot be revoked.

## Optimistic revision protection

High-level room handles send their current revision automatically:

```ts
await attack.updateLog({ annotation: 'Corrected' });
```

The equivalent lower-level call is:

```ts
await room.room.updateRoll(attack.id, {
  annotation: 'Corrected',
}, {
  expectedRevision: attack.revision,
  animate: false,
});
```

A stale update rejects with `DiceRoomRequestError`:

```ts
try {
  await room.room.updateRoll(attack.id, {}, { expectedRevision: 0 });
} catch (error) {
  if (error instanceof DiceRoomRequestError && error.code === 'revision_conflict') {
    console.log(error.currentRevision);
  }
}
```

## Room capabilities without accounts

Secure deployments use short-lived, room-scoped capability tokens. Tokens can be issued by any trusted application backend; Draftroll does not require or maintain user accounts.

```ts
import {
  createGameMasterPermissions,
  createRoomCapabilityToken,
} from '@draftroll/server';

const token = await createRoomCapabilityToken({
  roomId: 'table',
  participantId: user.id,
  name: 'Game Master',
  roles: ['gm'],
  permissions: createGameMasterPermissions(),
}, {
  id: '2026-07',
  secret: process.env.DRAFTROLL_ROOM_SIGNING_KEY!,
}, {
  expiresInSeconds: 60 * 60,
  issuer: 'https://app.example.com',
  audience: 'draftroll-room',
});
```

Available permissions:

```ts
type RoomPermission =
  | 'roll:create'
  | 'roll:update-own'
  | 'roll:update-any'
  | 'roll:reveal-own'
  | 'roll:reveal-any'
  | 'roll:view-hidden'
  | 'room:manage';
```

The signing secret must remain on trusted servers. Browsers receive only the signed token.

### Local anonymous mode

`wrangler.jsonc` enables `ALLOW_ANONYMOUS=true` for local testing. Unsigned participants receive only:

- `roll:create`
- `roll:update-own`
- `roll:reveal-own`

Unsigned participant IDs are client-provided and therefore spoofable. Do not rely on unsigned anonymous identity for confidential rolls on a public deployment. Set `ALLOW_ANONYMOUS=false` and configure a verification key ring, issuer, audience, and required revocation claims before any future public deployment.

New deployments should use `ROOM_TOKEN_KEYS`, a JSON object mapping key IDs to secrets. `ROOM_TOKEN_SECRET` remains a legacy no-key-ID fallback. See `TOKEN_SECURITY.md` for rotation and revocation.

## Token rotation and revocation

Capability tokens support issuer and audience claims, issued-at and not-before timestamps, unique token IDs, and key IDs. A room manager can revoke one token ID or all tokens for a participant issued before a cutoff:

```ts
await session.revokeToken({
  type: 'participant',
  participantId: removedParticipantId,
  issuedAtOrBefore: Math.floor(Date.now() / 1000),
}, {
  reason: 'Removed from table',
});
```

The Durable Object checks revocation before returning room state, immediately disconnects matching token-authenticated sessions, and exposes the sequenced revocation event only to room managers. Complete tokens and signing material are never broadcast. See `TOKEN_SECURITY.md`.

## Room policy interaction

Permissions establish what a participant is capable of doing; the room policy establishes what the room currently allows. Both checks must pass. For example, a participant with `roll:reveal-own` still cannot reveal a roll when the active room policy disables participant-owned reveals.

Managers can update policy without replacing the room:

```ts
await session.setPolicy({
  authorization: {
    allowHiddenRolls: true,
    allowWhispers: false,
  },
  lifecycle: {
    staleSessionSeconds: 600,
  },
}, {
  expectedRevision: session.policyRevision,
});
```

The Durable Object applies the resulting policy to WebSocket commands, HTTP reads, participant admission, result sizes, visibility, revision retention, room expiry, and emergency shutdown. See `ROOM_HARDENING.md` for presets and all configurable controls.

## Request correlation and idempotency

Every mutating request has a `requestId`. The initiating session receives that ID on the authoritative response; other participants do not. An optional `clientRollId` lets an application correlate a roll with its own command or optimistic UI record.

```ts
const roll = await room.roll('1d20+4', {
  clientRollId: applicationCommandId,
});
```

`DiceRoom.roll()`, `displayRoll()`, `updateRoll()`, and `setRollVisibility()` resolve only after the corresponding authoritative room event arrives. Recent request IDs are cached in the Durable Object so a duplicate request can receive the original event instead of creating a second roll.

## Reconnect recovery

The client tracks a monotonic `eventSequence`, separate from a roll's stable creation-order `sequence`. Updates and reveals advance `eventSequence` without changing the roll sequence.

On reconnect, the client sends its last processed event sequence. The Durable Object returns permission-projected missed events from a bounded buffer.

```ts
room.room.getLastEventSequence();
```

`room_state.missedEventsTruncated` indicates that the reconnect cursor predates the retained buffer. An integration can then request HTTP history to rebuild its room log.

## Participant presence

Rooms expose:

- `session_ready`
- `participant_joined`
- `participant_updated`
- `participant_left`
- current participants in `room_state`

```ts
room.on('participantJoined', ({ participant }) => {
  console.log(`${participant.name} joined`);
});

room.updateParticipant({ name: 'Aria the Bold' });
```

Participant identity is generic. Applications may use it for characters, players, bots, stream overlays, or other actors.
