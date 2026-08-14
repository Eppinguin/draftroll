# Draftroll SDK

Draftroll is a local-first TypeScript dice engine, normalized-result model, embeddable 3D overlay, result display, and optional anonymous realtime room service.

## Stable lifecycle session

Use `DraftrollSession` when one application object must survive local/realtime switches and renderer attachment changes:

```ts
import { DraftrollSession } from '@draftroll/sdk';

const session = new DraftrollSession();
session.on('roll', (roll) => updateLog(roll.id, roll.result));

await session.roll('1d20+5');
await session.connectRoom({ url, roomId, participant: { name: 'Aria' } });
await session.roll('1d20+5', { visibility: { type: 'public' } });

await session.disableRenderer();
session.useLocal();
await session.dispose();
```

The same engine, custom dice, local history, unified roll log, and subscriptions remain available across transitions. See [Lifecycle-managed SDK session](LIFECYCLE_SESSION.md).

## Website integration

```ts
import { Draftroll } from '@draftroll/sdk';

const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: '/draftroll/overlay.html',
    dismissOnPointer: true,
    dismissIgnoreSelector: '[data-draftroll-roll-control]',
    results: {
      position: 'top-right',
      allowReroll: true,
    },
  },
});

const attack = draftroll.roll({
  expression: '2d20kh1+5 [Attack]',
  themes: ['dragon', 'frost'],
});

console.log(attack.id, attack.total, attack.dice);
await attack.wait();
```

The transparent dice iframe does not intercept pointer input from the host website. Mounting or warming the renderer creates no visible dice. After a throw completes, the next host-page pointer click dissolves the physical dice by default. The result panel is rendered in an isolated Shadow DOM and can remain interactive.

For synchronized room events, the SDK translates the Durable Object clock into a local start time and automatically seeks late deterministic replays. In the default `auto` mode, moderately late events catch up while events that arrive after most motion has elapsed are presented already settled. See `LATE_EVENT_SYNCHRONIZATION.md`.

```ts
await draftroll.dismiss({ durationMs: 240 });
await draftroll.clearDice();
```

## Present an existing normalized result

Adapters and room clients can render a result without changing its local/server/external authority:

```ts
const presentation = draftroll.present(serverResult, {
  startTime: synchronizedStart,
  animationSeed,
});
await presentation.wait();

// Replace the transient result/log display without physical replay.
draftroll.presentUpdate(revisedServerResult);
```

## Late-event presentation

Manual presentations can select the late-event policy explicitly:

```ts
await draftroll
  .present(serverResult, {
    startTime: localStartTimeMs,
    animationSeed,
    elapsedMs,
    animationDurationMs: 2800,
    lateEvent: {
      mode: 'auto', // auto | seek | settled | replay
      settleAfterProgress: 0.78,
    },
  })
  .wait();
```

`Draftroll.connectRoom()` supplies these values automatically. Reconnect catch-up updates every logical roll but animates only the newest missed animated event, avoiding a backlog of historical throws.

## Simple expression API

```ts
const roll = draftroll.roll('4d6kh3 + 2');
await roll.wait();
```

Object form keeps call sites readable as options grow:

```ts
const roll = draftroll.roll({
  expression: '1d20 + 7',
  advantage: 'advantage',
  allowComments: true,
  themes: 'tempest',
  metadata: { actorId: 'rogue', action: 'stealth' },
});
```

## Validation and safe errors

```ts
const validation = draftroll.validate(input);
if (!validation.valid) {
  const issue = validation.diagnostics[0];
  showFormulaError(issue.message, issue.range, issue.suggestions);
}

const attempted = draftroll.tryRoll(input);
if (!attempted.ok) showError(attempted.error.message);
```

## Formula profiling

Attach an optional instrumentation sink when investigating complex or untrusted formulas:

```ts
const draftroll = new Draftroll({
  instrumentation: {
    onProfile(profile) {
      if (profile.durationMs > 5 || profile.status === 'error') {
        console.debug(profile);
      }
    },
  },
});
```

