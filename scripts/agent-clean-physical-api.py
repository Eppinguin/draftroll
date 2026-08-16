from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    Path(path).write_text(content)


def replace_once(path: str, before: str, after: str, label: str) -> None:
    source = read(path)
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    write(path, source.replace(before, after, 1))


def replace_regex(path: str, pattern: str, after: str, label: str) -> None:
    source = read(path)
    matches = list(re.finditer(pattern, source, re.S))
    if len(matches) != 1:
        raise RuntimeError(f"{label}: expected one match, found {len(matches)}")
    write(path, re.sub(pattern, after, source, count=1, flags=re.S))


def replace_all(path: str, before: str, after: str) -> None:
    source = read(path)
    if before not in source:
        raise RuntimeError(f"global replacement missing in {path}: {before}")
    write(path, source.replace(before, after))


# ---------------------------------------------------------------------------
# Theme schema: one clean physical namespace, no pre-release compatibility API.
# ---------------------------------------------------------------------------
replace_once(
    'packages/themes/src/index.ts',
    """export interface ThemeLabelDefinition {
  color?: string;
  glowColor?: string;
  fontFamily?: string;
  font?: ThemeAssetReference;
  /** A 5x4 atlas containing physical outcome slots 1 through 20; cells may be numbers or icons. */
  atlas?: ThemeAssetReference;
  /** Optional die-specific outcome-slot atlas override, including arbitrary dN identifiers. */
  atlases?: Partial<Record<ThemeDieType, ThemeAssetReference>>;
}""",
    """export interface ThemeLabelStyleDefinition {
  /** Main face-content color. */
  color?: string;
  /** Optional glow around generated labels. */
  glowColor?: string;
  /** CSS font family used for generated text and icon glyphs. */
  fontFamily?: string;
  /** Outline color used for generated text and icon glyphs. */
  outlineColor?: string;
  /** Outline width relative to glyph size. Defaults to 0.08. */
  outlineWidth?: number;
  /** Physical label-plane scale multiplier. Defaults to 1. */
  scale?: number;
}

/**
 * Default physical label atlas and typography supplied by a theme.
 *
 * @public
 */
export interface ThemeLabelDefinition extends ThemeLabelStyleDefinition {
  font?: ThemeAssetReference;
  /** A 5x4 atlas containing physical outcome slots 1 through 20. */
  atlas?: ThemeAssetReference;
  /** Optional die-specific atlas override. */
  atlases?: Partial<Record<ThemeDieType, ThemeAssetReference>>;
}

/**
 * Label override for one physical die identifier.
 *
 * @public
 */
export interface ThemeDieLabelDefinition extends ThemeLabelStyleDefinition {
  atlas?: ThemeAssetReference;
}""",
    'theme label style contract',
)

replace_once(
    'packages/themes/src/index.ts',
    """export interface ThemePhysicsDefinition {
  sizeScale?: number;
  massScale?: number;
  inertiaScale?: number;
}""",
    """export interface ThemePhysicsDefinition {
  sizeScale?: number;
  massScale?: number;
  inertiaScale?: number;
}

/**
 * Semantic-agnostic content assigned to one physical outcome slot.
 *
 * @public
 */
export type ThemePhysicalFaceContent =
  | { kind: 'number'; value: number; label?: string }
  | { kind: 'text'; text: string }
  | { kind: 'icon'; icon: string; label?: string }
  | { kind: 'texture'; asset: ThemeAssetReference; label?: string };

/**
 * One-to-one presentation for a physical die's outcome slots.
 *
 * @public
 */
export interface ThemePhysicalPresentationDefinition {
  contents: ThemePhysicalFaceContent[];
}

/**
 * Independent overrides for one canonical, generated, or custom physical die.
 *
 * @public
 */
export interface ThemePhysicalDieOverride {
  material?: ThemeMaterialDefinition;
  labels?: ThemeDieLabelDefinition;
  mesh?: ThemeMeshDefinition;
  physics?: ThemePhysicsDefinition;
  presentation?: ThemePhysicalPresentationDefinition;
}

/**
 * Physical-die theme model.
 *
 * @remarks
 * Geometry, material, label styling, physics, and semantic face content are independent. Themes
 * may override any subset globally or for any physical die identifier without changing game rules.
 *
 * @public
 */
export interface ThemePhysicalDefinition {
  material?: ThemeMaterialDefinition;
  labels?: ThemeLabelDefinition;
  physics?: ThemePhysicsDefinition;
  dice?: Partial<Record<ThemeDieType, ThemePhysicalDieOverride>>;
}""",
    'physical theme contract',
)

replace_once(
    'packages/themes/src/index.ts',
    """  meshes?: boolean;
  physics?: boolean;""",
    """  meshes?: boolean;
  physics?: boolean;
  faceContent?: boolean;""",
    'theme face-content capability',
)

replace_once(
    'packages/themes/src/index.ts',
    """  capabilities?: DiceThemeCapabilities;
  material?: ThemeMaterialDefinition;
  materials?: Partial<Record<ThemeDieType, ThemeMaterialDefinition>>;
  labels?: ThemeLabelDefinition;
  meshes?: Partial<Record<ThemeDieType, ThemeMeshDefinition>>;
  audio?: ThemeAudioDefinition;
  effects?: Partial<Record<ThemeEffectOutcome, ThemeEffectPreset>>;
  physics?: ThemePhysicsDefinition & {
    dice?: Partial<Record<ThemeDieType, ThemePhysicsDefinition>>;
  };""",
    """  capabilities?: DiceThemeCapabilities;
  physical?: ThemePhysicalDefinition;
  audio?: ThemeAudioDefinition;
  effects?: Partial<Record<ThemeEffectOutcome, ThemeEffectPreset>>;""",
    'clean dice theme fields',
)

replace_regex(
    'packages/themes/src/index.ts',
    r"  validateMaterial\(theme\.material, 'material'\);.*?  return theme;",
    """  validatePhysicalTheme(theme.physical);
  validateAsset(theme.audio?.impact, 'audio.impact');
  validateAsset(theme.audio?.roll, 'audio.roll');
  return theme;""",
    'clean theme validation dispatch',
)

replace_regex(
    'packages/themes/src/index.ts',
    r"export function listThemeAssetReferences\(theme: DiceTheme\): ThemeAssetReference\[] \{.*?\n\}",
    """export function listThemeAssetReferences(theme: DiceTheme): ThemeAssetReference[] {
  const references: ThemeAssetReference[] = [];
  const add = (reference?: ThemeAssetReference) => {
    if (reference && !references.some((candidate) => candidate.src === reference.src))
      references.push(reference);
  };
  add(theme.physical?.material?.surfaceTexture);
  add(theme.physical?.material?.normalTexture);
  add(theme.physical?.material?.roughnessTexture);
  add(theme.physical?.labels?.font);
  add(theme.physical?.labels?.atlas);
  for (const atlas of Object.values(theme.physical?.labels?.atlases ?? {})) add(atlas);
  for (const override of Object.values(theme.physical?.dice ?? {})) {
    if (!override) continue;
    add(override.material?.surfaceTexture);
    add(override.material?.normalTexture);
    add(override.material?.roughnessTexture);
    add(override.labels?.atlas);
    add(override.mesh?.asset);
    for (const content of override.presentation?.contents ?? []) {
      if (content.kind === 'texture') add(content.asset);
    }
  }
  add(theme.audio?.impact);
  add(theme.audio?.roll);
  return references;
}""",
    'clean physical theme asset enumeration',
)

replace_once(
    'packages/themes/src/index.ts',
    """  if (references.length > 128)
    throw new InvalidThemeError('A theme may reference at most 128 assets');""",
    """  if (references.length > 512)
    throw new InvalidThemeError('A theme may reference at most 512 assets');""",
    'theme asset limit',
)

replace_regex(
    'packages/themes/src/index.ts',
    r"function validateLabels\(labels: ThemeLabelDefinition \| undefined\): void \{.*?\n\}\n\nfunction validatePhysics",
    """function validateLabelStyle(
  labels: ThemeLabelStyleDefinition | undefined,
  path: string,
): void {
  if (!labels) return;
  if (labels.color !== undefined) readText(labels.color, `${path}.color`, 128);
  if (labels.glowColor !== undefined) readText(labels.glowColor, `${path}.glowColor`, 128);
  if (labels.fontFamily !== undefined) readText(labels.fontFamily, `${path}.fontFamily`, 128);
  if (labels.outlineColor !== undefined)
    readText(labels.outlineColor, `${path}.outlineColor`, 128);
  validateRange(labels.outlineWidth, 0, 0.25, `${path}.outlineWidth`);
  validateRange(labels.scale, 0.25, 2, `${path}.scale`);
}

function validateLabels(labels: ThemeLabelDefinition | undefined, path: string): void {
  if (!labels) return;
  validateLabelStyle(labels, path);
  validateAsset(labels.font, `${path}.font`);
  validateAsset(labels.atlas, `${path}.atlas`);
  for (const [die, atlas] of Object.entries(labels.atlases ?? {}))
    validateAsset(atlas, `${path}.atlases.${die}`);
}

function validateDieLabels(labels: ThemeDieLabelDefinition | undefined, path: string): void {
  if (!labels) return;
  validateLabelStyle(labels, path);
  validateAsset(labels.atlas, `${path}.atlas`);
}

function validatePhysicalPresentation(
  presentation: ThemePhysicalPresentationDefinition | undefined,
  path: string,
): void {
  if (!presentation) return;
  if (
    !Array.isArray(presentation.contents) ||
    presentation.contents.length < 1 ||
    presentation.contents.length > 10_000
  ) {
    throw new InvalidThemeError(
      'Physical presentation contents must contain 1 to 10000 entries',
      `${path}.contents`,
    );
  }
  presentation.contents.forEach((content, index) => {
    const contentPath = `${path}.contents.${index}`;
    if (!isRecord(content))
      throw new InvalidThemeError('Physical face content must be an object', contentPath);
    if (content.kind === 'number') {
      if (typeof content.value !== 'number' || !Number.isFinite(content.value))
        throw new InvalidThemeError(
          'Physical number content requires a finite value',
          `${contentPath}.value`,
        );
    } else if (content.kind === 'text') {
      readText(content.text, `${contentPath}.text`, 128);
    } else if (content.kind === 'icon') {
      readText(content.icon, `${contentPath}.icon`, 128);
    } else if (content.kind === 'texture') {
      validateAsset(content.asset, `${contentPath}.asset`);
    } else {
      throw new InvalidThemeError('Unsupported physical face content kind', `${contentPath}.kind`);
    }
    if ('label' in content && content.label !== undefined)
      readText(content.label, `${contentPath}.label`, 128);
  });
}

function validatePhysicalTheme(physical: ThemePhysicalDefinition | undefined): void {
  if (!physical) return;
  validateMaterial(physical.material, 'physical.material');
  validateLabels(physical.labels, 'physical.labels');
  validatePhysics(physical.physics, 'physical.physics');
  for (const [die, override] of Object.entries(physical.dice ?? {})) {
    if (!override) continue;
    readIdentifier(die, `physical.dice.${die}`);
    const path = `physical.dice.${die}`;
    validateMaterial(override.material, `${path}.material`);
    validateDieLabels(override.labels, `${path}.labels`);
    if (override.mesh) {
      validateAsset(override.mesh.asset, `${path}.mesh.asset`);
      validateRange(override.mesh.scale, 0.05, 20, `${path}.mesh.scale`);
      validateRange(override.mesh.maxVertices, 3, 250_000, `${path}.mesh.maxVertices`);
    }
    validatePhysics(override.physics, `${path}.physics`);
    validatePhysicalPresentation(override.presentation, `${path}.presentation`);
  }
}

function validatePhysics""",
    'physical theme validators',
)

# ---------------------------------------------------------------------------
# Runtime theme resolution: physical namespace is the only source of die style.
# ---------------------------------------------------------------------------
replace_once(
    'src/runtime-themes.ts',
    """  decodeDiceTheme,
  type DiceTheme,
  type RuntimeThemeBundle,
  type ThemeMaterialDefinition,
  type ThemePhysicsDefinition,
} from '../packages/themes/src/index';""",
    """  decodeDiceTheme,
  listThemeAssetReferences,
  type DiceTheme,
  type RuntimeThemeBundle,
  type ThemeLabelStyleDefinition,
  type ThemeMaterialDefinition,
  type ThemePhysicsDefinition,
} from '../packages/themes/src/index';
import type {
  PhysicalDieFaceContent,
  PhysicalDiePresentation,
} from '../packages/renderer/src/physical';""",
    'runtime theme imports',
)

