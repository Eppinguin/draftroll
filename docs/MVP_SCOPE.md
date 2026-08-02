# Draftroll MVP scope

## Product decision: no accounts

Draftroll does not require user accounts, login, organizations, subscriptions, or account-linked room ownership.

Connected rooms still use **ephemeral participant identity** because real-time software needs to identify request owners, correlate responses, enforce roll revisions, recover missed events, and decide which sockets may receive hidden results. A participant or session is not a Draftroll account.

```ts
const room = await draftroll.connectRoom({
  url: 'ws://127.0.0.1:8787/rooms/table/connect',
  roomId: 'table',
  participant: {
    participantId: 'player-a',
    sessionId: 'browser-tab-a',
    name: 'Aria',
  },
});
```

## Trusted local mode and secure hosted mode

Local Wrangler development enables unsigned anonymous participants. They can create rolls and update or reveal their own rolls.

A public deployment should disable unsigned anonymous access and use short-lived, room-scoped capability tokens issued by the embedding application's backend. Tokens grant roles and permissions without creating a Draftroll account database.

```ts
const token = await createRoomCapabilityToken(
  {
    roomId,
    participantId,
    roles: ['player'],
    permissions: createDefaultParticipantPermissions(),
  },
  secret,
  { expiresInSeconds: 3600 },
);
```

## Implemented MVP priorities

1. Complete and predictable d20-compatible expression behavior.
2. Developer-friendly local, structured, external, overlay, and room APIs.
3. Stable roll handles, revisions, rerolls, and audit history.
4. Server-enforced hidden results and visibility revisions.
5. Request correlation, participant presence, and reconnect event recovery.
6. Per-die themes, mixed physical dice, and result presentation.
7. Reliable pnpm and local Wrangler workflows.

## Rules-engine MVP boundary

The TypeScript rules engine is MVP-complete for the documented d20 expression language and equivalent notation-free operation families. It also supports portable custom weighted, repeated-face, and symbolic dice.

“Rules complete” does not mean every possible die has a dedicated rigid-body mesh. Draftroll now supplies synchronized token, spinner, coin, card, and percentile fallbacks for unsupported shapes; dedicated physical meshes and custom face painting remain optional visual enhancements.

## Realtime privacy boundary

The Durable Object owns the complete authoritative result. It projects a participant-specific event before each WebSocket send and before returning history or revision data.

Unauthorized clients receive `result: null` and do not receive expression data, totals, dice, operations, critical state, result metadata, custom-die definitions, animation seeds, or the real visibility rule.

Supported visibility policies:

- public
- roller only
- selected roles
- selected participants
- selected participants or roles

Visibility changes increment the existing roll revision and preserve its stable `rollId`.

## Explicitly outside the current workstream

- Publishing packages to npm or another public registry.
- Public release automation, marketing, billing, plans, or entitlements.
- Draftroll-managed user profiles, campaigns, or account-linked storage.
- Product-specific adapters embedded into the core SDK.

Example applications such as character sheets should integrate through the same generic roll, participant, metadata, visibility, and revision primitives as any other website or game.

## Safeguards still required before broad public exposure

The permission model, room limits, rate limits, expiry, retention, origin checks, issuer/audience validation, key-ID verification rings, and room-scoped revocation are implemented. A public service still needs deployment-specific controls:

- secure signing-key storage and a practiced rotation procedure
- edge-wide abuse controls when one IP budget must span many room Durable Objects
- metrics, dashboards, alerts, incident handling, and rollback
- browser, cross-origin, reconnect, and adversarial permission tests
- measured latency and resource budgets

These are infrastructure protections, not an account system.
