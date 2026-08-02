import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createDiePhysicsShape, DIE_RADIUS, type DieKind } from './physics-shapes';
export type { DieKind } from './physics-shapes';

import { THEMES, type ThemeName, type ThemePalette } from './themes';
import {
  getRuntimeThemeFont,
  getRuntimeThemeMaterial,
  getRuntimeThemeMesh,
  getRuntimeThemeTexture,
} from './runtime-themes';
export { THEMES, type ThemeName, type ThemePalette } from './themes';

const VALUE_ORDERS: Record<Exclude<DieKind, 'd4'>, number[]> = {
  d6: [1, 6, 2, 5, 3, 4],
  d8: [8, 3, 6, 1, 5, 2, 7, 4],
  d10: [1, 8, 3, 6, 5, 10, 7, 4, 9, 2],
  d12: [12, 4, 9, 2, 7, 11, 5, 10, 1, 8, 3, 6],
  d20: [20, 2, 14, 8, 19, 3, 12, 6, 17, 9, 1, 18, 4, 15, 7, 13, 5, 16, 10, 11],
};



interface LogicalFace {
  normal: THREE.Vector3;
  center: THREE.Vector3;
  vertices: THREE.Vector3[];
  value: number;
}

interface GeometrySet {
  visual: THREE.BufferGeometry;
  collider: THREE.BufferGeometry;
}

interface SurfaceSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

interface LabelBinding {
  uvOffset: number;
  faceIndex?: number;
  vertexIndex?: number;
}

