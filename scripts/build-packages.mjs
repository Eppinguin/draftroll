import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { runTsc } from './lib/load-typescript.mjs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = join(root, '.release-build');
const packagesRoot = join(root, 'packages');

const compile = runTsc(['-p', 'tsconfig.release.json'], { cwd: root });
if (compile.status !== 0) {
  process.stderr.write(compile.stdout);
  process.stderr.write(compile.stderr);
  process.exit(compile.status ?? 1);
}

const packageNames = new Set(await readdir(packagesRoot));

function rewriteSpecifier(specifier, fromPath) {
  if (!specifier.startsWith('.')) return specifier;

  const resolvedTarget = resolve(dirname(fromPath), specifier);
  const relativeTarget = relative(packagesRoot, resolvedTarget);
  const [packageName, sourceDirectory, ...sourceSegments] = relativeTarget.split(sep);
  if (packageNames.has(packageName) && sourceDirectory === 'src') {
    const sourceModule = sourceSegments.join('/');
    if (sourceModule === '' || sourceModule === 'index') return `@draftroll/${packageName}`;
    throw new Error(
      `Release build cannot publish cross-package source import '${specifier}'. Import from the package public entrypoint instead.`,
    );
  }

  if (extname(specifier)) return specifier;
  return `${specifier}.js`;
}

async function rewriteFile(path) {
  const source = await readFile(path, 'utf8');
  const rewritten = source.replace(
    /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\2/g,
    (match, prefix, quote, specifier) =>
      `${prefix}${quote}${rewriteSpecifier(specifier, path)}${quote}`,
  );
  await writeFile(path, rewritten);
}

async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await walk(child);
    else if (child.endsWith('.js') || child.endsWith('.d.ts')) await rewriteFile(child);
  }
}

for (const packageName of packageNames) {
  const source = join(buildRoot, packageName, 'src');
  const destination = join(packagesRoot, packageName, 'dist');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
  await walk(destination);
}

await rm(buildRoot, { recursive: true, force: true });
console.log(`Built ${packageNames.size} Draftroll packages.`);
