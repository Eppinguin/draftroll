import * as THREE from 'three';

export interface PhysicalLaunchBounds {
  x: number;
  z: number;
}

export interface PhysicalLaunchParticipant {
  id: string;
  radius: number;
  coinLike?: boolean;
}

export interface PhysicalLaunchState {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  velocity: [number, number, number];
  angularVelocity: [number, number, number];
  delay: number;
  target: [number, number];
}

export interface PhysicalLaunchOptions {
  bounds: PhysicalLaunchBounds;
  random: () => number;
  throwDirection: THREE.Vector2;
  handBias: number;
  gravity?: number;
  delayOffset?: number;
}

interface LaunchSpawn {
  position: THREE.Vector3;
  scatterKey: number;
  releaseDelay: number;
}

interface ScatterBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface HandClusterBounds {
  centerX: number;
  centerY: number;
  centerZ: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}

function maximumRadius(participants: readonly PhysicalLaunchParticipant[]): number {
  return Math.max(0.25, ...participants.map((participant) => participant.radius));
}

function createOrganicPointCloud(
  count: number,
  bounds: ScatterBounds,
  minimumDistance: number,
  random: () => number,
  candidateCount = 48,
): THREE.Vector2[] {
  if (count <= 0) return [];
  const points: THREE.Vector2[] = [];
  const width = Math.max(0.001, bounds.maxX - bounds.minX);
  const depth = Math.max(0.001, bounds.maxZ - bounds.minZ);
  for (let index = 0; index < count; index += 1) {
    let best = new THREE.Vector2(
      THREE.MathUtils.lerp(bounds.minX, bounds.maxX, random()),
      THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, random()),
    );
    let bestScore = -Infinity;
    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
      const candidate = new THREE.Vector2(
        THREE.MathUtils.lerp(bounds.minX, bounds.maxX, random()),
        THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, random()),
      );
      let nearest = Infinity;
      for (const point of points) nearest = Math.min(nearest, candidate.distanceToSquared(point));
      const nx = (candidate.x - (bounds.minX + bounds.maxX) * 0.5) / width;
      const nz = (candidate.y - (bounds.minZ + bounds.maxZ) * 0.5) / depth;
      const centerPenalty = (nx * nx + nz * nz) * minimumDistance * minimumDistance * 0.025;
      const score =
        (points.length === 0 ? minimumDistance * minimumDistance : nearest) - centerPenalty;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    points.push(best);
  }

  const iterations = 96;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const progress = iteration / Math.max(1, iterations - 1);
    const jitter = minimumDistance * 0.035 * (1 - progress) * (1 - progress);
    for (let left = 0; left < points.length; left += 1) {
      const point = points[left];
      point.x += (random() - 0.5) * jitter;
      point.y += (random() - 0.5) * jitter;
      for (let right = left + 1; right < points.length; right += 1) {
        const other = points[right];
        let dx = other.x - point.x;
        let dz = other.y - point.y;
        let distance = Math.hypot(dx, dz);
        if (distance >= minimumDistance) continue;
        if (distance < 1e-5) {
          const angle = random() * Math.PI * 2;
          dx = Math.cos(angle) * 1e-3;
          dz = Math.sin(angle) * 1e-3;
          distance = 1e-3;
        }
        const correction = (minimumDistance - distance) * 0.5;
        const normalX = dx / distance;
        const normalZ = dz / distance;
        point.x -= normalX * correction;
        point.y -= normalZ * correction;
        other.x += normalX * correction;
        other.y += normalZ * correction;
      }
      point.x = THREE.MathUtils.clamp(point.x, bounds.minX, bounds.maxX);
      point.y = THREE.MathUtils.clamp(point.y, bounds.minZ, bounds.maxZ);
    }
  }
  return points;
}

function clampPointToEllipsoid(point: THREE.Vector3, bounds: HandClusterBounds): void {
  const nx = (point.x - bounds.centerX) / Math.max(0.001, bounds.halfX);
  const ny = (point.y - bounds.centerY) / Math.max(0.001, bounds.halfY);
  const nz = (point.z - bounds.centerZ) / Math.max(0.001, bounds.halfZ);
  const normalizedLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (normalizedLength <= 0.985) return;
  const scale = 0.985 / normalizedLength;
  point.set(
    bounds.centerX + nx * scale * bounds.halfX,
    bounds.centerY + ny * scale * bounds.halfY,
    bounds.centerZ + nz * scale * bounds.halfZ,
  );
}

