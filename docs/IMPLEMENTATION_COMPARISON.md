# Original task versus current Draftroll implementation

This report compares the original realtime/offline 3D dice SDK specification with the completed repository implementation.

Status meanings:

- **Implemented**: usable code, documentation, and deterministic verification exist in the repository.
- **Implemented with external gate**: source implementation is complete, but deployment credentials, installed browser binaries, or controlled hardware are required for final environment-specific acceptance.
- **Conditional/deferred**: intentionally outside the product-owned SDK boundary or only required for a hosted-service operating model.

## Executive assessment

Draftroll is a local-first dice/rules SDK, renderer, website overlay, result display, framework integration layer, and anonymous realtime-room system. The expression engine covers the documented `d20` syntax and behavior, including decimals, percentile dice, sets, selectors, keep/drop, rerolls, reroll-and-add, explosions, minimum/maximum, integer division, comparisons, annotations, comments, advantage/disadvantage, critical classification, execution limits, parsed/evaluated trees, caching, compilation, validation diagnostics, and optional profiling.

Project-specific extensions include Fate dice, arbitrary numeric dice, explicit success counting, structured inputs, exact external results, weighted/symbolic dice, common nonstandard-dice factories, normalized JSON results, per-die themes and physics metadata, individual rerolls, completed-roll revisions, transactional bulk updates, and log-only versus animated updates.

Connected rooms use ephemeral participant/session identity and optional signed room capabilities. This is room-scoped authorization rather than an account system. Durable recovery, late-event seeking, hidden-result projection, persistent revisions/events/idempotency, readiness gates, renderer policy, request diagnostics, and operational tooling are implemented.

All repository-owned roadmap work is complete. Remaining gates require operator-owned Cloudflare resources and secrets, a real staging/production deployment, installed Playwright browsers, or controlled target hardware.

## Core product modes

| Original requirement | Status | Current implementation | Remaining external or host-owned work |
| --- | --- | --- | --- |
| Local/offline rolling without backend dependency | Implemented | `@draftroll/core` evaluates locally with injected secure or seeded RNG. Renderer and overlay can run from locally hosted assets. Offline packaging and browser structure are covered by automation. | Execute the full browser suite in an environment with installed Playwright dependencies. |
| Connected synchronized rooms | Implemented with external gate | WebSocket client, clock synchronization, one Durable Object per room, scheduled starts, authoritative evaluation, participant-specific projection, reconnect replay, persistent D1 history/revisions/events/idempotency, policy limits, rate limits, readiness gates, expiry, retention, and revision conflicts. | Deploy against real Cloudflare resources and run staging/production smoke and multi-device acceptance. |
| External exact-result display | Implemented | Exact external values are strictly decoded, normalized without rerolling, and can be displayed locally or broadcast in a room. | None. |
| Backend optional | Implemented | Local SDK packages do not require Worker, Durable Objects, D1, accounts, API keys, or network access. Browser and headless entry points enforce the boundary. | None. |
| Accounts/API keys | Conditional/deferred | No Draftroll account system is required. Ephemeral participants and signed room-scoped capabilities support ownership, roles, permissions, hidden-result access, issuer/audience binding, key rotation, and revocation. | A hosted operator supplies issuance policy, secret storage, and environment-specific key rotation. |

## Dice language and rules engine