interface LabelSet {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  bindings: LabelBinding[];
}

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function lerpColor(a: number, b: number, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, t).getHexString()}`;
}

function createD10Geometry(radius: number): THREE.BufferGeometry {
  const vertices: number[] = [0, radius * 1.16, 0, 0, -radius * 1.16, 0];
  const indices: number[] = [];
  const ringRadius = radius * 0.96;
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
    vertices.push(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius);
  }
  for (let i = 0; i < 5; i += 1) {
    const current = 2 + i;
    const next = 2 + ((i + 1) % 5);
    indices.push(0, next, current);
    indices.push(1, current, next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const geometryCache = new Map<DieKind, GeometrySet>();

function createGeometry(kind: DieKind): GeometrySet {
  const cached = geometryCache.get(kind);
  if (cached) return cached;
  const radius = DIE_RADIUS[kind];
  let geometry: GeometrySet;
  switch (kind) {
    case 'd4': {
      const collider = new THREE.TetrahedronGeometry(radius, 0);
      geometry = { visual: collider.clone(), collider };
      break;
    }
    case 'd6':
      geometry = {
        visual: new RoundedBoxGeometry(radius * 1.72, radius * 1.72, radius * 1.72, 6, radius * 0.2),
        collider: new THREE.BoxGeometry(radius * 1.72, radius * 1.72, radius * 1.72),
      };
      break;
    case 'd8': {
      const collider = new THREE.OctahedronGeometry(radius, 0);
      geometry = { visual: collider.clone(), collider };
      break;
    }
    case 'd10': {
      const collider = createD10Geometry(radius);
      geometry = { visual: collider.clone(), collider };
      break;
    }
    case 'd12': {
      const collider = new THREE.DodecahedronGeometry(radius, 0);
      geometry = { visual: collider.clone(), collider };
      break;
    }
    case 'd20': {
      const collider = new THREE.IcosahedronGeometry(radius, 0);
      geometry = { visual: collider.clone(), collider };
      break;
    }
  }
  geometryCache.set(kind, geometry);
  return geometry;
}

interface TriangleData {
  normal: THREE.Vector3;
  center: THREE.Vector3;
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

function getTriangleData(geometry: THREE.BufferGeometry): TriangleData[] {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = nonIndexed.getAttribute('position');
  const triangles: TriangleData[] = [];
  for (let i = 0; i < position.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, i);
    const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    if (normal.dot(center) < 0) {
      normal.negate();
      triangles.push({ normal, center, vertices: [a, c, b] });
    } else {
      triangles.push({ normal, center, vertices: [a, b, c] });
    }
  }
  nonIndexed.dispose();
  return triangles;
}

function pushUniqueVertex(vertices: THREE.Vector3[], vertex: THREE.Vector3): void {
  if (!vertices.some((candidate) => candidate.distanceToSquared(vertex) < 1e-8)) vertices.push(vertex.clone());
}

const logicalFaceCache = new Map<DieKind, LogicalFace[]>();

function getLogicalFaceTemplate(kind: DieKind): LogicalFace[] {
  const cached = logicalFaceCache.get(kind);
  if (cached) return cached;
  const triangles = getTriangleData(createGeometry(kind).collider);
  const groups: Array<{ normal: THREE.Vector3; centers: THREE.Vector3[]; vertices: THREE.Vector3[] }> = [];
  for (const triangle of triangles) {
    const plane = triangle.normal.dot(triangle.center);
    const existing = groups.find((group) => {
      const groupPlane = group.normal.dot(group.centers[0]);
      return group.normal.dot(triangle.normal) > 0.999 && Math.abs(groupPlane - plane) < 0.02;
    });
    const group = existing ?? { normal: triangle.normal.clone(), centers: [], vertices: [] };
    if (!existing) groups.push(group);
    group.centers.push(triangle.center.clone());
    triangle.vertices.forEach((vertex) => pushUniqueVertex(group.vertices, vertex));
  }

  const expected = Number(kind.slice(1));
  const sorted = groups
    .map((group) => ({
      normal: group.normal.normalize(),
      center: group.vertices.reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3()).multiplyScalar(1 / group.vertices.length),
      vertices: group.vertices,
    }))
    .toSorted((a, b) => {
      const ay = Math.atan2(a.normal.z, a.normal.x);
      const by = Math.atan2(b.normal.z, b.normal.x);
      if (Math.abs(a.normal.y - b.normal.y) > 0.05) return b.normal.y - a.normal.y;
      return ay - by;
    });

  if (sorted.length !== expected) console.warn(`Expected ${expected} faces for ${kind}, found ${sorted.length}.`);
  const values = kind === 'd4' ? [1, 2, 3, 4] : VALUE_ORDERS[kind];
  // Copies cached geometry faces; mutating them would corrupt `logicalFaceCache`.
  // oxlint-disable-next-line oxc/no-map-spread
  const faces = sorted.slice(0, expected).map((face, index) => ({ ...face, value: values[index] ?? index + 1 }));
  logicalFaceCache.set(kind, faces);
  return faces;
}

function cloneLogicalFaces(kind: DieKind): LogicalFace[] {
  return getLogicalFaceTemplate(kind).map((face) => ({
    normal: face.normal.clone(),
    center: face.center.clone(),
    vertices: face.vertices.map((vertex) => vertex.clone()),
    value: face.value,
  }));
}

function getUniqueVertices(faces: LogicalFace[]): THREE.Vector3[] {
  const vertices: THREE.Vector3[] = [];
  faces.forEach((face) => face.vertices.forEach((vertex) => pushUniqueVertex(vertices, vertex)));
  return vertices.toSorted((a, b) => {
    if (Math.abs(a.y - b.y) > 1e-5) return b.y - a.y;
    const angleA = Math.atan2(a.z, a.x);
    const angleB = Math.atan2(b.z, b.x);
    return angleA - angleB;
  });
}


let contactShadowTexture: THREE.CanvasTexture | null = null;
let contactShadowGeometry: THREE.PlaneGeometry | null = null;

function getContactShadowTexture(): THREE.CanvasTexture {
  if (contactShadowTexture) return contactShadowTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const gradient = context.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size * 0.49);
  gradient.addColorStop(0, 'rgba(0,0,0,.72)');
  gradient.addColorStop(0.38, 'rgba(0,0,0,.42)');
  gradient.addColorStop(0.72, 'rgba(0,0,0,.12)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  contactShadowTexture = new THREE.CanvasTexture(canvas);
  contactShadowTexture.colorSpace = THREE.SRGBColorSpace;
  return contactShadowTexture;
}

function getContactShadowGeometry(): THREE.PlaneGeometry {
  contactShadowGeometry ??= new THREE.PlaneGeometry(1, 1);
  return contactShadowGeometry;
}

const numberAtlasCache = new Map<ThemeName, THREE.CanvasTexture>();
const labelMaterialCache = new Map<string, THREE.MeshBasicMaterial>();

const ATLAS_COLUMNS = 5;
const ATLAS_ROWS = 4;

function createNumberAtlas(theme: ThemeName): THREE.CanvasTexture {
  const cached = numberAtlasCache.get(theme);
  if (cached) return cached;
  const palette = THEMES[theme] ?? THEMES.dragon;
  const size = 1024;
  const cellWidth = size / ATLAS_COLUMNS;
  const cellHeight = size / ATLAS_ROWS;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  context.clearRect(0, 0, size, size);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';

  for (let value = 1; value <= 20; value += 1) {
    const cell = value - 1;
    const column = cell % ATLAS_COLUMNS;
    const row = Math.floor(cell / ATLAS_COLUMNS);
    const x = (column + 0.5) * cellWidth;
    const y = (row + 0.5) * cellHeight;
    const fontSize = value >= 10 ? cellHeight * 0.48 : cellHeight * 0.57;
    const runtimeFont = getRuntimeThemeFont(theme);
    context.font = `700 ${fontSize}px ${runtimeFont ? `'${runtimeFont}', ` : ''}Cinzel, Georgia, serif`;
    context.lineWidth = cellHeight * 0.055;
    context.strokeStyle = theme === 'celestial' ? 'rgba(65,43,12,.76)' : 'rgba(4,3,7,.78)';
    context.shadowColor = palette.labelGlow;
    context.shadowBlur = theme === 'tempest' ? 18 : 10;
    context.strokeText(String(value), x, y - cellHeight * 0.015);
    context.fillStyle = palette.label;
    context.fillText(String(value), x, y - cellHeight * 0.015);
    if (value === 6 || value === 9) {
      context.shadowBlur = 4;
      context.strokeStyle = theme === 'celestial' ? 'rgba(65,43,12,.9)' : 'rgba(10,3,20,.9)';
      context.lineWidth = cellHeight * 0.026;
      context.beginPath();
      context.moveTo(x - cellWidth * 0.17, y + cellHeight * 0.31);
      context.lineTo(x + cellWidth * 0.17, y + cellHeight * 0.31);
      context.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  numberAtlasCache.set(theme, texture);
  return texture;
}

function getLabelMaterial(theme: ThemeName, kind: DieKind): THREE.MeshBasicMaterial {
  const key = `${theme}:${kind}`;
  const cached = labelMaterialCache.get(key);
  if (cached) return cached;
  const material = new THREE.MeshBasicMaterial({
    map: getRuntimeThemeTexture(theme, kind, 'label') ?? createNumberAtlas(theme),
    transparent: true,
    depthWrite: false,
    alphaTest: 0.06,
    toneMapped: false,
    side: THREE.FrontSide,
  });
  labelMaterialCache.set(key, material);
  return material;
}

function writeAtlasUvs(target: Float32Array, offset: number, value: number): void {
  const clamped = THREE.MathUtils.clamp(Math.round(value), 1, 20);
  const cell = clamped - 1;
  const column = cell % ATLAS_COLUMNS;
  const row = Math.floor(cell / ATLAS_COLUMNS);
  const padU = 0.055 / ATLAS_COLUMNS;
  const padV = 0.055 / ATLAS_ROWS;
  const u0 = column / ATLAS_COLUMNS + padU;
  const u1 = (column + 1) / ATLAS_COLUMNS - padU;
  const v0 = 1 - (row + 1) / ATLAS_ROWS + padV;
  const v1 = 1 - row / ATLAS_ROWS - padV;
  target.set([u0, v0, u1, v0, u1, v1, u0, v1], offset);
}

function appendQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  bindings: LabelBinding[],
  center: THREE.Vector3,
  normal: THREE.Vector3,
  upDirection: THREE.Vector3,
  width: number,
  height: number,
  binding: Omit<LabelBinding, 'uvOffset'>,
): void {
  const up = upDirection.clone().addScaledVector(normal, -upDirection.dot(normal));
  if (up.lengthSq() < 1e-8) up.set(0, 0, 1).addScaledVector(normal, -normal.z);
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const base = positions.length / 3;
  const corners = [
    center.clone().addScaledVector(right, -halfWidth).addScaledVector(up, -halfHeight),
    center.clone().addScaledVector(right, halfWidth).addScaledVector(up, -halfHeight),
    center.clone().addScaledVector(right, halfWidth).addScaledVector(up, halfHeight),
    center.clone().addScaledVector(right, -halfWidth).addScaledVector(up, halfHeight),
  ];
  corners.forEach((corner) => {
    positions.push(corner.x, corner.y, corner.z);
    normals.push(normal.x, normal.y, normal.z);
  });
  const uvOffset = uvs.length;
  uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  bindings.push({ ...binding, uvOffset });
}

function createLabelSet(faces: LogicalFace[], theme: ThemeName, kind: DieKind, d4Vertices: THREE.Vector3[]): LabelSet {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const bindings: LabelBinding[] = [];

  if (kind === 'd4') {
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
      const face = faces[faceIndex];
      for (const vertex of face.vertices) {
        const vertexIndex = d4Vertices.findIndex((candidate) => candidate.distanceToSquared(vertex) < 1e-8);
        if (vertexIndex < 0) continue;
        const towardCorner = vertex.clone().sub(face.center).normalize();
        const center = face.center.clone().lerp(vertex, 0.47).addScaledVector(face.normal, 0.014);
        appendQuad(positions, normals, uvs, indices, bindings, center, face.normal, towardCorner, 0.16, 0.205, { vertexIndex });
      }
    }
  } else {
    const scaleByKind: Record<Exclude<DieKind, 'd4'>, [number, number]> = {
      d6: [0.42, 0.42],
      d8: [0.31, 0.31],
      d10: [0.31, 0.31],
      d12: [0.25, 0.25],
      d20: [0.27, 0.27],
    };
    const [width, height] = scaleByKind[kind];
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
      const face = faces[faceIndex];
      const reference = Math.abs(face.normal.y) < 0.88 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);
      const center = face.center.clone().addScaledVector(face.normal, kind === 'd6' ? 0.017 : 0.014);
      appendQuad(positions, normals, uvs, indices, bindings, center, face.normal, reference, width, height, { faceIndex });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, getLabelMaterial(theme, kind));
  mesh.renderOrder = 3;
  return { mesh, bindings };
}

const surfaceCache = new Map<ThemeName, SurfaceSet>();
function createSurfaceCanvases(size = 512): { colorCanvas: HTMLCanvasElement; bumpCanvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; btx: CanvasRenderingContext2D } {
  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  colorCanvas.width = bumpCanvas.width = size;
  colorCanvas.height = bumpCanvas.height = size;
  const ctx = colorCanvas.getContext('2d');
  const btx = bumpCanvas.getContext('2d');
  if (!ctx || !btx) throw new Error('Canvas 2D context unavailable.');
  return { colorCanvas, bumpCanvas, ctx, btx };
}

function createNormalAndRoughnessMaps(
  bumpCanvas: HTMLCanvasElement,
  palette: ThemePalette,
): { normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const size = bumpCanvas.width;
  const sourceContext = bumpCanvas.getContext('2d');
  if (!sourceContext) throw new Error('Canvas 2D context unavailable.');
  const source = sourceContext.getImageData(0, 0, size, size);
  const pixels = source.data;

  const normalCanvas = document.createElement('canvas');
  const roughnessCanvas = document.createElement('canvas');
  normalCanvas.width = roughnessCanvas.width = size;
  normalCanvas.height = roughnessCanvas.height = size;
  const normalContext = normalCanvas.getContext('2d');
  const roughnessContext = roughnessCanvas.getContext('2d');
  if (!normalContext || !roughnessContext) throw new Error('Canvas 2D context unavailable.');
  const normals = normalContext.createImageData(size, size);
  const roughness = roughnessContext.createImageData(size, size);

  const sample = (x: number, y: number): number => {
    const wrappedX = (x + size) % size;
    const wrappedY = (y + size) % size;
    return pixels[(wrappedY * size + wrappedX) * 4] / 255;
  };
  const normalStrength = THREE.MathUtils.clamp(palette.bumpScale * 20, 0.55, 1.9);
  const baseRoughness = palette.roughness * 255;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = sample(x - 1, y);
      const right = sample(x + 1, y);
      const down = sample(x, y - 1);
      const up = sample(x, y + 1);
      const dx = (right - left) * normalStrength;
      const dy = (up - down) * normalStrength;
      const invLength = 1 / Math.hypot(dx, dy, 1);
      const offset = (y * size + x) * 4;
      normals.data[offset] = (-dx * invLength * 0.5 + 0.5) * 255;
      normals.data[offset + 1] = (-dy * invLength * 0.5 + 0.5) * 255;
      normals.data[offset + 2] = invLength * 255;
      normals.data[offset + 3] = 255;

      const height = sample(x, y);
      const localContrast = Math.abs(right - left) + Math.abs(up - down);
      const value = THREE.MathUtils.clamp(baseRoughness + (height - 0.5) * 48 + localContrast * 92, 28, 245);
      roughness.data[offset] = value;
      roughness.data[offset + 1] = value;
      roughness.data[offset + 2] = value;
      roughness.data[offset + 3] = 255;
    }
  }

  normalContext.putImageData(normals, 0, 0);
  roughnessContext.putImageData(roughness, 0, 0);
  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = 4;
  const roughnessMap = new THREE.CanvasTexture(roughnessCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = 4;
  return { normalMap, roughnessMap };
}

function finalizeSurface(colorCanvas: HTMLCanvasElement, bumpCanvas: HTMLCanvasElement, palette: ThemePalette): SurfaceSet {
  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const { normalMap, roughnessMap } = createNormalAndRoughnessMaps(bumpCanvas, palette);
  return { map, normalMap, roughnessMap };
}

function seedNoise(ctx: CanvasRenderingContext2D, btx: CanvasRenderingContext2D, size: number, palette: ThemePalette, count = 700): void {
  for (let i = 0; i < count; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 3 + Math.random() * 18;
    ctx.globalAlpha = 0.02 + Math.random() * 0.055;
    ctx.fillStyle = i % 3 === 0 ? lerpColor(palette.edge, palette.base, 0.72) : lerpColor(palette.base, palette.shadow, 0.28 + Math.random() * 0.35);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    btx.globalAlpha = 0.015 + Math.random() * 0.04;
    btx.fillStyle = Math.random() > 0.5 ? '#a0a0a0' : '#5f5f5f';
    btx.beginPath();
    btx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    btx.fill();
  }
}

function drawJaggedVein(ctx: CanvasRenderingContext2D, size: number, stroke: string, alpha: number, width: number, steps = 8): void {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let x = Math.random() * size;
  let y = Math.random() * size;
  ctx.moveTo(x, y);
  for (let j = 0; j < steps; j += 1) {
    x += (Math.random() - 0.5) * 88;
    y += (Math.random() - 0.5) * 88;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function createDragonSurface(palette: ThemePalette): SurfaceSet {
  const size = 512;
  const { colorCanvas, bumpCanvas, ctx, btx } = createSurfaceCanvases(size);
  const bg = ctx.createRadialGradient(size * 0.45, size * 0.35, 30, size * 0.5, size * 0.55, size * 0.62);
  bg.addColorStop(0, lerpColor(palette.base, 0xffffff, 0.12));
  bg.addColorStop(0.55, hexToCss(palette.base));
  bg.addColorStop(1, hexToCss(palette.shadow));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  btx.fillStyle = '#737373';
  btx.fillRect(0, 0, size, size);

  const scaleSize = 34;
  for (let row = 0; row < 18; row += 1) {
    for (let col = 0; col < 18; col += 1) {
      const x = 24 + col * scaleSize * 1.45 + (row % 2 === 0 ? 0 : scaleSize * 0.72);
      const y = 24 + row * scaleSize * 1.12;
      const light = 0.08 + Math.random() * 0.14;
      ctx.beginPath();
      ctx.moveTo(x - scaleSize * 0.5, y);
      ctx.quadraticCurveTo(x, y - scaleSize * 0.7, x + scaleSize * 0.5, y);
      ctx.quadraticCurveTo(x, y + scaleSize * 0.55, x - scaleSize * 0.5, y);
      ctx.closePath();
      ctx.fillStyle = lerpColor(palette.base, palette.edge, light);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.26)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      btx.beginPath();
      btx.moveTo(x - scaleSize * 0.5, y);
      btx.quadraticCurveTo(x, y - scaleSize * 0.7, x + scaleSize * 0.5, y);
      btx.quadraticCurveTo(x, y + scaleSize * 0.55, x - scaleSize * 0.5, y);
      btx.closePath();
      btx.fillStyle = '#9c9c9c';
      btx.fill();
      btx.strokeStyle = '#595959';
      btx.stroke();
    }
  }
  for (let i = 0; i < 8; i += 1) drawJaggedVein(ctx, size, '#ffd29b', 0.18, 2.6, 5);
  return finalizeSurface(colorCanvas, bumpCanvas, palette);
}

function createNebulaSurface(palette: ThemePalette): SurfaceSet {
  const size = 512;
  const { colorCanvas, bumpCanvas, ctx, btx } = createSurfaceCanvases(size);
  const bg = ctx.createRadialGradient(180, 130, 12, 280, 280, 430);
  bg.addColorStop(0, '#744aa1');
  bg.addColorStop(0.32, hexToCss(palette.base));
  bg.addColorStop(1, hexToCss(palette.shadow));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  btx.fillStyle = '#747474';
  btx.fillRect(0, 0, size, size);
  for (let i = 0; i < 48; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 18 + Math.random() * 72;
    const cloud = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const color = i % 3 === 0 ? 'rgba(66,184,255,.15)' : i % 3 === 1 ? 'rgba(225,89,255,.13)' : 'rgba(255,180,120,.08)';
    cloud.addColorStop(0, color);
    cloud.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cloud;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let i = 0; i < 180; i += 1) {
    const r = Math.random() > 0.92 ? 1.8 : 0.65 + Math.random() * 0.8;
    ctx.globalAlpha = 0.28 + Math.random() * 0.65;
    ctx.fillStyle = i % 7 === 0 ? '#b7e8ff' : '#fff2ff';
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  seedNoise(ctx, btx, size, palette, 350);
  return finalizeSurface(colorCanvas, bumpCanvas, palette);
}

function createMagmaSurface(palette: ThemePalette): SurfaceSet {
  const size = 512;
  const { colorCanvas, bumpCanvas, ctx, btx } = createSurfaceCanvases(size);
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#3e0905');
  bg.addColorStop(0.5, hexToCss(palette.base));
  bg.addColorStop(1, '#170302');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  btx.fillStyle = '#6b6b6b';
  btx.fillRect(0, 0, size, size);
  seedNoise(ctx, btx, size, palette, 900);
  for (let i = 0; i < 54; i += 1) {
    drawJaggedVein(ctx, size, '#ff5e1e', 0.34, 4.5, 6);
    drawJaggedVein(ctx, size, '#ffd06b', 0.18, 1.4, 6);
    drawJaggedVein(btx, size, '#c5c5c5', 0.22, 3.5, 6);
  }
  return finalizeSurface(colorCanvas, bumpCanvas, palette);
}

function createIceSurface(palette: ThemePalette): SurfaceSet {
  const size = 512;
  const { colorCanvas, bumpCanvas, ctx, btx } = createSurfaceCanvases(size);
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#6bbdd3');
  bg.addColorStop(0.34, hexToCss(palette.base));
  bg.addColorStop(1, '#071e33');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  btx.fillStyle = '#808080';
  btx.fillRect(0, 0, size, size);
  seedNoise(ctx, btx, size, palette, 420);
  for (let i = 0; i < 64; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 24 + Math.random() * 82;
    const angle = Math.random() * Math.PI;
    ctx.globalAlpha = 0.08 + Math.random() * 0.14;
    ctx.strokeStyle = '#e8fbff';
    ctx.lineWidth = 0.8 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
    btx.globalAlpha = 0.11;
    btx.strokeStyle = '#bfbfbf';
    btx.lineWidth = 1.5;
    btx.beginPath();
    btx.moveTo(x, y);
    btx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    btx.stroke();
  }
  return finalizeSurface(colorCanvas, bumpCanvas, palette);
}

function createCelestialSurface(palette: ThemePalette): SurfaceSet {
  const size = 512;
  const { colorCanvas, bumpCanvas, ctx, btx } = createSurfaceCanvases(size);
  const bg = ctx.createRadialGradient(180, 150, 20, 260, 260, 400);
  bg.addColorStop(0, '#fff4d6');
  bg.addColorStop(0.48, hexToCss(palette.base));
  bg.addColorStop(1, '#66532d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  btx.fillStyle = '#838383';
  btx.fillRect(0, 0, size, size);
  seedNoise(ctx, btx, size, palette, 520);
  for (let i = 0; i < 26; i += 1) {
    drawJaggedVein(ctx, size, '#fff8e8', 0.16, 2, 7);
    drawJaggedVein(ctx, size, '#a77419', 0.16, 1.2, 7);
  }
  ctx.strokeStyle = 'rgba(255,214,104,.38)';
  ctx.fillStyle = 'rgba(255,235,165,.52)';
  for (let i = 0; i < 46; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 2 + Math.random() * 5;
    ctx.globalAlpha = 0.22 + Math.random() * 0.35;
    ctx.beginPath();
    for (let p = 0; p < 8; p += 1) {
      const a = (p / 8) * Math.PI * 2;
      const rr = p % 2 === 0 ? r : r * 0.35;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  return finalizeSurface(colorCanvas, bumpCanvas, palette);
}

function createStormSurface(palette: ThemePalette): SurfaceSet {
  const size = 512;
  const { colorCanvas, bumpCanvas, ctx, btx } = createSurfaceCanvases(size);
  const bg = ctx.createRadialGradient(210, 160, 20, 270, 280, 410);
  bg.addColorStop(0, '#35536f');
  bg.addColorStop(0.42, hexToCss(palette.base));
  bg.addColorStop(1, hexToCss(palette.shadow));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  btx.fillStyle = '#767676';
  btx.fillRect(0, 0, size, size);
  seedNoise(ctx, btx, size, palette, 760);
  for (let i = 0; i < 32; i += 1) {
    drawJaggedVein(ctx, size, '#55ceff', 0.22, 2.6, 9);
    drawJaggedVein(ctx, size, '#d7f7ff', 0.12, 0.8, 9);
    drawJaggedVein(btx, size, '#a8a8a8', 0.12, 1.5, 9);
  }
  return finalizeSurface(colorCanvas, bumpCanvas, palette);
}

function createNecroticSurface(palette: ThemePalette): SurfaceSet {
  const size = 512;
  const { colorCanvas, bumpCanvas, ctx, btx } = createSurfaceCanvases(size);
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#3b4434');
  bg.addColorStop(0.46, hexToCss(palette.base));
  bg.addColorStop(1, '#090c08');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  btx.fillStyle = '#777';
  btx.fillRect(0, 0, size, size);
  seedNoise(ctx, btx, size, palette, 1050);
  for (let i = 0; i < 44; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 8 + Math.random() * 24;
    ctx.globalAlpha = 0.05 + Math.random() * 0.12;
    ctx.strokeStyle = i % 3 === 0 ? '#b7e88f' : '#0a1109';
    ctx.lineWidth = 1 + Math.random() * 2.5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (i % 4 === 0) {
      ctx.beginPath();
      ctx.moveTo(x - radius, y);
      ctx.lineTo(x + radius, y);
      ctx.stroke();
    }
  }
  return finalizeSurface(colorCanvas, bumpCanvas, palette);
}

function createWildwoodSurface(palette: ThemePalette): SurfaceSet {
  const size = 512;
  const { colorCanvas, bumpCanvas, ctx, btx } = createSurfaceCanvases(size);
  const bg = ctx.createRadialGradient(170, 130, 20, 260, 260, 420);
  bg.addColorStop(0, '#417653');
  bg.addColorStop(0.48, hexToCss(palette.base));
  bg.addColorStop(1, '#0a1a0e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  btx.fillStyle = '#737373';
  btx.fillRect(0, 0, size, size);
  seedNoise(ctx, btx, size, palette, 760);
  for (let i = 0; i < 86; i += 1) {
    const y = Math.random() * size;
    ctx.globalAlpha = 0.045 + Math.random() * 0.08;
    ctx.strokeStyle = i % 4 === 0 ? '#92ca70' : '#09170d';
    ctx.lineWidth = 1 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.25, y + (Math.random() - 0.5) * 70, size * 0.7, y + (Math.random() - 0.5) * 70, size, y + (Math.random() - 0.5) * 30);
    ctx.stroke();
    btx.globalAlpha = 0.05;
    btx.strokeStyle = '#9b9b9b';
    btx.lineWidth = 1.5;
    btx.beginPath();
    btx.moveTo(0, y);
    btx.bezierCurveTo(size * 0.25, y + 20, size * 0.7, y - 20, size, y);
    btx.stroke();
  }
  for (let i = 0; i < 48; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const s = 3 + Math.random() * 7;
    ctx.globalAlpha = 0.18 + Math.random() * 0.2;
    ctx.fillStyle = '#b7e879';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.scale(1.8, 0.7);
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return finalizeSurface(colorCanvas, bumpCanvas, palette);
}

function createSurface(theme: ThemeName, palette: ThemePalette): SurfaceSet {
  const cached = surfaceCache.get(theme);
  if (cached) return cached;
  let surface: SurfaceSet;
  switch (palette.surface) {
    case 'dragon-scale': surface = createDragonSurface(palette); break;
    case 'nebula': surface = createNebulaSurface(palette); break;
    case 'magma': surface = createMagmaSurface(palette); break;
    case 'ice': surface = createIceSurface(palette); break;
    case 'celestial': surface = createCelestialSurface(palette); break;
    case 'storm': surface = createStormSurface(palette); break;
    case 'necrotic': surface = createNecroticSurface(palette); break;
    case 'wildwood': surface = createWildwoodSurface(palette); break;
  }
  surfaceCache.set(theme, surface);
  return surface;
}

const SURFACE_VARIANT_COUNT = 12;
/** Van der Corput radical inverse, the basis of the low-discrepancy variant offsets below. */
function radicalInverse(value: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  let current = value;
  while (current > 0) {
    result += (current % base) * fraction;
    current = Math.floor(current / base);
    fraction /= base;
  }
  return result;
}

const SURFACE_VARIANT_OFFSETS = Array.from({ length: SURFACE_VARIANT_COUNT }, (_value, index) => {
  // A low-discrepancy sequence gives visibly different crops without clustering.
  return new THREE.Vector2(radicalInverse(index + 1, 2), radicalInverse(index + 1, 3));
});

function installSurfaceVariation(material: THREE.MeshPhysicalMaterial, offset: THREE.Vector2): void {
  const stableOffset = offset.clone();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDiceUvOffset = { value: stableOffset };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_pars_vertex>',
      '#include <uv_pars_vertex>\nuniform vec2 uDiceUvOffset;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv += uDiceUvOffset;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv += uDiceUvOffset;
#endif
#ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv += uDiceUvOffset;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
  vClearcoatNormalMapUv += uDiceUvOffset;
#endif`,
    );
  };
  // All variants share one GPU program. Only the immutable uniform differs per material.
  material.customProgramCacheKey = () => 'draftroll-surface-v3';
}

