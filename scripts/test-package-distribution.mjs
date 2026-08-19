import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(new URL('..', import.meta.url).pathname);
const temp = await mkdtemp(join(tmpdir(), 'draftroll-pack-test-'));
const stageDir = join(temp, 'stage');
const packDir = join(temp, 'packs');
const appDir = join(temp, 'app');
const packages = [
  'errors',
  'protocol',
  'core',
  'themes',
  'renderer',
  'overlay',
  'client',
  'sdk',
  'server',
  'react',
  'vue',
  'svelte',
];

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function rewriteWorkspaceDependencies(manifest, versions) {
  const rewritten = structuredClone(manifest);
  for (const section of ['dependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(rewritten[section] ?? {})) {
      if (!name.startsWith('@draftroll/')) continue;
      assert.match(
        range,
        /^workspace:/,
        `${manifest.name} must use the workspace protocol for ${name}`,
      );
      const version = versions.get(name);
      assert.ok(version, `Unknown workspace dependency ${name}`);
      rewritten[section][name] = version;
    }
  }
  return rewritten;
}

try {
  run('node', ['scripts/build-packages.mjs']);
  await mkdir(stageDir, { recursive: true });
  await mkdir(packDir, { recursive: true });

  const manifests = new Map();
  const versions = new Map();
  for (const name of packages) {
    const manifest = JSON.parse(
      await readFile(join(root, 'packages', name, 'package.json'), 'utf8'),
    );
    manifests.set(name, manifest);
    versions.set(manifest.name, manifest.version);
  }

  const tarballs = [];
  for (const name of packages) {
    const source = join(root, 'packages', name);
    const staged = join(stageDir, name);
    await cp(source, staged, { recursive: true });

    // Source manifests deliberately retain workspace:* so local installs never
    // query a registry for unpublished Draftroll packages. A release artifact
    // needs concrete versions, which pnpm pack/publish normally writes for us;
    // this isolated staging copy models that release-only transformation.
    const releaseManifest = rewriteWorkspaceDependencies(manifests.get(name), versions);
    await writeFile(join(staged, 'package.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`);

    const output = run('npm', [
      'pack',
      staged,
      '--pack-destination',
      packDir,
      '--json',
      '--ignore-scripts',
    ]);
    const starts = [...output.matchAll(/\[\s*\{\s*"id"/g)];
    const jsonStart = starts.at(-1)?.index;
    if (jsonStart === undefined) throw new Error(`npm pack did not return JSON for ${name}`);
    const parsed = JSON.parse(output.slice(jsonStart));
    tarballs.push(join(packDir, parsed[0].filename));
  }

  await mkdir(appDir, { recursive: true });
  const appDependencies = Object.fromEntries(
    tarballs.map((tarball) => {
      const filename = tarball.split('/').at(-1);
      const packageName = filename
        .replace(/^draftroll-/, '@draftroll/')
        .replace(/-0\.1\.0\.tgz$/, '');
      return [packageName, `file:${tarball}`];
    }),
  );
  await writeFile(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'draftroll-pack-smoke',
        private: true,
        type: 'module',
        dependencies: appDependencies,
      },
      null,
      2,
    )}\n`,
  );
  run(
    'npm',
    ['install', '--offline', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'],
    appDir,
  );

  await writeFile(
    join(appDir, 'smoke.mjs'),
    `
    import assert from 'node:assert/strict';
    import * as errors from '@draftroll/errors';
    import * as protocol from '@draftroll/protocol';
    import * as core from '@draftroll/core';
    import * as themes from '@draftroll/themes';
    import * as renderer from '@draftroll/renderer';
    import * as overlay from '@draftroll/overlay';
    import * as client from '@draftroll/client';
    import * as rootSdk from '@draftroll/sdk';
    import * as headless from '@draftroll/sdk/headless';
    import * as browser from '@draftroll/sdk/browser';
    import * as deck from '@draftroll/sdk/deck';
    import * as cards from '@draftroll/sdk/cards';
    import * as server from '@draftroll/server';
    import * as react from '@draftroll/react';
    import * as vue from '@draftroll/vue';
    import * as svelte from '@draftroll/svelte';

    assert.equal(typeof errors.DraftrollError, 'function');
    assert.equal(typeof protocol.DRAFTROLL_PROTOCOL_VERSION, 'number');
    assert.equal(typeof protocol.decodeClientToServerEvent, 'function');
    assert.equal(new core.DiceEngine().roll('1d1').total, 1);
    assert.equal(typeof themes.decodeDiceTheme, 'function');
    assert.equal(typeof renderer.DraftrollTextRenderer, 'function');
    assert.equal(typeof overlay.DraftrollOverlayRenderer, 'function');
    assert.equal(typeof client.DiceRoom, 'function');
    assert.equal(new headless.DiceEngine().roll('1d1').total, 1);
    assert.equal(typeof rootSdk.DraftrollSession, 'function');
    assert.equal(typeof browser.DraftrollTextRenderer, 'function');
    assert.equal(typeof deck.DraftrollDeck, 'function');
    assert.equal(typeof deck.createDeck, 'function');
    assert.equal(typeof cards.standardPlayingCards, 'function');
    assert.equal(typeof cards.createStandardDeck, 'function');
    const packedDeck = cards.createStandardDeck('packed-standard', { shuffle: false });
    assert.equal(packedDeck.draw().cards[0].result, 'A♠');
    assert.equal(typeof server.createRoomCapabilityToken, 'function');
    assert.equal(typeof react.createDraftrollReactBindings, 'function');
    assert.equal(typeof vue.useDraftroll, 'function');
    assert.equal(typeof svelte.createDraftrollStore, 'function');

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let hostileResult;
    assert.doesNotThrow(() => {
      hostileResult = protocol.decodeClientToServerEvent(proxy);
    });
    assert.equal(hostileResult.success, false);
    assert.ok(hostileResult.error.issues.some((issue) => issue.code === 'invalid_value'));

    const visibility = { type: 'roles', roles: ['gm'] };
    const decodedVisibility = protocol.decodeRollVisibility(visibility);
    assert.equal(decodedVisibility.success, true);
    assert.notEqual(decodedVisibility.data, visibility);
    decodedVisibility.data.roles.push('observer');
    assert.deepEqual(visibility.roles, ['gm']);
  `,
  );
  run('node', ['smoke.mjs'], appDir);

  const manifest = JSON.parse(
    await readFile(join(appDir, 'node_modules/@draftroll/sdk/package.json'), 'utf8'),
  );
  assert.equal(manifest.exports['.'].types, './dist/index.d.ts');
  assert.equal(manifest.exports['.'].default, './dist/index.js');
  assert.equal(manifest.exports['.'].browser.types, './dist/browser.d.ts');
  assert.equal(manifest.exports['.'].browser.default, './dist/browser.js');
  assert.equal(manifest.exports['./deck'].types, './dist/deck.d.ts');
  assert.equal(manifest.exports['./deck'].default, './dist/deck.js');
  assert.equal(manifest.exports['./cards'].types, './dist/cards.d.ts');
  assert.equal(manifest.exports['./cards'].default, './dist/cards.js');
  assert.equal(manifest.dependencies['@draftroll/core'], '0.1.0');

  const packedCoreEvaluator = await readFile(
    join(appDir, 'node_modules/@draftroll/core/dist/evaluator.js'),
    'utf8',
  );
  assert.doesNotMatch(
    packedCoreEvaluator,
    /\.\.\/\.\.\/protocol\/src\//,
    'packed core must not retain source-tree imports into protocol',
  );

  console.log('Package distribution smoke test passed.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