| Requirement | Status | Current implementation | Notes |
| --- | --- | --- | --- |
| TypeScript-native parser and evaluator | Implemented | Hand-written TypeScript parser, AST, evaluator, limits, RNG abstraction, normalized results, stable errors, cancellation, and diagnostics. | No Python runtime dependency. |
| Basic numeric dice and arbitrary dN | Implemented | `d20`, `4d6`, `d1`, `0d6`, `d3`, `d1000`, and similar. | Unsupported physical shapes use deterministic fallbacks. |
| Fate/Fudge dice | Implemented | `dF`, `4dF`, a common-dice helper, and synchronized Fate visual fallback. | Dedicated custom rigid bodies remain optional renderer expansion. |
| Arithmetic and parentheses | Implemented | `+ - * / // %`, unary `+/-`, and grouping. | Exact decimals are retained in `total`; `integerTotal` is truncation-compatible. |
| Keep/drop | Implemented | d20 `k`/`p` selectors, `kh`/`kl`, `ph`/`pl`; `dh`/`dl` aliases retained. | Works on dice and expression sets. |
| Reroll | Implemented | `rr` until clear, `ro` once, and legacy `r`. | Execution-limited and cancellation-aware. |
| Reroll and add | Implemented | `ra` keeps the original and adds one reroll. | Matches documented d20 behavior. |
| Exploding dice | Implemented | `e` with literal/range selectors and recursive explosions. | Execution-limited and profiled when instrumentation is enabled. |
| Minimum and maximum | Implemented | `mi`, `ma`. | Applies numeric floor/ceiling to dice. |
| Selectors | Implemented | Literal, highest, lowest, `>`, `<`; extensions `>=`, `<=`, `!=`. | Available in expression and structured APIs. |
| Sets | Implemented | Empty, singleton, and multi-value sets with operations. | Evaluated trees preserve child values. |
| Comparisons | Implemented | `==`, `=`, `!=`, `<`, `<=`, `>`, `>=`, returning `0` or `1`. | Exact d20 dialect is the default. |
| Success counting | Implemented extension | `cs`/`count`; prior shorthand remains available through `dialect: "draftroll"`. | Avoids ambiguity with d20 binary comparisons. |
| Percentile dice | Implemented | `d%` maps to d100; `commonDice.percentilePair()` preserves tens/ones metadata atomically. | Visual fallback is provided where no dedicated rigid body exists. |
| Inline annotations and comments | Implemented | Per-node annotations and optional trailing comments. | Annotations propagate to normalized dice. |
| Advantage/disadvantage | Implemented | Expression-roll options rewrite the leftmost `1d20`; structured callers can use two d20s plus keep-highest/lowest. | Critical classification remains deterministic. |
| Critical classification | Implemented | `none`, `critical-success`, `critical-failure` for qualifying leftmost d20 pools. | Game-specific critical rules remain host-owned. |
| Parser caching and compiled expressions | Implemented | Configurable cache plus `draftroll.compile()` and `engine.compile()`. | Comment-enabled expressions bypass cache. |
| Validation diagnostics | Implemented | Stable codes, source-relative offsets, one-based line/column ranges, repair suggestions, and preserved legacy error fields/classes. | Multi-error recovery is an optional future parser enhancement, not an MVP gap. |
| Parser/evaluator profiling | Implemented | Opt-in profiles report cache status, AST complexity, evaluator work, generated dice, rerolls, explosions, duration, and failures. | Observers, clocks, and metric computation are isolated from roll behavior. |
| Tree traversal/stringification | Implemented | Parsed AST, evaluated JSON tree, DFS helpers, default formatter, and custom stringification. | Enables game-specific UI and auditing. |
| Weighted/symbolic custom dice | Implemented | Portable definitions support weighted/repeated faces, symbols, numeric contributions, face identity/metadata, structured operations, synchronized rendering, and common coin/Fate/percentile/symbol/card/table factories. | Stateful depletion, shuffling, and draws without replacement remain application-owned. |

## Normalized result boundary

| Requirement | Status | Current implementation | Remaining external or host-owned work |
| --- | --- | --- | --- |
| JSON-serializable normalized result | Implemented | Authority, formula, exact/integer totals, dice, operations, annotations, comments, critical state, tree, metadata, timestamps, schema version, strict decoder, and legacy migration. | None. |
| Renderer does not parse expressions | Implemented | Renderer consumes normalized results and explicit physical metadata only. | None. |
| Preserve per-die results and kept state | Implemented | Includes generated source, source index, theme/appearance, custom face data, physical metadata, and deterministic replay inputs. | None. |
| Replay/history/audit data | Implemented | Stable roll IDs, revisions, local immutable snapshots, D1 current rows/revision snapshots, persistent event recovery, idempotency, audit/conflict metadata, caps, retention, and cleanup. | Optional external archival/analytics export is operator-owned. |
| Whole-roll edits | Implemented | Formula, die values, dice set, themes, annotations/comments, metadata, totals, selected/all rerolls, and transactional bulk updates. | Visual editors remain host-owned. |
| Log-only or animated edit | Implemented | Explicit modes and convenience APIs. | None. |

## Developer API

