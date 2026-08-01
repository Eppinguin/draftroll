import { expect, test } from '@playwright/test';

test('idle-zero render loop and battery profile keep the overlay renderer quiescent', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/overlay.html');
  await page.waitForFunction(() => Boolean((window as unknown as { draftrollDice?: unknown }).draftrollDice));

  const initial = await page.evaluate(() => {
    const bridge = (window as unknown as { draftrollDice: {
      configure(options: object): void;
      getPerformanceSnapshot(): { renderLoopActive: boolean; physicalDice: number; fallbackVisuals: number };
    } }).draftrollDice;
    bridge.configure({ performanceProfile: 'battery' });
    return bridge.getPerformanceSnapshot();
  });
  expect(initial.renderLoopActive).toBe(false);
  expect(initial.physicalDice).toBe(0);
  expect(initial.fallbackVisuals).toBe(0);

  await page.waitForTimeout(500);
  const idle = await page.evaluate(() => (window as unknown as { draftrollDice: {
    getPerformanceSnapshot(): { profile: string; renderLoopActive: boolean; targetFramesPerSecond: number; pixelRatio: number };
  } }).draftrollDice.getPerformanceSnapshot());
  expect(idle.profile).toBe('battery');
  expect(idle.renderLoopActive).toBe(false);
  expect(idle.targetFramesPerSecond).toBe(30);
  expect(idle.pixelRatio).toBeLessThanOrEqual(1);
});

test('concurrent SDK presentations are serialized instead of failing with Renderer is busy', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/overlay.html');
  await page.waitForFunction(() => Boolean((window as unknown as { draftrollDice?: unknown }).draftrollDice));

  const results = await page.evaluate(async () => {
    const bridge = (window as unknown as { draftrollDice: {
      roll(request: object): Promise<{ total: number }>;
      getPerformanceSnapshot(): { queuedPresentations: number };
    } }).draftrollDice;
    const calls = [1, 2, 3, 4, 5].map((value) => bridge.roll({
      results: [value],
      kinds: ['d6'],
      settleImmediately: true,
      seed: `queue-${value}`,
    }));
    return Promise.all(calls);
  });
  expect(results).toHaveLength(5);
  expect(results.every((result) => Number.isFinite(result.total))).toBe(true);
});

test('30-dice benchmark exposes bounded frame and planning diagnostics', async ({ page }, testInfo) => {
  test.setTimeout(35_000);
  await page.goto('http://127.0.0.1:4174/overlay.html');
  await page.waitForFunction(() => Boolean((window as unknown as { draftrollDice?: unknown }).draftrollDice));

  const benchmark = await page.evaluate(async () => {
    const bridge = (window as unknown as { draftrollDice: {
      configure(options: object): void;
      roll(request: object): Promise<{ total: number }>;
      getPerformanceSnapshot(): {
        renderedFrames: number;
        averageFrameIntervalMs: number;
        averageRenderCpuMs: number;
        maximumFrameIntervalMs: number;
        usedJsHeapSize: number | null;
        jsHeapSizeLimit: number | null;
        dynamicResolutionScale: number;
        targetFramesPerSecond: number;
        targeting: null | {
          candidateAttempts: number;
          candidateSearchMs: number;
          naturalTrajectory: boolean;
          naturalMatches: number;
          assistedDiceCount: number;
          maximumAssistAngleRadians: number;
          minimumFinalAlignment: number;
          targetSuccess: boolean;
        };
      };
    } }).draftrollDice;
    bridge.configure({ performanceProfile: 'auto', adaptiveQuality: true });
    const startedAt = performance.now();
    const completion = await bridge.roll({
      results: Array.from({ length: 30 }, (_, index) => (index % 6) + 1),
      kinds: Array.from({ length: 30 }, () => 'd6'),
      seed: 'browser-30-dice-performance',
    });
    return {
      wallTimeMs: performance.now() - startedAt,
      total: completion.total,
      ...bridge.getPerformanceSnapshot(),
    };
  });

  await testInfo.attach('renderer-performance.json', {
    body: JSON.stringify(benchmark, null, 2),
    contentType: 'application/json',
  });
  expect(benchmark.wallTimeMs).toBeLessThan(25_000);
  expect(benchmark.renderedFrames).toBeGreaterThan(0);
  expect(Number.isFinite(benchmark.averageFrameIntervalMs)).toBe(true);
  expect(Number.isFinite(benchmark.averageRenderCpuMs)).toBe(true);
  expect(benchmark.targetFramesPerSecond).toBe(30);
  expect(benchmark.dynamicResolutionScale).toBeGreaterThanOrEqual(0.7);
  if (benchmark.usedJsHeapSize !== null) expect(benchmark.usedJsHeapSize).toBeGreaterThan(0);
  if (benchmark.jsHeapSizeLimit !== null) expect(benchmark.jsHeapSizeLimit).toBeGreaterThan(benchmark.usedJsHeapSize ?? 0);
  expect(benchmark.targeting).not.toBeNull();
  expect(benchmark.targeting?.targetSuccess).toBe(true);
  expect(benchmark.targeting?.candidateAttempts).toBeGreaterThan(0);
  expect(benchmark.targeting?.minimumFinalAlignment).toBeGreaterThanOrEqual(0.99);
});