const mainMaterialCache = new Map<string, THREE.MeshPhysicalMaterial>();
const edgeMaterialCache = new Map<ThemeName, THREE.LineBasicMaterial>();
const edgeGeometryCache = new Map<string, THREE.EdgesGeometry>();

function getMainMaterial(theme: ThemeName, kind: DieKind, variant = 0): THREE.MeshPhysicalMaterial {
  const normalizedVariant = ((Math.round(variant) % SURFACE_VARIANT_COUNT) + SURFACE_VARIANT_COUNT) % SURFACE_VARIANT_COUNT;
  const key = `${theme}:${kind}:${normalizedVariant}`;
  const cached = mainMaterialCache.get(key);
  if (cached) return cached;
  const palette = THEMES[theme] ?? THEMES.dragon;
  const surface = createSurface(theme, palette);
  const runtime = getRuntimeThemeMaterial(theme, kind);
  const surfaceTexture = getRuntimeThemeTexture(theme, kind, 'surface');
  const normalTexture = getRuntimeThemeTexture(theme, kind, 'normal');
  const roughnessTexture = getRuntimeThemeTexture(theme, kind, 'roughness');
  const magical = theme === 'nebula' || theme === 'frost' || theme === 'celestial';
  const material = new THREE.MeshPhysicalMaterial({
    color: runtime?.color ?? 0xffffff,
    map: surfaceTexture ?? surface.map,
    normalMap: normalTexture ?? surface.normalMap,
    normalScale: new THREE.Vector2(0.82, 0.82),
    roughness: runtime?.roughness ?? 1,
    roughnessMap: roughnessTexture ?? surface.roughnessMap,
    metalness: runtime?.metalness ?? palette.metalness,
    clearcoat: runtime?.clearcoat ?? palette.clearcoat,
    clearcoatRoughness: runtime?.clearcoatRoughness ?? palette.clearcoatRoughness,
    clearcoatNormalMap: normalTexture ?? surface.normalMap,
    clearcoatNormalScale: new THREE.Vector2(0.28, 0.28),
    emissive: runtime?.emissive ?? palette.emissive,
    emissiveIntensity: runtime?.emissiveIntensity ?? palette.emissiveIntensity * 0.62,
    transparent: (runtime?.opacity ?? 1) < 1,
    opacity: runtime?.opacity ?? 1,
    envMapIntensity: 0.62,
    ior: theme === 'frost' ? 1.36 : 1.46,
    specularIntensity: theme === 'wildwood' || theme === 'necrotic' ? 0.46 : 0.72,
    specularColor: new THREE.Color(palette.edge).lerp(new THREE.Color(0xffffff), 0.72),
    iridescence: theme === 'nebula' ? 0.18 : theme === 'frost' ? 0.07 : theme === 'celestial' ? 0.05 : 0,
    iridescenceIOR: magical ? 1.38 : 1.3,
    iridescenceThicknessRange: magical ? [80, 260] : [100, 140],
    sheen: theme === 'wildwood' ? 0.14 : theme === 'necrotic' ? 0.08 : 0.04,
    sheenColor: new THREE.Color(palette.edge),
    sheenRoughness: 0.72,
    flatShading: kind !== 'd6',
  });
  installSurfaceVariation(material, SURFACE_VARIANT_OFFSETS[normalizedVariant]);
  mainMaterialCache.set(key, material);
  return material;
}

