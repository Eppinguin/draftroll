import { readFile, writeFile } from 'node:fs/promises';

function replaceOrThrow(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`${label} marker missing`);
  return source.replace(before, after);
}

function replaceRangeOrThrow(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label} start marker missing`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label} end marker missing`);
  return source.slice(0, start) + replacement + source.slice(end);
}

await writeFile(
  'src/physical-table.ts',
  `import * as THREE from 'three';
import type { DieInstance } from './dice';
import type { PhysicalDieVisualInstance } from './physical-die-visuals';

export type PhysicalTableImplementation = 'canonical' | 'visual';

export interface PhysicalTableSpec {
  /** Logical die identity from the originating roll. Never used as a runtime lookup key. */
  dieId: string;
  implementation: PhysicalTableImplementation;
}

export interface PhysicalTableEntry {
  /** Logical die identity from the originating roll; it may repeat across table groups. */
  dieId: string;
  /** Unique runtime identity for this physical table lifetime. */
  physicalIndex: number;
  implementation: PhysicalTableImplementation;
  canonicalIndex: number | null;
  visualIndex: number | null;
  die: DieInstance | null;
  visual: PhysicalDieVisualInstance | null;
}

/**
 * Runtime registry for every physical die currently represented on the table.
 *
 * @remarks
 * Logical die IDs belong to normalized rolls and are intentionally allowed to repeat across
 * additive/concurrent groups. Runtime ownership is positional: physicalIndex identifies the table
 * entry, while canonicalIndex and visualIndex identify the implementation-specific binding. No
 * live physics or rendering state is keyed by a logical die ID.
 */
export class PhysicalTableRegistry {
  private readonly entriesInOrder: PhysicalTableEntry[] = [];
  private readonly canonicalEntriesInOrder: PhysicalTableEntry[] = [];
  private readonly visualEntriesInOrder: PhysicalTableEntry[] = [];

  get size(): number {
    return this.entriesInOrder.length;
  }

  get canonicalCount(): number {
    return this.canonicalEntriesInOrder.length;
  }

  get visualCount(): number {
    return this.visualEntriesInOrder.length;
  }

  reset(specs: readonly PhysicalTableSpec[], preserveBindings = false): void {
    const previousEntries = preserveBindings ? this.entriesInOrder.slice() : null;
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
        previous.dieId !== entry.dieId ||
        previous.implementation !== entry.implementation
      ) {
        continue;
      }
      entry.die = previous.die;
      entry.visual = previous.visual;
    }
  }

  append(specs: readonly PhysicalTableSpec[]): void {
    for (const spec of specs) {
      const entry: PhysicalTableEntry = {
        dieId: spec.dieId,
        physicalIndex: this.entriesInOrder.length,
        implementation: spec.implementation,
        canonicalIndex:
          spec.implementation === 'canonical' ? this.canonicalEntriesInOrder.length : null,
        visualIndex: spec.implementation === 'visual' ? this.visualEntriesInOrder.length : null,
        die: null,
        visual: null,
      };
      this.entriesInOrder.push(entry);
      if (spec.implementation === 'canonical') this.canonicalEntriesInOrder.push(entry);
      else this.visualEntriesInOrder.push(entry);
    }
  }

  entries(): readonly PhysicalTableEntry[] {
    return this.entriesInOrder;
  }

  canonicalEntries(): readonly PhysicalTableEntry[] {
    return this.canonicalEntriesInOrder;
  }

  visualEntries(): readonly PhysicalTableEntry[] {
    return this.visualEntriesInOrder;
  }

  visualInstances(): PhysicalDieVisualInstance[] {
    return this.visualEntriesInOrder.map((entry) => {
      if (!entry.visual) {
        throw new Error(
          `Physical table visual entry is unbound at visual index ${String(entry.visualIndex)} (die ${entry.dieId})`,
        );
      }
      return entry.visual;
    });
  }

  boundEntries(): PhysicalTableEntry[] {
    return this.entriesInOrder.filter((entry) => entry.die !== null || entry.visual !== null);
  }

  entryAt(physicalIndex: number): PhysicalTableEntry | undefined {
    return this.entriesInOrder[physicalIndex];
  }

  canonicalIndex(physicalIndex: number): number {
    return this.entryAt(physicalIndex)?.canonicalIndex ?? -1;
  }

  visualIndex(physicalIndex: number): number {
    return this.entryAt(physicalIndex)?.visualIndex ?? -1;
  }

  physicalIndexForCanonical(canonicalIndex: number): number {
    const entry = this.canonicalEntriesInOrder[canonicalIndex];
    if (!entry) {
      throw new Error(`Physical table canonical index is missing: ${canonicalIndex}`);
    }
    return entry.physicalIndex;
  }

  physicalIndexForVisual(visualIndex: number): number {
    const entry = this.visualEntriesInOrder[visualIndex];
    if (!entry) {
      throw new Error(`Physical table visual index is missing: ${visualIndex}`);
    }
    return entry.physicalIndex;
  }

  bindCanonicalAt(canonicalIndex: number, die: DieInstance): void {
    const entry = this.canonicalEntriesInOrder[canonicalIndex];
    if (!entry) {
      throw new Error(`Physical table canonical index is missing: ${canonicalIndex}`);
    }
    entry.die = die;
  }

  bindVisualAt(visualIndex: number, visual: PhysicalDieVisualInstance): void {
    const entry = this.visualEntriesInOrder[visualIndex];
    if (!entry) {
      throw new Error(`Physical table visual index is missing: ${visualIndex}`);
    }
    entry.visual = visual;
  }

  unbindVisualAt(visualIndex: number, expected?: PhysicalDieVisualInstance): void {
    const entry = this.visualEntriesInOrder[visualIndex];
    if (!entry) {
      throw new Error(`Physical table visual index is missing: ${visualIndex}`);
    }
    if (expected && entry.visual !== expected) {
      throw new Error(`Physical table visual binding changed unexpectedly: ${visualIndex}`);
    }
    entry.visual = null;
  }

  forEachVisual(
    callback: (visual: PhysicalDieVisualInstance, entry: PhysicalTableEntry) => void,
  ): void {
    for (const entry of this.visualEntriesInOrder) {
      if (entry.visual) callback(entry.visual, entry);
    }
  }

  worldPosition(physicalIndex: number, target = new THREE.Vector3()): THREE.Vector3 | null {
    const entry = this.entryAt(physicalIndex);
    if (!entry) return null;
    if (entry.die) return target.copy(entry.die.getWorldPosition());
    if (entry.visual) return entry.visual.getWorldPosition(target);
    return null;
  }

  findByObject(object: THREE.Object3D): PhysicalTableEntry | null {
    for (const entry of this.entriesInOrder) {
      const root = entry.die?.group ?? entry.visual?.group;
      if (!root) continue;
      let current: THREE.Object3D | null = object;
      while (current) {
        if (current === root) return entry;
        current = current.parent;
      }
    }
    return null;
  }
}
`,
);

