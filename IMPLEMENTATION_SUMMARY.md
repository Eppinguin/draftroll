# Draftroll implementation summary

Draftroll currently provides:

- local/offline TypeScript dice evaluation
- documented d20 syntax and operations, including sets, selectors, visible reroll variants, bare maximum-face explosions (`2d4e`), recursive staged explosion waves, annotations/comments, comparisons, advantage, and critical results
- exact and legacy dialects for comparison/success-count semantics
- AST and evaluated result trees
- execution limits, secure/seeded RNG, parser caching, reusable compiled formulas, and opt-in parser/evaluator profiling
- expression validation with stable codes, original-source ranges, repair suggestions, formatting, and custom stringifiers
- arbitrary numeric, Fate, weighted, repeated-face, and symbolic custom dice, including common coin, Fate, atomic percentile-pair, symbol-pool, and weighted card/table factories, full notation-free keep/drop/reroll/explode/min/max/success operations, and portable room definitions
- structured and exact external-result APIs with typed dice, selector, and operation factories
- schema-versioned normalized JSON results with legacy migration and strict runtime decoding
- strict room command/event schemas, payload and metadata limits, structured validation issues, and protocol-version negotiation
- per-die themes
- transparent website overlay and result display
- individual rerolls
- whole-roll revisions with log-only or animated presentation
- local and D1-backed revision history
- synchronized rooms through Cloudflare Workers, Durable Objects, WebSockets, and D1
- protocol v2 participant sessions, correlated requests, reconnect catch-up, idempotency, and presence events
- clock-offset measurement, adaptive room start buffers, deterministic late-event replay seeking, automatic settled-result presentation, and newest-only reconnect animation
- server-enforced roll visibility with permission-projected WebSocket, history, and revision responses
- stable realtime roll handles with reveal, reroll, correction, formula updates, and optimistic revision conflicts
- a stable top-level `DraftrollSession` that preserves one engine, subscriptions, and unified roll handles while switching local/realtime execution and renderer on/off
- optional signed, room-scoped capability tokens without Draftroll user accounts
- optional server-enforced room passwords using salted PBKDF2 verifiers, withheld pre-authentication room state, rate-limited attempts, and SDK transport helpers
- issuer/audience-bound token claims, key-ID verification rings, URL-free browser token transport, detailed verification errors, permission-escalation/malformed-token tests, exact-token and participant-cutoff revocation, and active-session disconnects
- pnpm and `wrangler.jsonc` local development workflows
- versioned room policies and generic policy presets
- policy-enforced authorization, result/resource caps, rate limits, stale-session cleanup, idle expiry, retention, origin restrictions, and emergency shutdown
- bounded D1 persistence retry/backoff, retention cleanup, and durable failure diagnostics
- Playwright automation with production-built host/overlay fixtures, explicit cross-origin and CSP policies, desktop/mobile projects, WebGL lifecycle coverage, permission projection tests, reconnect replay tests, serialized-presentation coverage, and 30-dice diagnostics
- renderer power management with idle-zero scheduling, low-power transparent overlay initialization, no overlay bloom composer, bounded presentation queuing, lazy physics workers, count-aware frame/DPR caps, adaptive resolution, visibility-aware settlement, and auto/battery/quality profiles
- viewport-safe rendering with shared CSS/camera aspect measurement, active antialiasing, inexpensive small-pool shadows, and geometry-aware edge containment
- exact-result physical presentation with fixed face labels, complete-trajectory shape-symmetry targeting, no post-settlement correction, final face verification, viewport-local planning, and targeting diagnostics
- committed large-pool trajectories with hidden provisional layouts, staged 12–30 die pours, 120 Hz physics recording, bounded memory, and browser continuity guards
- collision-safe convex bodies with small visual-profile collider skins and stronger dense-contact solving to reduce apparent model overlap
- persistent additive table physics where later room rolls can enter an already-moving physical world and interact with existing dice
- explicit pnpm build approvals for both `esbuild` and `workerd`
- conditional browser/headless SDK entry points plus TypeScript-AST import-graph regression tests that keep WebGL and physics-renderer code out of server-safe package graphs
- generated ESM/declaration builds, workspace-local dependency linking, and offline staged-tarball smoke tests for every public package
- TSDoc package documentation, explicit release tags, public class/member guidance, parser-backed checks, and declaration-preservation tests
- strict Oxlint syntax/type-aware analysis, deterministic Oxfmt formatting, editor integration, and configuration regression checks

