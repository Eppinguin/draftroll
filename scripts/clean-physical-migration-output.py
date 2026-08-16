from pathlib import Path
import re


def remove_once(path: str, text: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(text)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    target.write_text(source.replace(text, '', 1))


def replace_once(path: str, before: str, after: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(before)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    target.write_text(source.replace(before, after, 1))


runtime_path = Path('src/runtime-themes.ts')
runtime = runtime_path.read_text()
old = """  const contents: PhysicalDieFaceContent[] = source.contents.map((content) => {
    if (content.kind === 'number') return { ...content };
    if (content.kind === 'text') return { ...content };
    if (content.kind === 'icon') return { ...content };
    return { kind: 'texture', asset: content.asset.src, label: content.label };
  });"""
new = """  const contents: PhysicalDieFaceContent[] = source.contents.map((content) => {
    if (content.kind === 'number')
      return { kind: 'number', value: content.value, label: content.label };
    if (content.kind === 'text') return { kind: 'text', text: content.text };
    if (content.kind === 'icon')
      return { kind: 'icon', icon: content.icon, label: content.label };
    return { kind: 'texture', asset: content.asset.src, label: content.label };
  });"""
if runtime.count(old) != 1:
    raise SystemExit(f'runtime presentation clone: expected one match, found {runtime.count(old)}')
runtime_path.write_text(runtime.replace(old, new, 1))

visuals_path = Path('src/physical-die-visuals.ts')
visuals = visuals_path.read_text()
unused = '  type PhysicalDieFaceContent,\n'
if visuals.count(unused) != 1:
    raise SystemExit(f'unused physical face type: expected one match, found {visuals.count(unused)}')
visuals_path.write_text(visuals.replace(unused, '', 1))

main_path = Path('src/main.ts')
main = main_path.read_text()
anchor = """function clonePhysicalVisual(visual: DraftrollPhysicalVisual): DraftrollPhysicalVisual {
  return {
    ...visual,
    physics: visual.physics ? { ...visual.physics } : undefined,
    presentation: visual.presentation
      ? { contents: visual.presentation.contents.map((content) => ({ ...content })) }
      : undefined,
    metadata: visual.metadata ? { ...visual.metadata } : undefined,
  };
}

function cloneReplay"""
replacement = """function clonePhysicalVisual(visual: DraftrollPhysicalVisual): DraftrollPhysicalVisual {
  return {
    ...visual,
    physics: visual.physics ? { ...visual.physics } : undefined,
    presentation: visual.presentation
      ? { contents: visual.presentation.contents.map((content) => ({ ...content })) }
      : undefined,
    metadata: visual.metadata ? { ...visual.metadata } : undefined,
  };
}

function cloneFallbackVisual(fallback: DraftrollFallbackVisual): DraftrollFallbackVisual {
  return Object.assign({}, fallback, {
    metadata: fallback.metadata ? Object.assign({}, fallback.metadata) : undefined,
  });
}

function cloneReplay"""
if main.count(anchor) != 1:
    raise SystemExit(f'fallback clone helper anchor: expected one match, found {main.count(anchor)}')
main = main.replace(anchor, replacement, 1)
pattern = re.compile(
    r"\.map\(\(fallback\) => \(\{\n\s+\.\.\.fallback,\n\s+metadata: fallback\.metadata \? \{ \.\.\.fallback\.metadata \} : undefined,\n\s+\}\)\)"
)
main, fallback_map_count = pattern.subn('.map(cloneFallbackVisual)', main)
if fallback_map_count < 2:
    raise SystemExit(f'fallback map clones: expected at least two matches, found {fallback_map_count}')
old_physics = 'canonical.map((visual) => ({ ...visual.physics }))'
if main.count(old_physics) != 1:
    raise SystemExit(f'canonical physics clone: expected one match, found {main.count(old_physics)}')
main = main.replace(old_physics, 'canonical.map((visual) => Object.assign({}, visual.physics))', 1)
main_path.write_text(main)

# Pre-release cleanup: the fallback-only renderer policy existed only to support the removed die
# fallback path. Remove it from every public/package boundary instead of preserving compatibility.
remove_once(
    'packages/overlay/src/index.ts',
    '      forceFallback: options.forceFallback,\n',
    'overlay forceFallback',
)
remove_once(
    'packages/sdk/src/index.ts',
    '            forceFallback: this.options.renderer?.forceFallback ?? roomRenderer?.fallbackOnly,\n',
    'sdk forceFallback policy',
)
remove_once(
    'packages/protocol/src/policy.ts',
    '  fallbackOnly: boolean;\n',
    'room renderer fallbackOnly field',
)
remove_once(
    'packages/protocol/src/policy.ts',
    '    fallbackOnly: false,\n',
    'room renderer fallbackOnly preset',
)
remove_once(
    'packages/protocol/src/runtime.ts',
    "      'fallbackOnly',\n",
    'runtime fallbackOnly allowed field',
)
remove_once(
    'packages/protocol/src/runtime.ts',
    "  if (value.fallbackOnly !== undefined)\n    readBoolean(value.fallbackOnly, `${path}.fallbackOnly`, context, true);\n",
    'runtime fallbackOnly validation',
)

# True fallbacks are cards/tokens only. Delete the old coin/fate 3D branches rather than retaining
# unreachable comparisons against the clean fallback union.
fallback_path = Path('src/fallback-visuals-base.ts')
fallback = fallback_path.read_text()
fallback = fallback.replace("type VisualMode = 'sprite' | 'coin' | 'card';", "type VisualMode = 'sprite' | 'card';")
coin_pattern = re.compile(
    r"function cropCoinTexture\(texture: THREE\.CanvasTexture\): void \{.*?\n\}\n\nfunction createRoundedCardShape",
    re.S,
)
fallback, coin_count = coin_pattern.subn('function createRoundedCardShape', fallback, count=1)
if coin_count != 1:
    raise SystemExit(f'coin visual block: expected one match, found {coin_count}')
old_scale = """function visualScale(kind: DraftrollFallbackKind): THREE.Vector2 {
  if (kind === 'token') return new THREE.Vector2(1.95, 1.28);
  if (kind === 'fate') return new THREE.Vector2(1.55, 1.55);
  return new THREE.Vector2(1.62, 1.16);
}"""
new_scale = """function visualScale(kind: DraftrollFallbackKind): THREE.Vector2 {
  return kind === 'token' ? new THREE.Vector2(1.95, 1.28) : new THREE.Vector2(1.62, 1.16);
}"""
if fallback.count(old_scale) != 1:
    raise SystemExit(f'fallback visual scale: expected one match, found {fallback.count(old_scale)}')
fallback = fallback.replace(old_scale, new_scale, 1)
old_visual = """    this.threeDimensional =
      spec.kind === 'coin'
        ? createCoinVisual(this.texture, spec)
        : spec.kind === 'card'
          ? createCardVisual(spec)
          : null;"""
new_visual = """    this.threeDimensional = spec.kind === 'card' ? createCardVisual(spec) : null;"""
if fallback.count(old_visual) != 1:
    raise SystemExit(f'fallback 3d dispatch: expected one match, found {fallback.count(old_visual)}')
fallback_path.write_text(fallback.replace(old_visual, new_visual, 1))

# Remove the coin-only field from the fallback public contract.
remove_once(
    'packages/renderer/src/index.ts',
    "  /** Label painted on the reverse side when the fallback is a two-sided coin. */\n  oppositeLabel?: string;\n",
    'fallback oppositeLabel contract',
)

# Cards/tokens still need a visual-only timeline, but no die-like fallback gets special handling.
replace_once(
    'src/main.ts',
    """  const duration = specs.some((spec) => spec.kind === 'coin')
    ? 2.05 + Math.min(0.2, count * 0.012)
    : 1.45 + Math.min(0.85, count * 0.045);""",
    """  const duration = specs.some((spec) => spec.kind === 'card')
    ? 1.7 + Math.min(0.5, count * 0.04)
    : 1.35 + Math.min(0.7, count * 0.04);""",
    'fallback-only timeline',
)

# Replay interactions consume the semantic physical descriptors directly; replay no longer carries a
# second numeric result array.
replace_once(
    'src/main.ts',
    "detail: { action: interactionOptions.click, results: lastReplay?.results.slice() ?? [] },",
    """detail: {
          action: interactionOptions.click,
          results: lastReplay?.physical.map((visual) => visual.result) ?? [],
        },""",
    'interaction replay semantic results',
)
replace_once(
    'src/main.ts',
    "value: lastReplay?.results[0] ?? 1,",
    "value: lastReplay?.physical[0]?.numericValue ?? 1,",
    'interaction replay numeric effect value',
)

# Demo manifests exercise the same clean physical theme schema as consumers.
replace_once(
    'src/sdk-demo.ts',
    """      material: {
        color: '#17131f',
        emissive: '#3d1859',
        emissiveIntensity: 0.34,
        roughness: 0.36,
        metalness: 0.42,
        clearcoat: 0.48,
        clearcoatRoughness: 0.2,
      },
      labels: {
        color: '#f8eaff',
        glowColor: '#c468ff',
        fontFamily: 'Georgia',
      },""",
    """      physical: {
        material: {
          color: '#17131f',
          emissive: '#3d1859',
          emissiveIntensity: 0.34,
          roughness: 0.36,
          metalness: 0.42,
          clearcoat: 0.48,
          clearcoatRoughness: 0.2,
        },
        labels: {
          color: '#f8eaff',
          glowColor: '#c468ff',
          fontFamily: 'Georgia',
        },
      },""",
    'sdk demo physical theme schema',
)

# Source-level smoke coverage follows the direct physical presentation contract, never the removed
# metadata adapter keys.
remove_once(
    'scripts/test-visual-fallbacks.mjs',
    'assert.match(visualBase, /spec\\.oppositeLabel/);\n',
    'visual fallback opposite label assertion',
)
replace_once(
    'scripts/test-visual-fallbacks.mjs',
    'assert.match(physicalVisuals, /draftrollPhysicalPresentation/);',
    """assert.match(physicalVisuals, /if \(spec\.presentation\)/);
assert.match(physicalVisuals, /getRuntimeThemePresentation/);
assert.doesNotMatch(physicalVisuals, /draftrollPhysicalPresentation/);""",
    'direct physical presentation smoke assertion',
)