let visuals = await readFile('src/physical-die-visuals.ts', 'utf8');
visuals = replaceOrThrow(
  visuals,
  `  get launchParticipant(): PendingPhysicalLaunchParticipant {\n    return {\n      id: this.spec.id,\n      radius: physicalDieColliderRadius(this.definition),\n      coinLike: this.sides === 2,\n    };\n  }\n\n`,
  '',
  'visual launch participant getter',
);
const visualTail = `export interface PendingPhysicalLaunchParticipant {
  visualIndex: number;
  radius: number;
  coinLike: boolean;
}

export interface PendingPhysicalLaunchAssignment {
  visualIndex: number;
  state: PhysicalLaunchState;
}

export interface PhysicalVisualPlanEntry {
  visualIndex: number;
  definition: PhysicalDieDefinition;
  state: number[];
}

export interface PhysicalVisualPlanAssignment {
  visualIndex: number;
  physicalIndex: number;
}

interface ConfiguredPhysicalVisual {
  visualIndex: number;
  visual: PhysicalDieVisualInstance;
}

function configuredPhysicalDice(
  entries: readonly PhysicalDieVisualInstance[],
): ConfiguredPhysicalVisual[] {
  return entries.flatMap((visual, visualIndex) =>
    visual.isPrepared ? [{ visualIndex, visual }] : [],
  );
}

export function getPendingPhysicalLaunchParticipants(
  entries: readonly PhysicalDieVisualInstance[],
): PendingPhysicalLaunchParticipant[] {
  return configuredPhysicalDice(entries).flatMap(({ visualIndex, visual }) =>
    visual.requiresPlanning
      ? [
          {
            visualIndex,
            radius: physicalDieColliderRadius(visual.definition),
            coinLike: visual.sides === 2,
          },
        ]
      : [],
  );
}

export function assignPendingPhysicalLaunchStates(
  entries: readonly PhysicalDieVisualInstance[],
  assignments: readonly PendingPhysicalLaunchAssignment[],
): void {
  const assigned = new Set<number>();
  for (const assignment of assignments) {
    if (assigned.has(assignment.visualIndex)) {
      throw new Error(
        `Physical visual launch assignment is duplicated: ${assignment.visualIndex}`,
      );
    }
    assigned.add(assignment.visualIndex);
    const visual = entries[assignment.visualIndex];
    if (!visual?.isPrepared || !visual.requiresPlanning) {
      throw new Error(
        `Physical visual is not pending at visual index ${assignment.visualIndex}`,
      );
    }
    visual.assignLaunchState(assignment.state);
  }
}

export function hasConfiguredPhysicalVisuals(
  entries: readonly PhysicalDieVisualInstance[],
): boolean {
  return entries.some((entry) => entry.isPrepared);
}

export function hasPendingPhysicalVisuals(entries: readonly PhysicalDieVisualInstance[]): boolean {
  return entries.some((entry) => entry.isPrepared && entry.requiresPlanning);
}

export function getPhysicalVisualPlanEntries(
  entries: readonly PhysicalDieVisualInstance[],
): PhysicalVisualPlanEntry[] {
  return configuredPhysicalDice(entries).map(({ visualIndex, visual }) => ({
    visualIndex,
    definition: visual.definition,
    state: visual.plannerState(),
  }));
}

export function commitPhysicalVisualPlan(
  entries: readonly PhysicalDieVisualInstance[],
  transforms: Float32Array,
  frameCount: number,
  step: number,
  physicalCount: number,
  assignments: readonly PhysicalVisualPlanAssignment[],
  landings: Int32Array,
  activationDelays?: Float32Array,
): void {
  if (
    frameCount < 1 ||
    transforms.length !== frameCount * physicalCount * 7 ||
    landings.length !== physicalCount ||
    (activationDelays !== undefined && activationDelays.length !== physicalCount)
  ) {
    throw new Error('Physical trajectory buffers do not match the unified plan.');
  }
  const configuredIndexes = new Set(
    configuredPhysicalDice(entries).map(({ visualIndex }) => visualIndex),
  );
  const assignedIndexes = new Set(assignments.map((assignment) => assignment.visualIndex));
  if (
    configuredIndexes.size !== assignments.length ||
    assignedIndexes.size !== assignments.length ||
    [...configuredIndexes].some((visualIndex) => !assignedIndexes.has(visualIndex))
  ) {
    throw new Error('Physical visual assignments do not match the configured generic dice.');
  }

  for (const assignment of assignments) {
    const visual = entries[assignment.visualIndex];
    if (!visual?.isPrepared) {
      throw new Error(
        `Physical visual is not configured at visual index ${assignment.visualIndex}`,
      );
    }
    const physicalIndex = assignment.physicalIndex;
    if (physicalIndex < 0 || physicalIndex >= physicalCount) {
      throw new Error(`Physical visual index is invalid: ${String(physicalIndex)}`);
    }
    visual.commitTrajectory(
      transforms,
      frameCount,
      step,
      physicalCount,
      physicalIndex,
      landings[physicalIndex] ?? 0,
      activationDelays?.[physicalIndex] ?? 0,
    );
  }
}
`;
const visualTailStart = visuals.indexOf('export interface PendingPhysicalLaunchParticipant');
if (visualTailStart < 0) throw new Error('physical visual helper tail marker missing');
visuals = visuals.slice(0, visualTailStart) + visualTail;
await writeFile('src/physical-die-visuals.ts', visuals);

