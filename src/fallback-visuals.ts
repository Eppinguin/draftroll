import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type {
  DraftrollFallbackKind,
  DraftrollFallbackVisual,
} from '../packages/renderer/src/index';
import { createReadablePolyhedron, type ReadablePolyhedron } from '../packages/renderer/src/polyhedra';
import { THEMES, type ThemeName } from './themes';

export interface FallbackVisualBounds {
  x: number;
  z: number;
}

type VisualMode = 'sprite' | 'coin' | 'die' | 'card';

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
  mode: Exclude<VisualMode, 'sprite'>;
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  labelMaterial?: THREE.MeshBasicMaterial;
}

let shadowTexture: THREE.CanvasTexture | null = null;

function normalizeTheme(theme: string): ThemeName {
  return Object.hasOwn(THEMES, theme) ? (theme as ThemeName) : 'dragon';
}

function cssColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function getShadowTexture(): THREE.CanvasTexture {
  if (shadowTexture) return shadowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const gradient = context.createRadialGradient(128, 64, 4, 128, 64, 112);
  gradient.addColorStop(0, 'rgba(0,0,0,.48)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,.18)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 128);
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
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function createFallbackTexture(spec: DraftrollFallbackVisual): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 440;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const palette = THEMES[normalizeTheme(spec.theme)];
  roundedRect(context, 46, 36, 548, 368, 54);
  const fill = context.createLinearGradient(80, 40, 560, 400);
  fill.addColorStop(0, cssColor(palette.edge));
  fill.addColorStop(0.09, cssColor(palette.base));
  fill.addColorStop(0.75, cssColor(palette.shadow));
  fill.addColorStop(1, cssColor(palette.base));
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 12;
  context.strokeStyle = cssColor(palette.edge);
  context.stroke();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '800 138px system-ui, sans-serif';
  context.lineWidth = 12;
  context.strokeStyle = 'rgba(0,0,0,.65)';
  context.strokeText(String(spec.label), 320, 210);
  context.fillStyle = palette.label;
  context.fillText(String(spec.label), 320, 210);
  context.font = '600 30px system-ui, sans-serif';
  context.fillStyle = 'rgba(255,255,255,.86)';
  context.fillText(spec.title, 320, 354);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createDieSurfaceTexture(spec: DraftrollFallbackVisual): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const palette = THEMES[normalizeTheme(spec.theme)];
  const gradient = context.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, cssColor(palette.edge));
  gradient.addColorStop(0.12, cssColor(palette.base));
  gradient.addColorStop(0.68, cssColor(palette.base));
  gradient.addColorStop(1, cssColor(palette.shadow));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  context.globalAlpha = 0.11;
  context.strokeStyle = palette.label;
  context.lineWidth = 2;
  for (let i = -512; i < 1024; i += 28) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i - 512, 512);
    context.stroke();
  }
  context.globalAlpha = 0.08;
  for (let index = 0; index < 54; index += 1) {
    const x = (index * 193) % 512;
    const y = (index * 311) % 512;
    context.beginPath();
    context.arc(x, y, 1.5 + (index % 4), 0, Math.PI * 2);
    context.fillStyle = index % 2 ? '#ffffff' : '#000000';
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function metadataString(spec: DraftrollFallbackVisual, key: string): string | undefined {
  const value = spec.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function createCardFrontTexture(spec: DraftrollFallbackVisual): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 700;
  canvas.height = 980;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const rank = metadataString(spec, 'rank') ?? (spec.metadata?.joker ? '★' : String(spec.label));
  const suit = metadataString(spec, 'suitSymbol') ?? (spec.metadata?.joker ? '✦' : '');
  const red = spec.metadata?.color === 'red';
  const ink = red ? '#b51e2e' : '#151515';

  roundedRect(context, 12, 12, 676, 956, 48);
  context.fillStyle = '#faf8f1';
  context.fill();
  context.lineWidth = 12;
  context.strokeStyle = '#d5cdbd';
  context.stroke();

  context.fillStyle = ink;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 92px Georgia, serif';
  context.fillText(rank, 82, 86);
  context.font = '76px Georgia, serif';
  context.fillText(suit || '✦', 82, 168);

  context.save();
  context.translate(618, 894);
  context.rotate(Math.PI);
  context.font = '700 92px Georgia, serif';
  context.fillText(rank, 0, 0);
  context.font = '76px Georgia, serif';
  context.fillText(suit || '✦', 0, 82);
  context.restore();

  context.font = spec.metadata?.joker ? '260px Georgia, serif' : '330px Georgia, serif';
  context.fillText(spec.metadata?.joker ? '✦' : (suit || '✦'), 350, 475);
  if (spec.metadata?.joker) {
    context.font = '700 72px Georgia, serif';
    context.fillText('JOKER', 350, 700);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

function createCardBackTexture(spec: DraftrollFallbackVisual): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 700;
  canvas.height = 980;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const palette = THEMES[normalizeTheme(spec.theme)];
  roundedRect(context, 12, 12, 676, 956, 48);
  context.fillStyle = '#f8f5ec';
  context.fill();
  context.lineWidth = 12;
  context.strokeStyle = '#d5cdbd';
  context.stroke();
  roundedRect(context, 42, 42, 616, 896, 34);
  context.fillStyle = cssColor(palette.shadow);
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = cssColor(palette.edge);
  context.stroke();
  context.save();
  roundedRect(context, 58, 58, 584, 864, 26);
  context.clip();
  context.strokeStyle = cssColor(palette.edge);
  context.globalAlpha = 0.5;
  context.lineWidth = 4;
  for (let x = -900; x < 1200; x += 34) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + 980, 980);
    context.stroke();
    context.beginPath();
    context.moveTo(x + 980, 0);
    context.lineTo(x, 980);
    context.stroke();
  }
  context.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

function triangulateTexturedShape(shape: ReadablePolyhedron): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const basisU = new THREE.Vector3();
  const basisV = new THREE.Vector3();
  const point = new THREE.Vector3();

  for (const face of shape.faces) {
    if (face.length < 3) continue;
    a.fromArray(shape.vertices[face[0]]);
    b.fromArray(shape.vertices[face[1]]);
    c.fromArray(shape.vertices[face[2]]);
    normal.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    basisU.copy(b).sub(a).normalize();
    basisV.crossVectors(normal, basisU).normalize();
    const projected = face.map((vertexIndex) => {
      point.fromArray(shape.vertices[vertexIndex]);
      return { u: point.dot(basisU), v: point.dot(basisV) };
    });
    const minU = Math.min(...projected.map((value) => value.u));
    const maxU = Math.max(...projected.map((value) => value.u));
    const minV = Math.min(...projected.map((value) => value.v));
    const maxV = Math.max(...projected.map((value) => value.v));
    const spanU = Math.max(1e-5, maxU - minU);
    const spanV = Math.max(1e-5, maxV - minV);
    const uv = projected.map((value) => [
      0.08 + 0.84 * (value.u - minU) / spanU,
      0.08 + 0.84 * (value.v - minV) / spanV,
    ] as const);
    for (let index = 1; index + 1 < face.length; index += 1) {
      for (const localIndex of [0, index, index + 1]) {
        const vertex = shape.vertices[face[localIndex]];
        positions.push(vertex[0], vertex[1], vertex[2]);
        uvs.push(uv[localIndex][0], uv[localIndex][1]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function parseNumericSides(spec: DraftrollFallbackVisual): number | null {
  if (Number.isSafeInteger(spec.sides) && (spec.sides ?? 0) >= 1) return spec.sides!;
  const match = /^d(\d+)$/i.exec(spec.type);
  if (!match) return null;
  const sides = Number(match[1]);
  return Number.isSafeInteger(sides) && sides >= 1 ? sides : null;
}

function faceCenterAndNormal(shape: ReadablePolyhedron, faceIndex: number): { center: THREE.Vector3; normal: THREE.Vector3 } {
  const face = shape.faces[faceIndex];
  const points = face.map((index) => new THREE.Vector3(...shape.vertices[index]));
  const center = points.reduce((sum, value) => sum.add(value), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const normal = new THREE.Vector3()
    .crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0]))
    .normalize();
  if (normal.dot(center) < 0) normal.negate();
  return { center, normal };
}

function logicalResultIndex(spec: DraftrollFallbackVisual, sides: number): number {
  const numeric = typeof spec.result === 'number' ? spec.result : Number(spec.numericValue);
  if (Number.isFinite(numeric)) return Math.max(0, Math.round(numeric) - 1) % Math.max(1, sides);
  return 0;
}

function createFaceLabelTexture(spec: DraftrollFallbackVisual): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 320;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const palette = THEMES[normalizeTheme(spec.theme)];
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const label = String(spec.label);
  context.font = `800 ${label.length > 3 ? 132 : 176}px system-ui, sans-serif`;
  context.lineWidth = 18;
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(0,0,0,.75)';
  context.strokeText(label, 160, 160);
  context.fillStyle = palette.label;
  context.fillText(label, 160, 160);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createGeneratedDieVisual(spec: DraftrollFallbackVisual): ThreeDimensionalVisual | null {
  const sides = parseNumericSides(spec);
  if (spec.kind !== 'spinner' || sides === null) return null;
  const shape = createReadablePolyhedron(sides);
  const palette = THEMES[normalizeTheme(spec.theme)];
  const group = new THREE.Group();
  const surfaceTexture = createDieSurfaceTexture(spec);
  const geometry = triangulateTexturedShape(shape);
  const material = new THREE.MeshPhysicalMaterial({
    map: surfaceTexture,
    color: 0xffffff,
    roughness: 0.39,
    metalness: 0.22,
    clearcoat: 0.35,
    clearcoatRoughness: 0.28,
    flatShading: true,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const edgeGeometry = new THREE.EdgesGeometry(geometry, 18);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: palette.edge,
    transparent: true,
    opacity: 0,
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.scale.setScalar(1.004);
  group.add(edges);

  const logicalIndex = logicalResultIndex(spec, sides);
  const landingFace = shape.landingFaces[logicalIndex % shape.landingFaces.length] ?? 0;
  const { center, normal } = faceCenterAndNormal(shape, landingFace);
  const labelTexture = createFaceLabelTexture(spec);
  const labelMaterial = new THREE.MeshBasicMaterial({
    map: labelTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const labelGeometry = new THREE.PlaneGeometry(0.62, 0.62);
  const label = new THREE.Mesh(labelGeometry, labelMaterial);
  label.position.copy(center).addScaledVector(normal, 0.012);
  label.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  label.renderOrder = 7;
  group.add(label);

  // Orient the chosen authoritative result face upward at rest.
  const settledRotation = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 1, 0));
  group.userData.settledRotation = settledRotation;

  if (shape.family === 'd1-cylinder') group.scale.set(0.9, 0.9, 1.04);
  else if (shape.family === 'drum' || shape.family === 'representative') group.scale.set(1.08, 0.92, 1.08);

  return {
    mode: 'die',
    group,
    geometries: [geometry, edgeGeometry, labelGeometry],
    materials: [material, edgeMaterial, labelMaterial],
    textures: [surfaceTexture, labelTexture],
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
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: palette.edge, metalness: 0.58, roughness: 0.3, transparent: true, opacity: 0 });
  const capMaterial = new THREE.MeshStandardMaterial({ color: palette.base, metalness: 0.42, roughness: 0.36, transparent: true, opacity: 0 });
  cropCoinTexture(texture);
  const faceMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const backTexture = createFallbackTexture({ ...spec, label: spec.oppositeLabel ?? '•' });
  cropCoinTexture(backTexture);
  const backMaterial = new THREE.MeshBasicMaterial({ map: backTexture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const body = new THREE.Mesh(bodyGeometry, [edgeMaterial, capMaterial, capMaterial]);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.072;
  group.add(face);
  const back = new THREE.Mesh(faceGeometry, backMaterial);
  back.rotation.x = Math.PI / 2;
  back.position.y = -0.072;
  group.add(back);
  return { mode: 'coin', group, geometries: [bodyGeometry, faceGeometry], materials: [edgeMaterial, capMaterial, faceMaterial, backMaterial], textures: [backTexture] };
}

function createCardVisual(spec: DraftrollFallbackVisual): ThreeDimensionalVisual {
  const group = new THREE.Group();
  const width = 1.42;
  const height = 2.02;
  const thickness = 0.055;
  const bodyGeometry = new RoundedBoxGeometry(width, height, thickness, 4, 0.06);
  const frontGeometry = new THREE.PlaneGeometry(width * 0.96, height * 0.96);
  const backGeometry = frontGeometry.clone();
  const frontTexture = createCardFrontTexture(spec);
  const backTexture = createCardBackTexture(spec);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.55, metalness: 0, transparent: true, opacity: 0 });
  const frontMaterial = new THREE.MeshBasicMaterial({ map: frontTexture, transparent: true, opacity: 0, depthWrite: true, toneMapped: false, side: THREE.FrontSide });
  const backMaterial = new THREE.MeshBasicMaterial({ map: backTexture, transparent: true, opacity: 0, depthWrite: true, toneMapped: false, side: THREE.FrontSide });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const front = new THREE.Mesh(frontGeometry, frontMaterial);
  front.position.z = thickness / 2 + 0.003;
  front.renderOrder = 6;
  group.add(front);
  const back = new THREE.Mesh(backGeometry, backMaterial);
  back.position.z = -thickness / 2 - 0.003;
  back.rotation.y = Math.PI;
  back.renderOrder = 6;
  group.add(back);
  return {
    mode: 'card',
    group,
    geometries: [bodyGeometry, frontGeometry, backGeometry],
    materials: [bodyMaterial, frontMaterial, backMaterial],
    textures: [frontTexture, backTexture],
  };
}

function visualScale(kind: DraftrollFallbackKind): THREE.Vector2 {
  if (kind === 'token') return new THREE.Vector2(1.95, 1.28);
  if (kind === 'fate') return new THREE.Vector2(1.55, 1.55);
  return new THREE.Vector2(1.62, 1.16);
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

function easeOutBack(value: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (value - 1) ** 3 + c1 * (value - 1) ** 2;
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
    const nearest = occupied.reduce((distance, position) => Math.min(distance, candidate.distanceTo(position)), Number.POSITIVE_INFINITY);
    if (nearest >= minimumSeparation) return candidate.clone();
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best.copy(candidate);
    }
  }
  return best;
}

function cardSettledPosition(index: number, count: number, bounds: FallbackVisualBounds): THREE.Vector2 {
  const columns = Math.min(7, count);
  const row = Math.floor(index / columns);
  const column = index % columns;
  const rowCount = Math.min(columns, count - row * columns);
  const spacing = Math.min(1.15, (bounds.x * 2 - 1.8) / Math.max(1, rowCount));
  return new THREE.Vector2((column - (rowCount - 1) / 2) * spacing, -0.4 + row * 1.2);
}

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
    this.texture = createFallbackTexture(spec);
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: true, toneMapped: false, opacity: 0 });
    this.sprite = new THREE.Sprite(this.material);
    const scale = visualScale(spec.kind);
    this.sprite.scale.set(scale.x, scale.y, 1);
    this.sprite.renderOrder = 5;
    this.threeDimensional = spec.kind === 'coin'
      ? createCoinVisual(this.texture, spec)
      : spec.kind === 'card'
        ? createCardVisual(spec)
        : createGeneratedDieVisual(spec);
    this.group.add(this.threeDimensional?.group ?? this.sprite);

    this.shadowMaterial = new THREE.SpriteMaterial({ map: getShadowTexture(), transparent: true, opacity: 0, depthWrite: false, depthTest: true, toneMapped: false });
    this.shadow = new THREE.Sprite(this.shadowMaterial);
    this.shadow.scale.set(this.threeDimensional?.mode === 'card' ? 1.65 : scale.x * 0.82, this.threeDimensional?.mode === 'card' ? 0.72 : scale.y * 0.34, 1);
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
    const mode = this.threeDimensional?.mode ?? 'sprite';
    const isCard = mode === 'card';
    const end = isCard ? cardSettledPosition(index, count, bounds) : randomSettledPosition(count, bounds, occupied, random);
    occupied.push(end.clone());
    const fromLeft = index % 2 === 0;
    this.trajectory = {
      start: isCard
        ? new THREE.Vector3(-bounds.x + 0.9, 1.05 + index * 0.012, bounds.z - 0.95)
        : new THREE.Vector3(
            THREE.MathUtils.clamp(end.x + (fromLeft ? -1 : 1) * (1.5 + random() * 1.3), -bounds.x + 0.7, bounds.x - 0.7),
            2.4 + random() * 1.7,
            THREE.MathUtils.clamp(end.y + (random() - 0.5) * 2.2, -bounds.z + 0.7, bounds.z - 0.7),
          ),
      end: new THREE.Vector3(end.x, isCard ? 0.055 : 0.72, end.y),
      arcHeight: isCard ? 0.55 + Math.min(0.35, count * 0.025) : 1.8 + random() * 1.45,
      delay: isCard ? Math.min(0.48, index * 0.075) : Math.min(0.2, index * 0.025 + random() * 0.04),
      spinX: isCard ? 0 : (fromLeft ? 1 : -1) * (Math.PI * 4 + random() * Math.PI * 4),
      spinY: isCard ? Math.PI : (random() - 0.5) * Math.PI * 8,
      spinZ: isCard ? (random() - 0.5) * 0.22 : (random() - 0.5) * Math.PI * 6,
      finalYaw: isCard ? (index - (count - 1) / 2) * 0.045 : random() * Math.PI * 2,
    };
    this.settled = false;
    this.group.position.copy(this.trajectory.start);
    this.group.quaternion.identity();
    this.material.opacity = 0;
    for (const material of this.threeDimensional?.materials ?? []) {
      if ('opacity' in material) material.opacity = 0;
    }
    if (this.threeDimensional?.labelMaterial) this.threeDimensional.labelMaterial.opacity = 0;
    this.shadowMaterial.opacity = 0;
    this.group.scale.setScalar(isCard ? 1 : this.threeDimensional ? 1 : 0.55);
    this.group.visible = false;
  }

  update(progress: number, _planDuration = 1): void {
    if (this.settled || !this.trajectory) return;
    const trajectory = this.trajectory;
    const normalized = THREE.MathUtils.clamp((progress - trajectory.delay) / Math.max(0.001, 1 - trajectory.delay), 0, 1);
    this.group.visible = normalized > 0;
    if (normalized <= 0) return;
    const mode = this.threeDimensional?.mode ?? 'sprite';
    const opacity = THREE.MathUtils.clamp(normalized * 7, 0, 1);

    if (mode === 'card' && this.threeDimensional) {
      const travel = easeInOutCubic(normalized);
      this.group.position.lerpVectors(trajectory.start, trajectory.end, travel);
      this.group.position.y += Math.sin(normalized * Math.PI) * trajectory.arcHeight;
      const flip = THREE.MathUtils.smoothstep(normalized, 0.15, 0.78);
      const yaw = THREE.MathUtils.lerp(Math.PI, trajectory.finalYaw, flip);
      const pitch = THREE.MathUtils.lerp(-Math.PI / 2 + 0.15, -Math.PI / 2, THREE.MathUtils.smoothstep(normalized, 0.55, 1));
      const roll = trajectory.spinZ * Math.sin(normalized * Math.PI);
      this.threeDimensional.group.rotation.set(pitch, yaw, roll, 'XYZ');
      const settle = THREE.MathUtils.smoothstep(normalized, 0.82, 1);
      this.group.position.y += Math.sin(settle * Math.PI) * 0.035;
      for (const material of this.threeDimensional.materials) if ('opacity' in material) material.opacity = opacity;
    } else {
      const travel = easeOutCubic(normalized);
      this.group.position.lerpVectors(trajectory.start, trajectory.end, travel);
      const arc = Math.sin(normalized * Math.PI) * trajectory.arcHeight * (1 - normalized * 0.34);
      const settleBounce = normalized > 0.72 ? Math.sin((normalized - 0.72) * Math.PI * 7) * (1 - normalized) * 0.28 : 0;
      this.group.position.y = trajectory.end.y + arc + settleBounce;
      if (this.threeDimensional) {
        const spin = 1 - (1 - normalized) ** 2.35;
        const moving = new THREE.Quaternion().setFromEuler(new THREE.Euler(trajectory.spinX * spin, trajectory.spinY * spin, trajectory.spinZ * spin, 'XYZ'));
        let settledRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, trajectory.finalYaw, -0.06));
        if (mode === 'die') {
          const faceUp = this.threeDimensional.group.userData.settledRotation;
          if (faceUp instanceof THREE.Quaternion) {
            settledRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), trajectory.finalYaw).multiply(faceUp);
          }
        }
        this.threeDimensional.group.quaternion.copy(moving).slerp(settledRotation, THREE.MathUtils.smoothstep(normalized, 0.76, 1));
        for (const material of this.threeDimensional.materials) {
          if ('opacity' in material && material !== this.threeDimensional.labelMaterial) material.opacity = opacity;
        }
        if (this.threeDimensional.labelMaterial) this.threeDimensional.labelMaterial.opacity = THREE.MathUtils.smoothstep(normalized, 0.79, 0.96);
      } else {
        this.material.rotation += trajectory.spinZ / 180 * (1 - normalized);
        this.material.opacity = opacity;
        this.group.scale.setScalar(Math.max(0.2, easeOutBack(Math.min(1, normalized * 1.45))));
      }
    }

    const height = Math.max(0, this.group.position.y - trajectory.end.y);
    this.shadowMaterial.opacity = THREE.MathUtils.clamp((normalized - 0.08) * 1.5, 0, 0.34) * (1 - Math.min(0.8, height / 4));
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
    return this.trajectory ? target.set(this.trajectory.end.x, this.trajectory.end.z) : target.set(this.group.position.x, this.group.position.z);
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
