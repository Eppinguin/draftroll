import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(search, replacement);
}

function replaceCount(source, search, replacement, expected, label) {
  const count = source.split(search).length - 1;
  if (count !== expected) throw new Error(`${label}: expected ${expected} matches, found ${count}`);
  return source.split(search).join(replacement);
}

function replaceFrom(source, start, replacement, label) {
  const index = source.indexOf(start);
  if (index < 0) throw new Error(`${label}: start marker not found`);
  if (source.indexOf(start, index + start.length) >= 0) {
    throw new Error(`${label}: start marker is not unique`);
  }
  return source.slice(0, index) + replacement;
}

async function transform(path, callback) {
  const source = await readFile(path, 'utf8');
  const updated = callback(source);
  if (updated === source) throw new Error(`${path}: transform made no changes`);
  await writeFile(path, updated);
}

await transform('src/physical-table.ts', (source) => {
  source = replaceOnce(
    source,
    `  reset(specs: readonly PhysicalTableSpec[]): void {\n    this.entriesById.clear();\n    this.entriesInOrder.length = 0;\n    this.canonicalEntriesInOrder.length = 0;\n    this.visualEntriesInOrder.length = 0;\n    this.append(specs);\n  }`,
    `  reset(specs: readonly PhysicalTableSpec[], preserveBindings = false): void {\n    const previousEntries = preserveBindings ? new Map(this.entriesById) : null;\n    this.entriesById.clear();\n    this.entriesInOrder.length = 0;\n    this.canonicalEntriesInOrder.length = 0;\n    this.visualEntriesInOrder.length = 0;\n    this.append(specs);\n    if (!previousEntries) return;\n    for (const entry of this.entriesInOrder) {\n      const previous = previousEntries.get(entry.id);\n      if (!previous || previous.implementation !== entry.implementation) continue;\n      entry.die = previous.die;\n      entry.visual = previous.visual;\n    }\n  }`,
    'registry reset binding ownership',
  );

  source = replaceOnce(
    source,
    `  visualEntries(): readonly PhysicalTableEntry[] {\n    return this.visualEntriesInOrder;\n  }\n\n  boundEntries(): PhysicalTableEntry[] {`,
    `  visualEntries(): readonly PhysicalTableEntry[] {\n    return this.visualEntriesInOrder;\n  }\n\n  visualInstances(): PhysicalDieVisualInstance[] {\n    return this.visualEntriesInOrder.map((entry) => {\n      if (!entry.visual) {\n        throw new Error(\`Physical table visual entry is unbound: \${entry.id}\`);\n      }\n      return entry.visual;\n    });\n  }\n\n  boundEntries(): PhysicalTableEntry[] {`,
    'registry visual instance access',
  );

  source = replaceOnce(
    source,
    `  physicalIndexForCanonical(canonicalIndex: number): number {\n    return this.canonicalEntriesInOrder[canonicalIndex]?.physicalIndex ?? canonicalIndex;\n  }`,
    `  physicalIndexForCanonical(canonicalIndex: number): number {\n    const entry = this.canonicalEntriesInOrder[canonicalIndex];\n    if (!entry) {\n      throw new Error(\`Physical table canonical index is missing: \${canonicalIndex}\`);\n    }\n    return entry.physicalIndex;\n  }`,
    'strict canonical index lookup',
  );
  return source;
});

