import { expect, test } from '@playwright/test';
import { getState, waitForFixture } from '../support/fixture';

test('cross-origin overlay is transparent while idle and dismisses without swallowing the host click', async ({
  page,
  browserName,
}) => {
  await page.goto('/host.html?overlayOrigin=http%3A%2F%2F127.0.0.1%3A4174');
  await waitForFixture(page);

  const iframe = page.locator('iframe[title="Draftroll dice overlay"]');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute('src', 'http://127.0.0.1:4174/overlay.html');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(iframe).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(iframe).toHaveCSS('visibility', 'hidden');
  await expect(page.getByTestId('host-app')).toBeVisible();

  const supportsWebGl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  });
  test.skip(
    browserName !== 'chromium' && !supportsWebGl,
    'WebGL is unavailable in this browser runner',
  );
  expect(supportsWebGl).toBe(true);

  const rollPromise = page.evaluate(() => window.__draftrollTest.rollLocal('1d20+1d8+1d2+1dF+1d9'));
  await expect(iframe).toHaveCSS('visibility', 'visible');
  const roll = await rollPromise;
  expect(roll.dice).toBe(5);
  expect(Number.isFinite(roll.total)).toBe(true);

  await page.getByTestId('underlay-action').click();
  await expect.poll(() => getState(page).then((state) => state.clickCount)).toBe(1);
  await expect(iframe).toHaveCSS('visibility', 'hidden');
});

test('overlay exposes authoritative outcomes for generated non-standard physical dice', async ({
  page,
}) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const iframe = page.locator('iframe[title="Draftroll dice overlay"]');
  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');

  const generatedRoll = page.evaluate(() => window.__draftrollTest.rollLocal('1d3+1d5+1d9'));
  await expect(iframe).toHaveCSS('visibility', 'visible');

  const generatedCanvas = frame.locator('#scene');
  await page.waitForTimeout(120);
  const firstRollingFrame = await generatedCanvas.screenshot();
  await page.waitForTimeout(180);
  const secondRollingFrame = await generatedCanvas.screenshot();
  expect(firstRollingFrame.equals(secondRollingFrame)).toBe(false);

  const generatedOnly = await generatedRoll;
  expect(generatedOnly.dice).toBe(3);
  expect(Number.isFinite(generatedOnly.total)).toBe(true);
  const generatedSnapshot = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(generatedSnapshot).toHaveLength(3);
  expect(generatedSnapshot.every((entry) => entry.implementation === 'generated')).toBe(true);
  expect(generatedSnapshot.every((entry) => entry.targeting === 'relabel')).toBe(true);
  expect(generatedSnapshot.every((entry) => entry.visible)).toBe(true);
  expect(
    generatedSnapshot.every(
      (entry) =>
        Number.isInteger(entry.landedOutcomeIndex) &&
        entry.requestedOutcomeIndex >= 0 &&
        entry.requestedOutcomeIndex < entry.sides,
    ),
  ).toBe(true);
  expect(
    generatedSnapshot.every(
      (entry) =>
        entry.displayedOutcomeIndex === entry.requestedOutcomeIndex &&
        entry.result === entry.displayedOutcomeIndex + 1,
    ),
  ).toBe(true);

  await page.getByTestId('underlay-action').click();
  await expect(iframe).toHaveCSS('visibility', 'hidden');

  const mixed = await page.evaluate(() => window.__draftrollTest.rollLocal('1d6+1d9+1d11'));
  expect(mixed.dice).toBe(3);
  expect(Number.isFinite(mixed.total)).toBe(true);
  await expect(iframe).toHaveCSS('visibility', 'visible');
  const mixedSnapshot = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(mixedSnapshot.map((entry) => entry.implementation)).toEqual([
    'canonical',
    'generated',
    'generated',
  ]);
  expect(mixedSnapshot.map((entry) => entry.targeting)).toEqual(['symmetry', 'relabel', 'relabel']);
  expect(
    mixedSnapshot.every((entry) => entry.displayedOutcomeIndex === entry.requestedOutcomeIndex),
  ).toBe(true);

  await page.setViewportSize({ width: 980, height: 700 });
  await frame.locator('body').evaluate(async () => {
    const replay = window.draftrollDice.getLastReplay();
    if (!replay) throw new Error('Missing generated physical replay');
    await window.draftrollDice.playReplay(replay, { settleImmediately: true });
  });
  const replayedSnapshot = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(
    replayedSnapshot.map((entry) => ({
      implementation: entry.implementation,
      targeting: entry.targeting,
      requestedOutcomeIndex: entry.requestedOutcomeIndex,
      displayedOutcomeIndex: entry.displayedOutcomeIndex,
      landedOutcomeIndex: entry.landedOutcomeIndex,
      result: entry.result,
    })),
  ).toEqual(
    mixedSnapshot.map((entry) => ({
      implementation: entry.implementation,
      targeting: entry.targeting,
      requestedOutcomeIndex: entry.requestedOutcomeIndex,
      displayedOutcomeIndex: entry.displayedOutcomeIndex,
      landedOutcomeIndex: entry.landedOutcomeIndex,
      result: entry.result,
    })),
  );
  for (let index = 0; index < mixedSnapshot.length; index += 1) {
    const before = mixedSnapshot[index];
    const after = replayedSnapshot[index];
    const quaternionDot =
      before.quaternion.x * after.quaternion.x +
      before.quaternion.y * after.quaternion.y +
      before.quaternion.z * after.quaternion.z +
      before.quaternion.w * after.quaternion.w;
    expect(Math.abs(quaternionDot)).toBeGreaterThan(0.999);
    expect(after.position.y).toBeCloseTo(before.position.y, 3);
  }
});

