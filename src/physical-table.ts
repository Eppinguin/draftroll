import * as THREE from 'three';
import type { DieInstance } from './dice';
import type { PhysicalDieVisualInstance } from './physical-die-visuals';

export type PhysicalTableImplementation = 'canonical' | 'visual';

export interface PhysicalTableSpec {
  id: string;
  implementation: PhysicalTableImplementation;
}

export interface PhysicalTableEntry {
  id: string;
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
 * The ordered physical descriptor array remains authoritative for replay/protocol data; this
 * registry owns only runtime identity and implementation bindings. Logical die IDs are scoped to
 * one roll and may therefore repeat across additive/concurrent table groups. Physical order keeps
 * those live entries distinct while preserving canonical bodies where they are genuinely useful.
 */
export class PhysicalTableRegistry {
  private readonly entriesById = new Map<string, PhysicalTableEntry[]>();
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
  }

  append(specs: readonly PhysicalTableSpec[]): void {
    for (const spec of specs) {
      const entry: PhysicalTableEntry = {
        id: spec.id,
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
      const matchingEntries = this.entriesById.get(entry.id);
      if (matchingEntries) matchingEntries.push(entry);
      else this.entriesById.set(entry.id, [entry]);
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
        throw new Error(`Physical table visual entry is unbound: ${entry.id}`);
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

  entryById(id: string): PhysicalTableEntry | undefined {
    return this.entriesById.get(id)?.[0];
  }

  physicalIndexForId(id: string): number | null {
    return this.entriesById.get(id)?.[0]?.physicalIndex ?? null;
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

  bindCanonical(id: string, die: DieInstance): void {
    const entry = this.requireEntry(id, 'canonical', (candidate) => candidate.die === null);
    entry.die = die;
  }

  bindVisual(id: string, visual: PhysicalDieVisualInstance): void {
    const entry = this.requireEntry(id, 'visual', (candidate) => candidate.visual === null);
    entry.visual = visual;
  }

  unbindVisual(id: string): void {
    const entries = this.entriesById.get(id);
    const entry =
      entries?.find(
        (candidate) =>
          candidate.implementation === 'visual' &&
          candidate.visual !== null &&
          candidate.visual.group.parent === null,
      ) ??
      entries?.find(
        (candidate) => candidate.implementation === 'visual' && candidate.visual !== null,
      );
    if (entry) entry.visual = null;
  }

  unbindCanonical(id: string): void {
    const entry = this.entriesById
      .get(id)
      ?.find((candidate) => candidate.implementation === 'canonical' && candidate.die !== null);
    if (entry) entry.die = null;
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

  private requireEntry(
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
      throw new Error(`Physical table ${implementation} entry is missing: ${id}`);
    }
    return entry;
  }
}