replace_regex(
    'src/runtime-themes.ts',
    r"export function getRuntimeThemeMaterial\(.*?\n\}\n\nexport function getRuntimeThemeEffects",
    """export function getRuntimeThemeMaterial(
  themeId: string,
  kind: string,
): ThemeMaterialDefinition | undefined {
  const manifest = runtimeThemes.get(themeId)?.manifest;
  if (!manifest?.physical) return undefined;
  return mergeMaterial(manifest.physical.material, manifest.physical.dice?.[kind]?.material);
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
    const reference =
      manifest.physical?.dice?.[kind]?.labels?.atlas?.src ??
      manifest.physical?.labels?.atlases?.[kind]?.src ??
      manifest.physical?.labels?.atlas?.src;
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

export function getRuntimeThemeLabelStyle(
  themeId: string,
  kind: string,
  fallbackKind?: string,
): ThemeLabelStyleDefinition | undefined {
  const manifest = runtimeThemes.get(themeId)?.manifest;
  if (!manifest?.physical) return undefined;
  let style = mergeLabelStyle(undefined, manifest.physical.labels);
  if (fallbackKind && fallbackKind !== kind)
    style = mergeLabelStyle(style, manifest.physical.dice?.[fallbackKind]?.labels);
  return mergeLabelStyle(style, manifest.physical.dice?.[kind]?.labels);
}

export function getRuntimeThemeFont(
  themeId: string,
  kind?: string,
  fallbackKind?: string,
): string | undefined {
  const resources = runtimeThemes.get(themeId);
  if (!resources) return undefined;
  if (kind) {
    const style = getRuntimeThemeLabelStyle(themeId, kind, fallbackKind);
    if (style?.fontFamily) return style.fontFamily;
  }
  return resources.fontFamily;
}

export function getRuntimeThemePresentation(
  themeId: string,
  kind: string,
  fallbackKind?: string,
): PhysicalDiePresentation | undefined {
  const manifest = runtimeThemes.get(themeId)?.manifest;
  const source =
    manifest?.physical?.dice?.[kind]?.presentation ??
    (fallbackKind ? manifest?.physical?.dice?.[fallbackKind]?.presentation : undefined);
  if (!source) return undefined;
  const contents: PhysicalDieFaceContent[] = source.contents.map((content) => {
    if (content.kind === 'number') return { ...content };
    if (content.kind === 'text') return { ...content };
    if (content.kind === 'icon') return { ...content };
    return { kind: 'texture', asset: content.asset.src, label: content.label };
  });
  return { contents };
}

export function getRuntimeThemeAssetTexture(
  themeId: string,
  reference: string,
): THREE.Texture | undefined {
  return runtimeThemes.get(themeId)?.textures.get(reference);
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
  if (!manifest?.physical) return undefined;
  return mergePhysics(manifest.physical.physics, manifest.physical.dice?.[kind]?.physics);
}

export function getRuntimeThemeEffects""",
    'runtime physical theme getters',
)

replace_once(
    'src/runtime-themes.ts',
    """  const material = theme.material ?? {};
  const labels = theme.labels ?? {};""",
    """  const material = theme.physical?.material ?? {};
  const labels = theme.physical?.labels ?? {};""",
    'runtime palette physical defaults',
)

replace_once(
    'src/runtime-themes.ts',
    """      customModel: Object.keys(theme.meshes ?? {}).length > 0,""",
    """      customModel: Object.values(theme.physical?.dice ?? {}).some((entry) => Boolean(entry?.mesh)),""",
    'runtime physical custom model capability',
)

replace_regex(
    'src/runtime-themes.ts',
    r"async function loadThemeTextures\(.*?\n\}\n\nasync function loadThemeFont",
    """async function loadThemeTextures(
  bundle: RuntimeThemeBundle,
  resources: RuntimeThemeResources,
): Promise<void> {
  for (const reference of listThemeAssetReferences(resources.manifest)) {
    const asset = bundle.assets[reference.src];
    if (!asset || !asset.mimeType.startsWith('image/')) continue;
    try {
      const texture = await loadTexture(asset.data, asset.mimeType);
      resources.textures.set(reference.src, texture);
    } catch {
      // Invalid optional resources fall back to generated surfaces and labels.
    }
  }
}

async function loadThemeFont""",
    'runtime physical texture loading',
)

replace_once(
    'src/runtime-themes.ts',
    """  const font = resources.manifest.labels?.font;
  const family = resources.manifest.labels?.fontFamily;""",
    """  const font = resources.manifest.physical?.labels?.font;
  const family = resources.manifest.physical?.labels?.fontFamily;""",
    'runtime physical font loading',
)

replace_regex(
    'src/runtime-themes.ts',
    r"async function loadThemeMeshes\(.*?\n\}\n\nasync function loadTexture",
    """async function loadThemeMeshes(
  bundle: RuntimeThemeBundle,
  resources: RuntimeThemeResources,
): Promise<void> {
  for (const [kind, override] of Object.entries(resources.manifest.physical?.dice ?? {})) {
    const definition = override?.mesh;
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
      // Canonical/generated geometry remains the safe fallback.
    }
  }
}

async function loadTexture""",
    'runtime physical mesh loading',
)

replace_once(
    'src/runtime-themes.ts',
    """function mergeMaterial(
  base?: ThemeMaterialDefinition,
  override?: ThemeMaterialDefinition,
): ThemeMaterialDefinition | undefined {
  if (!base && !override) return undefined;
  return { ...base, ...override };
}

function cloneAsset""",
    """function mergeMaterial(
  base?: ThemeMaterialDefinition,
  override?: ThemeMaterialDefinition,
): ThemeMaterialDefinition | undefined {
  if (!base && !override) return undefined;
  return { ...base, ...override };
}

function mergeLabelStyle(
  base?: ThemeLabelStyleDefinition,
  override?: ThemeLabelStyleDefinition,
): ThemeLabelStyleDefinition | undefined {
  if (!base && !override) return undefined;
  return {
    color: override?.color ?? base?.color,
    glowColor: override?.glowColor ?? base?.glowColor,
    fontFamily: override?.fontFamily ?? base?.fontFamily,
    outlineColor: override?.outlineColor ?? base?.outlineColor,
    outlineWidth: override?.outlineWidth ?? base?.outlineWidth,
    scale: override?.scale ?? base?.scale,
  };
}

function mergePhysics(
  base?: ThemePhysicsDefinition,
  override?: ThemePhysicsDefinition,
): ThemePhysicsDefinition | undefined {
  if (!base && !override) return undefined;
  return {
    sizeScale: override?.sizeScale ?? base?.sizeScale,
    massScale: override?.massScale ?? base?.massScale,
    inertiaScale: override?.inertiaScale ?? base?.inertiaScale,
  };
}

function cloneAsset""",
    'runtime physical merge helpers',
)

# ---------------------------------------------------------------------------
# Physical mesh + arbitrary physical visual: consume DraftrollPhysicalVisual directly.
# ---------------------------------------------------------------------------
replace_once(
    'src/physical-die-mesh.ts',
    "import type { DraftrollFallbackVisual } from '../packages/renderer/src/index';",
    "import type { DraftrollPhysicalVisual } from '../packages/renderer/src/index';",
    'physical mesh public spec type',
)
replace_all('src/physical-die-mesh.ts', 'DraftrollFallbackVisual', 'DraftrollPhysicalVisual')
replace_once(
    'src/physical-die-mesh.ts',
    """  getRuntimeThemeFont,
  getRuntimeThemeMaterial,
  getRuntimeThemeMesh,
  getRuntimeThemeTexture,
} from './runtime-themes';""",
    """  getRuntimeThemeAssetTexture,
  getRuntimeThemeFont,
  getRuntimeThemeLabelStyle,
  getRuntimeThemeMaterial,
  getRuntimeThemeMesh,
  getRuntimeThemeTexture,
} from './runtime-themes';
import type { ThemeLabelStyleDefinition } from '../packages/themes/src/index';""",
    'physical mesh theme style imports',
)
replace_regex(
    'src/physical-die-mesh.ts',
    r"function presentationTexture\(.*?\n\}\n\nfunction scaleThemeMesh",
    """function presentationTexture(
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

function scaleThemeMesh""",
    'physical mesh face content texture',
)
replace_once(
    'src/physical-die-mesh.ts',
    """  const runtimeAtlas =
    getRuntimeThemeTexture(spec.theme, spec.type, 'label') ??
    getRuntimeThemeTexture(spec.theme, `d${definition.sides}`, 'label');
  const labelMaps = definition.outcomes.map((outcome, index): THREE.Texture | null => {""",
    """  const fallbackKind = `d${definition.sides}`;
  const runtimeAtlas =
    getRuntimeThemeTexture(spec.theme, spec.type, 'label') ??
    getRuntimeThemeTexture(spec.theme, fallbackKind, 'label');
  const labelStyle = getRuntimeThemeLabelStyle(spec.theme, spec.type, fallbackKind);
  const labelScale = labelStyle?.scale ?? 1;
  const fontFamily = getRuntimeThemeFont(spec.theme, spec.type, fallbackKind);
  const labelMaps = definition.outcomes.map((outcome, index): THREE.Texture | null => {""",
    'physical mesh label theme resolution',
)
replace_once(
    'src/physical-die-mesh.ts',
    '    const texture = presentationTexture(spec, content);',
    '    const texture = presentationTexture(spec, content, labelStyle, fontFamily);',
    'physical mesh presentation texture call',
)
replace_once(
    'src/physical-die-mesh.ts',
    '      const labelGeometry = new THREE.PlaneGeometry(anchor.scale, anchor.scale);',
    """      const labelGeometry = new THREE.PlaneGeometry(
        anchor.scale * labelScale,
        anchor.scale * labelScale,
      );""",
    'physical primary label scale',
)
replace_once(
    'src/physical-die-mesh.ts',
    '    const labelGeometry = new THREE.PlaneGeometry(anchor.scale, anchor.scale);',
    """    const labelGeometry = new THREE.PlaneGeometry(
      anchor.scale * labelScale,
      anchor.scale * labelScale,
    );""",
    'physical secondary label scale',
)

# Rewrite physical-die-visuals header/presentation and remove the fallback adapter vocabulary.
replace_once(
    'src/physical-die-visuals.ts',
    "import type { DraftrollFallbackVisual } from '../packages/renderer/src/index';",
    "import type { DraftrollPhysicalVisual } from '../packages/renderer/src/index';",
    'physical visual public spec type',
)
replace_once(
    'src/physical-die-visuals.ts',
    """import { createPhysicalDieMesh, type PhysicalDieMesh } from './physical-die-mesh';
import type { PhysicalLaunchState } from './physical-launch';""",
    """import { createPhysicalDieMesh, type PhysicalDieMesh } from './physical-die-mesh';
import type { PhysicalLaunchState } from './physical-launch';
import { getRuntimeThemePresentation } from './runtime-themes';""",
    'physical visual theme presentation import',
)
replace_regex(
    'src/physical-die-visuals.ts',
    r"const MAXIMUM_EXACT_GENERATED_SIDES = 256;.*?function sample\(",
    """const activePhysicalDice = new Set<PhysicalDieVisualInstance>();
const pendingPhysicalDice = new Set<PhysicalDieVisualInstance>();
let plannedPhysicalDice: PhysicalDieVisualInstance[] = [];
let lastAdditionalPhysicalReplay: AdditionalPhysicalReplay | null = null;

function readPhysicalPresentation(
  spec: DraftrollPhysicalVisual,
  definition: PhysicalDieDefinition,
): { presentation: PhysicalDiePresentation; explicit: boolean } {
  if (spec.presentation) {
    return {
      presentation: createPhysicalDiePresentation(definition, spec.presentation.contents),
      explicit: true,
    };
  }
  const themed = getRuntimeThemePresentation(spec.theme, spec.type, `d${definition.sides}`);
  if (themed && themed.contents.length === definition.outcomes.length) {
    return {
      presentation: createPhysicalDiePresentation(definition, themed.contents),
      explicit: true,
    };
  }
  return { presentation: createDefaultPhysicalDiePresentation(definition), explicit: false };
}

function sample(""",
    'physical visual remove spinner adapter',
)
replace_once(
    'src/physical-die-visuals.ts',
    '  readonly spec: DraftrollFallbackVisual;',
    '  readonly spec: DraftrollPhysicalVisual;',
    'physical visual spec field',
)
replace_once(
    'src/physical-die-visuals.ts',
    """  constructor(spec: DraftrollFallbackVisual) {
    this.spec = spec;
    const sides = numericPhysicalSides(spec);
    if (sides === null) throw new Error(`Physical numeric die requires sides: ${spec.type}`);
    this.sides = sides;
    this.definition = createGeneratedPhysicalDieDefinition(sides);
    const resolvedPresentation = readPhysicalPresentation(spec, this.definition);
    this.requestedOutcome = requestedOutcomeIndex(spec, sides);""",
    """  constructor(spec: DraftrollPhysicalVisual) {
    this.spec = spec;
    if (!Number.isSafeInteger(spec.sides) || spec.sides < 1 || spec.sides > 256) {
      throw new Error(`Physical die requires 1 to 256 exact outcome slots: ${spec.type}`);
    }
    this.sides = spec.sides;
    this.definition = createGeneratedPhysicalDieDefinition(spec.sides);
    const resolvedPresentation = readPhysicalPresentation(spec, this.definition);
    this.requestedOutcome = spec.outcomeIndex;""",
    'physical visual constructor',
)
replace_all('src/physical-die-visuals.ts', 'PhysicalFallbackPlanEntry', 'AdditionalPhysicalPlanEntry')
replace_all('src/physical-die-visuals.ts', 'PhysicalFallbackReplay', 'AdditionalPhysicalReplay')
replace_all('src/physical-die-visuals.ts', 'lastPhysicalFallbackReplay', 'lastAdditionalPhysicalReplay')
replace_all('src/physical-die-visuals.ts', 'hasConfiguredPhysicalFallbackDice', 'hasConfiguredAdditionalPhysicalDice')
replace_all('src/physical-die-visuals.ts', 'hasPendingPhysicalFallbackDice', 'hasPendingAdditionalPhysicalDice')
replace_all('src/physical-die-visuals.ts', 'getPhysicalFallbackPlanEntries', 'getAdditionalPhysicalPlanEntries')
replace_all('src/physical-die-visuals.ts', 'commitPhysicalFallbackPlan', 'commitAdditionalPhysicalPlan')
replace_all('src/physical-die-visuals.ts', 'capturePhysicalFallbackReplay', 'captureAdditionalPhysicalReplay')
replace_all('src/physical-die-visuals.ts', 'restorePhysicalFallbackReplay', 'restoreAdditionalPhysicalReplay')
replace_all('src/physical-die-visuals.ts', 'Physical fallback', 'Additional physical')
replace_all('src/physical-die-visuals.ts', 'physical fallback', 'additional physical')

