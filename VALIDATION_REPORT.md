# Draftroll validation report

Validated on 2026-08-01 with Node.js 22.16.0 and the repository's global TypeScript compiler.

## Passed

- strict package TypeScript check: `tsc -p tsconfig.packages.json --noEmit`
- strict Worker TypeScript check: `tsc -p apps/worker/tsconfig.json --noEmit`
- parser/evaluator instrumentation and validation diagnostics
- d20 compatibility, including bare maximum-face explosions (`2d4e`) and visible reroll-once semantics (`2d6ro<3`)
- causal staged reroll/explosion presentation, persistent prior physical/fallback visuals, destructive bridge-setter bypass for additive stages, deferred pointer-dismiss cancellation, non-spoiling pending result/log placeholders, trajectory-derived per-die settlement effects, stable-ID one-shot effect deduplication, repeated individual rerolls, iframe option forwarding, append-failure replacement fallback, concurrent-table grouping, realtime-latency handling, and final-total withholding
- common nonstandard dice helpers
- lifecycle-managed SDK session and generic React/Vue/Svelte contracts
- stable errors, cancellation, renderer controls, physical metadata, readiness policy, audit/bulk protocol
- abnormal disconnect/reconnect, replay truncation, durable recovery, duplicate suppression, request metrics, conflict and cancellation behavior
- Durable Object hibernation, atomic bulk commit ordering, persistent idempotency/recovery, D1 retry/failure diagnostics, origin/payload enforcement, secure deployment templates
- accessibility controls, reduced-motion/no-WebGL source coverage, mobile-emulation configuration, and generic example inventory
- completed-roll updates, renderer bridge, visual fallbacks, runtime themes, character-sheet client
- room protocol, runtime validation/fuzzing, hardening, passwords, and token security
- late-event synchronization and clock-offset behavior
- concurrent-table, natural-target, and large-pool deterministic physics checks
- renderer-performance budgets, browser-suite structure/transpilation, and package entry-point isolation
- repeatable SDK/theme-cache benchmark with verified upstream cache hits
- `git diff --check`

## Browser execution boundary

The Playwright tests, production fixture build configuration, and browser source transpilation checks are present. A live Playwright run was not possible in this source archive because `node_modules`, `@playwright/test`, Node type packages, Three.js, Cannon-es, and browser binaries are not installed. The root/browser type checks therefore fail only at dependency resolution; package and Worker source checks pass.

After installing workspace dependencies and browsers, run:

```bash
pnpm install
pnpm test:browser:install
pnpm test:all
```

## Deployment boundary

No real Cloudflare D1 IDs, domains, origins, tokens, or signing secrets are included. Use the gitignored deployment configuration and the documented migrate/deploy/smoke/health procedures before production use.

## TSDoc API documentation

- Added a repository `tsdoc.json` and parser-backed validation with `@microsoft/tsdoc` plus `@microsoft/tsdoc-config`.
- Added package documentation to every published declaration entry point.
- Added release-tagged TSDoc coverage for exported declarations and behavior-focused documentation for public class members.
- Added declaration-output tests to ensure published `.d.ts` files preserve package documentation and key editor hover text.
- `node scripts/check-tsdoc.mjs --structure-only` passes for 31 source files, 387 exported declarations, and 259 public class members.
- `node scripts/test-tsdoc-declarations.mjs` passes for all 13 published declaration entry points after package generation.
- A comment-stripped TypeScript emission comparison confirms that the source documentation changes do not alter runtime semantics.
- The reference-parser mode could not be executed in this environment because the configured package gateway does not provide the TSDoc packages; it is wired into `pnpm check` and `pnpm test:release` for a normal dependency installation.

## Code quality and Web Crypto compatibility

- Fixed TypeScript 5.8 Web Crypto compatibility by copying decoded signatures into an owned `ArrayBuffer` before calling `SubtleCrypto.verify`. This avoids passing `Uint8Array<ArrayBufferLike>` where the DOM API requires an `ArrayBuffer`-backed `BufferSource`.
- Added exact Oxlint, `oxlint-tsgolint`, and Oxfmt development dependencies.
- Added strict root linting with correctness, suspicious, and performance categories; selected high-value pedantic/type-aware rules; import-cycle checks; warnings-as-errors; unused-disable reporting; and deterministic formatting configuration.
- Added `pnpm lint`, `pnpm lint:fix`, `pnpm format`, `pnpm format:check`, `pnpm check:quality`, and `pnpm test:quality-config`.
- Integrated quality gates into `pnpm check` and `pnpm test:release`.
- Added editor configuration and `docs/CODE_QUALITY.md`.
- The Oxc binaries were unavailable in this isolated validation environment because its package gateway does not mirror them. Configuration structure, exact versions, command wiring, Web Crypto source contracts, TypeScript package/Worker checks, declaration generation, and existing deterministic regressions were validated directly. Run `pnpm install && pnpm check` against the public registry to execute Oxlint and Oxfmt themselves.