- stable shared errors and AbortSignal cancellation across public packages
- generic React, Vue, and Svelte bindings plus production-oriented generic examples
- audit fields, conflict strategies, transactional bulk updates, and whisper helpers
- complete typed renderer lifecycle and optional controls including screenshot, camera, preview, pause/resume, interactions, dragging, filtering, and room physics presets
- per-die physical metadata and symbolic custom-face physical-shell rendering
- persistent long-range event recovery/idempotency, request metrics, readiness policy, and manager diagnostics
- accessibility/reduced-motion/no-WebGL coverage, HTTP/D1 privacy-boundary tests, reconnect chaos tests, and Worker resilience contracts
- staging/production deployment templates, smoke/health probes, monitoring/alerts, incident/rollback procedures, and repeatable benchmark reports

The MVP intentionally has no accounts, login, API keys, billing, or account-linked room ownership. Public package artifacts are build- and install-tested locally; registry publication, signing, provenance, and release-channel operation remain deployment-owner decisions.

All repository-level feature work is complete. Remaining gates require deployment-owner resources or controlled execution environments: real Cloudflare IDs/domains/secrets, staging/production smoke execution, installed Playwright browser binaries, and recorded desktop/mobile hardware baselines. Package versions remain `0.1.0`, protocol version remains 2, and the source snapshot itself is not a deployed service.


Mixed built-in die types (d4/d6/d8/d10/d12/d20) now share one physical worker plan, playback, and replay. Evaluator-generated rerolls and explosions retain their discarded/triggering dice, record immediate causal ancestry, and append follow-up dice only after the prior wave settles; the complete total appears only after the last wave. Individual SDK rerolls use the same persistent-table model: the original die and prior replacements remain visible as discarded history, the newest replacement is appended, and repeated revisions remain one logical table group. Additive stages bypass legacy bridge setters that rebuild the scene, and result-panel rerolls synchronously cancel deferred click dismissal before asynchronous overlay setup, so settled dice are not cleared immediately before the replacement throw. The iframe overlay forwards the complete persistence contract. A cleared, auto-cleared, raced, or capacity-limited table safely falls back to a complete revised presentation and resets presentation history to what is actually visible. Physical and fallback-only modifier chains follow the same rule. Built-in pending result panels and the test-client dice log show one neutral placeholder rather than one row per already-known future die, preventing explosion/reroll counts from being disclosed before the sequence settles. The root Vite host is now a basic character sheet with named server formulas, room controls, persisted dice history, and reroll/revision actions.

## Concurrent multi-roller table presentation

Room sessions batch nearby synchronized starts and can inject a later physical roll into an already-moving table. Separate roller groups launch from distinct hand lanes and interact in one collision world, while the SDK resolves each logical roll independently. Exact authoritative faces are reached by applying a proper collider symmetry across each complete prerecorded trajectory. This selects a valid starting orientation without face-label remapping, late torque, or a second movement phase.

## Exact-result and persistent-table playground controls

The test host can evaluate a formula against a developer-supplied sequence of die values, submit the exact result locally or through the room server, and stage a second named roller after a configurable delay. Concurrent physical mode now accepts compatible additions while dice are moving or recently settled. Overlay pointer dismissal supports a host selector for roll controls so asynchronous room requests do not clear the table before the authoritative event arrives.

## One-shot per-die settlement effects

- Outcome effects now fire when each die first reaches the recorded pose it keeps through the end of its trajectory.
- A stable visual-ID registry prevents retained dice from replaying effects during explosions, rerolls, revisions, or concurrent table additions.
- Late-event seeks consume already-passed settlement effects without replaying them.
- Replay data records per-die settlement times and aligns deterministic result-effect events to those timestamps.
