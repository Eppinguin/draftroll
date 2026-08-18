import * as THREE from 'three';
import type { DraftrollPhysicalVisual } from '../packages/renderer/src/index';
import type { PolyhedronLabelAnchor, ReadablePolyhedron } from '../packages/renderer/src/polyhedra';
import type {
  PhysicalDieDefinition,
  PhysicalDieFaceContent,
  PhysicalDiePresentation,
} from './physical-dice';
import {
  getRuntimeThemeAssetTexture,
  getRuntimeThemeFont,
  getRuntimeThemeLabelStyle,
  getRuntimeThemeMaterial,
  getRuntimeThemeMesh,
  getRuntimeThemeTexture,
} from './runtime-themes';
import type { ThemeLabelStyleDefinition } from '../packages/themes/src/index';
import { THEMES, type ThemeGeometryProfile, type ThemeName } from './themes';
import { createThemedRoundedBoxVisual, getThemeSurfaceTextures } from './dice';

const LABEL_ATLAS_COLUMNS = 5;
const LABEL_ATLAS_ROWS = 4;
const LABEL_ATLAS_PADDING = 0.055;
let shadowTexture: THREE.CanvasTexture | null = null;
const labelAtlasCache = new Map<
  string,
  { texture: THREE.CanvasTexture; refs: number; columns: number; rows: number }
>();

export interface PhysicalDieMesh {
  group: THREE.Group;
  visualRoot: THREE.Group;
  swapOutcomeLabels(first: number, second: number): void;
  setOpacity(opacity: number): void;
  updateShadow(height: number, opacity?: number): void;
  dispose(): void;
}

export interface PhysicalDieMeshOptions {
  spec: DraftrollPhysicalVisual;
  definition: PhysicalDieDefinition;
  presentation: PhysicalDiePresentation;
  explicitPresentation: boolean;
}

