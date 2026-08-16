import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, before, after, label) {
  const source = await readFile(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  await writeFile(path, source.replace(before, after));
}

async function replaceRegex(path, pattern, replacement, label) {
  const source = await readFile(path, 'utf8');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`${label}: expected one match, found ${matches.length}`);
  await writeFile(path, source.replace(pattern, replacement));
}

// ----- Theme schema: one coherent physical namespace, legacy top-level fields remain readable. -----
await replaceOnce(
  'packages/themes/src/index.ts',
  `export interface ThemeLabelDefinition {\n  color?: string;\n  glowColor?: string;\n  fontFamily?: string;\n  font?: ThemeAssetReference;\n  /** A 5x4 atlas containing physical outcome slots 1 through 20; cells may be numbers or icons. */\n  atlas?: ThemeAssetReference;\n  /** Optional die-specific outcome-slot atlas override, including arbitrary dN identifiers. */\n  atlases?: Partial<Record<ThemeDieType, ThemeAssetReference>>;\n}`,
  `export interface ThemeLabelStyleDefinition {\n  /** Main face-content color. */\n  color?: string;\n  /** Optional glow used around generated text and icons. */\n  glowColor?: string;\n  /** CSS font family used for generated text and icon glyphs. */\n  fontFamily?: string;\n  /** Outline color used for generated text and icon glyphs. */\n  outlineColor?: string;\n  /** Outline width relative to the generated glyph size. Defaults to 0.08. */\n  outlineWidth?: number;\n  /** Physical label-plane scale multiplier. Defaults to 1. */\n  scale?: number;\n}\n\n/**\n * Label atlas and typography settings supplied by a theme.\n *\n * @public\n */\nexport interface ThemeLabelDefinition extends ThemeLabelStyleDefinition {\n  font?: ThemeAssetReference;\n  /** A 5x4 atlas containing physical outcome slots 1 through 20; cells may be numbers or icons. */\n  atlas?: ThemeAssetReference;\n  /** Optional die-specific outcome-slot atlas override, including arbitrary dN identifiers. */\n  atlases?: Partial<Record<ThemeDieType, ThemeAssetReference>>;\n}\n\n/** Per-die label override inside the modern physical theme namespace. @public */\nexport interface ThemeDieLabelDefinition extends ThemeLabelStyleDefinition {\n  /** Optional die-specific atlas. */\n  atlas?: ThemeAssetReference;\n}`,
  'theme label style contract',
);

await replaceOnce(
  'packages/themes/src/index.ts',
  `export interface ThemePhysicsDefinition {\n  sizeScale?: number;\n  massScale?: number;\n  inertiaScale?: number;\n}`,
  `export interface ThemePhysicsDefinition {\n  sizeScale?: number;\n  massScale?: number;\n  inertiaScale?: number;\n}\n\n/** Visual content assigned to one physical outcome slot by a theme. @public */\nexport type ThemePhysicalFaceContent =\n  | { kind: 'number'; value: number; label?: string }\n  | { kind: 'text'; text: string }\n  | { kind: 'icon'; icon: string; label?: string }\n  | { kind: 'texture'; asset: ThemeAssetReference; label?: string };\n\n/** One-to-one physical outcome-slot presentation supplied by a theme. @public */\nexport interface ThemePhysicalPresentationDefinition {\n  contents: ThemePhysicalFaceContent[];\n}\n\n/** Independent per-die overrides in the modern physical theme model. @public */\nexport interface ThemePhysicalDieOverride {\n  material?: ThemeMaterialDefinition;\n  labels?: ThemeDieLabelDefinition;\n  mesh?: ThemeMeshDefinition;\n  physics?: ThemePhysicsDefinition;\n  presentation?: ThemePhysicalPresentationDefinition;\n}\n\n/**\n * Modern physical-die theme namespace.\n *\n * @remarks\n * Geometry, material, label styling, physics, and face content are independent. A theme may\n * override any subset for any canonical, generated, or custom die identifier.\n *\n * @public\n */\nexport interface ThemePhysicalDefinition {\n  material?: ThemeMaterialDefinition;\n  labels?: ThemeLabelDefinition;\n  physics?: ThemePhysicsDefinition;\n  dice?: Partial<Record<ThemeDieType, ThemePhysicalDieOverride>>;\n}`,
  'physical theme contract',
);

await replaceOnce(
  'packages/themes/src/index.ts',
  `  capabilities?: DiceThemeCapabilities;\n  material?: ThemeMaterialDefinition;\n  materials?: Partial<Record<ThemeDieType, ThemeMaterialDefinition>>;\n  labels?: ThemeLabelDefinition;\n  meshes?: Partial<Record<ThemeDieType, ThemeMeshDefinition>>;\n  audio?: ThemeAudioDefinition;\n  effects?: Partial<Record<ThemeEffectOutcome, ThemeEffectPreset>>;\n  physics?: ThemePhysicsDefinition & {\n    dice?: Partial<Record<ThemeDieType, ThemePhysicsDefinition>>;\n  };`,
  `  capabilities?: DiceThemeCapabilities;\n  /** Preferred physical-die theming API. */\n  physical?: ThemePhysicalDefinition;\n  /** @deprecated Use physical.material. */\n  material?: ThemeMaterialDefinition;\n  /** @deprecated Use physical.dice[die].material. */\n  materials?: Partial<Record<ThemeDieType, ThemeMaterialDefinition>>;\n  /** @deprecated Use physical.labels and physical.dice[die].labels. */\n  labels?: ThemeLabelDefinition;\n  /** @deprecated Use physical.dice[die].mesh. */\n  meshes?: Partial<Record<ThemeDieType, ThemeMeshDefinition>>;\n  audio?: ThemeAudioDefinition;\n  effects?: Partial<Record<ThemeEffectOutcome, ThemeEffectPreset>>;\n  /** @deprecated Use physical.physics and physical.dice[die].physics. */\n  physics?: ThemePhysicsDefinition & {\n    dice?: Partial<Record<ThemeDieType, ThemePhysicsDefinition>>;\n  };`,
  'dice theme physical namespace',
);

