# Draftroll SDK MVP

The supplied Draftroll v1.8.1 visual engine is now the renderer inside a local-first SDK architecture. A lifecycle-managed `DraftrollSession` can retain application subscriptions and roll state while switching local/realtime execution and renderer attachment. The repository adds a TypeScript d20-compatible expression engine with opt-in parser/evaluator profiling, a notation-free structured rules API, portable weighted/repeated/symbolic custom dice plus common coin, Fate, percentile-pair, symbol-pool, and card/table factories, normalized roll contracts, causal staged reroll/explosion presentation with persistent prior dice, a transparent third-party website overlay, a built-in result display, mixed physical and fallback visual pools, per-die themes, constrained runtime theme assets, named rolls, individual-die rerolls, completed-roll revisions, revision audit history, theme providers, a permission-aware realtime room client, server-enforced hidden results, stable room roll handles, issuer/audience-bound rotating room capabilities, room-scoped token revocation, reconnect recovery, adaptive synchronized starts, late-event replay seeking, and a Cloudflare Durable Object backend.

Recommended embedded usage:

```ts
import { Draftroll } from '@draftroll/sdk';

const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: '/draftroll/overlay.html',
    dismissOnPointer: true,
    dismissIgnoreSelector: '[data-draftroll-roll-control]',
  },
});

// No dice are visible until this call. The dice roll over the host page.
const roll = draftroll.roll('1d20+1d8+2d6+5', {
  themes: ['dragon', 'frost', 'ember', 'wildwood'],
});

// The next host-page click dissolves the completed dice.
// Correct the completed roll without replaying the dice.
roll.update({
  dice: [{ id: 'die_1', result: 20 }],
});
```

`@draftroll/sdk` resolves to the browser facade in browser-aware bundlers and exposes the renderer and overlay APIs. Server and headless consumers should import `@draftroll/sdk/headless`; the headless entry has no static dependency on the renderer, overlay, Three.js, or Cannon-es. The explicit `@draftroll/sdk/browser` entry is also available when a build system does not enable the `browser` export condition.

See:

- `docs/EMBEDDING.md` for mounting dice over another website, results, themes, rerolls, and revisions
- `docs/TABLE_TESTING.md` for predetermined-result controls and staged moving/settled multi-roller scenarios
- `docs/THEMES.md` for versioned runtime manifests, providers, textures, label atlases, fonts, audio, effects, and validated visual meshes
- `docs/VISUAL_FALLBACKS.md` for coins, percentile, Fate, arbitrary, symbolic, weighted, and mixed physical/fallback presentation
- `docs/SDK.md` for API usage
- `docs/TSDOC.md` for public API documentation scope, style, release tags, and validation commands
- `docs/REALTIME_PERMISSIONS.md` for anonymous identities, signed room capabilities, server-enforced hidden rolls, reveals, and reconnect recovery
- `docs/TOKEN_SECURITY.md` for issuer/audience claims, key IDs, signing-key rotation, detailed verification, and room-scoped revocation
- `docs/LATE_EVENT_SYNCHRONIZATION.md` for adaptive start buffers, clock-offset translation, replay seeking, settled late events, and reconnect animation behavior
- `docs/ROOM_HARDENING.md` for room-policy presets, optional room passwords, authorization controls, limits, rate limiting, expiry, retention, origin enforcement, and emergency shutdown
- `docs/ROOM_PASSWORDS.md` for the optional shared-password handshake, management API, HTTP authorization, and security guarantees
- `docs/API_DESIGN.md` for the developer-friendly expression, structured, external-result, and revision layers
- `docs/PROFILING.md` for parser-cache, AST-complexity, evaluator-work, reroll, explosion, and timing profiles
- `docs/COMMON_DICE.md` for coin, Fate, atomic percentile-pair, symbol-pool, and weighted card/table helper factories
- `docs/D20_COMPATIBILITY.md` for the complete d20 grammar, dialects, trees, and custom dice
- `docs/LIFECYCLE_SESSION.md` for one stable local/realtime and renderer lifecycle object
- `docs/MVP_SCOPE.md` for the anonymous/no-account MVP boundary and current priorities
- `docs/ROLL_UPDATES.md` for formula/result corrections, animate versus log-only behavior, and audit history
- `docs/IMPLEMENTATION_COMPARISON.md` for the original specification versus current code
- `docs/ARCHITECTURE.md` for package boundaries
- `docs/STATUS.md` for implemented scope and explicit limitations
- `docs/LOCAL_DEVELOPMENT.md` for pnpm, Wrangler, local D1, Durable Objects, character-sheet testing, overlay testing, and smoke tests
- `docs/CHARACTER_SHEET_TEST_CLIENT.md` for named server formulas, mixed physical pools, room history, and reroll/revision controls
- `docs/DEPLOYMENT.md` for self-hosting overlay assets and the optional realtime backend
- `docs/PACKAGE_DISTRIBUTION.md` for generated package builds, workspace-local linking, and offline staged-tarball validation

