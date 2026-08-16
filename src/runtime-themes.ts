import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  decodeDiceTheme,
  type DiceTheme,
  type RuntimeThemeBundle,
  type ThemeMaterialDefinition,
  type ThemePhysicsDefinition,
} from '../packages/themes/src/index';
import {
  THEMES,
  THEME_MANIFESTS,
  type ThemeGeometryProfile,
  type ThemeManifest,
  type ThemePalette,
  type ThemeSurfaceAudio,
} from './themes';
import type { ThemeEffectSlots } from './effects';

interface RuntimeThemeResources {
  manifest: DiceTheme;
  textures: Map<string, THREE.Texture>;
  meshes: Map<string, THREE.BufferGeometry>;
  fontFamily?: string;
  effects?: ThemeEffectSlots;
  impactAudio?: ArrayBuffer;
  rollAudio?: ArrayBuffer;
}

const runtimeThemes = new Map<string, RuntimeThemeResources>();

export async function installRuntimeThemeBundle(
  bundle: RuntimeThemeBundle,
): Promise<ThemeManifest> {
  const manifest = decodeDiceTheme(bundle.manifest);
  const previous = runtimeThemes.get(manifest.id);
  if (previous) disposeResources(previous);

  const resources: RuntimeThemeResources = {
    manifest,
    textures: new Map(),
    meshes: new Map(),
    effects: manifest.effects,
  };

  await loadThemeTextures(bundle, resources);
  await loadThemeFont(bundle, resources);
  await loadThemeMeshes(bundle, resources);
  resources.impactAudio = cloneAsset(bundle, manifest.audio?.impact?.src);
  resources.rollAudio = cloneAsset(bundle, manifest.audio?.roll?.src);

  runtimeThemes.set(manifest.id, resources);
  THEMES[manifest.id] = createPalette(manifest);
  THEME_MANIFESTS[manifest.id] = createRendererManifest(manifest);
  return cloneRendererManifest(THEME_MANIFESTS[manifest.id]);
}

export function uninstallRuntimeTheme(themeId: string): void {
  const resources = runtimeThemes.get(themeId);
  if (!resources) return;
  disposeResources(resources);
  runtimeThemes.delete(themeId);
  delete THEMES[themeId];
  delete THEME_MANIFESTS[themeId];
}

export function getRuntimeThemeManifest(themeId: string): DiceTheme | undefined {
  const manifest = runtimeThemes.get(themeId)?.manifest;
  return manifest ? structuredClone(manifest) : undefined;
}

export function getRuntimeThemeMaterial(
  themeId: string,
  kind: string,
): ThemeMaterialDefinition | undefined {
  const manifest = runtimeThemes.get(themeId)?.manifest;
  if (!manifest) return undefined;
  return mergeMaterial(manifest.material, manifest.materials?.[kind]);
}

export function getRuntimeThemeTexture(
  themeId: string,
  kind: string,
  slot: 'surface' | 'normal' | 'roughness' | 'label',
): THREE.Texture | undefined {
  const resources = runtimeThemes.get(themeId);
  if (!resources) return undefined;
  const manifest = resources.manifest;
  if (slot === 'label') {
    const reference = manifest.labels?.atlases?.[kind]?.src ?? manifest.labels?.atlas?.src;
    return reference ? resources.textures.get(reference) : undefined;
  }
  const material = getRuntimeThemeMaterial(themeId, kind);
  const reference =
    slot === 'surface'
      ? material?.surfaceTexture?.src
      : slot === 'normal'
        ? material?.normalTexture?.src
        : material?.roughnessTexture?.src;
  return reference ? resources.textures.get(reference) : undefined;
}

export function getRuntimeThemeFont(themeId: string): string | undefined {
  return runtimeThemes.get(themeId)?.fontFamily;
}

export function getRuntimeThemeMesh(
  themeId: string,
  kind: string,
): THREE.BufferGeometry | undefined {
  return runtimeThemes.get(themeId)?.meshes.get(kind);
}