await replaceOnce(
  'packages/themes/src/index.ts',
  `  meshes?: boolean;\n  physics?: boolean;`,
  `  meshes?: boolean;\n  physics?: boolean;\n  /** Theme supplies semantic-agnostic physical face presentation. */\n  faceContent?: boolean;`,
  'theme capability face content',
);

await replaceOnce(
  'packages/themes/src/index.ts',
  `  validatePhysics(theme.physics, 'physics');\n  for (const [die, physics] of Object.entries(theme.physics?.dice ?? {}))\n    validatePhysics(physics, \`physics.dice.\${die}\`);\n  return theme;`,
  `  validatePhysics(theme.physics, 'physics');\n  for (const [die, physics] of Object.entries(theme.physics?.dice ?? {}))\n    validatePhysics(physics, \`physics.dice.\${die}\`);\n  validatePhysicalTheme(theme.physical);\n  return theme;`,
  'validate physical theme namespace',
);

await replaceOnce(
  'packages/themes/src/index.ts',
  `  for (const mesh of Object.values(theme.meshes ?? {})) if (mesh) add(mesh.asset);\n  add(theme.audio?.impact);`,
  `  for (const mesh of Object.values(theme.meshes ?? {})) if (mesh) add(mesh.asset);\n  add(theme.physical?.material?.surfaceTexture);\n  add(theme.physical?.material?.normalTexture);\n  add(theme.physical?.material?.roughnessTexture);\n  add(theme.physical?.labels?.font);\n  add(theme.physical?.labels?.atlas);\n  for (const atlas of Object.values(theme.physical?.labels?.atlases ?? {})) add(atlas);\n  for (const override of Object.values(theme.physical?.dice ?? {})) {\n    if (!override) continue;\n    add(override.material?.surfaceTexture);\n    add(override.material?.normalTexture);\n    add(override.material?.roughnessTexture);\n    add(override.labels?.atlas);\n    add(override.mesh?.asset);\n    for (const content of override.presentation?.contents ?? []) {\n      if (content.kind === 'texture') add(content.asset);\n    }\n  }\n  add(theme.audio?.impact);`,
  'physical theme asset references',
);

await replaceOnce(
  'packages/themes/src/index.ts',
  `  if (references.length > 128)\n    throw new InvalidThemeError('A theme may reference at most 128 assets');`,
  `  if (references.length > 512)\n    throw new InvalidThemeError('A theme may reference at most 512 assets');`,
  'theme physical asset reference limit',
);

