import { readFile, writeFile } from 'node:fs/promises';

function replaceOrThrow(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`${label} marker missing`);
  return source.replace(before, after);
}

const tablePath = 'src/physical-table.ts';
let table = await readFile(tablePath, 'utf8');

table = replaceOrThrow(
  table,
  `  private readonly entriesById = new Map<string, PhysicalTableEntry>();`,
  `  private readonly entriesById = new Map<string, PhysicalTableEntry[]>();`,
  'entriesById declaration',
);

table = replaceOrThrow(
  table,
  `  reset(specs: readonly PhysicalTableSpec[], preserveBindings = false): void {
    const previousEntries = preserveBindings ? new Map(this.entriesById) : null;
    this.entriesById.clear();
    this.entriesInOrder.length = 0;
    this.canonicalEntriesInOrder.length = 0;
    this.visualEntriesInOrder.length = 0;
    this.append(specs);
    if (!previousEntries) return;
    for (const entry of this.entriesInOrder) {
      const previous = previousEntries.get(entry.id);
      if (!previous || previous.implementation !== entry.implementation) continue;
      entry.die = previous.die;
      entry.visual = previous.visual;
    }
  }`,
  `  reset(specs: readonly PhysicalTableSpec[], preserveBindings = false): void {
    const previousEntries = preserveBindings ? this.entriesInOrder.slice() : null;
    this.entriesById.clear();
    this.entriesInOrder.length = 0;
    this.canonicalEntriesInOrder.length = 0;
    this.visualEntriesInOrder.length = 0;
    this.append(specs);
    if (!previousEntries) return;
    for (let index = 0; index < this.entriesInOrder.length; index += 1) {
      const entry = this.entriesInOrder[index];
      const previous = previousEntries[index];
      if (
        !previous ||
        previous.id !== entry.id ||
        previous.implementation !== entry.implementation
      ) {
        continue;
      }
      entry.die = previous.die;
      entry.visual = previous.visual;
    }
  }`,
  'reset implementation',
);

table = replaceOrThrow(
  table,
  `    for (const spec of specs) {
      if (this.entriesById.has(spec.id)) {
        throw new Error(\`Physical table already contains die id: \${spec.id}\`);
      }
      const entry: PhysicalTableEntry = {`,
  `    for (const spec of specs) {
      const entry: PhysicalTableEntry = {`,
  'duplicate id guard',
);

table = replaceOrThrow(
  table,
  `      this.entriesById.set(entry.id, entry);`,
  `      const matchingEntries = this.entriesById.get(entry.id);
      if (matchingEntries) matchingEntries.push(entry);
      else this.entriesById.set(entry.id, [entry]);`,
  'entriesById append',
);

table = replaceOrThrow(
  table,
  `  entryById(id: string): PhysicalTableEntry | undefined {
    return this.entriesById.get(id);
  }

  physicalIndexForId(id: string): number | null {
    return this.entriesById.get(id)?.physicalIndex ?? null;
  }`,
  `  entryById(id: string): PhysicalTableEntry | undefined {
    return this.entriesById.get(id)?.[0];
  }

  physicalIndexForId(id: string): number | null {
    return this.entriesById.get(id)?.[0]?.physicalIndex ?? null;
  }`,
  'id lookup helpers',
);

table = replaceOrThrow(
  table,
  `  bindCanonical(id: string, die: DieInstance): void {
    const entry = this.requireEntry(id, 'canonical');
    entry.die = die;
  }

  bindVisual(id: string, visual: PhysicalDieVisualInstance): void {
    const entry = this.requireEntry(id, 'visual');
    entry.visual = visual;
  }

  unbindVisual(id: string): void {
    const entry = this.entriesById.get(id);
    if (entry?.implementation === 'visual') entry.visual = null;
  }

  unbindCanonical(id: string): void {
    const entry = this.entriesById.get(id);
    if (entry?.implementation === 'canonical') entry.die = null;
  }`,
  `  bindCanonical(id: string, die: DieInstance): void {
    const entry = this.requireEntry(id, 'canonical', (candidate) => candidate.die === null);
    entry.die = die;
  }

  bindVisual(id: string, visual: PhysicalDieVisualInstance): void {
    const entry = this.requireEntry(id, 'visual', (candidate) => candidate.visual === null);
    entry.visual = visual;
  }

  unbindVisual(id: string, visual?: PhysicalDieVisualInstance): void {
    const entries = this.entriesById.get(id);
    const entry = visual
      ? entries?.find((candidate) => candidate.implementation === 'visual' && candidate.visual === visual)
      : entries?.find((candidate) => candidate.implementation === 'visual' && candidate.visual !== null);
    if (entry) entry.visual = null;
  }

  unbindCanonical(id: string, die?: DieInstance): void {
    const entries = this.entriesById.get(id);
    const entry = die
      ? entries?.find((candidate) => candidate.implementation === 'canonical' && candidate.die === die)
      : entries?.find((candidate) => candidate.implementation === 'canonical' && candidate.die !== null);
    if (entry) entry.die = null;
  }`,
  'binding methods',
);