export function getRuntimeThemePhysics(
  themeId: string,
  kind: string,
): ThemePhysicsDefinition | undefined {
  const manifest = runtimeThemes.get(themeId)?.manifest;
  if (!manifest?.physics) return undefined;
  return {
    sizeScale: manifest.physics.dice?.[kind]?.sizeScale ?? manifest.physics.sizeScale,
    massScale: manifest.physics.dice?.[kind]?.massScale ?? manifest.physics.massScale,
    inertiaScale: manifest.physics.dice?.[kind]?.inertiaScale ?? manifest.physics.inertiaScale,
  };
}

export function getRuntimeThemeEffects(themeId: string): ThemeEffectSlots | undefined {
  const effects = runtimeThemes.get(themeId)?.effects;
  return effects ? { ...effects } : undefined;
}

export function getRuntimeThemeAudio(
  themeId: string,
):
  | { impact?: ArrayBuffer; roll?: ArrayBuffer; volume?: number; playbackRate?: [number, number] }
  | undefined {
  const resources = runtimeThemes.get(themeId);
  if (!resources) return undefined;
  return {
    impact: resources.impactAudio?.slice(0),
    roll: resources.rollAudio?.slice(0),
    volume: resources.manifest.audio?.volume,
    playbackRate: resources.manifest.audio?.playbackRate
      ? ([...resources.manifest.audio.playbackRate] as [number, number])
      : undefined,
  };
}

export function invalidateRuntimeThemeMaterials(themeId: string): void {
  // Material caches live in dice.ts. This marker exists so callers can explicitly
  // coordinate invalidation without exposing the internal runtime map.
  void themeId;
}

function createPalette(theme: DiceTheme): ThemePalette {
  const fallback = THEMES.dragon;
  const material = theme.material ?? {};
  const labels = theme.labels ?? {};
  return {
    name: theme.name,
    surface: 'dragon-scale',
    geometry: readGeometryProfile(theme.metadata?.geometry, fallback.geometry),
    base: parseColor(material.color, fallback.base),
    edge: parseColor(theme.metadata?.edgeColor, fallback.edge),
    emissive: parseColor(material.emissive, fallback.emissive),
    label: labels.color ?? fallback.label,
    labelGlow: labels.glowColor ?? fallback.labelGlow,
    particle: parseColor(theme.metadata?.particleColor, fallback.particle),
    shadow: parseColor(theme.metadata?.shadowColor, fallback.shadow),
    roughness: material.roughness ?? fallback.roughness,
    metalness: material.metalness ?? fallback.metalness,
    clearcoat: material.clearcoat ?? fallback.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness ?? fallback.clearcoatRoughness,
    bumpScale: readNumber(theme.metadata?.bumpScale, fallback.bumpScale),
    emissiveIntensity: material.emissiveIntensity ?? fallback.emissiveIntensity,
    edgeOpacity: readNumber(theme.metadata?.edgeOpacity, fallback.edgeOpacity),
    shellOpacity: readNumber(theme.metadata?.shellOpacity, fallback.shellOpacity),
  };
}

