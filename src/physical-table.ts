import * as THREE from 'three';
import type { DieInstance } from './dice';
import type { PhysicalDieVisualInstance } from './physical-die-visuals';

export type PhysicalTableImplementation = 'canonical' | 'visual';

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
  private entriesInOrder: PhysicalTableEntry[] = [];
  private canonicalCountValue = 0;
  private visualCountValue = 0;

  get size(): number {
    return this.entriesInOrder.length;
  }

  get canonicalCount(): number {
    return this.canonicalCountValue;
  }

  get visualCount(): number {
    return this.visualCountValue;
  }

  reset(specs: readonly { id: string; canonicalKind?: string }[]): void {
    this.entriesById.clear();
    this.entriesInOrder = [];
    this.canonicalCountValue = 0;
    this.visualCountValue = 0;
    this.append(specs);
  }

  append(specs: readonly { id: string; canonicalKind?: string }[]): void {
    for (const spec of specs) {
      if (this.entriesById.has(spec.id)) {
        throw new Error(`Physical table already contains die id: ${spec.id}`);
      }
      const implementation: PhysicalTableImplementation = spec.canonicalKind ? 'canonical' : 'visual';
      const entry: PhysicalTableEntry = {
        id: spec.id,
        physicalIndex: this.entriesInOrder.length,
        implementation,
        canonicalIndex: implementation === 'canonical' ? this.canonicalCountValue++ : null,
        visualIndex: implementation === 'visual' ? this.visualCountValue++ : null,
        die: null,
        visual: null,
      };
      this.entriesInOrder.push(entry);
      this.entriesById.set(entry.id, entry);
    }
  }

  entries(): readonly PhysicalTableEntry[] {
    return this.entriesInOrder;
  }

  canonicalEntries(): PhysicalTableEntry[] {
    return this.entriesInOrder.filter((entry) => entry.implementation === 'canonical');
  }

  visualEntries(): PhysicalTableEntry[] {
    return this.entriesInOrder.filter((entry) => entry.implementation === 'visual');
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
    return this.canonicalEntries()[canonicalIndex]?.physicalIndex ?? canonicalIndex;
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

  visualInstances(): PhysicalDieVisualInstance[] {
    return this.visualEntries().flatMap((entry) => (entry.visual ? [entry.visual] : []));
  }

  worldPosition(physicalIndex: number, target = new THREE.Vector3()): THREE.Vector3 | null {
    const entry = this.entryAt(physicalIndex);
    if (!entry) return null;
    if (entry.die) return target.copy(entry.die.getWorldPosition());
    if (entry.visual) return entry.visual.getWorldPosition(target);
    return null;
  }

  findByObject(object: THREE.Object3D): PhysicalTableEntry | null {
    for (const entry of this.boundEntries()) {
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

  private requireEntry(id: string, implementation: PhysicalTableImplementation): PhysicalTableEntry {
    const entry = this.entriesById.get(id);
    if (!entry || entry.implementation !== implementation) {
      throw new Error(`Physical table ${implementation} entry is missing: ${id}`);
    }
    return entry;
  }
}
