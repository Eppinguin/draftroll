import * as THREE from 'three';
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
