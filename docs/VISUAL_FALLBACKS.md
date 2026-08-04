# Visual fallback system

Draftroll evaluates more result types than can be represented by the built-in physical dice. The renderer therefore plans each normalized die independently as either:

1. a Cannon/Three.js physical die, or
2. a synchronized visual fallback.

A roll may contain both categories. Unsupported shapes never cause the supported physical dice or the complete presentation to fail.

## Current mapping

| Normalized result            | Visual representation                  |
| ---------------------------- | -------------------------------------- |
| d2                           | Physical coin and Cannon trajectory    |
| d4, d6, d8, d10, d12, d20    | Physical mesh and Cannon trajectory    |
| Custom `coin`                | Coin fallback                          |
| `d10x`, `d%`, d100           | Distinct percentile token              |
| `dF` or `fate`               | Fate token showing `+`, `0`, or `−`    |
| Arbitrary numeric dN         | Spinner token showing the rolled value |
| Very large dN                | Spinner token                          |
| Symbolic custom face         | Card by default                        |
| Weighted/custom table result | Token or card                          |
| Unknown result type          | Generic result token                   |

The fallback layer is a presentation contract, not a rules-engine substitution. The normalized result remains authoritative.

## Mixed rolls

```ts
const result = draftroll.roll('1d20 + 1d2 + 1dF + 1d9 + 1d100');
await result.wait();
```

The d20 and d2 share the physical Cannon trajectory and collide with each other. The remaining components animate into the same Three.js scene as fallback visuals, preserve normalized die order, and settle before the common result reveal.

Fallback-only rolls are also supported.

## Custom dice

A portable custom-die definition may request a fallback style:

```ts
const weather = {
  id: 'weather',
  renderAs: 'token',
  faces: [
    { result: 'clear', value: 0, weight: 4, label: 'Clear' },
    { result: 'rain', value: 1, weight: 3, label: 'Rain' },
    { result: 'storm', value: 2, weight: 1, label: 'Storm' },
  ],
};
```

Supported `renderAs` values are:

- `coin`
- `percentile`
- `fate`
- `spinner`
- `token`
- `card`

When `renderAs` is omitted, Draftroll selects a safe fallback from the normalized type and result. String results and registered custom dice default to cards. Numeric nonstandard dice default to spinners.

## Themes and outcomes

Fallback visuals use the same resolved per-die theme ID and semantic outcome as physical dice. Built-in theme colors are applied to the fallback surface, and positive/negative effects are played at the fallback's settled scene position.

Downloaded runtime textures, decals, sounds, effects, and custom meshes are a separate roadmap item. The current fallback surfaces use the bundled themes.

## Replay

Replay snapshots retain:

- physical die kinds and transforms
- physical results and themes
- fallback specifications
- normalized visual order
- common seed and duration

Fallback trajectories are deterministically recreated from the replay seed. Existing physical-only replay snapshots remain compatible.

## Current limitations

- Symbolic faces are not yet painted onto supported physical meshes.
- d10 percentile tens are currently visually distinct fallback tokens rather than relabeled physical d10 meshes.
- Custom coin and other fallback visuals are scene meshes rather than rigid bodies and do not collide with physical dice. Standard numeric d2 coins are rigid bodies and do collide.
- Real browser visual regression and mobile performance tests remain pending.