let launch = await readFile('src/physical-launch.ts', 'utf8');
launch = replaceOrThrow(
  launch,
  `export interface PhysicalLaunchParticipant {\n  id: string;\n  radius: number;\n  coinLike?: boolean;\n}`,
  `export interface PhysicalLaunchParticipant {\n  radius: number;\n  coinLike?: boolean;\n}`,
  'launch participant runtime id',
);
await writeFile('src/physical-launch.ts', launch);

let main = await readFile('src/main.ts', 'utf8');
const runtimeBindingSection = `function clearGenericPhysicalVisuals(): void {
  for (const entry of physicalTable.visualEntries()) {
    const visual = entry.visual;
    if (!visual) continue;
    const visualIndex = entry.visualIndex;
    if (visualIndex === null) throw new Error('Physical table visual entry has no visual index.');
    scene.remove(visual.group);
    visual.dispose();
    physicalTable.unbindVisualAt(visualIndex, visual);
  }
}

function rebindCanonicalPhysicalTableRuntime(): void {
  if (physicalTable.canonicalCount !== dice.length) {
    throw new Error(
      `Physical table canonical runtime count mismatch: ${physicalTable.canonicalCount} entries for ${dice.length} dice`,
    );
  }
  dice.forEach((die, canonicalIndex) => physicalTable.bindCanonicalAt(canonicalIndex, die));
}

function physicalTableSpec(spec: DraftrollPhysicalVisual) {
  return {
    dieId: spec.id,
    implementation: usesCanonicalPhysicalImplementation(spec)
      ? ('canonical' as const)
      : ('visual' as const),
  };
}

function resetPhysicalTable(specs: DraftrollPhysicalVisual[], preserveBindings = false): void {
  activePhysicalSpecs = specs;
  physicalTable.reset(specs.map(physicalTableSpec), preserveBindings);
  rebindCanonicalPhysicalTableRuntime();
}

function clearFallbackVisuals(): void {
  for (const visual of fallbackVisuals) {
    scene.remove(visual.group);
    visual.dispose();
  }
  fallbackVisuals = [];
}

function clearDice(): void {
  activePlan = null;
  playedOutcomeEffectIds.clear();
  outcomeHeroCounts.clear();
  announcedOutcomeGroupIds.clear();
  for (const die of dice) {
    world.removeBody(die.body);
    scene.remove(die.group);
    die.dispose();
  }
  dice = [];
  clearGenericPhysicalVisuals();
  clearFallbackVisuals();
  physicalTable.reset([]);
}

function spawnGenericPhysicalVisuals(specs: readonly DraftrollPhysicalVisual[]): void {
  clearGenericPhysicalVisuals();
  if (specs.length === 0) return;
  specs.forEach((spec, visualIndex) => {
    const visual = new PhysicalDieVisualInstance(spec);
    visual.prepare();
    scene.add(visual.group);
    physicalTable.bindVisualAt(visualIndex, visual);
  });
}

`;
main = replaceRangeOrThrow(
  main,
  'function clearGenericPhysicalVisuals(): void {',
  'function spawnFallbackVisuals(',
  runtimeBindingSection,
  'runtime table binding section',
);

const tableGroupSection = `interface ActiveTableRollGroup {
  groupId: string;
  /** Logical die IDs retained only for semantic/reporting state. */
  dieIds?: string[];
  actorLabel?: string;
  rollLabel?: string;
  total: number;
  physicalStart: number;
  physicalCount: number;
  fallbackStart: number;
  fallbackCount: number;
  visualCount: number;
  /** Exact runtime table membership; unlike logical die IDs, these are unique on the live table. */
  physicalIndexes: number[];
  fallbackIndexes: number[];
}

function tableIndexRange(start: number, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_value, offset) => start + offset);
}

function readTableIndexes(value: unknown, start: number, count: number): number[] {
  if (!Array.isArray(value)) return tableIndexRange(start, count);
  const indexes = value
    .filter((entry): entry is number => Number.isSafeInteger(entry) && entry >= 0)
    .map((entry) => Math.floor(entry));
  return [...new Set(indexes)].toSorted((left, right) => left - right);
}

function readActiveTableRolls(): ActiveTableRollGroup[] {
  const raw = activeContext.tableRolls;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!isRecord(value)) return [];
    const entry = value;
    const physicalStart = Number(entry.physicalStart);
    const physicalCount = Number(entry.physicalCount);
    const fallbackStart = Number(entry.fallbackStart);
    const fallbackCount = Number(entry.fallbackCount);
    const visualCount = Number(entry.visualCount);
    const total = Number(entry.total);
    if (
      ![physicalStart, physicalCount, fallbackStart, fallbackCount, visualCount, total].every(
        Number.isFinite,
      )
    )
      return [];
    const normalizedPhysicalStart = Math.max(0, Math.floor(physicalStart));
    const normalizedPhysicalCount = Math.max(0, Math.floor(physicalCount));
    const normalizedFallbackStart = Math.max(0, Math.floor(fallbackStart));
    const normalizedFallbackCount = Math.max(0, Math.floor(fallbackCount));
    return [
      {
        groupId: typeof entry.groupId === 'string' ? entry.groupId : `table-roll-${physicalStart}`,
        dieIds: Array.isArray(entry.dieIds)
          ? entry.dieIds.filter((id): id is string => typeof id === 'string')
          : undefined,
        actorLabel: typeof entry.actorLabel === 'string' ? entry.actorLabel : undefined,
        rollLabel: typeof entry.rollLabel === 'string' ? entry.rollLabel : undefined,
        total,
        physicalStart: normalizedPhysicalStart,
        physicalCount: normalizedPhysicalCount,
        fallbackStart: normalizedFallbackStart,
        fallbackCount: normalizedFallbackCount,
        visualCount: Math.max(0, Math.floor(visualCount)),
        physicalIndexes: readTableIndexes(
          entry.physicalIndexes,
          normalizedPhysicalStart,
          normalizedPhysicalCount,
        ),
        fallbackIndexes: readTableIndexes(
          entry.fallbackIndexes,
          normalizedFallbackStart,
          normalizedFallbackCount,
        ),
      },
    ];
  });
}

`;
main = replaceRangeOrThrow(
  main,
  'interface ActiveTableRollGroup {',
  'interface CanonicalLaunchParticipant {',
  tableGroupSection,
  'active table roll group section',
);