await replaceOnce(
  'packages/themes/src/index.ts',
  `function validateLabels(labels: ThemeLabelDefinition | undefined): void {\n  if (!labels) return;\n  if (labels.fontFamily !== undefined) readText(labels.fontFamily, 'labels.fontFamily', 128);\n  validateAsset(labels.font, 'labels.font');\n  validateAsset(labels.atlas, 'labels.atlas');\n  for (const [die, atlas] of Object.entries(labels.atlases ?? {}))\n    validateAsset(atlas, \`labels.atlases.\${die}\`);\n}\n\nfunction validatePhysics`,
  `function validateLabelStyle(\n  labels: ThemeLabelStyleDefinition | undefined,\n  path: string,\n): void {\n  if (!labels) return;\n  if (labels.color !== undefined) readText(labels.color, \`\${path}.color\`, 128);\n  if (labels.glowColor !== undefined) readText(labels.glowColor, \`\${path}.glowColor\`, 128);\n  if (labels.fontFamily !== undefined) readText(labels.fontFamily, \`\${path}.fontFamily\`, 128);\n  if (labels.outlineColor !== undefined)\n    readText(labels.outlineColor, \`\${path}.outlineColor\`, 128);\n  validateRange(labels.outlineWidth, 0, 0.25, \`\${path}.outlineWidth\`);\n  validateRange(labels.scale, 0.25, 2, \`\${path}.scale\`);\n}\n\nfunction validateLabels(labels: ThemeLabelDefinition | undefined, path = 'labels'): void {\n  if (!labels) return;\n  validateLabelStyle(labels, path);\n  validateAsset(labels.font, \`\${path}.font\`);\n  validateAsset(labels.atlas, \`\${path}.atlas\`);\n  for (const [die, atlas] of Object.entries(labels.atlases ?? {}))\n    validateAsset(atlas, \`\${path}.atlases.\${die}\`);\n}\n\nfunction validateDieLabels(labels: ThemeDieLabelDefinition | undefined, path: string): void {\n  if (!labels) return;\n  validateLabelStyle(labels, path);\n  validateAsset(labels.atlas, \`\${path}.atlas\`);\n}\n\nfunction validatePhysicalPresentation(\n  presentation: ThemePhysicalPresentationDefinition | undefined,\n  path: string,\n): void {\n  if (!presentation) return;\n  if (!Array.isArray(presentation.contents) || presentation.contents.length === 0 || presentation.contents.length > 10_000) {\n    throw new InvalidThemeError('Physical presentation contents must contain 1 to 10000 entries', \`\${path}.contents\`);\n  }\n  presentation.contents.forEach((content, index) => {\n    const contentPath = \`\${path}.contents.\${index}\`;\n    if (!isRecord(content)) throw new InvalidThemeError('Physical face content must be an object', contentPath);\n    if (content.kind === 'number') {\n      if (typeof content.value !== 'number' || !Number.isFinite(content.value))\n        throw new InvalidThemeError('Physical number content requires a finite value', \`\${contentPath}.value\`);\n    } else if (content.kind === 'text') {\n      readText(content.text, \`\${contentPath}.text\`, 128);\n    } else if (content.kind === 'icon') {\n      readText(content.icon, \`\${contentPath}.icon\`, 128);\n    } else if (content.kind === 'texture') {\n      validateAsset(content.asset, \`\${contentPath}.asset\`);\n    } else {\n      throw new InvalidThemeError('Unsupported physical face content kind', \`\${contentPath}.kind\`);\n    }\n    if ('label' in content && content.label !== undefined)\n      readText(content.label, \`\${contentPath}.label\`, 128);\n  });\n}\n\nfunction validatePhysicalTheme(physical: ThemePhysicalDefinition | undefined): void {\n  if (!physical) return;\n  validateMaterial(physical.material, 'physical.material');\n  validateLabels(physical.labels, 'physical.labels');\n  validatePhysics(physical.physics, 'physical.physics');\n  for (const [die, override] of Object.entries(physical.dice ?? {})) {\n    if (!override) continue;\n    readIdentifier(die, \`physical.dice.\${die}\`);\n    const path = \`physical.dice.\${die}\`;\n    validateMaterial(override.material, \`\${path}.material\`);\n    validateDieLabels(override.labels, \`\${path}.labels\`);\n    if (override.mesh) {\n      validateAsset(override.mesh.asset, \`\${path}.mesh.asset\`);\n      validateRange(override.mesh.scale, 0.05, 20, \`\${path}.mesh.scale\`);\n      validateRange(override.mesh.maxVertices, 3, 250_000, \`\${path}.mesh.maxVertices\`);\n    }\n    validatePhysics(override.physics, \`\${path}.physics\`);\n    validatePhysicalPresentation(override.presentation, \`\${path}.presentation\`);\n  }\n}\n\nfunction validatePhysics`,
  'theme label and physical validators',
);

// ----- Runtime theme resolution: modern physical namespace takes precedence over legacy fields. -----
await replaceOnce(
  'src/runtime-themes.ts',
  `  decodeDiceTheme,\n  type DiceTheme,\n  type RuntimeThemeBundle,\n  type ThemeMaterialDefinition,\n  type ThemePhysicsDefinition,\n} from '../packages/themes/src/index';`,
  `  decodeDiceTheme,\n  listThemeAssetReferences,\n  type DiceTheme,\n  type RuntimeThemeBundle,\n  type ThemeLabelStyleDefinition,\n  type ThemeMaterialDefinition,\n  type ThemePhysicsDefinition,\n} from '../packages/themes/src/index';\nimport type {\n  PhysicalDieFaceContent,\n  PhysicalDiePresentation,\n} from '../packages/renderer/src/physical';`,
  'runtime theme imports',
);

await replaceOnce(
  'src/runtime-themes.ts',
  `  const manifest = runtimeThemes.get(themeId)?.manifest;\n  if (!manifest) return undefined;\n  return mergeMaterial(manifest.material, manifest.materials?.[kind]);`,
  `  const manifest = runtimeThemes.get(themeId)?.manifest;\n  if (!manifest) return undefined;\n  const legacy = mergeMaterial(manifest.material, manifest.materials?.[kind]);\n  const physical = mergeMaterial(legacy, manifest.physical?.material);\n  return mergeMaterial(physical, manifest.physical?.dice?.[kind]?.material);`,
  'runtime physical material precedence',
);

await replaceOnce(
  'src/runtime-themes.ts',
  `  if (slot === 'label') {\n    const reference = manifest.labels?.atlases?.[kind]?.src ?? manifest.labels?.atlas?.src;\n    return reference ? resources.textures.get(reference) : undefined;\n  }`,
  `  if (slot === 'label') {\n    const reference =\n      manifest.physical?.dice?.[kind]?.labels?.atlas?.src ??\n      manifest.physical?.labels?.atlases?.[kind]?.src ??\n      manifest.physical?.labels?.atlas?.src ??\n      manifest.labels?.atlases?.[kind]?.src ??\n      manifest.labels?.atlas?.src;\n    return reference ? resources.textures.get(reference) : undefined;\n  }`,
  'runtime physical label atlas precedence',
);

