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
main = main.replace('clearAdditionalPhysicalVisuals', 'clearGenericPhysicalVisuals')
main_path.write_text(main)

print('Unified-plan follow-up cleanup applied.')