write(
    'src/fallback-visuals.ts',
    """export { FallbackVisualInstance } from './fallback-visuals-base';
export type { FallbackVisualBounds } from './fallback-visuals-base';
""",
)

# ---------------------------------------------------------------------------
# Renderer API: physical[] is the only die path. Fallbacks are only non-die visuals.
# ---------------------------------------------------------------------------
replace_once(
    'packages/renderer/src/index.ts',
    "export type DraftrollFallbackKind = 'coin' | 'percentile' | 'fate' | 'spinner' | 'token' | 'card';",
    "export type DraftrollFallbackKind = 'token' | 'card';",
    'clean fallback kinds',
)
replace_once(
    'packages/renderer/src/index.ts',
    """  /** Prefer a concise non-3D/final-state presentation for reduced-motion users. */
  reducedMotion?: boolean;
  /** Force all components through the synchronized fallback layer. */
  forceFallback?: boolean;
  /** Shared physical tuning selected by room policy or the host. */""",
    """  /** Prefer a concise final-state presentation for reduced-motion users. */
  reducedMotion?: boolean;
  /** Shared physical tuning selected by room policy or the host. */""",
    'remove force-fallback die path',
)
replace_regex(
    'packages/renderer/src/index.ts',
    r"  roll\(\n    request\?:\n      \| \{.*?\n      \| number\[],\n  \): Promise<RendererCompletion>;",
    """  roll(request?: {
    physical?: DraftrollPhysicalVisual[];
    fallbacks?: DraftrollFallbackVisual[];
    visualOrder?: DraftrollVisualOrderEntry[];
    context?: Record<string, unknown>;
    seed?: string | number;
    startAtMs?: number;
    seekToMs?: number;
    animationDurationMs?: number;
    settleImmediately?: boolean;
    lateMode?: RendererLateEventMode;
    settleAfterProgress?: number;
    tableMode?: 'replace' | 'add';
    signal?: AbortSignal;
    reducedMotion?: boolean;
    physicsPreset?: 'standard' | 'compact' | 'heavy' | 'low-gravity';
  }): Promise<RendererCompletion>;""",
    'clean bridge roll contract',
)
replace_once(
    'packages/renderer/src/index.ts',
    """    const physical: DraftrollPhysicalVisual[] = [];
    // Deprecated canonical arrays remain populated for older custom bridges. Built-in Draftroll
    // treats physical[] as authoritative and ignores these when the new field is present.
    const numericResults: number[] = [];
    const physicalKinds: DraftrollDieKind[] = [];
    const themes: string[] = [];
    const outcomes: DraftrollEffectOutcome[] = [];
    const physics: DicePhysicsProperties[] = [];
    const fallbacks: DraftrollFallbackVisual[] = [];""",
    """    const physical: DraftrollPhysicalVisual[] = [];
    const fallbacks: DraftrollFallbackVisual[] = [];""",
    'remove bridge parallel arrays',
)
replace_once(
    'packages/renderer/src/index.ts',
    """      entry.physical.forEach((visual) => {
        physical.push(clonePreparedPhysicalVisual(visual));
        if (visual.canonicalKind) {
          numericResults.push(visual.outcomeIndex + 1);
          physicalKinds.push(visual.canonicalKind);
          themes.push(visual.theme);
          outcomes.push(visual.outcome);
          physics.push({ ...visual.physics });
        }
      });""",
    """      entry.physical.forEach((visual) => {
        physical.push(clonePreparedPhysicalVisual(visual));
      });""",
    'renderer batch physical-only collection',
)
replace_once(
    'packages/renderer/src/index.ts',
    """      physical,
      results: numericResults,
      outcomes,
      themes,
      kinds: physicalKinds,
      physics,
      physicsPreset: entries[0].options.physicsPreset,""",
    """      physical,
      physicsPreset: entries[0].options.physicsPreset,""",
    'renderer bridge physical-only call',
)
replace_once(
    'packages/renderer/src/index.ts',
    """function normalizeKind(type: string, sides?: number): DraftrollDieKind | null {
  const normalized = type.toLowerCase();
  if (normalized === 'd2') return 'coin';""",
    """function normalizeKind(type: string, sides?: number): DraftrollDieKind | null {
  const normalized = type.toLowerCase();
  if (normalized === 'd2' || normalized === 'coin') return 'coin';""",
    'normalize coin physical kind',
)
replace_regex(
    'packages/renderer/src/index.ts',
    r"function resolvePhysicalSlot\(.*?\n\}\n\nfunction physicalFaceContent",
    """function resolvePhysicalSlot(
  die: NormalizedDieResult,
  definition: CustomDiceDefinition | undefined,
): ResolvedPhysicalSlot | null {
  const renderAs = definition?.renderAs?.toLowerCase();
  if (renderAs === 'card' || renderAs === 'token') return null;

  if (!definition) {
    const normalized = die.type.toLowerCase();
    if (normalized === 'df' || normalized === 'fate') {
      const numeric = die.numericValue ?? Number(die.result);
      const outcomeIndex = numeric < 0 ? 0 : numeric > 0 ? 4 : 2;
      return Number.isFinite(numeric) ? { kind: 'd6', sides: 6, outcomeIndex } : null;
    }
    if (normalized === 'd10x') {
      const value = typeof die.result === 'number' ? die.result : Number(die.result);
      return Number.isInteger(value) && value >= 1 && value <= 10
        ? { kind: 'd10', sides: 10, outcomeIndex: value - 1 }
        : null;
    }
  }

  const sourceType = definition?.renderAs ?? (definition ? `d${definition.faces.length}` : die.type);
  const kind = normalizeKind(sourceType, definition ? undefined : die.sides);
  const sides = kind
    ? maximumPhysicalValue(kind)
    : numericPhysicalSides(sourceType, definition ? definition.faces.length : die.sides);
  if (sides === null || sides > MAXIMUM_EXACT_PHYSICAL_SIDES) return null;

  if (definition) {
    const faceIndex = resolveCustomFaceIndex(die, definition);
    return faceIndex === null ? null : { kind, sides, outcomeIndex: faceIndex % sides };
  }

  if (die.type.toLowerCase() === 'coin') {
    const label = String(die.result).toLowerCase();
    if (label === 'heads') return { kind: 'coin', sides: 2, outcomeIndex: 0 };
    if (label === 'tails') return { kind: 'coin', sides: 2, outcomeIndex: 1 };
  }
  const value = typeof die.result === 'number' ? die.result : Number(die.result);
  if (!Number.isInteger(value) || value < 1 || value > sides) return null;
  return { kind, sides, outcomeIndex: value - 1 };
}

function intrinsicPhysicalPresentation(
  die: NormalizedDieResult,
  sides: number,
): PhysicalDiePresentation | undefined {
  const normalized = die.type.toLowerCase();
  if (normalized === 'df' || normalized === 'fate') {
    return {
      contents: ['−', '−', '0', '0', '+', '+'].map((text) => ({ kind: 'text', text })),
    };
  }
  if (normalized === 'd10x') {
    return {
      contents: Array.from({ length: 10 }, (_entry, index) => ({
        kind: 'text' as const,
        text: index === 9 ? '00' : String((index + 1) * 10),
      })),
    };
  }
  if (normalized === 'coin' && sides === 2) {
    return { contents: [{ kind: 'text', text: 'Heads' }, { kind: 'text', text: 'Tails' }] };
  }
  return undefined;
}

function physicalFaceContent""",
    'all die-like inputs resolve physically',
)

replace_once(
    'packages/renderer/src/index.ts',
    """      if (options.forceFallback !== true && physicalSlot) {
        const index = physical.length;
        physical.push({""",
    """      if (physicalSlot) {
        const index = physical.length;
        physical.push({""",
    'always use physical die path',
)
replace_once(
    'packages/renderer/src/index.ts',
    """          presentation: definition
            ? createCustomPhysicalPresentation(definition, physicalSlot.sides)
            : undefined,""",
    """          presentation: definition
            ? createCustomPhysicalPresentation(definition, physicalSlot.sides)
            : intrinsicPhysicalPresentation(die, physicalSlot.sides),""",
    'intrinsic physical presentation',
)
replace_once(
    'packages/renderer/src/index.ts',
    """      const index = fallbacks.length;
      fallbacks.push(createFallbackVisual(die, theme, outcome, definition));""",
    """      const numericSides = numericPhysicalSides(die.type, die.sides);
      if (numericSides !== null) {
        throw new UnsupportedRollError(
          `Physical d${numericSides} exceeds the exact physical-die budget`,
          result,
        );
      }
      const index = fallbacks.length;
      fallbacks.push(createFallbackVisual(die, theme, outcome, definition));""",
    'reject unrepresentable numeric dice instead of fallback',
)
replace_regex(
    'packages/renderer/src/index.ts',
    r"function isDistinctFallbackType\(.*?\n\}\n\nfunction createFallbackVisual",
    "function createFallbackVisual",
    'remove distinct die fallback classification',
)
replace_regex(
    'packages/renderer/src/index.ts',
    r"function readOppositeCoinLabel\(.*?\n\}\n\nfunction normalizeFallbackKind",
    "function normalizeFallbackKind",
    'remove coin fallback helper',
)
replace_regex(
    'packages/renderer/src/index.ts',
    r"function normalizeFallbackKind\(.*?\n\}\n\nfunction readDisplayTitle",
    """function normalizeFallbackKind(
  renderAs: string | undefined,
  _normalizedType: string,
  _die: NormalizedDieResult,
): DraftrollFallbackKind {
  return renderAs === 'card' ? 'card' : 'token';
}

function readDisplayTitle""",
    'fallback kind is only card or token',
)
replace_regex(
    'packages/renderer/src/index.ts',
    r"function readDisplayTitle\(.*?\n\}\n\nfunction readDisplayLabel",
    """function readDisplayTitle(
  die: NormalizedDieResult,
  definition: CustomDiceDefinition | undefined,
  _kind: DraftrollFallbackKind,
): string {
  const metadataLabel = typeof die.metadata?.label === 'string' ? die.metadata.label : undefined;
  const definitionLabel =
    typeof definition?.metadata?.name === 'string' ? definition.metadata.name : undefined;
  return metadataLabel ?? definitionLabel ?? die.customDiceId ?? die.type;
}

function readDisplayLabel""",
    'clean fallback title',
)
replace_regex(
    'packages/renderer/src/index.ts',
    r"function readDisplayLabel\(.*?\n\}\n\nfunction defaultOutcomeForDie",
    """function readDisplayLabel(die: NormalizedDieResult, _kind: DraftrollFallbackKind): string {
  return die.faceLabel ?? String(die.result);
}

function defaultOutcomeForDie""",
    'clean fallback label',
)
replace_once(
    'packages/renderer/src/index.ts',
    """    oppositeLabel: kind === 'coin' ? readOppositeCoinLabel(die, definition) : undefined,
    theme,""",
    """    theme,""",
    'remove fallback opposite label use',
)

# SDK common randomizers: explicit physical shape or explicit non-die visual, never spinner/fate fallback.
replace_once('packages/sdk/src/builders.ts', "    'fate',", "    'd6',", 'fate common die physical shape')
replace_once('packages/sdk/src/builders.ts', "  return makeCommonDefinition(id, faces, 'percentile', options);", "  return makeCommonDefinition(id, faces, 'd100', options);", 'percentile common die physical shape')
replace_once('packages/sdk/src/builders.ts', "  return makeCommonDefinition(id, entries, 'spinner', options);", "  return makeCommonDefinition(id, entries, 'token', options);", 'table draw is non-die token')

