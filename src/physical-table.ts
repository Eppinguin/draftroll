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
 * registry owns only runtime identity and implementation bindings. Keeping those concerns separate
 * removes the previous canonical/generated parallel index arrays while preserving canonical bodies
 * where they are genuinely useful for the live table.
 */
export class PhysicalTableRegistry {
  private readonly entriesById = new Map<string, PhysicalTableEntry>();
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

  reset(specs: readonly PhysicalTableSpec[]): void {
    this.entriesById.clear();
    this.entriesInOrder.length = 0;
    this.canonicalEntriesInOrder.length = 0;
    this.visualEntriesInOrder.length = 0;
    this.append(specs);
  }

  append(specs: readonly PhysicalTableSpec[]): void {
    for (const spec of specs) {
      if (this.entriesById.has(spec.id)) {
        throw new Error(`Physical table already contains die id: ${spec.id}`);
      }
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
      this.entriesById.set(entry.id, entry);
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

  boundEntries(): PhysicalTableEntry[] {
    return this.entriesInOrder.filter((entry) => entry.die !== null || entry.visual !== null);
  }

  entryAt(physicalIndex: number): PhysicalTableEntry | undefined {
    return this.entriesInOrder[physicalIndex];
  }

  entryById(id: string): PhysicalTableEntry | undefined {
    return this.entriesById.get(id);
  }

  physicalIndexForId(id: string): number | null {
    return this.entriesById.get(id)?.physicalIndex ?? null;
  }

  canonicalIndex(physicalIndex: number): number {
    return this.entryAt(physicalIndex)?.canonicalIndex ?? -1;
  }

  visualIndex(physicalIndex: number): number {
    return this.entryAt(physicalIndex)?.visualIndex ?? -1;
  }

  physicalIndexForCanonical(canonicalIndex: number): number {
    return this.canonicalEntriesInOrder[canonicalIndex]?.physicalIndex ?? canonicalIndex;
  }

  bindCanonical(id: string, die: DieInstance): void {
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
  ): PhysicalTableEntry {
    const entry = this.entriesById.get(id);
    if (!entry || entry.implementation !== implementation) {
      throw new Error(`Physical table ${implementation} entry is missing: ${id}`);
    }
    return entry;
  }
}
