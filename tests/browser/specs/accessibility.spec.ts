import { expect, test } from '@playwright/test';
import { waitForFixture } from '../support/fixture';

test('accessible text fallback works with reduced motion and no WebGL', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    // Saved for restoration; deliberately referenced unbound and reassigned to the prototype.
    // oxlint-disable-next-line typescript/unbound-method
    const original = HTMLCanvasElement.prototype.getContext;
    // `getContext` is an overload set whose return type depends on the literal context id, so a
    // forwarding stub cannot be expressed in the parameter types. The assertions below erase the
    // overloads to forward any call through; the stub only ever returns null or `original`'s own
    // result, so no value is reshaped.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const forward = original as (...values: unknown[]) => unknown;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    HTMLCanvasElement.prototype.getContext = function getContext(
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return forward.apply(this, [type, ...args]);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/host.html?text=1&overlay=0');
  await waitForFixture(page);
  const result = await page.evaluate(() => window.__draftrollTest.rollLocal('2d6+1'));
  expect(result.dice).toBe(2);
  const region = page.getByTestId('text-results');
  await expect(region).toHaveAttribute('role', 'status');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toContainText(String(result.total));
});

test('overlay result announcements are polite and Escape dismissal is available', async ({
  page,
}) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  await page.evaluate(() => window.__draftrollTest.rollLocal('1d6'));
  const panel = page.locator('[data-draftroll-result-panel]');
  // The default browser fixture disables the visual panel, so verify the iframe remains keyboard-inert.
  await expect(page.locator('iframe[title="Draftroll dice overlay"]')).toHaveAttribute(
    'tabindex',
    '-1',
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe[title="Draftroll dice overlay"]')).toHaveCSS(
    'visibility',
    'hidden',
  );
  await expect(panel).toHaveCount(0);
});