Profiles cover parser cache behavior, AST complexity, evaluation work, generated dice, rerolls, explosions, and failures. See [Parser and evaluator profiling](PROFILING.md).

## Reusable formulas and formatting

Frequently used formulas can be parsed once and rolled repeatedly:

```ts
const attack = draftroll.compile('2d20kh1 + 7');
const first = attack.roll();
const second = attack.roll();
```

Format either a normalized result or a Draftroll roll handle:

```ts
const roll = draftroll.roll('4d6kh3', { render: false });
console.log(draftroll.format(roll, { style: 'plain' }));
console.log(draftroll.stringify(roll, (result) => `${result.total} damage`));
```

## Events

```ts
const offRoll = draftroll.on('roll', (roll) => {
  console.log('new roll', roll.id, roll.total);
});

const offUpdate = draftroll.on('update', (roll) => {
  console.log('revised', roll.result.revision);
});

const offError = draftroll.on('error', ({ error }) => {
  console.error(error);
});
```

Each subscription returns an unsubscribe function.

## Per-die themes

```ts
draftroll.roll('3d6+2', {
  themes: ['tempest', 'ember', 'wildwood'],
});
```

Theme selection accepts one theme string, an ordered array, a die-ID map, or a resolver function.

## Reroll APIs

```ts
const roll = draftroll.roll('2d20kh1+5');

const oneDie = roll.rerollDie('die_2');
const selected = roll.rerollDice(['die_1', 'die_2']);
const wholeRoll = roll.reroll();
```

Expression rolls preserve unselected initial values and then evaluate the entire expression again. Keep/drop, rerolls, explosions, success counting, arithmetic, comparisons, and totals are recalculated.

## Correct or replace a completed roll

Log-only corrections are the default:

```ts
const corrected = roll.setDieResult('die_1', 20);
await corrected.wait();
```

Change the formula without replaying the dice:

```ts
const revised = roll.setFormula('3d20kh1+7');
```

Animate a revision:

```ts
const revised = roll.animateUpdate(
  {
    expression: '3d20kh1+7',
  },
  {
    reroll: true,
    animateDice: 'all',
  },
);
```

Explicit log-only form:

```ts
roll.updateLog({
  annotation: 'Corrected by the GM',
  dice: [{ id: 'die_2', result: 18, themeId: 'ember' }],
});
```

The logical roll ID and original creation time remain stable. The revision number increments, the current log entry is replaced, and immutable revision snapshots remain accessible.

```ts
draftroll.getRoll(roll.id);
draftroll.getRollRevisions(roll.id);
draftroll.rollLog;
```

## Structured game API

Game integrations do not need to generate notation strings. Use plain typed objects or the optional factories:

```ts
import { dice, operations as op, selectors as select } from '@draftroll/sdk';

const damage = draftroll.rollDice({
  dice: [dice.d6('fire', { themeId: 'ember' }), dice.d8('ice', { themeId: 'frost' })],
  modifier: 3,
  render: false,
});

const dicePool = draftroll.rollDice({
  dice: Array.from({ length: 8 }, (_, index) => dice.d6(`pool_${index + 1}`)),
  operations: [
    op.rerollOnce(select.equal(1)),
    op.explode(select.equal(6)),
    op.countSuccesses(select.greaterOrEqual(5)),
  ],
});
```

All operation families are available structurally: keep/drop, reroll until clear, reroll once, reroll and add, explode, minimum, maximum, and success count. Advantage/disadvantage is explicit in this layer: provide two d20 dice and `op.keepHighest(1)` or `op.keepLowest(1)`. Operations can be scoped to stable source-die IDs:

```ts
op.reroll(select.lessThan(3), ['attack_1', 'attack_2']);
op.keepHighest(1, ['attack_1', 'attack_2']);
```

Plain protocol objects remain valid when a game already has its own rules schema:

```ts
const pool = draftroll.rollDice({
  dice: [{ id: 'check', type: 'd20' }],
  operations: [
    {
      type: 'minimum',
      target: 5,
      dice: ['check'],
    },
  ],
});
```

## Weighted and symbolic custom dice