function normalizeTheme(theme: string): ThemeName {
  return Object.hasOwn(THEMES, theme) ? theme : 'dragon';
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

function triangulateShape(shape: ReadablePolyhedron): THREE.BufferGeometry {
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

interface BeveledEdgeSide {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

function generatedEdgeKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

/**
 * Applies a theme bevel to generated render geometry only.
 *
 * The readable polyhedron remains the authoritative collider/support topology. This visual copy
 * may change silhouette and edge highlights without changing physics, landing resolution, or
 * deterministic outcome mapping.
 */
function triangulateBeveledShape(
  shape: ReadablePolyhedron,
  profile: ThemeGeometryProfile,
): THREE.BufferGeometry {
  const bevel = THREE.MathUtils.clamp(profile.bevel, 0, 0.3);
  if (bevel <= 0.001) return triangulateShape(shape);

  const positions: number[] = [];
  const uvs: number[] = [];
  const edges = new Map<string, BeveledEdgeSide[]>();
  const normal = new THREE.Vector3();
  const basisU = new THREE.Vector3();
  const basisV = new THREE.Vector3();

  shape.faces.forEach((face, faceIndex) => {
    if (face.length < 3) return;
    const vertices = face.map((vertexIndex) => new THREE.Vector3(...shape.vertices[vertexIndex]));
    const center = vertices
      .reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
      .multiplyScalar(1 / vertices.length);
    normal.copy(faceNormal(shape, faceIndex));
    const inset = vertices.map((vertex) =>
      vertex
        .clone()
        .lerp(center, bevel)
        .addScaledVector(normal, -bevel * profile.bevelDepth * center.length()),
    );

    basisU.copy(vertices[1]).sub(vertices[0]).normalize();
    basisV.crossVectors(normal, basisU).normalize();
    const projected = vertices.map((vertex) => ({
      u: vertex.dot(basisU),
      v: vertex.dot(basisV),
    }));
    const minU = Math.min(...projected.map((value) => value.u));
    const maxU = Math.max(...projected.map((value) => value.u));
    const minV = Math.min(...projected.map((value) => value.v));
    const maxV = Math.max(...projected.map((value) => value.v));
    const spanU = Math.max(1e-5, maxU - minU);
    const spanV = Math.max(1e-5, maxV - minV);
    const faceUvs = projected.map(
      (value) =>
        [
          0.06 + (0.88 * (value.u - minU)) / spanU,
          0.06 + (0.88 * (value.v - minV)) / spanV,
        ] as const,
    );

    for (let index = 1; index + 1 < face.length; index += 1) {
      for (const localIndex of [0, index, index + 1]) {
        const vertex = inset[localIndex];
        positions.push(vertex.x, vertex.y, vertex.z);
        uvs.push(faceUvs[localIndex][0], faceUvs[localIndex][1]);
      }
    }

    for (let index = 0; index < face.length; index += 1) {
      const next = (index + 1) % face.length;
      const key = generatedEdgeKey(face[index], face[next]);
      const side = { a: inset[index], b: inset[next] };
      const existing = edges.get(key);
      if (existing) existing.push(side);
      else edges.set(key, [side]);
    }
  });

  const chamferUvs = [0.46, 0.46, 0.54, 0.46, 0.46, 0.54, 0.46, 0.54, 0.54, 0.46, 0.54, 0.54];
  for (const sides of edges.values()) {
    if (sides.length !== 2) continue;
    const [first, second] = sides;
    const reverse = second.b.distanceToSquared(first.a) < second.a.distanceToSquared(first.a);
    const otherA = reverse ? second.b : second.a;
    const otherB = reverse ? second.a : second.b;
    for (const vertex of [first.a, otherA, first.b, first.b, otherA, otherB]) {
      positions.push(vertex.x, vertex.y, vertex.z);
    }
    uvs.push(...chamferUvs);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function insetLabelAnchor(
  anchor: PolyhedronLabelAnchor,
  shape: ReadablePolyhedron,
  profile: ThemeGeometryProfile,
): PolyhedronLabelAnchor {
  const face = shape.faces[anchor.faceIndex];
  if (!face || face.length < 3) return anchor;
  const bevel = THREE.MathUtils.clamp(profile.bevel, 0, 0.3);
  const center = face
    .map((vertexIndex) => new THREE.Vector3(...shape.vertices[vertexIndex]))
    .reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
    .multiplyScalar(1 / face.length);
  const normal = new THREE.Vector3(...anchor.normal).normalize();
  const position = new THREE.Vector3(...anchor.position)
    .lerp(center, bevel)
    .addScaledVector(normal, -bevel * profile.bevelDepth * center.length());
  return {
    ...anchor,
    position: [position.x, position.y, position.z],
    scale: anchor.scale * THREE.MathUtils.clamp(profile.faceInset, 0.65, 1.1),
  };
}

function readableCubeSize(shape: ReadablePolyhedron): number {
  const xs = shape.vertices.map((vertex) => vertex[0]);
  const ys = shape.vertices.map((vertex) => vertex[1]);
  const zs = shape.vertices.map((vertex) => vertex[2]);
  return Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    Math.max(...zs) - Math.min(...zs),
  );
}

function scaleLabelAnchor(
  anchor: PolyhedronLabelAnchor,
  profile: ThemeGeometryProfile,
): PolyhedronLabelAnchor {
  return {
    ...anchor,
    scale: anchor.scale * THREE.MathUtils.clamp(profile.faceInset, 0.65, 1.1),
  };
}

function faceNormal(shape: ReadablePolyhedron, faceIndex: number): THREE.Vector3 {
  const face = shape.faces[faceIndex];
  const points = face.map((index) => new THREE.Vector3(...shape.vertices[index]));
  const normal = new THREE.Vector3()
    .crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0]))
    .normalize();
  const center = points
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
  if (normal.dot(center) < 0) normal.negate();
  return normal;
}

function secondaryAnchor(shape: ReadablePolyhedron, faceIndex: number): PolyhedronLabelAnchor {
  const face = shape.faces[faceIndex];
  const points = face.map((index) => new THREE.Vector3(...shape.vertices[index]));
  const center = points
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
  const normal = faceNormal(shape, faceIndex);
  let span = 0;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      span = Math.max(span, points[first].distanceTo(points[second]));
    }
  }
  const reference =
    Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const up = reference.projectOnPlane(normal).normalize();
  return {
    kind: 'face',
    faceIndex,
    position: [center.x, center.y, center.z],
    normal: [normal.x, normal.y, normal.z],
    up: [up.x, up.y, up.z],
    scale: THREE.MathUtils.clamp(span * 0.24, 0.13, 0.3),
  };
}