function getEdgeMaterial(theme: ThemeName): THREE.LineBasicMaterial {
  const cached = edgeMaterialCache.get(theme);
  if (cached) return cached;
  const palette = THEMES[theme] ?? THEMES.dragon;
  const material = new THREE.LineBasicMaterial({
    color: palette.edge,
    transparent: true,
    opacity: palette.edgeOpacity * 0.72,
    toneMapped: false,
  });
  edgeMaterialCache.set(theme, material);
  return material;
}

function getVisualGeometry(theme: ThemeName, kind: DieKind): THREE.BufferGeometry {
  return getRuntimeThemeMesh(theme, kind) ?? createGeometry(kind).visual;
}

function getEdgeGeometry(kind: DieKind, theme: ThemeName): THREE.EdgesGeometry {
  const key = `${theme}:${kind}`;
  const cached = edgeGeometryCache.get(key);
  if (cached) return cached;
  const geometry = new THREE.EdgesGeometry(getVisualGeometry(theme, kind), kind === 'd6' ? 32 : 10);
  edgeGeometryCache.set(key, geometry);
  return geometry;
}

export function invalidateDiceThemeResources(theme: ThemeName): void {
  for (const [key, material] of mainMaterialCache) {
    if (!key.startsWith(`${theme}:`)) continue;
    material.dispose();
    mainMaterialCache.delete(key);
  }
  const edge = edgeMaterialCache.get(theme);
  edge?.dispose();
  edgeMaterialCache.delete(theme);
  for (const [key, geometry] of edgeGeometryCache) {
    if (!key.startsWith(`${theme}:`)) continue;
    geometry.dispose();
    edgeGeometryCache.delete(key);
  }
  for (const [key, material] of labelMaterialCache) {
    if (!key.startsWith(`${theme}:`)) continue;
    material.dispose();
    labelMaterialCache.delete(key);
  }
  const atlas = numberAtlasCache.get(theme);
  atlas?.dispose();
  numberAtlasCache.delete(theme);
  const surface = surfaceCache.get(theme);
  surface?.map.dispose();
  surface?.normalMap.dispose();
  surface?.roughnessMap.dispose();
  surfaceCache.delete(theme);
}

