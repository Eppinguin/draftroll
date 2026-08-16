import * as THREE from 'three';
import type {
  DraftrollFallbackKind,
  DraftrollFallbackVisual,
} from '../packages/renderer/src/index';
import {
  createReadablePolyhedron,
  type PolyhedronLabelAnchor,
  type PolyhedronOutcome,
  type ReadablePolyhedron,
} from '../packages/renderer/src/polyhedra';
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
  finalScale: number;
}

interface ThreeDimensionalVisual {
  mode: Exclude<VisualMode, 'sprite'>;
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

interface CardLayout {
  position: THREE.Vector2;
  scale: number;
  yaw: number;
}

const CARD_WIDTH = 1.42;
const CARD_HEIGHT = 2.02;
const CARD_GAP = 0.18;
const CARD_ROW_GAP = 0.2;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
let shadowTexture: THREE.CanvasTexture | null = null;

function normalizeTheme(theme: string): ThemeName {
  return Object.hasOwn(THEMES, theme) ? theme : 'dragon';
}

function cssColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
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
  context.strokeText(spec.label, 320, 210);
  context.fillStyle = palette.label;
  context.fillText(spec.label, 320, 210);
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

  context.globalAlpha = 0.1;
  context.strokeStyle = palette.label;
  context.lineWidth = 2;
  for (let value = -512; value < 1024; value += 32) {
    context.beginPath();
    context.moveTo(value, 0);
    context.lineTo(value - 512, 512);
    context.stroke();
  }
  context.globalAlpha = 0.07;
  for (let index = 0; index < 48; index += 1) {
    const x = (index * 193) % 512;
    const y = (index * 311) % 512;
    context.beginPath();
    context.arc(x, y, 1.5 + (index % 4), 0, Math.PI * 2);
    context.fillStyle = index % 2 ? '#ffffff' : '#000000';
    context.fill();
  }
  context.globalAlpha = 1;

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

  const rank = metadataString(spec, 'rank') ?? (spec.metadata?.joker ? '★' : spec.label);
  const suit = metadataString(spec, 'suitSymbol') ?? (spec.metadata?.joker ? '✦' : '');
  const ink = spec.metadata?.color === 'red' ? '#b51e2e' : '#151515';

  context.fillStyle = '#fbf9f2';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const wash = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  wash.addColorStop(0, 'rgba(255,255,255,.34)');
  wash.addColorStop(0.55, 'rgba(255,255,255,0)');
  wash.addColorStop(1, 'rgba(137,116,86,.05)');
  context.fillStyle = wash;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = ink;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 92px Georgia, serif';
  context.fillText(rank, 78, 82);
  context.font = '76px Georgia, serif';
  context.fillText(suit || '✦', 78, 162);

  context.save();
  context.translate(622, 898);
  context.rotate(Math.PI);
  context.font = '700 92px Georgia, serif';
  context.fillText(rank, 0, 0);
  context.font = '76px Georgia, serif';
  context.fillText(suit || '✦', 0, 82);
  context.restore();

