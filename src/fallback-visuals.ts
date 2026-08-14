import * as THREE from 'three';
import { FallbackVisualInstance as BaseFallbackVisualInstance } from './fallback-visuals-base';
import { PhysicalDieVisualInstance, usesPhysicalDieModel } from './physical-die-visuals';
import type { DraftrollFallbackVisual } from '../packages/renderer/src/index';

export interface FallbackVisualBounds {
  x: number;
  z: number;
}

type VisualImplementation = BaseFallbackVisualInstance | PhysicalDieVisualInstance;

/**
 * Non-die visual router.
 *
 * Numeric spinner entries are legacy renderer inputs, but exact dN values are promoted immediately
 * into the first-class physical-die model. Cards, tokens, Fate, percentile, and representative
 * high-count visuals remain true fallbacks.
 */
export class FallbackVisualInstance {
  readonly group: THREE.Group;
  readonly spec: DraftrollFallbackVisual;
  private readonly implementation: VisualImplementation;

  constructor(spec: DraftrollFallbackVisual) {
    this.spec = spec;
    this.implementation = usesPhysicalDieModel(spec)
      ? new PhysicalDieVisualInstance(spec)
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