| Requirement/goal | Status | Current implementation | Remaining external or host-owned work |
| --- | --- | --- | --- |
| Simple expression roll | Implemented | `draftroll.roll("...")` and object form. | None. |
| Validation without exception control flow | Implemented | `validate()` returns stable diagnostics and preserved compatibility fields; `tryRoll()` remains available for execution. | None for the documented API. |
| Reusable formulas | Implemented | `draftroll.compile()` and `engine.compile()`. | None. |
| Structured API without notation | Implemented | `rollDice()` and `evaluate()` support selectors, rerolls, explosions, bounds, success counts, custom dice, source IDs, and common helper factories. | Game-specific adapters remain host-owned. |
| Stable roll handle | Implemented | `id`, `total`, `dice`, `wait`, reroll/update helpers, room/local history, and lifecycle-safe access. | None. |
| Stable lifecycle session | Implemented | One `DraftrollSession` preserves subscriptions, engine state, history, and SDK identity while transitioning local/realtime and attaching/detaching renderers. | None. |
| Errors and cancellation | Implemented | Shared typed error semantics and `AbortSignal` propagation cover core, client, renderer, overlay, and SDK operations. | None. |
| Event hooks | Implemented | Core/local events, room events, lifecycle state, presence, diagnostics, renderer lifecycle, and framework bindings for React, Vue, and Svelte. | Framework-specific product UI remains consumer-owned. |
| Per-die themes and physics | Implemented | Built-in/runtime themes, arrays/maps/resolvers, validated assets, safe meshes, effects, previews, labels, sounds, and per-die physical metadata. | Arbitrary executable shaders are intentionally excluded. |
| Individual and bulk revisions | Implemented | Selected-die rerolls, whole-roll revisions, optimistic conflicts, retry helpers, and atomic room bulk updates. | Generated modifier dice remain tied to their source/formula. |
| Website overlay | Implemented with external gate | Transparent SDK-owned iframe, host Shadow-DOM result panel, isolated CSS/WebGL, accessibility controls, reduced-motion/no-WebGL text fallback, and completion interactions. | Execute full cross-origin/CSP browser tests with installed browsers. |
| Anonymous room API | Implemented with external gate | Signed/unsigned modes, permissions, stable handles, visibility/reveal, policy management, token revocation, request diagnostics, readiness, renderer policy, and lifecycle controls. | Hosted deployment, secrets, external alert routing, and optional edge-wide multi-room limits. |
| Generic integration examples | Implemented | Plain browser/TypeScript examples plus React, Vue, and Svelte adapter examples and executable source checks. | Consumer-specific app integrations are outside the repository scope. |

## Realtime identity, privacy, and recovery

| Requirement/goal | Status | Current implementation | Remaining external or host-owned work |
| --- | --- | --- | --- |
| No account dependency | Implemented | Participant/session identities are ephemeral and supplied or generated by the embedding app. | None. |
| Server-enforced hidden rolls | Implemented | Complete results remain authoritative while unauthorized WebSocket, HTTP, history, revision, event, and persistence projections omit roller-only values. | Run the supplied live browser/deployment suite in target environments. |
| Flexible visibility | Implemented | Public, roller, role, participant, and combined participant/role visibility constrained by room policy. | None. |
| Reveal/update hidden result | Implemented | Visibility changes preserve `rollId`, increment revisions, and project the current result only to newly authorized clients. | None. |
| Request correlation and metrics | Implemented | Mutations resolve from authoritative events; initiating-session correlation is preserved; request latency/failure diagnostics are exposed without leaking payloads. | External metrics collection/alerts are operator-owned. |
| Revision conflicts and retries | Implemented | `expectedRevision`, typed conflicts, high-level current-revision defaults, retry helpers, and audit metadata. | Domain-specific merge policy remains host-owned. |
| Presence | Implemented | Ready state, join/update/leave, participant snapshots, last-seen refresh, policy-driven timeout, alarm cleanup, and hibernation restoration. | Controlled browser/network acceptance remains external. |
| Reconnect recovery | Implemented | Monotonic sequences, bounded in-memory replay, persistent D1 events, cursor recovery, truncation diagnostics, late-event replay/seek/settled modes, and recovery metrics. | External load/multi-region acceptance is operator-owned. |
| Idempotent requests | Implemented | Recent in-memory and persistent request records return the original authorized projection; bounded cleanup is applied. | Retention tuning is deployment policy. |
| Transactional bulk updates | Implemented | Entire batches are validated before atomic multi-key commit, then emit per-roll events and an idempotent batch acknowledgement. | None for the repository contract. |

## Renderer and themes