test('additive generated physical roll preserves settled canonical dice', async ({ page }) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');

  await frame.locator('body').evaluate(() =>
    window.draftrollDice.roll({
      physical: [
        {
          id: 'add-canonical-d6',
          type: 'd6',
          sides: 6,
          outcomeIndex: 2,
          result: 3,
          numericValue: 3,
          canonicalKind: 'd6',
          title: 'd6',
          label: '3',
          theme: 'dragon',
          outcome: 'neutral',
        },
      ],
      visualOrder: [{ kind: 'physical', index: 0, dieId: 'add-canonical-d6' }],
      seed: 'additive-canonical',
      animationDurationMs: 720,
    }),
  );
  const before = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({
    id: 'add-canonical-d6',
    implementation: 'canonical',
    requestedOutcomeIndex: 2,
    displayedOutcomeIndex: 2,
    result: 3,
  });

  await frame.locator('body').evaluate(() =>
    window.draftrollDice.roll({
      physical: [
        {
          id: 'add-generated-d9',
          type: 'd9',
          sides: 9,
          outcomeIndex: 4,
          result: 5,
          numericValue: 5,
          title: 'd9',
          label: '5',
          theme: 'dragon',
          outcome: 'neutral',
        },
      ],
      visualOrder: [{ kind: 'physical', index: 0, dieId: 'add-generated-d9' }],
      seed: 'additive-generated',
      animationDurationMs: 720,
      tableMode: 'add',
    }),
  );
  const after = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(after).toHaveLength(2);
  expect(after.find((entry) => entry.id === 'add-canonical-d6')).toMatchObject({
    implementation: 'canonical',
    requestedOutcomeIndex: 2,
    displayedOutcomeIndex: 2,
    result: 3,
    visible: true,
  });
  const generated = after.find((entry) => entry.id === 'add-generated-d9');
  expect(generated).toMatchObject({
    implementation: 'generated',
    targeting: 'relabel',
    requestedOutcomeIndex: 4,
    displayedOutcomeIndex: 4,
    result: 5,
    visible: true,
  });
});

test('generated physical dice receive heavy and low-gravity planner presets', async ({ page }) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');

  await page.evaluate(() => window.__draftrollTest.rollLocalWithPhysicsPreset('1d9', 'heavy'));
  let snapshot = await frame.locator('body').evaluate(() => ({
    performance: window.draftrollDice.getPerformanceSnapshot(),
    replayPreset: window.draftrollDice.getLastReplay()?.physicsPreset ?? null,
    physical: window.draftrollDice.getPhysicalSnapshot(),
  }));
  expect(snapshot.performance.physicsPreset).toBe('heavy');
  expect(snapshot.replayPreset).toBe('heavy');
  expect(snapshot.physical).toHaveLength(1);
  expect(snapshot.physical[0].implementation).toBe('generated');

  await page.evaluate(() =>
    window.__draftrollTest.rollLocalWithPhysicsPreset('1d11', 'low-gravity'),
  );
  snapshot = await frame.locator('body').evaluate(() => ({
    performance: window.draftrollDice.getPerformanceSnapshot(),
    replayPreset: window.draftrollDice.getLastReplay()?.physicsPreset ?? null,
    physical: window.draftrollDice.getPhysicalSnapshot(),
  }));
  expect(snapshot.performance.physicsPreset).toBe('low-gravity');
  expect(snapshot.replayPreset).toBe('low-gravity');
  expect(snapshot.physical).toHaveLength(1);
  expect(snapshot.physical[0].implementation).toBe('generated');
});

