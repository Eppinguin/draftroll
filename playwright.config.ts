import { defineConfig, devices } from '@playwright/test';

const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: './tests/browser/specs',
  outputDir: './test-results/browser-artifacts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      name: 'host-fixture',
      command: 'node tests/browser/serve-fixtures.mjs --port 4173 --role host',
      url: 'http://127.0.0.1:4173/health',
      reuseExistingServer,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 1_000 },
    },
    {
      name: 'overlay-fixture',
      command: 'node tests/browser/serve-fixtures.mjs --port 4174 --role overlay',
      url: 'http://127.0.0.1:4174/health',
      reuseExistingServer,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 1_000 },
    },
    {
      name: 'room-worker',
      command: 'pnpm worker:reset && pnpm worker:dev',
      url: 'http://127.0.0.1:8787/',
      reuseExistingServer,
      timeout: 90_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2_000 },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
        },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
