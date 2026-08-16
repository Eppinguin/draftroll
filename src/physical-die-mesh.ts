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
import { THEMES, type ThemeName } from './themes';

const LABEL_ATLAS_COLUMNS = 5;
const LABEL_ATLAS_ROWS = 4;
const LABEL_ATLAS_PADDING = 0.055;
let shadowTexture: THREE.CanvasTexture | null = null;

export interface PhysicalDieMesh {
  group: THREE.Group;
  visualRoot: THREE.Group;
  labelMaterials: THREE.MeshBasicMaterial[];
  labelMaps: Array<THREE.Texture | null>;
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

function createSurfaceTexture(spec: DraftrollPhysicalVisual): THREE.CanvasTexture {
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

function atlasCellTexture(atlas: THREE.Texture, value: number): THREE.Texture {
  const clamped = THREE.MathUtils.clamp(Math.round(value), 1, 20);
  const cell = clamped - 1;
  const column = cell % LABEL_ATLAS_COLUMNS;
  const row = Math.floor(cell / LABEL_ATLAS_COLUMNS);
  const padU = LABEL_ATLAS_PADDING / LABEL_ATLAS_COLUMNS;
  const padV = LABEL_ATLAS_PADDING / LABEL_ATLAS_ROWS;
  const texture = atlas.clone();
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.offset.set(column / LABEL_ATLAS_COLUMNS + padU, 1 - (row + 1) / LABEL_ATLAS_ROWS + padV);
  texture.repeat.set(1 / LABEL_ATLAS_COLUMNS - padU * 2, 1 / LABEL_ATLAS_ROWS - padV * 2);
  texture.needsUpdate = true;
  return texture;
}

function presentationTexture(
  spec: DraftrollPhysicalVisual,
  content: PhysicalDieFaceContent,
  style: ThemeLabelStyleDefinition | undefined,
  fontFamily: string | undefined,
): THREE.Texture {
  if (content.kind === 'texture') {
    const source = getRuntimeThemeAssetTexture(spec.theme, content.asset);
    if (source) {
      const texture = source.clone();
      texture.needsUpdate = true;
      return texture;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
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
  const fontSize = content.kind === 'icon' ? 148 : length >= 5 ? 64 : length >= 3 ? 86 : 132;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.font = `800 ${fontSize}px ${fontFamily ?? 'system-ui, sans-serif'}`;
  context.lineWidth = Math.max(1, Math.round(fontSize * (style?.outlineWidth ?? 0.08)));
  context.strokeStyle = style?.outlineColor ?? 'rgba(0,0,0,.72)';
  if (style?.glowColor) {
    context.shadowColor = style.glowColor;
    context.shadowBlur = Math.max(4, Math.round(fontSize * 0.08));
  }
  context.strokeText(text, 128, 126);
  context.fillStyle = style?.color ?? palette.label;
  context.fillText(text, 128, 126);
  context.shadowBlur = 0;
  if (content.kind === 'number' && (text === '6' || text === '9')) {
    context.strokeStyle = style?.color ?? palette.label;
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
  if (!shape) throw new Error('Physical die visual requires readable polyhedron geometry.');
  const palette = THEMES[normalizeTheme(spec.theme)];
  const group = new THREE.Group();
  const visualRoot = new THREE.Group();
  group.add(visualRoot);

  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const ownedTextures: THREE.Texture[] = [];
  const runtimeMesh =
    getRuntimeThemeMesh(spec.theme, spec.type) ??
    getRuntimeThemeMesh(spec.theme, `d${definition.sides}`);
  const geometry = runtimeMesh ? scaleThemeMesh(runtimeMesh, definition) : triangulateShape(shape);
  ownedGeometries.push(geometry);
  const generatedSurface = createSurfaceTexture(spec);
  ownedTextures.push(generatedSurface);
  const runtimeSurface =
    getRuntimeThemeTexture(spec.theme, spec.type, 'surface') ??
    getRuntimeThemeTexture(spec.theme, `d${definition.sides}`, 'surface');
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
    map: runtimeSurface ?? generatedSurface,
    normalMap: runtimeNormal,
    roughnessMap: runtimeRoughness,
    color: runtimeMaterial?.color ?? 0xffffff,
    emissive: runtimeMaterial?.emissive ?? 0x000000,
    emissiveIntensity: runtimeMaterial?.emissiveIntensity ?? 0,
    roughness: runtimeMaterial?.roughness ?? 0.39,
    metalness: runtimeMaterial?.metalness ?? 0.22,
    clearcoat: runtimeMaterial?.clearcoat ?? 0.35,
    clearcoatRoughness: runtimeMaterial?.clearcoatRoughness ?? 0.28,
    flatShading: true,
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

  const edgeGeometry = new THREE.EdgesGeometry(geometry, 18);
  ownedGeometries.push(edgeGeometry);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: palette.edge,
    transparent: true,
    opacity: 0,
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
  const labelMaps = definition.outcomes.map((outcome, index): THREE.Texture | null => {
    if (!explicitPresentation && runtimeAtlas && definition.sides <= 20) {
      const texture = atlasCellTexture(runtimeAtlas, outcome.value);
      ownedTextures.push(texture);
      return texture;
    }
    const content = presentation.contents[index] ?? {
      kind: 'number' as const,
      value: outcome.value,
    };
    const texture = presentationTexture(spec, content, labelStyle, fontFamily);
    ownedTextures.push(texture);
    return texture;
  });
  const labelMaterials = definition.outcomes.map((outcome, index) => {
    const material = new THREE.MeshBasicMaterial({
      map: labelMaps[index] ?? undefined,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    ownedMaterials.push(material);
    for (const anchor of outcome.labelAnchors) {
      const labelGeometry = new THREE.PlaneGeometry(
        anchor.scale * labelScale,
        anchor.scale * labelScale,
      );
      ownedGeometries.push(labelGeometry);
      const label = new THREE.Mesh(labelGeometry, material);
      label.position
        .fromArray(anchor.position)
        .addScaledVector(new THREE.Vector3(...anchor.normal), 0.014);
      label.quaternion.copy(anchorQuaternion(anchor));
      label.renderOrder = 7;
      visualRoot.add(label);
    }
    return material;
  });

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
    if (outcomeIndex === undefined) continue;
    const anchor = secondaryAnchor(shape, faceIndex);
    const labelGeometry = new THREE.PlaneGeometry(
      anchor.scale * labelScale,
      anchor.scale * labelScale,
    );
    ownedGeometries.push(labelGeometry);
    const label = new THREE.Mesh(labelGeometry, labelMaterials[outcomeIndex]);
    label.position
      .fromArray(anchor.position)
      .addScaledVector(new THREE.Vector3(...anchor.normal), 0.014);
    label.quaternion.copy(anchorQuaternion(anchor));
    label.renderOrder = 7;
    visualRoot.add(label);
  }

  if (shape.family === 'd1-cylinder' || shape.family === 'd2-coin') {
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
    edgeMaterial.opacity = value * 0.92;
    labelMaterials.forEach((material) => {
      material.opacity = value;
    });
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
    labelMaterials,
    labelMaps,
    setOpacity,
    updateShadow,
    dispose(): void {
      for (const geometryToDispose of ownedGeometries) geometryToDispose.dispose();
      for (const materialToDispose of ownedMaterials) materialToDispose.dispose();
      for (const textureToDispose of ownedTextures) textureToDispose.dispose();
    },
  };
}
