# Exact-result physical presentation

Draftroll separates **result authority** from **physical presentation**. The rules engine or room server decides each die value first. The renderer then presents that already-authoritative value through an ordinary rigid-body trajectory.

The renderer does not change a result after generation, rewrite face labels, apply late torque, or move a die a second time after it appears to settle.

## Shape-symmetry targeting

Standard d4, d6, d8, d10, d12, and d20 colliders have proper rotational symmetries. A symmetry can map any numbered result direction to any other result direction while leaving the physical solid unchanged.

Draftroll uses that property as follows:

1. Generate and simulate one normal Cannon-es throw.
2. Read the face or d4 vertex that naturally ends upward.
3. Find a proper local-space symmetry that maps the requested printed result onto that naturally landed direction.
4. Apply the same constant symmetry to every recorded quaternion for that die.
5. Verify the final visible top value before playback.

For a recorded orientation `Q(t)` and constant die-space symmetry `S`, visible orientation is:

```text
Qvisible(t) = Q(t) · S
```

Because `S` is a symmetry of the collider:

- the occupied physical shape is unchanged at every instant
- positions and contact times are unchanged
- bounce and collision paths remain valid
- world-space angular motion remains continuous
- the die starts with the correct hidden orientation rather than correcting itself later

The printed labels remain attached to their real faces. The complete trajectory is selected before the first visible frame.

## No visible fallback correction

The previous candidate-search implementation could fail under concurrent constraints and then use low-energy assistance near settlement. That behavior has been removed.

The exact-result path now has no:

- post-impact target torque
- magnetic-looking drift
- correction hop
- micro-orientation correction
- final quaternion snap
- face-label remapping
- second settlement phase

If the worker cannot produce a valid standard-die plan, the renderer does not show a partially corrected throw. The workerless local fallback uses the same shape-symmetry transformation before playback.

## Concurrent table behavior

### Near-simultaneous rolls

Rolls collected inside the table batching window are planned together from frame zero. All dice are dynamic bodies in one Cannon world and exchange ordinary contact impulses, friction, restitution, linear momentum, and angular momentum.

Every new die receives its own constant shape-symmetry transformation after the shared simulation. Since that transformation leaves its collider invariant, the combined collision trajectory remains physically valid.

### A later roll entering an active throw

An already-visible die cannot be assigned a different local symmetry without changing its current orientation. During an in-flight additive replan, Draftroll therefore preserves the earlier verified trajectory as a moving kinematic collider and adds the new dice as dynamic bodies.

This guarantees:

- no jump in an already-visible die
- no change to an earlier unresolved authoritative face
- incoming dice collide with the earlier moving dice
- the incoming dice still settle on exact requested faces

For the strongest two-way interaction, use a delay inside the batching window so both handfuls begin in the same fully dynamic simulation. The playground defaults to 80 ms for this reason.

Recently settled dice remain on the table as ordinary dynamic bodies. A later handful can strike and move them naturally. Their original logical roll result remains stored independently, just as a recorded tabletop result remains valid if another die later knocks it.

## Large pools and committed playback

Dense pools use the same shape-symmetry exact-result method, but they do not expose provisional launch transforms. The physical meshes remain hidden while the worker plans, the committed frame-zero transforms are applied before the first render, and each die follows that one recorded trajectory through completion.

Pools of twelve or more dice use a broad staged pour. Small release waves reduce the solver pressure created by activating many convex bodies in one compact volume. Unreleased dice are invisible and collision-disabled until their recorded activation time; they do not appear at a temporary spawn point.

Planning and trajectory recording run at 120 Hz. A small shape-specific collider skin and stronger contact solving reduce visible mesh penetration during dense or parallel collisions without modifying the rendered mesh size. See [`LARGE_POOL_PHYSICS.md`](LARGE_POOL_PHYSICS.md).

## Different client and canvas sizes

Each client plans against its own measured overlay viewport, camera bounds, and safe containment area. A phone, desktop display, split panel, or embedded iframe may therefore use different launch positions and collision paths.

The following remain authoritative and identical:

- logical roll ID and revision
- die IDs and die kinds
- requested die values
- total and expression operations
- visibility projection
- room history and audit information

Only local motion differs. No trajectory needs to be stretched from one client’s aspect ratio into another.

## Visibility safety

A client simulates only the rolls it is authorized to receive. Hidden dice are not sent to unauthorized clients and cannot affect their visible physics.

Client-local trajectories are presentation data, not authoritative room state. Exact values and permissions remain server-controlled.

## Diagnostics

Development builds expose the latest physical targeting information:

```ts
const { targeting } = window.draftrollDice.getPerformanceSnapshot();
```

Important fields are:

```ts
{
  method: 'shape-symmetry',
  planningMs: 18.4,
  retargetedDiceCount: 3,
  preservedTrajectoryDiceCount: 0,
  naturalMatches: 2,
  minimumFinalAlignment: 0.999,
  targetSuccess: true,
}
```

Some older diagnostic fields remain at zero or one for API compatibility. No assistance stage is executed.

## Validation scope

Deterministic tests verify:

- every value-to-value rotational symmetry for d4, d6, d8, d10, d12, and d20
- complete-trajectory local rotation rather than end-frame correction
- removal of torque and micro-correction code
- final top-face verification
- parallel shared-world planning
- additive preservation of already-visible trajectories
- unchanged package, protocol, and deployment versions

Live slow-motion WebGL review on supported browsers and devices remains necessary for perceptual acceptance testing.