await transform('src/physical-die-visuals.ts', (source) => {
  source = replaceOnce(
    source,
    `const activePhysicalDice = new Map<string, PhysicalDieVisualInstance>();\nconst pendingPhysicalDice = new Set<string>();\n\n`,
    '',
    'remove duplicate visual registries',
  );
  source = replaceOnce(
    source,
    `    if (activePhysicalDice.has(spec.id)) {\n      throw new Error(\`Physical die id is already active: \${spec.id}\`);\n    }\n`,
    '',
    'remove duplicate visual id registry check',
  );
  source = replaceOnce(
    source,
    `    this.inner = this.mesh.visualRoot;\n    activePhysicalDice.set(spec.id, this);\n`,
    `    this.inner = this.mesh.visualRoot;\n`,
    'remove duplicate visual registry binding',
  );
  source = replaceOnce(
    source,
    `    this.needsPlanning = true;\n    pendingPhysicalDice.add(this.spec.id);\n`,
    `    this.needsPlanning = true;\n`,
    'derive pending state from instance',
  );
  source = replaceCount(
    source,
    `    pendingPhysicalDice.delete(this.spec.id);\n`,
    '',
    2,
    'remove duplicate pending registry cleanup',
  );
  source = replaceOnce(
    source,
    `  dispose(): void {\n    if (activePhysicalDice.get(this.spec.id) === this) {\n      activePhysicalDice.delete(this.spec.id);\n    }\n    this.mesh.dispose();\n  }`,
    `  dispose(): void {\n    this.mesh.dispose();\n  }`,
    'instance-only visual disposal',
  );

  source = replaceFrom(
    source,
    `function configuredPhysicalDice(): PhysicalDieVisualInstance[] {`,
    `function configuredPhysicalDice(\n  entries: readonly PhysicalDieVisualInstance[],\n): PhysicalDieVisualInstance[] {\n  return entries.filter((entry) => entry.isPrepared);\n}\n\nexport function getPendingPhysicalLaunchParticipants(\n  entries: readonly PhysicalDieVisualInstance[],\n): PendingPhysicalLaunchParticipant[] {\n  return entries\n    .filter((entry) => entry.isPrepared && entry.requiresPlanning)\n    .map((entry) => entry.launchParticipant);\n}\n\nexport function assignPendingPhysicalLaunchStates(\n  entries: readonly PhysicalDieVisualInstance[],\n  assignments: readonly PendingPhysicalLaunchAssignment[],\n): void {\n  const entriesById = new Map(entries.map((entry) => [entry.spec.id, entry] as const));\n  for (const assignment of assignments) {\n    const entry = entriesById.get(assignment.id);\n    if (entry?.isPrepared && entry.requiresPlanning) entry.assignLaunchState(assignment.state);\n  }\n}\n\nexport function hasConfiguredPhysicalVisuals(\n  entries: readonly PhysicalDieVisualInstance[],\n): boolean {\n  return entries.some((entry) => entry.isPrepared);\n}\n\nexport function hasPendingPhysicalVisuals(entries: readonly PhysicalDieVisualInstance[]): boolean {\n  return entries.some((entry) => entry.isPrepared && entry.requiresPlanning);\n}\n\nexport function getPhysicalVisualPlanEntries(\n  entries: readonly PhysicalDieVisualInstance[],\n): PhysicalVisualPlanEntry[] {\n  return configuredPhysicalDice(entries).map((entry) => ({\n    id: entry.spec.id,\n    definition: entry.definition,\n    state: entry.plannerState(),\n  }));\n}\n\nexport function commitPhysicalVisualPlan(\n  entries: readonly PhysicalDieVisualInstance[],\n  transforms: Float32Array,\n  frameCount: number,\n  step: number,\n  physicalCount: number,\n  assignments: readonly PhysicalVisualPlanAssignment[],\n  landings: Int32Array,\n  activationDelays?: Float32Array,\n): void {\n  if (\n    frameCount < 1 ||\n    transforms.length !== frameCount * physicalCount * 7 ||\n    landings.length !== physicalCount ||\n    (activationDelays !== undefined && activationDelays.length !== physicalCount)\n  ) {\n    throw new Error('Physical trajectory buffers do not match the unified plan.');\n  }\n  const configured = configuredPhysicalDice(entries);\n  const configuredIds = new Set(configured.map((entry) => entry.spec.id));\n  const assignedIds = new Set(assignments.map((assignment) => assignment.id));\n  if (\n    configuredIds.size !== assignments.length ||\n    assignedIds.size !== assignments.length ||\n    [...configuredIds].some((id) => !assignedIds.has(id))\n  ) {\n    throw new Error('Physical visual assignments do not match the configured generic dice.');\n  }\n  const entriesById = new Map(configured.map((entry) => [entry.spec.id, entry] as const));\n\n  for (const assignment of assignments) {\n    const entry = entriesById.get(assignment.id);\n    if (!entry) {\n      throw new Error(\`Physical visual is not configured: \${assignment.id}\`);\n    }\n    const physicalIndex = assignment.physicalIndex;\n    if (physicalIndex < 0 || physicalIndex >= physicalCount) {\n      throw new Error(\`Physical visual index is invalid: \${String(physicalIndex)}\`);\n    }\n    entry.commitTrajectory(\n      transforms,\n      frameCount,\n      step,\n      physicalCount,\n      physicalIndex,\n      landings[physicalIndex] ?? 0,\n      activationDelays?.[physicalIndex] ?? 0,\n    );\n  }\n}\n`,
    'replace stateful visual helper registry',
  );
  return source;
});