await replaceOnce(
  'src/runtime-themes.ts',
  `export function getRuntimeThemeFont(themeId: string): string | undefined {\n  return runtimeThemes.get(themeId)?.fontFamily;\n}\n\nexport function getRuntimeThemeMesh(\n  themeId: string,\n  kind: string,\n): THREE.BufferGeometry | undefined {\n  return runtimeThemes.get(themeId)?.meshes.get(kind);\n}\n\nexport function getRuntimeThemePhysics(\n  themeId: string,\n  kind: string,\n): ThemePhysicsDefinition | undefined {\n  const manifest = runtimeThemes.get(themeId)?.manifest;\n  if (!manifest?.physics) return undefined;\n  return {\n    sizeScale: manifest.physics.dice?.[kind]?.sizeScale ?? manifest.physics.sizeScale,\n    massScale: manifest.physics.dice?.[kind]?.massScale ?? manifest.physics.massScale,\n    inertiaScale: manifest.physics.dice?.[kind]?.inertiaScale ?? manifest.physics.inertiaScale,\n  };\n}`,
  `export function getRuntimeThemeFont(\n  themeId: string,\n  kind?: string,\n  fallbackKind?: string,\n): string | undefined {\n  const resources = runtimeThemes.get(themeId);\n  if (!resources) return undefined;\n  if (kind) {\n    const style = getRuntimeThemeLabelStyle(themeId, kind, fallbackKind);\n    if (style?.fontFamily) return style.fontFamily;\n  }\n  return resources.fontFamily;\n}\n\nexport function getRuntimeThemeLabelStyle(\n  themeId: string,\n  kind: string,\n  fallbackKind?: string,\n): ThemeLabelStyleDefinition | undefined {\n  const manifest = runtimeThemes.get(themeId)?.manifest;\n  if (!manifest) return undefined;\n  let style = mergeLabelStyle(undefined, manifest.labels);\n  style = mergeLabelStyle(style, manifest.physical?.labels);\n  if (fallbackKind && fallbackKind !== kind)\n    style = mergeLabelStyle(style, manifest.physical?.dice?.[fallbackKind]?.labels);\n  return mergeLabelStyle(style, manifest.physical?.dice?.[kind]?.labels);\n}\n\nexport function getRuntimeThemePresentation(\n  themeId: string,\n  kind: string,\n  fallbackKind?: string,\n): PhysicalDiePresentation | undefined {\n  const manifest = runtimeThemes.get(themeId)?.manifest;\n  if (!manifest) return undefined;\n  const source =\n    manifest.physical?.dice?.[kind]?.presentation ??\n    (fallbackKind ? manifest.physical?.dice?.[fallbackKind]?.presentation : undefined);\n  if (!source) return undefined;\n  const contents: PhysicalDieFaceContent[] = source.contents.map((content) => {\n    if (content.kind === 'number') return { ...content };\n    if (content.kind === 'text') return { ...content };\n    if (content.kind === 'icon') return { ...content };\n    return { kind: 'texture', asset: content.asset.src, label: content.label };\n  });\n  return { contents };\n}\n\nexport function getRuntimeThemeAssetTexture(\n  themeId: string,\n  reference: string,\n): THREE.Texture | undefined {\n  return runtimeThemes.get(themeId)?.textures.get(reference);\n}\n\nexport function getRuntimeThemeMesh(\n  themeId: string,\n  kind: string,\n): THREE.BufferGeometry | undefined {\n  return runtimeThemes.get(themeId)?.meshes.get(kind);\n}\n\nexport function getRuntimeThemePhysics(\n  themeId: string,\n  kind: string,\n): ThemePhysicsDefinition | undefined {\n  const manifest = runtimeThemes.get(themeId)?.manifest;\n  if (!manifest) return undefined;\n  const legacyDefault = manifest.physics;\n  const legacyOverride = manifest.physics?.dice?.[kind];\n  const modernDefault = manifest.physical?.physics;\n  const modernOverride = manifest.physical?.dice?.[kind]?.physics;\n  return mergePhysics(mergePhysics(mergePhysics(legacyDefault, legacyOverride), modernDefault), modernOverride);\n}`,
  'runtime physical presentation and style getters',
);

await replaceOnce(
  'src/runtime-themes.ts',
  `  const material = theme.material ?? {};\n  const labels = theme.labels ?? {};`,
  `  const material = mergeMaterial(theme.material, theme.physical?.material) ?? {};\n  const labels = mergeLabelStyle(theme.labels, theme.physical?.labels) ?? {};`,
  'runtime palette modern physical defaults',
);

await replaceOnce(
  'src/runtime-themes.ts',
  `      customModel: Object.keys(theme.meshes ?? {}).length > 0,`,
  `      customModel:\n        Object.keys(theme.meshes ?? {}).length > 0 ||\n        Object.values(theme.physical?.dice ?? {}).some((entry) => Boolean(entry?.mesh)),`,
  'runtime manifest custom model capability',
);

await replaceRegex(
  'src/runtime-themes.ts',
  /async function loadThemeTextures\([\s\S]*?\n}\n\nasync function loadThemeFont/,
  `async function loadThemeTextures(\n  bundle: RuntimeThemeBundle,\n  resources: RuntimeThemeResources,\n): Promise<void> {\n  for (const reference of listThemeAssetReferences(resources.manifest)) {\n    const asset = bundle.assets[reference.src];\n    if (!asset || !asset.mimeType.startsWith('image/')) continue;\n    try {\n      const texture = await loadTexture(asset.data, asset.mimeType);\n      resources.textures.set(reference.src, texture);\n    } catch {\n      // Invalid optional resources fall back to generated surfaces and labels.\n    }\n  }\n}\n\nasync function loadThemeFont`,
  'runtime theme image loading from manifest asset list',
);

