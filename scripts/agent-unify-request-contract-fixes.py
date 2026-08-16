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

print('Remaining request-contract tests migrated.')
