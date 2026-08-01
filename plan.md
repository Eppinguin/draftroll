# Draftroll project plan

Last consolidated: 2026-07-31

This document is the canonical roadmap for Draftroll. It combines the original SDK specification, the implementation decisions made during development, the d20-compatibility work, the website-overlay work, the realtime privacy design, and the competitive review against dddice.

## Status legend

- [x] Implemented and present in the current repository.
- [ ] External deployment, credentials, hosted-service decision, or controlled-hardware validation gate that cannot be completed from repository source alone.
- **Deferred** means intentionally outside the completed product-owned scope.
- **Optional** marks enhancements that are implemented where selected, or intentionally left application/operator-owned where stated.

---

## 1. Product direction and constraints

- [x] Build a local-first dice SDK that works without a Draftroll backend.
- [x] Provide an optional realtime room service for synchronized authoritative rolls.
- [x] Keep the rules engine, renderer, networking, overlay, and high-level SDK separable.
- [x] Make normalized roll results the boundary between evaluation, rendering, networking, history, and application UI.
- [x] Support exact externally supplied results without rerolling them.
- [x] Make the public API suitable for character sheets, VTTs, games, streams, bots, overlays, and unrelated websites.
- [x] Treat application concepts such as character, campaign, action, game system, and source as opaque metadata.
- [x] Do not build a Draftsheet-specific adapter into the core SDK.
- [x] Use Draftsheet and the included character-sheet client only as integration examples and acceptance-test hosts.
- [x] Do not require Draftroll accounts, login, organizations, subscriptions, or account-linked ownership.
- [x] Use ephemeral room participant/session identity where realtime ownership and permissions require it.
- [x] Enforce hidden-result privacy on the server rather than asking consuming applications to conceal delivered values.
- [x] Use pnpm as the workspace package manager.
- [x] Use `wrangler.jsonc` for the Cloudflare Worker configuration.
- [x] Focus on feature completeness before public package publishing.
- [x] Exclude npm publishing, registry credentials, release marketing, billing, and entitlement systems from the current workstream.

---

## 2. Repository and package architecture

### Current packages

- [x] `@draftroll/errors`: stable cross-package errors, codes, and cancellation helpers.
- [x] `@draftroll/protocol`: normalized result and realtime protocol types.
- [x] `@draftroll/core`: parser, evaluator, RNG, AST, result trees, revisions, and custom dice.
- [x] `@draftroll/themes`: theme manifests and provider abstractions.
- [x] `@draftroll/renderer`: renderer-facing normalized-result adapter.
- [x] `@draftroll/overlay`: transparent website overlay and result panel.
- [x] `@draftroll/client`: realtime room client and clock synchronization.
- [x] `@draftroll/sdk`: high-level local, overlay, structured, external, and realtime facade.
- [x] `@draftroll/react`, `@draftroll/vue`, and `@draftroll/svelte`: optional generic framework bindings.
- [x] `@draftroll/server`: signed room-capability token helpers.
- [x] `@draftroll/worker`: optional Cloudflare Worker, Durable Object, WebSocket, and D1 backend.

### Architecture boundaries

- [x] The renderer consumes normalized results and does not parse dice formulas.
- [x] The realtime backend uses the same TypeScript evaluation core as local execution.
- [x] Local SDK operation does not require Worker, Durable Objects, D1, accounts, or network access.
- [x] Overlay rendering is isolated from the consuming application's CSS and DOM through an iframe.
- [x] The consuming application can disable 3D rendering while continuing to use rules and realtime data.
- [x] Add versioned runtime schema exports for public protocol payloads, normalized results, participant identities, and room capability payloads.
- [x] Define explicit backwards-compatibility rules for protocol and normalized-result schema versions.
- [x] Add package-level browser/server entry-point tests proving that imports do not accidentally include WebGL code.

---

## 3. Rules engine and d20 language

### Expression support

- [x] TypeScript-native parser and evaluator.
- [x] Integer and decimal literals.
- [x] Standard `dN` notation, including omitted count.
- [x] Zero-die pools and `d1`.
- [x] Arbitrary numeric dice such as d3, d5, d7, d9, and large dN.
- [x] Percentile notation `d%`.
- [x] Fate/Fudge dice `dF`.
- [x] Parentheses and unary positive/negative operations.
- [x] Addition, subtraction, multiplication, division, integer division, and modulo.
- [x] Empty, singleton, and multi-value expression sets.
- [x] Keep and drop selectors.
- [x] Highest and lowest selectors.
- [x] Literal and comparison selectors.
- [x] Reroll-until-clear.
- [x] Reroll-once.
- [x] Reroll-and-add.
- [x] Recursive explosions.
- [x] Minimum and maximum modifiers.
- [x] Binary comparison expressions.
- [x] Explicit success counting through `cs` and `count`.
- [x] Draftroll compatibility dialect for the earlier success-count shorthand.
- [x] Inline annotations.
- [x] Trailing comments when enabled.
- [x] Advantage and disadvantage helpers.
- [x] Basic critical-success and critical-failure classification for qualifying d20 pools.
- [x] Execution limits for rerolls, explosions, and expression size.

### Developer-facing rules features

- [x] Parser cache.
- [x] Reusable compiled expressions.
- [x] Validation without requiring exception-based control flow.
- [x] Safe `tryRoll` behavior.
- [x] Parsed AST access.
- [x] Evaluated result-tree access.
- [x] Tree traversal helpers.
- [x] Default formatting.
- [x] Custom result stringification.
- [x] Injected secure or deterministic seeded RNG.
- [x] Headless operation without a renderer.
- [x] Add richer validation diagnostics with stable error codes, source ranges, and suggestions.
- [x] Add optional parser/evaluator instrumentation for profiling complex formulas.
- [x] Document the exact supported upstream d20 baseline, compatibility differences, and the update policy for future upstream versions.

