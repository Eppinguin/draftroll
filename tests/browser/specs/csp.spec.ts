import { expect, test } from '@playwright/test';
import { getState, waitForFixture } from '../support/fixture';

test('documented host and overlay CSP presets allow the cross-origin renderer', async ({ page, browserName }) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const supportsWebGl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  });
  test.skip(browserName !== 'chromium' && !supportsWebGl, 'WebGL is unavailable in this browser runner');
  expect(supportsWebGl).toBe(true);

  await page.evaluate(() => window.__draftrollTest.rollLocal('1d20'));
  const state = await getState(page);
  expect(state.cspViolations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('frame-src policy blocks an unapproved overlay origin and fails closed', async ({ page }) => {
  await page.goto('/blocked.html?readyTimeoutMs=700');
  await page.waitForFunction(() => Boolean(window.__draftrollTest));
  await expect(page.getByTestId('status')).toContainText('Error:');
  await expect.poll(() => getState(page).then((state) => state.cspViolations.some((violation) => violation.directive === 'frame-src'))).toBe(true);
  const state = await getState(page);
  expect(state.overlayMounted).toBe(false);
  expect(state.errors.some((message) => message.includes('did not become ready'))).toBe(true);
});

test('connect-src policy blocks room WebSockets without exposing room state', async ({ page }) => {
  const roomId = `csp-connect-${crypto.randomUUID()}`;
  await page.goto(`/connect-blocked.html?overlay=0&connect=1&roomId=${roomId}&participantId=csp&sessionId=csp-1&name=CSP`);
  await page.waitForFunction(() => Boolean(window.__draftrollTest));
  await expect(page.getByTestId('status')).toContainText('Error:');
  await expect.poll(() => getState(page).then((state) => state.cspViolations.some((violation) => violation.directive === 'connect-src'))).toBe(true);
  const state = await getState(page);
  expect(state.roomConnected).toBe(false);
  expect(state.roomEvents).toHaveLength(0);
});