| Original requirement | Status | Current implementation | Remaining external or host-owned work |
| --- | --- | --- | --- |
| Three.js renderer separated from rules/networking | Implemented | Browser renderer/overlay consume normalized results; headless/server entry points have no emitted WebGL dependency path. | None. |
| Deterministic authoritative landing | Implemented | Supported polyhedra use worker-planned Cannon trajectories; unsupported/custom components use deterministic seeded fallbacks. | Perceptual quality acceptance on controlled hardware is external. |
| Per-die built-in and runtime themes | Implemented | Mixed built-in IDs, runtime manifests, cached/composite providers, material assets, labels, fonts, sounds, effects, previews, and safe visual meshes. | Hosted asset inventory/retention is operator-owned. |
| Mixed die types in one visual roll | Implemented | Physical d4/d6/d8/d10/d12/d20 dice and coin/percentile/Fate/spinner/token/card fallbacks coexist in one synchronized table, including additions to active scenes. | Dedicated custom rigid bodies are optional. |
| Custom symbolic physical presentation | Implemented | Symbolic faces can map to supported physical shells while preserving authoritative face metadata; unsupported shapes retain deterministic fallback visuals. | Fully arbitrary geometry/face-paint authoring is optional. |
| Renderer lifecycle and controls | Implemented | Typed lifecycle events, pause/resume, persistence, screenshots, camera controls, preview, participant filtering, reduced-motion/fallback controls, and settled-die drag/move interactions. | Browser/device acceptance is external. |
| Late animation catch-up | Implemented | Client computes elapsed time; renderer supports deterministic seek, replay, and settled presentation for late/recovered events. | Multi-device latency validation is external. |
| Accessibility | Implemented with external gate | Keyboard-accessible controls, semantic/text result fallback, reduced motion, no-WebGL fallback, mobile emulation tests, and browser accessibility specs. | Run the full Playwright matrix and retain controlled-device reports. |

## Cloudflare backend

| Original requirement | Status | Current implementation | Remaining external or host-owned work |
| --- | --- | --- | --- |
| Worker routing | Implemented with external gate | Health, diagnostics, policy/state/history/revisions/events, WebSocket upgrade, origin enforcement, protocol negotiation, schemas, payload limits, and smoke/health scripts. | Deploy and run smoke checks with real routes/resources. |
| One Durable Object per room | Implemented | Room-named object, hibernation-safe attachments/restoration, projections, replay/deduplication, persistent rate counters, stale cleanup, expiry, and shutdown. | Operational dashboard/alert integration is deployment-owned. |
| Server-authoritative RNG/evaluation | Implemented | The same TypeScript core runs in the Durable Object with documented entropy policy and failure semantics. | External compliance/audit controls are operator-owned. |
| Scheduled synchronized start | Implemented | Future server start, clock diagnostics, adaptive room buffers, deterministic replay seeking, and settled late-event presentation. | Controlled multi-device latency acceptance. |
| D1 outside hot path | Implemented with external gate | Broadcast precedes persistence; writes use retry/backoff, atomic batches, retention/count/orphan cleanup, persistent recovery/idempotency, capped failure records, and structured diagnostics. | Create real D1 databases, run migrations, and connect external alerting. |
| Hosted theme assets/R2 | Conditional/deferred | Generic validated HTTP, cached, composite, bundled, and custom providers are implemented without coupling the SDK to R2. | An operator may use R2 or another CDN through the generic provider contract. |
| Accounts/authentication | Conditional/deferred | HMAC-signed room tokens support roles/permissions, issuer/audience, key IDs, verification rings, revocation, and participant cutoffs; unsigned local mode remains available. | Hosted issuance policy, secrets, and rotation operations. |
| Deployment and rollback | Implemented with external gate | Environment templates, migrations, smoke/health commands, monitoring, incident-response, rollback, and validation documentation are included. | Populate real resource IDs/routes/secrets and execute staging/production procedures. |

## Validation performed

- strict package and Worker TypeScript checks
- deterministic d20 compatibility, common-dice, validation-diagnostic, profiling, lifecycle, cancellation/error, update, theme, client, protocol, schema, hardening, password, token, and framework-binding suites
- hidden-result projection, persistent replay/idempotency, Durable Object hibernation restoration, D1 retry/failure, atomic bulk-commit, readiness, and recovery diagnostics suites
- deterministic late-event, concurrent-table, natural-target, large-pool, mixed physical/fallback, accessibility-control, and renderer-performance suites
- browser-spec structure/transpile checks for offline, cross-origin/CSP, privacy, reconnect, accessibility, mobile, and performance scenarios
- package entry-point dependency-graph isolation checks
- repeatable SDK/parser/evaluator/update/theme-cache benchmark producing machine-readable percentile reports
- generic example source validation

The full Playwright launch, real Cloudflare deployment smoke test, and controlled hardware baselines remain external execution gates because the supplied repository archive does not include browser binaries, installed runtime dependencies, Cloudflare resource IDs, production secrets, or target devices.

## Completion boundary

Repository implementation is complete. The remaining acceptance sequence is operational:

1. Populate gitignored staging/production Cloudflare configuration with real D1 IDs, routes, and secrets.
2. Apply migrations, deploy, and run the supplied health/smoke suite.
3. Install dependencies and Playwright browsers, then record a clean full browser/cross-origin run.
4. Retain controlled desktop/mobile latency, memory, reduced-motion, fallback, and perceptual-physics baseline reports.

Package publishing and account systems remain intentionally outside the current product scope.