---

## 4. Structured and custom dice API

- [x] Roll structured dice without notation.
- [x] Typed dice builders.
- [x] Typed selector builders.
- [x] Typed operation builders.
- [x] Scope operations to specific source dice.
- [x] Structured keep/drop parity with expression rolls.
- [x] Structured reroll-until-clear parity.
- [x] Structured reroll-once parity.
- [x] Structured reroll-and-add parity.
- [x] Structured explosion parity.
- [x] Structured minimum/maximum parity.
- [x] Structured success-count parity.
- [x] Registered weighted dice.
- [x] Registered repeated-face dice with stable `faceIndex`.
- [x] Registered symbolic/string-result dice with numeric contributions.
- [x] Face labels and face metadata.
- [x] Inline portable custom-die definitions.
- [x] Preserve custom definitions in normalized results for room rerolls and revisions.
- [x] Support exact externally authoritative structured results.
- [x] Add a formal custom-die visual-fallback contract shared by renderer and theme packages.
- [x] Add optional helper factories for common nonstandard dice: coin, dF, percentile pair, symbol pool, and card/table draw.

---

## 5. Normalized results

- [x] JSON-serializable normalized result.
- [x] Stable roll ID.
- [x] Revision number and update timestamp.
- [x] Authority/source information.
- [x] Original and normalized formula data.
- [x] Exact total and integer-compatible total.
- [x] Per-die ID, type, sides, result, contribution, and source index.
- [x] Kept/dropped state.
- [x] Generated source such as initial, reroll, reroll-add, explosion, and external.
- [x] Immediate causal source IDs for generated reroll and explosion dice.
- [x] Theme and appearance metadata per die.
- [x] Custom face result, label, index, and metadata.
- [x] Operations and annotations.
- [x] Comment and critical state.
- [x] Evaluated result tree.
- [x] Opaque application metadata.
- [x] Created and updated timestamps.
- [x] Stable logical identity across completed-roll revisions.
- [x] Add an explicit normalized-result schema version field and migration helpers.
- [x] Add strict runtime decoding for external results and persisted results.
- [x] Add configurable metadata-size, nesting-depth, key-count, array-length, and string-length limits.

---

## 6. High-level SDK usability

### Local API

- [x] `draftroll.roll(expression)` simple API.
- [x] Object-form roll requests.
- [x] `draftroll.compile()` reusable formulas.
- [x] `draftroll.validate()`.
- [x] `draftroll.tryRoll()`.
- [x] `draftroll.rollDice()` structured API.
- [x] `draftroll.display()` external exact-result mode.
- [x] Local events.
- [x] Stable local roll handles.
- [x] `wait()`/presentation completion behavior.
- [x] Per-die theme assignment by array, ID map, resolver, or direct `themeId`.
- [x] Renderer-free/headless construction.

### Realtime API

- [x] High-level `DraftrollRoomSession`.
- [x] Near-simultaneous room rolls merge into one bounded shared table presentation while retaining independent handles.
- [x] Stable `DraftrollRoomRoll` handles.
- [x] Await room rolls as authoritative results rather than request tokens.
- [x] Automatic request/result correlation.
- [x] Automatic optimistic revision preconditions.
- [x] Room events for visible results and hidden projections.
- [x] Participant and session state events.
- [x] Opaque application metadata.
- [x] Add a single top-level lifecycle-managed session object that can switch local/realtime and renderer on/off without rebuilding consumer state.
- [x] Add first-party generic React bindings as a separate optional package, not application-specific adapters.
- [x] Add equivalent lightweight Vue and Svelte bindings over the stable generic event API.
- [x] Add cancellable operations using `AbortSignal` for connection, loading, and long presentation work.
- [x] Add richer connection-state diagnostics and recovery recommendations.

### API design rules

- [x] Simple operations have simple defaults.
- [x] Advanced behavior remains accessible through lower-level packages.
- [x] Applications do not manage WebSocket request correlation manually.
- [x] Applications do not manage renderer iframe DOM manually.
- [x] Applications do not need to replace logical roll IDs when a die is rerolled.
- [x] Applications do not receive unauthorized hidden values.
- [x] Provide stable error classes/codes across core, renderer, overlay, and realtime packages.
- [x] Add API examples for framework-free browser apps, React, server/headless use, VTTs, bots, and stream overlays.
- [x] Adopt parser-validated TSDoc for package entry points, exported declarations, and meaningful public class members; preserve it in generated declarations.

---

## 7. Completed-roll updates and history

- [x] Change individual die values after a roll.
- [x] Change the formula after a roll.
- [x] Preserve compatible existing values while changing a formula.
- [x] Reroll selected dice while updating a roll.
- [x] Reroll every die while updating a roll.
- [x] Add or remove dice from structured/external rolls.
- [x] Change themes and appearance metadata.
- [x] Change annotations, comments, roll metadata, and explicit total.
- [x] Log-only updates without replaying 3D dice.
- [x] Animated updates.
- [x] Animate only changed dice.
- [x] Preserve stable `rollId`, sequence, and creation time.
- [x] Increment revision and update time.
- [x] Local current-roll log.
- [x] Local immutable revision snapshots.
- [x] D1 current roll rows.
- [x] D1 revision snapshots.
- [x] Realtime in-place roll updates.
- [x] Individual die rerolls from stable handles.
- [x] Formula replacement from stable handles.
- [x] Log-only correction helpers.
- [x] Revision conflict rejection through `expectedRevision`.
- [x] Add optional audit reason/label fields for corrections, reveals, and visibility changes.
- [x] Add optional automatic retry/merge strategies for revision conflicts.
- [x] Add transactional bulk roll updates for applications that need multi-roll corrections.
- [x] Define and enforce per-roll revision caps plus time-based revision retention.

