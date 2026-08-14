# Runtime themes

Draftroll runtime themes are constrained, versioned manifests. They can change materials, textures, labels, optional fonts, sounds, effect presets, previews, and validated visual meshes without allowing arbitrary untrusted JavaScript or shaders.

## Minimal theme

```ts
import { BundledThemeProvider, DRAFTROLL_THEME_SCHEMA_VERSION, Draftroll } from '@draftroll/sdk';

const themes = new BundledThemeProvider([
  {
    schemaVersion: DRAFTROLL_THEME_SCHEMA_VERSION,
    id: 'obsidian',
    name: 'Obsidian',
    version: '1.0.0',
    availableDice: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'],
    previews: {
      d20: '/themes/obsidian/preview-d20.webp',
    },
    material: {
      color: '#17131f',
      emissive: '#3d1859',
      emissiveIntensity: 0.3,
      roughness: 0.38,
      metalness: 0.4,
      clearcoat: 0.45,
    },
    labels: {
      color: '#f8eaff',
      glowColor: '#c468ff',
    },
    effects: {
      positive: 'major-burst',
      neutral: 'subtle-pulse',
      negative: 'void-fracture',
    },
  },
]);

const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: '/draftroll/overlay.html',
    themeProvider: themes,
  },
  warmupThemes: ['obsidian'],
});
```

## Asset-backed theme

Assets are referenced by manifest paths and supplied by a `ThemeProvider`.

```ts
const provider = new BundledThemeProvider(
  [
    {
      schemaVersion: DRAFTROLL_THEME_SCHEMA_VERSION,
      id: 'marble',
      name: 'Marble',
      version: '2.1.0',
      material: {
        surfaceTexture: {
          src: 'marble/surface.webp',
          mimeType: 'image/webp',
        },
        normalTexture: {
          src: 'marble/normal.webp',
          mimeType: 'image/webp',
        },
      },
      labels: {
        atlas: {
          src: 'marble/labels.png',
          mimeType: 'image/png',
        },
        fontFamily: 'Marble Serif',
        font: {
          src: 'marble/font.woff2',
          mimeType: 'font/woff2',
        },
      },
      audio: {
        impact: {
          src: 'marble/impact.ogg',
          mimeType: 'audio/ogg',
        },
        roll: {
          src: 'marble/roll.ogg',
          mimeType: 'audio/ogg',
        },
        volume: 0.75,
        playbackRate: [0.96, 1.04],
      },
    },
  ],
  [
    ['marble/surface.webp', surfaceBlob],
    ['marble/normal.webp', normalBlob],
    ['marble/labels.png', labelsBlob],
    ['marble/font.woff2', fontBlob],
    ['marble/impact.ogg', impactBlob],
    ['marble/roll.ogg', rollBlob],
  ],
);
```

`HttpThemeProvider` expects manifests at `themes/<id>.json`, an optional theme index at `themes/index.json`, and assets relative to its base URL.

## Label atlas

A label atlas is a 5-column by 4-row image containing values 1 through 20 in row-major order. A shared `labels.atlas` can be overridden per die using `labels.atlases.d6`, `labels.atlases.d20`, and similar keys.

## Custom visual meshes

A theme can provide visual GLB or glTF meshes for d4, d6, d8, d10, d12, and d20. Draftroll validates that a mesh:

- contains buffer geometry;
- has a bounded vertex count;
- has finite, nonzero bounds;
- can be normalized to the renderer scale.

The standard collider remains authoritative. Invalid or missing meshes fall back to Draftroll's standard visual geometry instead of failing the roll.

## Loading controls

Both direct and overlay renderers support preloading and cancellation:

```ts
const controller = new AbortController();

await renderer.loadTheme('obsidian', controller.signal);
```

Use `onThemeLoad` to receive manifest, asset-start, asset-complete, complete, and error events. Defaults limit individual assets to 8 MiB and all assets in one theme to 24 MiB. These limits are configurable.

## Safety model

Runtime themes do not execute theme-provided code. The current schema supports constrained material fields and a fixed effect-preset list. Arbitrary custom shaders remain deferred. Failed optional resources use generated materials, standard labels, synthesized sounds, or standard meshes.

## Integrity and limits

Asset references may include a standard `sha256-...` Subresource Integrity value. Draftroll verifies it before the asset is installed. A theme can reference at most 128 assets. Default byte limits are 8 MiB per asset and 24 MiB per theme.

JSON glTF files must be self-contained and may only reference embedded data URIs. GLB is recommended. External glTF buffer or image URLs are rejected so every resource remains under the selected `ThemeProvider` and its limits.