Package versions remain at `0.1.0` and the realtime protocol remains version 2 while the pre-release API is still being implemented. No deployment or release-version change is performed by this snapshot.

The original renderer documentation follows.

---

# Draftroll

A top-down, screen-filling polyhedral dice engine built with Three.js, Cannon-es, TypeScript, and Vite.

## Features

- d4, d6, d8, d10, d12, and d20 dice
- Mixed d4, d6, d8, d10, d12, and d20 rolls in one physical simulation
- Physical colliding d2 coins plus synchronized custom coin, percentile, Fate, arbitrary-die, symbolic, and weighted/custom result fallbacks
- Mixed physical dice and fallback tokens/cards in the same roll, up to 30 visual components
- Deterministic synchronized-start scheduling with adaptive room buffers and late-event replay seeking
- Fixed-step rigid-body simulation with collisions, rebounds, damping, and impact audio
- Organic hand-throw layouts with compact small-pool releases and broad staged large-pool pours
- Organic predetermined outcomes with no late torque, correction hop, snap, or second movement phase
- Thick invisible viewport walls plus trajectory boundary safeguards, so dice cannot leave the visible screen
- Eight procedural high-detail themes with distinct PBR surface treatment and result-animation language
- Per-die result effects using three system-agnostic outcomes: `positive`, `neutral`, and `negative`
- Configurable theme effect slots with reusable built-in effect presets
- Mouse/touch swipe casting, keyboard controls, and responsive UI

## Themes

| Theme ID    | Name          | Positive                        | Neutral         | Negative             |
| ----------- | ------------- | ------------------------------- | --------------- | -------------------- |
| `dragon`    | Wyrmfire      | Dragon emergence / fire breath  | Orbiting embers | Cinder collapse      |
| `celestial` | Sunforged     | Solar ascension / radiant beams | Star halo       | Eclipse collapse     |
| `tempest`   | Stormbound    | Thunder strike                  | Static crown    | Storm discharge      |
| `frost`     | Glacier Heart | Ice crown / crystal growth      | Snow orbit      | Ice shatter          |
| `nebula`    | Astral Void   | Void rift / stellar vortex      | Stardust orbit  | Singularity collapse |
| `ember`     | Phoenix Forge | Phoenix flame wings             | Ember drift     | Ash collapse         |
| `necrotic`  | Gravebound    | Spectral reaper                 | Grave wisps     | Soul collapse        |
| `wildwood`  | Verdant Oath  | Verdant bloom                   | Firefly orbit   | Thorn bind           |

Each theme supplies procedural albedo, normal, and roughness data plus theme-specific PBR response, labels, edges, and semantic result effects.

## Correct D4 numbering

The d4 uses top-read tetrahedral numbering instead of the face-center numbering used by the other dice.