await replaceOnce(
  'src/runtime-themes.ts',
  `  const font = resources.manifest.labels?.font;\n  const family = resources.manifest.labels?.fontFamily;`,
  `  const font = resources.manifest.physical?.labels?.font ?? resources.manifest.labels?.font;\n  const family =\n    resources.manifest.physical?.labels?.fontFamily ?? resources.manifest.labels?.fontFamily;`,
  'runtime physical font precedence',
);

await replaceRegex(
  'src/runtime-themes.ts',
  /async function loadThemeMeshes\([\s\S]*?\n}\n\nasync function loadTexture/,
  `async function loadThemeMeshes(\n  bundle: RuntimeThemeBundle,\n  resources: RuntimeThemeResources,\n): Promise<void> {\n  const definitions = new Map(Object.entries(resources.manifest.meshes ?? {}));\n  for (const [kind, override] of Object.entries(resources.manifest.physical?.dice ?? {})) {\n    if (override?.mesh) definitions.set(kind, override.mesh);\n  }\n  for (const [kind, definition] of definitions) {\n    if (!definition) continue;\n    const asset = bundle.assets[definition.asset.src];\n    if (!asset) continue;\n    try {\n      const geometry = await parseMesh(\n        asset.data,\n        asset.mimeType,\n        definition.maxVertices ?? 50_000,\n        definition.scale ?? 1,\n      );\n      resources.meshes.set(kind, geometry);\n    } catch {\n      // Standard/generated geometry remains the safe fallback.\n    }\n  }\n}\n\nasync function loadTexture`,
  'runtime physical mesh loading',
);

await replaceOnce(
  'src/runtime-themes.ts',
  `function mergeMaterial(\n  base?: ThemeMaterialDefinition,\n  override?: ThemeMaterialDefinition,\n): ThemeMaterialDefinition | undefined {\n  if (!base && !override) return undefined;\n  return { ...base, ...override };\n}\n\nfunction cloneAsset`,
  `function mergeMaterial(\n  base?: ThemeMaterialDefinition,\n  override?: ThemeMaterialDefinition,\n): ThemeMaterialDefinition | undefined {\n  if (!base && !override) return undefined;\n  return { ...base, ...override };\n}\n\nfunction mergeLabelStyle(\n  base?: ThemeLabelStyleDefinition,\n  override?: ThemeLabelStyleDefinition,\n): ThemeLabelStyleDefinition | undefined {\n  if (!base && !override) return undefined;\n  return {\n    color: override?.color ?? base?.color,\n    glowColor: override?.glowColor ?? base?.glowColor,\n    fontFamily: override?.fontFamily ?? base?.fontFamily,\n    outlineColor: override?.outlineColor ?? base?.outlineColor,\n    outlineWidth: override?.outlineWidth ?? base?.outlineWidth,\n    scale: override?.scale ?? base?.scale,\n  };\n}\n\nfunction mergePhysics(\n  base?: ThemePhysicsDefinition,\n  override?: ThemePhysicsDefinition,\n): ThemePhysicsDefinition | undefined {\n  if (!base && !override) return undefined;\n  return {\n    sizeScale: override?.sizeScale ?? base?.sizeScale,\n    massScale: override?.massScale ?? base?.massScale,\n    inertiaScale: override?.inertiaScale ?? base?.inertiaScale,\n  };\n}\n\nfunction cloneAsset`,
  'runtime theme merge helpers',
);

// ----- Physical presentation consumes theme face content before falling back to default numbering. -----
await replaceOnce(
  'src/physical-die-visuals.ts',
  `import { createPhysicalDieMesh, type PhysicalDieMesh } from './physical-die-mesh';\nimport type { PhysicalLaunchState } from './physical-launch';`,
  `import { createPhysicalDieMesh, type PhysicalDieMesh } from './physical-die-mesh';\nimport type { PhysicalLaunchState } from './physical-launch';\nimport { getRuntimeThemePresentation } from './runtime-themes';`,
  'physical visual runtime presentation import',
);

await replaceOnce(
  'src/physical-die-visuals.ts',
  `  }\n  return { presentation: createDefaultPhysicalDiePresentation(definition), explicit: false };\n}`,
  `  }\n  const themed = getRuntimeThemePresentation(spec.theme, spec.type, \`d\${definition.sides}\`);\n  if (themed && themed.contents.length === definition.outcomes.length) {\n    return {\n      presentation: createPhysicalDiePresentation(definition, themed.contents),\n      explicit: true,\n    };\n  }\n  return { presentation: createDefaultPhysicalDiePresentation(definition), explicit: false };\n}`,
  'physical visual theme presentation fallback',
);

// ----- Physical mesh: per-die label style + real texture face content. -----
await replaceOnce(
  'src/physical-die-mesh.ts',
  `  getRuntimeThemeFont,\n  getRuntimeThemeMaterial,\n  getRuntimeThemeMesh,\n  getRuntimeThemeTexture,\n} from './runtime-themes';`,
  `  getRuntimeThemeAssetTexture,\n  getRuntimeThemeFont,\n  getRuntimeThemeLabelStyle,\n  getRuntimeThemeMaterial,\n  getRuntimeThemeMesh,\n  getRuntimeThemeTexture,\n} from './runtime-themes';\nimport type { ThemeLabelStyleDefinition } from '../packages/themes/src/index';`,
  'physical mesh runtime theme style imports',
);

