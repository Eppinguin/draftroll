import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, client, entry, overlay, overlayHtml, overlayCss, renderer, engine, worker, protocol] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/sdk-demo.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/character-client.ts', import.meta.url), 'utf8'),
  readFile(new URL('../packages/overlay/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../overlay.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/overlay.css', import.meta.url), 'utf8'),
  readFile(new URL('../packages/renderer/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/roll-worker.ts', import.meta.url), 'utf8'),
  readFile(new URL('../packages/protocol/src/index.ts', import.meta.url), 'utf8'),
]);

for (const id of [
  'sheet-character-name',
  'sdk-roll-name',
  'sdk-action-name',
  'sdk-expression',
  'sdk-room-connect',
  'sdk-room-roll',
  'sdk-dice-log',
  'sdk-update-roll',
  'sdk-update-log',
  'sdk-overlay-status',
  'sdk-fixed-enabled',
  'sdk-fixed-results',
  'sdk-fixed-example',
  'sdk-clear-table',
  'sdk-stage-two-rolls',
  'sdk-second-roll-name',
  'sdk-second-expression',
  'sdk-second-fixed-results',
  'sdk-second-delay',
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
}

assert.doesNotMatch(html, /id=["']scene["']/, 'test client must not own a renderer canvas');
assert.doesNotMatch(html, /src=["']\/src\/main\.ts["']/, 'test client must not load the physical engine directly');
assert.match(html, /src=["']\/src\/character-client\.ts["']/);
assert.match(entry, /initSdkDemo/);
assert.match(html, /data-formula="1d20\+7\+1d4"/);
assert.match(html, /data-formula="2d6\+1d8\+3"/);
assert.match(html, /data-formula="1d20\+1d2\+1dF\+1d9\+1d100"/);
assert.match(client, /Draftroll\.createOverlay/);
assert.match(client, /src:\s*'\/overlay\.html'/);
assert.match(client, /dismissOnPointer:\s*true/);
assert.match(client, /dismissIgnoreSelector:\s*'\[data-draftroll-preserve-table\]'/);
assert.match(client, /BundledThemeProvider/);
assert.match(client, /test-obsidian/);
assert.match(client, /themeProvider:\s*testThemeProvider/);
assert.match(client, /mode:\s*'evaluate'/);
assert.match(client, /name:\s*actorName\(\)/);
assert.match(client, /expression:\s*expressionInput\.value/);
assert.match(client, /room\.updateRoll/);
assert.match(client, /reroll-die/);
assert.match(client, /\/history/);
assert.match(client, /pendingRoomAnimations/);
assert.match(client, /draftroll\.present/);
assert.match(client, /class FixedSequenceRng/);
assert.match(client, /room\.displayRoll/);
assert.match(client, /predeterminedResults:\s*true/);
assert.match(client, /mode:\s*'concurrent'/);
assert.match(client, /Roll two people on one table|launchConfiguredRoll/);
assert.match(client, /draftroll\.clearDice/);
assert.match(overlay, /dismissOnPointer/);
assert.match(overlay, /document\.addEventListener\('pointerdown'/);
assert.match(overlay, /pointerDismissTimer/);
assert.match(overlay, /dismissIgnoreSelector/);
assert.match(overlay, /generation !== this\.presentationGeneration/);
assert.match(overlay, /type:\s*'dismiss'/);
assert.match(overlay, /type:\s*'install-theme'/);
assert.match(overlay, /prepareRuntimeTheme/);
assert.match(overlay, /dieIds:\s*options\.dieIds/);
assert.match(overlay, /visibility:\s*'hidden'/, 'overlay iframe must be visually inactive while idle');
assert.match(overlay, /this\.setIframeActive\(true\)/, 'overlay must activate immediately before a roll');
assert.match(overlay, /this\.setIframeActive\(false\)/, 'overlay must deactivate after dismissal and clear');
assert.match(overlayHtml, /#app::before/);
assert.match(overlayHtml, /background:\s*transparent\s*!important/);
assert.match(overlayCss, /content:\s*none\s*!important/);
assert.match(engine, /if \(OVERLAY_MODE\) renderer\.render\(scene, camera\)/, 'overlay must render with alpha-preserving direct rendering');
assert.match(renderer, /dismiss\?/);
assert.doesNotMatch(engine, /initSdkDemo/, 'production renderer must not bundle the test client');
assert.match(engine, /OVERLAY_MODE\s*&&\s*!hasCast/);
assert.match(engine, /async function dissolveDice/);
assert.match(engine, /\(isRolling \|\| hasCast\)/, 'completed table dice must accept a later additive throw');
assert.match(engine, /canvas\.animate/);
assert.match(renderer, /kinds:\s*physicalKinds/);
assert.match(worker, /createDiePhysicsShape\(kinds\[index\]\)/);
assert.match(protocol, /name\?: string/);
assert.match(html, /id=["']sdk-room-password["']/, 'character sheet exposes an optional room-password input');
assert.match(client, /roomPassword:\s*roomPasswordInput\.value/, 'room password is passed through the SDK options');
assert.match(client, /authorizeHttpRequest/, 'protected history uses the SDK request helper');

console.log(JSON.stringify({
  ok: true,
  client: 'character-sheet-sdk-overlay',
  rendererOwnership: 'SDK iframe overlay',
  idleDice: 'none',
  dismissal: 'next pointer click after completion',
  mixedPresets: ['1d20+7+1d4', '2d6+1d8+3', '1d20+1d2+1dF+1d9+1d100'],
  roomActions: ['roll', 'fixed-result-roll', 'staged-two-roller-test', 'reroll-all', 'reroll-die', 'update-animate', 'update-log'],
}, null, 2));

