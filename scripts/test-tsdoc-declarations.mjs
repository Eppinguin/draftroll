import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = join(root, 'packages');
const failures = [];
let checked = 0;

function collectTypeTargets(value, targets = new Set()) {
  if (!value || typeof value !== 'object') return targets;
  if (typeof value.types === 'string') targets.add(value.types);
  for (const nested of Object.values(value)) collectTypeTargets(nested, targets);
  return targets;
}

for (const packageName of await readdir(packagesRoot)) {
  const packageRoot = join(packagesRoot, packageName);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  const targets = collectTypeTargets(manifest.exports);
  for (const target of targets) {
    const file = resolve(packageRoot, target);
    try {
      await access(file);
    } catch {
      failures.push(`${manifest.name}: missing declaration entry point ${target}`);
      continue;
    }
    const source = await readFile(file, 'utf8');
    checked += 1;
    if (!source.startsWith('/**') || !source.slice(0, 1_000).includes('@packageDocumentation')) {
      failures.push(`${manifest.name}: ${target} does not preserve entry-point @packageDocumentation`);
    }
    if (/from ['"](?:\.\.\/)+[^'"]+\/src(?:\/|['"])/.test(source)) {
      failures.push(`${manifest.name}: ${target} contains a source-tree import`);
    }
  }
}

const requiredHoverText = [
  ['packages/core/dist/index.d.ts', 'Parses, validates, compiles, evaluates, updates, and rerolls dice expressions.'],
  ['packages/sdk/dist/index.d.ts', 'High-level headless SDK for rolling, revising, formatting, and optionally presenting dice.'],
  ['packages/renderer/dist/index.d.ts', 'Presents normalized rolls using deterministic physical trajectories and visual fallbacks.'],
];

for (const [relativeFile, text] of requiredHoverText) {
  const declaration = await readFile(join(root, relativeFile), 'utf8');
  if (!declaration.includes(text)) failures.push(`${relativeFile} lost required public API documentation`);
}

if (failures.length > 0) {
  console.error(`Declaration TSDoc validation failed with ${failures.length} issue${failures.length === 1 ? '' : 's'}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Declaration TSDoc validation passed for ${checked} package entry points.`);