test('mixed physical and fallback benchmark completes in one synchronized presentation', async ({ page }, testInfo) => {
  test.setTimeout(35_000);
  await page.goto('http://127.0.0.1:4174/overlay.html');
  await page.waitForFunction(() => Boolean((window as unknown as { draftrollDice?: unknown }).draftrollDice));

  const benchmark = await page.evaluate(async () => {
    const bridge = (window as unknown as { draftrollDice: {
      roll(request: object): Promise<{ total: number; results: Array<number | string> }>;
      getPerformanceSnapshot(): { physicalDice: number; fallbackVisuals: number; averageFrameIntervalMs: number; usedJsHeapSize: number | null };
    } }).draftrollDice;
    const startedAt = performance.now();
    const completion = await bridge.roll({
      results: [6],
      kinds: ['d6'],
      fallbacks: [{
        id: 'weather-sun', type: 'weather', kind: 'token', result: 'sun', numericValue: 1,
        title: 'Weather', label: 'Sun', theme: 'sunset', outcome: 'positive',
      }],
      visualOrder: [
        { kind: 'physical', index: 0, dieId: 'physical-d6' },
        { kind: 'fallback', index: 0, dieId: 'weather-sun' },
      ],
      seed: 'mixed-physical-fallback-performance',
    });
    return { wallTimeMs: performance.now() - startedAt, completion, ...bridge.getPerformanceSnapshot() };
  });

  await testInfo.attach('mixed-renderer-performance.json', {
    body: JSON.stringify(benchmark, null, 2),
    contentType: 'application/json',
  });
  expect(benchmark.wallTimeMs).toBeLessThan(25_000);
  expect(benchmark.completion.results).toEqual([6, 'sun']);
  expect(benchmark.physicalDice).toBe(1);
  expect(benchmark.fallbackVisuals).toBe(1);
  expect(Number.isFinite(benchmark.averageFrameIntervalMs)).toBe(true);
});

test('20d20 predetermined pool uses one continuous staged trajectory', async ({ page }, testInfo) => {
  test.setTimeout(35_000);
  await page.goto('http://127.0.0.1:4174/overlay.html');
  await page.waitForFunction(() => Boolean((window as unknown as { draftrollDice?: unknown }).draftrollDice));

  const report = await page.evaluate(async () => {
    const requested = Array.from({ length: 20 }, (_, index) => (index * 7) % 20 + 1);
    const bridge = (window as unknown as { draftrollDice: {
      roll(request: object): Promise<{ results: Array<number | string> }>;
      getLastReplay(): null | {
        step: number;
        frameCount: number;
        quantity: number;
        transforms: Float32Array;
        activationDelays?: Float32Array;
        results: number[];
      };
    } }).draftrollDice;
    const completion = await bridge.roll({
      results: requested,
      kinds: Array.from({ length: 20 }, () => 'd20'),
      seed: 'browser-20d20-continuity',
    });
    const replay = bridge.getLastReplay();
    if (!replay) throw new Error('Missing replay');
    let maximumDisplacement = 0;
    const stride = replay.quantity * 7;
    for (let frame = 1; frame < replay.frameCount; frame += 1) {
      for (let die = 0; die < replay.quantity; die += 1) {
        const previous = (frame - 1) * stride + die * 7;
        const current = frame * stride + die * 7;
        const dx = replay.transforms[current] - replay.transforms[previous];
        const dy = replay.transforms[current + 1] - replay.transforms[previous + 1];
        const dz = replay.transforms[current + 2] - replay.transforms[previous + 2];
        maximumDisplacement = Math.max(maximumDisplacement, Math.hypot(dx, dy, dz));
      }
    }
    const delays = Array.from(replay.activationDelays ?? []);
    return {
      requested,
      results: completion.results,
      replayResults: replay.results,
      step: replay.step,
      maximumDisplacement,
      minimumDelay: delays.length > 0 ? Math.min(...delays) : 0,
      maximumDelay: delays.length > 0 ? Math.max(...delays) : 0,
      delayedDice: delays.filter((delay) => delay > 0.05).length,
    };
  });

  await testInfo.attach('20d20-continuity.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(report.results).toEqual(report.requested);
  expect(report.replayResults).toEqual(report.requested);
  expect(report.step).toBeLessThanOrEqual(1 / 120 + 0.00001);
  expect(report.maximumDisplacement).toBeLessThan(0.35);
  expect(report.delayedDice).toBeGreaterThanOrEqual(8);
  expect(report.maximumDelay).toBeGreaterThan(0.2);
});