# ---------------------------------------------------------------------------
# Browser engine: keep canonical optimization, but arbitrary dice are first-class physical visuals.
# ---------------------------------------------------------------------------
replace_once(
    'src/main.ts',
    """  markUnobstructedTableDice,
  minimumRestingAlignment,
  readRestingAlignment,
  releaseUnstableRestPose,
} from './resting-physics';""",
    """  markUnobstructedTableDice,
  minimumRestingAlignment,
  readRestingAlignment,
  releaseUnstableRestPose,
} from './resting-physics';""",
    'main stable resting import anchor',
)
replace_once(
    'src/main.ts',
    """import {
  assignPendingPhysicalLaunchStates,
  capturePhysicalFallbackReplay,
  commitPhysicalFallbackPlan,
  getPendingPhysicalLaunchParticipants,
  getPhysicalFallbackPlanEntries,
  hasConfiguredPhysicalFallbackDice,
  hasPendingPhysicalFallbackDice,
  restorePhysicalFallbackReplay,
  type PhysicalFallbackReplay,
} from './physical-die-visuals';""",
    """import {
  PhysicalDieVisualInstance,
  assignPendingPhysicalLaunchStates,
  captureAdditionalPhysicalReplay,
  commitAdditionalPhysicalPlan,
  getAdditionalPhysicalPlanEntries,
  getPendingPhysicalLaunchParticipants,
  hasConfiguredAdditionalPhysicalDice,
  hasPendingAdditionalPhysicalDice,
  restoreAdditionalPhysicalReplay,
  type AdditionalPhysicalReplay,
} from './physical-die-visuals';""",
    'main first-class additional physical imports',
)
replace_once(
    'src/main.ts',
    """  getRuntimeThemeAudio,
  getRuntimeThemeEffects,
  getRuntimeThemePhysics,""",
    """  getRuntimeThemeAudio,
  getRuntimeThemeEffects,
  getRuntimeThemePhysics,
  getRuntimeThemePresentation,""",
    'main runtime physical presentation import',
)

replace_regex(
    'src/main.ts',
    r"export interface DiceRollRequest \{.*?\n\}",
    """export interface DiceRollRequest {
  physical?: DraftrollPhysicalVisual[];
  fallbacks?: DraftrollFallbackVisual[];
  visualOrder?: DraftrollVisualOrderEntry[];
  context?: Record<string, unknown>;
  seed?: string | number;
  startAtMs?: number;
  seekToMs?: number;
  animationDurationMs?: number;
  settleImmediately?: boolean;
  lateMode?: RendererLateEventMode;
  settleAfterProgress?: number;
  tableMode?: 'replace' | 'add';
  signal?: AbortSignal;
  reducedMotion?: boolean;
  physicsPreset?: 'standard' | 'compact' | 'heavy' | 'low-gravity';
}""",
    'clean browser roll request',
)
replace_regex(
    'src/main.ts',
    r"export interface RollReplay \{.*?\n\}",
    """export interface RollReplay {
  formatVersion: 1;
  engineVersion: string;
  seed: string;
  createdAt: string;
  physical: DraftrollPhysicalVisual[];
  physicsPreset?: DicePhysicsPreset;
  bounds: { x: number; z: number };
  step: number;
  frameCount: number;
  duration: number;
  transforms: Float32Array;
  activationDelays?: Float32Array;
  settleTimes?: Float32Array;
  impacts: Float32Array;
  fallbacks?: DraftrollFallbackVisual[];
  additionalPhysicalReplay?: AdditionalPhysicalReplay;
  visualOrder?: DraftrollVisualOrderEntry[];
  context: Record<string, unknown>;
  effectTimeline: RollReplayEvent[];
  settleReason: string;
  physicsSteps: number;
}""",
    'clean physical-first replay contract',
)
replace_once(
    'src/main.ts',
    "      roll: (request?: DiceRollRequest | number[] | number) => Promise<DraftrollRollCompletion>;",
    "      roll: (request?: DiceRollRequest) => Promise<DraftrollRollCompletion>;",
    'clean browser roll signature',
)

replace_once(
    'src/main.ts',
    """let dice: DieInstance[] = [];
let fallbackVisuals: FallbackVisualInstance[] = [];""",
    """let dice: DieInstance[] = [];
let additionalPhysicalVisuals: PhysicalDieVisualInstance[] = [];
let fallbackVisuals: FallbackVisualInstance[] = [];""",
    'additional physical visual state',
)
replace_once(
    'src/main.ts',
    """let queuedApiResults: number[] | null = null;
let queuedOutcomes: EffectOutcome[] | null = null;""",
    """let queuedPhysical: DraftrollPhysicalVisual[] | null = null;
let queuedApiResults: number[] | null = null;
let queuedOutcomes: EffectOutcome[] | null = null;""",
    'queued physical state',
)
replace_once(
    'src/main.ts',
    """let activeFallbackSpecs: DraftrollFallbackVisual[] = [];
let activeVisualOrder: DraftrollVisualOrderEntry[] = [];""",
    """let activePhysicalSpecs: DraftrollPhysicalVisual[] = [];
let activeCanonicalPhysicalIndexes: number[] = [];
let activeAdditionalPhysicalIndexes: number[] = [];
let activeFallbackSpecs: DraftrollFallbackVisual[] = [];
let activeVisualOrder: DraftrollVisualOrderEntry[] = [];""",
    'active physical spec state',
)

replace_regex(
    'src/main.ts',
    r"function cloneReplay\(replay: RollReplay\): RollReplay \{.*?\n\}",
    """function clonePhysicalVisual(visual: DraftrollPhysicalVisual): DraftrollPhysicalVisual {
  return {
    ...visual,
    physics: visual.physics ? { ...visual.physics } : undefined,
    presentation: visual.presentation
      ? { contents: visual.presentation.contents.map((content) => ({ ...content })) }
      : undefined,
    metadata: visual.metadata ? { ...visual.metadata } : undefined,
  };
}

function cloneReplay(replay: RollReplay): RollReplay {
  return {
    ...replay,
    physical: replay.physical.map(clonePhysicalVisual),
    bounds: { ...replay.bounds },
    transforms: replay.transforms.slice(),
    activationDelays: replay.activationDelays?.slice(),
    settleTimes: replay.settleTimes?.slice(),
    impacts: replay.impacts.slice(),
    fallbacks: replay.fallbacks?.map((fallback) => ({
      ...fallback,
      metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
    })),
    additionalPhysicalReplay: replay.additionalPhysicalReplay
      ? {
          ids: replay.additionalPhysicalReplay.ids.slice(),
          step: replay.additionalPhysicalReplay.step,
          frameCount: replay.additionalPhysicalReplay.frameCount,
          transforms: replay.additionalPhysicalReplay.transforms.slice(),
          landings: replay.additionalPhysicalReplay.landings.slice(),
        }
      : undefined,
    visualOrder: replay.visualOrder?.map((entry) => ({ ...entry })),
    context: { ...replay.context },
    effectTimeline: replay.effectTimeline.map((event) => ({ ...event })),
  };
}""",
    'clean replay clone',
)

replace_once(
    'src/main.ts',
    """function clearFallbackVisuals(): void {
  for (const visual of fallbackVisuals) {
    scene.remove(visual.group);
    visual.dispose();
  }
  fallbackVisuals = [];
}

function clearDice(): void {""",
    """function clearAdditionalPhysicalVisuals(): void {
  for (const visual of additionalPhysicalVisuals) {
    scene.remove(visual.group);
    visual.dispose();
  }
  additionalPhysicalVisuals = [];
}

function clearFallbackVisuals(): void {
  for (const visual of fallbackVisuals) {
    scene.remove(visual.group);
    visual.dispose();
  }
  fallbackVisuals = [];
}

function clearDice(): void {""",
    'clear additional physical visuals',
)
replace_once(
    'src/main.ts',
    """  dice = [];
  clearFallbackVisuals();
}""",
    """  dice = [];
  clearAdditionalPhysicalVisuals();
  clearFallbackVisuals();
}""",
    'clear all physical visual implementations',
)
replace_once(
    'src/main.ts',
    """function spawnFallbackVisuals(specs: readonly DraftrollFallbackVisual[], seed: string): void {""",
    """function spawnAdditionalPhysicalVisuals(
  specs: readonly DraftrollPhysicalVisual[],
  seed: string,
): void {
  clearAdditionalPhysicalVisuals();
  if (specs.length === 0) return;
  const random = createSeededRandom(`${seed}:additional-physical`);
  const occupied: THREE.Vector2[] = [];
  additionalPhysicalVisuals = specs.map((spec, index) => {
    const visual = new PhysicalDieVisualInstance(spec);
    visual.configureTrajectory(index, specs.length, screenBounds, random, occupied);
    scene.add(visual.group);
    return visual;
  });
}

function spawnFallbackVisuals(specs: readonly DraftrollFallbackVisual[], seed: string): void {""",
    'spawn additional physical visuals',
)

# Rename additional-physical planner/replay functions in main.
for before, after in [
    ('capturePhysicalFallbackReplay', 'captureAdditionalPhysicalReplay'),
    ('commitPhysicalFallbackPlan', 'commitAdditionalPhysicalPlan'),
    ('getPhysicalFallbackPlanEntries', 'getAdditionalPhysicalPlanEntries'),
    ('hasConfiguredPhysicalFallbackDice', 'hasConfiguredAdditionalPhysicalDice'),
    ('hasPendingPhysicalFallbackDice', 'hasPendingAdditionalPhysicalDice'),
    ('restorePhysicalFallbackReplay', 'restoreAdditionalPhysicalReplay'),
    ('physicalFallbackReplay', 'additionalPhysicalReplay'),
]:
    replace_all('src/main.ts', before, after)

# Physical split helpers before prepareTargets.
replace_once(
    'src/main.ts',
    """function prepareTargets(): boolean {""",
    """function usesCanonicalPhysicalImplementation(visual: DraftrollPhysicalVisual): boolean {
  if (!visual.canonicalKind || !isDieKind(visual.canonicalKind) || visual.presentation) return false;
  return !getRuntimeThemePresentation(visual.theme, visual.type, visual.canonicalKind);
}

function splitPhysicalSpecs(physical: readonly DraftrollPhysicalVisual[]): {
  canonicalIndexes: number[];
  additionalIndexes: number[];
} {
  const canonicalIndexes: number[] = [];
  const additionalIndexes: number[] = [];
  physical.forEach((visual, index) => {
    (usesCanonicalPhysicalImplementation(visual) ? canonicalIndexes : additionalIndexes).push(index);
  });
  return { canonicalIndexes, additionalIndexes };
}

function currentAdditionalPhysicalSpecs(): DraftrollPhysicalVisual[] {
  return activeAdditionalPhysicalIndexes.flatMap((index) => {
    const visual = activePhysicalSpecs[index];
    return visual ? [visual] : [];
  });
}

function prepareTargets(): boolean {""",
    'physical implementation split helpers',
)

# Patch prepareTargets incrementally rather than replacing the whole function.
replace_once(
    'src/main.ts',
    """function prepareTargets(): boolean {
  const explicitResultCount = queuedApiResults !== null ? queuedApiResults.length : null;""",
    """function prepareTargets(): boolean {
  const requestedPhysical = queuedPhysical?.map(clonePhysicalVisual) ?? null;
  queuedPhysical = null;
  const explicitResultCount = queuedApiResults !== null ? queuedApiResults.length : null;""",
    'prepare requested physical',
)
replace_once(
    'src/main.ts',
    """  const fallbackOnlyRequest =
    queuedFallbacks !== null &&
    queuedFallbacks.length > 0 &&
    queuedApiResults === null &&
    queuedKinds === null;""",
    """  const fallbackOnlyRequest =
    queuedFallbacks !== null &&
    queuedFallbacks.length > 0 &&
    (requestedPhysical?.length ?? 0) === 0 &&
    queuedApiResults === null &&
    queuedKinds === null;""",
    'prepare fallback-only request',
)
replace_once(
    'src/main.ts',
    """  if (kinds.length + fallbacks.length < 1 || kinds.length + fallbacks.length > 30) {
    setStatus('A visual roll must contain between 1 and 30 components', false);""",
    """  const physicalVisualCount = requestedPhysical?.length ?? kinds.length;
  if (physicalVisualCount + fallbacks.length < 1 || physicalVisualCount + fallbacks.length > 30) {
    setStatus('A visual roll must contain between 1 and 30 components', false);""",
    'prepare total physical count',
)
replace_once(
    'src/main.ts',
    """  activeFallbackSpecs = fallbacks;
  activeVisualOrder = normalizeVisualOrder(queuedVisualOrder, quantity, fallbacks.length);""",
    """  if (requestedPhysical) {
    activePhysicalSpecs = requestedPhysical;
    const split = splitPhysicalSpecs(requestedPhysical);
    activeCanonicalPhysicalIndexes = split.canonicalIndexes;
    activeAdditionalPhysicalIndexes = split.additionalIndexes;
    if (activeCanonicalPhysicalIndexes.length !== quantity) {
      setStatus('Physical implementation split does not match canonical dice', false);
      return false;
    }
  } else {
    activePhysicalSpecs = kinds.map((kind, index) => {
      const maximum = maximumDieValue(kind);
      const target = requested[index] ?? 1;
      return {
        id: `physical_${index}`,
        type: kind === 'coin' ? 'd2' : kind,
        sides: maximum,
        outcomeIndex: THREE.MathUtils.clamp(Math.round(target), 1, maximum) - 1,
        result: target,
        numericValue: target,
        canonicalKind: kind,
        title: kind === 'coin' ? 'Coin' : kind,
        label: String(target),
        theme: activeThemes[index] ?? selectedTheme,
        outcome: 'neutral',
        metadata: { draftrollManualPhysical: true },
      };
    });
    activeCanonicalPhysicalIndexes = activePhysicalSpecs.map((_entry, index) => index);
    activeAdditionalPhysicalIndexes = [];
  }
  activeFallbackSpecs = fallbacks;
  activeVisualOrder = normalizeVisualOrder(
    queuedVisualOrder,
    activePhysicalSpecs.length,
    fallbacks.length,
  );""",
    'prepare first-class physical specs',
)
replace_once(
    'src/main.ts',
    """  activeSeed = normalizeSeed(queuedSeed);
  queuedSeed = null;
  spawnFallbackVisuals(activeFallbackSpecs, activeSeed);""",
    """  activeSeed = normalizeSeed(queuedSeed);
  queuedSeed = null;
  spawnAdditionalPhysicalVisuals(currentAdditionalPhysicalSpecs(), activeSeed);
  spawnFallbackVisuals(activeFallbackSpecs, activeSeed);""",
    'spawn physical and fallback layers independently',
)

