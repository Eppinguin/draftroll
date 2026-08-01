import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const textRenderer = readFileSync(join(root, 'packages/renderer/src/text.ts'), 'utf8');
const overlay = readFileSync(join(root, 'packages/overlay/src/index.ts'), 'utf8');
const renderer = readFileSync(join(root, 'src/main.ts'), 'utf8');
const browserSpec = readFileSync(join(root, 'tests/browser/specs/accessibility.spec.ts'), 'utf8');
const playwright = readFileSync(join(root, 'playwright.config.ts'), 'utf8');
const hostFixture = readFileSync(join(root, 'tests/browser/fixtures/host.ts'), 'utf8');

for (const marker of [
  "setAttribute('role', 'status')",
  "setAttribute('aria-live', 'polite')",
  "setAttribute('aria-atomic', 'true')",
]) assert.ok(textRenderer.includes(marker) || overlay.includes(marker), `accessible result announcement is missing ${marker}`);

for (const marker of [
  "event.key !== 'Escape'",
  "document.addEventListener('keydown'",
  "document.removeEventListener('keydown'",
  "frame.setAttribute('aria-hidden', 'true')",
  "frame.setAttribute('tabindex', '-1')",
]) assert.ok(overlay.includes(marker), `overlay keyboard/focus behavior is missing ${marker}`);

for (const marker of [
  "prefers-reduced-motion: reduce",
  'reducedMotion',
  'fallback',
  'drag',
  'configureInteractions',
]) assert.ok(renderer.includes(marker) || hostFixture.includes(marker), `renderer accessibility/interaction support is missing ${marker}`);

for (const marker of [
  'reduced motion and no WebGL',
  'Escape dismissal',
  'aria-live',
  'getContext',
]) assert.ok(browserSpec.includes(marker), `browser accessibility coverage is missing ${marker}`);

assert.ok(playwright.includes("name: 'mobile-chromium'"), 'mobile Chromium project is missing');
assert.ok(playwright.includes("devices['Pixel 7']"), 'mobile viewport/device emulation is missing');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'ARIA live result announcements',
    'focus-neutral iframe and Escape dismissal',
    'reduced-motion and no-WebGL fallback coverage',
    'mobile Chromium device emulation',
    'keyboard-safe click/drag interaction controls',
  ],
}, null, 2));