---

## 8. Renderer and physical dice

### Implemented physical rendering

- [x] Three.js renderer separated from rules and networking.
- [x] Cannon-based physics planning.
- [x] Deterministic authoritative landing for supported physical dice.
- [x] d4 physical mesh and collider.
- [x] d6 physical mesh and collider.
- [x] d8 physical mesh and collider.
- [x] d10 physical mesh and collider.
- [x] d12 physical mesh and collider.
- [x] d20 physical mesh and collider.
- [x] Mixed d4/d6/d8/d10/d12/d20 dice in one physical simulation and replay.
- [x] Per-die built-in themes in mixed pools.
- [x] Replay data retains mixed-die kinds.
- [x] Individual-die animation appends replacement dice while retaining the original and all prior reroll history on the visible table.
- [x] Stage evaluator-generated rerolls and recursive explosions after their triggering dice settle, retaining every prior physical or fallback wave and withholding the final total until the last wave.
- [x] Animation of only revised dice when requested.
- [x] Result effects and built-in theme capability metadata.
- [x] No idle dice before a roll.
- [x] Dice remain after completion until dismissed.
- [x] Click-anywhere dissolve and clear after completion.
- [x] Idle-zero render scheduling: no perpetual animation loop before, between, or after rolls.
- [x] Low-power overlay WebGL initialization without standalone bloom-composer allocation.
- [x] Auto, battery, and quality renderer performance profiles.
- [x] Count-aware 60/30 FPS active frame budgets and pixel-ratio caps.
- [x] Hysteresis-based dynamic resolution scaling.
- [x] Bounded serialized presentation queue to prevent `Renderer is busy` failures.
- [x] Lazy physics-worker creation and idle termination.
- [x] Automatic hidden-page settlement without hidden-tab outcome effects.
- [x] Canvas CSS viewport, backing buffer, and orthographic camera use one measured aspect ratio, including initially hidden/cross-origin iframes.
- [x] Small overlay rolls retain antialiasing and bounded low-resolution shadows for dimensional clarity without restoring an idle render loop.
- [x] Conservative per-die visual-radius containment prevents physical and custom-mesh dice from being clipped by the viewport edges.
- [x] Multiple authorized participants can roll concurrently in one shared physics plan with separate hand lanes, actor labels, and independent logical completions.
- [x] Near-simultaneous throws can be coalesced before launch.
- [x] Later compatible physical rolls can be injected into an already-moving table rather than waiting for an isolated presentation.
- [x] Compatible physical rolls can also join recently settled dice without clearing the table first.
- [x] Existing active dice continue from sampled transforms, linear velocities, and angular velocities when a new handful enters.
- [x] Physical dice from separate logical rolls exchange real Cannon contact impulses in one shared world.
- [x] Authoritative values use fixed face labels and local-space result normals rather than post-plan face relabeling.
- [x] Standard d4, d6, d8, d10, d12, and d20 results use proper rotational symmetries applied across the complete recorded trajectory.
- [x] Remove candidate-search failure paths, late target torque, micro-correction, quaternion snaps, and second settlement movement.
- [x] Validate every value-to-value symmetry for all supported standard physical dice.
- [x] Final physical top faces are verified against authoritative values before playback is accepted.
- [x] Near-simultaneous throws share one fully dynamic collision world from frame zero.
- [x] Later in-flight additions preserve already-visible verified trajectories as moving colliders while incoming dice remain dynamic.
- [x] Exact-result planning uses each client’s measured viewport bounds, allowing layout-specific motion while results remain identical.
- [x] Targeting diagnostics expose the shape-symmetry method, retargeted count, alignment, planning time, and final success.
- [x] Large physical pools hide every provisional transform and render only one committed verified trajectory from frame zero.
- [x] Pools of twelve or more use a broad staged pour with invisible, collision-disabled pre-release bodies instead of a compact pressure stack.
- [x] Dense and parallel physical plans use 120 Hz simulation/recording, shape-specific collider skins, and stronger contact solving to reduce visible penetration.
- [x] Add deterministic and Chromium regression coverage for predetermined 20d20 continuity, activation timing, and exact results.
- [x] Concurrent table bursts are bounded by roll and visual limits and partition safely when they exceed one simulation budget.
- [ ] **External controlled-hardware gate:** record slow-motion perceptual-quality and collision-realism acceptance on the supported browser/device matrix.
- [x] Extend in-flight additive planning to physical-plus-fallback mixed presentations.

### Required physical fallback layer

- [x] Render d2 as a coin or equivalent physical/token fallback.
- [x] Render percentile tens (`d10x`) distinctly.
- [x] Render d100 as two percentile dice or a synchronized result token.
- [x] Render Fate/Fudge dice.
- [x] Render arbitrary numeric dice such as d3, d5, d7, and d9 through appropriate prism/spinner/token fallbacks.
- [x] Render very large dN through synchronized spinner/token/card presentation.
- [x] Render symbolic dice through custom-faced supported physical shells when `renderAs` and stable face identity are provided.
- [x] Render symbolic dice through animated token/card fallback where a physical mesh is unavailable.
- [x] Render weighted table/custom result selections through a synchronized token/card fallback.
- [x] Allow supported physical dice and unsupported fallback components in the same synchronized roll.
- [x] Ensure unsupported visual shapes never cause the entire normalized roll to fail.