```ts
const draftroll = new Draftroll();

draftroll.registerDie({
  id: 'action',
  faces: [
    { result: 'success', value: 1, weight: 2 },
    { result: 'complication', value: -1, weight: 1 },
    { result: 'blank', value: 0, weight: 3 },
  ],
});

const result = draftroll.rollDice({
  dice: [
    { id: 'action_1', type: 'action', customDiceId: 'action' },
    { id: 'action_2', type: 'action', customDiceId: 'action' },
  ],
  render: false,
});
```

Symbolic faces expose both `result` and `numericValue`. They support repeated results through `faceIndex`, with the selected face's label and metadata returned separately as `faceLabel` and `faceMetadata`. They also support the complete structured operation set, individual rerolls, and completed-roll revisions. Definitions can be inspected with `getDie()` and `listDice()`, or removed with `unregisterDie()`. The optional `commonDice` export builds portable coin, six-face Fate, atomic percentile-pair, symbol-pool, weighted table, and card definitions; see [Common nonstandard dice helpers](COMMON_DICE.md). The renderer presents custom results through synchronized coin/percentile/Fate/spinner/token/card fallbacks unless a future compatible custom physical mesh is available.

For a portable request—especially a server-authoritative room roll—include definitions inline. Draftroll retains them in the normalized result so later room rerolls and revisions do not depend on process-local registration:

```ts
await room.roll({
  mode: 'evaluate',
  customDice: [
    {
      id: 'action',
      faces: [
        { result: 'success', value: 1, weight: 2 },
        { result: 'blank', value: 0, weight: 3 },
      ],
    },
  ],
  dice: [
    { id: 'action_1', type: 'action', customDiceId: 'action' },
    { id: 'action_2', type: 'action', customDiceId: 'action' },
  ],
  operations: [
    {
      type: 'success-count',
      selector: { type: 'greater-equal', target: 1 },
    },
  ],
});
```

## Exact external result mode

```ts
const shown = draftroll.display({
  dice: [
    { id: 'attack', type: 'd20', result: 17, themeId: 'dragon' },
    { id: 'damage', type: 'd8', result: 7, themeId: 'ember' },
  ],
  total: 24,
});
```

Draftroll does not reroll external values unless the host explicitly invokes a reroll or update API.

## Headless core

```ts
import { DiceEngine, formatRollResult } from '@draftroll/core';

const engine = new DiceEngine();
const result = engine.roll('4d6kh3');
console.log(formatRollResult(result));
```

See `docs/D20_COMPATIBILITY.md` for the complete expression syntax and result-tree API.

## Anonymous connected rooms

```ts
const room = await DiceRoom.connect({
  url: 'ws://127.0.0.1:8787/rooms/table-1/connect',
  roomId: 'table-1',
});

const unbind = draftroll.bindRoom(room);
room.markReady();
await room.roll({
  mode: 'evaluate',
  name: 'Mara Voss',
  expression: '1d20 + 1d8 + 2d6 + 5',
  metadata: { actionName: 'Hunter strike' },
});
```

Draftroll does not require accounts or user API keys. Local development can allow unsigned anonymous participants; secure deployments should issue short-lived, room-scoped capability tokens and disable `ALLOW_ANONYMOUS`. The Durable Object enforces permissions and filters hidden results before sending them to clients. See `docs/REALTIME_PERMISSIONS.md`.

### Password-protected rooms

Room passwords are optional and server-enforced. Supply one through `roomPassword`; Draftroll waits for successful authentication before resolving `connect()` and before allowing room commands:

```ts
const room = await draftroll.connectRoom({
  url: 'wss://dice.example.com/rooms/table/connect',
  roomId: 'table',
  roomPassword: passwordFromYourJoinForm,
  participant: {
    participantId,
    sessionId,
    name: 'Aria',
  },
});
```

Missing and invalid passwords reject with `DiceRoomPasswordRequiredError` and `DiceRoomPasswordError`. The password is not added to the WebSocket URL.

A room manager can set or remove protection without changing the room ID:

```ts
await room.setPassword('correct horse battery staple');
await room.setPassword(null);
```