  context.font = spec.metadata?.joker ? '250px Georgia, serif' : '320px Georgia, serif';
  context.fillText(spec.metadata?.joker ? '✦' : suit || '✦', 350, 478);
  if (spec.metadata?.joker) {
    context.font = '700 70px Georgia, serif';
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

  context.fillStyle = '#fbf9f2';
  context.fillRect(0, 0, canvas.width, canvas.height);
  roundedRect(context, 26, 26, 648, 928, 38);
  context.fillStyle = cssColor(palette.shadow);
  context.fill();
  roundedRect(context, 42, 42, 616, 896, 30);
  context.strokeStyle = cssColor(palette.edge);
  context.lineWidth = 7;
  context.stroke();

  context.save();
  roundedRect(context, 50, 50, 600, 880, 26);
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
    const uv = projected.map(
      (value) =>
        [
          0.06 + (0.88 * (value.u - minU)) / spanU,
          0.06 + (0.88 * (value.v - minV)) / spanV,
        ] as const,
    );

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

function logicalResultValue(spec: DraftrollFallbackVisual, sides: number): number {
  const numeric = typeof spec.result === 'number' ? spec.result : Number(spec.numericValue);
  if (!Number.isFinite(numeric)) return 1;
  return THREE.MathUtils.clamp(Math.round(numeric), 1, Math.max(1, sides));
}

function createNumberTexture(
  spec: DraftrollFallbackVisual,
  value: number | string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const palette = THEMES[normalizeTheme(spec.theme)];
  const label = String(value);
  const length = label.length;

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.font = `800 ${length >= 3 ? 104 : length === 2 ? 128 : 154}px system-ui, sans-serif`;
  context.lineWidth = length >= 3 ? 12 : 14;
  context.strokeStyle = 'rgba(0,0,0,.7)';
  context.strokeText(label, 128, 126);
  context.fillStyle = palette.label;
  context.fillText(label, 128, 126);
  if (label === '6' || label === '9') {
    context.strokeStyle = palette.label;
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(93, 202);
    context.lineTo(163, 202);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function labelQuaternion(anchor: PolyhedronLabelAnchor): THREE.Quaternion {
  const normal = new THREE.Vector3(...anchor.normal).normalize();
  const up = new THREE.Vector3(...anchor.up).projectOnPlane(normal).normalize();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, normal);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

function labelsForShape(
  shape: ReadablePolyhedron,
  result: number,
): Array<{ outcome: PolyhedronOutcome; value: number }> {
  if (shape.exact) {
    return shape.outcomes.map((outcome) => ({ outcome, value: outcome.value }));
  }
  const outcome = shape.outcomes[(result - 1) % Math.max(1, shape.outcomes.length)];
  return outcome ? [{ outcome, value: result }] : [];
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

  const textures: THREE.Texture[] = [surfaceTexture];
  const geometries: THREE.BufferGeometry[] = [geometry, edgeGeometry];
  const materials: THREE.Material[] = [material, edgeMaterial];
  const result = logicalResultValue(spec, sides);
  const resultOutcome =
    shape.outcomes.find((outcome) => outcome.value === result) ??
    shape.outcomes[(result - 1) % Math.max(1, shape.outcomes.length)];

  const materialByValue = new Map<number, THREE.MeshBasicMaterial>();
  for (const { outcome, value } of labelsForShape(shape, result)) {
    let labelMaterial = materialByValue.get(value);
    if (!labelMaterial) {
      const texture = createNumberTexture(spec, value);
      labelMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      materialByValue.set(value, labelMaterial);
      textures.push(texture);
      materials.push(labelMaterial);
    }

    for (const anchor of outcome.labels) {
      const labelGeometry = new THREE.PlaneGeometry(anchor.scale, anchor.scale);
      const normal = new THREE.Vector3(...anchor.normal).normalize();
      const label = new THREE.Mesh(labelGeometry, labelMaterial);
      label.position.fromArray(anchor.position).addScaledVector(normal, 0.014);
      label.quaternion.copy(labelQuaternion(anchor));
      label.renderOrder = 7;
      group.add(label);
      geometries.push(labelGeometry);
    }
  }

  if (resultOutcome) {
    const settledUp = new THREE.Vector3(...resultOutcome.settledUp).normalize();
    group.userData.settledRotation = new THREE.Quaternion().setFromUnitVectors(settledUp, UP);
    group.userData.labelKind = resultOutcome.labelKind;
  }

  if (shape.family === 'd1-cylinder' || shape.family === 'd2-coin') {
    group.scale.set(0.9, 0.9, 1.04);
  } else if (shape.family === 'representative') {
    group.scale.set(1.08, 0.94, 1.08);
  }

  return { mode: 'die', group, geometries, materials, textures };
}

function cropCoinTexture(texture: THREE.CanvasTexture): void {
  texture.offset.set(100 / 640, 0);
  texture.repeat.set(440 / 640, 1);
  texture.needsUpdate = true;
}

function createCoinVisual(
  texture: THREE.CanvasTexture,
  spec: DraftrollFallbackVisual,
): ThreeDimensionalVisual {
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
    side: THREE.DoubleSide,
  });
  const backTexture = createFallbackTexture({ ...spec, label: spec.oppositeLabel ?? '•' });
  cropCoinTexture(backTexture);
  const backMaterial = new THREE.MeshBasicMaterial({
    map: backTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

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

  return {
    mode: 'coin',
    group,
    geometries: [bodyGeometry, faceGeometry],
    materials: [edgeMaterial, capMaterial, faceMaterial, backMaterial],
    textures: [backTexture],
  };
}

function createRoundedCardShape(width: number, height: number, radius: number): THREE.Shape {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const r = Math.min(radius, halfWidth, halfHeight);
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + r, -halfHeight);
  shape.lineTo(halfWidth - r, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + r);
  shape.lineTo(halfWidth, halfHeight - r);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - r, halfHeight);
  shape.lineTo(-halfWidth + r, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - r);
  shape.lineTo(-halfWidth, -halfHeight + r);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + r, -halfHeight);
  return shape;
}

function normalizeCardUvs(geometry: THREE.BufferGeometry, width: number, height: number): void {
  const positions = geometry.getAttribute('position');
  const uv = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index += 1) {
    uv[index * 2] = THREE.MathUtils.clamp((positions.getX(index) + width / 2) / width, 0, 1);
    uv[index * 2 + 1] = THREE.MathUtils.clamp((positions.getY(index) + height / 2) / height, 0, 1);
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

function createCardVisual(spec: DraftrollFallbackVisual): ThreeDimensionalVisual {
  const group = new THREE.Group();
  const thickness = 0.048;
  const shape = createRoundedCardShape(CARD_WIDTH, CARD_HEIGHT, 0.115);
  const bodyGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    bevelEnabled: true,
    bevelSize: 0.014,
    bevelThickness: 0.01,
    bevelSegments: 3,
    curveSegments: 18,
  });
  bodyGeometry.center();
  bodyGeometry.computeBoundingBox();
  const surfaceZ =
    Math.max(thickness / 2, bodyGeometry.boundingBox?.max.z ?? thickness / 2) + 0.0015;

