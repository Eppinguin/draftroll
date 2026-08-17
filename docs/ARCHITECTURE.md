# Architecture

```text
Roll input
  ├─ expression ──────────────┐
  ├─ structured configuration ├─> @draftroll/core
  └─ explicit results ────────┘          │
                                         v
                              NormalizedRollResult
                                 │             │
                                 │             └─> history / auditing / replay
                                 v
                           @draftroll/sdk
                                 │
                    ┌────────────┴────────────┐
                    v                         v
          @draftroll/renderer       @draftroll/overlay
          same-document bridge       host-site iframe transport
                    │                         │
                    └────────────┬────────────┘
                                 v
                    supplied Draftroll 3D engine
```

The recommended third-party website path is `@draftroll/overlay`. It creates a transparent fixed iframe, sends normalized rolls through `postMessage`, and renders the result panel in a host-side Shadow DOM. By default the dice layer does not intercept host-page pointer input; explicit interaction configuration opts the iframe and canvas into pointer handling. It creates no idle dice during mount/warmup and can arm click-anywhere dissolve after a completed throw.

Connected mode adds an optional path without changing the normalized renderer boundary:

```text
@draftroll/sdk DraftrollRoomSession
        │ high-level roll handles
        v
@draftroll/client
        │ correlated WebSocket requests + reconnect cursor
        v
Cloudflare Worker router
        │
        v
one Durable Object per room
        ├─ restores participant state from WebSocket attachments
        ├─ evaluates or validates complete authoritative results
        ├─ owns roll actor, visibility, sequence, and revision state
        ├─ projects a different event for each participant
        ├─ buffers sequenced events for reconnect recovery
        └─ persists complete current state and revisions asynchronously
```

Hidden-roll filtering occurs before socket transmission. The renderer and host application never receive unauthorized normalized results.

## Packages

- `@draftroll/protocol`: JSON-serializable result and WebSocket event contracts.
- `@draftroll/core`: parser, AST, evaluator, RNG abstractions, execution limits, external normalization, individual rerolls, and whole-roll revision evaluation.
- `@draftroll/themes`: bundled, HTTP, cached, and composite providers.
- `@draftroll/renderer`: normalized-result adapter for the supplied physical engine bridge.
- `@draftroll/overlay`: transparent iframe lifecycle, cross-origin message protocol, result display, and reroll controls.
- `@draftroll/client`: participant-aware reconnecting room client, clock synchronization, authoritative request promises, permission-projected roll events, presence, and reconnect replay.
- `@draftroll/sdk`: framework-independent facade, local roll handles, `DraftrollRoomSession`, stable realtime roll handles, automatic synchronized presentation, and revision-safe mutations. Browser-aware builds use the browser facade; server/headless code can import `@draftroll/sdk/headless` to exclude static renderer and overlay dependencies.
- `@draftroll/server`: trusted-backend helpers for signing and verifying room-scoped capability tokens.
- `apps/worker`: optional Cloudflare Worker and Durable Object with per-socket permission projection, reconnect buffers, current D1 roll state, and immutable D1 revision history.
- `src`: physical renderer implementation, production overlay entry, and a separate character-sheet host entry. The renderer entry does not import the host test client.

## Package entry-point isolation

`@draftroll/sdk` publishes separate browser and headless source entry points. The browser entry re-exports the renderer and iframe overlay. The headless entry retains local evaluation, structured rolls, normalized results, realtime room sessions, and stable roll handles, while loading overlay support only through the explicit asynchronous `Draftroll.createOverlay()` boundary.

`pnpm test:entrypoints` walks emitted runtime import edges with the TypeScript parser. It verifies that protocol, core, client, themes, server, the headless SDK, and the Worker do not statically reach renderer/overlay code or import Three.js/Cannon-es. It also verifies that browser entries do not pull in the Worker application or Node-only modules, and that the browser SDK still exposes renderer and overlay packages.

`pnpm build:packages` emits publishable ESM and declaration files for every workspace package. `pnpm test:distribution` then packs the public SDK dependency closure, installs it into a clean temporary npm project, and imports the headless and browser entry points through the real package resolver.

## Per-die theme flow

```text
SDK theme selection
  string | ordered array | die-ID map | resolver
                         │
                         v
                NormalizedDieResult.themeId
                         │
                         v
             renderer theme array per throw
```

## Individual reroll flow

```text
Prior normalized expression result
        │ selected initial die ID
        v
Freeze every other initial die by ID
        │
Re-evaluate original AST/expression
        │
Reapply keep/drop, arithmetic, success,
reroll, explosion, min/max operations
        v
New locally authoritative normalized result
        │
        v
Same overlay + result panel
```

## Completed-roll revision flow

```text
Existing NormalizedRollResult
        │ stable rollId + revision N
        v
RollUpdateInput
  ├─ formula / exact values / themes / metadata
  ├─ preserve, reroll selected, or reroll all
  └─ animate or log-only presentation
        │
        v
@draftroll/core recalculates normalized state
        │
        ├─ same rollId and sequence
        ├─ revision N + 1
        ├─ new updatedAt
        └─ recalculated total / keep-drop / operations
        │
        ├─ log-only -> update host result UI and audit log
        └─ animate  -> replay all or selected changed dice
```

The local SDK stores one current result per `rollId` plus immutable revision snapshots. Connected rooms use the same model: the Durable Object broadcasts `roll_updated`, upserts the current `roll_history` row, and appends the new snapshot to `roll_revisions`. Connected updates use `expectedRevision` compare-and-set. High-level room handles send their current revision automatically and stale requests receive `revision_conflict`.

## Renderer behavior retained

The renderer remains responsible for geometry, Cannon-es planning, fixed-face shape-symmetry targeting, additive table state, worker trajectory buffers, effects, sound, and replay. Its bridge supports:

- a completion promise for visible rolls
- future local start timestamps
- one built-in theme ID per die
- per-die themes in recorded replays
- explicit predetermined values
- clearing the visible overlay
- backward-compatible numeric and array calls
- local viewport-aware trajectory planning
- persistent in-flight physical additions
- one physical-table registry as the sole owner of live canonical/generated/custom runtime bindings
- theme geometry profiles change render silhouettes/labels only; physical definitions, colliders, support topology, and authoritative outcomes remain unchanged
- shape-symmetry targeting diagnostics without changing normalized results

## Permission projection flow

```text
Complete StoredRoll inside Durable Object
  ├─ NormalizedRollResult
  ├─ RoomActor
  └─ RollVisibility
          │
          v
canViewRoll(connection participant, actor, policy)
          │
     ┌────┴────┐
     v         v
authorized   unauthorized
full result  result: null
seed/time    no animation data
real policy  visibility: hidden
     │         │
     └────┬────┘
          v
participant-specific WebSocket / HTTP response
```

The complete stored event buffer is never broadcast wholesale. Reconnect events are projected again using the participant's current token, roles, and permissions.

## Sequence model

- `sequence`: creation order of a logical roll; stable across rerolls, corrections, and reveals.
- `revision`: version of that logical roll.
- `eventSequence`: monotonic room event order; advances on new rolls, result updates, and visibility updates.

This separation allows exact roll history and reliable reconnect recovery without turning each revision into a new roll.

## Shared errors and framework bindings

`@draftroll/errors` defines stable public codes/classes and AbortSignal helpers used across rules, renderer, overlay, realtime, themes, and SDK layers. Optional `@draftroll/react`, `@draftroll/vue`, and `@draftroll/svelte` packages adapt the generic `DraftrollSession` event/snapshot contract without introducing application-specific concepts.
