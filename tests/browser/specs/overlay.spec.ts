import { expect, test } from '@playwright/test';
import { getState, waitForFixture } from '../support/fixture';

test('cross-origin overlay is transparent while idle and dismisses without swallowing the host click', async ({ page, browserName }) => {
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
  test.skip(browserName !== 'chromium' && !supportsWebGl, 'WebGL is unavailable in this browser runner');
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

test('overlay lifecycle survives repeated rolls and explicit host interaction on a responsive viewport', async ({ page }) => {
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
