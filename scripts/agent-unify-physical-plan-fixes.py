from pathlib import Path

renderer_path = Path('packages/renderer/src/index.ts')
renderer = renderer_path.read_text()
block = """    if (physical.length > 0 && presentationMode === 'replace') {
      // These legacy bridge setters rebuild the browser table. They are useful
      // for a replacement cast, but calling them before an additive modifier
      // stage would remove the settled dice that the new dice must join.
      this.bridge.setQuantity(physical.length);
      this.bridge.setTheme(physical[0]?.theme ?? this.fallbackThemeId);
    }
"""
if renderer.count(block) != 1:
    raise SystemExit(f'renderer legacy setter block: expected one match, found {renderer.count(block)}')
renderer_path.write_text(renderer.replace(block, '', 1))

main_path = Path('src/main.ts')
main = main_path.read_text()
main = main.replace("from './physical-dices';", "from './physical-dice';")
main = main.replace('clearAdditionalPhysicalVisuals', 'clearGenericPhysicalVisuals')
old_position = """  const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);
  if (canonicalIndex >= 0) return dice[canonicalIndex]?.getWorldPosition(target) ?? null;
  const genericIndex = activeGenericPhysicalIndexes.indexOf(physicalIndex);
"""
new_position = """  const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);
  if (canonicalIndex >= 0) {
    const position = dice[canonicalIndex]?.getWorldPosition();
    return position ? target.copy(position) : null;
  }
  const genericIndex = activeGenericPhysicalIndexes.indexOf(physicalIndex);
"""
if main.count(old_position) != 1:
    raise SystemExit(f'physical world-position adapter: expected one match, found {main.count(old_position)}')
main_path.write_text(main.replace(old_position, new_position, 1))

natural_path = Path('scripts/test-natural-target-physics.mjs')
natural = natural_path.read_text()
old_coin = "assert.match(renderer, /normalized === 'd2'\\) return 'coin'/);"
new_coin = "assert.match(renderer, /normalized === 'd2'[\\s\\S]{0,100}'coin'/);"
if natural.count(old_coin) != 1:
    raise SystemExit(f'd2 canonical mapping assertion: expected one match, found {natural.count(old_coin)}')
natural_path.write_text(natural.replace(old_coin, new_coin, 1))

print('Unified-plan follow-up cleanup applied.')
