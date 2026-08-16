import { readFile, writeFile } from 'node:fs/promises';

const path = 'scripts/agent-finalize-physical-runtime.mjs';
let source = await readFile(path, 'utf8');
const oldBlock = `  source = replaceOnce(
    source,
    \`    const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);\`,
    \`    const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);\`,
    'worker canonical registry lookup',
  );`;
const newBlock = `  source = replaceAllExact(
    source,
    \`    const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);\`,
    \`    const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);\`,
    2,
    'physical canonical registry lookup',
  );`;
const count = source.split(oldBlock).length - 1;
if (count !== 1) throw new Error(`canonical registry migration block expected once, found ${count}`);
source = source.replace(oldBlock, newBlock);
await writeFile(path, source);
console.log('final physical migration guards normalized');