Each triangular face contains three labels, one toward each vertex. The same value appears next to a given vertex on all three adjacent faces. The result is the value of the uppermost vertex after the tetrahedron settles.

Predetermined d4 results use the tetrahedron’s exact rotational symmetries. A constant local orientation is applied across the complete physical trajectory so the requested top-read vertex ends uppermost without relabeling or a late correction.

## Throw dynamics

Dice now begin in an irregular, non-overlapping blue-noise cluster near the lower edge of the viewport and travel toward a separately scattered target cloud in the far half of the table. The launch has no visible rows or persistent lanes. A broad projection match prevents extreme full-table crossovers while preserving the small crossings, fan-out, depth variation, and uneven spacing of dice released from a real hand.

Initial angular velocity is derived from the die's horizontal velocity using the no-slip rolling relationship at the contact point, then blended with a restrained tumble component. Dice therefore rotate in the direction they travel instead of behaving like spinning tops. The rolling-axis signs follow the no-slip contact equation, so visible face motion now matches the direction of travel. Upper launch layers use ceiling-safe ballistic arcs. Small pools activate together; pools of twelve or more use tightly spaced release waves from one broad pour.

## Exact-result physical presentation

The worker first records one ordinary fixed-step Cannon-es trajectory. For each standard physical die, Draftroll then applies one constant proper symmetry of that die to every quaternion in the recording. The symmetry maps the requested printed face onto the direction that naturally landed upward while leaving the collider’s occupied shape unchanged.

This is equivalent to choosing a different valid starting orientation before the throw. Positions, contact times, bounces, spin, and momentum exchange remain physically valid. There is no candidate-search failure, late torque, correction hop, quaternion snap, face relabeling, or second settlement phase.

Near-simultaneous room rolls are planned together as fully dynamic bodies in one shared world. A later roll can enter an already-visible table without changing the earlier trajectory; the existing dice act as preserved moving colliders while incoming dice remain dynamic. Each client plans against its own measured canvas bounds, so motion can differ across layouts while authoritative faces and totals remain identical. See [`docs/NATURAL_TARGET_PHYSICS.md`](docs/NATURAL_TARGET_PHYSICS.md).

## Large-pool continuity and collision integrity

The renderer never displays preview or provisional physics transforms while a roll is being planned. It hides the physical meshes, computes and verifies one complete trajectory, applies that trajectory's frame-zero transforms, and only then renders the first frame. This prevents 20d20 pools from visibly switching between a preview grid, packed spawn, and planned positions.

Pools of twelve or more dice use a broad staged pour rather than one compressed pile. The worker plans and records at 120 Hz, unreleased dice remain invisible and collision-disabled until their activation frame, and the complete 30-die recording remains bounded below one mebibyte. Small shape-specific collider skins plus stronger contact solving reduce apparent mesh penetration during dense and parallel collisions. See [`docs/LARGE_POOL_PHYSICS.md`](docs/LARGE_POOL_PHYSICS.md).

## Result-effect model

Each die receives one semantic result outcome:

```ts
type EffectOutcome = 'positive' | 'neutral' | 'negative' | 'none';
```

The game decides the outcome. The selected dice theme decides which visual effect preset implements that outcome.

Examples:

- Two equal dice in a game where doubles are critical: mark both dice as `positive`.
- A damage die that rolls one: mark only that die as `negative`.
- Every other die: mark it as `neutral`.

Themes do not contain game rules. They only map the three outcomes to effects.

Outcome effects are tied to stable visual IDs and trajectory-derived settlement times. Each die fires its effect once, at the first recorded frame from which it remains at its authoritative final pose. Dice retained for explosions, formula rerolls, manual rerolls, and concurrent table rolls keep their one-shot state, so later additive throws cannot replay effects for older dice. Effects before a late-event seek point are marked consumed rather than replayed.

## JavaScript API

### Select a theme

