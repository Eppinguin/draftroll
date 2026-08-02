import { expect, test } from '@playwright/test';
import { getState, openParticipant } from '../support/fixture';

test('two participants receive one authoritative public roll without duplicate logical events', async ({
  browser,
}, testInfo) => {
  const roomId = `public-${testInfo.project.name}-${crypto.randomUUID()}`;
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await openParticipant(aliceContext, {
    roomId,
    participantId: 'alice',
    sessionId: 'alice-1',
    name: 'Alice',
    overlay: false,
  });
  const bob = await openParticipant(bobContext, {
    roomId,
    participantId: 'bob',
    sessionId: 'bob-1',
    name: 'Bob',
    overlay: false,
  });

  await expect
    .poll(() => getState(alice).then((state) => state.participants))
    .toEqual(['Alice', 'Bob']);
  const created = await alice.evaluate(() =>
    window.__draftrollTest.rollRoom('1d20+5', { type: 'public' }),
  );
  expect(created.total).not.toBeNull();

  await expect
    .poll(() =>
      getState(bob).then((state) =>
        state.roomEvents.filter((event) => event.rollId === created.rollId),
      ),
    )
    .toHaveLength(1);
  const bobEvent = (await getState(bob)).roomEvents.find(
    (event) => event.rollId === created.rollId,
  );
  expect(bobEvent?.hidden).toBe(false);
  expect(bobEvent?.total).toBe(created.total);

  await aliceContext.close();
  await bobContext.close();
});

test('roller-only values never reach another participant and reveal updates the same roll', async ({
  browser,
}, testInfo) => {
  const roomId = `hidden-${testInfo.project.name}-${crypto.randomUUID()}`;
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await openParticipant(aliceContext, {
    roomId,
    participantId: 'alice',
    sessionId: 'alice-2',
    name: 'Alice',
    overlay: false,
  });
  const bob = await openParticipant(bobContext, {
    roomId,
    participantId: 'bob',
    sessionId: 'bob-2',
    name: 'Bob',
    overlay: false,
  });

  const created = await alice.evaluate(() =>
    window.__draftrollTest.rollRoom('1d20+7', { type: 'roller' }),
  );
  expect(created.total).not.toBeNull();
  await expect
    .poll(() =>
      getState(bob).then((state) =>
        state.roomEvents.some((event) => event.rollId === created.rollId),
      ),
    )
    .toBe(true);

  const hidden = (await getState(bob)).roomEvents.find((event) => event.rollId === created.rollId);
  expect(hidden).toMatchObject({ hidden: true, total: null, revision: 0 });

  const revealed = await alice.evaluate(() => window.__draftrollTest.revealLast());
  expect(revealed.rollId).toBe(created.rollId);
  expect(revealed.revision).toBe(1);
  await expect
    .poll(() =>
      getState(bob).then(
        (state) =>
          state.roomEvents.toReversed().find((event) => event.rollId === created.rollId)?.total,
      ),
    )
    .toBe(created.total);
  const visible = (await getState(bob)).roomEvents
    .toReversed()
    .find((event) => event.rollId === created.rollId);
  expect(visible).toMatchObject({ hidden: false, revision: 1 });

  await aliceContext.close();
  await bobContext.close();
});