### Renderer controls and lifecycle

- [x] Seek into a prerecorded replay when a synchronized event arrives late.
- [x] Define adaptive late-event behavior when most of an animation has already elapsed.
- [x] Add typed roll loading, started, settled, completed, dissolve-started, and dissolve-finished events.
- [x] Add automatic page-visibility suspension and final-state settlement.
- [x] Add explicit manual pause/resume controls for specialized integrations. **Optional**
- [x] Add configurable auto-clear and persistence behavior.
- [x] Add a screenshot/export-frame API. **Optional**
- [x] Add camera reset and constrained camera options. **Optional**
- [x] Add preview mode for theme/die inspection. **Optional**
- [x] Add physical click-to-reroll, drop, or explode behavior with application-owned rule semantics. **Optional competitive feature**
- [x] Add draggable/movable settled dice. **Optional competitive feature**
- [x] Add participant-based renderer filtering. **Optional**, useful for selective room views.

---

## 9. Website overlay and result presentation

- [x] Transparent fixed-position iframe overlay.
- [x] Container-scoped overlay option.
- [x] Overlay does not block the underlying application through normal pointer behavior.
- [x] Host application does not need a renderer canvas in its own DOM.
- [x] Versioned `postMessage` communication.
- [x] Cross-origin target-origin configuration.
- [x] SDK-owned mount, visibility, clear, dismiss, and destroy lifecycle.
- [x] Shadow-DOM built-in result panel.
- [x] Configurable result-panel placement and visibility.
- [x] Result panel shows total, expression, authority, dice, kept/dropped state, and themes.
- [x] Result panel can be disabled for application-owned UI.
- [x] Overlay can present server-authoritative normalized results.
- [x] Overlay can update the result panel without replaying dice.
- [x] No visible dice during initialization or theme warmup.
- [x] Click dismissal preserves the underlying application click.
- [x] Host applications can exempt roll controls from pointer dismissal so a new room request does not clear settled table dice while waiting for the server.
- [x] Add automated cross-origin iframe tests.
- [x] Add browser coverage for two participants rolling simultaneously into one spectator table throw.
- [x] Add browser coverage for a later physical roll joining an already-moving spectator table.
- [x] Add CSP test fixtures and documented policy presets.
- [x] Add accessibility review and automated coverage for result announcements, keyboard-inert overlays, and Escape dismissal.
- [x] Add responsive renderer tuning and mobile Chromium coverage for small embedded containers.
- [x] Add reduced-motion behavior and an accessible non-3D text presentation fallback.

---

## 10. Themes, assets, audio, and effects

### Implemented theme foundation

- [x] Theme IDs on normalized results and individual dice.
- [x] Built-in theme support.
- [x] Per-die theme selection.
- [x] Bundled theme provider interface.
- [x] HTTP theme provider interface.
- [x] Cached and composite providers.
- [x] Theme capability and audio metadata.

### Runtime theme work

- [x] Define a stable versioned runtime `DiceTheme` manifest with name, previews, available dice, and capabilities.
- [x] Apply downloaded constrained material parameters at runtime.
- [x] Apply downloaded surface, normal, and roughness textures at runtime.
- [x] Apply shared or die-specific 5×4 face-label atlases at runtime.
- [x] Apply optional downloaded fonts through the browser `FontFace` API with safe fallback.
- [x] Load, decode, and use optional theme-specific impact and roll sounds with synthesized fallback.
- [x] Map runtime themes to the constrained built-in effect preset catalog.
- [x] Load visual glTF/GLB meshes for supported physical dice with vertex/bounds validation and standard-mesh fallback.
- [x] Respect per-die physical size, inertia, and weight metadata within validated renderer limits.
- [x] Add theme previews and supported-die metadata suitable for application theme pickers.
- [x] Add resource preload, `AbortSignal` cancellation, progress, failure events, and asset-size limits.
- [x] Add manifest schema/version validation and explicit theme/asset cache invalidation.
- [x] **Deferred/conditional by product scope:** runtime HTTP/object-storage theme providers are implemented; no Draftroll-operated R2 catalog is required unless hosted asset management is chosen.
- [x] Start with constrained materials/effects rather than arbitrary untrusted shaders.
- [x] **Deferred by design:** arbitrary custom shaders remain excluded; constrained materials, effects, meshes, and validated assets are the supported extension model.

---

## 11. Realtime room protocol

### Identity and presence

- [x] Ephemeral participant ID.
- [x] Ephemeral session ID.
- [x] Participant display name.
- [x] Roles and permission claims.
- [x] Participant join events.
- [x] Participant update events.
- [x] Participant leave events.
- [x] Participant snapshots in room state.
- [x] Hibernation-safe participant data attached to WebSockets.
- [x] Tune stale-presence and timeout behavior through policy-driven session expiry and Durable Object alarms.
- [x] Add configurable participant metadata byte limits in addition to runtime schema validation.

### Request lifecycle

- [x] Request ID correlation.
- [x] Stable client roll ID.
- [x] Mutating methods resolve to authoritative events.
- [x] Initiator-only request/client IDs in projections.
- [x] Request timeout handling.
- [x] Recent request deduplication.
- [x] Duplicate requests receive the retained original projection.
- [x] Add request metrics and cleanup diagnostics.
- [x] Add persistent D1 request-idempotency records for retries beyond the in-memory cache.

### Event sequencing and recovery