```js
window.draftrollDice.setTheme('tempest');

console.log(window.draftrollDice.getThemes());
// [{ id: 'dragon', name: 'Wyrmfire' }, ...]
```

### Predetermined results with per-die outcomes

```js
window.draftrollDice.setDie('d8');
window.draftrollDice.setQuantity(2);
window.draftrollDice.setTheme('celestial');

window.draftrollDice.roll({
  results: [7, 7],
  outcomes: ['positive', 'positive'],
  context: {
    rollType: 'skill-check',
    reason: 'doubles',
  },
});
```

### Damage roll with a negative result on one die

```js
window.draftrollDice.setTheme('necrotic');

window.draftrollDice.roll({
  results: [1, 6],
  outcomes: ['negative', 'neutral'],
  context: {
    rollType: 'damage',
  },
});
```

### Configure a game-level outcome resolver

The resolver runs after the hidden physics plan has produced the final results but before the visible replay starts.

```js
window.draftrollDice.configure({
  neutralEffects: true,
  maxHeroEffects: 2,
  outcomeResolver({ results, context }) {
    const doubles = results.length === 2 && results[0] === results[1];

    return results.map((result) => {
      if (doubles) return 'positive';
      if (context.rollType === 'damage' && result === 1) return 'negative';
      return 'neutral';
    });
  },
});
```

An explicit `outcomes` array passed to `roll()` takes precedence over the resolver.

### Configure theme effect slots

```js
window.draftrollDice.configureThemeEffects('dragon', {
  positive: 'dragon-awaken',
  neutral: 'dragon-embers',
  negative: 'dragon-cinders',
});
```

Built-in effect presets:

```ts
'dragon-awaken';
'dragon-embers';
'dragon-cinders';
'void-rift';
'stardust-orbit';
'void-collapse';
'phoenix-flare';
'ember-drift';
'ash-collapse';
'ice-crown';
'snow-orbit';
'ice-shatter';
'solar-ascension';
'star-halo';
'eclipse-collapse';
'thunder-strike';
'static-crown';
'storm-fizzle';
'soul-reaper';
'grave-wisp';
'soul-collapse';
'verdant-bloom';
'firefly-orbit';
'thorn-bind';
'major-burst';
'subtle-pulse';
'void-fracture';
'ember-fracture';
'frost-fracture';
'none';
```

The registry is separate from game logic so future user-created themes can map the three semantic outcome slots to any compatible effect preset.

### Backward-compatible calls

```js
window.draftrollDice.roll([20, 7, 3]);
window.draftrollDice.roll(20);
window.draftrollDice.setResults([20]);
window.draftrollDice.clearResults();
window.draftrollDice.setDie('d20');
window.draftrollDice.setQuantity(30);
```

## Rendering and material pipeline

Dice use shared `MeshPhysicalMaterial` variants with procedural PBR texture sets:

- Albedo maps for theme-specific surface coloration and markings
- Generated tangent-space normal maps for scales, stone, ice, grain, cracks, and engraved structure
- Spatially varying roughness maps instead of one uniform gloss value
- Clearcoat normal response where appropriate
- Theme-specific IOR, specular intensity/color, sheen, clearcoat, and restrained iridescence
- Per-die shader UV offsets so dice sharing one cached material do not display an obviously identical texture placement

The renderer keeps the dice surface at full scene resolution. Only the low-frequency bloom blur uses reduced internal render targets.

## 30-dice performance architecture

Large pools are optimized without replacing the physical roll or reducing dice geometry quality:

