from pathlib import Path
import re


def replace_once(path: str, before: str, after: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(before)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    target.write_text(source.replace(before, after, 1))


# Modifier sequencing: every *Calls collection stores bridge requests. Inspect physical descriptors,
# never the removed request.results parallel array.
modifier_path = Path('scripts/test-modifier-sequencing.mjs')
modifier = modifier_path.read_text()
modifier = re.sub(
    r'([A-Za-z_]\w*Calls)\.map\(\(request\) => request\.results\)',
    r'\1.map((request) => request.physical.map((visual) => visual.result))',
    modifier,
)
modifier = re.sub(
    r'([A-Za-z_]\w*Calls\[\d+\])\.results',
    r'\1.physical.map((visual) => visual.result)',
    modifier,
)
old_fate = """    explosionCalls.map((request) => request.fallbacks?.map((fallback) => fallback.result)),
    [[1], [-1]],
    'fallback-only explosions must also preserve prior visuals and append causal waves',"""
new_fate = """    explosionCalls.map((request) => request.physical.map((visual) => visual.result)),
    [[1], [-1]],
    'Fate explosions remain first-class physical dice and append causal waves',"""
if modifier.count(old_fate) != 1:
    raise SystemExit(f'Fate physical sequencing assertion: expected one match, found {modifier.count(old_fate)}')
modifier = modifier.replace(old_fate, new_fate, 1)
old_source_assert = """  assert.match(
    rendererSource,
    /numericResults\\.length > 0 && presentationMode === 'replace'/,
    'additive stages must bypass bridge setters that rebuild the table',
  );"""
new_source_assert = """  assert.doesNotMatch(rendererSource, /bridge\\.setDie|bridge\\.setQuantity|bridge\\.setTheme/);
  assert.match(rendererSource, /this\\.bridge\\.roll\\(\\{/);
  assert.match(rendererSource, /presentationMode/);"""
if modifier.count(old_source_assert) != 1:
    raise SystemExit(f'modifier stale setter source assertion: expected one match, found {modifier.count(old_source_assert)}')
modifier = modifier.replace(old_source_assert, new_source_assert, 1)
old_empty_assert = """  assert.match(
    browserHostSource,
    /dice\\.length === 0 && activeFallbackSpecs\\.length === 0/,
    'fallback-only modifier chains must remain appendable',
  );"""
new_empty_assert = """  assert.match(
    browserHostSource,
    /dice\\.length === 0 && genericPhysicalVisuals\\.length === 0 && fallbackVisuals\\.length === 0/,
    'table emptiness must account for canonical, generated/custom physical, and fallback visuals',
  );"""
if modifier.count(old_empty_assert) != 1:
    raise SystemExit(f'modifier table-empty assertion: expected one match, found {modifier.count(old_empty_assert)}')
modifier = modifier.replace(old_empty_assert, new_empty_assert, 1)
modifier = modifier.replace(
    "'fallback-only follow-up waves must keep prior visuals static'",
    "'non-physical follow-up waves must keep prior visuals static'",
)
modifier = modifier.replace(
    "'hosts can opt into the legacy simultaneous presentation'",
    "'hosts can opt into a single simultaneous presentation'",
)
old_fallback_source = """  const fallbackVisualSource = await readFile(join(projectRoot, 'src/fallback-visuals.ts'), 'utf8');"""
new_fallback_source = """  const fallbackVisualSource = await readFile(
    join(projectRoot, 'src/fallback-visuals-base.ts'),
    'utf8',
  );"""
if modifier.count(old_fallback_source) != 1:
    raise SystemExit(f'fallback implementation source assertion: expected one match, found {modifier.count(old_fallback_source)}')
modifier = modifier.replace(old_fallback_source, new_fallback_source, 1)
if re.search(r'[A-Za-z_]\w*Calls(?:\[\d+\])?\.results', modifier):
    raise SystemExit('modifier sequencing still inspects removed bridge request.results')
modifier_path.write_text(modifier)

# Completion API bridge mock and assertions use the physical request contract.
completion_path = Path('scripts/test-completion-api.mjs')
completion = completion_path.read_text()
completion = completion.replace(
    'return { results: request.results ?? [], total: 4, replay: { ok: true } };',
    'return {\n        results: (request.physical ?? []).map((visual) => visual.result),\n        total: 4,\n        replay: { ok: true },\n      };',
)
completion = re.sub(
    r"    setDie\(value\) \{[\s\S]*?    setTheme\(value\) \{[\s\S]*?    \},\n",
    '',
    completion,
    count=1,
)
old_asserts = """  assert.deepEqual(request.results, [5]);
  assert.deepEqual(request.kinds, ['d6']);
  assert.deepEqual(request.physics, [{ sizeScale: 1.2, massScale: 1.5, inertiaScale: 0.8 }]);
  assert.equal(request.physicsPreset, 'heavy');"""
new_asserts = """  assert.equal(request.results, undefined);
  assert.equal(request.kinds, undefined);
  assert.equal(request.physics, undefined);
  assert.equal(request.physical.length, 1);
  assert.equal(request.physical[0].canonicalKind, 'd6');
  assert.equal(request.physical[0].result, 'symbol-4');
  assert.equal(request.physical[0].outcomeIndex, 4);
  assert.deepEqual(request.physical[0].physics, {
    sizeScale: 1.2,
    massScale: 1.5,
    inertiaScale: 0.8,
  });
  assert.equal(request.physicsPreset, 'heavy');"""
if completion.count(old_asserts) != 1:
    raise SystemExit(f'completion physical request assertions: expected one match, found {completion.count(old_asserts)}')
completion = completion.replace(old_asserts, new_asserts, 1)
completion_path.write_text(completion)

# Late-event bridge mock likewise has no mutable roll configuration.
late_path = Path('scripts/test-late-events.mjs')
late = late_path.read_text()
late = late.replace(
    'return { results: request.results ?? [], total: 17, replay: null };',
    'return {\n        results: (request.physical ?? []).map((visual) => visual.result),\n        total: 17,\n        replay: null,\n      };',
)
setters = """    setDie() {},
    setQuantity() {},
    setTheme() {},
"""
if late.count(setters) != 1:
    raise SystemExit(f'late-event bridge setters: expected one match, found {late.count(setters)}')
late_path.write_text(late.replace(setters, '', 1))

# Common-dice helpers use physical geometry hints for die-like randomizers. Fate is a physical d6;
# percentile is a physical d100. Only token/card helpers are non-physical fallbacks.
common_path = Path('scripts/test-common-dice-helpers.mjs')
common = common_path.read_text()
if common.count("  assert.equal(fate.renderAs, 'fate');") != 1:
    raise SystemExit('Fate common-die render hint assertion missing')
common = common.replace("  assert.equal(fate.renderAs, 'fate');", "  assert.equal(fate.renderAs, 'd6');", 1)
if common.count("  assert.equal(percentile.renderAs, 'percentile');") != 1:
    raise SystemExit('percentile common-die render hint assertion missing')
common = common.replace(
    "  assert.equal(percentile.renderAs, 'percentile');",
    "  assert.equal(percentile.renderAs, 'd100');",
    1,
)
common_path.write_text(common)

# Remove old wording from the public renderer options as well.
renderer_path = Path('packages/renderer/src/index.ts')
renderer = renderer_path.read_text()
renderer = renderer.replace(
    '   * Defaults to staged; simultaneous preserves the legacy one-throw behavior.\n',
    '   * Defaults to staged; simultaneous presents all modifier stages in one throw.\n',
)
renderer_path.write_text(renderer)

print('Remaining request-contract tests migrated.')