- [x] Monotonic room event sequence.
- [x] Bounded recent-event buffer.
- [x] Reconnect with last processed sequence.
- [x] Replay missed roll and participant events.
- [x] Truncation signal when a cursor is older than the retained buffer.
- [x] Add durable D1-backed long-range event recovery beyond the in-memory replay buffer.
- [x] Add optional participant renderer/theme readiness policy before synchronized starts.
- [x] Add adaptive start buffers based on measured clock skew and room latency.
- [x] Add late animation seeking in the renderer.

### Runtime validation

- [x] Decode every inbound WebSocket command using strict runtime schemas.
- [x] Decode every outbound Worker event before sending and every inbound client event before dispatch.
- [x] Enforce command and server-event payload-size limits.
- [x] Enforce metadata depth, key count, array length, encoded size, and string-size limits.
- [x] Add protocol-version negotiation and explicit HTTP 426 unsupported-version responses.
- [x] Add deterministic malformed-payload fuzz tests for protocol and normalized-result decoders.

---

## 12. Hidden rolls and permissions

### Implemented server-enforced privacy

- [x] Durable Object stores the complete authoritative result.
- [x] Per-participant event projection before WebSocket delivery.
- [x] Permission-projected HTTP room state.
- [x] Permission-projected D1 history.
- [x] Permission-projected revision history.
- [x] Unauthorized clients receive `result: null` rather than hidden values.
- [x] Unauthorized projections omit expression, total, dice, operations, critical state, metadata, custom definitions, animation seeds, and the real visibility rule.
- [x] Public visibility.
- [x] Roller-only visibility.
- [x] Role-based visibility.
- [x] Participant-based visibility.
- [x] Combined participant-or-role visibility.
- [x] Reveal by changing visibility on the same roll.
- [x] Partial reveal to selected participants or roles.
- [x] Visibility revisions increment the existing roll revision.
- [x] Reconnecting clients receive only what their current permissions allow.

### Permission and capability model

- [x] Signed room-scoped capability tokens.
- [x] Local unsigned anonymous mode for trusted development.
- [x] Own-roll create/update/reveal permissions.
- [x] Any-roll view/update/reveal permissions for privileged roles.
- [x] Roll ownership enforcement.
- [x] Revision-precondition enforcement.
- [x] Add issuer and audience claims.
- [x] Add signing-key IDs and verification-key rotation.
- [x] Add exact token-ID and participant issued-before revocation for long-lived rooms.
- [x] Add versioned configurable room policy objects.
- [x] Add open-table, private-GM-table, and moderated-public-room policy presets.
- [x] Add optional server-enforced room passwords with salted PBKDF2 verification, rate-limited attempts, password-free events/history, and SDK connection helpers.
- [x] Add audit reason/label fields for privileged visibility and correction actions.
- [x] Add explicit participant/role whisper convenience APIs while retaining the general visibility model.
- [x] Document that changing visibility cannot retract data already delivered while a roll was public.

---

## 13. Cloudflare backend

### Implemented backend

- [x] Cloudflare Worker routing.
- [x] One Durable Object per room.
- [x] WebSocket upgrade and hibernation-compatible sockets.
- [x] Server-authoritative RNG and evaluation.
- [x] Scheduled synchronized animation start time.
- [x] D1 current roll history.
- [x] D1 immutable revision snapshots.
- [x] Database migrations.
- [x] Broadcast before asynchronous D1 persistence to keep storage outside the hot animation path.
- [x] Health endpoint.
- [x] Permission-projected state, history, and revision endpoints.
- [x] Local anonymous development setting.
- [x] Signed-token verification path.
- [x] Versioned token headers with key IDs, issuer/audience checks, issued-at/not-before/expiry validation, detailed verification errors, and legacy-token migration.
- [x] Keep browser capability tokens out of URLs through post-open encrypted WebSocket authentication and HTTP Bearer headers.
- [x] Durable Object exact-token and participant-cutoff revocation with manager-only sequenced events and active-session disconnects.

### Public-service hardening

- [x] Per-IP rate limits inside each room Durable Object. A global edge-wide Cloudflare Rate Limiting binding remains optional for multi-room abuse control.
- [x] Per-room roll rate limits.
- [x] Per-session command and per-participant mutation rate limits.
- [x] Per-room-IP password-attempt limits and unauthenticated WebSocket gating before room state or replay delivery.
- [x] Configurable maximum inbound WebSocket message size.
- [x] Configurable maximum unique room sessions/participants.
- [x] Configurable current-roll and per-roll revision caps in Durable Object and D1 storage.
- [x] Configurable bounded replay-event buffer.
- [x] Policy-driven room idle expiry through Durable Object alarms.
- [x] Alarm-driven D1 history/revision retention and orphan cleanup.
- [x] Bounded D1 retry/backoff for persistence and cleanup operations.
- [x] Durable capped persistence-failure records plus structured error logs.
- [x] Origin allowlisting is enforced for browser HTTP and WebSocket requests; deployment-specific values remain configuration.
- [x] Structured abuse/limit logging and a policy-level emergency room enabled/disabled switch with reason.
- [x] Structured room, roll, policy, retry, expiry, and persistence-failure logs.
- [x] Metrics for latency, request failures, conflicts, reconnect replay, and hidden projections.
- [x] Provide dashboard panel guidance, thresholded health probes, and alert recommendations.
- [x] Provide incident-response and non-destructive rollback procedures.
- [x] Provide an external entropy/audit policy and deployment decision framework.
- [x] **Conditional/deferred:** generic HTTP/object-storage theme loading is implemented; an operator-owned R2 catalog is not required by the SDK.

---

## 14. Room policy configuration

> Policy changes are additive to protocol version 2 during pre-release development. Package versions remain unchanged at `0.1.0`; no deployment or release bump is part of this milestone.