# Worker/planner names were already globally renamed; make plan source clear.
replace_once(
    'src/main.ts',
    '  const additional = getAdditionalPhysicalPlanEntries();',
    '  const additional = getAdditionalPhysicalPlanEntries();',
    'additional planner stable anchor',
)

# Replay capture becomes physical-first.
replace_regex(
    'src/main.ts',
    r"function captureReplay\(plan: RollPlan\): void \{.*?\n\}",
    """function captureReplay(plan: RollPlan): void {
  const diagnostics = plan.diagnostics;
  lastTargetingSnapshot = diagnostics
    ? {
        method: 'shape-symmetry',
        planningMs: diagnostics.candidateSearchMs ?? 0,
        retargetedDiceCount: diagnostics.retargetedDice?.length ?? 0,
        preservedTrajectoryDiceCount: diagnostics.lockedKinematicDice ?? 0,
        naturalMatches: diagnostics.naturalMatches ?? 0,
        minimumFinalAlignment: diagnostics.finalTargetDots?.length
          ? Math.min(...diagnostics.finalTargetDots)
          : 1,
        targetSuccess: diagnostics.targetSuccess !== false,
        naturalTrajectory: diagnostics.naturalTrajectory === true,
        candidateAttempts: diagnostics.candidateAttempts ?? 0,
        candidateSearchMs: diagnostics.candidateSearchMs ?? 0,
        assistedDiceCount: diagnostics.assistedDice?.length ?? 0,
        maximumAssistAngleRadians: diagnostics.maximumAssistAngle ?? 0,
        continuityBlendedDiceCount: diagnostics.continuityBlendedDice?.length ?? 0,
      }
    : null;
  lastReplay = {
    formatVersion: 1,
    engineVersion: ENGINE_VERSION,
    seed: activeSeed,
    createdAt: new Date().toISOString(),
    physical: activePhysicalSpecs.map(clonePhysicalVisual),
    physicsPreset: activePhysicsPreset,
    bounds: { x: screenBounds.x, z: screenBounds.z },
    step: plan.step,
    frameCount: plan.frameCount,
    duration: plan.duration,
    transforms: plan.transforms,
    activationDelays: plan.activationDelays?.slice(),
    settleTimes: plan.settleTimes?.slice(),
    impacts: packImpacts(plan.impacts),
    fallbacks: activeFallbackSpecs.map((fallback) => ({
      ...fallback,
      metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
    })),
    additionalPhysicalReplay: captureAdditionalPhysicalReplay(),
    visualOrder: activeVisualOrder.map((entry) => ({ ...entry })),
    context: { ...activeContext },
    effectTimeline: createEffectTimeline(plan, activeOutcomes),
    settleReason: plan.settleReason,
    physicsSteps: plan.physicsSteps,
  };
}""",
    'physical-first replay capture',
)

# Additional physical visuals participate in playback.
replace_once(
    'src/main.ts',
    """  const fallbackProgress = plan.duration > 0 ? planTime / plan.duration : 1;
  fallbackVisuals.forEach((visual) => visual.update(fallbackProgress, plan.duration));""",
    """  const fallbackProgress = plan.duration > 0 ? planTime / plan.duration : 1;
  additionalPhysicalVisuals.forEach((visual) => visual.update(fallbackProgress, plan.duration));
  fallbackVisuals.forEach((visual) => visual.update(fallbackProgress, plan.duration));""",
    'play additional physical trajectories',
)
replace_once(
    'src/main.ts',
    """  if (settleImmediately) {
    fallbackVisuals.forEach((visual) => visual.settle());""",
    """  if (settleImmediately) {
    additionalPhysicalVisuals.forEach((visual) => visual.settle());
    fallbackVisuals.forEach((visual) => visual.settle());""",
    'settle additional physical visuals immediately',
)

# Replace replay playback entirely with the physical-first model.
replace_regex(
    'src/main.ts',
    r"function playRecordedReplay\(.*?\n\}\n\nfunction registerRollCompletion",
    """function playRecordedReplay(
  replay: RollReplay,
  options: DiceReplayOptions = {},
): Promise<DraftrollRollCompletion> {
  if (isRolling || isPlanning || replay.formatVersion !== 1)
    return Promise.reject(new Error('Renderer is busy or replay format is unsupported'));
  rebuildScreenBounds();
  applyRendererResolution();

  const physical = replay.physical.map(clonePhysicalVisual);
  const fallbacks = (replay.fallbacks ?? []).map((fallback) => ({
    ...fallback,
    metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
  }));
  const split = splitPhysicalSpecs(physical);
  const canonical = split.canonicalIndexes.map((index) => physical[index]);
  const additional = split.additionalIndexes.map((index) => physical[index]);
  const kinds = canonical.map((visual) => visual.canonicalKind).filter(isDieKind);
  if (kinds.length !== canonical.length)
    return Promise.reject(new Error('Replay canonical physical descriptors are invalid'));
  const themes = canonical.map((visual) => visual.theme);
  if (physical.some((visual) => !THEME_MANIFESTS[visual.theme]))
    return Promise.reject(new Error('Replay references an unavailable theme'));
  const totalVisuals = physical.length + fallbacks.length;
  if (totalVisuals < 1 || totalVisuals > 30)
    return Promise.reject(new Error('Replay visual count is invalid'));
  const expectedTransforms = replay.frameCount * canonical.length * 7;
  if (replay.transforms.length !== expectedTransforms)
    return Promise.reject(new Error('Replay transform buffer is invalid'));

  selectedKind = kinds[0] ?? 'd20';
  selectedTheme = physical[0]?.theme ?? fallbacks[0]?.theme ?? 'dragon';
  activePhysicalSpecs = physical;
  activeCanonicalPhysicalIndexes = split.canonicalIndexes;
  activeAdditionalPhysicalIndexes = split.additionalIndexes;
  activeKinds = kinds;
  quantity = canonical.length;
  activeThemes = themes;
  activePhysicsPreset = replay.physicsPreset ?? 'standard';
  activePhysics =
    normalizePhysicalProperties(
      canonical.map((visual) => visual.physics ?? {}),
      activeKinds,
      activeThemes,
      activePhysicsPreset,
    ) ?? Array.from({ length: quantity }, () => ({}));
  world.gravity.set(0, -PHYSICS_PRESETS[activePhysicsPreset].gravity, 0);
  spawnPreview(activeKinds, true);
  applyRuntimeQuality(totalVisuals);
  activeSeed = replay.seed;
  activeTargets = canonical.map((visual) => visual.outcomeIndex + 1);
  activeOutcomes = canonical.map((visual) => visual.outcome);
  activeFallbackSpecs = fallbacks;
  activeVisualOrder = normalizeVisualOrder(
    replay.visualOrder ?? null,
    physical.length,
    fallbacks.length,
  );
  if (activeVisualOrder.length !== totalVisuals)
    return Promise.reject(new Error('Replay visual ordering is invalid'));
  spawnAdditionalPhysicalVisuals(additional, activeSeed);
  spawnFallbackVisuals(activeFallbackSpecs, activeSeed);
  if (replay.additionalPhysicalReplay)
    restoreAdditionalPhysicalReplay(replay.additionalPhysicalReplay);
  dice.forEach((die, index) => {
    die.setTheme(activeThemes[index] ?? selectedTheme);
    applyDiePhysicsRuntime(die, activePhysicsPreset);
  });
  activeContext = { ...replay.context };
  const impacts: RollImpact[] = [];
  for (let index = 0; index + 2 < replay.impacts.length; index += 3) {
    impacts.push({
      time: replay.impacts[index],
      dieIndex: Math.round(replay.impacts[index + 1]),
      strength: replay.impacts[index + 2],
    });
  }
  const plan: RollPlan = {
    step: replay.step,
    frameCount: replay.frameCount,
    dieCount: quantity,
    transforms: replay.transforms.slice(),
    activationDelays:
      replay.activationDelays?.length === quantity ? replay.activationDelays.slice() : undefined,
    settleTimes: replay.settleTimes?.length === quantity ? replay.settleTimes.slice() : undefined,
    impacts,
    duration: replay.duration,
    results: canonical.map((visual) => visual.outcomeIndex + 1),
    settleReason: replay.settleReason,
    physicsSteps: replay.physicsSteps,
    sourceBounds: { ...replay.bounds },
  };
  if (!plan.settleTimes) plan.settleTimes = deriveDieSettleTimes(plan);
  applyReplayNumbering(plan);
  lastReplay = cloneReplay(replay);
  const completion = createRollCompletionPromise();
  const sourceDurationMs = Math.max(1, options.animationDurationMs ?? replay.duration * 1_000);
  const elapsedMs = Math.max(0, options.seekToMs ?? 0);
  const progress = elapsedMs / sourceDurationMs;
  const settleAfter = THREE.MathUtils.clamp(options.settleAfterProgress ?? 0.78, 0, 1);
  const settleImmediately =
    options.settleImmediately === true || (options.lateMode === 'auto' && progress >= settleAfter);
  const initialTime = options.lateMode === 'replay' ? 0 : Math.min(1, progress) * plan.duration;
  beginPlanPlayback(plan, { replaying: true, initialTime, settleImmediately });
  return completion;
}

function registerRollCompletion""",
    'physical-first replay playback',
)

