import { expect, type BrowserContext, type Page } from '@playwright/test';

export interface FixtureState {
  ready: boolean;
  status: string;
  overlayEnabled: boolean;
  overlayMounted: boolean;
  localPresentationCount: number;
  lastTotal: number | null;
  clickCount: number;
  cspViolations: Array<{ directive: string; blockedUri: string }>;
  roomConnected: boolean;
  roomOpenCount: number;
  roomCloseCount: number;
  roomId: string | null;
  participants: string[];
  roomEvents: Array<{
    type: string;
    rollId: string;
    eventSequence: number;
    revision: number;
    hidden: boolean;
    total: number | null;
    replayed: boolean;
  }>;
  errors: string[];
}

export async function waitForFixture(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__draftrollTest));
  await page.evaluate(() => window.__draftrollTest.ready);
  await expect.poll(() => getState(page).then((state) => state.ready)).toBe(true);
}

export function getState(page: Page): Promise<FixtureState> {
  return page.evaluate(() => window.__draftrollTest.getState());
}

/**
 * Waits until exactly the given rollers share the spectator's visible table.
 *
 * @remarks
 * The overlay's `#result-detail` text names every roller only while their groups are on the
 * table together, which is a transient state. Polling the renderer's own `activeTableRolls`
 * diagnostic makes the assertion independent of how fast the throw resolves, instead of
 * racing a fixed delay against the 720 ms animation.
 */
export async function expectSharedTable(
  spectator: Page,
  rollers: readonly string[],
): Promise<void> {
  const rendererFrame = spectator.frameLocator('iframe[title="Draftroll dice overlay"]');
  await expect
    .poll(
      () =>
        rendererFrame
          .locator('body')
          .evaluate(() =>
            (window.draftrollDice.getPerformanceSnapshot().activeTableRolls ?? []).toSorted(),
          ),
      { timeout: 15_000 },
    )
    .toEqual(rollers.toSorted());
}

export async function openParticipant(
  context: BrowserContext,
  options: {
    roomId: string;
    participantId: string;
    sessionId: string;
    name: string;
    overlay?: boolean;
  },
): Promise<Page> {
  const page = await context.newPage();
  const search = new URLSearchParams({
    connect: '1',
    overlay: options.overlay === false ? '0' : '1',
    roomId: options.roomId,
    participantId: options.participantId,
    sessionId: options.sessionId,
    name: options.name,
  });
  await page.goto(`http://127.0.0.1:4173/host.html?${search}`);
  await waitForFixture(page);
  return page;
}

declare global {
  interface Window {
    __draftrollTest: {
      ready: Promise<void>;
      getState(): FixtureState;
      rollLocal(expression?: string): Promise<{ total: number; dice: number }>;
      connectRoom(options?: {
        roomId?: string;
        participantId?: string;
        sessionId?: string;
        name?: string;
      }): Promise<void>;
      rollRoom(
        expression?: string,
        visibility?: { type: string; [key: string]: unknown },
      ): Promise<{ rollId: string; hidden: boolean; total: number | null }>;
      revealLast(): Promise<{ rollId: string; revision: number; total: number | null }>;
      destroyOverlay(): void;
      closeRoom(): void;
      dropConnection(): void;
    };
  }
}
