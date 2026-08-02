import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { loadTypeScript } from './lib/load-typescript.mjs';

const root = resolve(import.meta.dirname, '..');
const ts = loadTypeScript();
const workspacePackages = loadWorkspacePackages();
const sdkManifest = readJson('packages/sdk/package.json');

assert.deepEqual(sdkManifest.exports, {
  '.': {
    browser: {
      types: './dist/browser.d.ts',
      default: './dist/browser.js',
    },
    types: './dist/index.d.ts',
    default: './dist/index.js',
  },
  './browser': {
    types: './dist/browser.d.ts',
    default: './dist/browser.js',
  },
  './headless': {
    types: './dist/index.d.ts',
    default: './dist/index.js',
  },
});

const serverEntries = [
  'packages/protocol/src/index.ts',
  'packages/core/src/index.ts',
  'packages/client/src/index.ts',
  'packages/themes/src/index.ts',
  'packages/server/src/index.ts',
  'packages/sdk/src/index.ts',
  'apps/worker/src/index.ts',
];
const browserEntries = [
  'packages/renderer/src/index.ts',
  'packages/overlay/src/index.ts',
  'packages/sdk/src/browser.ts',
];

const forbiddenServerPackages = new Set(['three', 'cannon-es']);
const forbiddenServerDirectories = [
  'packages/renderer/',
  'packages/overlay/',
];
const forbiddenServerFiles = new Set([
  'src/main.ts',
  'src/dice.ts',
  'src/runtime-themes.ts',
  'src/fallback-visuals.ts',
  'src/effects.ts',
  'src/roll-worker.ts',
  'src/physics-shapes.ts',
  'src/overlay.ts',
]);
const forbiddenBrowserDirectories = ['apps/worker/'];
const forbiddenBrowserPackages = new Set([
  'node:child_process',
  'node:cluster',
  'node:dgram',
  'node:fs',
  'node:http',
  'node:https',
  'node:net',
  'node:tls',
  'node:worker_threads',
]);

const serverReports = serverEntries.map((entry) => analyzeEntry(entry, {
  forbiddenPackages: forbiddenServerPackages,
  forbiddenDirectories: forbiddenServerDirectories,
  forbiddenFiles: forbiddenServerFiles,
}));
const browserReports = browserEntries.map((entry) => analyzeEntry(entry, {
  forbiddenPackages: forbiddenBrowserPackages,
  forbiddenDirectories: forbiddenBrowserDirectories,
  forbiddenFiles: new Set(),
}));

const headlessSdk = serverReports.find((report) => report.entry === 'packages/sdk/src/index.ts');
assert(headlessSdk, 'headless SDK report is missing');
assert(!headlessSdk.files.includes('packages/sdk/src/browser.ts'), 'headless SDK reached its browser entry');
assert(!headlessSdk.files.some((file) => file.startsWith('packages/overlay/')), 'headless SDK reached overlay runtime code');
assert(!headlessSdk.files.some((file) => file.startsWith('packages/renderer/')), 'headless SDK reached renderer runtime code');
assert(headlessSdk.dynamicImports.includes('packages/overlay/src/index.ts'), 'headless SDK overlay loading must remain an explicit dynamic boundary');

const browserSdk = browserReports.find((report) => report.entry === 'packages/sdk/src/browser.ts');
assert(browserSdk, 'browser SDK report is missing');
assert(browserSdk.files.includes('packages/overlay/src/index.ts'), 'browser SDK must expose the overlay package');
assert(browserSdk.files.includes('packages/renderer/src/index.ts'), 'browser SDK must expose the renderer package');

console.log(JSON.stringify({
  ok: true,
  serverEntries: serverReports.map(summarize),
  browserEntries: browserReports.map(summarize),
  guarantees: [
    'default/headless SDK has no static overlay or renderer dependency',
    'server-safe package graphs contain no Three.js or Cannon-es imports',
    'browser entry graph contains no Worker application or Node runtime imports',
    'browser SDK still exposes renderer and overlay APIs',
  ],
}, null, 2));

