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
    `function resetPhysicalTable(specs: DraftrollPhysicalVisual[]): void {\n  activePhysicalSpecs = specs;\n  physicalTable.reset(specs);\n  rebindPhysicalTableRuntime();\n}`,
    `function physicalTableSpec(spec: DraftrollPhysicalVisual) {\n  return {\n    id: spec.id,\n    implementation: usesCanonicalPhysicalImplementation(spec)\n      ? ('canonical' as const)\n      : ('visual' as const),\n  };\n}\n\nfunction resetPhysicalTable(specs: DraftrollPhysicalVisual[]): void {\n  activePhysicalSpecs = specs;\n  physicalTable.reset(specs.map(physicalTableSpec));\n  rebindPhysicalTableRuntime();\n}`,
    'physical table implementation derivation',
  );
  source = replaceOnce(
    source,
    `  physicalTable.append(normalized.physical);`,
    `  physicalTable.append(normalized.physical.map(physicalTableSpec));`,
    'additive physical table implementation derivation',
  );
  await writeFile(path, source);
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
  const path = 'scripts/test-natural-target-physics.mjs';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `assert.match(main, /targetingMethod: 'shape-symmetry'/);`,
    `assert.match(main, /targetingMethod: activeTargeting\\.length === 1/);\nassert.match(main, /targetingCounts/);\nassert.match(main, /'symmetry', 'relabel', 'fixed'/);\nassert.doesNotMatch(main, /targetingMethod: 'shape-symmetry'/);`,
    'targeting diagnostics strategy regression',
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