export function prewarmDiceTheme(theme: ThemeName): void {
  getLabelMaterial(theme, 'd20');
  (['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as DieKind[]).forEach((kind) => {
    getMainMaterial(theme, kind, 0);
    getEdgeMaterial(theme);
    getEdgeGeometry(kind, theme);
    getLogicalFaceTemplate(kind);
  });
}

function createDragonAdornment(kind: DieKind, faces: LogicalFace[]): THREE.Group {
  const group = new THREE.Group();
  if (kind !== 'd20') return group;

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(DIE_RADIUS.d20 * 0.32, 1),
    new THREE.MeshPhysicalMaterial({
      color: 0xff8f31,
      emissive: 0xff4b16,
      emissiveIntensity: 1.15,
      transparent: true,
      opacity: 0.14,
      roughness: 0.38,
      metalness: 0,
      transmission: 0.04,
      thickness: 0.32,
      depthWrite: false,
    }),
  );
  group.add(core);

  const cone = new THREE.ConeGeometry(0.05, 0.25, 6);
  const ornamentMaterial = new THREE.MeshStandardMaterial({
    color: 0xb46624,
    metalness: 0.14,
    roughness: 0.62,
    emissive: 0x421005,
    emissiveIntensity: 0.22,
  });
  const ornaments = new THREE.InstancedMesh(cone, ornamentMaterial, 8);
  const dummy = new THREE.Object3D();
  const upperFaces = faces.toSorted((a, b) => b.normal.y - a.normal.y).slice(0, 6);
  upperFaces.forEach((face, index) => {
    dummy.position.copy(face.center).addScaledVector(face.normal, 0.2);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), face.normal);
    dummy.scale.set(index % 2 === 0 ? 0.9 : 0.72, index % 2 === 0 ? 1 : 0.78, index % 2 === 0 ? 0.9 : 0.72);
    dummy.updateMatrix();
    ornaments.setMatrixAt(index, dummy.matrix);
  });
  const hornBases = faces.toSorted((a, b) => b.center.z - a.center.z).slice(0, 2);
  hornBases.forEach((face, index) => {
    dummy.position.copy(face.center).add(new THREE.Vector3(index === 0 ? -0.13 : 0.13, 0.18, 0.05));
    dummy.rotation.set(Math.PI * 0.12, 0, index === 0 ? Math.PI * 0.22 : -Math.PI * 0.22);
    dummy.scale.set(1.08, 1.16, 1.08);
    dummy.updateMatrix();
    ornaments.setMatrixAt(6 + index, dummy.matrix);
  });
  ornaments.instanceMatrix.needsUpdate = true;
  ornaments.castShadow = true;
  group.add(ornaments);
  return group;
}