function anchorQuaternion(anchor: PolyhedronLabelAnchor): THREE.Quaternion {
  const normal = new THREE.Vector3(...anchor.normal).normalize();
  const up = new THREE.Vector3(...anchor.up).projectOnPlane(normal).normalize();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, normal),
  );
}

interface LabelAtlasResource {
  texture: THREE.Texture;
  columns: number;
  rows: number;
  cells: number[];
  padding: number;
  release(): void;
}

function drawLabelContent(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  spec: DraftrollPhysicalVisual,
  content: PhysicalDieFaceContent,
  style: ThemeLabelStyleDefinition | undefined,
  fontFamily: string | undefined,
): void {
  if (content.kind === 'texture') {
    const sourceTexture = getRuntimeThemeAssetTexture(spec.theme, content.asset);
    const image = sourceTexture?.image;
    const drawable =
      image instanceof HTMLImageElement ||
      image instanceof HTMLCanvasElement ||
      image instanceof HTMLVideoElement ||
      (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap);
    if (drawable) {
      const inset = Math.max(2, Math.round(size * 0.08));
      context.drawImage(image, x + inset, y + inset, size - inset * 2, size - inset * 2);
      return;
    }
  }
  const palette = THEMES[normalizeTheme(spec.theme)];
  const text =
    content.kind === 'number'
      ? (content.label ?? String(content.value))
      : content.kind === 'text'
        ? content.text
        : content.kind === 'icon'
          ? content.icon
          : (content.label ?? '◆');
  const length = Array.from(text).length;
  const base = content.kind === 'icon' ? 0.58 : length >= 5 ? 0.27 : length >= 3 ? 0.36 : 0.53;
  const fontSize = Math.max(12, Math.round(size * base));
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.font = `800 ${fontSize}px ${fontFamily ?? 'system-ui, sans-serif'}`;
  context.lineWidth = Math.max(1, Math.round(fontSize * (style?.outlineWidth ?? 0.08)));
  context.strokeStyle = style?.outlineColor ?? 'rgba(0,0,0,.72)';
  if (style?.glowColor) {
    context.shadowColor = style.glowColor;
    context.shadowBlur = Math.max(2, Math.round(fontSize * 0.08));
  }
  context.strokeText(text, x + size / 2, y + size * 0.49);
  context.fillStyle = style?.color ?? palette.label;
  context.fillText(text, x + size / 2, y + size * 0.49);
  context.shadowBlur = 0;
  if (content.kind === 'number' && (text === '6' || text === '9')) {
    context.strokeStyle = style?.color ?? palette.label;
    context.lineWidth = Math.max(2, Math.round(size * 0.03));
    context.beginPath();
    context.moveTo(x + size * 0.36, y + size * 0.79);
    context.lineTo(x + size * 0.64, y + size * 0.79);
    context.stroke();
  }
  context.restore();
}

function generatedAtlasKey(
  spec: DraftrollPhysicalVisual,
  presentation: PhysicalDiePresentation,
  style: ThemeLabelStyleDefinition | undefined,
  fontFamily: string | undefined,
): string {
  return JSON.stringify([spec.theme, presentation.contents, style ?? null, fontFamily ?? null]);
}

