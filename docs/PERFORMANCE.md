# Renderer performance and power management

Draftroll's overlay renderer is designed to consume no animation-frame budget while idle. It does not run a perpetual `requestAnimationFrame` loop, does not create preview dice in overlay mode, and does not keep the physics worker alive indefinitely.

## Default behavior

The default `auto` profile applies these budgets:

| Situation | Target |
|---|---:|
| Idle overlay | 0 animation frames |
| 1–20 visual components | 60 frames per second |
| More than 20 components | 30 frames per second |
| Overlay device-pixel-ratio cap | 1.35 |
| Overlay dynamic resolution range | 0.80–1.00 |
| Pending presentation queue | 32 entries |
| Idle physics-worker lifetime | 45 seconds |

Dynamic resolution uses a 90-frame sample window with hysteresis. Renderer resizing therefore occurs only after sustained missed-frame pressure or sustained recovery; it does not oscillate every few frames.

The overlay does not allocate the standalone playground's bloom composer. Postprocessing remains available in the standalone playground, while the transparent SDK overlay uses direct alpha-preserving rendering.

## Visual integrity safeguards

Performance reductions must not change the apparent shape of a die. The overlay therefore uses one measured CSS viewport for the canvas backing buffer and orthographic camera, re-measures immediately before every presentation, and listens for layout changes through `ResizeObserver`. This avoids the browser's provisional 300×150 canvas size stretching an iframe renderer after it becomes visible.

The default overlay also retains:

- edge antialiasing while an animation is active
- a 512-pixel shadow map for pools of up to eight physical dice
- no dynamic shadows for larger pools or the battery profile
- conservative per-die camera containment using the actual visual geometry radius

These features have no idle-frame cost because the renderer still stops completely between presentations.

## Performance profiles

```ts
const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: '/draftroll/overlay.html',
    performance: {
      profile: 'auto', // auto | battery | quality
    },
  },
});
```

### Auto

Recommended default. Uses an idle-zero render loop, adaptive effects, count-aware shadows, a 60/30 FPS active budget, and dynamic resolution.

### Battery

```ts
performance: {
  profile: 'battery',
}
```

The battery profile:

- caps active rendering at 30 FPS
- caps device pixel ratio at 1
- disables dynamic shadows
- reduces particles, motifs, lightning, lights, and hero effects
- remains completely idle between animations

Use this profile for laptops, mobile devices, streams with several WebGL surfaces, or applications where dice are a secondary visual feature.

### Quality

```ts
performance: {
  profile: 'quality',
  maximumPixelRatio: 2,
  activeFramesPerSecond: 60,
}
```

The quality profile retains higher shadow and effect budgets. It still uses idle-zero scheduling and bounded presentation serialization.

## Custom limits

```ts
performance: {
  profile: 'auto',
  maximumPixelRatio: 1.2,
  activeFramesPerSecond: 45,
  adaptiveQuality: true,
}
```

`maximumPixelRatio` is constrained to 0.65–2. `activeFramesPerSecond` is constrained to 15–60.

## Presentation serialization

SDK presentations are serialized through a bounded queue. Concurrent calls no longer mutate shared pending-roll state or fail merely because the renderer is planning or playing another roll.

```ts
await Promise.all([
  draftroll.roll('1d20').wait(),
  draftroll.roll('2d6').wait(),
  draftroll.roll('1d8+3').wait(),
]);
```

Each presentation keeps its own request data. Late queued room events use the existing late-event policy, so an old animation can seek or settle instead of generating an unbounded visual backlog.

The queue is bounded at 32 pending presentations. Applications producing more visual events than a human can consume should disable automatic presentation for low-priority events or use log-only updates.

## Page visibility

When the renderer document becomes hidden:

- the animation frame is cancelled
- an active deterministic replay is moved to its final state
- the roll promise resolves without creating hidden-tab outcome effects
- idle rendering remains stopped

Returning to the page schedules only the single frame needed to restore the final presentation.

## Physics worker lifecycle

The Cannon planning worker is created on the first physical roll rather than during SDK initialization. It keeps its cached planner briefly for repeated rolls, then terminates after 45 seconds without pending plans.

Fallback-only rolls do not require the physics worker.

### Large-pool planning

Physical planning uses a fixed 120 Hz worker step and records each step for dense pools and collision-heavy concurrent throws. This is a transient CPU workload: it runs only while creating a committed trajectory, never as an idle render loop. Pools of twelve or more dice use staged activation to avoid an expensive compact-body pressure spike.

The maximum supported 30-die trajectory remains bounded below one mebibyte for the configured planning duration. The worker remains lazy and still terminates after its idle timeout. Applications that prioritize battery life can reduce how often large animated pools are presented, but exact result evaluation and room synchronization remain available without 3D animation.

## Runtime diagnostics

Direct renderer integrations can inspect:

```ts
const snapshot = window.draftrollDice.getPerformanceSnapshot();
```

The snapshot includes:

- active profile
- current pixel ratio and dynamic-resolution scale
- target FPS
- render-loop activity
- queued presentations
- physical and fallback visual counts
- rendered frame count
- smoothed frame interval
- smoothed renderer CPU submission time
- maximum observed frame interval

These values are diagnostics, not stable gameplay data.

## Repeatable tests and benchmarks

Structural and deterministic performance tests:

```bash
pnpm test:performance
```

Chromium WebGL performance suite:

```bash
pnpm test:browser:performance
# alias
pnpm benchmark:renderer
```

The browser suite verifies:

- idle render-loop suspension
- battery-profile limits
- bounded queued presentations plus compatible in-flight physical additions
- 30-dice completion and diagnostic output
- predetermined 20d20 continuity, staged activation, and 120 Hz replay recording

Failed or completed benchmark runs attach `renderer-performance.json` to the Playwright report. Results depend on browser, GPU, thermal state, display refresh rate, and headless/headed mode; compare results only under a controlled environment.

## Build approvals

The workspace permits native install scripts only for the tools needed by the local build/runtime stack:

```yaml
allowBuilds:
  esbuild: true
  workerd: true
```
## Exact-result targeting diagnostics

Exact-result presentation uses one ordinary worker trajectory followed by a constant local shape symmetry for each die that needs a different printed face. It does not run an iterative candidate search or an assistance phase.

Inspect the latest result through:

```ts
const { targeting } = window.draftrollDice.getPerformanceSnapshot();
```

`targeting` reports the `shape-symmetry` method, planning duration, naturally matching dice, retargeted-die count, minimum final alignment, and final target success. Legacy candidate/assistance counters remain bounded compatibility fields and do not represent active search or correction work.

The deterministic suite validates all standard-die symmetries. Hardware-specific frame timings and slow-motion visual acceptance remain part of the Playwright/browser benchmark process.

## SDK and theme-cache benchmark

Run repeatable parser, validation, evaluation, revision, and theme-cache measurements:

```bash
pnpm benchmark:sdk
node scripts/benchmark-sdk.mjs --iterations=5000 --output=benchmark-results/sdk-controlled.json
```

The JSON report contains runtime identity, iteration/warmup counts, p50/p95/p99/max operation timings, and upstream theme/asset call counts proving cache hits. It deliberately does not claim network or WebGL performance.

For a controlled baseline, record CPU/GPU/device, operating system, browser/Node version, power source, thermal state, headed/headless mode, display refresh rate, command arguments, and commit. Store reports as CI artifacts rather than committing machine-specific numbers.

The Chromium performance suite additionally records optional `usedJsHeapSize`/`jsHeapSizeLimit` values when the browser exposes them and includes a mixed physical-plus-fallback synchronized presentation.
