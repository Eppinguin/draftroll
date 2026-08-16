from pathlib import Path
import re


def remove_once(path: str, text: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(text)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    target.write_text(source.replace(text, '', 1))


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