export interface DiePhysicsOptions {
  mass?: number;
  sizeScale?: number;
  inertiaScale?: number;
}

export class DieInstance {
  public readonly kind: DieKind;
  public readonly maxValue: number;
  public readonly group: THREE.Group;
  public readonly body: CANNON.Body;
  public readonly faces: LogicalFace[];
  private readonly visualRoot: THREE.Group;
  private readonly sizeScale: number;
  private readonly inertiaScale: number;
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private readonly edgeLines: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  private readonly labels: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly contactShadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly labelBindings: LabelBinding[];
  private adornment?: THREE.Group;
  private currentTheme: ThemeName;
  private readonly baseFaceValues: number[];
  private readonly d4Vertices: THREE.Vector3[];
  private readonly d4VertexValues: number[];
  private readonly baseD4VertexValues: number[];
  private readonly topQuaternion = new THREE.Quaternion();
  private readonly worldNormal = new THREE.Vector3();
  private static surfaceVariantCursor = 0;
  private static readonly symmetryRotationCache = new Map<string, THREE.Quaternion>();
  private readonly surfaceVariant = DieInstance.surfaceVariantCursor++ % SURFACE_VARIANT_COUNT;

  constructor(kind: DieKind, theme: ThemeName, physicsMaterial: CANNON.Material, options: number | DiePhysicsOptions = 1.15) {
    const resolved = typeof options === 'number' ? { mass: options } : options;
    const mass = resolved.mass ?? 1.15;
    this.sizeScale = THREE.MathUtils.clamp(resolved.sizeScale ?? 1, 0.5, 2);
    this.inertiaScale = THREE.MathUtils.clamp(resolved.inertiaScale ?? 1, 0.25, 4);
    this.kind = kind;
    this.maxValue = Number(kind.slice(1));
    this.currentTheme = theme;
    this.faces = cloneLogicalFaces(kind);
    this.baseFaceValues = this.faces.map((face) => face.value);
    this.d4Vertices = kind === 'd4' ? getUniqueVertices(this.faces) : [];
    this.d4VertexValues = this.d4Vertices.map((_vertex, index) => index + 1);
    this.baseD4VertexValues = this.d4VertexValues.slice();
    this.group = new THREE.Group();
    this.visualRoot = new THREE.Group();
    this.group.add(this.visualRoot);
    this.visualRoot.scale.setScalar(this.sizeScale);

    this.mesh = new THREE.Mesh(getVisualGeometry(theme, kind), getMainMaterial(theme, kind, this.surfaceVariant));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.visualRoot.add(this.mesh);

    this.edgeLines = new THREE.LineSegments(getEdgeGeometry(kind, theme), getEdgeMaterial(theme));
    this.edgeLines.scale.setScalar(1.004);
    this.edgeLines.renderOrder = 2;
    this.visualRoot.add(this.edgeLines);

    const labelSet = createLabelSet(this.faces, theme, kind, this.d4Vertices);
    this.labels = labelSet.mesh;
    this.labelBindings = labelSet.bindings;
    this.visualRoot.add(this.labels);
    this.refreshLabels();

    if (theme === 'dragon') {
      this.adornment = createDragonAdornment(kind, this.faces);
      this.visualRoot.add(this.adornment);
    }

    const contactShadowMaterial = new THREE.MeshBasicMaterial({
      map: getContactShadowTexture(),
      color: 0x000000,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: THREE.NormalBlending,
    });
    this.contactShadow = new THREE.Mesh(getContactShadowGeometry(), contactShadowMaterial);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.renderOrder = 0;
    this.contactShadow.frustumCulled = false;
    this.group.add(this.contactShadow);

    this.body = new CANNON.Body({ mass, material: physicsMaterial, shape: createDiePhysicsShape(kind, this.sizeScale) });
    if (this.inertiaScale !== 1) {
      this.body.inertia.scale(this.inertiaScale, this.body.inertia);
      this.body.invInertia.set(
        this.body.inertia.x > 0 ? 1 / this.body.inertia.x : 0,
        this.body.inertia.y > 0 ? 1 / this.body.inertia.y : 0,
        this.body.inertia.z > 0 ? 1 / this.body.inertia.z : 0,
      );
    }
    this.body.linearDamping = 0.095;
    this.body.angularDamping = 0.085;
    this.body.allowSleep = true;
    this.body.sleepSpeedLimit = 0.18;
    this.body.sleepTimeLimit = 0.5;
  }