const launchSection = `interface CanonicalLaunchParticipant {
  die: DieInstance;
  index: number;
  physicalIndex: number;
}

interface GenericLaunchParticipant extends PendingPhysicalLaunchParticipant {
  physicalIndex: number;
}

function pendingGenericLaunchParticipants(): GenericLaunchParticipant[] {
  return getPendingPhysicalLaunchParticipants(physicalTable.visualInstances()).map((entry) => ({
    ...entry,
    physicalIndex: physicalTable.physicalIndexForVisual(entry.visualIndex),
  }));
}

function toLaunchState(state: PhysicalLaunchState): LaunchState {
  return {
    position: new CANNON.Vec3(...state.position),
    quaternion: new CANNON.Quaternion(...state.quaternion),
    velocity: new CANNON.Vec3(...state.velocity),
    angularVelocity: new CANNON.Vec3(...state.angularVelocity),
    delay: state.delay,
  };
}

function createMixedPhysicalLaunchStates(
  canonical: readonly CanonicalLaunchParticipant[],
  generic: readonly GenericLaunchParticipant[],
  random: () => number,
  throwDirection: THREE.Vector2,
  handBias: number,
  delayOffset = 0,
): LaunchState[] {
  const participants: PhysicalLaunchParticipant[] = [
    ...canonical.map(({ die }) => ({
      radius: DIE_COLLIDER_RADIUS[die.kind],
      coinLike: die.kind === 'coin',
    })),
    ...generic.map(({ radius, coinLike }) => ({ radius, coinLike })),
  ];
  const generated = createPhysicalLaunchStates(participants, {
    bounds: screenBounds,
    random,
    throwDirection,
    handBias,
    gravity: PHYSICS_PRESETS[activePhysicsPreset].gravity,
    delayOffset,
  });
  const canonicalStates = generated.slice(0, canonical.length).map(toLaunchState);
  assignPendingPhysicalLaunchStates(
    physicalTable.visualInstances(),
    generic.map((entry, index) => ({
      visualIndex: entry.visualIndex,
      state: generated[canonical.length + index],
    })),
  );
  return canonicalStates;
}

function allCanonicalLaunchParticipants(): CanonicalLaunchParticipant[] {
  return dice.map((die, index) => ({
    die,
    index,
    physicalIndex: physicalTable.physicalIndexForCanonical(index),
  }));
}

function groupContainsPhysicalIndex(group: ActiveTableRollGroup, physicalIndex: number): boolean {
  return group.physicalIndexes.includes(physicalIndex);
}

function createLaunchStates(swipe: THREE.Vector2 | undefined, seed: string): LaunchState[] {
  const canonical = allCanonicalLaunchParticipants();
  const generic = pendingGenericLaunchParticipants();
  const tableRolls = readActiveTableRolls().filter(
    (group) =>
      canonical.some((entry) => groupContainsPhysicalIndex(group, entry.physicalIndex)) ||
      generic.some((entry) => groupContainsPhysicalIndex(group, entry.physicalIndex)),
  );
  if (tableRolls.length > 1) {
    const states: Array<LaunchState | undefined> = Array.from({ length: canonical.length });
    let assignedGeneric = 0;
    for (let groupIndex = 0; groupIndex < tableRolls.length; groupIndex += 1) {
      const group = tableRolls[groupIndex];
      const groupCanonical = canonical.filter((entry) =>
        groupContainsPhysicalIndex(group, entry.physicalIndex),
      );
      const groupGeneric = generic.filter((entry) =>
        groupContainsPhysicalIndex(group, entry.physicalIndex),
      );
      if (groupCanonical.length + groupGeneric.length === 0) continue;
      const lane = THREE.MathUtils.lerp(-0.82, 0.82, groupIndex / (tableRolls.length - 1));
      const random = createSeededRandom(`${seed}:${group.groupId}`);
      const throwDirection = new THREE.Vector2(-lane * 0.28, -1)
        .normalize()
        .rotateAround(new THREE.Vector2(), (random() - 0.5) * 0.12);
      const groupStates = createMixedPhysicalLaunchStates(
        groupCanonical,
        groupGeneric,
        random,
        throwDirection,
        lane,
      );
      groupCanonical.forEach((entry, index) => {
        states[entry.index] = groupStates[index];
      });
      assignedGeneric += groupGeneric.length;
    }
    if (states.every(Boolean) && assignedGeneric === generic.length) {
      return states.filter((state): state is LaunchState => state !== undefined);
    }
  }

  const random = createSeededRandom(seed);
  const swipeLateral = swipe ? THREE.MathUtils.clamp(swipe.x / 190, -0.78, 0.78) : 0;
  const swipeForward = swipe ? THREE.MathUtils.clamp(-swipe.y / 260, -0.3, 0.72) : 0;
  const total = canonical.length + generic.length;
  const naturalYaw = (random() - 0.5) * (total > 12 ? 0.15 : 0.22);
  const throwDirection = new THREE.Vector2(swipeLateral * 0.62, -1 + swipeForward * 0.13)
    .normalize()
    .rotateAround(new THREE.Vector2(), naturalYaw);
  const handBias = swipeLateral * 0.48 + (random() - 0.5) * 0.12;
  return createMixedPhysicalLaunchStates(canonical, generic, random, throwDirection, handBias);
}

`;
main = replaceRangeOrThrow(
  main,
  'interface CanonicalLaunchParticipant {',
  'interface WorkerPhysicalPlanEntry {',
  launchSection,
  'launch assignment section',
);

main = replaceOrThrow(
  main,
  `  const genericById = new Map(genericEntries.map((entry) => [entry.id, entry] as const));\n  if (genericById.size !== genericEntries.length) {\n    throw new Error('Generic physical visual ids must be unique.');\n  }`,
  `  const genericByVisualIndex = new Map(\n    genericEntries.map((entry) => [entry.visualIndex, entry] as const),\n  );`,
  'generic plan lookup map',
);
main = replaceOrThrow(
  main,
  `    const generic = genericById.get(spec.id);\n    if (!generic) throw new Error(\`Generic physical state is missing at \${physicalIndex}.\`);`,
  `    const visualIndex = physicalTable.visualIndex(physicalIndex);\n    if (visualIndex < 0) {\n      throw new Error(\`Generic physical visual index is missing at \${physicalIndex}.\`);\n    }\n    const generic = genericByVisualIndex.get(visualIndex);\n    if (!generic) throw new Error(\`Generic physical state is missing at \${physicalIndex}.\`);`,
  'generic plan lookup',
);
main = replaceOrThrow(
  main,
  `function activeGenericPlanAssignments() {\n  return physicalTable.visualEntries().map((entry) => ({\n    id: entry.id,\n    physicalIndex: entry.physicalIndex,\n  }));\n}`,
  `function activeGenericPlanAssignments() {\n  return physicalTable.visualEntries().map((entry) => {\n    if (entry.visualIndex === null) {\n      throw new Error(\`Physical table visual index is missing at \${entry.physicalIndex}.\`);\n    }\n    return {\n      visualIndex: entry.visualIndex,\n      physicalIndex: entry.physicalIndex,\n    };\n  });\n}`,
  'generic plan assignments',
);

