import { expect, test } from '@playwright/test';

test('cards demo draws through the real overlay and keeps deck state in sync', async ({ page }) => {
  await page.goto('/cards.html?overlayOrigin=http%3A%2F%2F127.0.0.1%3A4174');
  await expect(page.locator('#card-status')).toHaveText('Ready');

  const supportsWebGl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  });
  test.skip(!supportsWebGl, 'WebGL is unavailable in this browser runner');

  await page.locator('#card-draw-count').selectOption('1');
  await page.locator('#card-draw').click();

  await expect(page.locator('#card-hand .playing-card')).toHaveCount(1);
  await expect(page.locator('#card-remaining')).toHaveText('51');
  await expect(page.locator('#card-discarded')).toHaveText('0');
  await expect(page.locator('#card-status')).toContainText('Dealt 1');

  const iframe = page.locator('iframe[title="Draftroll dice overlay"]');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute('src', 'http://127.0.0.1:4174/overlay.html');
  await expect(iframe).toHaveCSS('visibility', 'visible');
  await expect(
    page.frameLocator('iframe[title="Draftroll dice overlay"]').locator('#scene'),
  ).toBeVisible();

  await page.locator('#card-draw').click();
  await expect(page.locator('#card-hand .playing-card')).toHaveCount(1);
  await expect(page.locator('#card-remaining')).toHaveText('50');
  await expect(page.locator('#card-discarded')).toHaveText('1');
  await expect(page.locator('#card-status')).toContainText('Dealt 1');
});
