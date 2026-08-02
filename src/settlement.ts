export interface RecordedDiceTrajectory {
  step: number;
  frameCount: number;
  dieCount: number;
  transforms: Float32Array;
  activationDelays?: Float32Array;
}

export interface SettlementDetectionOptions {
  /** Maximum final-position drift that still counts as settled. Defaults to 2.5 cm. */
  positionTolerance?: number;
  /** Maximum final-orientation drift in radians. Defaults to 3 degrees. */
  angularToleranceRadians?: number;
}

/**
 * Finds the earliest recorded time from which each die remains at its final
 * pose. Walking backward from the authoritative final frame avoids firing an
 * effect during a temporary pause before a later collision.
 */
export function deriveDieSettleTimes(
  trajectory: RecordedDiceTrajectory,
  options: SettlementDetectionOptions = {},
): Float32Array {
  const { step, frameCount, dieCount, transforms } = trajectory;
  if (!Number.isFinite(step) || step <= 0 || frameCount < 1 || dieCount < 0) {
    throw new Error('Recorded dice trajectory dimensions are invalid');
  }
  const expectedLength = frameCount * dieCount * 7;
  if (transforms.length !== expectedLength) {
    throw new Error(`Recorded dice trajectory contains ${transforms.length} values; expected ${expectedLength}`);
  }
  if (trajectory.activationDelays && trajectory.activationDelays.length !== dieCount) {
    throw new Error('Recorded dice activation delays do not match the die count');
  }

  const positionTolerance = Math.max(0, options.positionTolerance ?? 0.025);
  const positionToleranceSquared = positionTolerance * positionTolerance;
  const angularTolerance = Math.max(0, options.angularToleranceRadians ?? Math.PI / 60);
  const minimumQuaternionDot = Math.cos(angularTolerance / 2);
  const frameStride = dieCount * 7;
  const finalFrame = frameCount - 1;
  const times = new Float32Array(dieCount);

  for (let dieIndex = 0; dieIndex < dieCount; dieIndex += 1) {
    const finalOffset = finalFrame * frameStride + dieIndex * 7;
    const finalX = transforms[finalOffset];
    const finalY = transforms[finalOffset + 1];
    const finalZ = transforms[finalOffset + 2];
    const finalQx = transforms[finalOffset + 3];
    const finalQy = transforms[finalOffset + 4];
    const finalQz = transforms[finalOffset + 5];
    const finalQw = transforms[finalOffset + 6];
    let firstStableFrame = finalFrame;

    for (let frame = finalFrame - 1; frame >= 0; frame -= 1) {
      const offset = frame * frameStride + dieIndex * 7;
      const dx = transforms[offset] - finalX;
      const dy = transforms[offset + 1] - finalY;
      const dz = transforms[offset + 2] - finalZ;
      if (dx * dx + dy * dy + dz * dz > positionToleranceSquared) break;

      const quaternionDot = Math.abs(
        transforms[offset + 3] * finalQx
        + transforms[offset + 4] * finalQy
        + transforms[offset + 5] * finalQz
        + transforms[offset + 6] * finalQw
      );
      if (quaternionDot < minimumQuaternionDot) break;
      firstStableFrame = frame;
    }

    const activationDelay = trajectory.activationDelays?.[dieIndex] ?? 0;
    times[dieIndex] = Math.max(activationDelay, firstStableFrame * step);
  }
  return times;
}

/**
 * Atomically claims visuals whose settlement time has elapsed. A claimed ID is
 * never returned again, even if a later additive trajectory contains it.
 */
export function consumeSettledVisualIndexes(
  visualIds: readonly string[],
  settleTimes: ArrayLike<number>,
  currentTime: number,
  consumed: Set<string>,
): number[] {
  if (visualIds.length !== settleTimes.length) {
    throw new Error('Settlement visual IDs and timestamps must have equal lengths');
  }
  const indexes: number[] = [];
  for (let index = 0; index < visualIds.length; index += 1) {
    const id = visualIds[index];
    const settleTime = settleTimes[index];
    if (!Number.isFinite(settleTime) || settleTime > currentTime + 1e-6 || consumed.has(id)) continue;
    consumed.add(id);
    indexes.push(index);
  }
  return indexes;
}