- [x] Define a versioned `RoomPolicy` model and validated patch format.
- [x] Configure whether participants may update their own rolls.
- [x] Configure whether participants may reroll their own dice.
- [x] Configure whether participants may reveal their own hidden rolls.
- [x] Configure whether privileged participants may update/reveal any roll.
- [x] Configure whether hidden and targeted whisper rolls are allowed.
- [x] Configure and enforce maximum dice per roll.
- [x] Configure and enforce expression length and operation-count limits.
- [x] Configure maximum room participants.
- [x] Configure stale-session timeout, room idle expiry, history retention, revision retention, and maintenance cadence.
- [x] Configure renderer-related defaults separately from authorization policy.
- [x] Ensure policy changes are revision-checked, sequenced, request-correlated, and replayable room events.
- [x] Ensure authorization, visibility, result-size, rate, participant, retention, and shutdown policy is enforced by the Durable Object.

---

## 15. Test clients and integration examples

- [x] Vite playground for engine development.
- [x] Basic paper-style character-sheet test host.
- [x] Character name and roll/action name inputs.
- [x] Free-form formula input.
- [x] Server-authoritative formula rolls.
- [x] Room controls.
- [x] Room-backed dice log.
- [x] Whole-roll reroll controls.
- [x] Individual-die reroll controls.
- [x] Formula update and animated revision controls.
- [x] Log-only correction controls.
- [x] Transparent SDK overlay over the sheet rather than a separate dice table.
- [x] Dice absent before a roll.
- [x] Click-anywhere dissolve after completion.
- [x] Predetermined-result controls for testing exact target faces locally and through the room server.
- [x] Staged two-roller playground scenario with configurable second actor, formula, fixed values, and delay.
- [x] Explicit clear-table control for persistent table testing.
- [x] Embedded-host example.
- [x] Add a minimal framework-free production integration example with no test-client dependencies.
- [x] Add a React example using generic bindings.
- [x] Add headless server and room-bot examples.
- [x] Add a two-browser hidden-roll/reveal example.
- [x] Add a cross-origin overlay example with explicit CSP configuration.
- [x] Add a custom symbolic-dice example with physical-shell and fallback-safe behavior.
- [x] Keep examples generic and verify they contain no product-specific adapters or entity assumptions.

---

## 16. Testing and validation

### Existing automated validation

- [x] Strict TypeScript package check.
- [x] Strict Worker TypeScript check.
- [x] d20 compatibility test suite.
- [x] Parser validation, compile, traversal, and formatting tests.
- [x] Weighted, symbolic, repeated-face, and portable custom-die tests.
- [x] Structured operation-parity tests.
- [x] Completed-roll revision tests.
- [x] Individual reroll and value-preservation tests.
- [x] Mixed physical renderer bridge tests.
- [x] Physical-plus-fallback renderer bridge tests.
- [x] Fallback-only renderer source regression tests.
- [x] Character-sheet source/integration tests.
- [x] Signed capability-token tests.
- [x] Token issuer/audience, key rotation, detailed failure, and revocation tests.
- [x] Hidden projection tests.
- [x] Request-correlation tests.
- [x] Revision-conflict tests.
- [x] Visibility revision tests.
- [x] Stable realtime roll-handle tests.
- [x] Runtime protocol/result schema tests.
- [x] Deterministic malformed-payload fuzz corpus.
- [x] Protocol-version negotiation tests.
- [x] Node script syntax checks.
- [x] Local Wrangler smoke-test scripts.
- [x] Archive integrity checks used for delivered project snapshots.
- [x] Deterministic late-event synchronization tests covering clock-offset translation, seek/settled/replay modes, adaptive start buffers, and bridge propagation.

### Required browser and integration automation

- [x] Real browser WebGL roll tests are implemented in Playwright; the first installed-browser execution remains an environment validation step.
- [x] Mixed physical and fallback-die visual tests.
- [x] Overlay mount/unmount lifecycle tests.
- [x] No-idle-dice regression test.
- [x] Click-dismiss and underlying-click passthrough test.
- [x] Cross-origin iframe test.
- [x] CSP test matrix for allowed embedding, blocked frame origins, and blocked room connections.
- [x] Mobile Chromium device-emulation project; real-device validation remains pending.
- [x] Reduced-motion and no-WebGL accessible fallback test.
- [x] Two-participant room test.
- [x] Three-participant room convergence test.
- [x] Deterministic abnormal-disconnect, reconnect-backoff, observer-failure, and browser offline/reconnect tests.
- [x] Basic missed-event reconnect replay test.
- [x] Replay-buffer truncation, durable long-range recovery, ordering, and duplicate-suppression test.
- [x] Browser WebSocket hidden-result and reveal non-leak test.
- [x] Browser HTTP state, durable events, D1 history, and revision-boundary non-leak tests.
- [x] Permission escalation and malformed-token adversarial tests.
- [x] Concurrent/stale revision-conflict tests and automatic conflict-strategy coverage.
- [x] Deterministic hibernation attachment/restoration contract tests; local/hosted restart execution remains an environment validation step.
- [x] Deterministic bounded D1 retry, failure-record, migration, and diagnostics contract tests.
- [x] Origin, protocol-version, command-size, and metadata/payload enforcement tests.

### Performance validation