const appendGenericBefore = `function appendGenericPhysicalVisuals(
  specs: readonly DraftrollPhysicalVisual[],
): PhysicalDieVisualInstance[] {
  if (specs.length === 0) return [];
  const appended = specs.map((spec) => {
    const visual = new PhysicalDieVisualInstance(spec);
    visual.prepare();
    scene.add(visual.group);
    physicalTable.bindVisual(spec.id, visual);
    return visual;
  });
  return appended;
}`;
const appendGenericAfter = `function appendGenericPhysicalVisuals(
  specs: readonly DraftrollPhysicalVisual[],
  firstVisualIndex: number,
): PhysicalDieVisualInstance[] {
  if (specs.length === 0) return [];
  return specs.map((spec, offset) => {
    const visual = new PhysicalDieVisualInstance(spec);
    visual.prepare();
    scene.add(visual.group);
    physicalTable.bindVisualAt(firstVisualIndex + offset, visual);
    return visual;
  });
}`;
main = replaceOrThrow(main, appendGenericBefore, appendGenericAfter, 'append generic visuals');
main = replaceOrThrow(
  main,
  `function removeAppendedGenericPhysicalVisuals(\n  appended: readonly PhysicalDieVisualInstance[],\n): void {\n  for (const visual of appended) {\n    scene.remove(visual.group);\n    visual.dispose();\n  }\n  for (const visual of appended) physicalTable.unbindVisual(visual.spec.id);\n}`,
  `function removeAppendedGenericPhysicalVisuals(\n  appended: readonly PhysicalDieVisualInstance[],\n  firstVisualIndex: number,\n): void {\n  appended.forEach((visual, offset) => {\n    scene.remove(visual.group);\n    visual.dispose();\n    physicalTable.unbindVisualAt(firstVisualIndex + offset, visual);\n  });\n}`,
  'remove appended generic visuals',
);

const incomingTableRolls = `function incomingTableRolls(
  context: Record<string, unknown>,
  physicalStart: number,
  physicalCount: number,
  fallbackStart: number,
  fallbackCount: number,
): ActiveTableRollGroup[] {
  const raw = Array.isArray(context.tableRolls) ? context.tableRolls : [];
  if (raw.length > 0) {
    return raw.flatMap((value, index) => {
      if (!isRecord(value)) return [];
      const entry = value;
      const localPhysicalStart = Math.max(0, Math.floor(Number(entry.physicalStart) || 0));
      const localPhysicalCount = Math.max(
        0,
        Math.floor(Number(entry.physicalCount) || physicalCount),
      );
      const localFallbackStart = Math.max(0, Math.floor(Number(entry.fallbackStart) || 0));
      const localFallbackCount = Math.max(
        0,
        Math.floor(Number(entry.fallbackCount) || fallbackCount),
      );
      const resolvedPhysicalStart = physicalStart + localPhysicalStart;
      const resolvedFallbackStart = fallbackStart + localFallbackStart;
      return [
        {
          groupId:
            typeof entry.groupId === 'string'
              ? entry.groupId
              : `table-add-${physicalStart}-${index}`,
          dieIds: Array.isArray(entry.dieIds)
            ? entry.dieIds.filter((id): id is string => typeof id === 'string')
            : undefined,
          actorLabel: typeof entry.actorLabel === 'string' ? entry.actorLabel : undefined,
          rollLabel: typeof entry.rollLabel === 'string' ? entry.rollLabel : undefined,
          total: Number.isFinite(Number(entry.total)) ? Number(entry.total) : 0,
          physicalStart: resolvedPhysicalStart,
          physicalCount: localPhysicalCount,
          fallbackStart: resolvedFallbackStart,
          fallbackCount: localFallbackCount,
          visualCount: Math.max(
            0,
            Math.floor(Number(entry.visualCount) || localPhysicalCount + localFallbackCount),
          ),
          physicalIndexes: tableIndexRange(resolvedPhysicalStart, localPhysicalCount),
          fallbackIndexes: tableIndexRange(resolvedFallbackStart, localFallbackCount),
        },
      ];
    });
  }
  const metadata = isRecord(context.metadata) ? context.metadata : undefined;
  return [
    {
      groupId: typeof context.rollId === 'string' ? context.rollId : `table-add-${physicalStart}`,
      dieIds: Array.isArray(context.renderedDieIds)
        ? context.renderedDieIds.filter((id): id is string => typeof id === 'string')
        : undefined,
      actorLabel: typeof context.name === 'string' ? context.name : undefined,
      rollLabel: typeof metadata?.actionName === 'string' ? metadata.actionName : undefined,
      total: Number.isFinite(Number(context.normalizedTotal)) ? Number(context.normalizedTotal) : 0,
      physicalStart,
      physicalCount,
      fallbackStart,
      fallbackCount,
      visualCount: physicalCount + fallbackCount,
      physicalIndexes: tableIndexRange(physicalStart, physicalCount),
      fallbackIndexes: tableIndexRange(fallbackStart, fallbackCount),
    },
  ];
}

`;
main = replaceRangeOrThrow(
  main,
  'function incomingTableRolls(',
  'function mergeRenderedDieIds(',
  incomingTableRolls,
  'incoming table rolls',
);