# Physical-only bridge normalization. Preserve public physical order; internal canonical/additional
# implementations are mapped separately.
replace_regex(
    'src/main.ts',
    r"function cloneBridgePhysicalPresentation\(.*?\n\}\n\nfunction translatePhysicalTableContext\(.*?\n\}\n\n/\*\*\n \* Converts the new all-physical bridge contract.*?\nfunction normalizePhysicalBridgeRequest\(request: DiceRollRequest\): DiceRollRequest \{.*?\n\}",
    """interface NormalizedPhysicalBridgeRequest {
  physical: DraftrollPhysicalVisual[];
  canonicalResults: number[];
  canonicalKinds: DieKind[];
  canonicalThemes: ThemeName[];
  canonicalOutcomes: EffectOutcome[];
  canonicalPhysics: DicePhysicsProperties[];
  canonicalPhysicalIndexes: number[];
  additionalPhysical: DraftrollPhysicalVisual[];
  additionalPhysicalIndexes: number[];
  fallbacks: DraftrollFallbackVisual[];
  visualOrder: DraftrollVisualOrderEntry[];
  context: Record<string, unknown>;
  seed: string | number | undefined;
  startAtMs: number | undefined;
  seekToMs: number | undefined;
  animationDurationMs: number | undefined;
  settleImmediately: boolean | undefined;
  lateMode: RendererLateEventMode | undefined;
  settleAfterProgress: number | undefined;
  tableMode: 'replace' | 'add' | undefined;
  reducedMotion: boolean | undefined;
  physicsPreset: DicePhysicsPreset;
}

function normalizePhysicalBridgeRequest(request: DiceRollRequest): NormalizedPhysicalBridgeRequest {
  const physical = (request.physical ?? []).map(clonePhysicalVisual);
  physical.forEach((visual) => {
    if (
      !Number.isSafeInteger(visual.sides) ||
      visual.sides < 1 ||
      visual.sides > 256 ||
      !Number.isSafeInteger(visual.outcomeIndex) ||
      visual.outcomeIndex < 0 ||
      visual.outcomeIndex >= visual.sides ||
      !THEME_MANIFESTS[visual.theme]
    ) {
      throw new Error(`Invalid physical die descriptor: ${visual.id}`);
    }
  });
  const split = splitPhysicalSpecs(physical);
  const canonical = split.canonicalIndexes.map((index) => physical[index]);
  const canonicalKinds = canonical.map((visual) => visual.canonicalKind).filter(isDieKind);
  if (canonicalKinds.length !== canonical.length)
    throw new Error('Canonical physical descriptor is missing a supported canonicalKind');
  const fallbacks = (request.fallbacks ?? []).map((fallback) => ({
    ...fallback,
    metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
  }));
  const seed = request.seed;
  const defaultVisualPrefix =
    typeof request.context?.rollId === 'string'
      ? `${request.context.rollId}:`
      : `${String(seed ?? 'physical')}:`;
  const visualOrder = normalizeVisualOrder(
    request.visualOrder ?? null,
    physical.length,
    fallbacks.length,
    defaultVisualPrefix,
  );
  if (visualOrder.length !== physical.length + fallbacks.length)
    throw new Error('Physical visual ordering is invalid');
  return {
    physical,
    canonicalResults: canonical.map((visual) => visual.outcomeIndex + 1),
    canonicalKinds,
    canonicalThemes: canonical.map((visual) => visual.theme),
    canonicalOutcomes: canonical.map((visual) => visual.outcome),
    canonicalPhysics: canonical.map((visual) => ({ ...visual.physics })),
    canonicalPhysicalIndexes: split.canonicalIndexes,
    additionalPhysical: split.additionalIndexes.map((index) => physical[index]),
    additionalPhysicalIndexes: split.additionalIndexes,
    fallbacks,
    visualOrder,
    context: { ...request.context },
    seed,
    startAtMs: request.startAtMs,
    seekToMs: request.seekToMs,
    animationDurationMs: request.animationDurationMs,
    settleImmediately: request.settleImmediately,
    lateMode: request.lateMode,
    settleAfterProgress: request.settleAfterProgress,
    tableMode: request.tableMode,
    reducedMotion: request.reducedMotion,
    physicsPreset: request.physicsPreset ?? 'standard',
  };
}""",
    'clean bridge physical normalization',
)

# Replace additive normalization with physical-first data.
replace_regex(
    'src/main.ts',
    r"interface AdditivePhysicalRequest \{.*?\n\}\n\nfunction normalizeAdditivePhysicalRequest\(.*?\n\}",
    """interface AdditivePhysicalRequest extends NormalizedPhysicalBridgeRequest {}

function normalizeAdditivePhysicalRequest(request: DiceRollRequest): AdditivePhysicalRequest | null {
  if (request.settleImmediately || request.lateMode === 'settled' || request.lateMode === 'replay')
    return null;
  try {
    const normalized = normalizePhysicalBridgeRequest(request);
    if (normalized.physical.length + normalized.fallbacks.length === 0) return null;
    return normalized;
  } catch {
    return null;
  }
}""",
    'clean additive physical normalization',
)

# Append helpers for additional physical objects before fallback append helpers.
replace_once(
    'src/main.ts',
    """function appendFallbackVisuals(
  specs: readonly DraftrollFallbackVisual[],
  seed: string,
): FallbackVisualInstance[] {""",
    """function appendAdditionalPhysicalVisuals(
  specs: readonly DraftrollPhysicalVisual[],
  seed: string,
): PhysicalDieVisualInstance[] {
  if (specs.length === 0) return [];
  const start = additionalPhysicalVisuals.length;
  const total = start + specs.length;
  const random = createSeededRandom(`${seed}:additive-physical`);
  const occupied = additionalPhysicalVisuals.map((visual) => visual.getSettledPosition());
  const appended = specs.map((spec, offset) => {
    const visual = new PhysicalDieVisualInstance(spec);
    visual.configureTrajectory(start + offset, total, screenBounds, random, occupied);
    scene.add(visual.group);
    additionalPhysicalVisuals.push(visual);
    return visual;
  });
  return appended;
}

function appendFallbackVisuals(
  specs: readonly DraftrollFallbackVisual[],
  seed: string,
): FallbackVisualInstance[] {""",
    'append additional physical visuals',
)
replace_once(
    'src/main.ts',
    """function removeAppendedFallbackVisuals(appended: readonly FallbackVisualInstance[]): void {""",
    """function removeAppendedAdditionalPhysicalVisuals(
  appended: readonly PhysicalDieVisualInstance[],
): void {
  for (const visual of appended) {
    scene.remove(visual.group);
    visual.dispose();
  }
  additionalPhysicalVisuals.splice(
    Math.max(0, additionalPhysicalVisuals.length - appended.length),
    appended.length,
  );
}

function removeAppendedFallbackVisuals(appended: readonly FallbackVisualInstance[]): void {""",
    'remove appended additional physical visuals',
)

# Replace appendTableRoll with physical-index-aware implementation.
replace_regex(
    'src/main.ts',
    r"async function appendTableRoll\(request: DiceRollRequest\): Promise<DraftrollRollCompletion> \{.*?\n\}\n\nfunction canAppendTableRequest",
    """async function appendTableRoll(request: DiceRollRequest): Promise<DraftrollRollCompletion> {
  const generation = presentationGeneration;
  const normalized = normalizeAdditivePhysicalRequest(request);
  if (
    !normalized ||
    !activePlan ||
    (!isRolling && !hasCast) ||
    isPlanning ||
    (activePhysicalSpecs.length === 0 && activeFallbackSpecs.length === 0)
  ) {
    throw new Error('Active table roll cannot accept this presentation');
  }
  if (dissolveAnimation) cancelDissolve(false);
  const existingCanonicalCount = dice.length;
  const existingPhysicalCount = activePhysicalSpecs.length;
  const existingFallbackCount = activeFallbackSpecs.length;
  if (
    existingPhysicalCount +
      activeFallbackSpecs.length +
      normalized.physical.length +
      normalized.fallbacks.length >
    30
  ) {
    throw new Error('Active table visual limit exceeded');
  }

  const registered = registerRollCompletion();
  const previous = {
    activeKinds: activeKinds.slice(),
    activeThemes: activeThemes.slice(),
    activePhysics: activePhysics.map((entry) => ({ ...entry })),
    activePhysicsPreset,
    activeTargets: activeTargets.slice(),
    activeOutcomes: activeOutcomes.slice(),
    activePhysicalSpecs: activePhysicalSpecs.map(clonePhysicalVisual),
    activeCanonicalPhysicalIndexes: activeCanonicalPhysicalIndexes.slice(),
    activeAdditionalPhysicalIndexes: activeAdditionalPhysicalIndexes.slice(),
    activeVisualOrder: activeVisualOrder.map((entry) => ({ ...entry })),
    activeFallbackSpecs: activeFallbackSpecs.map((entry) => ({
      ...entry,
      metadata: entry.metadata ? { ...entry.metadata } : undefined,
    })),
    activeContext: { ...activeContext },
    activeSeed,
    activeAnimationDurationMs,
  };
  const existingStates = sampleActiveLaunchStates(activePlan, planTime);
  const lockedTrajectory = isRolling
    ? createLockedTableTrajectory(activePlan, planTime, existingCanonicalCount)
    : undefined;
  activePhysicsPreset = normalized.physicsPreset;
  world.gravity.set(0, -PHYSICS_PRESETS[activePhysicsPreset].gravity, 0);
  const appended = appendPhysicalDice(
    normalized.canonicalKinds,
    normalized.canonicalThemes,
    normalized.canonicalPhysics,
  );
  const appendedAdditional = appendAdditionalPhysicalVisuals(
    normalized.additionalPhysical,
    String(normalized.seed ?? `table-add:${Date.now()}`),
  );
  const appendedFallbacks = appendFallbackVisuals(
    normalized.fallbacks,
    String(normalized.seed ?? `table-add:${Date.now()}`),
  );
  try {
    activeKinds.push(...normalized.canonicalKinds);
    activeThemes.push(...normalized.canonicalThemes);
    activePhysics.push(...normalized.canonicalPhysics);
    activeTargets.push(...normalized.canonicalResults);
    activeOutcomes.push(...normalized.canonicalOutcomes);
    activePhysicalSpecs.push(...normalized.physical.map(clonePhysicalVisual));
    activeCanonicalPhysicalIndexes.push(
      ...normalized.canonicalPhysicalIndexes.map((index) => existingPhysicalCount + index),
    );
    activeAdditionalPhysicalIndexes.push(
      ...normalized.additionalPhysicalIndexes.map((index) => existingPhysicalCount + index),
    );
    activeFallbackSpecs.push(...normalized.fallbacks);
    normalized.visualOrder.forEach((entry) =>
      activeVisualOrder.push(
        entry.kind === 'physical'
          ? { ...entry, index: existingPhysicalCount + entry.index }
          : { ...entry, index: existingFallbackCount + entry.index },
      ),
    );
    quantity = dice.length;
    quantityValue.textContent = String(quantity);
    mergeAdditiveContext(
      normalized.context,
      existingPhysicalCount,
      normalized.physical.length,
      existingFallbackCount,
      normalized.fallbacks.length,
    );
    const normalizedSeed = String(normalized.seed ?? `table-add:${Date.now()}`);
    activeSeed = `${activeSeed}|${normalizedSeed}`;
    activeAnimationDurationMs =
      Math.max(activeAnimationDurationMs ?? 0, normalized.animationDurationMs ?? 0) || null;
    applyRuntimeQuality(activePhysicalSpecs.length + activeFallbackSpecs.length);

    const groupIndex = Math.max(0, readActiveTableRolls().length - 1);
    const random = createSeededRandom(normalizedSeed);
    const lane = THREE.MathUtils.clamp(
      ((groupIndex % 5) - 2) / 2.4 + (random() - 0.5) * 0.12,
      -0.88,
      0.88,
    );
    const direction = new THREE.Vector2(-lane * 0.32, -1)
      .normalize()
      .rotateAround(new THREE.Vector2(), (random() - 0.5) * 0.1);
    const scheduledDelay =
      normalized.startAtMs === undefined
        ? 0
        : Math.max(0, (normalized.startAtMs - Date.now()) / 1_000);
    const appendedCanonical = appended.map((die, index) => ({
      die,
      index: existingCanonicalCount + index,
      id: physicalVisualId(activeCanonicalPhysicalIndexes[existingCanonicalCount + index]),
    }));
    const newStates = createMixedPhysicalLaunchStates(
      appendedCanonical,
      getPendingPhysicalLaunchParticipants(),
      random,
      direction,
      lane,
      scheduledDelay,
    );

    tableReplanPaused = true;
    isPlanning = true;
    setStatus(`${readActiveTableRolls().length} rollers sharing the table`, true);
    const needsSharedPhysicalPlan = newStates.length > 0 || hasPendingAdditionalPhysicalDice();
    const plan = needsSharedPhysicalPlan
      ? await buildRollPlan([...existingStates, ...newStates], existingCanonicalCount, lockedTrajectory)
      : createStaticTablePlan(createFallbackOnlyPlan(normalized.fallbacks).duration);
    assertPresentationGeneration(generation);
    appended.forEach((die) => {
      die.group.visible = true;
    });
    activeOutcomes = activeOutcomes.slice(0, plan.results.length);
    syncCanonicalPhysicalSpecs(plan.results);
    captureReplay(plan);
    beginPlanPlayback(plan, { initialTime: 0, settleImmediately: false });
    return registered.promise;
  } catch (error) {
    pendingRollCompletions.delete(registered.pending);
    registered.pending.reject(error instanceof Error ? error : new Error(String(error)));
    if (generation !== presentationGeneration) throw presentationClearedError();
    removeAppendedDice(appended);
    removeAppendedAdditionalPhysicalVisuals(appendedAdditional);
    removeAppendedFallbackVisuals(appendedFallbacks);
    activeKinds = previous.activeKinds;
    activeThemes = previous.activeThemes;
    activePhysics = previous.activePhysics;
    activePhysicsPreset = previous.activePhysicsPreset;
    activeTargets = previous.activeTargets;
    activeOutcomes = previous.activeOutcomes;
    activePhysicalSpecs = previous.activePhysicalSpecs;
    activeCanonicalPhysicalIndexes = previous.activeCanonicalPhysicalIndexes;
    activeAdditionalPhysicalIndexes = previous.activeAdditionalPhysicalIndexes;
    activeVisualOrder = previous.activeVisualOrder;
    activeFallbackSpecs = previous.activeFallbackSpecs;
    activeContext = previous.activeContext;
    activeSeed = previous.activeSeed;
    activeAnimationDurationMs = previous.activeAnimationDurationMs;
    quantity = dice.length;
    throw error;
  } finally {
    isPlanning = false;
    tableReplanPaused = false;
    requestRender();
  }
}

function canAppendTableRequest""",
    'physical-first additive table append',
)
replace_once(
    'src/main.ts',
    """    (dice.length > 0 || activeFallbackSpecs.length > 0) &&""",
    """    (activePhysicalSpecs.length > 0 || activeFallbackSpecs.length > 0) &&""",
    'append table active physical check',
)

