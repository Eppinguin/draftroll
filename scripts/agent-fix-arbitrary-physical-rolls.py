from pathlib import Path


def replace_once(path: str, before: str, after: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(before)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    target.write_text(source.replace(before, after, 1))


replace_once(
    'src/main.ts',
    '  if (activeVisualOrder.length !== quantity + fallbacks.length) {',
    '  if (activeVisualOrder.length !== activePhysicalSpecs.length + fallbacks.length) {',
    'unified physical visual-order count',
)

mixed_path = Path('scripts/test-mixed-renderer.mjs')
mixed = mixed_path.read_text()
mixed = mixed.replace(
    "import { mkdtemp, rm, writeFile } from 'node:fs/promises';",
    "import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';",
    1,
)
anchor = """  assert.equal(calls[1].fallbacks[0].label, 'Success');
  assert.equal(calls[1].fallbacks[1].label, 'Storm');

"""
addition = """  assert.equal(calls[1].fallbacks[0].label, 'Success');
  assert.equal(calls[1].fallbacks[1].label, 'Storm');

  const browserHost = await readFile(join(projectRoot, 'src/main.ts'), 'utf8');
  assert.match(
    browserHost,
    /activeVisualOrder\\.length !== activePhysicalSpecs\\.length \\+ fallbacks\\.length/,
    'browser host must validate visual order against every physical descriptor, not only canonical dice',
  );
  assert.doesNotMatch(
    browserHost,
    /activeVisualOrder\\.length !== quantity \\+ fallbacks\\.length/,
    'generated/custom physical dice must not be omitted from browser-host visual-order validation',
  );

"""
if mixed.count(anchor) != 1:
    raise SystemExit(f'mixed-renderer regression anchor: expected one match, found {mixed.count(anchor)}')
mixed_path.write_text(mixed.replace(anchor, addition, 1))

overlay_path = Path('tests/browser/specs/overlay.spec.ts')
overlay = overlay_path.read_text()
anchor = """test('overlay lifecycle survives repeated rolls and explicit host interaction on a responsive viewport', async ({
  page,
}) => {
"""
regression = """test('overlay accepts generated non-standard physical dice', async ({ page }) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const iframe = page.locator('iframe[title=\"Draftroll dice overlay\"]');

  const generatedOnly = await page.evaluate(() => window.__draftrollTest.rollLocal('1d3+1d5'));
  expect(generatedOnly.dice).toBe(2);
  expect(Number.isFinite(generatedOnly.total)).toBe(true);
  await expect(iframe).toHaveCSS('visibility', 'visible');

  await page.getByTestId('underlay-action').click();
  await expect(iframe).toHaveCSS('visibility', 'hidden');

  const mixed = await page.evaluate(() => window.__draftrollTest.rollLocal('1d6+1d9+1d11'));
  expect(mixed.dice).toBe(3);
  expect(Number.isFinite(mixed.total)).toBe(true);
  await expect(iframe).toHaveCSS('visibility', 'visible');
});

""" + anchor
if overlay.count(anchor) != 1:
    raise SystemExit(f'overlay arbitrary-dN regression anchor: expected one match, found {overlay.count(anchor)}')
overlay_path.write_text(overlay.replace(anchor, regression, 1))

print('Arbitrary physical roll validation fix applied.')