- Deterministic physics planning runs in a dedicated Web Worker, keeping the renderer and UI responsive
- The worker reuses its Cannon world and body pool when die type, quantity, and viewport bounds remain compatible
- Convex physics collider data is precomputed instead of rebuilding Cannon hulls from Three.js geometry at runtime
- Launch states, trajectories, and impact events use packed typed arrays
- Worker trajectory buffers are returned with transferable `ArrayBuffer`s rather than cloned
- Cannon physics still resolves at a fixed 60 Hz timestep
- Replay transform samples are stored at 30 Hz and continuously interpolated
- Main dice geometry, edge geometry, physical materials, edge materials, and theme texture assets are shared
- Every die uses one merged number-label mesh and one shared number atlas per theme instead of a mesh/material per face label
- Dragon ornaments use instancing where repeated geometry is required
- Per-die result effects are batched by compatible primitive type during a result reveal
- Particle bursts with matching parameters are merged into shared `Points` objects
- Rings and orbiting motifs use `InstancedMesh`
- Lightning for compatible effects is merged into batched `LineSegments`
- Dynamic point lights are clustered for large effect pools instead of spawning one light per die
- Outcome flashes are coalesced into one DOM animation per reveal
- Heavy hero sequences are independently capped through `maxHeroEffects`
- Bloom internal buffers adapt from 68% to 58% for crowded rolls while the scene and dice remain full-resolution
- Active shader variants are precompiled asynchronously after startup and theme changes to reduce first-use hitches

## Run locally

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install
pnpm dev
```

Run the Wrangler backend, local D1 migrations, and automated WebSocket smoke test with:

```bash
pnpm worker:test:local
```

Run the Wrangler backend and visual playground together with:

```bash
pnpm dev:stack
```

See `docs/LOCAL_DEVELOPMENT.md` for the full local workflow.

## Quality gates

```bash
pnpm lint
pnpm format:check
pnpm check
```

Oxlint runs strict syntax and type-aware rules with warnings treated as failures. Oxfmt is the formatting source of truth, and TypeScript remains the authoritative compiler check. See `docs/CODE_QUALITY.md` for rule scope, generated-file policy, editor setup, and dependency-update guidance.

## Production build

```bash
pnpm build
pnpm preview
```

The production build uses relative asset paths, so `dist` can also be hosted from a subdirectory.

## Surface stability fix

Dice texture variation now uses a small pool of immutable material variants. Variants share the same PBR textures and compiled shader program, but each keeps a stable UV offset for its entire lifetime. The shader also leaves UV derivatives continuous and relies on `RepeatWrapping` rather than applying `fract()` in the vertex stage. This removes intermittent surface-pattern switching and mip shimmer while dice rotate or change render order.

## Large-pool settling and launch planning

Large pools use a broad, non-overlapping three-dimensional pour sized from the actual collider radii. Dice are activated in small deterministic waves and remain invisible and collision-disabled before their activation frame. This avoids both a visible spawn pile and the separation impulses produced by enabling twenty convex bodies inside one compact volume.

Planning and recording use a fixed 120 Hz step. The denser trajectory reduces contact tunnelling and interpolation penetration while preserving bounded memory and idle-zero behavior. The containment fallback remains energy-removing rather than reflective, and crowded-roll damping applies only during low-energy settlement.

The deterministic and browser-structure suites verify bounded 20d20 frame displacement, staged activation, exact requested values, and a single committed replay. Controlled browser frame-rate and slow-motion perceptual measurements are still required on supported hardware.

## Idle-zero renderer and performance profiles

The SDK overlay no longer runs a perpetual animation loop. It requests frames only during active motion or effects, uses a low-power WebGL preference, creates the physics worker lazily, queues incompatible presentations with a bounded scheduler, and injects compatible physical room rolls into an already-active table.

```ts
const draftroll = await Draftroll.createOverlay({
  overlay: {
    performance: { profile: 'battery' },
  },
});
```

The `auto` profile targets 60 FPS for ordinary pools and 30 FPS above 20 visual components, with a 1.35 overlay DPR cap and hysteresis-based dynamic resolution. See `docs/PERFORMANCE.md`.

## Adaptive crowded-roll quality

The main dice geometry, PBR materials, labels, and full-resolution scene remain unchanged. For crowded rolls, only secondary costs are reduced:

- Impact particle density
- Orbiting motif density
- Lightning segment count
- Simultaneous dynamic effect lights
- Hero-effect count
- Shadow-map and bloom-buffer size

Disable this behavior when benchmarking or on a fixed high-end installation:

```js
window.draftrollDice.configure({ adaptiveQuality: false });
```

## Deterministic seeds and portable replays

```js
window.draftrollDice.roll({
  seed: 'encounter-42-attack-7',
  results: [8, 8],
  outcomes: ['positive', 'positive'],
  context: { rollType: 'check', reason: 'doubles' },
});