await transform('src/main.ts', (source) => {
  source = replaceOnce(
    source,
    `import {\n  PhysicalDieVisualInstance,\n  assignPendingPhysicalLaunchStates,\n  commitPhysicalVisualPlan,\n  getPhysicalVisualInstance,\n  getPhysicalVisualPlanEntries,\n  getPendingPhysicalLaunchParticipants,\n  hasConfiguredPhysicalVisuals,\n  hasPendingPhysicalVisuals,\n} from './physical-die-visuals';`,
    `import {\n  PhysicalDieVisualInstance,\n  assignPendingPhysicalLaunchStates,\n  commitPhysicalVisualPlan,\n  getPhysicalVisualPlanEntries,\n  getPendingPhysicalLaunchParticipants,\n  hasConfiguredPhysicalVisuals,\n  hasPendingPhysicalVisuals,\n  type PendingPhysicalLaunchParticipant,\n} from './physical-die-visuals';`,
    'main visual helper imports',
  );

  source = replaceOnce(
    source,
    `function rebindPhysicalTableRuntime(): void {\n  const canonicalEntries = physicalTable.canonicalEntries();\n  if (canonicalEntries.length === dice.length) {\n    dice.forEach((die, index) => physicalTable.bindCanonical(canonicalEntries[index].id, die));\n  }\n  for (const entry of physicalTable.visualEntries()) {\n    const visual = getPhysicalVisualInstance(entry.id);\n    if (visual) physicalTable.bindVisual(entry.id, visual);\n  }\n}`,
    `function rebindCanonicalPhysicalTableRuntime(): void {\n  const canonicalEntries = physicalTable.canonicalEntries();\n  if (canonicalEntries.length === dice.length) {\n    dice.forEach((die, index) => physicalTable.bindCanonical(canonicalEntries[index].id, die));\n  }\n}`,
    'remove visual runtime rebind',
  );

  source = replaceOnce(
    source,
    `function resetPhysicalTable(specs: DraftrollPhysicalVisual[]): void {\n  activePhysicalSpecs = specs;\n  physicalTable.reset(specs.map(physicalTableSpec));\n  rebindPhysicalTableRuntime();\n}`,
    `function resetPhysicalTable(\n  specs: DraftrollPhysicalVisual[],\n  preserveBindings = false,\n): void {\n  activePhysicalSpecs = specs;\n  physicalTable.reset(specs.map(physicalTableSpec), preserveBindings);\n  rebindCanonicalPhysicalTableRuntime();\n}`,
    'registry-owned reset and rollback',
  );

  source = replaceCount(
    source,
    `  rebindPhysicalTableRuntime();\n`,
    `  rebindCanonicalPhysicalTableRuntime();\n`,
    1,
    'remaining canonical runtime rebind',
  );

  source = replaceOnce(
    source,
    `  dice = [];\n  clearGenericPhysicalVisuals();\n  clearFallbackVisuals();\n}`,
    `  dice = [];\n  clearGenericPhysicalVisuals();\n  clearFallbackVisuals();\n  physicalTable.reset([]);\n}`,
    'clear registry-owned runtime bindings',
  );

  source = replaceOnce(
    source,
    `type GenericLaunchParticipant = ReturnType<typeof getPendingPhysicalLaunchParticipants>[number];`,
    `type GenericLaunchParticipant = PendingPhysicalLaunchParticipant;`,
    'generic launch participant type',
  );

  source = replaceOnce(
    source,
    `  assignPendingPhysicalLaunchStates(\n    generic.map((entry, index) => ({`,
    `  assignPendingPhysicalLaunchStates(\n    physicalTable.visualInstances(),\n    generic.map((entry, index) => ({`,
    'registry-owned launch state assignment',
  );

  source = replaceCount(
    source,
    `getPendingPhysicalLaunchParticipants()`,
    `getPendingPhysicalLaunchParticipants(physicalTable.visualInstances())`,
    2,
    'registry-owned pending participants',
  );

  source = replaceOnce(
    source,
    `  const genericEntries = getPhysicalVisualPlanEntries();`,
    `  const genericEntries = getPhysicalVisualPlanEntries(physicalTable.visualInstances());`,
    'registry-owned visual plan entries',
  );

  source = replaceOnce(
    source,
    `  const hasArbitraryPhysicalDice = hasConfiguredPhysicalVisuals();`,
    `  const hasArbitraryPhysicalDice = hasConfiguredPhysicalVisuals(physicalTable.visualInstances());`,
    'registry-owned configured visual query',
  );

  source = replaceCount(
    source,
    `hasPendingPhysicalVisuals()`,
    `hasPendingPhysicalVisuals(physicalTable.visualInstances())`,
    1,
    'registry-owned pending visual query',
  );

  source = replaceCount(
    source,
    `  commitPhysicalVisualPlan(\n    `,
    `  commitPhysicalVisualPlan(\n    physicalTable.visualInstances(),\n    `,
    2,
    'registry-owned visual trajectory commit',
  );

  source = replaceOnce(
    source,
    `    resetPhysicalTable(previous.activePhysicalSpecs);`,
    `    resetPhysicalTable(previous.activePhysicalSpecs, true);`,
    'preserve bindings during additive rollback',
  );

  source = replaceOnce(
    source,
    `      getPerformanceSnapshot: () => DicePerformanceSnapshot;\n      getPhysicalSnapshot: () => Array<{`,
    `      getPerformanceSnapshot: () => DicePerformanceSnapshot;\n      /** Internal browser regression diagnostics; not part of DraftrollBridge. */\n      getPhysicalSnapshot: () => Array<{`,
    'mark browser snapshot diagnostics internal',
  );
  return source;
});