main = replaceOrThrow(
  main,
  `    const previous = merged[index];\n    merged[index] = {\n      ...previous,\n      actorLabel: addition.actorLabel ?? previous.actorLabel,\n      rollLabel: addition.rollLabel ?? previous.rollLabel,\n      total: singleRollCompletedTotal ?? previous.total,\n      dieIds: [...new Set([...(previous.dieIds ?? []), ...(addition.dieIds ?? [])])],\n      physicalCount: previous.physicalCount + addition.physicalCount,\n      fallbackCount: previous.fallbackCount + addition.fallbackCount,\n      visualCount: previous.visualCount + addition.visualCount,\n    };`,
  `    const previous = merged[index];\n    const physicalIndexes = [...new Set([...previous.physicalIndexes, ...addition.physicalIndexes])].toSorted(\n      (left, right) => left - right,\n    );\n    const fallbackIndexes = [...new Set([...previous.fallbackIndexes, ...addition.fallbackIndexes])].toSorted(\n      (left, right) => left - right,\n    );\n    merged[index] = {\n      ...previous,\n      actorLabel: addition.actorLabel ?? previous.actorLabel,\n      rollLabel: addition.rollLabel ?? previous.rollLabel,\n      total: singleRollCompletedTotal ?? previous.total,\n      dieIds: [...new Set([...(previous.dieIds ?? []), ...(addition.dieIds ?? [])])],\n      physicalStart: physicalIndexes[0] ?? previous.physicalStart,\n      physicalCount: physicalIndexes.length,\n      fallbackStart: fallbackIndexes[0] ?? previous.fallbackStart,\n      fallbackCount: fallbackIndexes.length,\n      visualCount: physicalIndexes.length + fallbackIndexes.length,\n      physicalIndexes,\n      fallbackIndexes,\n    };`,
  'merge table group runtime membership',
);

main = replaceOrThrow(
  main,
  `  const existingCanonicalCount = dice.length;\n  const existingPhysicalCount = activePhysicalSpecs.length;`,
  `  const existingCanonicalCount = dice.length;\n  const existingVisualCount = physicalTable.visualCount;\n  const existingPhysicalCount = activePhysicalSpecs.length;`,
  'additive existing visual count',
);
main = replaceOrThrow(
  main,
  `  const appendedAdditional = appendGenericPhysicalVisuals(normalized.genericPhysical);`,
  `  const appendedAdditional = appendGenericPhysicalVisuals(\n    normalized.genericPhysical,\n    existingVisualCount,\n  );`,
  'additive generic visual binding',
);
main = replaceOrThrow(
  main,
  `    normalized.canonicalPhysicalIndexes.forEach((physicalIndex, index) => {\n      const spec = normalized.physical[physicalIndex];\n      const die = appended[index];\n      if (spec && die) physicalTable.bindCanonical(spec.id, die);\n    });`,
  `    appended.forEach((die, index) =>\n      physicalTable.bindCanonicalAt(existingCanonicalCount + index, die),\n    );`,
  'additive canonical binding',
);
main = replaceOrThrow(
  main,
  `    const appendedCanonical = appended.map((die, index) => ({\n      die,\n      index: existingCanonicalCount + index,\n      id: physicalVisualId(physicalTable.physicalIndexForCanonical(existingCanonicalCount + index)),\n    }));`,
  `    const appendedCanonical = appended.map((die, index) => ({\n      die,\n      index: existingCanonicalCount + index,\n      physicalIndex: physicalTable.physicalIndexForCanonical(existingCanonicalCount + index),\n    }));`,
  'additive canonical launch identity',
);
main = replaceOrThrow(
  main,
  `      getPendingPhysicalLaunchParticipants(physicalTable.visualInstances()),`,
  `      pendingGenericLaunchParticipants(),`,
  'additive pending generic participants',
);
main = replaceOrThrow(
  main,
  `    removeAppendedGenericPhysicalVisuals(appendedAdditional);`,
  `    removeAppendedGenericPhysicalVisuals(appendedAdditional, existingVisualCount);`,
  'additive generic rollback',
);

main = replaceOrThrow(
  main,
  `function physicalVisualId(index: number): string {\n  return (\n    activeVisualOrder.find((entry) => entry.kind === 'physical' && entry.index === index)?.dieId ??\n    activePhysicalSpecs[index]?.id ??\n    \`physical_\${index}\`\n  );\n}\n\nfunction fallbackVisualId(index: number): string {\n  return (\n    activeVisualOrder.find((entry) => entry.kind === 'fallback' && entry.index === index)?.dieId ??\n    activeFallbackSpecs[index]?.id ??\n    \`fallback_\${index}\`\n  );\n}`,
  `function physicalRuntimeKey(index: number): string {\n  return \`physical:\${index}\`;\n}\n\nfunction fallbackRuntimeKey(index: number): string {\n  return \`fallback:\${index}\`;\n}`,
  'runtime effect keys',
);
main = main.replaceAll('physicalVisualId(index)', 'physicalRuntimeKey(index)');
main = main.replaceAll('fallbackVisualId(index)', 'fallbackRuntimeKey(index)');
main = replaceOrThrow(
  main,
  `function effectGroupId(kind: 'physical' | 'fallback', index: number): string {\n  const dieId = kind === 'physical' ? physicalRuntimeKey(index) : fallbackRuntimeKey(index);\n  const group = readActiveTableRolls().find(\n    (entry) =>\n      entry.dieIds?.includes(dieId) ??\n      (kind === 'physical'\n        ? index >= entry.physicalStart && index < entry.physicalStart + entry.physicalCount\n        : index >= entry.fallbackStart && index < entry.fallbackStart + entry.fallbackCount),\n  );`,
  `function effectGroupId(kind: 'physical' | 'fallback', index: number): string {\n  const group = readActiveTableRolls().find((entry) =>\n    kind === 'physical'\n      ? entry.physicalIndexes.includes(index)\n      : entry.fallbackIndexes.includes(index),\n  );`,
  'effect group runtime membership',
);