# Update launch participant IDs to map canonical implementation indexes into physical order.
replace_once(
    'src/main.ts',
    """function allCanonicalLaunchParticipants(): CanonicalLaunchParticipant[] {
  return dice.map((die, index) => ({ die, index, id: physicalVisualId(index) }));
}""",
    """function allCanonicalLaunchParticipants(): CanonicalLaunchParticipant[] {
  return dice.map((die, index) => ({
    die,
    index,
    id: physicalVisualId(activeCanonicalPhysicalIndexes[index] ?? index),
  }));
}""",
    'canonical physical ID mapping',
)

# Result helpers and effect helpers use full physical order.
replace_regex(
    'src/main.ts',
    r"function collectOrderedVisualResults\(.*?\n\}\n\nfunction formatVisualResult",
    """function physicalResultAt(
  physicalIndex: number,
  canonicalValues: readonly number[],
): number | string {
  const spec = activePhysicalSpecs[physicalIndex];
  if (spec) return spec.result;
  const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);
  return canonicalIndex >= 0 ? (canonicalValues[canonicalIndex] ?? 0) : 0;
}

function physicalOutcomeAt(physicalIndex: number): EffectOutcome {
  const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);
  if (canonicalIndex >= 0) return activeOutcomes[canonicalIndex] ?? 'neutral';
  return activePhysicalSpecs[physicalIndex]?.outcome ?? 'neutral';
}

function collectOrderedVisualResults(physicalValues: readonly number[]): Array<number | string> {
  return activeVisualOrder.map((entry) =>
    entry.kind === 'physical'
      ? physicalResultAt(entry.index, physicalValues)
      : (activeFallbackSpecs[entry.index]?.result ?? ''),
  );
}

function formatVisualResult""",
    'physical semantic result helpers',
)
replace_regex(
    'src/main.ts',
    r"function formatVisualResult\(.*?\n\}\n\nfunction readRenderedDieState",
    """function formatVisualResult(
  entry: DraftrollVisualOrderEntry,
  physicalValues: readonly number[],
): string {
  const state = readRenderedDieState(entry.dieId);
  const suffix =
    state?.kept === false
      ? ' (discarded)'
      : state?.generatedBy === 'reroll'
        ? ' (reroll)'
        : state?.generatedBy === 'reroll-add'
          ? ' (reroll + add)'
          : state?.generatedBy === 'explosion'
            ? ' (explosion)'
            : '';
  if (entry.kind === 'physical') {
    const spec = activePhysicalSpecs[entry.index];
    if (spec) return `${spec.title} ${spec.label}${suffix}`;
    return `Die ${String(physicalResultAt(entry.index, physicalValues))}${suffix}`;
  }
  const fallback = activeFallbackSpecs[entry.index];
  return fallback ? `${fallback.title} ${fallback.label}${suffix}` : `Result${suffix}`;
}

function readRenderedDieState""",
    'physical semantic result formatting',
)
replace_once(
    'src/main.ts',
    """    activeVisualOrder.find((entry) => entry.kind === 'physical' && entry.index === index)?.dieId ??
    `physical_${index}`""",
    """    activeVisualOrder.find((entry) => entry.kind === 'physical' && entry.index === index)?.dieId ??
    activePhysicalSpecs[index]?.id ??
    `physical_${index}`""",
    'physical visual ID fallback',
)

replace_once(
    'src/main.ts',
    """  consumeSettledVisualIndexes(
    Array.from({ length: plan.dieCount }, (_value, index) => physicalVisualId(index)),
    settleTimes,
    time,
    playedOutcomeEffectIds,
  );
  consumeSettledVisualIndexes(""",
    """  consumeSettledVisualIndexes(
    Array.from({ length: plan.dieCount }, (_value, index) =>
      physicalVisualId(activeCanonicalPhysicalIndexes[index] ?? index),
    ),
    settleTimes,
    time,
    playedOutcomeEffectIds,
  );
  consumeSettledVisualIndexes(
    additionalPhysicalVisuals.map((_visual, index) =>
      physicalVisualId(activeAdditionalPhysicalIndexes[index] ?? index),
    ),
    additionalPhysicalVisuals.map((visual) => visual.getSettleTime(plan.duration)),
    time,
    playedOutcomeEffectIds,
  );
  consumeSettledVisualIndexes(""",
    'mark additional physical effects',
)

replace_regex(
    'src/main.ts',
    r"function playSettledOutcomeEffects\(plan: RollPlan, currentTime: number\): void \{.*?\n\}",
    """function playSettledOutcomeEffects(plan: RollPlan, currentTime: number): void {
  const settleTimes =
    plan.settleTimes?.length === plan.dieCount ? plan.settleTimes : deriveDieSettleTimes(plan);
  plan.settleTimes = settleTimes;
  const canonicalIndexes = consumeSettledVisualIndexes(
    Array.from({ length: plan.dieCount }, (_value, index) =>
      physicalVisualId(activeCanonicalPhysicalIndexes[index] ?? index),
    ),
    settleTimes,
    currentTime,
    playedOutcomeEffectIds,
  );
  const additionalIndexes = consumeSettledVisualIndexes(
    additionalPhysicalVisuals.map((_visual, index) =>
      physicalVisualId(activeAdditionalPhysicalIndexes[index] ?? index),
    ),
    additionalPhysicalVisuals.map((visual) => visual.getSettleTime(plan.duration)),
    currentTime,
    playedOutcomeEffectIds,
  );
  const fallbackIndexes = consumeSettledVisualIndexes(
    activeFallbackSpecs.map((_spec, index) => fallbackVisualId(index)),
    fallbackVisuals.map((visual) => visual.getSettleTime(plan.duration)),
    currentTime,
    playedOutcomeEffectIds,
  );
  if (canonicalIndexes.length === 0 && additionalIndexes.length === 0 && fallbackIndexes.length === 0)
    return;
  if (document.hidden) return;

  effects.beginBatch();
  try {
    canonicalIndexes.forEach((index) => {
      const physicalIndex = activeCanonicalPhysicalIndexes[index] ?? index;
      const outcome = physicalOutcomeAt(physicalIndex);
      effects.playOutcome(
        activeThemes[index] ?? selectedTheme,
        outcome,
        dice[index].getWorldPosition().setY(0.05),
        {
          kind: activeKinds[index] ?? selectedKind,
          value: plan.results[index],
          hero: reserveHeroEffect(effectGroupId('physical', physicalIndex), outcome),
        },
      );
    });
    additionalIndexes.forEach((index) => {
      const physicalIndex = activeAdditionalPhysicalIndexes[index];
      const spec = physicalIndex === undefined ? undefined : activePhysicalSpecs[physicalIndex];
      const visual = additionalPhysicalVisuals[index];
      if (!spec || !visual) return;
      effects.playOutcome(spec.theme, spec.outcome, visual.getWorldPosition().setY(0.05), {
        kind: 'd6',
        value: spec.numericValue ?? (typeof spec.result === 'number' ? spec.result : 0),
        hero: reserveHeroEffect(effectGroupId('physical', physicalIndex), spec.outcome),
      });
    });
    fallbackIndexes.forEach((index) => {
      const spec = activeFallbackSpecs[index];
      const visual = fallbackVisuals[index];
      if (!spec || !visual) return;
      effects.playOutcome(spec.theme, spec.outcome, visual.getWorldPosition().setY(0.05), {
        kind: 'd6',
        value: spec.numericValue ?? 0,
        hero: reserveHeroEffect(effectGroupId('fallback', index), spec.outcome),
      });
    });
  } finally {
    effects.endBatch();
  }
  requestRender();
}""",
    'play canonical additional fallback effects independently',
)
replace_once(
    'src/main.ts',
    """      if (activeOutcomes[index] === 'positive') positive = true;
      if (activeOutcomes[index] === 'negative') negative = true;""",
    """      const outcome = physicalOutcomeAt(index);
      if (outcome === 'positive') positive = true;
      if (outcome === 'negative') negative = true;""",
    'table outcome summary full physical order',
)

# Sync manually-created physical descriptors once their natural result is known.
replace_once(
    'src/main.ts',
    """function revealResults(): void {""",
    """function syncCanonicalPhysicalSpecs(results: readonly number[]): void {
  activeCanonicalPhysicalIndexes.forEach((physicalIndex, canonicalIndex) => {
    const spec = activePhysicalSpecs[physicalIndex];
    if (!spec) return;
    spec.outcome = activeOutcomes[canonicalIndex] ?? spec.outcome;
    if (spec.metadata?.draftrollManualPhysical === true) {
      const result = results[canonicalIndex] ?? spec.outcomeIndex + 1;
      spec.outcomeIndex = Math.max(0, Math.round(result) - 1);
      spec.result = result;
      spec.numericValue = result;
      spec.label = String(result);
    }
  });
}

function revealResults(): void {""",
    'sync canonical physical descriptors',
)
replace_once(
    'src/main.ts',
    """  const fallbackTotal = activeFallbackSpecs.reduce(
    (sum, fallback) => sum + (fallback.numericValue ?? 0),
    0,
  );
  const physicalTotal = physicalValues.reduce((sum, value) => sum + value, 0);""",
    """  const fallbackTotal = activeFallbackSpecs.reduce(
    (sum, fallback) => sum + (fallback.numericValue ?? 0),
    0,
  );
  const additionalPhysicalTotal = currentAdditionalPhysicalSpecs().reduce(
    (sum, visual) =>
      sum + (visual.numericValue ?? (typeof visual.result === 'number' ? visual.result : 0)),
    0,
  );
  const physicalTotal =
    physicalValues.reduce((sum, value) => sum + value, 0) + additionalPhysicalTotal;""",
    'result total includes additional physical dice',
)
replace_once(
    'src/main.ts',
    """  fallbackVisuals.forEach((visual) => visual.settle());""",
    """  additionalPhysicalVisuals.forEach((visual) => visual.settle());
  fallbackVisuals.forEach((visual) => visual.settle());""",
    'settle additional physical dice on reveal',
)
replace_once(
    'src/main.ts',
    """            physicalCount: activeOutcomes.length,""",
    """            physicalCount: activePhysicalSpecs.length,""",
    'result summary physical count',
)

# Cast path counts physical specs, not only canonical implementation objects.
replace_once(
    'src/main.ts',
    """  const hasQueuedVisualRequest =
    queuedApiResults !== null || queuedKinds !== null || queuedFallbacks !== null;""",
    """  const hasQueuedVisualRequest =
    queuedPhysical !== null || queuedApiResults !== null || queuedKinds !== null || queuedFallbacks !== null;""",
    'queued physical cast detection',
)
replace_once(
    'src/main.ts',
    '  const totalVisuals = quantity + activeFallbackSpecs.length;',
    '  const totalVisuals = activePhysicalSpecs.length + activeFallbackSpecs.length;',
    'cast visual count',
)
replace_once(
    'src/main.ts',
    '  const hasArbitraryPhysicalDice = hasConfiguredAdditionalPhysicalDice();',
    '  const hasArbitraryPhysicalDice = hasConfiguredAdditionalPhysicalDice();',
    'additional physical cast anchor',
)
replace_once(
    'src/main.ts',
    """    activeOutcomes = resolveOutcomes(plan.results);
  }

  captureReplay(plan);""",
    """    activeOutcomes = resolveOutcomes(plan.results);
    syncCanonicalPhysicalSpecs(plan.results);
  }

  captureReplay(plan);""",
    'sync physical descriptors before replay capture',
)

# Current performance count and active-state checks should include additional physicals.
replace_all('src/main.ts', 'quantity + activeFallbackSpecs.length', 'activePhysicalSpecs.length + activeFallbackSpecs.length')
replace_all('src/main.ts', '(dice.length === 0 && activeFallbackSpecs.length === 0)', '(activePhysicalSpecs.length === 0 && activeFallbackSpecs.length === 0)')