await replaceRegex(
  'src/physical-die-mesh.ts',
  /function presentationTexture\([\s\S]*?\n}\n\nfunction scaleThemeMesh/,
  `function presentationTexture(\n  spec: DraftrollFallbackVisual,\n  content: PhysicalDieFaceContent,\n  style: ThemeLabelStyleDefinition | undefined,\n  fontFamily: string | undefined,\n): THREE.Texture {\n  if (content.kind === 'texture') {\n    const themed = getRuntimeThemeAssetTexture(spec.theme, content.asset);\n    if (themed) {\n      const texture = themed.clone();\n      texture.needsUpdate = true;\n      return texture;\n    }\n  }\n  const canvas = document.createElement('canvas');\n  canvas.width = 256;\n  canvas.height = 256;\n  const context = canvas.getContext('2d');\n  if (!context) throw new Error('Canvas 2D context unavailable.');\n  const palette = THEMES[normalizeTheme(spec.theme)];\n  const text =\n    content.kind === 'number'\n      ? (content.label ?? String(content.value))\n      : content.kind === 'text'\n        ? content.text\n        : content.kind === 'icon'\n          ? content.icon\n          : (content.label ?? '◆');\n  const length = Array.from(text).length;\n  const fontSize = content.kind === 'icon' ? 148 : length >= 5 ? 64 : length >= 3 ? 86 : 132;\n  context.textAlign = 'center';\n  context.textBaseline = 'middle';\n  context.lineJoin = 'round';\n  context.font = \`800 \${fontSize}px \${fontFamily ?? 'system-ui, sans-serif'}\`;\n  context.lineWidth = Math.max(1, Math.round(fontSize * (style?.outlineWidth ?? 0.08)));\n  context.strokeStyle = style?.outlineColor ?? 'rgba(0,0,0,.72)';\n  if (style?.glowColor) {\n    context.shadowColor = style.glowColor;\n    context.shadowBlur = Math.max(4, Math.round(fontSize * 0.08));\n  }\n  context.strokeText(text, 128, 126);\n  context.fillStyle = style?.color ?? palette.label;\n  context.fillText(text, 128, 126);\n  context.shadowBlur = 0;\n  if (content.kind === 'number' && (text === '6' || text === '9')) {\n    context.strokeStyle = style?.color ?? palette.label;\n    context.lineWidth = 8;\n    context.beginPath();\n    context.moveTo(93, 202);\n    context.lineTo(163, 202);\n    context.stroke();\n  }\n  const texture = new THREE.CanvasTexture(canvas);\n  texture.colorSpace = THREE.SRGBColorSpace;\n  texture.anisotropy = 8;\n  return texture;\n}\n\nfunction scaleThemeMesh`,
  'physical mesh semantic presentation texture',
);

await replaceOnce(
  'src/physical-die-mesh.ts',
  `  const runtimeAtlas =\n    getRuntimeThemeTexture(spec.theme, spec.type, 'label') ??\n    getRuntimeThemeTexture(spec.theme, \`d\${definition.sides}\`, 'label');\n  const labelMaps = definition.outcomes.map((outcome, index): THREE.Texture | null => {`,
  `  const fallbackKind = \`d\${definition.sides}\`;\n  const runtimeAtlas =\n    getRuntimeThemeTexture(spec.theme, spec.type, 'label') ??\n    getRuntimeThemeTexture(spec.theme, fallbackKind, 'label');\n  const labelStyle = getRuntimeThemeLabelStyle(spec.theme, spec.type, fallbackKind);\n  const labelScale = labelStyle?.scale ?? 1;\n  const fontFamily = getRuntimeThemeFont(spec.theme, spec.type, fallbackKind);\n  const labelMaps = definition.outcomes.map((outcome, index): THREE.Texture | null => {`,
  'physical mesh label theme resolution',
);

await replaceOnce(
  'src/physical-die-mesh.ts',
  `    const texture = presentationTexture(spec, content);`,
  `    const texture = presentationTexture(spec, content, labelStyle, fontFamily);`,
  'physical mesh presentation texture invocation',
);

await replaceOnce(
  'src/physical-die-mesh.ts',
  `      const labelGeometry = new THREE.PlaneGeometry(anchor.scale, anchor.scale);`,
  `      const labelGeometry = new THREE.PlaneGeometry(\n        anchor.scale * labelScale,\n        anchor.scale * labelScale,\n      );`,
  'physical mesh primary label scale',
);

await replaceOnce(
  'src/physical-die-mesh.ts',
  `    const labelGeometry = new THREE.PlaneGeometry(anchor.scale, anchor.scale);`,
  `    const labelGeometry = new THREE.PlaneGeometry(\n      anchor.scale * labelScale,\n      anchor.scale * labelScale,\n    );`,
  'physical mesh secondary label scale',
);

// ----- Renderer public boundary: modern renderer emits only physical[] plus true fallbacks. -----
await replaceOnce(
  'packages/renderer/src/index.ts',
  `export type DraftrollFallbackKind = 'coin' | 'percentile' | 'fate' | 'spinner' | 'token' | 'card';`,
  `export type DraftrollFallbackKind = 'coin' | 'percentile' | 'fate' | 'token' | 'card';\n/**\n * Legacy fallback kinds accepted by the browser compatibility adapter.\n *\n * @deprecated Numeric dN values should be sent as DraftrollPhysicalVisual.\n * @public\n */\nexport type DraftrollLegacyFallbackKind = DraftrollFallbackKind | 'spinner';`,
  'renderer modern fallback kind',
);