const replay = window.draftrollDice.getLastReplay();
if (replay) window.draftrollDice.playReplay(replay);
```

A replay contains the seed, engine version, die kind, theme, results, outcomes, bounds, packed trajectory, per-die settlement times, packed impacts, settle diagnostics, context, and deterministic effect timeline.

## Theme capability and audio manifests

```js
const manifest = window.draftrollDice.getThemeManifest('frost');
console.log(manifest.capabilities);
console.log(manifest.surfaceAudio);
```

Every built-in theme declares support for positive, neutral, and negative result effects, custom audio, optional custom models/colliders, and a physical impact profile. Impact audio now varies by material family such as stone, metal, crystal, resin, wood, and bone.

## Contact shadows

Each die has a lightweight height-aware contact shadow. It becomes tighter and darker near the table and wider and fainter while airborne. This is layered beneath the existing real-time directional shadows to improve grounding without adding another shadow-render pass.

## Hand-release motion

Ordinary multi-die rolls begin as a compact non-overlapping three-dimensional handful with a coherent wrist-driven throw direction and restrained release variation. Pools of twelve or more switch to the broad staged-pour path described above so dense convex bodies are never activated as one compressed stack. Both layouts preserve forward no-slip rotation, controlled tumble, deterministic results, and viewport containment.

## Repository completion and deployment boundary

The canonical `plan.md` is complete for repository-owned SDK work. Draftroll now includes generic framework bindings, lifecycle/cancellation/error contracts, transactional realtime revisions, persistent recovery/idempotency, complete renderer controls, accessibility fallbacks, generic examples, security/resilience suites, benchmarks, and deployment operations.

Remaining gates require external resources rather than source changes: real Cloudflare database IDs/domains/secrets, a live staging/production smoke run, installed Playwright browsers for the full matrix, and controlled hardware baseline/slow-motion acceptance records. See `docs/STATUS.md`, `docs/DEPLOYMENT.md`, `docs/MONITORING.md`, and `docs/PERFORMANCE.md`.

## Project roadmap

The consolidated implementation plan and status checklist is in [`plan.md`](./plan.md).

- [Runtime validation and compatibility](docs/RUNTIME_VALIDATION.md)
- [Expression validation diagnostics](docs/VALIDATION_DIAGNOSTICS.md)

Browser capability tokens are not embedded in room URLs. The client authenticates after a secure WebSocket opens and uses `Authorization: Bearer` for HTTP room requests, reducing leakage through access logs, referrers, and copied invite URLs. See `docs/TOKEN_SECURITY.md`.

## Browser integration automation

Draftroll includes Playwright coverage for real WebGL rendering, cross-origin overlay isolation, CSP enforcement, pointer dismissal, multi-participant rooms, hidden/reveal behavior, and reconnect replay.

```bash
pnpm test:browser:install
pnpm test:browser:chromium
pnpm test:browser
```

The suite uses local static fixtures and local Wrangler only. No deployment is performed. See [`docs/BROWSER_TESTING.md`](docs/BROWSER_TESTING.md).

- [Concurrent table rolls](docs/CONCURRENT_TABLE_ROLLS.md)
- [Natural exact-result physics](docs/NATURAL_TARGET_PHYSICS.md)
- [Large-pool physical integrity](docs/LARGE_POOL_PHYSICS.md)
