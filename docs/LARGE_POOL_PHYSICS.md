# Large-pool physical integrity

Large physical pools need a different launch layout from ordinary handfuls. Packing twenty d20s into one compact release volume produces severe contact pressure, solver separation impulses, and visually implausible movement even when the final values are correct.

Draftroll therefore treats pools of twelve or more physical dice as a broad staged pour while preserving one committed exact-result trajectory.

## Single committed visible trajectory

The renderer may need time to ask the physics worker for a plan. During that interval, provisional preview positions are never rendered.

For every physical roll:

1. The renderer measures the current viewport.
2. It creates launch states and hides the provisional meshes.
3. The worker computes the complete trajectory off-screen.
4. Shape-symmetry targeting verifies the requested final faces.
5. The renderer applies the committed frame-zero transform.
6. Only then does the first visible frame render.

This removes the previous sequence where a large pool could visibly show a preview layout, a temporary packed layout, and then the final planned layout. A roll therefore has one continuous visible position and orientation history.

If both the worker and local fallback fail, the current meshes are restored before the error is surfaced. A planning error cannot leave the overlay permanently blank.

## Broad staged pour

Pools below twelve dice still use one compact hand-like cluster. Larger pools use a wider two-handed pour:

- launch positions are generated in a broad three-dimensional volume
- the volume is sized using actual collider radii
- initial bodies are packed without intersections
- dice are released in small deterministic waves
- unreleased dice remain invisible and collision-disabled
- all release waves complete in roughly half a second for a 20-die pool

The delayed release is part of the precomputed physical trajectory. Dice do not teleport between release positions. A die becomes visible only at the frame where its body becomes active.

The waves reduce the unphysical pressure spike caused by activating twenty convex bodies in one compact volume while retaining the appearance of one continuous pour.

## Physics and recording frequency

Large-pool planning uses a fixed 120 Hz simulation step and records every physics step. Playback interpolates between adjacent recorded frames.

This reduces:

- one-frame tunnelling between fast dice
- visible contact penetration caused by coarse interpolation
- sudden position changes in dense collisions
- missed short-duration impacts

The high-frequency work happens only while planning a physical throw in the worker. Draftroll's idle-zero renderer and lazy worker shutdown remain unchanged.

At the maximum supported physical pool of thirty dice, the recorded transform buffer remains below one mebibyte for the bounded planning duration.

## Collision skin and contact solver

The visible geometry uses beveled edges while Cannon uses idealized convex polyhedra. A very small collider skin is applied per standard die so solver tolerance and interpolation do not allow the visible meshes to appear embedded before Cannon considers them separated.

The scale increase is approximately 1.6–2.6 percent depending on die shape. It remains inside the apparent bevel profile and is not intended to create visible gaps.

The planner also uses:

- 32 solver iterations
- tighter solver tolerance
- explicit high-stiffness dice contact equations
- modest dice-to-dice restitution
- conservative friction

These settings prioritize contact integrity for transient planning. They do not keep a high-frequency render loop active after the roll.

## Exact predetermined faces

Large-pool handling does not introduce a correction phase. Standard d4, d6, d8, d10, d12, and d20 results still use one constant rotational symmetry applied to every quaternion in a die's trajectory before the first visible frame.

There is no:

- late torque
- post-settlement movement
- result-facing snap
- face-label rewrite
- visible candidate replacement

The final top face is verified before playback begins.

## Parallel and additive rolls

Near-simultaneous room rolls share the same 120 Hz world and collide as ordinary dynamic bodies. Their launch groups can use separate hand biases, but their bodies use the same contact solver.

A later additive roll preserves the already-visible trajectory of unresolved dice and injects the new dice into the current table plan. Settled dice remain physical colliders. The same collision skin and high-frequency recording apply to the combined plan.

## Browser regression coverage

The Chromium performance specification includes a predetermined 20d20 case. It checks that:

- the completed values match the requested sequence
- the replay recording uses a step no larger than 1/120 second
- the trajectory contains staged activation delays
- adjacent recorded positions stay within a bounded displacement
- one replay is produced rather than several replacement plans

These checks guard the known transform-replacement regression. They do not replace human slow-motion review on real GPUs and displays. Perceptual validation is still required before declaring the large-pool presentation final.