await transform('src/physical-die-mesh.ts', (source) => {
  source = replaceOnce(
    source,
    `  const ownedTextures: THREE.Texture[] = [];\n`,
    '',
    'remove dead owned texture collection',
  );
  source = replaceOnce(
    source,
    `  const generatedSurface = acquireSurfaceTexture(spec);\n  const runtimeSurface =`,
    `  const runtimeSurface =`,
    'make generated surface lazy',
  );
  source = replaceOnce(
    source,
    `    getRuntimeThemeTexture(spec.theme, \`d\${definition.sides}\`, 'surface');\n  const runtimeNormal =`,
    `    getRuntimeThemeTexture(spec.theme, \`d\${definition.sides}\`, 'surface');\n  const generatedSurface = runtimeSurface ? null : acquireSurfaceTexture(spec);\n  const runtimeNormal =`,
    'acquire fallback surface only when needed',
  );
  source = replaceOnce(
    source,
    `    map: runtimeSurface ?? generatedSurface.texture,`,
    `    map: runtimeSurface ?? generatedSurface?.texture ?? null,`,
    'use optional generated fallback texture',
  );
  source = replaceOnce(
    source,
    `      for (const textureToDispose of ownedTextures) textureToDispose.dispose();\n      generatedSurface.release();`,
    `      generatedSurface?.release();`,
    'remove dead texture disposal',
  );
  return source;
});

await transform('src/overlay.css', () => `html[data-draftroll-mode='overlay'],\nhtml[data-draftroll-mode='overlay'] body,\nhtml[data-draftroll-mode='overlay'] #app {\n  width: 100%;\n  height: 100%;\n  margin: 0;\n  overflow: hidden;\n  background: transparent !important;\n  pointer-events: none !important;\n}\n\nhtml[data-draftroll-mode='overlay'] #scene {\n  position: fixed;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n  display: block;\n  opacity: 1;\n  background: transparent !important;\n  /* Keep passthrough as the default, but let configureInteractions() override\n     the canvas inline when click/drag interactions are explicitly enabled. */\n  pointer-events: none;\n}\n\nhtml[data-draftroll-mode='overlay'] .overlay-hidden {\n  display: none !important;\n}\n\nhtml[data-draftroll-mode='overlay'] #flash {\n  pointer-events: none !important;\n}\n\n/* The physical engine also powers the legacy standalone playground. Never let\n   that playground's decorative surface leak into an embedded overlay. */\nhtml[data-draftroll-mode='overlay'] #app::before,\nhtml[data-draftroll-mode='overlay'] #app::after {\n  content: none !important;\n  display: none !important;\n}\n`);

await transform('.gitignore', (source) => {
  if (source.split('\n').includes('.DS_Store')) throw new Error('.gitignore already contains .DS_Store');
  return `${source.trimEnd()}\n.DS_Store\n`;
});

await transform('docs/ARCHITECTURE.md', (source) => {
  source = replaceOnce(
    source,
    `The recommended third-party website path is \`@draftroll/overlay\`. It creates a transparent fixed iframe, sends normalized rolls through \`postMessage\`, and renders the result panel in a host-side Shadow DOM. The dice layer does not intercept host-page pointer input, creates no idle dice during mount/warmup, and can arm click-anywhere dissolve after a completed throw.`,
    `The recommended third-party website path is \`@draftroll/overlay\`. It creates a transparent fixed iframe, sends normalized rolls through \`postMessage\`, and renders the result panel in a host-side Shadow DOM. By default the dice layer does not intercept host-page pointer input; explicit interaction configuration opts the iframe and canvas into pointer handling. It creates no idle dice during mount/warmup and can arm click-anywhere dissolve after a completed throw.`,
    'document overlay interaction ownership',
  );
  source = replaceOnce(
    source,
    `- persistent in-flight physical additions\n- shape-symmetry targeting diagnostics without changing normalized results`,
    `- persistent in-flight physical additions\n- one physical-table registry as the sole owner of live canonical/generated/custom runtime bindings\n- shape-symmetry targeting diagnostics without changing normalized results`,
    'document physical table ownership',
  );
  return source;
});

console.log('Applied focused physical architecture cleanup.');
