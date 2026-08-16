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
natural = natural.replace(old_coin, new_coin, 1)
old_additive = """assert.match(
  main,
  /needsSharedPhysicalPlan[\\s\\S]*?buildRollPlan\\(\\[\\.\\.\\.existingStates, \\.\\.\\.newStates\\], existingPhysicalCount, lockedTrajectory\\)[\\s\\S]*?createStaticTablePlan/,
);"""
new_additive = """assert.match(main, /createLockedTableTrajectory\\(activePlan, planTime, existingPhysicalCount\\)/);
assert.match(
  main,
  /buildRollPlan\\([\\s\\S]{0,220}existingPhysicalCount,[\\s\\S]{0,120}lockedTrajectory/,
);
assert.match(main, /hasPendingPhysicalVisuals/);
assert.match(main, /createStaticTablePlan/);"""
if natural.count(old_additive) != 1:
    raise SystemExit(f'additive planning assertion: expected one match, found {natural.count(old_additive)}')
natural_path.write_text(natural.replace(old_additive, new_additive, 1))

concurrent_path = Path('scripts/test-concurrent-table-rolls.mjs')
concurrent = concurrent_path.read_text()
old_bridge = """  const bridge = {
    async roll(request) {
      calls.push(request);
      return { results: request.results ?? [], total: 999, replay: { batch: calls.length } };
    },
    setDie() {},
    setQuantity() {},
    setTheme() {},
    getThemes() {
"""
new_bridge = """  const bridge = {
    async roll(request) {
      calls.push(request);
      return {
        results: (request.physical ?? []).map((visual) => visual.result),
        total: 999,
        replay: { batch: calls.length },
      };
    },
    getThemes() {
"""
if concurrent.count(old_bridge) != 1:
    raise SystemExit(f'concurrent bridge mock: expected one match, found {concurrent.count(old_bridge)}')
concurrent = concurrent.replace(old_bridge, new_bridge, 1)
old_parallel = """  assert.deepEqual(calls[0].results, [15, 4, 5]);
  assert.deepEqual(calls[0].kinds, ['d20', 'd6', 'd6']);
"""
new_parallel = """  assert.deepEqual(
    calls[0].physical.map((visual) => visual.result),
    [15, 4, 5],
  );
  assert.deepEqual(
    calls[0].physical.map((visual) => visual.canonicalKind),
    ['d20', 'd6', 'd6'],
  );
  assert.equal(calls[0].results, undefined);
  assert.equal(calls[0].kinds, undefined);
"""
if concurrent.count(old_parallel) != 1:
    raise SystemExit(f'concurrent parallel arrays assertion: expected one match, found {concurrent.count(old_parallel)}')
concurrent = concurrent.replace(old_parallel, new_parallel, 1)
old_launch = "  assert.match(mainSource, /createLaunchStatesForGroup/);"
new_launch = "  assert.match(mainSource, /createMixedPhysicalLaunchStates/);"
if concurrent.count(old_launch) != 1:
    raise SystemExit(f'concurrent launch assertion: expected one match, found {concurrent.count(old_launch)}')
concurrent = concurrent.replace(old_launch, new_launch, 1)
old_locked = "  assert.match(workerSource, /updateLockedBodies/);"
new_locked = """  assert.match(workerSource, /lockedMotion: readLockedMotion\\(request, lockedCount\\)/);
  const plannerSource = await readFile(join(projectRoot, 'src/physical-roll-planner.ts'), 'utf8');
  assert.match(plannerSource, /updateLockedBodies/);"""
if concurrent.count(old_locked) != 1:
    raise SystemExit(f'locked-body ownership assertion: expected one match, found {concurrent.count(old_locked)}')
concurrent_path.write_text(concurrent.replace(old_locked, new_locked, 1))

themes_path = Path('scripts/test-runtime-themes.mjs')
themes = themes_path.read_text()
old_theme_setters = """    setDie() {},
    setQuantity() {},
    setTheme(themeId) {
      bridgeCalls.push(['setTheme', themeId]);
    },
"""
if themes.count(old_theme_setters) != 1:
    raise SystemExit(f'runtime theme bridge setters: expected one match, found {themes.count(old_theme_setters)}')
themes = themes.replace(old_theme_setters, '', 1)
old_warmup = """  assert.deepEqual(bridgeCalls.slice(0, 2), [
    ['installTheme', manifest.id],
    ['setTheme', manifest.id],
  ]);"""
new_warmup = """  assert.deepEqual(bridgeCalls.slice(0, 1), [['installTheme', manifest.id]]);
  assert.equal(
    bridgeCalls.some(([name]) => name === 'setTheme'),
    false,
    'theme choice is carried by each physical visual, not mutable bridge state',
  );"""
if themes.count(old_warmup) != 1:
    raise SystemExit(f'runtime theme warmup assertion: expected one match, found {themes.count(old_warmup)}')
themes_path.write_text(themes.replace(old_warmup, new_warmup, 1))

print('Unified-plan follow-up cleanup applied.')
