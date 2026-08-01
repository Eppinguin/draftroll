import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), 'utf8'));
}

function severityOf(value) {
  return Array.isArray(value) ? value[0] : value;
}

const [packageJson, oxlint, oxfmt, vscodeSettings, serverSource] = await Promise.all([
  readJson('package.json'),
  readJson('.oxlintrc.json'),
  readJson('.oxfmtrc.json'),
  readJson('.vscode/settings.json'),
  readFile(resolve(root, 'packages/server/src/index.ts'), 'utf8'),
]);

const expectedVersions = {
  oxlint: '1.76.0',
  'oxlint-tsgolint': '7.0.2001',
  oxfmt: '0.61.0',
};
for (const [name, version] of Object.entries(expectedVersions)) {
  assert.equal(packageJson.devDependencies?.[name], version, `${name} must use the reviewed exact version`);
}

assert.equal(packageJson.scripts?.lint, 'oxlint .');
assert.equal(packageJson.scripts?.['lint:fix'], 'oxlint --fix .');
assert.equal(packageJson.scripts?.format, 'oxfmt');
assert.equal(packageJson.scripts?.['format:check'], 'oxfmt --check');
assert.match(packageJson.scripts?.check ?? '', /check:quality/);
assert.match(packageJson.scripts?.check ?? '', /test:quality-config/);
assert.match(packageJson.scripts?.['test:release'] ?? '', /check:quality/);
assert.match(packageJson.scripts?.['test:release'] ?? '', /test:quality-config/);

for (const category of ['correctness', 'suspicious', 'perf']) {
  assert.equal(oxlint.categories?.[category], 'error', `${category} rules must fail the build`);
}
assert.equal(
  oxlint.categories?.pedantic,
  'off',
  'pedantic rules must be reviewed and enabled individually to avoid blanket false positives',
);
assert.equal(oxlint.categories?.style, 'off', 'Oxfmt is the formatting authority');
assert.equal(oxlint.categories?.restriction, undefined, 'restriction rules must be adopted individually');
assert.equal(oxlint.categories?.nursery, undefined, 'unstable nursery rules must not be enabled globally');
assert.equal(oxlint.options?.denyWarnings, true);
assert.equal(oxlint.options?.reportUnusedDisableDirectives, 'error');
assert.equal(oxlint.options?.typeAware, true);
assert.equal(oxlint.options?.typeCheck, undefined, 'experimental Oxlint type checking must not replace tsc');

for (const plugin of ['eslint', 'typescript', 'unicorn', 'oxc', 'import', 'promise', 'node', 'react', 'jsx-a11y', 'vue']) {
  assert.ok(oxlint.plugins?.includes(plugin), `missing Oxlint plugin: ${plugin}`);
}

for (const rule of [
  'eslint/eqeqeq',
  'eslint/no-debugger',
  'eslint/no-eval',
  'eslint/no-implied-eval',
  'eslint/no-new-func',
  'eslint/no-warning-comments',
  'import/export',
  'import/no-cycle',
  'import/no-duplicates',
  'import/no-self-import',
  'typescript/await-thenable',
  'typescript/no-explicit-any',
  'typescript/no-floating-promises',
  'typescript/no-misused-promises',
  'typescript/only-throw-error',
  'typescript/switch-exhaustiveness-check',
]) {
  assert.equal(severityOf(oxlint.rules?.[rule]), 'error', `${rule} must be an error`);
}

for (const pattern of ['packages/*/dist/**', 'apps/worker/worker-configuration.d.ts', 'benchmark-results/**']) {
  assert.ok(oxlint.ignorePatterns?.includes(pattern), `Oxlint must ignore generated path: ${pattern}`);
  assert.ok(oxfmt.ignorePatterns?.includes(pattern), `Oxfmt must ignore generated path: ${pattern}`);
}

assert.equal(oxfmt.printWidth, 100);
assert.equal(oxfmt.tabWidth, 2);
assert.equal(oxfmt.useTabs, false);
assert.equal(oxfmt.semi, true);
assert.equal(oxfmt.singleQuote, true);
assert.equal(oxfmt.trailingComma, 'all');
assert.equal(oxfmt.endOfLine, 'lf');
assert.ok(oxfmt.ignorePatterns?.includes('pnpm-lock.yaml'));
assert.equal(vscodeSettings['editor.defaultFormatter'], 'oxc.oxc-vscode');
assert.equal(vscodeSettings['editor.formatOnSave'], true);
assert.equal(vscodeSettings['editor.codeActionsOnSave']?.['source.fixAll.oxc'], 'always');
assert.equal(vscodeSettings['oxc.typeAware'], true);

assert.match(serverSource, /copyToArrayBuffer\(signature\)/, 'signature verification must pass an owned ArrayBuffer');
assert.doesNotMatch(
  serverSource,
  /subtle\.verify\(\s*'HMAC',\s*key,\s*signature,/m,
  'signature verification must not pass Uint8Array<ArrayBufferLike> directly',
);

console.log('Code-quality configuration and Web Crypto compatibility checks passed.');