test('HTTP state, D1 history, durable events, and revisions never expose roller-only values', async ({
  browser,
  request,
}, testInfo) => {
  const roomId = `http-hidden-${testInfo.project.name}-${crypto.randomUUID()}`;
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await openParticipant(aliceContext, {
    roomId,
    participantId: 'alice',
    sessionId: 'alice-http',
    name: 'Alice',
    overlay: false,
  });
  await openParticipant(bobContext, {
    roomId,
    participantId: 'bob',
    sessionId: 'bob-http',
    name: 'Bob',
    overlay: false,
  });

  const created = await alice.evaluate(() =>
    window.__draftrollTest.rollRoom('1d20+11', { type: 'roller' }),
  );
  expect(created.total).not.toBeNull();
  const identity = new URLSearchParams({
    protocolVersion: '2',
    participantId: 'bob',
    sessionId: 'bob-http',
    name: 'Bob',
  });
  const base = `http://127.0.0.1:8787/rooms/${encodeURIComponent(roomId)}`;
  const readProjections = async () => {
    const [stateResponse, historyResponse, eventsResponse, revisionsResponse] = await Promise.all([
      request.get(`${base}/state?${identity}`),
      request.get(`${base}/history?${identity}&limit=20`),
      request.get(`${base}/events?${identity}&afterEventSequence=0&limit=100`),
      request.get(`${base}/rolls/${encodeURIComponent(created.rollId)}/revisions?${identity}`),
    ]);
    if (
      ![stateResponse, historyResponse, eventsResponse, revisionsResponse].every((response) =>
        response.ok(),
      )
    )
      return null;
    const [state, history, events, revisions] = await Promise.all([
      stateResponse.json(),
      historyResponse.json(),
      eventsResponse.json(),
      revisionsResponse.json(),
    ]);
    return {
      stateRoll: (state.recentRolls ?? [])
        .toReversed()
        .find((event: { rollId?: string }) => event.rollId === created.rollId),
      historyRoll: (history.rolls ?? []).find(
        (roll: { rollId?: string }) => roll.rollId === created.rollId,
      ),
      durableEvent: (events.events ?? []).find(
        (event: { rollId?: string }) => event.rollId === created.rollId,
      ),
      revision: (revisions.revisions ?? []).find(
        (item: { rollId?: string }) => item.rollId === created.rollId,
      ),
    };
  };

  await expect
    .poll(
      async () => {
        const projection = await readProjections();
        return projection !== null && Object.values(projection).every(Boolean);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const projection = await readProjections();
  expect(projection).not.toBeNull();

  for (const item of Object.values(projection ?? {})) {
    expect(item).toMatchObject({ hidden: true, result: null });
    expect(JSON.stringify(item)).not.toContain('1d20+11');
  }

  await aliceContext.close();
  await bobContext.close();
});

test('a disconnected participant catches up from the event cursor after reconnect', async ({
  browser,
}, testInfo) => {
  const roomId = `reconnect-${testInfo.project.name}-${crypto.randomUUID()}`;
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await openParticipant(aliceContext, {
    roomId,
    participantId: 'alice',
    sessionId: 'alice-3',
    name: 'Alice',
    overlay: false,
  });
  const bob = await openParticipant(bobContext, {
    roomId,
    participantId: 'bob',
    sessionId: 'bob-3',
    name: 'Bob',
    overlay: false,
  });

  await bobContext.setOffline(true);
  await expect.poll(() => getState(bob).then((state) => state.roomCloseCount)).toBeGreaterThan(0);
  const missed = await alice.evaluate(() =>
    window.__draftrollTest.rollRoom('2d6+3', { type: 'public' }),
  );
  await bobContext.setOffline(false);

  await expect.poll(() => getState(bob).then((state) => state.roomOpenCount)).toBeGreaterThan(1);
  await expect
    .poll(() =>
      getState(bob).then((state) =>
        state.roomEvents.some((event) => event.rollId === missed.rollId && event.replayed),
      ),
    )
    .toBe(true);
  const replayed = (await getState(bob)).roomEvents.find((event) => event.rollId === missed.rollId);
  expect(replayed?.total).toBe(missed.total);

  await aliceContext.close();
  await bobContext.close();
});

test('three participants converge on the same authoritative result and participant state', async ({
  browser,
}, testInfo) => {
  const roomId = `multi-${testInfo.project.name}-${crypto.randomUUID()}`;
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, bob, carol] = await Promise.all([
    openParticipant(contexts[0], {
      roomId,
      participantId: 'alice',
      sessionId: 'alice-4',
      name: 'Alice',
      overlay: false,
    }),
    openParticipant(contexts[1], {
      roomId,
      participantId: 'bob',
      sessionId: 'bob-4',
      name: 'Bob',
      overlay: false,
    }),
    openParticipant(contexts[2], {
      roomId,
      participantId: 'carol',
      sessionId: 'carol-4',
      name: 'Carol',
      overlay: false,
    }),
  ]);

  await expect
    .poll(() => getState(alice).then((state) => state.participants))
    .toEqual(['Alice', 'Bob', 'Carol']);
  const created = await carol.evaluate(() =>
    window.__draftrollTest.rollRoom('3d8+2', { type: 'public' }),
  );
  for (const page of [alice, bob, carol]) {
    await expect
      .poll(() =>
        getState(page).then(
          (state) => state.roomEvents.find((event) => event.rollId === created.rollId)?.total,
        ),
      )
      .toBe(created.total);
  }

  await Promise.all(contexts.map((context) => context.close()));
});

test('near-simultaneous room rolls share one visible table throw with both roller labels', async ({
  browser,
}, testInfo) => {
  const roomId = `simultaneous-${testInfo.project.name}-${crypto.randomUUID()}`;
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, bob, spectator] = await Promise.all([
    openParticipant(contexts[0], {
      roomId,
      participantId: 'alice',
      sessionId: 'alice-table',
      name: 'Alice',
      overlay: false,
    }),
    openParticipant(contexts[1], {
      roomId,
      participantId: 'bob',
      sessionId: 'bob-table',
      name: 'Bob',
      overlay: false,
    }),
    openParticipant(contexts[2], {
      roomId,
      participantId: 'spectator',
      sessionId: 'spectator-table',
      name: 'Spectator',
      overlay: true,
    }),
  ]);

  await expect
    .poll(() => getState(spectator).then((state) => state.participants))
    .toEqual(['Alice', 'Bob', 'Spectator']);
  const [aliceRoll, bobRoll] = await Promise.all([
    alice.evaluate(() => window.__draftrollTest.rollRoom('1d20+4', { type: 'public' })),
    bob.evaluate(() => window.__draftrollTest.rollRoom('2d6+2', { type: 'public' })),
  ]);
  expect(aliceRoll.rollId).not.toBe(bobRoll.rollId);

  const rendererFrame = spectator.frameLocator('iframe[title="Draftroll dice overlay"]');
  await expect(rendererFrame.locator('#result-detail')).toContainText('Alice');
  await expect(rendererFrame.locator('#result-detail')).toContainText('Bob');
  await expect(rendererFrame.locator('#result-detail')).toContainText('•');

  await Promise.all(contexts.map((context) => context.close()));
});