test('generated physical dice remain draggable after settlement', async ({ page }) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const iframe = page.locator('iframe[title="Draftroll dice overlay"]');
  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');

  await page.evaluate(() => window.__draftrollTest.rollLocal('1d9'));
  await page.evaluate(() => window.__draftrollTest.configureOverlayDrag(true));
  await expect(iframe).toHaveCSS('pointer-events', 'auto');

  const before = (
    await frame.locator('body').evaluate(() => window.draftrollDice.getPhysicalSnapshot())
  )[0];
  const canvas = frame.locator('#scene');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + before.screenPosition.x;
  const startY = box!.y + before.screenPosition.y;
  const targetX = startX + (before.position.x >= 0 ? -80 : 80);
  const targetY = startY + (before.position.z >= 0 ? -50 : 50);

  await canvas.hover({ position: before.screenPosition });
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 6 });
  await page.mouse.up();

  const after = (
    await frame.locator('body').evaluate(() => window.draftrollDice.getPhysicalSnapshot())
  )[0];
  expect(
    Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z),
  ).toBeGreaterThan(0.25);
});

test('overlay renders a host-supplied custom physical model through the shared planner', async ({
  page,
}) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const iframe = page.locator('iframe[title="Draftroll dice overlay"]');

  const firstRoll = page.evaluate(() => window.__draftrollTest.rollLocalWithPhysicalModel('1d6'));
  await expect(iframe).toHaveCSS('visibility', 'visible');
  const first = await firstRoll;
  expect(first.dice).toBe(1);
  expect(Number.isInteger(first.total)).toBe(true);
  expect(first.total).toBeGreaterThanOrEqual(1);
  expect(first.total).toBeLessThanOrEqual(6);

  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');
  const firstSnapshot = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(firstSnapshot).toHaveLength(1);
  expect(firstSnapshot[0]).toMatchObject({
    implementation: 'custom',
    targeting: 'relabel',
    sides: 6,
    result: first.total,
    requestedOutcomeIndex: first.total - 1,
    visible: true,
  });
  expect(Number.isInteger(firstSnapshot[0].landedOutcomeIndex)).toBe(true);
  expect(firstSnapshot[0].landedOutcomeIndex).toBeGreaterThanOrEqual(0);
  expect(firstSnapshot[0].landedOutcomeIndex).toBeLessThan(6);

  // A second roll reuses the same persistent worker and definition key. If the main thread or
  // worker registry loses the custom definition between plans, this call fails before playback.
  const second = await page.evaluate(() =>
    window.__draftrollTest.rollLocalWithPhysicalModel('1d6'),
  );
  expect(second.dice).toBe(1);
  const secondSnapshot = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(secondSnapshot).toHaveLength(1);
  expect(secondSnapshot[0]).toMatchObject({
    implementation: 'custom',
    targeting: 'relabel',
    sides: 6,
    result: second.total,
    requestedOutcomeIndex: second.total - 1,
    visible: true,
  });
  expect(Number.isInteger(secondSnapshot[0].landedOutcomeIndex)).toBe(true);
});

test('overlay lifecycle survives repeated rolls and explicit host interaction on a responsive viewport', async ({
  page,
}) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const iframe = page.locator('iframe[title="Draftroll dice overlay"]');

  const first = await page.evaluate(() => window.__draftrollTest.rollLocal('1d6'));
  expect(first.dice).toBe(1);
  await page.getByTestId('underlay-action').click();
  await expect(iframe).toHaveCSS('visibility', 'hidden');

  const second = await page.evaluate(() => window.__draftrollTest.rollLocal('1d20+1d100'));
  expect(second.dice).toBe(2);
  await expect.poll(() => getState(page).then((state) => state.localPresentationCount)).toBe(2);
  await expect(page.getByTestId('host-app')).toBeVisible();
});

test('destroy removes the iframe and all SDK-owned overlay DOM', async ({ page }) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  await expect(page.locator('iframe[title="Draftroll dice overlay"]')).toHaveCount(1);
  await page.evaluate(() => window.__draftrollTest.destroyOverlay());
  await expect(page.locator('iframe[title="Draftroll dice overlay"]')).toHaveCount(0);
  await expect.poll(() => getState(page).then((state) => state.overlayMounted)).toBe(false);
});
