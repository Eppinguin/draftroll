import { readFile, writeFile } from 'node:fs/promises';

function replaceOrThrow(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`${label} marker missing`);
  return source.replace(before, after);
}

const tablePath = 'src/physical-table.ts';
let table = await readFile(tablePath, 'utf8');
table = replaceOrThrow(
  table,
  `  bindCanonical(id: string, die: DieInstance): void {\n    const entry = this.requireEntry(id, 'canonical', (candidate) => candidate.die === null);\n    entry.die = die;\n  }`,
  `  bindCanonicalAt(canonicalIndex: number, die: DieInstance): void {\n    const entry = this.canonicalEntriesInOrder[canonicalIndex];\n    if (!entry) {\n      throw new Error(\`Physical table canonical index is missing: \${canonicalIndex}\`);\n    }\n    entry.die = die;\n  }\n\n  bindCanonicalAtPhysicalIndex(physicalIndex: number, die: DieInstance): void {\n    const entry = this.entriesInOrder[physicalIndex];\n    if (!entry || entry.implementation !== 'canonical') {\n      throw new Error(\`Physical table canonical physical index is missing: \${physicalIndex}\`);\n    }\n    entry.die = die;\n  }`,
  'canonical binding',
);
await writeFile(tablePath, table);

const mainPath = 'src/main.ts';
let main = await readFile(mainPath, 'utf8');
main = replaceOrThrow(
  main,
  `    dice.forEach((die, index) => physicalTable.bindCanonical(canonicalEntries[index].id, die));`,
  `    dice.forEach((die, index) => physicalTable.bindCanonicalAt(index, die));`,
  'canonical runtime rebind',
);
main = replaceOrThrow(
  main,
  `      const spec = normalized.physical[physicalIndex];\n      const die = appended[index];\n      if (spec && die) physicalTable.bindCanonical(spec.id, die);`,
  `      const die = appended[index];\n      if (die) {\n        physicalTable.bindCanonicalAtPhysicalIndex(existingPhysicalCount + physicalIndex, die);\n      }`,
  'additive canonical binding',
);
await writeFile(mainPath, main);

const testsPath = 'scripts/test-visual-fallbacks.mjs';
let tests = await readFile(testsPath, 'utf8');
tests = replaceOrThrow(
  tests,
  `assert.match(physicalTable, /Physical table canonical index is missing/);`,
  `assert.match(physicalTable, /Physical table canonical index is missing/);\nassert.match(physicalTable, /bindCanonicalAt\\(canonicalIndex/);\nassert.match(physicalTable, /bindCanonicalAtPhysicalIndex\\(physicalIndex/);\nassert.doesNotMatch(engine, /physicalTable\\.bindCanonical\\(/);`,
  'physical table architecture assertions',
);
await writeFile(testsPath, tests);