  const frontGeometry = new THREE.ShapeGeometry(shape, 18);
  normalizeCardUvs(frontGeometry, CARD_WIDTH, CARD_HEIGHT);
  const backGeometry = frontGeometry.clone();
  const frontTexture = createCardFrontTexture(spec);
  const backTexture = createCardBackTexture(spec);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f1e8,
    roughness: 0.68,
    metalness: 0,
    transparent: true,
    opacity: 0,
  });
  const frontMaterial = new THREE.MeshBasicMaterial({
    map: frontTexture,
    transparent: true,
    opacity: 0,
    depthWrite: true,
    toneMapped: false,
    side: THREE.FrontSide,
  });
  const backMaterial = new THREE.MeshBasicMaterial({
    map: backTexture,
    transparent: true,
    opacity: 0,
    depthWrite: true,
    toneMapped: false,
    side: THREE.FrontSide,
  });

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const front = new THREE.Mesh(frontGeometry, frontMaterial);
  front.position.z = surfaceZ;
  front.renderOrder = 6;
  group.add(front);
  const back = new THREE.Mesh(backGeometry, backMaterial);
  back.position.z = -surfaceZ;
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

function cardSettledLayout(index: number, count: number, bounds: FallbackVisualBounds): CardLayout {
  const availableWidth = Math.max(CARD_WIDTH * 0.5, bounds.x * 2 - 1.1);
  const availableDepth = Math.max(CARD_HEIGHT * 0.5, bounds.z * 2 - 1.2);
  let bestColumns = 1;
  let bestScale = 0;

  for (let columns = 1; columns <= Math.min(7, count); columns += 1) {
    const rows = Math.ceil(count / columns);
    const scaleByWidth =
      (availableWidth - Math.max(0, columns - 1) * CARD_GAP) / (columns * CARD_WIDTH);
    const scaleByDepth =
      (availableDepth - Math.max(0, rows - 1) * CARD_ROW_GAP) / (rows * CARD_HEIGHT);
    const scale = Math.min(1, scaleByWidth, scaleByDepth);
    if (scale > bestScale) {
      bestScale = scale;
      bestColumns = columns;
    }
  }

  const scale = THREE.MathUtils.clamp(bestScale, 0.32, 1);
  const rows = Math.ceil(count / bestColumns);
  const row = Math.floor(index / bestColumns);
  const column = index % bestColumns;
  const rowCount = Math.min(bestColumns, count - row * bestColumns);
  const xStep = CARD_WIDTH * scale + CARD_GAP;
  const zStep = CARD_HEIGHT * scale + CARD_ROW_GAP;
  const x = (column - (rowCount - 1) / 2) * xStep;
  const z = (row - (rows - 1) / 2) * zStep;
  const yaw = THREE.MathUtils.clamp((column - (rowCount - 1) / 2) * 0.018, -0.045, 0.045);
  return { position: new THREE.Vector2(x, z), scale, yaw };
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
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      opacity: 0,
    });
    this.sprite = new THREE.Sprite(this.material);
    const scale = visualScale(spec.kind);
    this.sprite.scale.set(scale.x, scale.y, 1);
    this.sprite.renderOrder = 5;

    this.threeDimensional =
      spec.kind === 'coin'
        ? createCoinVisual(this.texture, spec)
        : spec.kind === 'card'
          ? createCardVisual(spec)
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
    this.shadow.scale.set(
      this.threeDimensional?.mode === 'card' ? 1.45 : scale.x * 0.82,
      this.threeDimensional?.mode === 'card' ? 0.62 : scale.y * 0.34,
      1,
    );
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
    const cardLayout = isCard ? cardSettledLayout(index, count, bounds) : null;
    const end = cardLayout?.position ?? randomSettledPosition(count, bounds, occupied, random);
    occupied.push(end.clone());
    const fromLeft = index % 2 === 0;

    this.trajectory = {
      start: isCard
        ? new THREE.Vector3(-bounds.x + 0.86, 1.02 + index * 0.012, bounds.z - 0.88)
        : new THREE.Vector3(
            THREE.MathUtils.clamp(
              end.x + (fromLeft ? -1 : 1) * (1.5 + random() * 1.3),
              -bounds.x + 0.7,
              bounds.x - 0.7,
            ),
            2.4 + random() * 1.7,
            THREE.MathUtils.clamp(end.y + (random() - 0.5) * 2.2, -bounds.z + 0.7, bounds.z - 0.7),
          ),
      end: new THREE.Vector3(end.x, isCard ? 0.045 : 0.72, end.y),
      arcHeight: isCard ? 0.5 + Math.min(0.3, count * 0.022) : 1.8 + random() * 1.45,
      delay: isCard
        ? Math.min(0.52, index * 0.078)
        : Math.min(0.2, index * 0.025 + random() * 0.04),
      spinX: isCard ? 0 : (fromLeft ? 1 : -1) * (Math.PI * 4 + random() * Math.PI * 4),
      spinY: isCard ? Math.PI : (random() - 0.5) * Math.PI * 8,
      spinZ: isCard ? (random() - 0.5) * 0.1 : (random() - 0.5) * Math.PI * 6,
      finalYaw: cardLayout?.yaw ?? random() * Math.PI * 2,
      finalScale: cardLayout?.scale ?? 1,
    };

    this.settled = false;
    this.group.position.copy(this.trajectory.start);
    this.group.quaternion.identity();
    this.material.opacity = 0;
    for (const material of this.threeDimensional?.materials ?? []) {
      if ('opacity' in material) material.opacity = 0;
    }
    this.shadowMaterial.opacity = 0;
    this.group.scale.setScalar(
      isCard ? this.trajectory.finalScale : this.threeDimensional ? 1 : 0.55,
    );
    this.group.visible = false;
  }

  update(progress: number, _planDuration = 1): void {
    if (this.settled || !this.trajectory) return;
    const trajectory = this.trajectory;
    const normalized = THREE.MathUtils.clamp(
      (progress - trajectory.delay) / Math.max(0.001, 1 - trajectory.delay),
      0,
      1,
    );
    this.group.visible = normalized > 0;
    if (normalized <= 0) return;

    const mode = this.threeDimensional?.mode ?? 'sprite';
    const opacity = THREE.MathUtils.clamp(normalized * 7, 0, 1);

    if (mode === 'card' && this.threeDimensional) {
      const travel = easeInOutCubic(normalized);
      this.group.position.lerpVectors(trajectory.start, trajectory.end, travel);
      this.group.position.y += Math.sin(normalized * Math.PI) * trajectory.arcHeight;

      const flip = THREE.MathUtils.smoothstep(normalized, 0.2, 0.82);
      const flatFaceUp = new THREE.Quaternion().setFromUnitVectors(FORWARD, UP);
      const faceUp = new THREE.Quaternion()
        .setFromAxisAngle(UP, trajectory.finalYaw)
        .multiply(flatFaceUp);
      const faceDown = faceUp
        .clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
      this.threeDimensional.group.quaternion.copy(faceDown).slerp(faceUp, flip);
      this.threeDimensional.group.rotateZ(trajectory.spinZ * Math.sin(normalized * Math.PI));

      const settle = THREE.MathUtils.smoothstep(normalized, 0.84, 1);
      this.group.position.y += Math.sin(settle * Math.PI) * 0.026;
      this.group.scale.setScalar(trajectory.finalScale);
      for (const material of this.threeDimensional.materials) {
        if ('opacity' in material) material.opacity = opacity;
      }
    } else {
      const travel = easeOutCubic(normalized);
      this.group.position.lerpVectors(trajectory.start, trajectory.end, travel);
      const arc = Math.sin(normalized * Math.PI) * trajectory.arcHeight * (1 - normalized * 0.34);
      const settleBounce =
        normalized > 0.72
          ? Math.sin((normalized - 0.72) * Math.PI * 7) * (1 - normalized) * 0.28
          : 0;
      this.group.position.y = trajectory.end.y + arc + settleBounce;

      if (this.threeDimensional) {
        const spin = 1 - (1 - normalized) ** 2.35;
        const moving = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            trajectory.spinX * spin,
            trajectory.spinY * spin,
            trajectory.spinZ * spin,
            'XYZ',
          ),
        );
        let settledRotation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0.12, trajectory.finalYaw, -0.06),
        );
        if (mode === 'die') {
          const generatedRotation = this.threeDimensional.group.userData.settledRotation;
          if (generatedRotation instanceof THREE.Quaternion) {
            settledRotation = new THREE.Quaternion()
              .setFromAxisAngle(UP, trajectory.finalYaw)
              .multiply(generatedRotation);
          }
        }
        this.threeDimensional.group.quaternion
          .copy(moving)
          .slerp(settledRotation, THREE.MathUtils.smoothstep(normalized, 0.76, 1));
        for (const material of this.threeDimensional.materials) {
          if ('opacity' in material) material.opacity = opacity;
        }
      } else {
        this.material.rotation += (trajectory.spinZ / 180) * (1 - normalized);
        this.material.opacity = opacity;
        this.group.scale.setScalar(Math.max(0.2, easeOutBack(Math.min(1, normalized * 1.45))));
      }
    }

    const height = Math.max(0, this.group.position.y - trajectory.end.y);
    this.shadowMaterial.opacity =
      THREE.MathUtils.clamp((normalized - 0.08) * 1.5, 0, 0.34) * (1 - Math.min(0.8, height / 4));
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
