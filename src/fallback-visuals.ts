import * as THREE from 'three';
import { FallbackVisualInstance as BaseFallbackVisualInstance } from './fallback-visuals-base';
import { FallbackVisualInstance as GeneratedFallbackVisualInstance } from './generated-die-visuals';
import type { DraftrollFallbackVisual } from '../packages/renderer/src/index';

export interface FallbackVisualBounds {
  x: number;
  z: number;
}

const MAXIMUM_EXACT_GENERATED_SIDES = 256;

function usesGeneratedPhysics(spec: DraftrollFallbackVisual): boolean {
  if (spec.kind !== 'spinner') return false;
  const explicitSides = Number.isSafeInteger(spec.sides) ? spec.sides : undefined;
  const match = explicitSides === undefined ? /^d(\d+)$/i.exec(spec.type) : null;
  const sides = explicitSides ?? (match ? Number(match[1]) : NaN);
  return Number.isSafeInteger(sides) && sides >= 1 && sides <= MAXIMUM_EXACT_GENERATED_SIDES;
}

type VisualImplementation = BaseFallbackVisualInstance | GeneratedFallbackVisualInstance;

export class FallbackVisualInstance {
  readonly group: THREE.Group;
  readonly spec: DraftrollFallbackVisual;
  private readonly implementation: VisualImplementation;

  constructor(spec: DraftrollFallbackVisual) {
    this.spec = spec;
    this.implementation = usesGeneratedPhysics(spec)
      ? new GeneratedFallbackVisualInstance(spec)
      : new BaseFallbackVisualInstance(spec);
    this.group = this.implementation.group;
  }

  configureTrajectory(
    index: number,
    count: number,
    bounds: FallbackVisualBounds,
    random: () => number,
    occupied: THREE.Vector2[] = [],
  ): void {
    this.implementation.configureTrajectory(index, count, bounds, random, occupied);
  }

  update(progress: number, duration = 1): void {
    this.implementation.update(progress, duration);
  }

  settle(): void {
    this.implementation.settle();
  }

  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.implementation.getWorldPosition(target);
  }

  getSettledPosition(target = new THREE.Vector2()): THREE.Vector2 {
    return this.implementation.getSettledPosition(target);
  }

  getSettleTime(duration: number): number {
    return this.implementation.getSettleTime(duration);
  }

  dispose(): void {
    this.implementation.dispose();
  }
}