function acquireLabelAtlas(
  spec: DraftrollPhysicalVisual,
  definition: PhysicalDieDefinition,
  presentation: PhysicalDiePresentation,
  explicitPresentation: boolean,
  runtimeAtlas: THREE.Texture | undefined,
  style: ThemeLabelStyleDefinition | undefined,
  fontFamily: string | undefined,
): LabelAtlasResource {
  if (!explicitPresentation && runtimeAtlas && definition.sides <= 20) {
    return {
      texture: runtimeAtlas,
      columns: LABEL_ATLAS_COLUMNS,
      rows: LABEL_ATLAS_ROWS,
      cells: definition.outcomes.map(
        (outcome) => THREE.MathUtils.clamp(Math.round(outcome.value), 1, 20) - 1,
      ),
      padding: LABEL_ATLAS_PADDING,
      release() {},
    };
  }
  const key = generatedAtlasKey(spec, presentation, style, fontFamily);
  let cached = labelAtlasCache.get(key);
  if (!cached) {
    const count = Math.max(1, definition.outcomes.length);
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const cellSize = THREE.MathUtils.clamp(Math.floor(4096 / Math.max(columns, rows)), 32, 128);
    const canvas = document.createElement('canvas');
    canvas.width = columns * cellSize;
    canvas.height = rows * cellSize;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable.');
    presentation.contents.forEach((content, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      drawLabelContent(
        context,
        column * cellSize,
        row * cellSize,
        cellSize,
        spec,
        content,
        style,
        fontFamily,
      );
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    cached = { texture, refs: 0, columns, rows };
    labelAtlasCache.set(key, cached);
  }
  cached.refs += 1;
  return {
    texture: cached.texture,
    columns: cached.columns,
    rows: cached.rows,
    cells: definition.outcomes.map((_outcome, index) => index),
    padding: 0.08,
    release(): void {
      const current = labelAtlasCache.get(key);
      if (!current) return;
      current.refs -= 1;
      if (current.refs <= 0) {
        current.texture.dispose();
        labelAtlasCache.delete(key);
      }
    },
  };
}

function labelUvRect(
  atlas: LabelAtlasResource,
  cell: number,
): readonly [number, number, number, number] {
  const column = cell % atlas.columns;
  const row = Math.floor(cell / atlas.columns);
  const padU = atlas.padding / atlas.columns;
  const padV = atlas.padding / atlas.rows;
  const u0 = column / atlas.columns + padU;
  const u1 = (column + 1) / atlas.columns - padU;
  const v0 = 1 - (row + 1) / atlas.rows + padV;
  const v1 = 1 - row / atlas.rows - padV;
  return [u0, v0, u1, v1];
}

function appendLabelQuad(positions: number[], anchor: PolyhedronLabelAnchor, scale: number): void {
  const center = new THREE.Vector3(...anchor.position).addScaledVector(
    new THREE.Vector3(...anchor.normal),
    0.014,
  );
  const rotation = anchorQuaternion(anchor);
  const half = (anchor.scale * scale) / 2;
  const corners = [
    new THREE.Vector3(-half, -half, 0),
    new THREE.Vector3(half, -half, 0),
    new THREE.Vector3(half, half, 0),
    new THREE.Vector3(-half, half, 0),
  ].map((corner) => corner.applyQuaternion(rotation).add(center));
  for (const index of [0, 1, 2, 0, 2, 3]) {
    const point = corners[index];
    positions.push(point.x, point.y, point.z);
  }
}

function writeOutcomeUvs(
  uvs: Float32Array,
  vertexStart: number,
  vertexCount: number,
  atlas: LabelAtlasResource,
  cell: number,
): void {
  const [u0, v0, u1, v1] = labelUvRect(atlas, cell);
  const quad = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const source = (vertex % 6) * 2;
    const target = (vertexStart + vertex) * 2;
    uvs[target] = quad[source];
    uvs[target + 1] = quad[source + 1];
  }
}

function colliderGeometry(definition: PhysicalDieDefinition): THREE.BufferGeometry {
  const collider = definition.collider;
  if (collider.kind === 'box') {
    return new THREE.BoxGeometry(
      collider.halfExtents[0] * 2,
      collider.halfExtents[1] * 2,
      collider.halfExtents[2] * 2,
    );
  }
  if (collider.kind === 'cylinder') {
    return new THREE.CylinderGeometry(
      collider.radiusTop,
      collider.radiusBottom,
      collider.height,
      collider.segments,
    );
  }
  const positions: number[] = [];
  for (const face of collider.faces) {
    for (let index = 1; index + 1 < face.length; index += 1) {
      for (const vertexIndex of [face[0], face[index], face[index + 1]]) {
        const vertex = collider.vertices[vertexIndex];
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

function scaleThemeMesh(
  geometry: THREE.BufferGeometry,
  definition: PhysicalDieDefinition,
): THREE.BufferGeometry {
  const themed = geometry.clone();
  themed.computeBoundingSphere();
  const radius = themed.boundingSphere?.radius ?? 0;
  if (radius > 1e-6) {
    const scale = definition.radius / radius;
    themed.scale(scale, scale, scale);
  }
  themed.computeVertexNormals();
  themed.computeBoundingSphere();
  return themed;
}

export function createPhysicalDieMesh(options: PhysicalDieMeshOptions): PhysicalDieMesh {
  const { spec, definition, presentation, explicitPresentation } = options;
  const shape = definition.readableShape;
  const palette = THEMES[normalizeTheme(spec.theme)];
  const group = new THREE.Group();
  const visualRoot = new THREE.Group();
  group.add(visualRoot);

  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const runtimeMesh =
    getRuntimeThemeMesh(spec.theme, spec.type) ??
    getRuntimeThemeMesh(spec.theme, `d${definition.sides}`);
  const generatedGeometryProfile =
    !runtimeMesh && !spec.definition && shape ? palette.geometry : null;
  const roundedGeneratedCube = Boolean(generatedGeometryProfile && shape?.family === 'd3-cube');
  const geometry = runtimeMesh
    ? scaleThemeMesh(runtimeMesh, definition)
    : shape
      ? roundedGeneratedCube
        ? createThemedRoundedBoxVisual(spec.theme, readableCubeSize(shape))
        : generatedGeometryProfile
          ? triangulateBeveledShape(shape, generatedGeometryProfile)
          : triangulateShape(shape)
      : colliderGeometry(definition);
  ownedGeometries.push(geometry);
  const runtimeSurface =
    getRuntimeThemeTexture(spec.theme, spec.type, 'surface') ??
    getRuntimeThemeTexture(spec.theme, `d${definition.sides}`, 'surface');
  const sharedThemeSurface = runtimeSurface
    ? null
    : getThemeSurfaceTextures(normalizeTheme(spec.theme));
  const runtimeNormal =
    getRuntimeThemeTexture(spec.theme, spec.type, 'normal') ??
    getRuntimeThemeTexture(spec.theme, `d${definition.sides}`, 'normal');
  const runtimeRoughness =
    getRuntimeThemeTexture(spec.theme, spec.type, 'roughness') ??
    getRuntimeThemeTexture(spec.theme, `d${definition.sides}`, 'roughness');
  const runtimeMaterial =
    getRuntimeThemeMaterial(spec.theme, spec.type) ??
    getRuntimeThemeMaterial(spec.theme, `d${definition.sides}`);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    map: runtimeSurface ?? sharedThemeSurface?.map ?? null,
    normalMap: runtimeNormal ?? sharedThemeSurface?.normalMap,
    normalScale: new THREE.Vector2(0.82, 0.82),
    roughnessMap: runtimeRoughness ?? sharedThemeSurface?.roughnessMap,
    color: runtimeMaterial?.color ?? 0xffffff,
    emissive: runtimeMaterial?.emissive ?? palette.emissive,
    emissiveIntensity: runtimeMaterial?.emissiveIntensity ?? palette.emissiveIntensity,
    roughness: runtimeMaterial?.roughness ?? 1,
    metalness: runtimeMaterial?.metalness ?? palette.metalness,
    clearcoat: runtimeMaterial?.clearcoat ?? palette.clearcoat,
    clearcoatRoughness: runtimeMaterial?.clearcoatRoughness ?? palette.clearcoatRoughness,
    clearcoatNormalMap: runtimeNormal ?? sharedThemeSurface?.normalMap,
    clearcoatNormalScale: new THREE.Vector2(0.28, 0.28),
    flatShading: !roundedGeneratedCube,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  ownedMaterials.push(bodyMaterial);
  const body = new THREE.Mesh(geometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  body.renderOrder = 1;
  visualRoot.add(body);

  const edgeGeometry = new THREE.EdgesGeometry(geometry, roundedGeneratedCube ? 32 : 18);
  ownedGeometries.push(edgeGeometry);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: palette.edge,
    transparent: true,
    opacity: 0,
    toneMapped: false,
  });
  ownedMaterials.push(edgeMaterial);
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.scale.setScalar(1.004);
  edges.renderOrder = 2;
  visualRoot.add(edges);

  const fallbackKind = `d${definition.sides}`;
  const runtimeAtlas =
    getRuntimeThemeTexture(spec.theme, spec.type, 'label') ??
    getRuntimeThemeTexture(spec.theme, fallbackKind, 'label');
  const labelStyle = getRuntimeThemeLabelStyle(spec.theme, spec.type, fallbackKind);
  const labelScale = labelStyle?.scale ?? 1;
  const fontFamily = getRuntimeThemeFont(spec.theme, spec.type, fallbackKind);
  const anchorsByOutcome = definition.outcomes.map((outcome) => outcome.labelAnchors.slice());
  if (shape) {
    const covered = new Set(
      definition.outcomes.flatMap((outcome) =>
        outcome.labelAnchors.map((anchor) => anchor.faceIndex),
      ),
    );
    for (let faceIndex = 0; faceIndex < shape.faces.length; faceIndex += 1) {
      if (covered.has(faceIndex)) continue;
      const normal = faceNormal(shape, faceIndex);
      const outcomeIndex = definition.outcomes
        .map((outcome, index) => ({
          index,
          score: Math.max(
            ...outcome.supportNormals.map((support) => -normal.dot(new THREE.Vector3(...support))),
          ),
        }))
        .toSorted((left, right) => right.score - left.score)[0]?.index;
      if (outcomeIndex !== undefined)
        anchorsByOutcome[outcomeIndex].push(secondaryAnchor(shape, faceIndex));
    }
  }
  if (shape && generatedGeometryProfile) {
    for (let index = 0; index < anchorsByOutcome.length; index += 1) {
      anchorsByOutcome[index] = anchorsByOutcome[index].map((anchor) =>
        roundedGeneratedCube
          ? scaleLabelAnchor(anchor, generatedGeometryProfile)
          : insetLabelAnchor(anchor, shape, generatedGeometryProfile),
      );
    }
  }
  const totalLabelAnchors = anchorsByOutcome.reduce((sum, anchors) => sum + anchors.length, 0);
  const labelAtlas =
    totalLabelAnchors > 0
      ? acquireLabelAtlas(
          spec,
          definition,
          presentation,
          explicitPresentation,
          runtimeAtlas,
          labelStyle,
          fontFamily,
        )
      : null;
  const labelPositions: number[] = [];
  const ranges = anchorsByOutcome.map((anchors) => {
    const vertexStart = labelPositions.length / 3;
    for (const anchor of anchors) appendLabelQuad(labelPositions, anchor, labelScale);
    return { vertexStart, vertexCount: anchors.length * 6 };
  });
  let labelGeometry: THREE.BufferGeometry | null = null;
  let labelMaterial: THREE.MeshBasicMaterial | null = null;
  const outcomeCells = labelAtlas?.cells.slice() ?? [];
  if (labelAtlas && labelPositions.length > 0) {
    labelGeometry = new THREE.BufferGeometry();
    labelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(labelPositions, 3));
    const uvs = new Float32Array((labelPositions.length / 3) * 2);
    ranges.forEach((range, index) =>
      writeOutcomeUvs(uvs, range.vertexStart, range.vertexCount, labelAtlas, outcomeCells[index]),
    );
    labelGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    ownedGeometries.push(labelGeometry);
    labelMaterial = new THREE.MeshBasicMaterial({
      map: labelAtlas.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    ownedMaterials.push(labelMaterial);
    const labels = new THREE.Mesh(labelGeometry, labelMaterial);
    labels.renderOrder = 7;
    visualRoot.add(labels);
  }
  const swapOutcomeLabels = (first: number, second: number): void => {
    if (!labelAtlas || !labelGeometry || first === second) return;
    if (first < 0 || second < 0 || first >= ranges.length || second >= ranges.length) return;
    const firstCell = outcomeCells[first];
    outcomeCells[first] = outcomeCells[second];
    outcomeCells[second] = firstCell;
    const uv = labelGeometry.getAttribute('uv');
    if (!(uv instanceof THREE.BufferAttribute) || !(uv.array instanceof Float32Array)) return;
    writeOutcomeUvs(
      uv.array,
      ranges[first].vertexStart,
      ranges[first].vertexCount,
      labelAtlas,
      outcomeCells[first],
    );
    writeOutcomeUvs(
      uv.array,
      ranges[second].vertexStart,
      ranges[second].vertexCount,
      labelAtlas,
      outcomeCells[second],
    );
    uv.needsUpdate = true;
  };

  if (shape?.family === 'd1-cylinder' || shape?.family === 'd2-coin') {
    visualRoot.scale.set(0.9, 0.9, 1.04);
  }

  const shadowGeometry = new THREE.PlaneGeometry(1, 1);
  ownedGeometries.push(shadowGeometry);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: getShadowTexture(),
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    blending: THREE.NormalBlending,
  });
  ownedMaterials.push(shadowMaterial);
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 0;
  shadow.frustumCulled = false;
  group.add(shadow);
  group.visible = false;

  const setOpacity = (opacity: number): void => {
    const value = THREE.MathUtils.clamp(opacity, 0, 1);
    bodyMaterial.opacity = value;
    edgeMaterial.opacity = value * palette.edgeOpacity * 0.72;
    if (labelMaterial) labelMaterial.opacity = value;
  };
  const updateShadow = (height: number, opacity = 1): void => {
    const radius = Math.max(0.25, definition.radius);
    const floorClearance = Math.max(0, height - radius * 0.72);
    const fade = THREE.MathUtils.clamp(1 - floorClearance / 4.25, 0, 1);
    const scale = radius * 2.05 * (1 + floorClearance * 0.16);
    shadow.position.set(0, -height + 0.008, 0);
    shadow.scale.set(scale, scale, 1);
    shadowMaterial.opacity =
      (0.035 + Math.pow(fade, 1.75) * 0.2) * THREE.MathUtils.clamp(opacity, 0, 1);
    shadow.visible = fade > 0.025 && opacity > 0.01;
  };

  return {
    group,
    visualRoot,
    swapOutcomeLabels,
    setOpacity,
    updateShadow,
    dispose(): void {
      for (const geometryToDispose of ownedGeometries) geometryToDispose.dispose();
      for (const materialToDispose of ownedMaterials) materialToDispose.dispose();
      labelAtlas?.release();
    },
  };
}
