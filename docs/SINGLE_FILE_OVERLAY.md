# Single-file overlay build

Draftroll keeps its normal package and Vite build architecture. For integrations that want a zero-dependency deployment artifact, the repository also includes `vite.overlay.single.config.ts`.

Build it with:

```bash
pnpm exec vite build --config vite.overlay.single.config.ts
```

The output is `dist-single-overlay/draftroll-overlay.html`. JavaScript, CSS, and normal Vite assets are inlined into that file. The runtime still uses the same normalized-result and overlay protocols; this is only a distribution target.

This is intended for copying into a host application, keeping an offline copy, static self-hosting, or embedding Draftroll where managing an asset directory is inconvenient. It does not replace the normal `build:overlay` output and does not change SDK package boundaries.
