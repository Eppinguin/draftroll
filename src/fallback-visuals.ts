import * as THREE from 'three';
import type {
  DraftrollFallbackKind,
  DraftrollFallbackVisual,
} from '../packages/renderer/src/index';
import { createReadablePolyhedron } from '../packages/renderer/src/polyhedra';
import { THEMES, type ThemeName } from './themes';

export interface FallbackVisualBounds {
  x: number;
  z: number;
}

interface Trajectory {
  start: THREE.Vector3;
  end: THREE.Vector3;
  arcHeight: number;
  delay: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  finalYaw: number;
}

interface ThreeDimensionalVisual {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  labelMaterial?: THREE.SpriteMaterial;
}

let shadowTexture: THREE.CanvasTexture | null = null;

function getShadowTexture(): THREE.CanvasTexture {
  if (shadowTexture) return shadowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const gradient = context.createRadialGradient(128, 64, 4, 128, 64, 112);
  gradient.addColorStop(0, 'rgba(0,0,0,.5)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,.2)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  shadowTexture = new THREE.CanvasTexture(canvas);
  shadowTexture.colorSpace = THREE.SRGBColorSpace;
  return shadowTexture;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function polygon(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  sides: number,
): void {
  context.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = -Math.PI / 2 + (index / sides) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

function normalizeTheme(theme: string): ThemeName {
  return Object.prototype.hasOwnProperty.call(THEMES, theme) ? theme as ThemeName : 'dragon';
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(1, maximum - 1))}…`;
}

function createVisualTexture(spec: DraftrollFallbackVisual): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 440;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const palette = THEMES[normalizeTheme(spec.theme)];
  const base = `#${palette.base.toString(16).padStart(6, '0')}`;
  const edge = `#${palette.edge.toString(16).padStart(6, '0')}`;
  const shadow = `#${palette.shadow.toString(16).padStart(6, '0')}`;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.shadowColor = 'rgba(0,0,0,.55)';
  context.shadowBlur = 28;
  context.shadowOffsetY = 14;

  if (spec.kind === 'coin') {
    context.beginPath();
    context.arc(canvas.width / 2, canvas.height / 2, 188, 0, Math.PI * 2);
  } else if (spec.kind === 'percentile') {
    polygon(context, canvas.width / 2, canvas.height / 2, 188, 10);
  } else if (spec.kind === 'fate') {
    roundedRect(context, 130, 30, 380, 380, 62);
  } else if (spec.kind === 'token') {
    roundedRect(context, 84, 66, 472, 308, 100);
  } else {
    roundedRect(context, 62, 42, 516, 356, spec.kind === 'card' ? 48 : 88);
  }

  const fill = context.createLinearGradient(120, 70, 520, 390);
  fill.addColorStop(0, edge);
  fill.addColorStop(0.08, base);
  fill.addColorStop(0.72, shadow);
  fill.addColorStop(1, base);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 14;
  context.strokeStyle = edge;
  context.stroke();
  context.restore();

  const label = truncate(spec.label, 14);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.font = `700 ${label.length > 6 ? 104 : 146}px system-ui, sans-serif`;
  context.lineWidth = 14;
  context.strokeStyle = 'rgba(0,0,0,.62)';
  context.strokeText(label, canvas.width / 2, canvas.height / 2 + 12);
  context.fillStyle = palette.label;
  context.shadowColor = palette.labelGlow;
  context.shadowBlur = 18;
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 12);

  context.shadowBlur = 0;
  context.font = '600 34px system-ui, sans-serif';
  context.fillStyle = 'rgba(255,255,255,.88)';
  context.fillText(truncate(spec.title, 28), canvas.width / 2, canvas.height - 54);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createResultLabelTexture(spec: DraftrollFallbackVisual): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const palette = THEMES[normalizeTheme(spec.theme)];
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  const label = truncate(spec.label, 10);
  context.font = `800 ${label.length > 4 ? 118 : 156}px system-ui, sans-serif`;
  context.lineWidth = 18;
  context.strokeStyle = 'rgba(0,0,0,.82)';
  context.strokeText(label, canvas.width / 2, 118);
  context.fillStyle = palette.label;
  context.shadowColor = palette.labelGlow;
  context.shadowBlur = 22;
  context.fillText(label, canvas.width / 2, 118);
  context.shadowBlur = 0;
  context.font = '650 31px system-ui, sans-serif';
  context.fillStyle = 'rgba(255,255,255,.9)';
  context.fillText(truncate(spec.title, 20), canvas.width / 2, 218);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function triangulateFaces(vertices: readonly (readonly [number, number, number])[], faces: readonly number[][]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    for (let index = 1; index + 1 < face.length; index += 1) {
      for (const vertexIndex of [face[0], face[index], face[index + 1]]) {
        const vertex = vertices[vertexIndex];
        positions.push(vertex[0], vertex[1], vertex[2]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function parseNumericSides(spec: DraftrollFallbackVisual): number | null {
  if (typeof spec.sides === 'number' && Number.isSafeInteger(spec.sides) && spec.sides >= 1) return spec.sides;
  const match = /^d(\d+)$/i.exec(spec.type);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function createGeneratedDieVisual(spec: DraftrollFallbackVisual): ThreeDimensionalVisual | null {
  const sides = parseNumericSides(spec);
  if (spec.kind !== 'spinner' || sides === null) return null;
  const shape = createReadablePolyhedron(sides);
  const palette = THEMES[normalizeTheme(spec.theme)];
  const group = new THREE.Group();
  const geometry = triangulateFaces(shape.vertices, shape.faces);
  const material = new THREE.MeshPhysicalMaterial({
    color: palette.base,
    emissive: palette.shadow,
    emissiveIntensity: 0.13,
    metalness: 0.28,
    roughness: 0.34,
    clearcoat: 0.42,
    clearcoatRoughness: 0.24,
    flatShading: true,
    transparent: true,
    opacity: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const edgeGeometry = new THREE.EdgesGeometry(geometry, 12);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: palette.edge,
    transparent: true,
    opacity: 0,
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.scale.setScalar(1.006);
  group.add(edges);

  const labelTexture = createResultLabelTexture(spec);
  const labelMaterial = new THREE.SpriteMaterial({
    map: labelTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const label = new THREE.Sprite(labelMaterial);
  label.scale.set(1.35, 0.9, 1);
  label.position.y = 0.34;
  label.renderOrder = 8;
  group.add(label);

  // d1 is intentionally longer; high-count drums are slightly wider so the silhouette reads.
  if (shape.family === 'd1-cylinder') group.scale.set(0.78, 0.78, 1.08);
  else if (shape.family === 'drum' || shape.family === 'representative') group.scale.set(1.08, 0.92, 1.08);

  return {
    group,
    geometries: [geometry, edgeGeometry],
    materials: [material, edgeMaterial, labelMaterial],
    textures: [labelTexture],
    labelMaterial,
  };
}

function cropCoinTexture(texture: THREE.CanvasTexture): void {
  texture.offset.set(100 / 640, 0);
  texture.repeat.set(440 / 640, 1);
  texture.needsUpdate = true;
}

function createCoinVisual(texture: THREE.CanvasTexture, spec: DraftrollFallbackVisual): ThreeDimensionalVisual {
  const palette = THEMES[normalizeTheme(spec.theme)];
  const group = new THREE.Group();
  const bodyGeometry = new THREE.CylinderGeometry(0.76, 0.76, 0.14, 64, 1, false);
  const faceGeometry = new THREE.CircleGeometry(0.69, 64);
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: palette.edge,
    metalness: 0.58,
    roughness: 0.3,
    transparent: true,
    opacity: 0,
  });
  const capMaterial = new THREE.MeshStandardMaterial({
    color: palette.base,
    metalness: 0.42,
    roughness: 0.36,
    transparent: true,
    opacity: 0,
  });

  cropCoinTexture(texture);
  const faceMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    side: THREE.FrontSide,
  });
  const backTexture = createVisualTexture({ ...spec, label: spec.oppositeLabel ?? '•' });
  cropCoinTexture(backTexture);
  const backMaterial = new THREE.MeshBasicMaterial({
    map: backTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    side: THREE.FrontSide,
  });

  const body = new THREE.Mesh(bodyGeometry, [edgeMaterial, capMaterial, capMaterial]);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.072;
  face.renderOrder = 6;
  group.add(face);
  const back = new THREE.Mesh(faceGeometry, backMaterial);
  back.rotation.x = Math.PI / 2;
  back.position.y = -0.072;
  back.renderOrder = 6;
  group.add(back);

  return {
    group,
    geometries: [bodyGeometry, faceGeometry],
    materials: [edgeMaterial, capMaterial, faceMaterial, backMaterial],
    textures: [backTexture],
  };
}

function visualScale(kind: DraftrollFallbackKind): THREE.Vector2 {
  if (kind === 'card') return new THREE.Vector2(2.15, 1.48);
  if (kind === 'token') return new THREE.Vector2(1.95, 1.28);
  if (kind === 'fate') return new THREE.Vector2(1.55, 1.55);
  return new THREE.Vector2(1.62, 1.16);
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function easeOutBack(value: number): number {
  const overshoot = 1.70158;
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
}

function randomSettledPosition(
  count: number,
  bounds: FallbackVisualBounds,
  occupied: readonly THREE.Vector2[],
  random: () => number,
): THREE.Vector2 {
  const rangeX = Math.max(0.2, bounds.x - 0.95);
  const rangeZ = Math.max(0.2, bounds.z - 0.95);
  const minimumSeparation = count <= 12 ? 1.72 : count <= 20 ? 1.46 : 1.22;
  const candidate = new THREE.Vector2();
  const best = new THREE.Vector2();
  let bestDistance = -1;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    candidate.set((random() * 2 - 1) * rangeX, (random() * 2 - 1) * rangeZ);
    const nearest = occupied.reduce(
      (distance, position) => Math.min(distance, candidate.distanceTo(position)),
      Number.POSITIVE_INFINITY,
    );
    if (nearest >= minimumSeparation) return candidate.clone();
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best.copy(candidate);
    }
  }
  return best;
}

/**
 * Presentation object for non-standard results.
 *
 * Numeric `spinner` fallbacks are rendered as real 3D solids. Their result is still authoritative
 * before animation; the result label fades in only during settlement, following Dicebox's useful
 * separation between motion geometry and logical result presentation.
 */
export class FallbackVisualInstance {
  readonly group = new THREE.Group();
  readonly spec: DraftrollFallbackVisual;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private readonly sprite: THREE.Sprite;
  private readonly threeDimensional: ThreeDimensionalVisual | null;
  private readonly shadowMaterial: THREE.SpriteMaterial;
  private readonly shadow: THREE.Sprite;
  private trajectory: Trajectory | null = null;
  private settled = false;

  constructor(spec: DraftrollFallbackVisual) {
    this.spec = spec;
    this.texture = createVisualTexture(spec);
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    const scale = visualScale(spec.kind);
    this.sprite.scale.set(scale.x, scale.y, 1);
    this.sprite.renderOrder = 5;

    this.threeDimensional = spec.kind === 'coin'
      ? createCoinVisual(this.texture, spec)
      : createGeneratedDieVisual(spec);
    this.group.add(this.threeDimensional?.group ?? this.sprite);

    this.shadowMaterial = new THREE.SpriteMaterial({
      map: getShadowTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.shadow = new THREE.Sprite(this.shadowMaterial);
    this.shadow.scale.set(scale.x * 0.82, scale.y * 0.34, 1);
    this.shadow.position.y = -0.38;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
    this.group.visible = false;
  }

  configureTrajectory(
    index: number,
    count: number,
    bounds: FallbackVisualBounds,
    random: () => number,
    occupied: THREE.Vector2[] = [],
  ): void {
    const end = randomSettledPosition(count, bounds, occupied, random);
    occupied.push(end.clone());
    const fromLeft = index % 2 === 0;
    const is3d = this.threeDimensional !== null;
    this.trajectory = {
      start: new THREE.Vector3(
        is3d
          ? THREE.MathUtils.clamp(end.x + (fromLeft ? -1 : 1) * (1.5 + random() * 1.3), -bounds.x + 0.7, bounds.x - 0.7)
          : (fromLeft ? -bounds.x - 1.05 : bounds.x + 1.05) + (random() - 0.5) * 0.8,
        is3d ? 2.4 + random() * 1.7 : 2.8 + random() * 1.6,
        is3d
          ? THREE.MathUtils.clamp(end.y + (random() - 0.5) * 2.2, -bounds.z + 0.7, bounds.z - 0.7)
          : (random() * 2 - 1) * bounds.z,
      ),
      end: new THREE.Vector3(end.x, is3d ? 0.72 : 0.48, end.y),
      arcHeight: is3d ? 1.8 + random() * 1.45 : 2.1 + random() * 1.5,
      delay: Math.min(0.2, index * 0.025 + random() * 0.04),
      spinX: (fromLeft ? 1 : -1) * (Math.PI * 4 + random() * Math.PI * 4),
      spinY: (random() - 0.5) * Math.PI * 8,
      spinZ: (random() - 0.5) * Math.PI * 6,
      finalYaw: random() * Math.PI * 2,
    };
    this.settled = false;
    this.group.position.copy(this.trajectory.start);
    this.group.quaternion.identity();
    this.material.rotation = (random() - 0.5) * Math.PI;
    this.material.opacity = 0;
    for (const material of this.threeDimensional?.materials ?? []) {
      if ('opacity' in material) material.opacity = 0;
    }
    if (this.threeDimensional?.labelMaterial) this.threeDimensional.labelMaterial.opacity = 0;
    this.shadowMaterial.opacity = 0;
    this.group.scale.setScalar(is3d ? 1 : 0.55);
    this.group.visible = false;
  }

  update(progress: number, _planDuration = 1): void {
    if (this.settled) return;
    const trajectory = this.trajectory;
    if (!trajectory) return;
    const normalized = THREE.MathUtils.clamp(
      (progress - trajectory.delay) / Math.max(0.001, 1 - trajectory.delay),
      0,
      1,
    );
    this.group.visible = normalized > 0;
    if (normalized <= 0) return;

    const travel = easeOutCubic(normalized);
    this.group.position.lerpVectors(trajectory.start, trajectory.end, travel);
    const arc = Math.sin(normalized * Math.PI) * trajectory.arcHeight * (1 - normalized * 0.34);
    const settleBounce = normalized > 0.72
      ? Math.sin((normalized - 0.72) * Math.PI * 7) * (1 - normalized) * 0.28
      : 0;
    this.group.position.y = trajectory.end.y + arc + settleBounce;

    const opacity = THREE.MathUtils.clamp(normalized * 5, 0, 1);
    if (this.threeDimensional) {
      const spin = 1 - Math.pow(1 - normalized, 2.35);
      const settleBlend = THREE.MathUtils.smoothstep(normalized, 0.78, 1);
      const moving = new THREE.Euler(
        trajectory.spinX * spin,
        trajectory.spinY * spin,
        trajectory.spinZ * spin,
        'XYZ',
      );
      const movingQuaternion = new THREE.Quaternion().setFromEuler(moving);
      const settledQuaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.18, trajectory.finalYaw, -0.08, 'XYZ'),
      );
      this.threeDimensional.group.quaternion.copy(movingQuaternion).slerp(settledQuaternion, settleBlend);
      for (const material of this.threeDimensional.materials) {
        if ('opacity' in material && material !== this.threeDimensional.labelMaterial) material.opacity = opacity;
      }
      if (this.threeDimensional.labelMaterial) {
        this.threeDimensional.labelMaterial.opacity = THREE.MathUtils.smoothstep(normalized, 0.72, 0.94);
      }
    } else {
      this.material.rotation += (trajectory.spinZ / 180) * (1 - normalized);
      this.material.opacity = opacity;
      const scale = easeOutBack(Math.min(1, normalized * 1.45));
      this.group.scale.setScalar(Math.max(0.2, scale));
    }

    this.shadowMaterial.opacity =
      THREE.MathUtils.clamp((normalized - 0.12) * 1.4, 0, 0.34) *
      (1 - Math.min(0.78, Math.max(0, arc) / 4));
    this.shadow.position.y = 0.02 - this.group.position.y;
  }

  settle(): void {
    if (this.settled) return;
    this.update(1, 1);
    this.settled = true;
  }

  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.group.getWorldPosition(target);
  }

  getSettledPosition(target = new THREE.Vector2()): THREE.Vector2 {
    return this.trajectory
      ? target.set(this.trajectory.end.x, this.trajectory.end.z)
      : target.set(this.group.position.x, this.group.position.z);
  }

  getSettleTime(planDuration: number): number {
    return planDuration;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    for (const geometry of this.threeDimensional?.geometries ?? []) geometry.dispose();
    for (const material of this.threeDimensional?.materials ?? []) material.dispose();
    for (const texture of this.threeDimensional?.textures ?? []) texture.dispose();
    this.shadowMaterial.dispose();
  }
}