function analyzeEntry(entry, policy) {
  const start = resolveSource(join(root, entry));
  assert(start, `entry does not exist: ${entry}`);
  const visited = new Set();
  const dynamicImports = new Set();
  const stack = [{ file: start, chain: [relativePath(start)] }];

  while (stack.length) {
    const current = stack.pop();
    if (!current || visited.has(current.file)) continue;
    visited.add(current.file);
    const source = readFileSync(current.file, 'utf8');
    const dependencies = parseDependencies(source, current.file);

    for (const dependency of dependencies) {
      if (!dependency.relative) {
        const workspaceResolved = resolveWorkspaceImport(dependency.specifier);
        if (workspaceResolved) {
          const target = relativePath(workspaceResolved);
          if (dependency.dynamic) {
            dynamicImports.add(target);
            continue;
          }
          assert(!policy.forbiddenFiles.has(target), `${entry} reaches forbidden file ${target} through ${[...current.chain, target].join(' -> ')}`);
          for (const directory of policy.forbiddenDirectories) {
            assert(!target.startsWith(directory), `${entry} reaches forbidden directory ${directory} through ${[...current.chain, target].join(' -> ')}`);
          }
          stack.push({ file: workspaceResolved, chain: [...current.chain, target] });
          continue;
        }
        const packageName = normalizePackageName(dependency.specifier);
        assert(!policy.forbiddenPackages.has(packageName) && !policy.forbiddenPackages.has(dependency.specifier),
          `${entry} imports forbidden package ${dependency.specifier} through ${current.chain.join(' -> ')}`);
        continue;
      }

      const resolved = resolveSource(resolve(dirname(current.file), dependency.specifier));
      assert(resolved, `${relativePath(current.file)} has unresolved import ${dependency.specifier}`);
      const target = relativePath(resolved);
      if (dependency.dynamic) {
        dynamicImports.add(target);
        continue;
      }
      assert(!policy.forbiddenFiles.has(target), `${entry} reaches forbidden file ${target} through ${[...current.chain, target].join(' -> ')}`);
      for (const directory of policy.forbiddenDirectories) {
        assert(!target.startsWith(directory), `${entry} reaches forbidden directory ${directory} through ${[...current.chain, target].join(' -> ')}`);
      }
      stack.push({ file: resolved, chain: [...current.chain, target] });
    }
  }

  return {
    entry,
    files: [...visited].map(relativePath).toSorted((left, right) => left.localeCompare(right)),
    dynamicImports: [...dynamicImports].toSorted((left, right) => left.localeCompare(right)),
  };
}

function parseDependencies(source, fileName = 'entry.ts') {
  const dependencies = [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (isTypeOnlyImport(statement.importClause)) continue;
      dependencies.push(toDependency(statement.moduleSpecifier.text, false));
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.isTypeOnly) continue;
      dependencies.push(toDependency(statement.moduleSpecifier.text, false));
    }
  }

  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        dependencies.push(toDependency(node.arguments[0].text, true));
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        dependencies.push(toDependency(node.arguments[0].text, false));
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return dependencies;
}

function isTypeOnlyImport(importClause) {
  if (!importClause) return false;
  if (importClause.isTypeOnly) return true;
  if (importClause.name) return false;
  const bindings = importClause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function toDependency(specifier, dynamic) {
  return { specifier, dynamic, relative: specifier.startsWith('.') };
}

function resolveSource(candidate) {
  const variants = extname(candidate)
    ? [candidate]
    : [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.mts`, `${candidate}.js`, join(candidate, 'index.ts')];
  return variants.find((file) => existsSync(file)) ?? null;
}

function loadWorkspacePackages() {
  const packages = new Map();
  for (const parent of ['packages', 'apps']) {
    const directory = join(root, parent);
    for (const entry of readdirSync(directory)) {
      const packageDirectory = join(directory, entry);
      if (!statSync(packageDirectory).isDirectory()) continue;
      const manifestPath = join(packageDirectory, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (typeof manifest.name === 'string') packages.set(manifest.name, { directory: packageDirectory, manifest });
    }
  }
  return packages;
}

function resolveWorkspaceImport(specifier) {
  const packageName = normalizePackageName(specifier);
  const workspacePackage = workspacePackages.get(packageName);
  if (!workspacePackage) return null;
  const subpath = specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
  const exportsField = workspacePackage.manifest.exports;
  let target = null;
  if (typeof exportsField === 'string' && subpath === '.') target = exportsField;
  else if (exportsField && typeof exportsField === 'object') {
    const selected = Object.hasOwn(exportsField, subpath) ? exportsField[subpath] : (subpath === '.' ? exportsField : null);
    if (typeof selected === 'string') target = selected;
    else if (selected && typeof selected === 'object') target = selected.default ?? selected.browser ?? selected.types ?? null;
  }
  if (!target) return null;
  return resolveSource(resolve(workspacePackage.directory, target));
}

function normalizePackageName(specifier) {
  if (specifier.startsWith('node:')) return specifier;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function relativePath(file) {
  return normalize(relative(root, file)).split(sep).join('/');
}

function summarize(report) {
  return {
    entry: report.entry,
    staticFiles: report.files.length,
    dynamicBoundaries: report.dynamicImports,
  };
}

function readJson(file) {
  return JSON.parse(readFileSync(join(root, file), 'utf8'));
}