# Window bridge roll handler: only clean request objects populate queued internals.
replace_regex(
    'src/main.ts',
    r"window\.draftrollDice = \{\n  roll: \(input\) => \{.*?\n  \},\n  setResults:",
    """window.draftrollDice = {
  roll: (request) => {
    if (request && canAppendTableRequest(request)) return appendTableRoll(request);
    return enqueueRendererTask(async (generation) => {
      queuedPhysical = null;
      queuedApiResults = null;
      queuedOutcomes = null;
      queuedContext = {};
      queuedSeed = null;
      queuedThemes = null;
      queuedKinds = null;
      queuedPhysics = null;
      queuedPhysicsPreset = 'standard';
      queuedFallbacks = null;
      queuedVisualOrder = null;
      queuedStartAtMs = null;
      queuedSeekToMs = 0;
      queuedAnimationDurationMs = null;
      queuedSettleImmediately = false;
      queuedLateMode = 'auto';
      queuedSettleAfterProgress = 0.78;
      if (request) {
        const normalized = normalizePhysicalBridgeRequest(request);
        queuedPhysical = normalized.physical.map(clonePhysicalVisual);
        queuedApiResults = normalized.canonicalResults.slice();
        queuedOutcomes = normalized.canonicalOutcomes.slice();
        queuedContext = { ...normalized.context };
        queuedSeed = normalized.seed ?? null;
        queuedThemes = normalized.canonicalThemes.slice();
        queuedKinds = normalized.canonicalKinds.slice();
        queuedPhysics = normalized.canonicalPhysics.map((entry) => ({ ...entry }));
        queuedPhysicsPreset = normalized.physicsPreset;
        queuedFallbacks = normalized.fallbacks.map((fallback) => ({
          ...fallback,
          metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
        }));
        queuedVisualOrder = normalized.visualOrder.map((entry) => ({ ...entry }));
        queuedStartAtMs =
          typeof normalized.startAtMs === 'number' && Number.isFinite(normalized.startAtMs)
            ? normalized.startAtMs
            : null;
        queuedSeekToMs =
          typeof normalized.seekToMs === 'number' && Number.isFinite(normalized.seekToMs)
            ? Math.max(0, normalized.seekToMs)
            : 0;
        queuedAnimationDurationMs =
          typeof normalized.animationDurationMs === 'number' &&
          Number.isFinite(normalized.animationDurationMs)
            ? Math.max(1, normalized.animationDurationMs)
            : null;
        queuedSettleImmediately = normalized.settleImmediately === true;
        queuedLateMode =
          normalized.lateMode === 'seek' ||
          normalized.lateMode === 'settled' ||
          normalized.lateMode === 'replay'
            ? normalized.lateMode
            : 'auto';
        queuedSettleAfterProgress =
          typeof normalized.settleAfterProgress === 'number' &&
          Number.isFinite(normalized.settleAfterProgress)
            ? THREE.MathUtils.clamp(normalized.settleAfterProgress, 0, 1)
            : 0.78;
      }
      return castDice(undefined, generation);
    });
  },
  setResults:""",
    'clean window physical bridge handler',
)

# Reset queued physical alongside manual controls.
replace_all(
    'src/main.ts',
    "    queuedApiResults = null;\n    queuedSeed = null;",
    "    queuedPhysical = null;\n    queuedApiResults = null;\n    queuedSeed = null;",
)
replace_all(
    'src/main.ts',
    "    queuedApiResults = null;\n    queuedOutcomes = null;",
    "    queuedPhysical = null;\n    queuedApiResults = null;\n    queuedOutcomes = null;",
)

# Browser preview uses the physical descriptor directly.
replace_once(
    'src/main.ts',
    """    return window.draftrollDice.roll({
      results: [value],
      kinds: [requestedKind],
      themes: [selectedTheme],
      context: { preview: true },
    });""",
    """    const sides = maximumDieValue(requestedKind);
    const type = requestedKind === 'coin' ? 'd2' : requestedKind;
    return window.draftrollDice.roll({
      physical: [
        {
          id: 'preview-die',
          type,
          sides,
          outcomeIndex: THREE.MathUtils.clamp(Math.round(value), 1, sides) - 1,
          result: value,
          numericValue: value,
          canonicalKind: requestedKind,
          title: type,
          label: String(value),
          theme: selectedTheme,
          outcome: 'neutral',
        },
      ],
      visualOrder: [{ kind: 'physical', index: 0, dieId: 'preview-die' }],
      context: { preview: true },
    });""",
    'clean physical preview',
)

# ---------------------------------------------------------------------------
# Canonical renderer label styling uses the same physical theme contract.
# ---------------------------------------------------------------------------
replace_once(
    'src/dice.ts',
    """  getRuntimeThemeFont,
  getRuntimeThemeMaterial,""",
    """  getRuntimeThemeFont,
  getRuntimeThemeLabelStyle,
  getRuntimeThemeMaterial,""",
    'canonical label style import',
)
replace_once(
    'src/dice.ts',
    """  const palette = THEMES[theme] ?? THEMES.dragon;
  const size = 1024;""",
    """  const palette = THEMES[theme] ?? THEMES.dragon;
  const style = getRuntimeThemeLabelStyle(theme, 'default');
  const size = 1024;""",
    'canonical generated label style',
)
replace_once(
    'src/dice.ts',
    """    const runtimeFont = getRuntimeThemeFont(theme);
    context.font = `700 ${fontSize}px ${runtimeFont ? `'${runtimeFont}', ` : ''}Cinzel, Georgia, serif`;
    context.lineWidth = cellHeight * 0.055;
    context.strokeStyle = outline;
    context.shadowColor = palette.labelGlow;""",
    """    const runtimeFont = getRuntimeThemeFont(theme);
    context.font = `700 ${fontSize}px ${runtimeFont ? `'${runtimeFont}', ` : ''}Cinzel, Georgia, serif`;
    context.lineWidth = fontSize * (style?.outlineWidth ?? 0.1);
    context.strokeStyle = style?.outlineColor ?? outline;
    context.shadowColor = style?.glowColor ?? palette.labelGlow;""",
    'canonical label outline style',
)
replace_once(
    'src/dice.ts',
    '    context.fillStyle = palette.label;',
    '    context.fillStyle = style?.color ?? palette.label;',
    'canonical label color style',
)

# ---------------------------------------------------------------------------
# Tests: assert no spinner/legacy bridge arrays and all dice are physical.
# ---------------------------------------------------------------------------
replace_regex(
    'scripts/test-visual-fallbacks.mjs',
    r"for \(const kind of \['coin', 'percentile', 'fate', 'spinner', 'token', 'card'\]\) \{.*?\n\}",
    """for (const kind of ['token', 'card']) {
  assert.match(
    renderer,
    new RegExp(`['\"]${kind}['\"]`),
    `renderer fallback kind ${kind} is missing`,
  );
}
assert.doesNotMatch(renderer, /'spinner'/);""",
    'visual fallback clean kinds',
)
replace_once(
    'scripts/test-visual-fallbacks.mjs',
    'assert.match(renderer, /physical\\?: DraftrollPhysicalVisual\\[\\]/);',
    """assert.match(renderer, /physical\\?: DraftrollPhysicalVisual\\[\\]/);
assert.doesNotMatch(renderer, /results\\?: number\\[\\] \\| number/);
assert.doesNotMatch(renderer, /kinds\\?: DraftrollDieKind/);
assert.doesNotMatch(renderer, /forceFallback/);""",
    'visual fallback no legacy bridge fields',
)
replace_once(
    'scripts/test-visual-fallbacks.mjs',
    "assert.match(visuals, /PhysicalDieVisualInstance/);",
    "assert.doesNotMatch(visuals, /PhysicalDieVisualInstance/);",
    'fallback router contains no physical dice',
)
replace_once(
    'scripts/test-visual-fallbacks.mjs',
    "assert.match(visuals, /usesPhysicalDieModel/);",
    "assert.match(visuals, /fallback-visuals-base/);",
    'fallback router is direct non-die export',
)
for before, after in [
    ('getPhysicalFallbackPlanEntries', 'getAdditionalPhysicalPlanEntries'),
    ('commitPhysicalFallbackPlan', 'commitAdditionalPhysicalPlan'),
    ('capturePhysicalFallbackReplay', 'captureAdditionalPhysicalReplay'),
    ('restorePhysicalFallbackReplay', 'restoreAdditionalPhysicalReplay'),
    ('hasPendingPhysicalFallbackDice', 'hasPendingAdditionalPhysicalDice'),
]:
    replace_all('scripts/test-visual-fallbacks.mjs', before, after)
replace_once(
    'scripts/test-visual-fallbacks.mjs',
    "assert.doesNotMatch(physicalVisuals, /BaseFallbackVisualInstance/);",
    """assert.doesNotMatch(physicalVisuals, /DraftrollFallbackVisual/);
assert.doesNotMatch(physicalVisuals, /BaseFallbackVisualInstance/);""",
    'physical visual no fallback spec',
)
replace_once(
    'scripts/test-visual-fallbacks.mjs',
    "assert.match(physicalMesh, /getRuntimeThemeMesh/);",
    """assert.match(physicalMesh, /getRuntimeThemeMesh/);
assert.match(physicalMesh, /getRuntimeThemeLabelStyle/);
assert.match(physicalMesh, /getRuntimeThemeAssetTexture/);""",
    'physical theme mesh content styling tests',
)

# Runtime theme fixture uses only physical namespace and bridge only physical[].
replace_once(
    'scripts/test-runtime-themes.mjs',
    """    material: {
      color: '#17131f',
      roughness: 0.44,
      metalness: 0.3,
      surfaceTexture: { src: 'assets/obsidian.webp', mimeType: 'image/webp' },
    },
    labels: {
      color: '#ffffff',
      atlas: { src: 'assets/labels.png', mimeType: 'image/png' },
    },""",
    """    physical: {
      material: {
        color: '#17131f',
        roughness: 0.44,
        metalness: 0.3,
        surfaceTexture: { src: 'assets/obsidian.webp', mimeType: 'image/webp' },
      },
      labels: { color: '#ffffff', outlineColor: '#110d18', outlineWidth: 0.06 },
      dice: {
        d20: {
          labels: { atlas: { src: 'assets/labels.png', mimeType: 'image/png' } },
          presentation: {
            contents: Array.from({ length: 20 }, (_entry, index) =>
              index === 19
                ? { kind: 'icon', icon: '★', label: 'critical' }
                : { kind: 'number', value: index + 1 },
            ),
          },
        },
      },
    },""",
    'runtime theme clean physical fixture',
)
replace_once(
    'scripts/test-runtime-themes.mjs',
    '      return { results: request.results ?? [], total: 12, replay: null };',
    "      return { results: request.physical?.map((entry) => entry.result) ?? [], total: 12, replay: null };",
    'theme test physical bridge return',
)
replace_once(
    'scripts/test-runtime-themes.mjs',
    "  assert.deepEqual(bridgeCalls.find(([name]) => name === 'roll')[1].themes, [manifest.id]);",
    """  const rollRequest = bridgeCalls.find(([name]) => name === 'roll')[1];
  assert.equal(rollRequest.results, undefined);
  assert.equal(rollRequest.kinds, undefined);
  assert.equal(rollRequest.themes, undefined);
  assert.equal(rollRequest.physics, undefined);
  assert.equal(rollRequest.physical.length, 1);
  assert.equal(rollRequest.physical[0].theme, manifest.id);""",
    'theme test physical-only bridge assertion',
)

# Mixed renderer now expects every die-like component in physical[].
replace_once(
    'scripts/test-mixed-renderer.mjs',
    """  assert.deepEqual(
    calls[1].physical.map((visual) => visual.type),
    ['d20', 'd2', 'd9'],
  );""",
    """  assert.deepEqual(
    calls[1].physical.map((visual) => visual.type),
    ['d20', 'd2', 'coin', 'dF', 'd9', 'd100'],
  );""",
    'mixed renderer all dice physical types',
)
replace_once(
    'scripts/test-mixed-renderer.mjs',
    """  assert.deepEqual(
    calls[1].physical.map((visual) => visual.outcomeIndex),
    [16, 1, 6],
  );""",
    """  assert.deepEqual(
    calls[1].physical.map((visual) => visual.outcomeIndex),
    [16, 1, 0, 0, 6, 81],
  );""",
    'mixed renderer all physical slots',
)
replace_once(
    'scripts/test-mixed-renderer.mjs',
    """  assert.deepEqual(
    calls[1].fallbacks.map((fallback) => fallback.kind),
    ['coin', 'fate', 'percentile', 'card', 'token'],
  );""",
    """  assert.deepEqual(
    calls[1].fallbacks.map((fallback) => fallback.kind),
    ['card', 'token'],
  );""",
    'mixed renderer true fallbacks only',
)
replace_once(
    'scripts/test-mixed-renderer.mjs',
    """    [
      'physical',
      'physical',
      'fallback',
      'fallback',
      'physical',
      'fallback',
      'fallback',
      'fallback',
    ],""",
    """    [
      'physical',
      'physical',
      'physical',
      'physical',
      'physical',
      'physical',
      'fallback',
      'fallback',
    ],""",
    'mixed renderer physical visual order',
)
replace_regex(
    'scripts/test-mixed-renderer.mjs',
    r"  assert\.equal\(calls\[1\]\.fallbacks\[0\]\.oppositeLabel, 'Tails'\);.*?  assert\.equal\(calls\[1\]\.fallbacks\[4\]\.label, 'Storm'\);",
    """  assert.equal(calls[1].physical[2].presentation.contents[0].text, 'Heads');
  assert.equal(calls[1].physical[3].presentation.contents[0].text, '−');
  assert.equal(calls[1].fallbacks[0].label, 'Success');
  assert.equal(calls[1].fallbacks[1].label, 'Storm');""",
    'mixed renderer physical semantic presentation assertions',
)

print('Clean physical renderer/theme migration applied.')
