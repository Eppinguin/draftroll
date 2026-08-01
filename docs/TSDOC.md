# TSDoc policy

Draftroll uses TSDoc for the published TypeScript API surface. The source comments are part of the package contract: TypeScript preserves them in generated declaration files so editors can show the same guidance that maintainers review in source.

## Scope

Document:

- Every package entry point with one `@packageDocumentation` comment before imports and exports.
- Every exported declaration with a useful summary and one release tag: `@public`, `@beta`, `@alpha`, or `@internal`.
- Public constructors, methods, and accessors when their behavior is not completely expressed by the type signature.
- Important invariants, ownership rules, cancellation behavior, mutation behavior, timing, and error conditions.

Do not add comments to private implementation details merely to satisfy a coverage number. Do not restate a property name or TypeScript type without adding behavioral information.

## Style

- Start with a concise summary sentence.
- Put extended behavioral context under `@remarks`.
- Use `@param` when the role, units, accepted range, or ownership of a parameter is not obvious.
- Use `@returns` when the returned value has lifecycle, ownership, nullability, or timing semantics that the type alone does not convey.
- Use one `@throws` block for each caller-actionable failure category.
- Use `@example` for primary workflows and non-obvious combinations. Examples must compile conceptually and avoid depending on unpublished internals.
- Use `{@link SymbolName}` for public API references instead of raw source paths.
- Use backticks for identifiers, package specifiers, expressions, and literal values.
- Keep release tags on exported declarations, not on `@packageDocumentation` comments or individual members of an already tagged class.
- Avoid unsupported JSDoc tags, HTML used only for layout, and redundant type annotations inside comments.

## Commands

```bash
pnpm check:docs
```

This loads `tsdoc.json` through `@microsoft/tsdoc-config`, parses every TSDoc comment with the reference `@microsoft/tsdoc` parser, and checks package-documentation placement plus public API coverage.

A parser-free structural pass is available for repository bootstrapping when the TSDoc packages have not been installed yet:

```bash
pnpm check:docs:structure
```

The structural mode still requires TypeScript, and it does not replace the normal parser-backed check in CI or release validation.
