import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runTsc } from './lib/load-typescript.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-boundary-safety-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

function createRevokedProxy() {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

function callWithoutThrow(callback) {
  let value;
  assert.doesNotThrow(() => {
    value = callback();
  });
  return value;
}

function assertBoundaryFailure(decoded, label) {
  assert.equal(decoded.success, false, `${label} unexpectedly accepted hostile input`);
  assert.ok(
    decoded.error.issues.some((issue) => issue.code === 'invalid_value' && issue.path === '$'),
    `${label} did not return a structured root boundary failure`,
  );
}

try {
  await writeFile(
    configPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          rootDir: join(projectRoot, 'packages'),
          outDir,
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        },
        include: [join(projectRoot, 'packages/protocol/**/*.ts')],
      },
      null,
      2,
    ),
  );

  const compile = runTsc(['-p', configPath], { cwd: projectRoot });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const protocol = await import(pathToFileURL(join(outDir, 'protocol/src/public.js')).href);
  const decoderCases = [
    ['decodeRollVisibility', protocol.decodeRollVisibility],
    ['decodeRoomPolicy', protocol.decodeRoomPolicy],
    ['decodeRoomPolicyPatch', protocol.decodeRoomPolicyPatch],
    ['decodeParticipantIdentityInput', protocol.decodeParticipantIdentityInput],
    ['decodeRoomCapabilityTokenPayload', protocol.decodeRoomCapabilityTokenPayload],
    ['decodeRollInput', protocol.decodeRollInput],
    ['decodeRollUpdateInput', protocol.decodeRollUpdateInput],
    ['decodeClientToServerEvent', protocol.decodeClientToServerEvent],
  ];

  for (const [label, decoder] of decoderCases) {
    assertBoundaryFailure(callWithoutThrow(() => decoder(createRevokedProxy())), label);
    assertBoundaryFailure(callWithoutThrow(() => decoder({ callback: () => {} })), label);
  }

  const throwingGetter = {};
  Object.defineProperty(throwingGetter, 'type', {
    enumerable: true,
    get() {
      throw new Error('getter must not escape the protocol boundary');
    },
  });
  assertBoundaryFailure(
    callWithoutThrow(() => protocol.decodeClientToServerEvent(throwingGetter)),
    'decodeClientToServerEvent throwing getter',
  );

  assert.equal(
    callWithoutThrow(() => protocol.parseClientToServerEvent(createRevokedProxy())),
    null,
  );
  assert.equal(callWithoutThrow(() => protocol.isRollVisibility(createRevokedProxy())), false);

  const visibility = { type: 'roles', roles: ['gm'] };
  const decodedVisibility = protocol.decodeRollVisibility(visibility);
  assert.equal(decodedVisibility.success, true);
  assert.notEqual(decodedVisibility.data, visibility);
  decodedVisibility.data.roles.push('observer');
  assert.deepEqual(visibility.roles, ['gm']);

  const clientEvent = {
    type: 'participant_update',
    metadata: { nested: { value: 1 } },
  };
  const decodedClientEvent = protocol.decodeClientToServerEvent(clientEvent);
  assert.equal(decodedClientEvent.success, true);
  assert.notEqual(decodedClientEvent.data, clientEvent);
  decodedClientEvent.data.metadata.nested.value = 2;
  assert.equal(clientEvent.metadata.nested.value, 1);

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: [
          'public object-facing protocol decoders reject revoked proxies without throwing',
          'non-cloneable and throwing-getter values return structured boundary failures',
          'parse/type-guard helpers remain non-throwing',
          'successful public boundary decodes return detached data',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