test('a later room roll joins the active table world instead of waiting for the first throw', async ({
  browser,
}, testInfo) => {
  const roomId = `inflight-${testInfo.project.name}-${crypto.randomUUID()}`;
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, bob, spectator] = await Promise.all([
    openParticipant(contexts[0], {
      roomId,
      participantId: 'alice',
      sessionId: 'alice-inflight',
      name: 'Alice',
      overlay: false,
    }),
    openParticipant(contexts[1], {
      roomId,
      participantId: 'bob',
      sessionId: 'bob-inflight',
      name: 'Bob',
      overlay: false,
    }),
    openParticipant(contexts[2], {
      roomId,
      participantId: 'spectator',
      sessionId: 'spectator-inflight',
      name: 'Spectator',
      overlay: true,
    }),
  ]);

  await expect
    .poll(() => getState(spectator).then((state) => state.participants))
    .toEqual(['Alice', 'Bob', 'Spectator']);
  const aliceRoll = await alice.evaluate(() =>
    window.__draftrollTest.rollRoom('3d6', { type: 'public' }),
  );

  // This is deliberately outside the renderer's 140 ms coalescing window but
  // inside the 720 ms visible throw. Bob's dice should be injected into the
  // already-running table world instead of waiting for a second isolated scene.
  await spectator.waitForTimeout(360);
  const bobRoll = await bob.evaluate(() =>
    window.__draftrollTest.rollRoom('2d8', { type: 'public' }),
  );
  expect(aliceRoll.rollId).not.toBe(bobRoll.rollId);

  const rendererFrame = spectator.frameLocator('iframe[title="Draftroll dice overlay"]');
  await expect(rendererFrame.locator('#result-detail')).toContainText('Alice');
  await expect(rendererFrame.locator('#result-detail')).toContainText('Bob');
  await expect(rendererFrame.locator('#result-detail')).toContainText('•');

  await Promise.all(contexts.map((context) => context.close()));
});

test('a new room roll can strike dice that already settled on the persistent table', async ({
  browser,
}, testInfo) => {
  const roomId = `settled-${testInfo.project.name}-${crypto.randomUUID()}`;
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [alice, bob, spectator] = await Promise.all([
    openParticipant(contexts[0], {
      roomId,
      participantId: 'alice',
      sessionId: 'alice-settled',
      name: 'Alice',
      overlay: false,
    }),
    openParticipant(contexts[1], {
      roomId,
      participantId: 'bob',
      sessionId: 'bob-settled',
      name: 'Bob',
      overlay: false,
    }),
    openParticipant(contexts[2], {
      roomId,
      participantId: 'spectator',
      sessionId: 'spectator-settled',
      name: 'Spectator',
      overlay: true,
    }),
  ]);

  await expect
    .poll(() => getState(spectator).then((state) => state.participants))
    .toEqual(['Alice', 'Bob', 'Spectator']);
  await alice.evaluate(() => window.__draftrollTest.rollRoom('1d20', { type: 'public' }));

  const rendererFrame = spectator.frameLocator('iframe[title="Draftroll dice overlay"]');
  await expect
    .poll(
      async () =>
        rendererFrame.locator('body').evaluate(() => {
          const snapshot = (
            window as Window & {
              draftrollDice?: {
                getPerformanceSnapshot?: () => { physicalDice: number; renderLoopActive: boolean };
              };
            }
          ).draftrollDice?.getPerformanceSnapshot?.();
          return snapshot
            ? { physicalDice: snapshot.physicalDice, renderLoopActive: snapshot.renderLoopActive }
            : null;
        }),
      { timeout: 10_000 },
    )
    .toEqual({ physicalDice: 1, renderLoopActive: false });

  await bob.evaluate(() => window.__draftrollTest.rollRoom('2d6', { type: 'public' }));
  await expect
    .poll(
      async () =>
        rendererFrame.locator('body').evaluate(() => {
          return (
            (
              window as Window & {
                draftrollDice?: { getPerformanceSnapshot?: () => { physicalDice: number } };
              }
            ).draftrollDice?.getPerformanceSnapshot?.().physicalDice ?? 0
          );
        }),
      { timeout: 10_000 },
    )
    .toBe(3);
  await expect(rendererFrame.locator('#result-detail')).toContainText('Alice');
  await expect(rendererFrame.locator('#result-detail')).toContainText('Bob');

  await Promise.all(contexts.map((context) => context.close()));
});
