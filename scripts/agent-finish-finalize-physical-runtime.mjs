import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(search, replacement);
}

{
  const path = 'src/main.ts';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `        physicalIndex: number;\n        implementation: 'canonical' | 'generated' | 'custom';`,
    `        physicalIndex: number;\n        sides: number;\n        implementation: 'canonical' | 'generated' | 'custom';`,
    'snapshot sides type',
  );
  source = replaceOnce(
    source,
    `        id: spec.id,\n        physicalIndex,\n        implementation: spec.definition`,
    `        id: spec.id,\n        physicalIndex,\n        sides: spec.sides,\n        implementation: spec.definition`,
    'snapshot sides value',
  );
  await writeFile(path, source);
}

{
  const path = 'tests/browser/specs/overlay.spec.ts';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `      entry.requestedOutcomeIndex >= 0 &&\n      entry.requestedOutcomeIndex < (entry.id.includes('d3') ? 3 : 5),`,
    `      entry.requestedOutcomeIndex >= 0 &&\n      entry.requestedOutcomeIndex < entry.sides,`,
    'snapshot side-bound assertion',
  );
  await writeFile(path, source);
}

console.log('final physical runtime migration cleanup applied');
