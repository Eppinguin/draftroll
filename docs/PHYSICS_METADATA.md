# Physical metadata and room presets

Normalized dice may carry optional physical tuning:

```ts
interface DicePhysicsProperties {
  sizeScale?: number;
  massScale?: number;
  inertiaScale?: number;
}
```

Metadata is preserved through structured evaluation, exact external results, revisions, renderer bridging, and replay serialization.

## Merge order

The browser renderer combines physical settings in this order:

1. built-in room/runtime physics preset
2. theme-wide physics defaults
3. theme per-die-kind overrides
4. explicit normalized die metadata

Later layers override earlier layers. All values are validated and clamped to safe ranges; the host cannot provide arbitrary colliders or solver settings.

## Presets

Room renderer policy can select `standard`, `compact`, `heavy`, or `low-gravity`. A preset controls shared gravity and bounded mass/size/inertia/damping scales. Replays retain the preset and per-die values, so deterministic playback does not depend on the viewer's current defaults.

## Symbolic custom dice

A custom die face may define `renderAs` with a supported standard shell. Stable `faceIndex` maps repeated/symbolic faces to physical shell values while the normalized symbolic result remains authoritative. Arbitrary glyphs still require a validated theme label atlas; otherwise the renderer uses the token/card fallback.
