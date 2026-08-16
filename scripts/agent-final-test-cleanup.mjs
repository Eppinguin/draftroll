import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(search, replacement);
}

{
  const path = 'scripts/test-late-events.mjs';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `/genericPhysicalVisuals\\.forEach\\(\\(visual\\) => visual\\.update\\(time, scale\\.x, scale\\.z\\)\\)/,`,
    `/physicalTable\\.forEachVisual\\(\\(visual\\) => visual\\.update\\(time, scale\\.x, scale\\.z\\)\\)/,`,
    'late-event physical playback assertion',
  );
  await writeFile(path, source);
}

{
  const path = 'scripts/test-mixed-renderer.mjs';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `    setDie() {},\n    setQuantity() {},\n    setTheme() {},\n`,
    ``,
    'removed mutable bridge mock methods',
  );
  await writeFile(path, source);
}

console.log('final physical runtime source assertions cleaned');
