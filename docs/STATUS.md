# Draftroll status

## SDK completion assessment

All repository-level SDK milestones in `plan.md` are implemented: rules and diagnostics, normalized results, structured/custom dice, framework bindings, lifecycle sessions, renderer/fallback controls, runtime themes, realtime recovery/privacy, transactional revisions, Worker hardening, generic examples, browser/security suites, benchmarks, and deployment operations.

Package versions remain `0.1.0`; realtime protocol version remains 2. The repository is self-hostable and intentionally does not include Draftroll accounts, billing, npm publishing, real Cloudflare resource IDs, production secrets, or a Draftroll-operated hosted theme catalog.

## Completion additions

- shared stable error classes/codes and `AbortSignal` cancellation across core, renderer, overlay, realtime, and SDK operations
- `DraftrollSession` plus generic React, Vue, and Svelte bindings
- framework-free, React, headless, VTT, bot, stream-overlay, hidden-roll, cross-origin/CSP, and symbolic-dice examples
- audit labels/reasons, conflict retry/merge strategies, transactional bulk updates, and participant/role whisper helpers
- typed renderer lifecycle events, manual pause/resume, persistence/auto-clear, screenshot, camera, preview, interactions, dragging, participant filtering, and room physics presets
- symbolic custom faces mapped to supported physical shells and mixed physical/fallback additions to active tables
- per-die/theme size, mass, and inertia metadata preserved through evaluation, revisions, rooms, replay, and rendering
- accessible text renderer, ARIA result announcements, keyboard-inert overlay, Escape dismissal, reduced-motion/no-WebGL fallback, responsive viewport tuning, and mobile emulation
- persistent D1 room events and request idempotency for long-range replay and retry safety
- request latency/failure/conflict/reconnect/replay/hidden-projection metrics and manager-only room diagnostics
- readiness-gated synchronized starts and renderer presentation defaults separated from authorization policy
- secure staging/production Wrangler templates, migration/deploy scripts, smoke tests, health probes, monitoring/alert guidance, entropy policy, incident response, and rollback documentation
- repeatable SDK/theme-cache, synchronization/reconnect, renderer frame/heap, mixed-pool, and 30-dice benchmark tooling
- parser-validated TSDoc coverage for public package entry points and exported APIs, with declaration-emission regression checks

## Validation boundary

The remaining unchecked plan entries are external execution gates rather than missing code:

- supply real staging/production D1 IDs, domains, origins, and secrets
- deploy to the operator's Cloudflare account and run the provided smoke probes
- install Playwright browsers/dependencies and record the complete browser matrix
- record controlled desktop/mobile hardware baselines and slow-motion visual acceptance

## Deliberately excluded

- Draftroll accounts, login, API keys, billing, and account-linked ownership
- Draftsheet-specific adapters or product-specific example assumptions
- arbitrary untrusted custom shaders
- npm/public publishing and release automation
- a mandatory Draftroll-managed R2 theme catalog
