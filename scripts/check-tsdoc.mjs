import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from './lib/load-typescript.mjs';

const ts = loadTypeScript();
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const structureOnly = process.argv.includes('--structure-only');
const packagesRoot = join(root, 'packages');
const failures = [];
let parser = null;
let parsedComments = 0;
let coveredDeclarations = 0;
let coveredMembers = 0;

if (!structureOnly) {
  let TSDocConfiguration;
  let TSDocParser;
  let TSDocConfigFile;
  try {
    const [tsdoc, tsdocConfig] = await Promise.all([
      import('@microsoft/tsdoc'),
      import('@microsoft/tsdoc-config'),
    ]);
    ({ TSDocConfiguration, TSDocParser } = tsdoc);
    ({ TSDocConfigFile } = tsdocConfig);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      'TSDoc parser dependencies are unavailable. Run `pnpm install`, or use `pnpm check:docs:structure` only while bootstrapping.',
    );
    console.error(reason);
    process.exit(1);
  }
  const configFile = TSDocConfigFile.loadForFolder(root);
  if (configFile.fileNotFound) {
    failures.push('tsdoc.json was not found from the repository root');
  } else if (configFile.hasErrors) {
    failures.push(configFile.getErrorSummary());
  } else {
    const configuration = new TSDocConfiguration();
    configFile.configureParser(configuration);
    parser = new TSDocParser(configuration);
  }
}

function posix(path) {
  return path.split(sep).join('/');
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile() && child.endsWith('.ts') && !child.includes(`${sep}dist${sep}`))
      files.push(child);
  }
  return files;
}

function exportTypeTargets(exportsField) {
  const targets = [];
  const visit = (value) => {
    if (typeof value === 'string') return;
    if (!value || typeof value !== 'object') return;
    if (typeof value.types === 'string') targets.push(value.types);
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(exportsField);
  return targets;
}

async function entryPointSources() {
  const entries = new Set();
  for (const packageName of await readdir(packagesRoot)) {
    const packageRoot = join(packagesRoot, packageName);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    for (const target of exportTypeTargets(manifest.exports)) {
      if (!target.startsWith('./dist/') || !target.endsWith('.d.ts')) continue;
      entries.add(
        resolve(packageRoot, target.replace('./dist/', './src/').replace(/\.d\.ts$/, '.ts')),
      );
    }
  }
  return entries;
}

function isExported(node) {
  if (!ts.canHaveModifiers(node)) return false;
  return Boolean(
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function isPublicClassMember(node) {
  if (!ts.canHaveModifiers(node)) return true;
  const modifiers = ts.getModifiers(node) ?? [];
  return !modifiers.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword ||
      modifier.kind === ts.SyntaxKind.ProtectedKeyword,
  );
}

function attachedDoc(source, node, sourceFile) {
  const start = node.getStart(sourceFile, false);
  const open = source.lastIndexOf('/**', start);
  if (open < 0) return null;
  const close = source.indexOf('*/', open);
  if (close < 0 || close + 2 > start) return null;
  if (source.slice(close + 2, start).trim() !== '') return null;
  return { start: open, end: close + 2, text: source.slice(open, close + 2) };
}

function declarationName(node, sourceFile) {
  if (node.name && 'text' in node.name) return String(node.name.text);
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .map((declaration) => declaration.name.getText(sourceFile))
      .join(', ');
  }
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  return node.name?.getText(sourceFile) ?? ts.SyntaxKind[node.kind];
}

function lineAndColumn(source, offset) {
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function summaryText(comment) {
  const lines = comment
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, ''));
  const summary = [];
  for (const line of lines) {
    if (/^@[A-Za-z]/.test(line)) break;
    if (line.trim()) summary.push(line.trim());
  }
  return summary.join(' ').replace(/\s+/g, ' ').trim();
}

function validateCommentSyntax(file, source, comment) {
  if (!parser) return;
  parsedComments += 1;
  const context = parser.parseString(comment.text);
  for (const message of context.log.messages) {
    const relativeOffset = message.textRange?.pos ?? 0;
    const location = lineAndColumn(source, comment.start + relativeOffset);
    failures.push(
      `${posix(relative(root, file))}:${location.line}:${location.column} ${message.messageId}: ${message.unformattedText}`,
    );
  }
}

function validateDocumentedDeclaration(file, source, sourceFile, node, options = {}) {
  const comment = attachedDoc(source, node, sourceFile);
  const location = lineAndColumn(source, node.getStart(sourceFile, false));
  const label = `${posix(relative(root, file))}:${location.line}:${location.column} ${declarationName(node, sourceFile)}`;
  if (!comment) {
    failures.push(`${label} is public but has no TSDoc comment`);
    return;
  }
  const summary = summaryText(comment.text);
  if (!/@internal\b/.test(comment.text) && summary.length < 8)
    failures.push(`${label} needs a meaningful summary sentence`);
  if (options.releaseTag && !/@(?:public|beta|alpha|internal)\b/.test(comment.text)) {
    failures.push(`${label} needs an explicit TSDoc release tag`);
  }
}

const entryPoints = await entryPointSources();
const sourceFiles = await walk(packagesRoot);

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  const relativeFile = posix(relative(root, file));
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const comments = [...source.matchAll(/\/\*\*[\s\S]*?\*\//g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  }));
  for (const comment of comments) validateCommentSyntax(file, source, comment);

  const packageDocs = comments.filter((comment) => /@packageDocumentation\b/.test(comment.text));
  if (entryPoints.has(file)) {
    if (packageDocs.length !== 1)
      failures.push(`${relativeFile} must contain exactly one @packageDocumentation comment`);
    if (packageDocs[0]?.start !== 0)
      failures.push(`${relativeFile} must place @packageDocumentation before imports and exports`);
    if (packageDocs[0] && /@(?:public|beta|alpha|internal)\b/.test(packageDocs[0].text)) {
      failures.push(`${relativeFile} package documentation must not use a declaration release tag`);
    }
  } else if (packageDocs.length > 0) {
    failures.push(
      `${relativeFile} is not a package entry point and must not use @packageDocumentation`,
    );
  }

  if (relativeFile.endsWith('/instrumentation-internal.ts')) continue;

  for (const statement of sourceFile.statements) {
    if (
      !isExported(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement)
    )
      continue;
    validateDocumentedDeclaration(file, source, sourceFile, statement, { releaseTag: true });
    coveredDeclarations += 1;
    if (!ts.isClassDeclaration(statement)) continue;
    for (const member of statement.members) {
      if (
        !isPublicClassMember(member) ||
        ts.isSemicolonClassElement(member) ||
        ts.isPropertyDeclaration(member)
      )
        continue;
      validateDocumentedDeclaration(file, source, sourceFile, member);
      coveredMembers += 1;
    }
  }
}

if (failures.length > 0) {
  console.error(
    `TSDoc validation failed with ${failures.length} issue${failures.length === 1 ? '' : 's'}:`,
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const parserSummary = structureOnly
  ? 'parser-free structural mode'
  : `${parsedComments} parsed comments`;
console.log(
  `TSDoc validation passed for ${sourceFiles.length} source files, ${coveredDeclarations} exported declarations, and ${coveredMembers} public class members (${parserSummary}).`,
);