function createRendererManifest(theme: DiceTheme): ThemeManifest {
  const audioProfile = readAudioProfile(theme.metadata?.surfaceAudio);
  return {
    id: theme.id,
    name: theme.name,
    version: theme.version,
    description: theme.description,
    author: theme.author,
    previews: theme.previews
      ? Object.fromEntries(
          Object.entries(theme.previews).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
    availableDice: theme.availableDice ? [...theme.availableDice] : undefined,
    capabilities: {
      positiveEffect: theme.effects?.positive !== undefined,
      neutralEffect: theme.effects?.neutral !== undefined,
      negativeEffect: theme.effects?.negative !== undefined,
      customModel: Object.keys(theme.meshes ?? {}).length > 0,
      customCollider: false,
      customAudio: Boolean(theme.audio?.impact || theme.audio?.roll),
    },
    surfaceAudio: audioProfile,
  };
}

function cloneRendererManifest(manifest: ThemeManifest): ThemeManifest {
  return {
    ...manifest,
    previews: manifest.previews ? { ...manifest.previews } : undefined,
    availableDice: manifest.availableDice ? [...manifest.availableDice] : undefined,
    capabilities: { ...manifest.capabilities },
    surfaceAudio: {
      ...manifest.surfaceAudio,
      pitchRange: [...manifest.surfaceAudio.pitchRange] as [number, number],
    },
  };
}

async function loadThemeTextures(
  bundle: RuntimeThemeBundle,
  resources: RuntimeThemeResources,
): Promise<void> {
  const references = new Set<string>();
  const add = (reference?: string) => {
    if (reference) references.add(reference);
  };
  const manifest = resources.manifest;
  const materials = [manifest.material, ...Object.values(manifest.materials ?? {})];
  for (const material of materials) {
    add(material?.surfaceTexture?.src);
    add(material?.normalTexture?.src);
    add(material?.roughnessTexture?.src);
  }
  add(manifest.labels?.atlas?.src);
  for (const atlas of Object.values(manifest.labels?.atlases ?? {})) add(atlas?.src);

  for (const reference of references) {
    const asset = bundle.assets[reference];
    if (!asset || !asset.mimeType.startsWith('image/')) continue;
    try {
      const texture = await loadTexture(asset.data, asset.mimeType);
      resources.textures.set(reference, texture);
    } catch {
      // Invalid optional resources fall back to generated surfaces and labels.
    }
  }
}

async function loadThemeFont(
  bundle: RuntimeThemeBundle,
  resources: RuntimeThemeResources,
): Promise<void> {
  const font = resources.manifest.labels?.font;
  const family = resources.manifest.labels?.fontFamily;
  if (!font || !family || typeof FontFace === 'undefined' || typeof document === 'undefined') {
    resources.fontFamily = family;
    return;
  }
  const asset = bundle.assets[font.src];
  if (!asset) return;
  try {
    const face = new FontFace(family, asset.data.slice(0));
    await face.load();
    document.fonts.add(face);
    resources.fontFamily = family;
  } catch {
    resources.fontFamily = undefined;
  }
}

async function loadThemeMeshes(
  bundle: RuntimeThemeBundle,
  resources: RuntimeThemeResources,
): Promise<void> {
  for (const [kind, definition] of Object.entries(resources.manifest.meshes ?? {})) {
    if (!definition) continue;
    const asset = bundle.assets[definition.asset.src];
    if (!asset) continue;
    try {
      const geometry = await parseMesh(
        asset.data,
        asset.mimeType,
        definition.maxVertices ?? 50_000,
        definition.scale ?? 1,
      );
      resources.meshes.set(kind, geometry);
    } catch {
      // Standard geometry remains the safe fallback.
    }
  }
}

async function loadTexture(data: ArrayBuffer, mimeType: string): Promise<THREE.Texture> {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function parseMesh(
  data: ArrayBuffer,
  mimeType: string,
  maximumVertices: number,
  scale: number,
): Promise<THREE.BufferGeometry> {
  const loader = new GLTFLoader();
  let input: ArrayBuffer | string;
  if (mimeType.includes('json')) {
    const text = new TextDecoder().decode(data);
    const document: { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> } =
      JSON.parse(text);
    const externalReferences = [
      ...(document.buffers ?? []).map((entry) => entry.uri),
      ...(document.images ?? []).map((entry) => entry.uri),
    ].filter((uri): uri is string => typeof uri === 'string' && !uri.startsWith('data:'));
    if (externalReferences.length > 0)
      throw new Error('Theme glTF must be self-contained; use GLB or data URIs');
    input = text;
  } else {
    input = data.slice(0);
  }
  const gltf = await loader.parseAsync(input, '');
  let source: THREE.BufferGeometry | undefined;
  gltf.scene.traverse((child: THREE.Object3D) => {
    if (!source && child instanceof THREE.Mesh && child.geometry instanceof THREE.BufferGeometry)
      source = child.geometry;
  });
  if (!source) throw new Error('Theme mesh contains no buffer geometry');
  const geometry = source.clone();
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3 || position.count > maximumVertices) {
    geometry.dispose();
    throw new Error(`Theme mesh vertex count must be between 3 and ${maximumVertices}`);
  }
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius ?? 0;
  if (!Number.isFinite(radius) || radius <= 0) {
    geometry.dispose();
    throw new Error('Theme mesh has invalid bounds');
  }
  const normalizedScale = (0.72 / radius) * scale;
  geometry.scale(normalizedScale, normalizedScale, normalizedScale);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function disposeResources(resources: RuntimeThemeResources): void {
  resources.textures.forEach((texture) => texture.dispose());
  resources.meshes.forEach((geometry) => geometry.dispose());
}

function mergeMaterial(
  base?: ThemeMaterialDefinition,
  override?: ThemeMaterialDefinition,
): ThemeMaterialDefinition | undefined {
  if (!base && !override) return undefined;
  return { ...base, ...override };
}

function cloneAsset(bundle: RuntimeThemeBundle, reference?: string): ArrayBuffer | undefined {
  return reference && bundle.assets[reference] ? bundle.assets[reference].data.slice(0) : undefined;
}

function readAudioProfile(value: unknown): ThemeSurfaceAudio {
  const fallback: ThemeSurfaceAudio = {
    impactSet: 'resin',
    pitchRange: [0.94, 1.06],
    resonance: 0.35,
    weight: 1,
    brightness: 0.5,
  };
  if (!isRecord(value)) return fallback;
  const record = value;
  const impactSets = new Set<ThemeSurfaceAudio['impactSet']>([
    'stone',
    'metal',
    'crystal',
    'resin',
    'wood',
    'bone',
  ]);
  const pitch =
    Array.isArray(record.pitchRange) && record.pitchRange.length === 2
      ? record.pitchRange.map(Number)
      : fallback.pitchRange;
  return {
    impactSet: isImpactSet(record.impactSet, impactSets) ? record.impactSet : fallback.impactSet,
    pitchRange: [
      readFinite(pitch[0], fallback.pitchRange[0]),
      readFinite(pitch[1], fallback.pitchRange[1]),
    ],
    resonance: readFinite(record.resonance, fallback.resonance),
    weight: readFinite(record.weight, fallback.weight),
    brightness: readFinite(record.brightness, fallback.brightness),
  };
}

function parseColor(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.max(0, Math.min(0xffffff, Math.round(value)));
  if (typeof value === 'string') {
    try {
      return new THREE.Color(value).getHex();
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamps an untrusted number into a range, falling back when absent or invalid. */
function readClamped(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = readNumber(value, fallback);
  return Math.min(maximum, Math.max(minimum, parsed));
}

/**
 * Reads an optional `metadata.geometry` block so runtime themes can chamfer their
 * dice. Bounds are enforced here because manifests are untrusted input.
 */
function readGeometryProfile(value: unknown, fallback: ThemeGeometryProfile): ThemeGeometryProfile {
  if (!isRecord(value)) return { ...fallback };
  return {
    bevel: readClamped(value.bevel, fallback.bevel, 0, 0.3),
    bevelDepth: readClamped(value.bevelDepth, fallback.bevelDepth, 0, 1.5),
    cornerRadius: readClamped(value.cornerRadius, fallback.cornerRadius, 0.02, 0.42),
    faceInset: readClamped(value.faceInset, fallback.faceInset, 0.6, 1),
  };
}

/** Narrows an unknown value to an indexable object without asserting a shape. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Type predicate narrowing an untrusted value to a known impact-set identifier. */
function isImpactSet(
  value: unknown,
  allowed: ReadonlySet<ThemeSurfaceAudio['impactSet']>,
): value is ThemeSurfaceAudio['impactSet'] {
  return typeof value === 'string' && (allowed as ReadonlySet<string>).has(value);
}

function readFinite(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
