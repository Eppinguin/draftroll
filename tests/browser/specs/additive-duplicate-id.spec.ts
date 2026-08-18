import { expect, test } from '@playwright/test';
import { waitForFixture } from '../support/fixture';

test('additive physical table accepts repeated logical die ids across rolls', async ({ page }) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');

  await frame.locator('body').evaluate(() =>
    window.draftrollDice.roll({
      physical: [
        {
          id: 'die_1',
          type: 'd6',
          sides: 6,
          outcomeIndex: 1,
          result: 2,
          numericValue: 2,
          canonicalKind: 'd6',
          title: 'd6',
          label: '2',
          theme: 'dragon',
          outcome: 'neutral',
        },
      ],
      visualOrder: [{ kind: 'physical', index: 0, dieId: 'die_1' }],
      seed: 'duplicate-id-first',
      animationDurationMs: 720,
    }),
  );

  await frame.locator('body').evaluate(() =>
    window.draftrollDice.roll({
      physical: [
        {
          id: 'die_1',
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
      visualOrder: [{ kind: 'physical', index: 0, dieId: 'die_1' }],
      seed: 'duplicate-id-second',
      animationDurationMs: 720,
      tableMode: 'add',
    }),
  );

  const snapshot = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(snapshot).toHaveLength(2);
  expect(snapshot.map((entry) => entry.id)).toEqual(['die_1', 'die_1']);
  expect(snapshot.map((entry) => entry.implementation)).toEqual(['canonical', 'generated']);
  expect(snapshot.map((entry) => entry.result)).toEqual([2, 5]);
  expect(snapshot.every((entry) => entry.visible)).toBe(true);
});
