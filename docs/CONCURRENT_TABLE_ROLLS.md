# Concurrent table rolls

Draftroll room sessions can merge rolls created at nearly the same time and can inject later rolls into an already-moving physical table.

This behavior is enabled by default for `DraftrollRoomSession`. It is renderer-side presentation behavior only: every roll keeps its own authoritative `rollId`, revision, visibility policy, actor, total, history entry, and SDK handle.

## Room usage

```ts
const room = await draftroll.connectRoom({
  url: 'wss://dice.example.com/rooms/table/connect',
  roomId: 'table',
  participant: {
    participantId: 'player-a',
    sessionId: crypto.randomUUID(),
    name: 'Aria',
  },
});

// When other participants submit rolls within the same short start window,
// authorized clients present them in one shared physical throw.
const roll = await room.roll({
  expression: '1d20 + 7',
  name: 'Longsword attack',
});

await roll.wait();
```

Each participant still receives an independent handle:

```ts
await roll.rerollDie('die-1');
await roll.updateLog({ annotation: 'Bless included' });
```

## Presentation behavior

Nearby synchronized starts are grouped before launch when all of these conditions hold:

- Both calls opt into concurrent table mode.
- Their authoritative start times fall inside the configured batch window.
- Their late-event presentation modes are compatible.
- The combined roll count and visual count stay within configured limits.

A grouped or in-flight additive throw uses:

- One shared physical world and one active renderer playback.
- Separate seeded hand clusters and inward throw lanes per roller.
- Candidate trajectory search against fixed authoritative face targets.
- One shared collision world, allowing dice from different rollers to exchange momentum and interact naturally.
- Per-roll actor and action labels in the combined result summary.
- Independent completion promises and totals for every logical roll.

Hidden projections are never included for clients that are not allowed to view them. A GM may therefore see a public and GM-only roll together while an ordinary participant sees only the public roll.

## Configuration

Room sessions enable concurrent table presentation by default:

```ts
const room = await draftroll.connectRoom({
  // ...connection options
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

Disable it for applications that require strict one-at-a-time visual presentation:

```ts
const room = await draftroll.connectRoom({
  // ...connection options
  concurrentTableRolls: false,
});
```

Local or custom renderer calls can opt in explicitly:

```ts
const first = draftroll.roll('1d20', {
  renderer: {
    table: {
      mode: 'concurrent',
      groupId: 'attack-a',
      actorLabel: 'Aria',
      rollLabel: 'Attack',
    },
  },
});

const second = draftroll.roll('2d6', {
  renderer: {
    table: {
      mode: 'concurrent',
      groupId: 'damage-b',
      actorLabel: 'Borin',
      rollLabel: 'Damage',
    },
  },
});

await Promise.all([first.wait(), second.wait()]);
```

## Limits and overflow

The default combined presentation limit is 30 visual components and six logical rolls. When a burst exceeds those limits, Draftroll partitions it into bounded table throws rather than rejecting unrelated rolls or creating one unbounded simulation.

Rolls outside the initial coalescing window can still join while a compatible physical throw is active. The renderer samples the visible state, preserves an unresolved earlier trajectory as moving collision geometry, and plans the incoming dynamic dice against it. Once earlier dice have settled, they re-enter later plans as ordinary dynamic bodies and can be knocked naturally. Fallback-containing, late-settled, or over-budget requests retain bounded queued behavior.

## Dismissal

A grouped table throw is dismissed as one visual scene. Dismissing it does not remove or merge the individual logical room-history entries. Rerolls and revisions continue to target the original stable roll IDs.
## In-flight additions

A second roll does not need to arrive inside the initial batching window:

```text
Alice throws 3d6
  360 ms later: Bob throws 2d8
  -> Bob's dice enter Alice's still-moving table
  -> Bob's dynamic dice collide against Alice's preserved moving trajectory
  -> both logical handles resolve independently
```

The active bodies are not restarted from their original launch. Their current transform and remaining verified trajectory are sampled before the new physical plan is built. The incoming handful remains dynamic and receives exact-result shape-symmetry targeting across its complete trajectory.

This behavior is local presentation. Different clients may see different plausible trajectories because each plans against its own canvas dimensions, but all clients show the same authoritative values.

See [`NATURAL_TARGET_PHYSICS.md`](NATURAL_TARGET_PHYSICS.md) for exact-result shape-symmetry behavior and continuity constraints.


## Adding to a settled table

Concurrent mode also accepts a compatible physical roll after the previous throw has completed but before the table is dismissed. The renderer samples the final sleeping transforms, adds the new handful, and plans a new combined trajectory from that state. The newly thrown dice can therefore strike and move recently settled dice.

```text
Alice's d20 settles
  1.2 seconds later: Bob throws 2d6
  -> the d20 remains on the table
  -> Bob's dice can collide with it
  -> both logical rolls remain independent
```

Applications that use click-to-dismiss should exempt their roll controls so the pointer gesture that starts a network request does not clear the existing table before the authoritative room event arrives:

```ts
const draftroll = await Draftroll.createOverlay({
  overlay: {
    dismissOnPointer: true,
    dismissIgnoreSelector: '[data-draftroll-roll-control]',
  },
});
```

```html
<button data-draftroll-roll-control>Roll</button>
```

The selector is evaluated in the host document. Other clicks continue to dissolve the completed table and still reach the underlying application.
