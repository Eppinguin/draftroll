import { expect, test } from '@playwright/test';
import { waitForFixture } from '../support/fixture';

test('runtime table identity is independent from roll-scoped logical die ids', async ({ page }) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');

  await frame.locator('body').evaluate(() =>
    window.draftrollDice.roll({
      physical: [
        {
          id: 'die_1',
          type: 'd9',
          sides: 9,
          outcomeIndex: 3,
          result: 4,
          numericValue: 4,
          title: 'd9',
          label: '4',
          theme: 'dragon',
          outcome: 'neutral',
        },
      ],
      visualOrder: [{ kind: 'physical', index: 0, dieId: 'die_1' }],
      seed: 'duplicate-generated-first',
      animationDurationMs: 720,
    }),
  );

  await frame.locator('body').evaluate(() =>
    window.draftrollDice.roll({
      physical: [
        {
          id: 'die_1',
          type: 'd11',
          sides: 11,
          outcomeIndex: 6,
          result: 7,
          numericValue: 7,
          title: 'd11',
          label: '7',
          theme: 'dragon',
          outcome: 'neutral',
        },
      ],
      visualOrder: [{ kind: 'physical', index: 0, dieId: 'die_1' }],
      seed: 'duplicate-generated-second',
      animationDurationMs: 720,
      tableMode: 'add',
    }),
  );

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
      seed: 'duplicate-canonical-third',
      animationDurationMs: 720,
      tableMode: 'add',
    }),
  );

  const snapshot = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(snapshot).toHaveLength(3);
  expect(snapshot.map((entry) => entry.id)).toEqual(['die_1', 'die_1', 'die_1']);
  expect(snapshot.map((entry) => entry.physicalIndex)).toEqual([0, 1, 2]);
  expect(snapshot.map((entry) => entry.implementation)).toEqual([
    'generated',
    'generated',
    'canonical',
  ]);
  expect(snapshot.map((entry) => entry.result)).toEqual([4, 7, 2]);
  expect(snapshot.every((entry) => entry.visible)).toBe(true);
});
