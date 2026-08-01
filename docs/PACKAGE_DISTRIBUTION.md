# Package distribution

Draftroll packages are published from generated ESM and declaration files in each package's `dist/` directory. Package exports never point at TypeScript source or at another package's source tree.

## Build

```bash
pnpm build:packages
```

The release compiler emits JavaScript, source maps, declarations, and declaration maps for all workspace packages. The build then rewrites cross-package runtime imports to public `@draftroll/*` specifiers and adds ESM-safe `.js` extensions to internal relative imports.

Source package manifests use `workspace:*` for every internal `@draftroll/*` dependency. This guarantees that local `pnpm install` operations link the monorepo packages instead of querying npm before Draftroll is published. Every package has a `prepack` hook, so packing from the monorepo regenerates all release artifacts before the tarball is created.

For release validation, `pnpm test:distribution` copies packages to an isolated staging directory and replaces `workspace:*` with the matching package version only in that temporary copy. The checked-in manifests are never rewritten. A future registry release should use pnpm's workspace-aware pack/publish flow, which performs the equivalent manifest transformation.

## Validate packed packages

```bash
pnpm test:distribution
```

This test:

1. verifies that checked-in internal dependencies use `workspace:*`;
2. creates release-only package copies with concrete internal versions;
3. packs every public package into a tarball;
4. installs those tarballs into a clean temporary npm project in offline mode and without lifecycle scripts;
5. imports every package through Node's package resolver, including server and framework bindings;
6. executes a headless roll and verifies browser-only renderer exports;
7. checks that root SDK types match the headless default runtime while the browser condition selects the browser entry.

Run the complete release gate with:

```bash
pnpm test:release
```

Public registry publication, signing, provenance, and release-channel management remain deployment decisions rather than requirements for local SDK use.