await replaceOnce(
  'packages/renderer/src/index.ts',
  `  kind: DraftrollFallbackKind;`,
  `  kind: DraftrollLegacyFallbackKind;`,
  'fallback visual compatibility kind',
);

await replaceOnce(
  'packages/renderer/src/index.ts',
  `          /** First-class physical dice. New integrations should use this instead of legacy parallel arrays. */\n          physical?: DraftrollPhysicalVisual[];\n          /** @deprecated Legacy canonical-only physical results. */\n          results?: number[] | number;\n          outcomes?: DraftrollEffectOutcome[] | DraftrollEffectOutcome;\n          themes?: string[] | string;\n          /** Physical die type for each physical result. A single value is repeated. */\n          kinds?: DraftrollDieKind[] | DraftrollDieKind;`,
  `          /** First-class physical dice. This is the sole modern physical-roll input. */\n          physical?: DraftrollPhysicalVisual[];\n          /** @deprecated Legacy canonical-only physical results. Use physical. */\n          results?: number[] | number;\n          /** @deprecated Legacy array aligned with results. Put outcome on each physical entry. */\n          outcomes?: DraftrollEffectOutcome[] | DraftrollEffectOutcome;\n          /** @deprecated Legacy array aligned with results. Put theme on each physical entry. */\n          themes?: string[] | string;\n          /** @deprecated Legacy canonical die types. Put canonicalKind on each physical entry. */\n          kinds?: DraftrollDieKind[] | DraftrollDieKind;`,
  'bridge modern physical docs',
);

await replaceOnce(
  'packages/renderer/src/index.ts',
  `          /** Per-physical-die size, mass, and inertia overrides aligned with results/kinds. */\n          physics?: DicePhysicsProperties[];`,
  `          /** @deprecated Legacy array aligned with results/kinds. Put physics on each physical entry. */\n          physics?: DicePhysicsProperties[];`,
  'bridge legacy physics docs',
);

await replaceOnce(
  'packages/renderer/src/index.ts',
  `    const physical: DraftrollPhysicalVisual[] = [];\n    // Deprecated canonical arrays remain populated for older custom bridges. Built-in Draftroll\n    // treats physical[] as authoritative and ignores these when the new field is present.\n    const numericResults: number[] = [];\n    const physicalKinds: DraftrollDieKind[] = [];\n    const themes: string[] = [];\n    const outcomes: DraftrollEffectOutcome[] = [];\n    const physics: DicePhysicsProperties[] = [];\n    const fallbacks: DraftrollFallbackVisual[] = [];`,
  `    const physical: DraftrollPhysicalVisual[] = [];\n    const fallbacks: DraftrollFallbackVisual[] = [];`,
  'remove renderer legacy batch arrays',
);

await replaceOnce(
  'packages/renderer/src/index.ts',
  `      entry.physical.forEach((visual) => {\n        physical.push(clonePreparedPhysicalVisual(visual));\n        if (visual.canonicalKind) {\n          numericResults.push(visual.outcomeIndex + 1);\n          physicalKinds.push(visual.canonicalKind);\n          themes.push(visual.theme);\n          outcomes.push(visual.outcome);\n          physics.push({ ...visual.physics });\n        }\n      });`,
  `      entry.physical.forEach((visual) => {\n        physical.push(clonePreparedPhysicalVisual(visual));\n      });`,
  'renderer batch physical only',
);

await replaceOnce(
  'packages/renderer/src/index.ts',
  `      physical,\n      results: numericResults,\n      outcomes,\n      themes,\n      kinds: physicalKinds,\n      physics,\n      physicsPreset: entries[0].options.physicsPreset,`,
  `      physical,\n      physicsPreset: entries[0].options.physicsPreset,`,
  'renderer bridge physical-only request',
);

await replaceOnce(
  'packages/renderer/src/index.ts',
  `): DraftrollFallbackKind {`,
  `): DraftrollLegacyFallbackKind {`,
  'normalize fallback compatibility return type',
);

await replaceOnce(
  'packages/renderer/src/index.ts',
  `  kind: DraftrollFallbackKind,\n): string {`,
  `  kind: DraftrollLegacyFallbackKind,\n): string {`,
  'fallback display title compatibility type',
);

await replaceOnce(
  'packages/renderer/src/index.ts',
  `function readDisplayLabel(die: NormalizedDieResult, kind: DraftrollFallbackKind): string {`,
  `function readDisplayLabel(die: NormalizedDieResult, kind: DraftrollLegacyFallbackKind): string {`,
  'fallback display label compatibility type',
);

// Browser preview also exercises the modern physical contract instead of the deprecated parallel arrays.
await replaceOnce(
  'src/main.ts',
  `    return window.draftrollDice.roll({\n      results: [value],\n      kinds: [requestedKind],\n      themes: [selectedTheme],\n      context: { preview: true },\n    });`,
  `    const sides = maximumDieValue(requestedKind);\n    const type = requestedKind === 'coin' ? 'd2' : requestedKind;\n    return window.draftrollDice.roll({\n      physical: [\n        {\n          id: 'preview-die',\n          type,\n          sides,\n          outcomeIndex: THREE.MathUtils.clamp(Math.round(value), 1, sides) - 1,\n          result: value,\n          numericValue: value,\n          canonicalKind: requestedKind,\n          title: type,\n          label: String(value),\n          theme: selectedTheme,\n          outcome: 'neutral',\n        },\n      ],\n      visualOrder: [{ kind: 'physical', index: 0, dieId: 'preview-die' }],\n      context: { preview: true },\n    });`,
  'browser preview modern physical input',
);