  getPhysicsOptions(): Required<DiePhysicsOptions> {
    return { mass: this.body.mass, sizeScale: this.sizeScale, inertiaScale: this.inertiaScale };
  }

  getTheme(): ThemeName {
    return this.currentTheme;
  }

  /** Conservative world-space radius used to keep the complete visual inside the camera. */
  getVisualRadius(): number {
    const geometry = this.mesh.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const geometryRadius = geometry.boundingSphere?.radius ?? DIE_RADIUS[this.kind];
    return Math.max(DIE_RADIUS[this.kind], geometryRadius) * this.sizeScale * 1.12;
  }

  setTheme(theme: ThemeName): void {
    if (this.currentTheme === theme) return;
    this.currentTheme = theme;
    this.mesh.geometry = getVisualGeometry(theme, this.kind);
    this.mesh.material = getMainMaterial(theme, this.kind, this.surfaceVariant);
    this.edgeLines.geometry = getEdgeGeometry(this.kind, theme);
    this.edgeLines.material = getEdgeMaterial(theme);
    this.labels.material = getLabelMaterial(theme, this.kind);
    this.labels.material.needsUpdate = true;

    if (this.adornment) {
      this.visualRoot.remove(this.adornment);
      this.disposeAdornment(this.adornment);
      this.adornment = undefined;
    }
    if (theme === 'dragon') {
      this.adornment = createDragonAdornment(this.kind, this.faces);
      this.visualRoot.add(this.adornment);
    }
  }

  private disposeAdornment(group: THREE.Group): void {
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }

  private refreshLabels(): void {
    const uv = this.labels.geometry.getAttribute('uv');
    // The label geometry is built locally with a Float32 uv attribute.
    if (!(uv instanceof THREE.BufferAttribute) || !(uv.array instanceof Float32Array)) return;
    const array = uv.array;
    for (const binding of this.labelBindings) {
      const value = binding.vertexIndex !== undefined
        ? this.d4VertexValues[binding.vertexIndex] ?? 1
        : this.faces[binding.faceIndex ?? 0]?.value ?? 1;
      writeAtlasUvs(array, binding.uvOffset, value);
    }
    uv.needsUpdate = true;
  }

  resetNumbering(): void {
    if (this.kind === 'd4') {
      this.d4VertexValues.splice(0, this.d4VertexValues.length, ...this.baseD4VertexValues);
    } else {
      this.faces.forEach((face, index) => {
        face.value = this.baseFaceValues[index];
      });
    }
    this.refreshLabels();
  }