The operation uses the same optimistic policy revision and `roomPolicyUpdated` event as other room-management changes. Public policy state contains only `policy.access.passwordProtected`.

For HTTP history/state calls, use `authorizeHttpRequest()` so the password is sent in `X-Draftroll-Room-Password` rather than the URL:

```ts
const history = await fetch(room.room.authorizeHttpRequest(historyUrl));
```

## Room policies and service limits

Room behavior is controlled by a generic, versioned policy stored in the room Durable Object. Policies are not tied to a character sheet, VTT, or game system. They govern authorization, visibility, resource limits, rate limits, retention, and room lifecycle.

The current policy and its optimistic-concurrency revision are available on both the lower-level client and the high-level session:

```ts
console.log(room.policy);
console.log(room.policyRevision);

const updated = await room.setPolicy(
  {
    authorization: {
      allowWhispers: false,
    },
    limits: {
      maximumParticipants: 12,
      maximumDicePerRoll: 100,
    },
    rateLimits: {
      rollsPerMinutePerRoom: 90,
    },
  },
  {
    expectedRevision: room.policyRevision,
  },
);
```

Policy updates require `room:manage`. Capability permissions and policy authorization are both enforced: a signed token cannot bypass a room policy that disables an action. Successful changes emit `roomPolicyUpdated` and are included in reconnect replay.

Built-in presets are `open-table`, `private-gm-table`, and `moderated-public-room`. Applications may start from a preset and apply a partial patch through helpers exported by `@draftroll/protocol`. See `docs/ROOM_HARDENING.md`.

Rate-limit failures use `DiceRoomRequestError` with `code === 'rate_limited'`, `retryAfterMs`, and a stable `limit` identifier. Revision conflicts use `code === 'policy_revision_conflict'` and expose the current policy revision.

## Physical renderer boundary

The supplied 3D engine can combine `d2`, `d4`, `d6`, `d8`, `d10`, `d12`, and `d20` in one physical throw. Each physical die has its own Three.js mesh, Cannon collision shape, requested result, theme, trajectory, and replay entry; d2 uses a thin coin body that collides with the other dice. Custom coins, percentile results, Fate dice, arbitrary dN, symbolic faces, and weighted/custom table results are represented by synchronized coin, spinner, token, or card visuals. Physical and fallback components can share one roll, and fallback-only rolls are supported. See `VISUAL_FALLBACKS.md`.

## High-level realtime rooms

Use `Draftroll.connectRoom()` when an application wants synchronized rolls without managing WebSocket correlation, renderer timing, reconnect cursors, or roll revision merging.

```ts
const draftroll = await Draftroll.createOverlay({
  overlay: { src: '/draftroll/overlay.html' },
});

const room = await draftroll.connectRoom({
  url: 'wss://dice.example.com/rooms/table/connect',
  roomId: 'table',
  token: roomToken,
  participant: {
    participantId: playerId,
    sessionId,
    name: characterName,
  },
});

const roll = await room.roll(
  {
    mode: 'evaluate',
    expression: '2d20kh1+7',
    name: 'Attack',
    metadata: { characterId, actionId: 'longsword' },
  },
  {
    clientRollId: commandId,
    visibility: { type: 'public' },
  },
);

await roll.rerollDie('die_1');
await roll.updateLog({ annotation: 'Corrected' });
await roll.animateUpdate({ expression: '2d20kh1+8' }, { reroll: true });
```

A `DraftrollRoomRoll` is a stable handle for one logical roll. Its identity does not change when dice are rerolled, the formula is corrected, or visibility changes.

```ts
roll.id;
roll.result; // null when this participant is not authorized
roll.hidden;
roll.actor;
roll.visibility;
roll.revision;

await roll.setVisibility({ type: 'roller' });
await roll.reveal();
```

The high-level session automatically uses the handle's current revision as `expectedRevision`. Stale mutations fail instead of silently overwriting a newer update.

Applications that need lower-level protocol control can use `DiceRoom` directly. Its request methods resolve with authoritative synchronized events rather than returning only request IDs.

See `REALTIME_PERMISSIONS.md` for server-enforced hidden results, capability tokens, participant presence, and reconnect recovery.

