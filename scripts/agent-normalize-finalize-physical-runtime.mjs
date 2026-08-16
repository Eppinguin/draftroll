import { readFile, writeFile } from 'node:fs/promises';

const path = 'scripts/agent-finalize-physical-runtime.mjs';
let source = await readFile(path, 'utf8');

const canonicalLookupOld = `  source = replaceOnce(
    source,
    \`    const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);\`,
    \`    const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);\`,
    'worker canonical registry lookup',
  );`;
const canonicalLookupNew = `  source = replaceAllExact(
    source,
    \`    const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);\`,
    \`    const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);\`,
    2,
    'physical canonical registry lookup',
  );`;
let count = source.split(canonicalLookupOld).length - 1;
if (count !== 1) throw new Error(`canonical registry migration block expected once, found ${count}`);
source = source.replace(canonicalLookupOld, canonicalLookupNew);

const physicalIndexOld = `  source = replaceAllExact(
    source,
    \`const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;\`,
    \`const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);\`,
    4,
    'canonical physical index registry lookup',
  );`;
const physicalIndexNew = `  source = replaceAllExact(
    source,
    \`const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;\`,
    \`const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);\`,
    6,
    'canonical physical index registry lookup',
  );`;
count = source.split(physicalIndexOld).length - 1;
if (count !== 1) throw new Error(`physical index migration block expected once, found ${count}`);
source = source.replace(physicalIndexOld, physicalIndexNew);

const playbackBlock = `  source = replaceOnce(
    source,
    \`  dice.forEach((die, canonicalIndex) => {\\n    const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;\`,
    \`  dice.forEach((die, canonicalIndex) => {\\n    const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);\`,
    'playback canonical registry lookup',
  );\n`;
count = source.split(playbackBlock).length - 1;
if (count !== 1) throw new Error(`redundant playback migration block expected once, found ${count}`);
source = source.replace(playbackBlock, '');

const replayBlockOld = `  source = replaceOnce(
    source,
    \`    activePhysicalSpecs = physical;\\n    activeCanonicalPhysicalIndexes = split.canonicalIndexes;\\n    activeGenericPhysicalIndexes = split.genericIndexes;\`,
    \`    resetPhysicalTable(physical);\`,
    'replay physical registry reset',
  );`;
const replayBlockNew = `  source = replaceOnce(
    source,
    \`  activePhysicalSpecs = physical;\\n  activeCanonicalPhysicalIndexes = split.canonicalIndexes;\\n  activeGenericPhysicalIndexes = split.genericIndexes;\`,
    \`  resetPhysicalTable(physical);\`,
    'replay physical registry reset',
  );`;
count = source.split(replayBlockOld).length - 1;
if (count !== 1) throw new Error(`replay migration block expected once, found ${count}`);
source = source.replace(replayBlockOld, replayBlockNew);

const effectBlock = `  source = replaceAllExact(
    source,
    \`const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);\`,
    \`const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);\`,
    1,
    'remaining effect canonical registry lookup',
  );\n`;
count = source.split(effectBlock).length - 1;
if (count !== 1) throw new Error(`redundant effect migration block expected once, found ${count}`);
source = source.replace(effectBlock, '');

const guardOld = `  if (/activeCanonicalPhysicalIndexes|activeGenericPhysicalIndexes/.test(source)) {
    throw new Error('main.ts still contains parallel physical index arrays');
  }`;
const guardNew = `  if (/activeCanonicalPhysicalIndexes|activeGenericPhysicalIndexes/.test(source)) {
    const leftovers = source
      .split('\\n')
      .map((line, index) => ({ line: index + 1, text: line }))
      .filter(({ text }) => /activeCanonicalPhysicalIndexes|activeGenericPhysicalIndexes/.test(text));
    throw new Error(\`main.ts still contains parallel physical index arrays: \${JSON.stringify(leftovers)}\`);
  }`;
count = source.split(guardOld).length - 1;
if (count !== 1) throw new Error(`physical index guard expected once, found ${count}`);
source = source.replace(guardOld, guardNew);

await writeFile(path, source);
console.log('final physical migration guards normalized');