  getTopFaceIndex(quaternion?: { x: number; y: number; z: number; w: number }): number {
    const source = quaternion ?? this.body.quaternion;
    this.topQuaternion.set(source.x, source.y, source.z, source.w);
    const up = THREE.Object3D.DEFAULT_UP;
    if (this.kind === 'd4') {
      let bestVertex = 0;
      let bestDot = -Infinity;
      for (let index = 0; index < this.d4Vertices.length; index += 1) {
        this.worldNormal.copy(this.d4Vertices[index]).normalize().applyQuaternion(this.topQuaternion);
        const dot = this.worldNormal.dot(up);
        if (dot > bestDot) {
          bestDot = dot;
          bestVertex = index;
        }
      }
      return bestVertex;
    }

    let bestIndex = 0;
    let bestDot = -Infinity;
    for (let index = 0; index < this.faces.length; index += 1) {
      this.worldNormal.copy(this.faces[index].normal).applyQuaternion(this.topQuaternion);
      const dot = this.worldNormal.dot(up);
      if (dot > bestDot) {
        bestDot = dot;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  mapLandingFaceToValue(landingIndex: number, value: number): void {
    const target = THREE.MathUtils.clamp(Math.round(value), 1, this.maxValue);
    if (this.kind === 'd4') {
      const landing = THREE.MathUtils.clamp(Math.round(landingIndex), 0, this.d4VertexValues.length - 1);
      const existing = this.d4VertexValues.indexOf(target);
      if (existing < 0 || existing === landing) return;
      const displaced = this.d4VertexValues[landing];
      this.d4VertexValues[landing] = target;
      this.d4VertexValues[existing] = displaced;
      this.refreshLabels();
      return;
    }

    const landing = THREE.MathUtils.clamp(Math.round(landingIndex), 0, this.faces.length - 1);
    const existing = this.faces.findIndex((face) => face.value === target);
    if (existing < 0 || existing === landing) return;
    const displaced = this.faces[landing].value;
    this.faces[landing].value = target;
    this.faces[existing].value = displaced;
    this.refreshLabels();
  }

  getValueForFaceIndex(landingIndex: number): number {
    const index = THREE.MathUtils.clamp(Math.round(landingIndex), 0, this.kind === 'd4' ? this.d4VertexValues.length - 1 : this.faces.length - 1);
    return this.kind === 'd4' ? this.d4VertexValues[index] ?? 1 : this.faces[index]?.value ?? 1;
  }

  syncVisual(): void {
    this.group.position.set(this.body.position.x, this.body.position.y, this.body.position.z);
    this.visualRoot.quaternion.set(this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w);
    const radius = DIE_RADIUS[this.kind];
    const floorClearance = Math.max(0, this.body.position.y - radius * 0.72);
    const fade = THREE.MathUtils.clamp(1 - floorClearance / 4.25, 0, 1);
    const scale = radius * 2.05 * (1 + floorClearance * 0.16);
    this.contactShadow.position.set(0, -this.body.position.y + 0.008, 0);
    this.contactShadow.scale.set(scale, scale, 1);
    this.contactShadow.material.opacity = 0.035 + Math.pow(fade, 1.75) * 0.2;
    this.contactShadow.visible = fade > 0.025;
  }

  getTopValue(): number {
    return this.getValueForFaceIndex(this.getTopFaceIndex());
  }

  getWorldPosition(): THREE.Vector3 {
    return new THREE.Vector3(this.body.position.x, this.body.position.y, this.body.position.z);
  }

  /** Local-space outward normal for the face/vertex representing a result. */
  getTargetNormal(value: number): THREE.Vector3 {
    const target = THREE.MathUtils.clamp(Math.round(value), 1, this.maxValue);
    const source = this.kind === 'd4'
      ? this.d4Vertices[this.baseD4VertexValues.indexOf(target)]?.clone().normalize()
      : this.faces.find((_candidate, index) => this.baseFaceValues[index] === target)?.normal.clone().normalize();
    if (!source) throw new Error(`Value ${value} is not valid for ${this.kind}.`);
    return source;
  }

  /**
   * Return a proper rotational symmetry of the die that maps one numbered
   * result direction onto another. Applying this rotation in local space to
   * every frame preserves the physical shape and the complete trajectory; it
   * only changes the die's initial orientation. This is exact for the regular
   * Draftroll d4/d6/d8/d10/d12/d20 colliders.
   */
  getResultSymmetryRotation(fromValue: number, toValue: number): THREE.Quaternion {
    const from = THREE.MathUtils.clamp(Math.round(fromValue), 1, this.maxValue);
    const to = THREE.MathUtils.clamp(Math.round(toValue), 1, this.maxValue);
    if (from === to) return new THREE.Quaternion();
    const cacheKey = `${this.kind}:${from}:${to}`;
    const cached = DieInstance.symmetryRotationCache.get(cacheKey);
    if (cached) return cached.clone();

    const normals = Array.from({ length: this.maxValue }, (_entry, index) => this.getTargetNormal(index + 1));
    const sourcePrimary = normals[from - 1];
    const targetPrimary = normals[to - 1];
    const sourceBasis = new THREE.Matrix4();
    const targetBasis = new THREE.Matrix4();
    const sourceX = sourcePrimary.clone().normalize();
    const targetX = targetPrimary.clone().normalize();

    for (let sourceIndex = 0; sourceIndex < normals.length; sourceIndex += 1) {
      if (sourceIndex === from - 1) continue;
      const sourceSecondary = normals[sourceIndex];
      const sourceDot = sourceX.dot(sourceSecondary);
      const sourceY = sourceSecondary.clone().addScaledVector(sourceX, -sourceDot);
      if (sourceY.lengthSq() < 1e-8) continue;
      sourceY.normalize();
      const sourceZ = sourceX.clone().cross(sourceY).normalize();
      sourceY.copy(sourceZ).cross(sourceX).normalize();
      sourceBasis.makeBasis(sourceX, sourceY, sourceZ);

      for (let targetIndex = 0; targetIndex < normals.length; targetIndex += 1) {
        if (targetIndex === to - 1) continue;
        const targetSecondary = normals[targetIndex];
        const targetDot = targetX.dot(targetSecondary);
        if (Math.abs(sourceDot - targetDot) > 1e-4) continue;
        const targetY = targetSecondary.clone().addScaledVector(targetX, -targetDot);
        if (targetY.lengthSq() < 1e-8) continue;
        targetY.normalize();
        const targetZ = targetX.clone().cross(targetY).normalize();
        targetY.copy(targetZ).cross(targetX).normalize();
        targetBasis.makeBasis(targetX, targetY, targetZ);

        const matrix = targetBasis.clone().multiply(sourceBasis.clone().transpose());
        const rotation = new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
        const mapsShape = normals.every((normal) => {
          const transformed = normal.clone().applyQuaternion(rotation);
          return normals.some((candidate) => transformed.dot(candidate) > 0.9995);
        });
        if (!mapsShape) continue;
        if (sourcePrimary.clone().applyQuaternion(rotation).dot(targetPrimary) < 0.9995) continue;
        DieInstance.symmetryRotationCache.set(cacheKey, rotation.clone());
        return rotation;
      }
    }

    throw new Error(`No rotational symmetry maps ${this.kind} value ${from} to ${to}.`);
  }

  getTargetQuaternion(value: number, yaw = Math.random() * Math.PI * 2): THREE.Quaternion {
    const source = this.getTargetNormal(value);
    const align = new THREE.Quaternion().setFromUnitVectors(source, new THREE.Vector3(0, 1, 0));
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return spin.multiply(align).normalize();
  }

  hasTopValue(value: number): boolean {
    return this.getTopValue() === value;
  }

  dispose(): void {
    this.labels.geometry.dispose();
    this.contactShadow.material.dispose();
    if (this.adornment) this.disposeAdornment(this.adornment);
  }
}
