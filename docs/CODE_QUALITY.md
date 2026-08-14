# Code quality policy

Draftroll uses Oxlint for static analysis, Oxfmt for deterministic formatting, and TypeScript for authoritative type checking. All quality commands run from the repository root so workspace packages, root configuration, and type-aware project discovery remain consistent.

## Commands

```bash
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
pnpm test:quality-config
pnpm check
```

`pnpm check` is the required local and CI gate. It runs linting, formatting verification, configuration regression checks, TSDoc validation, package and Worker type checks, and the root TypeScript check.

## Oxlint policy

`.oxlintrc.json` enables the `correctness`, `suspicious`, and `perf` categories as errors. Warnings also fail the command, and unused disable directives are errors. High-value pedantic and type-aware rules are enabled individually so the gate stays strict without adopting an entire false-positive-prone category. Style rules remain off because Oxfmt is the single formatting authority. Native rules are enabled for TypeScript, imports, promises, Node.js, React, accessibility, Vue, Unicorn, and Oxc.

Type-aware linting is enabled through `oxlint-tsgolint`. It catches defects that syntax-only linting cannot establish, including floating promises, awaiting non-thenables, and promise misuse. The experimental Oxlint `typeCheck` option is intentionally not enabled: `tsc` remains the stable, authoritative compiler check.

Pedantic, restriction, and nursery categories are not enabled globally. Pedantic rules can be intentionally opinionated, restriction rules encode project-specific policy rather than universal correctness, and nursery rules are explicitly unstable. Adopt rules from these categories individually after reviewing their impact and adding a regression test.

### Deliberately disabled rules

`eslint/no-await-in-loop` is off. Draftroll's async loops are sequential by design, and `Promise.all()` would change behaviour rather than only improving throughput: D1 retry backoff and readiness polling depend on iteration order, theme asset loading enforces a cumulative byte budget that must be checked between fetches, clock synchronisation samples must not overlap, token verification breaks early on the first matching key, and renderer warmup mutates shared bridge state one theme at a time.

`eslint/no-underscore-dangle` allows `__draftrollTest` and `_defaultValue`. The first is the browser test harness's deliberate global bridge; the second belongs to a local React context stub used in a test double.

`promise/always-return` is off. Draftroll bridges promises to callback APIs (abort-signal races, overlay mount handshakes, socket reconnect state), where the `then` handler exists to settle an outer promise or perform a side effect. Returning a value from those handlers would be meaningless, and the floating-promise defects the rule is meant to approximate are already caught by `typescript/no-floating-promises`, which stays on as an error.

`typescript/consistent-return` is off because `tsc` already enforces the same property more precisely. The rule fires on `switch` statements that are exhaustive over a union and therefore need no trailing `return`; TypeScript rejects a genuinely missing return path with TS2366 ("Function lacks ending return statement"), so the compiler gate covers the real defect without flagging exhaustive dispatch in the parser, evaluator, and AST helpers.

Do not suppress a rule for an entire file when a narrower expression or line disable is sufficient. Every disable must include a concrete explanation, and obsolete disables fail validation.

## Oxfmt policy

`.oxfmtrc.json` is the single formatting source of truth. Oxfmt writes source files with `pnpm format` and checks them without modification through `pnpm format:check`.

Generated package output, Worker-generated bindings, benchmark output, browser reports, and lockfiles are excluded. Change source files, run the relevant generator, and commit generated artifacts separately when a release workflow requires them.

## Editor integration

The repository recommends the official Oxc VS Code extension. Workspace settings enable format-on-save, explicit Oxc fixes, root lint/format configuration, and type-aware linting. Editor diagnostics are convenient feedback; `pnpm check` remains the merge gate.

## Dependency updates

Oxlint, `oxlint-tsgolint`, and Oxfmt use exact versions because this source archive may be distributed without a lockfile. Update the three versions deliberately, inspect upstream release notes, run `pnpm install`, then execute `pnpm check` and `pnpm test:release` before committing the regenerated lockfile.