function sampleEllipsoid(bounds: HandClusterBounds, random: () => number): THREE.Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let lengthSquared = 2;
  while (lengthSquared > 1 || lengthSquared < 0.0001) {
    x = random() * 2 - 1;
    y = random() * 2 - 1;
    z = random() * 2 - 1;
    lengthSquared = x * x + y * y + z * z;
  }
  return new THREE.Vector3(
    bounds.centerX + x * bounds.halfX,
    bounds.centerY + y * bounds.halfY,
    bounds.centerZ + z * bounds.halfZ,
  );
}

function minimumSpawnDistance(points: readonly THREE.Vector3[]): number {
  let minimum = Infinity;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      minimum = Math.min(minimum, points[left].distanceTo(points[right]));
    }
  }
  return points.length < 2 ? Infinity : minimum;
}

function createHandCluster(
  participants: readonly PhysicalLaunchParticipant[],
  boundsInput: PhysicalLaunchBounds,
  random: () => number,
  horizontalBias: number,
): LaunchSpawn[] {
  const count = participants.length;
  if (count === 0) return [];
  const radius = maximumRadius(participants);
  const diameter = radius * 2;
  const safeSpacing = Math.max(1.1, diameter * 1.012);
  const root = Math.sqrt(count);
  const largePool = count >= 12;
  let halfX = Math.min(boundsInput.x - 0.9, largePool ? 1.48 + root * 0.58 : 0.92 + root * 0.39);
  let halfZ = Math.min(
    largePool ? 2.42 : 1.92,
    largePool ? 0.82 + root * 0.31 : 0.58 + root * 0.235,
  );
  let halfY = Math.min(largePool ? 2.1 : 2.8, largePool ? 0.72 + root * 0.29 : 0.52 + root * 0.39);
  const centerXLimit = Math.max(0, boundsInput.x - halfX - 0.92);
  const centerX = THREE.MathUtils.clamp(
    horizontalBias * boundsInput.x * 0.32,
    -centerXLimit,
    centerXLimit,
  );
  const centerZ = boundsInput.z - halfZ - 0.82;
  let bounds: HandClusterBounds = {
    centerX,
    centerY: (largePool ? 1.06 : 1.18) + halfY,
    centerZ,
    halfX,
    halfY,
    halfZ,
  };
  let points: THREE.Vector3[] = [];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    points = [];
    const candidatesPerPoint = count > 20 ? 220 : count > 10 ? 180 : 105;
    for (let index = 0; index < count; index += 1) {
      let best = sampleEllipsoid(bounds, random);
      let bestScore = -Infinity;
      for (let candidateIndex = 0; candidateIndex < candidatesPerPoint; candidateIndex += 1) {
        const candidate = sampleEllipsoid(bounds, random);
        let nearest = Infinity;
        for (const point of points) nearest = Math.min(nearest, candidate.distanceToSquared(point));
        const vertical = (candidate.y - bounds.centerY) / bounds.halfY;
        const depth = (candidate.z - bounds.centerZ) / bounds.halfZ;
        const palmBias = vertical * 0.018 + depth * 0.01;
        const score = (points.length === 0 ? safeSpacing * safeSpacing : nearest) - palmBias;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      points.push(best);
    }

    const packingIterations = largePool ? 168 : 120;
    for (let iteration = 0; iteration < packingIterations; iteration += 1) {
      const progress = iteration / Math.max(1, packingIterations - 1);
      for (let left = 0; left < points.length; left += 1) {
        const point = points[left];
        for (let right = left + 1; right < points.length; right += 1) {
          const other = points[right];
          const delta = other.clone().sub(point);
          let distance = delta.length();
          if (distance >= safeSpacing) continue;
          if (distance < 1e-5) {
            delta.set(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
            distance = 1e-3;
          } else {
            delta.multiplyScalar(1 / distance);
          }
          const correction = (safeSpacing - distance) * 0.505;
          point.addScaledVector(delta, -correction);
          other.addScaledVector(delta, correction);
        }
        const inward = new THREE.Vector3(bounds.centerX, bounds.centerY, bounds.centerZ).sub(point);
        point.addScaledVector(inward, 0.0018 * (1 - progress));
        clampPointToEllipsoid(point, bounds);
      }
    }

    if (minimumSpawnDistance(points) >= safeSpacing * 0.93) break;
    halfX = Math.min(boundsInput.x - 0.9, halfX + (largePool ? 0.16 : 0.08));
    halfZ = Math.min(largePool ? 2.65 : 2.08, halfZ + (largePool ? 0.11 : 0.055));
    halfY = Math.min(largePool ? 2.35 : 3.2, halfY + (largePool ? 0.12 : 0.24));
    bounds = {
      centerX,
      centerY: (largePool ? 1.06 : 1.18) + halfY,
      centerZ: boundsInput.z - halfZ - 0.82,
      halfX,
      halfY,
      halfZ,
    };
  }

  const handYaw = (random() - 0.5) * 0.22;
  const cos = Math.cos(handYaw);
  const sin = Math.sin(handYaw);
  const result = points.map((point) => {
    const dx = point.x - bounds.centerX;
    const dz = point.z - bounds.centerZ;
    return {
      position: new THREE.Vector3(
        bounds.centerX + dx * cos - dz * sin,
        point.y,
        bounds.centerZ + dx * sin + dz * cos,
      ),
      scatterKey: random() - 0.5,
      releaseDelay: 0,
    };
  });
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  if (largePool) {
    const ordered = result
      .map((spawn, index) => ({
        index,
        key: spawn.position.x * 0.72 - spawn.position.z * 0.28 + spawn.position.y * 0.08,
      }))
      .toSorted((left, right) => left.key - right.key);
    const waveSize = count >= 24 ? 7 : 6;
    const waveInterval = count >= 24 ? 0.105 : 0.115;
    ordered.forEach((entry, rank) => {
      const wave = Math.floor(rank / waveSize);
      result[entry.index].releaseDelay = wave * waveInterval + random() * 0.018;
    });
  }
  return result;
}

function createHandTargets(
  participants: readonly PhysicalLaunchParticipant[],
  spawns: readonly LaunchSpawn[],
  bounds: PhysicalLaunchBounds,
  random: () => number,
  throwDirection: THREE.Vector2,
): THREE.Vector2[] {
  const count = spawns.length;
  if (count === 0) return [];
  const handCenter = spawns
    .reduce(
      (sum, spawn) => sum.add(new THREE.Vector2(spawn.position.x, spawn.position.z)),
      new THREE.Vector2(),
    )
    .multiplyScalar(1 / count);
  const side = new THREE.Vector2(-throwDirection.y, throwDirection.x);
  const root = Math.sqrt(count);
  const travel = THREE.MathUtils.clamp(
    (count >= 12 ? 4.35 : 4.9) + root * (count >= 12 ? 0.16 : 0.18),
    count >= 12 ? 4.35 : 4.9,
    count >= 12 ? 5.35 : 6.0,
  );
  const destination = handCenter.clone().addScaledVector(throwDirection, travel);
  destination.x = THREE.MathUtils.clamp(destination.x, -bounds.x + 2.0, bounds.x - 2.0);
  destination.y = THREE.MathUtils.clamp(destination.y, -bounds.z + 1.75, bounds.z - 2.0);
  const radius = maximumRadius(participants);
  const targetSpacing = Math.max(0.76, radius * (count > 20 ? 1.16 : count > 12 ? 1.24 : 1.3));
  const sideSpread = Math.min(
    bounds.x * 0.78,
    (count >= 12 ? 1.62 : 1.18) + root * (count >= 12 ? 0.55 : 0.51),
  );
  const depthSpread = Math.min(
    count >= 12 ? 2.65 : 2.2,
    (count >= 12 ? 1.02 : 0.78) + root * (count >= 12 ? 0.31 : 0.27),
  );
  const localCloud = createOrganicPointCloud(
    count,
    { minX: -sideSpread, maxX: sideSpread, minZ: -depthSpread, maxZ: depthSpread },
    targetSpacing,
    random,
    count > 20 ? 34 : 46,
  );
  const spawnOrder = spawns
    .map((spawn, index) => {
      const relative = new THREE.Vector2(spawn.position.x, spawn.position.z).sub(handCenter);
      return { index, key: relative.dot(side) + spawn.scatterKey * 0.75 };
    })
    .toSorted((a, b) => a.key - b.key);
  const targetOrder = localCloud
    .map((target, index) => ({ index, key: target.x + (random() - 0.5) * 0.7 }))
    .toSorted((a, b) => a.key - b.key);
  const swaps = Math.floor(count * 0.28);
  for (let index = 0; index < swaps; index += 1) {
    const left = Math.floor(random() * Math.max(1, count - 1));
    const right = Math.min(count - 1, left + (random() > 0.72 ? 2 : 1));
    [targetOrder[left], targetOrder[right]] = [targetOrder[right], targetOrder[left]];
  }
  const targets = Array.from({ length: count }, () => new THREE.Vector2());
  for (let rank = 0; rank < count; rank += 1) {
    const spawnIndex = spawnOrder[rank].index;
    const local = localCloud[targetOrder[rank].index];
    const target = destination
      .clone()
      .addScaledVector(side, local.x)
      .addScaledVector(throwDirection, local.y);
    targets[spawnIndex].set(
      THREE.MathUtils.clamp(target.x, -bounds.x + 0.92, bounds.x - 0.92),
      THREE.MathUtils.clamp(target.y, -bounds.z + 0.92, bounds.z - 0.92),
    );
  }
  return targets;
}

function estimateFirstImpactTime(
  positionY: number,
  velocityY: number,
  radius: number,
  gravity: number,
): number {
  const landingHeight = Math.max(0.62, radius * 0.94);
  const drop = Math.max(0.05, positionY - landingHeight);
  return (velocityY + Math.sqrt(velocityY * velocityY + 2 * gravity * drop)) / gravity;
}

export function createPhysicalLaunchStates(
  participants: readonly PhysicalLaunchParticipant[],
  options: PhysicalLaunchOptions,
): PhysicalLaunchState[] {
  if (participants.length === 0) return [];
  const { bounds, random, throwDirection, handBias } = options;
  const gravity = Math.max(0.1, options.gravity ?? 20.5);
  const delayOffset = Math.max(0, options.delayOffset ?? 0);
  const spawns = createHandCluster(participants, bounds, random, handBias);
  const targets = createHandTargets(participants, spawns, bounds, random, throwDirection);
  const handCenter = spawns
    .reduce((sum, spawn) => sum.add(spawn.position), new THREE.Vector3())
    .multiplyScalar(1 / Math.max(1, spawns.length));
  const side = new THREE.Vector2(-throwDirection.y, throwDirection.x);
  const crowded = participants.length > 15;
  const largePool = participants.length >= 12;
  const maximumHorizontalSpeed = crowded
    ? 7.35
    : largePool
      ? 7.75
      : participants.length > 8
        ? 8.55
        : 9.4;
  const minimumHorizontalSpeed = crowded
    ? 4.65
    : largePool
      ? 4.95
      : participants.length > 8
        ? 5.7
        : 6.25;
  const globalWristTwist = (random() - 0.5) * (crowded ? 2.2 : 3.1);
  const releaseWindow =
    participants.length <= 2
      ? 0
      : THREE.MathUtils.lerp(
          0.024,
          largePool ? 0.09 : 0.056,
          THREE.MathUtils.clamp((participants.length - 3) / 27, 0, 1),
        );

  return participants.map((participant, index) => {
    const spawn = spawns[index];
    const position = spawn.position;
    const sharedPitch = -0.28 + (random() - 0.5) * 0.28;
    const sharedYaw = Math.atan2(throwDirection.x, -throwDirection.y) + (random() - 0.5) * 0.46;
    const quaternion = new THREE.Quaternion();
    if (participant.coinLike) {
      quaternion.setFromEuler(
        new THREE.Euler(
          (random() - 0.5) * 0.32,
          sharedYaw + (random() - 0.5) * Math.PI,
          (random() - 0.5) * 0.32,
        ),
      );
    } else {
      quaternion.setFromEuler(
        new THREE.Euler(
          sharedPitch + (random() - 0.5) * Math.PI * 0.9,
          sharedYaw + (random() - 0.5) * Math.PI * 0.75,
          (random() - 0.5) * Math.PI * 1.15,
        ),
      );
    }
    const target = targets[index];
    const radius = Math.max(0.25, participant.radius);
    const rollingRadius = Math.max(0.44, radius * 0.9);
    const relativeX = position.x - handCenter.x;
    const relativeY = position.y - handCenter.y;
    const relativeZ = position.z - handCenter.z;
    const localSide = relativeX * side.x + relativeZ * side.y;
    const localForward = relativeX * throwDirection.x + relativeZ * throwDirection.y;
    const normalish = random() + random() + random() - 1.5;
    const desiredVelocityY =
      (largePool ? 1.72 : 2.15) +
      random() * (largePool ? 1.05 : 1.25) +
      THREE.MathUtils.clamp(relativeY * 0.1, -0.18, 0.25);
    const headroom = Math.max(0.18, 9.0 - position.y);
    const ceilingSafeVelocityY = Math.sqrt(2 * gravity * headroom) * 0.72;
    const velocityY = Math.max(0.72, Math.min(desiredVelocityY, ceilingSafeVelocityY));
    const flightTime = Math.max(
      0.42,
      estimateFirstImpactTime(position.y, velocityY, radius, gravity),
    );
    let velocityX = (target.x - position.x) / flightTime;
    let velocityZ = (target.y - position.z) / flightTime;
    const palmFan = THREE.MathUtils.clamp(localSide * 0.21, -0.65, 0.65) + normalish * 0.16;
    velocityX += side.x * palmFan + throwDirection.x * (0.12 + random() * 0.22);
    velocityZ += side.y * palmFan + throwDirection.y * (0.12 + random() * 0.22);
    velocityX += (random() - 0.5) * (crowded ? 0.34 : 0.48);
    velocityZ += (random() - 0.5) * (crowded ? 0.3 : 0.42);
    const horizontalSpeed = Math.hypot(velocityX, velocityZ);
    if (horizontalSpeed < minimumHorizontalSpeed) {
      const scale = minimumHorizontalSpeed / Math.max(0.001, horizontalSpeed);
      velocityX *= scale;
      velocityZ *= scale;
    } else if (horizontalSpeed > maximumHorizontalSpeed) {
      const scale = maximumHorizontalSpeed / horizontalSpeed;
      velocityX *= scale;
      velocityZ *= scale;
    }
    const rollingX = velocityZ / rollingRadius;
    const rollingZ = -velocityX / rollingRadius;
    const rollingBlend = crowded ? 0.82 : largePool ? 0.77 : 0.7;
    const tumble = crowded ? 4.15 : largePool ? 4.45 : 4.25;
    const angularVelocity = participant.coinLike
      ? [
          rollingX * 1.22 + (random() - 0.5) * 1.25,
          globalWristTwist * 0.12 + (random() - 0.5) * 0.7,
          rollingZ * 1.22 + (random() - 0.5) * 1.25,
        ]
      : [
          rollingX * rollingBlend +
            (random() - 0.5) * tumble +
            throwDirection.y * globalWristTwist * 0.34,
          globalWristTwist + (random() - 0.5) * (crowded ? 3.0 : 4.0),
          rollingZ * rollingBlend +
            (random() - 0.5) * tumble -
            throwDirection.x * globalWristTwist * 0.34,
        ];
    const forwardPhase = THREE.MathUtils.clamp((localForward + 1.4) / 2.8, 0, 1);
    const heightPhase = THREE.MathUtils.clamp((relativeY + 2.2) / 4.4, 0, 1);
    const delay =
      delayOffset +
      spawn.releaseDelay +
      releaseWindow *
        THREE.MathUtils.clamp(
          (1 - forwardPhase) * 0.42 + heightPhase * 0.38 + random() * 0.2,
          0,
          1,
        );
    return {
      position: [position.x, position.y, position.z],
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      velocity: [velocityX, velocityY, velocityZ],
      angularVelocity: [angularVelocity[0], angularVelocity[1], angularVelocity[2]],
      delay,
      target: [target.x, target.y],
    };
  });
}