## Server-side room tokens

`@draftroll/server` contains backend-only helpers for short-lived room capabilities:

```ts
import { createDefaultParticipantPermissions, createRoomCapabilityToken } from '@draftroll/server';

const token = await createRoomCapabilityToken(
  {
    roomId,
    participantId,
    name,
    roles: ['player'],
    permissions: createDefaultParticipantPermissions(),
  },
  {
    id: '2026-07',
    secret: roomTokenSecret,
  },
  {
    expiresInSeconds: 3600,
    issuer: 'https://app.example.com',
    audience: 'draftroll-room',
  },
);
```

Do not expose the signing secret to browser code. New tokens automatically include `iat` and `jti`; use a named key, issuer, audience, and expiry for future production deployments.

Room managers can revoke one token or a participant's earlier tokens through the high-level session:

```ts
await session.revokeToken(
  {
    type: 'token',
    tokenId,
    expiresAt: tokenExpiry,
  },
  {
    reason: 'Compromised session',
  },
);
```

See `TOKEN_SECURITY.md` for verification rings, key rotation, and revocation behavior.

## Runtime themes

The overlay accepts any `ThemeProvider`. Theme manifests are validated and their resources are loaded by the host before being installed into the isolated renderer iframe.

```ts
import { BundledThemeProvider, DRAFTROLL_THEME_SCHEMA_VERSION, Draftroll } from '@draftroll/sdk';

const themeProvider = new BundledThemeProvider([
  {
    schemaVersion: DRAFTROLL_THEME_SCHEMA_VERSION,
    id: 'obsidian',
    name: 'Obsidian',
    version: '1.0.0',
    availableDice: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'],
    material: {
      color: '#17131f',
      roughness: 0.36,
      metalness: 0.42,
    },
    labels: {
      color: '#f8eaff',
      glowColor: '#c468ff',
    },
  },
]);

const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: '/draftroll/overlay.html',
    themeProvider,
    onThemeLoad(event) {
      console.debug(event);
    },
  },
  warmupThemes: ['obsidian'],
});
```

Use `renderer.loadTheme(themeId, signal)` when loading needs explicit cancellation. Invalid optional assets fall back independently instead of failing the complete roll. See `docs/THEMES.md` for the complete manifest and asset model.

## Runtime validation

All values crossing JSON, storage, or realtime boundaries can be decoded with the schema exports from `@draftroll/protocol` (also re-exported by `@draftroll/sdk`).

```ts
const decoded = decodeNormalizedRollResult(untrustedValue);
if (!decoded.success) {
  console.error(decoded.error.issues);
  return;
}

draftroll.present(decoded.data);
```

`Draftroll.present()`, core roll updates, external display inputs, room commands, room events, persisted results, participant identities, and capability-token payloads are validated before use. See [Runtime validation and compatibility](RUNTIME_VALIDATION.md). Expression parsing also exposes stable codes, source ranges, and suggestions; see [Expression validation diagnostics](VALIDATION_DIAGNOSTICS.md).

## Concurrent room table rolls

`DraftrollRoomSession` enables concurrent table presentation by default. Nearby authorized starts are coalesced into one bounded physical world. A later compatible physical roll can also enter while an earlier throw is still moving; existing dice continue from sampled transforms and velocities, and every logical roll retains its own ID, revision, actor, visibility, history entry, and handle.

```ts
const room = await draftroll.connectRoom({
  url,
  roomId,
  participant,
  concurrentTableRolls: true,
  renderer: {
    table: {
      batchWindowMs: 140,
      maximumConcurrentRolls: 6,
      maximumConcurrentVisuals: 30,
    },
  },
});
```

Set `concurrentTableRolls: false` for strict one-at-a-time presentation. See [`CONCURRENT_TABLE_ROLLS.md`](./CONCURRENT_TABLE_ROLLS.md) for pre-launch batching, in-flight additions, privacy, overflow, and dismissal behavior. Exact physical faces are produced by the client-local planning method documented in [`NATURAL_TARGET_PHYSICS.md`](./NATURAL_TARGET_PHYSICS.md).