table = replaceOrThrow(
  table,
  `  private requireEntry(
    id: string,
    implementation: PhysicalTableImplementation,
  ): PhysicalTableEntry {
    const entry = this.entriesById.get(id);
    if (!entry || entry.implementation !== implementation) {
      throw new Error(\`Physical table \${implementation} entry is missing: \${id}\`);
    }
    return entry;
  }`,
  `  private requireEntry(
    id: string,
    implementation: PhysicalTableImplementation,
    predicate?: (entry: PhysicalTableEntry) => boolean,
  ): PhysicalTableEntry {
    const entry = this.entriesById
      .get(id)
      ?.find(
        (candidate) =>
          candidate.implementation === implementation && (!predicate || predicate(candidate)),
      );
    if (!entry) {
      throw new Error(\`Physical table \${implementation} entry is missing: \${id}\`);
    }
    return entry;
  }`,
  'requireEntry',
);

await writeFile(tablePath, table);

const mainPath = 'src/main.ts';
let main = await readFile(mainPath, 'utf8');
main = replaceOrThrow(
  main,
  `  for (const visual of appended) physicalTable.unbindVisual(visual.spec.id);`,
  `  for (const visual of appended) physicalTable.unbindVisual(visual.spec.id, visual);`,
  'appended visual rollback unbind',
);
await writeFile(mainPath, main);

const staticTestPath = 'scripts/test-visual-fallbacks.mjs';
let staticTest = await readFile(staticTestPath, 'utf8');
staticTest = replaceOrThrow(
  staticTest,
  `assert.match(physicalTable, /preserveBindings/);`,
  `assert.match(physicalTable, /preserveBindings/);
assert.match(physicalTable, /Map<string, PhysicalTableEntry\\[]>/);
assert.doesNotMatch(physicalTable, /already contains die id/);
assert.match(physicalTable, /candidate\\.visual === visual/);
assert.match(engine, /unbindVisual\\(visual\\.spec\\.id, visual\\)/);`,
  'physical table static assertions',
);
await writeFile(staticTestPath, staticTest);

const browserPath = 'tests/browser/specs/overlay.spec.ts';
let browser = await readFile(browserPath, 'utf8');
const browserMarker = `test('generated physical dice receive heavy and low-gravity planner presets', async ({ page }) => {`;
if (!browser.includes(browserMarker)) throw new Error('browser insertion marker missing');
const duplicateIdTest = `test('additive physical table accepts repeated logical die ids across rolls', async ({ page }) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');

  await frame.locator('body').evaluate(() =>
    window.draftrollDice.roll({
      physical: [
        {
          id: 'die_1',
          type: 'd6',
          sides: 6,
          outcomeIndex: 1,
          result: 2,
          numericValue: 2,
          canonicalKind: 'd6',
          title: 'd6',
          label: '2',
          theme: 'dragon',
          outcome: 'neutral',
        },
      ],
      visualOrder: [{ kind: 'physical', index: 0, dieId: 'die_1' }],
      seed: 'duplicate-id-first',
      animationDurationMs: 720,
    }),
  );

  await frame.locator('body').evaluate(() =>
    window.draftrollDice.roll({
      physical: [
        {
          id: 'die_1',
          type: 'd9',
          sides: 9,
          outcomeIndex: 4,
          result: 5,
          numericValue: 5,
          title: 'd9',
          label: '5',
          theme: 'dragon',
          outcome: 'neutral',
        },
      ],
      visualOrder: [{ kind: 'physical', index: 0, dieId: 'die_1' }],
      seed: 'duplicate-id-second',
      animationDurationMs: 720,
      tableMode: 'add',
    }),
  );

  const snapshot = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(snapshot).toHaveLength(2);
  expect(snapshot.map((entry) => entry.id)).toEqual(['die_1', 'die_1']);
  expect(snapshot.map((entry) => entry.implementation)).toEqual(['canonical', 'generated']);
  expect(snapshot.map((entry) => entry.result)).toEqual([2, 5]);
  expect(snapshot.every((entry) => entry.visible)).toBe(true);
});

`;
browser = browser.replace(browserMarker, duplicateIdTest + browserMarker);
await writeFile(browserPath, browser);

const docsPath = 'docs/ARCHITECTURE.md';
let docs = await readFile(docsPath, 'utf8');
const docsLine = `- one physical-table registry as the sole owner of live canonical/generated/custom runtime bindings\n`;
docs = replaceOrThrow(
  docs,
  docsLine,
  `${docsLine}- logical die IDs are roll-scoped and may repeat across additive/concurrent table groups; physical table order is the runtime identity for distinct live entries\n`,
  'architecture physical table line',
);
await writeFile(docsPath, docs);