main = replaceOrThrow(
  main,
  `  for (const group of groups) {\n    for (\n      let index = group.physicalStart;\n      index < group.physicalStart + group.physicalCount;\n      index += 1\n    ) {\n      const outcome = physicalOutcomeAt(index);\n      if (outcome === 'positive') positive = true;\n      if (outcome === 'negative') negative = true;\n    }\n    for (\n      let index = group.fallbackStart;\n      index < group.fallbackStart + group.fallbackCount;\n      index += 1\n    ) {\n      if (activeFallbackSpecs[index]?.outcome === 'positive') positive = true;\n      if (activeFallbackSpecs[index]?.outcome === 'negative') negative = true;\n    }\n  }`,
  `  for (const group of groups) {\n    for (const index of group.physicalIndexes) {\n      const outcome = physicalOutcomeAt(index);\n      if (outcome === 'positive') positive = true;\n      if (outcome === 'negative') negative = true;\n    }\n    for (const index of group.fallbackIndexes) {\n      if (activeFallbackSpecs[index]?.outcome === 'positive') positive = true;\n      if (activeFallbackSpecs[index]?.outcome === 'negative') negative = true;\n    }\n  }`,
  'outcome group runtime membership',
);
main = replaceOrThrow(
  main,
  `            fallbackCount: activeFallbackSpecs.length,\n            visualCount: activePhysicalSpecs.length + activeFallbackSpecs.length,`,
  `            fallbackCount: activeFallbackSpecs.length,\n            visualCount: activePhysicalSpecs.length + activeFallbackSpecs.length,\n            physicalIndexes: tableIndexRange(0, activePhysicalSpecs.length),\n            fallbackIndexes: tableIndexRange(0, activeFallbackSpecs.length),`,
  'announce default runtime membership',
);
main = replaceOrThrow(
  main,
  `            fallbackCount: activeFallbackSpecs.length,\n            visualCount: activePhysicalSpecs.length + activeFallbackSpecs.length,\n          },\n        ],\n  );`,
  `            fallbackCount: activeFallbackSpecs.length,\n            visualCount: activePhysicalSpecs.length + activeFallbackSpecs.length,\n            physicalIndexes: tableIndexRange(0, activePhysicalSpecs.length),\n            fallbackIndexes: tableIndexRange(0, activeFallbackSpecs.length),\n          },\n        ],\n  );`,
  'reveal default runtime membership',
);
main = replaceOrThrow(
  main,
  `        dieId: current.entry.id,`,
  `        dieId: current.entry.dieId,`,
  'interaction logical die id',
);
await writeFile('src/main.ts', main);

let protocol = await readFile('packages/protocol/src/index.ts', 'utf8');
protocol = replaceOrThrow(
  protocol,
  `export interface NormalizedDieResult {\n  id: string;`,
  `export interface NormalizedDieResult {\n  /** Logical die identity, unique within this die's containing NormalizedRollResult. */\n  id: string;`,
  'protocol logical die id docs',
);
await writeFile('packages/protocol/src/index.ts', protocol);

let evaluator = await readFile('packages/core/src/evaluator.ts', 'utf8');
evaluator = replaceOrThrow(
  evaluator,
  `    const dice: NormalizedDieResult[] = [];\n    const templatesByRoot = new Map<string, PlannedDie>();\n    const rootByDieId = new Map<string, string>();\n    for (let index = 0; index < planned.length; index += 1) {\n      const die = planned[index];\n      const id = die.id || \`die_\${index + 1}\`;`,
  `    const dice: NormalizedDieResult[] = [];\n    const templatesByRoot = new Map<string, PlannedDie>();\n    const rootByDieId = new Map<string, string>();\n    const initialIds = new Set<string>();\n    for (let index = 0; index < planned.length; index += 1) {\n      const die = planned[index];\n      const id = die.id || \`die_\${index + 1}\`;\n      if (initialIds.has(id)) throw new Error(\`Duplicate die id '\${id}' in structured roll\`);\n      initialIds.add(id);`,
  'structured logical id uniqueness',
);
await writeFile('packages/core/src/evaluator.ts', evaluator);

let core = await readFile('packages/core/src/index.ts', 'utf8');
core = replaceOrThrow(
  core,
  `  const inlineCustomDice = customDiceMap(input.customDice);\n  const dice: NormalizedDieResult[] = input.dice.map((die, index) => {\n    const customId = die.customDiceId ?? (inlineCustomDice.has(die.type) ? die.type : undefined);`,
  `  const inlineCustomDice = customDiceMap(input.customDice);\n  const usedDieIds = new Set<string>();\n  const dice: NormalizedDieResult[] = input.dice.map((die, index) => {\n    const id = die.id || \`die_\${index + 1}\`;\n    if (usedDieIds.has(id)) throw new Error(\`Duplicate die id '\${id}' in external roll\`);\n    usedDieIds.add(id);\n    const customId = die.customDiceId ?? (inlineCustomDice.has(die.type) ? die.type : undefined);`,
  'external logical id uniqueness setup',
);
core = replaceOrThrow(
  core,
  `      id: die.id || \`die_\${index + 1}\`,`,
  `      id,`,
  'external normalized logical id',
);
await writeFile('packages/core/src/index.ts', core);

let renderer = await readFile('packages/renderer/src/index.ts', 'utf8');
renderer = replaceOrThrow(
  renderer,
  `export interface DraftrollPhysicalVisual {\n  id: string;`,
  `export interface DraftrollPhysicalVisual {\n  /** Logical die ID from the originating roll; it is not a table-global runtime identifier. */\n  id: string;`,
  'physical visual id docs',
);
renderer = replaceOrThrow(
  renderer,
  `export interface DraftrollFallbackVisual {\n  id: string;`,
  `export interface DraftrollFallbackVisual {\n  /** Logical die ID from the originating roll; it is not a table-global runtime identifier. */\n  id: string;`,
  'fallback visual id docs',
);
renderer = replaceOrThrow(
  renderer,
  `  /** Stable IDs make group ownership independent from internal visual storage/ranges. */\n  dieIds: string[];`,
  `  /** Roll-scoped logical die IDs retained for semantic reporting only. */\n  dieIds: string[];`,
  'table roll logical id docs',
);
renderer = replaceOrThrow(
  renderer,
  `  ): Promise<PreparedRollPresentation> {\n    const requestedIds = internal.dieIds ?? options.dieIds;`,
  `  ): Promise<PreparedRollPresentation> {\n    const logicalIds = new Set<string>();\n    for (const die of result.dice) {\n      if (logicalIds.has(die.id)) {\n        throw new UnsupportedRollError(\n          \`Normalized roll contains duplicate die id '\${die.id}'\`,\n          result,\n        );\n      }\n      logicalIds.add(die.id);\n    }\n    const requestedIds = internal.dieIds ?? options.dieIds;`,
  'renderer logical id boundary validation',
);
await writeFile('packages/renderer/src/index.ts', renderer);