// ----- Regression coverage -----
await replaceOnce(
  'scripts/test-runtime-themes.mjs',
  `    material: {\n      color: '#17131f',\n      roughness: 0.44,\n      metalness: 0.3,\n      surfaceTexture: { src: 'assets/obsidian.webp', mimeType: 'image/webp' },\n    },\n    labels: {\n      color: '#ffffff',\n      atlas: { src: 'assets/labels.png', mimeType: 'image/png' },\n    },`,
  `    physical: {\n      material: {\n        color: '#17131f',\n        roughness: 0.44,\n        metalness: 0.3,\n        surfaceTexture: { src: 'assets/obsidian.webp', mimeType: 'image/webp' },\n      },\n      labels: {\n        color: '#ffffff',\n        outlineColor: '#110d18',\n        outlineWidth: 0.06,\n        scale: 0.92,\n      },\n      dice: {\n        d20: {\n          labels: { atlas: { src: 'assets/labels.png', mimeType: 'image/png' } },\n          presentation: {\n            contents: Array.from({ length: 20 }, (_entry, index) =>\n              index === 19\n                ? { kind: 'icon', icon: '★', label: 'critical' }\n                : { kind: 'number', value: index + 1 },\n            ),\n          },\n        },\n      },\n    },`,
  'runtime theme modern physical manifest fixture',
);

await replaceOnce(
  'scripts/test-runtime-themes.mjs',
  `      return { results: request.results ?? [], total: 12, replay: null };`,
  `      return { results: request.physical?.map((entry) => entry.result) ?? [], total: 12, replay: null };`,
  'runtime theme bridge physical completion fixture',
);

await replaceOnce(
  'scripts/test-runtime-themes.mjs',
  `  assert.deepEqual(bridgeCalls.find(([name]) => name === 'roll')[1].themes, [manifest.id]);`,
  `  const rollRequest = bridgeCalls.find(([name]) => name === 'roll')[1];\n  assert.equal(rollRequest.results, undefined, 'modern renderer must not emit legacy results');\n  assert.equal(rollRequest.kinds, undefined, 'modern renderer must not emit legacy kinds');\n  assert.equal(rollRequest.themes, undefined, 'modern renderer must not emit legacy themes');\n  assert.equal(rollRequest.physics, undefined, 'modern renderer must not emit legacy physics arrays');\n  assert.equal(rollRequest.physical.length, 1);\n  assert.equal(rollRequest.physical[0].theme, manifest.id);`,
  'runtime theme physical-only bridge assertion',
);

await replaceOnce(
  'scripts/test-visual-fallbacks.mjs',
  `  readFile(new URL('../packages/renderer/src/physical.ts', import.meta.url), 'utf8'),`,
  `  readFile(new URL('../packages/renderer/src/physical.ts', import.meta.url), 'utf8'),`,
  'visual fallback physical contract stable anchor',
);

await replaceOnce(
  'scripts/test-visual-fallbacks.mjs',
  `for (const kind of ['coin', 'percentile', 'fate', 'spinner', 'token', 'card']) {\n  assert.match(\n    renderer,\n    new RegExp(\`['\"]\${kind}['\"]\`),\n    \`renderer fallback kind \${kind} is missing\`,\n  );\n}\nassert.match(renderer, /DraftrollFallbackVisual/);`,
  `for (const kind of ['coin', 'percentile', 'fate', 'token', 'card']) {\n  assert.match(\n    renderer,\n    new RegExp(\`['\"]\${kind}['\"]\`),\n    \`renderer fallback kind \${kind} is missing\`,\n  );\n}\nassert.match(renderer, /DraftrollLegacyFallbackKind = DraftrollFallbackKind \\| 'spinner'/);\nassert.match(renderer, /DraftrollFallbackVisual/);`,
  'visual fallback modern kind assertions',
);

await replaceOnce(
  'scripts/test-visual-fallbacks.mjs',
  `assert.match(renderer, /physical\\?: DraftrollPhysicalVisual\\[\\]/);`,
  `assert.match(renderer, /physical\\?: DraftrollPhysicalVisual\\[\\]/);\nassert.doesNotMatch(renderer, /physical,\\s*results: numericResults/);\nassert.match(renderer, /sole modern physical-roll input/);`,
  'visual fallback physical-only renderer assertions',
);

await replaceOnce(
  'scripts/test-visual-fallbacks.mjs',
  `assert.match(physicalMesh, /getRuntimeThemeMesh/);`,
  `assert.match(physicalMesh, /getRuntimeThemeMesh/);\nassert.match(physicalMesh, /getRuntimeThemeLabelStyle/);\nassert.match(physicalMesh, /getRuntimeThemeAssetTexture/);\nassert.match(physicalVisuals, /getRuntimeThemePresentation/);`,
  'visual fallback physical theme API assertions',
);

console.log('Physical renderer/theme API migration applied.');