- [x] Measure authoritative request latency through client metrics and repeatable resilience tests.
- [x] Measure clock uncertainty, offset translation, and scheduled-start skew in deterministic synchronization tests.
- [x] Measure renderer frame timing for idle and small-pool profiles in Chromium diagnostics.
- [x] Measure renderer frame time, planning diagnostics, and optional JS heap data for 30-dice pools.
- [x] Measure mixed physical/fallback synchronized presentations.
- [x] Measure theme-resource load/cache behavior and verify upstream cache hits in a repeatable SDK benchmark.
- [x] Measure reconnect recovery duration and heap change in the deterministic resilience benchmark.
- [x] Define renderer runtime budgets for auto, battery, quality, large-pool, DPR, and active-frame behavior.
- [x] Add repeatable deterministic and Chromium WebGL benchmark scripts.
- [ ] **External controlled-hardware gate:** record and retain baseline reports for each supported desktop/mobile device class.

---

## 17. Local development and internal deployment

### Implemented local workflow

- [x] pnpm workspace configuration.
- [x] Root pnpm scripts.
- [x] `wrangler.jsonc` configuration.
- [x] Local D1 migrations.
- [x] Local Durable Object and WebSocket server command.
- [x] Worker reset and history commands.
- [x] One-command local Worker smoke-test orchestration.
- [x] Combined Worker and playground stack command.
- [x] Overlay production build command.
- [x] Internal self-hosting notes.
- [x] Playground explicitly excluded from deployment artifacts.

### Internal/hosted deployment work

- [x] Provide explicit secure staging and production Wrangler environment templates.
- [ ] **External deployment gate:** create Cloudflare D1 databases and populate the real staging/production IDs in the gitignored deployment config.
- [x] Provide per-environment key-ring secret commands, issuer/audience/JTI requirements, and templates that disable unsigned anonymous access outside development.
- [x] Provide exact per-environment allowed-origin configuration and enforcement; deployment owners must replace example domains.
- [x] Configure room limits, expiry, and retention through stored room policies and Durable Object alarms.
- [x] Configure and document token rotation and secrets-management procedures.
- [x] Document and build overlay assets for same-origin serving by the consuming site.
- [x] Validate cross-origin overlay hosting through CSP/cross-origin fixtures and examples.
- [ ] **External deployment gate:** assign the operator-owned custom domain/route in Cloudflare and replace the example route.
- [x] Add environment-aware deployment smoke tests for service metadata, health, CORS, protocol, and authorized room state.
- [x] Add thresholded health/diagnostic probes, monitoring/alert guidance, incident response, and rollback procedures.

### Explicitly deferred publishing work

- [x] **Deferred:** publishing packages to npm or another public registry.
- [x] **Deferred:** registry tokens and trusted publishing.
- [x] **Deferred:** public release automation and version-release workflow.
- [x] **Deferred:** marketing site, pricing, billing, and entitlements.
- [x] **Deferred:** Draftroll-managed user profiles, campaigns, and account-linked storage.

---

## 18. Competitive roadmap relative to dddice

### Areas where Draftroll already has the intended advantage

- [x] Complete local/offline rules operation.
- [x] Stronger d20-compatible expression evaluation.
- [x] Structured notation-free operation parity.
- [x] Weighted and symbolic custom dice.
- [x] Exact external results.
- [x] Stable logical roll revisions rather than replacement-roll workarounds.
- [x] Individual rerolls with whole-formula recalculation.
- [x] Server-enforced hidden-result privacy.
- [x] Accountless room capabilities.
- [x] Transparent SDK-owned website overlay.
- [x] No idle dice and click-anywhere dismissal.
- [x] Mixed standard polyhedral dice in one physical roll.
- [x] Generic metadata rather than application-specific assumptions.

### High-value competitive gaps

- [x] Complete visual fallback coverage for every evaluated die/result type.
- [x] Runtime theme catalog with previews and supported-die filtering.
- [x] Runtime custom textures, label atlases/decals, sounds, effects, and validated visual meshes.
- [x] Late-event animation seeking.
- [x] Core room-service controls: policy authorization, limits, rate limiting, expiry, retention, origin enforcement, and shutdown. Hosted operations/monitoring remain.
- [x] Comprehensive browser, privacy-boundary, CSP, reconnect, protocol-fuzz, and security automation is present.
- [x] Generic first-party React, Vue, and Svelte bindings.
- [x] Typed complete renderer lifecycle events.

### Optional dddice-style capabilities to consider later

- [x] Physical click behavior: reroll, explode, drop, or no action.
- [x] Dragging and moving settled dice.
- [x] Screenshot/export-frame API.
- [x] Constrained camera controls, reset, and autorotation.
- [x] Theme/die preview mode.
- [x] Manual pause/resume.
- [x] Transactional bulk roll updates.
- [x] Participant-based renderer filtering.
- [x] Room-level validated physics presets preserved through replay.
- [x] **Skipped by design:** room background images as a primary renderer feature. Draftroll is intended to overlay the consumer's own application instead.

---

## 19. Feature-completeness milestones

### Milestone A: rules and normalized-result completeness

- [x] d20-compatible expression language.
- [x] Structured equivalent operations.
- [x] Custom weighted/symbolic dice.
- [x] External exact results.
- [x] Stable revisions and individual rerolls.
- [x] Runtime schema/version hardening.
- [x] Structured runtime validation diagnostics.

### Milestone B: embeddable website SDK

- [x] Transparent overlay.
- [x] Result display.
- [x] Per-die themes.
- [x] No idle dice.
- [x] Click dismissal.
- [x] Mixed standard physical dice.
- [x] Unsupported/custom visual fallbacks.
- [x] Runtime custom theme assets through constrained manifests and safe fallbacks.
- [x] Browser, CSP, accessibility, reduced-motion/no-WebGL, and mobile-emulation suites are implemented; real-device runs remain an external validation gate.

### Milestone C: realtime room product