let architecture = await readFile('docs/ARCHITECTURE.md', 'utf8');
architecture = replaceOrThrow(
  architecture,
  `- one physical-table registry as the sole owner of live canonical/generated/custom runtime bindings\n`,
  `- one physical-table registry as the sole owner of live canonical/generated/custom runtime bindings\n- normalized die IDs are logical identities scoped to one roll; live table ownership, planner assignments, launch state, effects, and group membership use physical/canonical/visual indexes instead of die-ID strings, so additive/concurrent rolls may safely reuse IDs such as \`die_1\`\n`,
  'architecture identity rule',
);
await writeFile('docs/ARCHITECTURE.md', architecture);

let staticTests = await readFile('scripts/test-visual-fallbacks.mjs', 'utf8');
staticTests = replaceOrThrow(
  staticTests,
  `assert.match(physicalTable, /preserveBindings/);\nassert.match(physicalTable, /Physical table canonical index is missing/);\nassert.match(engine, /physicalTable\\.visualInstances\\(\\)/);`,
  `assert.match(physicalTable, /preserveBindings/);\nassert.match(physicalTable, /Physical table canonical index is missing/);\nassert.match(physicalTable, /physicalIndexForVisual/);\nassert.match(physicalTable, /bindCanonicalAt/);\nassert.match(physicalTable, /bindVisualAt/);\nassert.doesNotMatch(physicalTable, /entriesById|entryById|physicalIndexForId/);\nassert.match(engine, /physicalTable\\.visualInstances\\(\\)/);\nassert.doesNotMatch(engine, /genericById|Generic physical visual ids must be unique/);\nassert.match(physicalVisuals, /visualIndex: number/);\nassert.doesNotMatch(physicalLaunch, /id: string/);`,
  'static runtime identity assertions',
);
await writeFile('scripts/test-visual-fallbacks.mjs', staticTests);

let updateTests = await readFile('scripts/test-roll-updates.mjs', 'utf8');
updateTests = replaceOrThrow(
  updateTests,
  `  const sdkModule = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);\n  const { Draftroll, DiceEngine, SeededRng } = sdkModule;`,
  `  const sdkModule = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);\n  const coreModule = await import(pathToFileURL(join(outDir, 'core/src/index.js')).href);\n  const { Draftroll, DiceEngine, SeededRng } = sdkModule;\n  const { normalizeExternalRoll } = coreModule;`,
  'core identity test import',
);
updateTests = replaceOrThrow(
  updateTests,
  `  const renderer = new StubRenderer();\n  const engine = new DiceEngine({ rng: new SeededRng('sdk-update-test') });\n  const draftroll = new Draftroll({ engine, renderer });`,
  `  const renderer = new StubRenderer();\n  const engine = new DiceEngine({ rng: new SeededRng('sdk-update-test') });\n  assert.throws(\n    () =>\n      engine.evaluate({\n        mode: 'evaluate',\n        dice: [\n          { id: 'same-die', type: 'd6', result: 2 },\n          { id: 'same-die', type: 'd8', result: 4 },\n        ],\n      }),\n    /Duplicate die id 'same-die' in structured roll/,\n  );\n  assert.throws(\n    () =>\n      normalizeExternalRoll({\n        dice: [\n          { id: 'same-die', type: 'd6', result: 2 },\n          { id: 'same-die', type: 'd8', result: 4 },\n        ],\n      }),\n    /Duplicate die id 'same-die' in external roll/,\n  );\n  const draftroll = new Draftroll({ engine, renderer });`,
  'logical id uniqueness tests',
);
await writeFile('scripts/test-roll-updates.mjs', updateTests);

await writeFile(
  'tests/browser/specs/additive-duplicate-id.spec.ts',
  `import { expect, test } from '@playwright/test';
import { waitForFixture } from '../support/fixture';

function physicalVisual(
  type: string,
  sides: number,
  outcomeIndex: number,
  result: number,
  canonicalKind?: 'd6',
) {
  return {
    id: 'die_1',
    type,
    sides,
    outcomeIndex,
    result,
    numericValue: result,
    ...(canonicalKind ? { canonicalKind } : {}),
    title: type,
    label: String(result),
    theme: 'dragon',
    outcome: 'neutral' as const,
  };
}

test('runtime table identity is independent from roll-scoped logical die ids', async ({ page }) => {
  await page.goto('/host.html');
  await waitForFixture(page);
  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');

  await frame.locator('body').evaluate(
    (physical) =>
      window.draftrollDice.roll({
        physical: [physical],
        visualOrder: [{ kind: 'physical', index: 0, dieId: 'die_1' }],
        seed: 'duplicate-generated-first',
        animationDurationMs: 720,
      }),
    physicalVisual('d9', 9, 3, 4),
  );

  await frame.locator('body').evaluate(
    (physical) =>
      window.draftrollDice.roll({
        physical: [physical],
        visualOrder: [{ kind: 'physical', index: 0, dieId: 'die_1' }],
        seed: 'duplicate-generated-second',
        animationDurationMs: 720,
        tableMode: 'add',
      }),
    physicalVisual('d11', 11, 6, 7),
  );

  await frame.locator('body').evaluate(
    (physical) =>
      window.draftrollDice.roll({
        physical: [physical],
        visualOrder: [{ kind: 'physical', index: 0, dieId: 'die_1' }],
        seed: 'duplicate-canonical-third',
        animationDurationMs: 720,
        tableMode: 'add',
      }),
    physicalVisual('d6', 6, 1, 2, 'd6'),
  );

  const snapshot = await frame
    .locator('body')
    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());
  expect(snapshot).toHaveLength(3);
  expect(snapshot.map((entry) => entry.id)).toEqual(['die_1', 'die_1', 'die_1']);
  expect(snapshot.map((entry) => entry.physicalIndex)).toEqual([0, 1, 2]);
  expect(snapshot.map((entry) => entry.implementation)).toEqual([
    'generated',
    'generated',
    'canonical',
  ]);
  expect(snapshot.map((entry) => entry.result)).toEqual([4, 7, 2]);
  expect(snapshot.every((entry) => entry.visible)).toBe(true);
});
`,
);

console.log('Applied runtime identity refactor');