- [x] Authoritative Worker/Durable Object evaluation.
- [x] Participant/session identity.
- [x] Request correlation.
- [x] Stable room roll handles.
- [x] Server-enforced visibility.
- [x] Reveal and visibility revision.
- [x] Revision conflicts.
- [x] Presence and bounded reconnect replay.
- [x] Room policy objects and generic presets.
- [x] Durable Object rate limits and core abuse controls; edge-wide multi-room IP limiting remains optional hosted-service work.
- [x] Alarm-driven room expiry and D1 history/revision retention.
- [x] Token issuer/audience claims, key-ID verification rings, and room-scoped revocation.
- [x] Long-range D1 recovery plus deterministic and browser disconnect/reconnect chaos testing.

### Milestone D: public-service readiness

- [x] All repository-level public-service hardening, limits, persistence, privacy, diagnostics, and secure-deployment defaults are completed.
- [x] Repository-level security review checklist and adversarial protocol/token/privacy tests are completed.
- [x] Repeatable SDK/renderer/reconnect benchmarks and runtime budgets are implemented; controlled device baselines remain external.
- [x] Operational dashboard guidance, alert thresholds, incident response, probes, and rollback procedures completed.
- [x] **Conditional resolved:** generic HTTP/object-storage providers are complete; Draftroll-operated hosted themes remain intentionally unselected.
- [ ] **External deployment gate:** deploy with real Cloudflare resources/secrets and run the provided smoke suite against staging and production.

Public-service readiness is separate from SDK feature completeness. The SDK can remain self-hosted and useful without becoming a Draftroll-operated public service.

---

## 20. Current recommended implementation order

1. [x] Build the synchronized physical/token/card fallback layer for d2, d100, Fate, arbitrary, symbolic, weighted, and custom dice.
2. [x] Implement constrained runtime theme manifests, previews, textures, label atlases, fonts, sounds, effects, and safe visual custom meshes.
3. [x] Add strict runtime protocol/result schemas, payload limits, version negotiation, and structured diagnostics.
4. [x] Add configurable room policies, limits, expiry, retention, and abuse controls.
5. [x] Add token issuer/audience claims, key IDs, signing-key rotation, and room-scoped revocation.
6. [x] Implement late-event replay seeking and adaptive synchronized-start behavior.
7. [x] Add browser-driven overlay, cross-origin, CSP, permission, reconnect, and multi-participant tests.
8. [x] Implement repeatable latency, memory, mixed-pool, theme-cache, reconnect, and 30-dice measurements; controlled hardware baseline recording remains an external gate.
9. [x] Add generic React/Vue/Svelte bindings and framework-free, headless, VTT, bot, overlay, privacy, cross-origin, and symbolic examples.
10. [x] Implement the selected optional renderer controls with typed lifecycle and application-owned rule semantics.

---

## Repository completion boundary

All SDK, package, renderer, protocol, Worker, examples, tests, benchmark tooling, and operational documentation items are implemented in source. The remaining unchecked items require resources that are intentionally not present in a source archive: real Cloudflare account IDs/domains/secrets, a live staging/production deployment, installed browser binaries for an end-to-end Playwright run, and controlled physical device/hardware acceptance records. These are execution gates, not missing product code.

## 21. Acceptance criteria for a feature-complete SDK MVP

Draftroll's SDK MVP can be considered feature-complete when:

- [x] It can evaluate the documented d20 language locally.
- [x] It can accept structured and exact external results.
- [x] It exposes normalized per-die results and stable revisions.
- [x] It can reroll individual dice and revise complete rolls.
- [x] It can mount a transparent overlay over an arbitrary website.
- [x] It has a built-in optional result display.
- [x] It supports mixed standard physical dice.
- [x] Every supported rules-engine result has a visual representation or graceful non-3D fallback.
- [x] Custom theme resources can be loaded and applied at runtime through constrained manifests and safe fallbacks.
- [x] Anonymous room participants can create and update rolls through stable handles.
- [x] Secure deployments can bind capability tokens to issuer/audience, rotate verification keys by key ID, and revoke exact or participant-scoped credentials.
- [x] Hidden values are withheld by the server from unauthorized clients.
- [x] Visibility can be safely expanded through reveal/update operations.
- [x] Reconnects can recover recent missed room events.
- [x] Near-simultaneous authorized rolls can share one physical table throw without merging their room identities or histories.
- [x] A later compatible physical roll can enter an active or recently settled table and interact with existing dice while retaining an independent logical handle.
- [x] Large predetermined pools render one continuous committed trajectory without preview-position replacement or post-settlement correction.
- [x] Runtime schemas reject malformed, unknown-field, incompatible-version, deeply nested, and oversized protocol data consistently.
- [ ] **External execution gate:** install Playwright browsers/dependencies and record a clean full browser/cross-origin run in the target CI/hardware environment.
- [x] Documented performance targets have repeatable measurements and machine-readable reports; controlled hardware baselines remain external.

The following are not required to call the SDK MVP feature-complete:

- [x] No Draftroll account system is required.
- [x] No Draftsheet-specific adapter is required.
- [x] No npm publishing workflow is required.
- [x] No billing or hosted subscription system is required.

---

## 22. Definition of done for individual roadmap items

An item should only be changed to `[x]` when all applicable conditions are met:

1. Usable implementation exists in the repository.
2. Public types and API behavior are documented.
3. Deterministic unit or integration tests cover the core behavior.
4. Browser behavior has browser-level tests when the feature depends on DOM, WebGL, iframe, CSP, or WebSocket timing.
5. Permission-sensitive behavior is tested against unauthorized participants, not only successful paths.
6. Errors have stable, actionable behavior.
7. The implementation does not introduce application-specific assumptions into generic packages.
8. Local/offline behavior remains functional unless the feature is explicitly realtime-only.
