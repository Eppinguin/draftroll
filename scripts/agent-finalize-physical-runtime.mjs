import { readFile, writeFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const write = (path, value) => writeFile(path, value);

function replaceOnce(source, search, replacement, label) {
  const matches = typeof search === 'string' ? source.split(search).length - 1 : [...source.matchAll(new RegExp(search.source, search.flags.includes('g') ? search.flags : `${search.flags}g`))].length;
  if (matches !== 1) throw new Error(`${label}: expected one match, found ${matches}`);
  return source.replace(search, replacement);
}

function replaceAllExact(source, search, replacement, expected, label) {
  const count = source.split(search).length - 1;
  if (count !== expected) throw new Error(`${label}: expected ${expected} matches, found ${count}`);
  return source.split(search).join(replacement);
}

// Public serializable physical definition cloning.
{
  const path = 'packages/renderer/src/physical.ts';
  let source = await read(path);
  if (!source.includes('export function clonePhysicalDieDefinition')) {
    source += `

function cloneDefinitionVertex(value: PolyhedronVertex): PolyhedronVertex {
  return [value[0], value[1], value[2]];
}

function cloneDefinitionAnchor(anchor: PolyhedronLabelAnchor): PolyhedronLabelAnchor {
  return {
    ...anchor,
    position: cloneDefinitionVertex(anchor.position),
    normal: cloneDefinitionVertex(anchor.normal),
    up: cloneDefinitionVertex(anchor.up),
  };
}

function cloneReadablePolyhedron(shape: ReadablePolyhedron): ReadablePolyhedron {
  return {
    ...shape,
    vertices: shape.vertices.map(cloneDefinitionVertex),
    faces: shape.faces.map((face) => face.slice()),
    landingFaces: shape.landingFaces.slice(),
    faceKinds: shape.faceKinds?.slice(),
    outcomes: shape.outcomes.map((outcome) => ({
      ...outcome,
      settledUp: cloneDefinitionVertex(outcome.settledUp),
      labels: outcome.labels.map(cloneDefinitionAnchor),
    })),
  };
}

/**
 * Deep-clones a serializable physical die definition for replay and bridge ownership boundaries.
 *
 * @public
 */
export function clonePhysicalDieDefinition(definition: PhysicalDieDefinition): PhysicalDieDefinition {
  const collider: SerializedPhysicalCollider =
    definition.collider.kind === 'box'
      ? { kind: 'box', halfExtents: cloneDefinitionVertex(definition.collider.halfExtents) }
      : definition.collider.kind === 'cylinder'
        ? { ...definition.collider }
        : {
            kind: 'convex',
            vertices: definition.collider.vertices.map(cloneDefinitionVertex),
            faces: definition.collider.faces.map((face) => face.slice()),
          };
  return {
    ...definition,
    collider,
    outcomes: definition.outcomes.map((outcome) => ({
      ...outcome,
      supportNormals: outcome.supportNormals.map(cloneDefinitionVertex),
      labelAnchors: outcome.labelAnchors.map(cloneDefinitionAnchor),
    })),
    readableShape: definition.readableShape
      ? cloneReadablePolyhedron(definition.readableShape)
      : undefined,
  };
}
`;
  }
  await write(path, source);
}

// Public renderer model: custom physical models can be supplied per die/type and survive replay.
{
  const path = 'packages/renderer/src/index.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `} from './physical';\nimport type { PhysicalDieFaceContent, PhysicalDiePresentation } from './physical';`,
    `} from './physical';\nexport { clonePhysicalDieDefinition } from './physical';\nimport {\n  clonePhysicalDieDefinition,\n  type PhysicalDieDefinition,\n  type PhysicalDieFaceContent,\n  type PhysicalDieModel,\n  type PhysicalDiePresentation,\n} from './physical';`,
    'renderer physical imports',
  );
  source = replaceOnce(
    source,
    `  /** Canonical optimized geometry when available; otherwise generated geometry is used. */\n  canonicalKind?: DraftrollDieKind;`,
    `  /** Canonical optimized geometry when available; otherwise generated/custom geometry is used. */\n  canonicalKind?: DraftrollDieKind;\n  /** Explicit geometry/support definition for a host-supplied physical model. */\n  definition?: PhysicalDieDefinition;`,
    'physical visual definition field',
  );
  source = replaceOnce(
    source,
    `  defaultThemeId?: string;\n  /** Render only these normalized die IDs while retaining the full roll context. */`,
    `  defaultThemeId?: string;\n  /**\n   * Optional host-supplied physical models keyed by die ID, custom-die ID, die type, or dN.\n   * A model overrides generated/canonical geometry for the matching rendered die without changing\n   * the authoritative normalized result.\n   */\n  physicalModels?: Readonly<Record<string, PhysicalDieModel>>;\n  /** Render only these normalized die IDs while retaining the full roll context. */`,
    'renderer physical models option',
  );
  source = replaceOnce(
    source,
    `    canonicalKind: visual.canonicalKind,\n    title: visual.title,`,
    `    canonicalKind: visual.canonicalKind,\n    definition: visual.definition ? clonePhysicalDieDefinition(visual.definition) : undefined,\n    title: visual.title,`,
    'clone prepared definition',
  );
  source = replaceOnce(
    source,
    `      const definition = definitions.get(die.customDiceId ?? '');\n      const physicalSlot = resolvePhysicalSlot(die, definition);`,
    `      const definition = definitions.get(die.customDiceId ?? '');\n      const physicalModel = resolvePhysicalModel(options.physicalModels, die);\n      const physicalSlot = physicalModel\n        ? resolvePhysicalModelSlot(die, physicalModel)\n        : resolvePhysicalSlot(die, definition);\n      if (physicalModel && !physicalSlot) {\n        throw new UnsupportedRollError(\n          \`Physical model \${physicalModel.definition.id} cannot map result for die \${die.id}\`,\n          result,\n        );\n      }`,
    'resolve physical model',
  );
  source = replaceOnce(
    source,
    `          canonicalKind: physicalSlot.kind ?? undefined,\n          title: readPhysicalTitle(die, definition, physicalSlot.sides),`,
    `          canonicalKind: physicalModel ? undefined : (physicalSlot.kind ?? undefined),\n          definition: physicalModel\n            ? clonePhysicalDieDefinition(physicalModel.definition)\n            : undefined,\n          title: readPhysicalTitle(\n            die,\n            definition,\n            physicalSlot.sides,\n            physicalModel?.definition.id,\n          ),`,
    'physical model visual fields',
  );
  source = replaceOnce(
    source,
    `          presentation: definition\n            ? createCustomPhysicalPresentation(definition, physicalSlot.sides)\n            : intrinsicPhysicalPresentation(die, physicalSlot.sides),`,
    `          presentation: physicalModel\n            ? { contents: physicalModel.presentation.contents.map((content) => ({ ...content })) }\n            : definition\n              ? createCustomPhysicalPresentation(definition, physicalSlot.sides)\n              : intrinsicPhysicalPresentation(die, physicalSlot.sides),`,
    'physical model presentation',
  );
  source = replaceOnce(
    source,
    `function intrinsicPhysicalPresentation(`,
    `function resolvePhysicalModel(\n  models: RendererPlayOptions['physicalModels'],\n  die: NormalizedDieResult,\n): PhysicalDieModel | undefined {\n  if (!models) return undefined;\n  const candidates = [\n    die.id,\n    die.customDiceId,\n    die.type,\n    Number.isSafeInteger(die.sides) ? \`d\${die.sides}\` : undefined,\n  ];\n  for (const key of candidates) {\n    if (!key) continue;\n    const model = models[key];\n    if (model) return model;\n  }\n  return undefined;\n}\n\nfunction resolvePhysicalModelSlot(\n  die: NormalizedDieResult,\n  model: PhysicalDieModel,\n): ResolvedPhysicalSlot | null {\n  const definition = model.definition;\n  if (\n    !definition.id.trim() ||\n    !Number.isSafeInteger(definition.sides) ||\n    definition.sides < 1 ||\n    definition.sides > 10_000 ||\n    definition.outcomes.length !== definition.sides ||\n    model.presentation.contents.length !== definition.sides\n  ) {\n    return null;\n  }\n  if (die.faceIndex !== undefined && Number.isInteger(die.faceIndex)) {\n    const faceIndex = die.faceIndex;\n    if (faceIndex >= 0 && faceIndex < definition.sides) {\n      return { kind: null, sides: definition.sides, outcomeIndex: faceIndex };\n    }\n  }\n  const numeric = die.numericValue ?? (typeof die.result === 'number' ? die.result : Number.NaN);\n  const matches = definition.outcomes.filter((outcome) => {\n    const semantic = outcome.result ?? outcome.value;\n    if (semantic !== die.result) return false;\n    return outcome.numericValue === undefined || !Number.isFinite(numeric) || outcome.numericValue === numeric;\n  });\n  if (matches.length === 1) {\n    return { kind: null, sides: definition.sides, outcomeIndex: matches[0].index };\n  }\n  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= definition.sides) {\n    return { kind: null, sides: definition.sides, outcomeIndex: numeric - 1 };\n  }\n  return null;\n}\n\nfunction intrinsicPhysicalPresentation(`,
    'physical model helpers',
  );
  source = replaceOnce(
    source,
    `function readPhysicalTitle(\n  die: NormalizedDieResult,\n  definition: CustomDiceDefinition | undefined,\n  sides: number,\n): string {`,
    `function readPhysicalTitle(\n  die: NormalizedDieResult,\n  definition: CustomDiceDefinition | undefined,\n  sides: number,\n  physicalModelId?: string,\n): string {`,
    'physical title signature',
  );
  source = replaceOnce(
    source,
    `  return metadataLabel ?? definitionLabel ?? (definition?.id || \`d\${sides}\`);`,
    `  return metadataLabel ?? definitionLabel ?? physicalModelId ?? (definition?.id || \`d\${sides}\`);`,
    'physical title model id',
  );
  await write(path, source);
}

// First-class arbitrary/custom visual instances and ID lookup.
{
  const path = 'src/physical-die-visuals.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `import type { DraftrollPhysicalVisual } from '../packages/renderer/src/index';`,
    `import type { DraftrollPhysicalVisual } from '../packages/renderer/src/index';\nimport { clonePhysicalDieDefinition } from '../packages/renderer/src/physical';`,
    'visual definition clone import',
  );
  source = replaceOnce(
    source,
    `  private readonly labelMaterials: THREE.MeshBasicMaterial[];\n  private readonly originalLabelMaps: Array<THREE.Texture | null>;\n  private readonly requestedOutcome: number;`,
    `  private readonly requestedOutcome: number;`,
    'remove per-face label resources',
  );
  source = replaceOnce(
    source,
    `  private activationDelay = 0;`,
    `  private activationDelay = 0;\n  private landedOutcome: number | null = null;`,
    'landed outcome state',
  );
  source = replaceOnce(
    source,
    `    if (!Number.isSafeInteger(spec.sides) || spec.sides < 1 || spec.sides > 256) {\n      throw new Error(\`Physical die requires 1 to 256 exact outcome slots: \${spec.type}\`);\n    }`,
    `    const maximumSides = spec.definition ? 10_000 : 256;\n    if (!Number.isSafeInteger(spec.sides) || spec.sides < 1 || spec.sides > maximumSides) {\n      throw new Error(\`Physical die requires 1 to \${maximumSides} outcome slots: \${spec.type}\`);\n    }`,
    'custom visual side budget',
  );
  source = replaceOnce(
    source,
    `    this.sides = spec.sides;\n    this.definition = createGeneratedPhysicalDieDefinition(spec.sides);`,
    `    this.sides = spec.sides;\n    this.definition = spec.definition\n      ? clonePhysicalDieDefinition(spec.definition)\n      : createGeneratedPhysicalDieDefinition(spec.sides);\n    if (\n      this.definition.sides !== spec.sides ||\n      this.definition.outcomes.length !== spec.sides\n    ) {\n      throw new Error(\`Physical definition does not match descriptor: \${spec.id}\`);\n    }`,
    'custom physical definition selection',
  );
  source = replaceOnce(
    source,
    `    this.inner = this.mesh.visualRoot;\n    this.labelMaterials = this.mesh.labelMaterials;\n    this.originalLabelMaps = this.mesh.labelMaps.slice();`,
    `    this.inner = this.mesh.visualRoot;`,
    'remove old label maps',
  );
  source = replaceOnce(
    source,
    `    if (requested === landing) return;\n    const requestedMap = this.originalLabelMaps[requested] ?? null;\n    const landingMap = this.originalLabelMaps[landing] ?? null;\n    const requestedMaterial = this.labelMaterials[requested];\n    const landingMaterial = this.labelMaterials[landing];\n    if (requestedMaterial) {\n      requestedMaterial.map = landingMap;\n      requestedMaterial.needsUpdate = true;\n    }\n    if (landingMaterial) {\n      landingMaterial.map = requestedMap;\n      landingMaterial.needsUpdate = true;\n    }`,
    `    if (requested === landing) return;\n    this.mesh.swapOutcomeLabels(requested, landing);`,
    'atlas relabel operation',
  );
  source = replaceOnce(
    source,
    `    const newlyIntroduced = this.needsPlanning;\n    if (newlyIntroduced) this.applyRequestedResult(landed);`,
    `    const newlyIntroduced = this.needsPlanning;\n    this.landedOutcome = landed;\n    if (newlyIntroduced) this.applyRequestedResult(landed);`,
    'remember landed outcome',
  );
  source = replaceOnce(
    source,
    `  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {`,
    `  get targetingMode(): PhysicalDieDefinition['targeting'] {\n    return this.definition.targeting;\n  }\n\n  get landedOutcomeIndex(): number | null {\n    return this.landedOutcome;\n  }\n\n  get displayedOutcomeIndex(): number {\n    return this.requestedOutcome;\n  }\n\n  getVisualRadius(): number {\n    return this.definition.radius;\n  }\n\n  moveTo(position: THREE.Vector3): void {\n    this.group.position.copy(position);\n    this.mesh.updateShadow(this.group.position.y, 1);\n  }\n\n  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {`,
    'visual interaction helpers',
  );
  source = replaceOnce(
    source,
    `export function getPendingPhysicalLaunchParticipants(): PendingPhysicalLaunchParticipant[] {`,
    `export function getPhysicalVisualInstance(id: string): PhysicalDieVisualInstance | undefined {\n  return activePhysicalDice.get(id);\n}\n\nexport function getPendingPhysicalLaunchParticipants(): PendingPhysicalLaunchParticipant[] {`,
    'physical visual lookup export',
  );
  await write(path, source);
}

// Batched label atlas, shared material, collider-based custom geometry.
{
  const path = 'src/physical-die-mesh.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `export interface PhysicalDieMesh {\n  group: THREE.Group;\n  visualRoot: THREE.Group;\n  labelMaterials: THREE.MeshBasicMaterial[];\n  labelMaps: Array<THREE.Texture | null>;\n  setOpacity(opacity: number): void;`,
    `export interface PhysicalDieMesh {\n  group: THREE.Group;\n  visualRoot: THREE.Group;\n  swapOutcomeLabels(first: number, second: number): void;\n  setOpacity(opacity: number): void;`,
    'mesh interface atlas relabel',
  );
  source = replaceOnce(
    source,
    `let shadowTexture: THREE.CanvasTexture | null = null;`,
    `let shadowTexture: THREE.CanvasTexture | null = null;\nconst surfaceTextureCache = new Map<string, { texture: THREE.CanvasTexture; refs: number }>();\nconst labelAtlasCache = new Map<\n  string,\n  { texture: THREE.CanvasTexture; refs: number; columns: number; rows: number }\n>();`,
    'mesh resource caches',
  );
  source = replaceOnce(
    source,
    `function triangulateShape(shape: ReadablePolyhedron): THREE.BufferGeometry {`,
    `function acquireSurfaceTexture(spec: DraftrollPhysicalVisual): {\n  texture: THREE.CanvasTexture;\n  release(): void;\n} {\n  const key = normalizeTheme(spec.theme);\n  let cached = surfaceTextureCache.get(key);\n  if (!cached) {\n    cached = { texture: createSurfaceTexture(spec), refs: 0 };\n    surfaceTextureCache.set(key, cached);\n  }\n  cached.refs += 1;\n  return {\n    texture: cached.texture,\n    release(): void {\n      const current = surfaceTextureCache.get(key);\n      if (!current) return;\n      current.refs -= 1;\n      if (current.refs <= 0) {\n        current.texture.dispose();\n        surfaceTextureCache.delete(key);\n      }\n    },\n  };\n}\n\nfunction triangulateShape(shape: ReadablePolyhedron): THREE.BufferGeometry {`,
    'surface texture cache helper',
  );
  source = replaceOnce(
    source,
    /function atlasCellTexture\([\s\S]*?\nfunction scaleThemeMesh\(/,
    `interface LabelAtlasResource {\n  texture: THREE.Texture;\n  columns: number;\n  rows: number;\n  cells: number[];\n  padding: number;\n  release(): void;\n}\n\nfunction drawLabelContent(\n  context: CanvasRenderingContext2D,\n  x: number,\n  y: number,\n  size: number,\n  spec: DraftrollPhysicalVisual,\n  content: PhysicalDieFaceContent,\n  style: ThemeLabelStyleDefinition | undefined,\n  fontFamily: string | undefined,\n): void {\n  if (content.kind === 'texture') {\n    const sourceTexture = getRuntimeThemeAssetTexture(spec.theme, content.asset);\n    const image = sourceTexture?.image;\n    const drawable =\n      image instanceof HTMLImageElement ||\n      image instanceof HTMLCanvasElement ||\n      image instanceof HTMLVideoElement ||\n      (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap);\n    if (drawable) {\n      const inset = Math.max(2, Math.round(size * 0.08));\n      context.drawImage(image, x + inset, y + inset, size - inset * 2, size - inset * 2);\n      return;\n    }\n  }\n  const palette = THEMES[normalizeTheme(spec.theme)];\n  const text =\n    content.kind === 'number'\n      ? (content.label ?? String(content.value))\n      : content.kind === 'text'\n        ? content.text\n        : content.kind === 'icon'\n          ? content.icon\n          : (content.label ?? '◆');\n  const length = Array.from(text).length;\n  const base = content.kind === 'icon' ? 0.58 : length >= 5 ? 0.27 : length >= 3 ? 0.36 : 0.53;\n  const fontSize = Math.max(12, Math.round(size * base));\n  context.save();\n  context.textAlign = 'center';\n  context.textBaseline = 'middle';\n  context.lineJoin = 'round';\n  context.font = \`800 \${fontSize}px \${fontFamily ?? 'system-ui, sans-serif'}\`;\n  context.lineWidth = Math.max(1, Math.round(fontSize * (style?.outlineWidth ?? 0.08)));\n  context.strokeStyle = style?.outlineColor ?? 'rgba(0,0,0,.72)';\n  if (style?.glowColor) {\n    context.shadowColor = style.glowColor;\n    context.shadowBlur = Math.max(2, Math.round(fontSize * 0.08));\n  }\n  context.strokeText(text, x + size / 2, y + size * 0.49);\n  context.fillStyle = style?.color ?? palette.label;\n  context.fillText(text, x + size / 2, y + size * 0.49);\n  context.shadowBlur = 0;\n  if (content.kind === 'number' && (text === '6' || text === '9')) {\n    context.strokeStyle = style?.color ?? palette.label;\n    context.lineWidth = Math.max(2, Math.round(size * 0.03));\n    context.beginPath();\n    context.moveTo(x + size * 0.36, y + size * 0.79);\n    context.lineTo(x + size * 0.64, y + size * 0.79);\n    context.stroke();\n  }\n  context.restore();\n}\n\nfunction generatedAtlasKey(\n  spec: DraftrollPhysicalVisual,\n  presentation: PhysicalDiePresentation,\n  style: ThemeLabelStyleDefinition | undefined,\n  fontFamily: string | undefined,\n): string {\n  return JSON.stringify([spec.theme, presentation.contents, style ?? null, fontFamily ?? null]);\n}\n\nfunction acquireLabelAtlas(\n  spec: DraftrollPhysicalVisual,\n  definition: PhysicalDieDefinition,\n  presentation: PhysicalDiePresentation,\n  explicitPresentation: boolean,\n  runtimeAtlas: THREE.Texture | undefined,\n  style: ThemeLabelStyleDefinition | undefined,\n  fontFamily: string | undefined,\n): LabelAtlasResource {\n  if (!explicitPresentation && runtimeAtlas && definition.sides <= 20) {\n    return {\n      texture: runtimeAtlas,\n      columns: LABEL_ATLAS_COLUMNS,\n      rows: LABEL_ATLAS_ROWS,\n      cells: definition.outcomes.map((outcome) =>\n        THREE.MathUtils.clamp(Math.round(outcome.value), 1, 20) - 1,\n      ),\n      padding: LABEL_ATLAS_PADDING,\n      release() {},\n    };\n  }\n  const key = generatedAtlasKey(spec, presentation, style, fontFamily);\n  let cached = labelAtlasCache.get(key);\n  if (!cached) {\n    const count = Math.max(1, definition.outcomes.length);\n    const columns = Math.ceil(Math.sqrt(count));\n    const rows = Math.ceil(count / columns);\n    const cellSize = THREE.MathUtils.clamp(Math.floor(4096 / Math.max(columns, rows)), 32, 128);\n    const canvas = document.createElement('canvas');\n    canvas.width = columns * cellSize;\n    canvas.height = rows * cellSize;\n    const context = canvas.getContext('2d');\n    if (!context) throw new Error('Canvas 2D context unavailable.');\n    presentation.contents.forEach((content, index) => {\n      const column = index % columns;\n      const row = Math.floor(index / columns);\n      drawLabelContent(\n        context,\n        column * cellSize,\n        row * cellSize,\n        cellSize,\n        spec,\n        content,\n        style,\n        fontFamily,\n      );\n    });\n    const texture = new THREE.CanvasTexture(canvas);\n    texture.colorSpace = THREE.SRGBColorSpace;\n    texture.anisotropy = 8;\n    cached = { texture, refs: 0, columns, rows };\n    labelAtlasCache.set(key, cached);\n  }\n  cached.refs += 1;\n  return {\n    texture: cached.texture,\n    columns: cached.columns,\n    rows: cached.rows,\n    cells: definition.outcomes.map((_outcome, index) => index),\n    padding: 0.08,\n    release(): void {\n      const current = labelAtlasCache.get(key);\n      if (!current) return;\n      current.refs -= 1;\n      if (current.refs <= 0) {\n        current.texture.dispose();\n        labelAtlasCache.delete(key);\n      }\n    },\n  };\n}\n\nfunction labelUvRect(\n  atlas: LabelAtlasResource,\n  cell: number,\n): readonly [number, number, number, number] {\n  const column = cell % atlas.columns;\n  const row = Math.floor(cell / atlas.columns);\n  const padU = atlas.padding / atlas.columns;\n  const padV = atlas.padding / atlas.rows;\n  const u0 = column / atlas.columns + padU;\n  const u1 = (column + 1) / atlas.columns - padU;\n  const v0 = 1 - (row + 1) / atlas.rows + padV;\n  const v1 = 1 - row / atlas.rows - padV;\n  return [u0, v0, u1, v1];\n}\n\nfunction appendLabelQuad(\n  positions: number[],\n  anchor: PolyhedronLabelAnchor,\n  scale: number,\n): void {\n  const center = new THREE.Vector3(...anchor.position).addScaledVector(\n    new THREE.Vector3(...anchor.normal),\n    0.014,\n  );\n  const rotation = anchorQuaternion(anchor);\n  const half = (anchor.scale * scale) / 2;\n  const corners = [\n    new THREE.Vector3(-half, -half, 0),\n    new THREE.Vector3(half, -half, 0),\n    new THREE.Vector3(half, half, 0),\n    new THREE.Vector3(-half, half, 0),\n  ].map((corner) => corner.applyQuaternion(rotation).add(center));\n  for (const index of [0, 1, 2, 0, 2, 3]) {\n    const point = corners[index];\n    positions.push(point.x, point.y, point.z);\n  }\n}\n\nfunction writeOutcomeUvs(\n  uvs: Float32Array,\n  vertexStart: number,\n  vertexCount: number,\n  atlas: LabelAtlasResource,\n  cell: number,\n): void {\n  const [u0, v0, u1, v1] = labelUvRect(atlas, cell);\n  const quad = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];\n  for (let vertex = 0; vertex < vertexCount; vertex += 1) {\n    const source = (vertex % 6) * 2;\n    const target = (vertexStart + vertex) * 2;\n    uvs[target] = quad[source];\n    uvs[target + 1] = quad[source + 1];\n  }\n}\n\nfunction colliderGeometry(definition: PhysicalDieDefinition): THREE.BufferGeometry {\n  const collider = definition.collider;\n  if (collider.kind === 'box') {\n    return new THREE.BoxGeometry(\n      collider.halfExtents[0] * 2,\n      collider.halfExtents[1] * 2,\n      collider.halfExtents[2] * 2,\n    );\n  }\n  if (collider.kind === 'cylinder') {\n    return new THREE.CylinderGeometry(\n      collider.radiusTop,\n      collider.radiusBottom,\n      collider.height,\n      collider.segments,\n    );\n  }\n  const positions: number[] = [];\n  for (const face of collider.faces) {\n    for (let index = 1; index + 1 < face.length; index += 1) {\n      for (const vertexIndex of [face[0], face[index], face[index + 1]]) {\n        const vertex = collider.vertices[vertexIndex];\n        positions.push(vertex[0], vertex[1], vertex[2]);\n      }\n    }\n  }\n  const geometry = new THREE.BufferGeometry();\n  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));\n  geometry.computeVertexNormals();\n  geometry.computeBoundingSphere();\n  return geometry;\n}\n\nfunction scaleThemeMesh(`,
    'replace per-outcome label textures',
  );
  source = replaceOnce(
    source,
    `  const shape = definition.readableShape;\n  if (!shape) throw new Error('Physical die visual requires readable polyhedron geometry.');`,
    `  const shape = definition.readableShape;`,
    'custom geometry readable shape optional',
  );
  source = replaceOnce(
    source,
    `  const geometry = runtimeMesh ? scaleThemeMesh(runtimeMesh, definition) : triangulateShape(shape);\n  ownedGeometries.push(geometry);\n  const generatedSurface = createSurfaceTexture(spec);\n  ownedTextures.push(generatedSurface);`,
    `  const geometry = runtimeMesh\n    ? scaleThemeMesh(runtimeMesh, definition)\n    : shape\n      ? triangulateShape(shape)\n      : colliderGeometry(definition);\n  ownedGeometries.push(geometry);\n  const generatedSurface = acquireSurfaceTexture(spec);`,
    'custom collider geometry and surface cache',
  );
  source = replaceOnce(
    source,
    `    map: runtimeSurface ?? generatedSurface,`,
    `    map: runtimeSurface ?? generatedSurface.texture,`,
    'surface cache texture use',
  );
  source = replaceOnce(
    source,
    /  const fallbackKind = `d\$\{definition\.sides\}`;[\s\S]*?\n  if \(shape\.family === 'd1-cylinder' \|\| shape\.family === 'd2-coin'\) \{/,
    `  const fallbackKind = \`d\${definition.sides}\`;\n  const runtimeAtlas =\n    getRuntimeThemeTexture(spec.theme, spec.type, 'label') ??\n    getRuntimeThemeTexture(spec.theme, fallbackKind, 'label');\n  const labelStyle = getRuntimeThemeLabelStyle(spec.theme, spec.type, fallbackKind);\n  const labelScale = labelStyle?.scale ?? 1;\n  const fontFamily = getRuntimeThemeFont(spec.theme, spec.type, fallbackKind);\n  const anchorsByOutcome = definition.outcomes.map((outcome) => outcome.labelAnchors.slice());\n  if (shape) {\n    const covered = new Set(\n      definition.outcomes.flatMap((outcome) =>\n        outcome.labelAnchors.map((anchor) => anchor.faceIndex),\n      ),\n    );\n    for (let faceIndex = 0; faceIndex < shape.faces.length; faceIndex += 1) {\n      if (covered.has(faceIndex)) continue;\n      const normal = faceNormal(shape, faceIndex);\n      const outcomeIndex = definition.outcomes\n        .map((outcome, index) => ({\n          index,\n          score: Math.max(\n            ...outcome.supportNormals.map((support) =>\n              -normal.dot(new THREE.Vector3(...support)),\n            ),\n          ),\n        }))\n        .toSorted((left, right) => right.score - left.score)[0]?.index;\n      if (outcomeIndex !== undefined) anchorsByOutcome[outcomeIndex].push(secondaryAnchor(shape, faceIndex));\n    }\n  }\n  const totalLabelAnchors = anchorsByOutcome.reduce((sum, anchors) => sum + anchors.length, 0);\n  const labelAtlas =\n    totalLabelAnchors > 0\n      ? acquireLabelAtlas(\n          spec,\n          definition,\n          presentation,\n          explicitPresentation,\n          runtimeAtlas,\n          labelStyle,\n          fontFamily,\n        )\n      : null;\n  const labelPositions: number[] = [];\n  const ranges = anchorsByOutcome.map((anchors) => {\n    const vertexStart = labelPositions.length / 3;\n    for (const anchor of anchors) appendLabelQuad(labelPositions, anchor, labelScale);\n    return { vertexStart, vertexCount: anchors.length * 6 };\n  });\n  let labelGeometry: THREE.BufferGeometry | null = null;\n  let labelMaterial: THREE.MeshBasicMaterial | null = null;\n  const outcomeCells = labelAtlas?.cells.slice() ?? [];\n  if (labelAtlas && labelPositions.length > 0) {\n    labelGeometry = new THREE.BufferGeometry();\n    labelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(labelPositions, 3));\n    const uvs = new Float32Array((labelPositions.length / 3) * 2);\n    ranges.forEach((range, index) =>\n      writeOutcomeUvs(uvs, range.vertexStart, range.vertexCount, labelAtlas, outcomeCells[index]),\n    );\n    labelGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));\n    ownedGeometries.push(labelGeometry);\n    labelMaterial = new THREE.MeshBasicMaterial({\n      map: labelAtlas.texture,\n      transparent: true,\n      opacity: 0,\n      depthWrite: false,\n      toneMapped: false,\n      side: THREE.DoubleSide,\n    });\n    ownedMaterials.push(labelMaterial);\n    const labels = new THREE.Mesh(labelGeometry, labelMaterial);\n    labels.renderOrder = 7;\n    visualRoot.add(labels);\n  }\n  const swapOutcomeLabels = (first: number, second: number): void => {\n    if (!labelAtlas || !labelGeometry || first === second) return;\n    if (first < 0 || second < 0 || first >= ranges.length || second >= ranges.length) return;\n    const firstCell = outcomeCells[first];\n    outcomeCells[first] = outcomeCells[second];\n    outcomeCells[second] = firstCell;\n    const uv = labelGeometry.getAttribute('uv');\n    if (!(uv instanceof THREE.BufferAttribute) || !(uv.array instanceof Float32Array)) return;\n    writeOutcomeUvs(\n      uv.array,\n      ranges[first].vertexStart,\n      ranges[first].vertexCount,\n      labelAtlas,\n      outcomeCells[first],\n    );\n    writeOutcomeUvs(\n      uv.array,\n      ranges[second].vertexStart,\n      ranges[second].vertexCount,\n      labelAtlas,\n      outcomeCells[second],\n    );\n    uv.needsUpdate = true;\n  };\n\n  if (shape?.family === 'd1-cylinder' || shape?.family === 'd2-coin') {`,
    'batched label mesh section',
  );
  source = replaceOnce(
    source,
    `    labelMaterials.forEach((material) => {\n      material.opacity = value;\n    });`,
    `    if (labelMaterial) labelMaterial.opacity = value;`,
    'batched label opacity',
  );
  source = replaceOnce(
    source,
    `    group,\n    visualRoot,\n    labelMaterials,\n    labelMaps,\n    setOpacity,`,
    `    group,\n    visualRoot,\n    swapOutcomeLabels,\n    setOpacity,`,
    'mesh result fields',
  );
  source = replaceOnce(
    source,
    `      for (const geometryToDispose of ownedGeometries) geometryToDispose.dispose();\n      for (const materialToDispose of ownedMaterials) materialToDispose.dispose();\n      for (const textureToDispose of ownedTextures) textureToDispose.dispose();`,
    `      for (const geometryToDispose of ownedGeometries) geometryToDispose.dispose();\n      for (const materialToDispose of ownedMaterials) materialToDispose.dispose();\n      for (const textureToDispose of ownedTextures) textureToDispose.dispose();\n      generatedSurface.release();\n      labelAtlas?.release();`,
    'release cached mesh resources',
  );
  await write(path, source);
}

// Worker-side physical definition registry: definitions travel once per worker lifetime.
{
  const path = 'src/roll-worker.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `interface PlanEntry {\n  definition: PhysicalDieDefinition;`,
    `interface PlanEntry {\n  definitionKey: string;\n  definition?: PhysicalDieDefinition;`,
    'worker definition key',
  );
  source = replaceOnce(
    source,
    `const planner = new PhysicalRollPlanner();`,
    `const planner = new PhysicalRollPlanner();\nconst definitions = new Map<string, PhysicalDieDefinition>();`,
    'worker definition registry',
  );
  source = replaceOnce(
    source,
    `  const entries: PhysicalRollEntry[] = request.entries.map((entry) => ({\n    definition: entry.definition,\n    state: entry.state,\n    physics: entry.physics,\n    captureImpacts: entry.captureImpacts !== false,\n  }));`,
    `  const entries: PhysicalRollEntry[] = request.entries.map((entry) => {\n    if (entry.definition) definitions.set(entry.definitionKey, entry.definition);\n    const definition = definitions.get(entry.definitionKey);\n    if (!definition) {\n      throw new Error(\`Physical definition is not registered: \${entry.definitionKey}\`);\n    }\n    return {\n      definition,\n      state: entry.state,\n      physics: entry.physics,\n      captureImpacts: entry.captureImpacts !== false,\n    };\n  });`,
    'worker registry resolution',
  );
  await write(path, source);
}

// Browser engine: physical table registry, custom definitions, worker registration, diagnostics, interactions.
{
  const path = 'src/main.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `import { PhysicalRollPlanner, type PhysicalRollPlanResult } from './physical-roll-planner';`,
    `import { PhysicalRollPlanner, type PhysicalRollPlanResult } from './physical-roll-planner';\nimport { PhysicalTableRegistry, type PhysicalTableEntry } from './physical-table';`,
    'physical table import',
  );
  source = replaceOnce(
    source,
    `  getPhysicalVisualPlanEntries,\n  getPendingPhysicalLaunchParticipants,`,
    `  getPhysicalVisualInstance,\n  getPhysicalVisualPlanEntries,\n  getPendingPhysicalLaunchParticipants,`,
    'physical visual lookup import',
  );
  source = replaceOnce(
    source,
    `import type {\n  DraftrollFallbackVisual,`,
    `import { clonePhysicalDieDefinition } from '../packages/renderer/src/physical';\nimport type {\n  DraftrollFallbackVisual,`,
    'definition clone import main',
  );
  source = replaceOnce(
    source,
    `export interface DiceTargetingSnapshot {\n  method: 'shape-symmetry';`,
    `export interface DiceTargetingSnapshot {\n  method: 'symmetry' | 'relabel' | 'fixed' | 'mixed';`,
    'targeting snapshot method',
  );
  source = replaceOnce(
    source,
    `  naturalTrajectory: boolean;\n}`,
    `  naturalTrajectory: boolean;\n  targetingCounts: { symmetry: number; relabel: number; fixed: number };\n}`,
    'targeting snapshot counts',
  );
  source = replaceOnce(
    source,
    `interface RollPlanDiagnostics {\n  targetingMethod?: 'shape-symmetry';`,
    `interface RollPlanDiagnostics {\n  targetingMethod?: 'symmetry' | 'relabel' | 'fixed' | 'mixed';\n  targetingCounts?: { symmetry: number; relabel: number; fixed: number };`,
    'roll plan targeting diagnostics',
  );
  source = replaceOnce(
    source,
    `let genericPhysicalVisuals: PhysicalDieVisualInstance[] = [];\nlet fallbackVisuals: FallbackVisualInstance[] = [];`,
    `const physicalTable = new PhysicalTableRegistry();\nlet fallbackVisuals: FallbackVisualInstance[] = [];`,
    'physical registry declaration',
  );
  source = replaceOnce(
    source,
    `let activePhysicalSpecs: DraftrollPhysicalVisual[] = [];\nlet activeCanonicalPhysicalIndexes: number[] = [];\nlet activeGenericPhysicalIndexes: number[] = [];`,
    `let activePhysicalSpecs: DraftrollPhysicalVisual[] = [];`,
    'remove active parallel indexes',
  );
  source = replaceOnce(
    source,
    `    physics: visual.physics ? { ...visual.physics } : undefined,`,
    `    physics: visual.physics ? { ...visual.physics } : undefined,\n    definition: visual.definition ? clonePhysicalDieDefinition(visual.definition) : undefined,`,
    'clone main physical definition',
  );
  source = replaceOnce(
    source,
    `function clearGenericPhysicalVisuals(): void {\n  for (const visual of genericPhysicalVisuals) {\n    scene.remove(visual.group);\n    visual.dispose();\n  }\n  genericPhysicalVisuals = [];\n}`,
    `function clearGenericPhysicalVisuals(): void {\n  for (const entry of physicalTable.visualEntries()) {\n    const visual = entry.visual;\n    if (!visual) continue;\n    scene.remove(visual.group);\n    visual.dispose();\n    physicalTable.unbindVisual(entry.id);\n  }\n}\n\nfunction rebindPhysicalTableRuntime(): void {\n  const canonicalEntries = physicalTable.canonicalEntries();\n  if (canonicalEntries.length === dice.length) {\n    dice.forEach((die, index) => physicalTable.bindCanonical(canonicalEntries[index].id, die));\n  }\n  for (const entry of physicalTable.visualEntries()) {\n    const visual = getPhysicalVisualInstance(entry.id);\n    if (visual) physicalTable.bindVisual(entry.id, visual);\n  }\n}\n\nfunction resetPhysicalTable(specs: DraftrollPhysicalVisual[]): void {\n  activePhysicalSpecs = specs;\n  physicalTable.reset(specs);\n  rebindPhysicalTableRuntime();\n}`,
    'registry clear and reset helpers',
  );
  source = replaceOnce(
    source,
    `  genericPhysicalVisuals = specs.map((spec) => {\n    const visual = new PhysicalDieVisualInstance(spec);\n    visual.prepare();\n    scene.add(visual.group);\n    return visual;\n  });`,
    `  specs.forEach((spec) => {\n    const visual = new PhysicalDieVisualInstance(spec);\n    visual.prepare();\n    scene.add(visual.group);\n    physicalTable.bindVisual(spec.id, visual);\n  });`,
    'spawn generic via registry',
  );
  source = replaceOnce(
    source,
    `function usesCanonicalPhysicalImplementation(visual: DraftrollPhysicalVisual): boolean {\n  if (!visual.canonicalKind || !isDieKind(visual.canonicalKind) || visual.presentation)`,
    `function usesCanonicalPhysicalImplementation(visual: DraftrollPhysicalVisual): boolean {\n  if (\n    visual.definition ||\n    !visual.canonicalKind ||\n    !isDieKind(visual.canonicalKind) ||\n    visual.presentation\n  )`,
    'custom definition bypass canonical implementation',
  );
  source = replaceOnce(
    source,
    `function currentGenericPhysicalSpecs(): DraftrollPhysicalVisual[] {\n  return activeGenericPhysicalIndexes.flatMap((index) => {\n    const visual = activePhysicalSpecs[index];\n    return visual ? [visual] : [];\n  });\n}`,
    `function currentGenericPhysicalSpecs(): DraftrollPhysicalVisual[] {\n  return physicalTable.visualEntries().flatMap((entry) => {\n    const visual = activePhysicalSpecs[entry.physicalIndex];\n    return visual ? [visual] : [];\n  });\n}`,
    'generic specs from registry',
  );
  source = replaceOnce(
    source,
    `    activePhysicalSpecs = requestedPhysical;\n    const split = splitPhysicalSpecs(requestedPhysical);\n    activeCanonicalPhysicalIndexes = split.canonicalIndexes;\n    activeGenericPhysicalIndexes = split.genericIndexes;\n    if (activeCanonicalPhysicalIndexes.length !== quantity) {`,
    `    resetPhysicalTable(requestedPhysical);\n    if (physicalTable.canonicalCount !== quantity) {`,
    'prepare requested physical registry',
  );
  source = replaceOnce(
    source,
    `    activePhysicalSpecs = kinds.map((kind, index) => {`,
    `    resetPhysicalTable(kinds.map((kind, index) => {`,
    'manual physical registry start',
  );
  source = replaceOnce(
    source,
    `      };\n    });\n    activeCanonicalPhysicalIndexes = activePhysicalSpecs.map((_entry, index) => index);\n    activeGenericPhysicalIndexes = [];\n  }\n  activeFallbackSpecs = fallbacks;`,
    `      };\n    }));\n  }\n  rebindPhysicalTableRuntime();\n  activeFallbackSpecs = fallbacks;`,
    'manual physical registry end',
  );
  source = replaceAllExact(
    source,
    `genericPhysicalVisuals.forEach((visual) => visual.settle());`,
    `physicalTable.visualInstances().forEach((visual) => visual.settle());`,
    3,
    'settle registry visuals',
  );
  source = replaceAllExact(
    source,
    `genericPhysicalVisuals.forEach((visual) => visual.update(time, scale.x, scale.z));`,
    `physicalTable.visualInstances().forEach((visual) => visual.update(time, scale.x, scale.z));`,
    1,
    'update registry visuals',
  );
  source = replaceOnce(
    source,
    `(dice.length === 0 && genericPhysicalVisuals.length === 0 && fallbackVisuals.length === 0)`,
    `(dice.length === 0 && physicalTable.visualCount === 0 && fallbackVisuals.length === 0)`,
    'dissolve registry visual count',
  );
  source = replaceOnce(
    source,
    `function allCanonicalLaunchParticipants(): CanonicalLaunchParticipant[] {\n  return dice.map((die, index) => ({\n    die,\n    index,\n    id: physicalVisualId(activeCanonicalPhysicalIndexes[index] ?? index),\n  }));\n}`,
    `function allCanonicalLaunchParticipants(): CanonicalLaunchParticipant[] {\n  return dice.map((die, index) => ({\n    die,\n    index,\n    id: physicalVisualId(physicalTable.physicalIndexForCanonical(index)),\n  }));\n}`,
    'canonical launch registry indexes',
  );
  source = replaceOnce(
    source,
    `let rollWorker: Worker | null = null;\nlet rollWorkerReleaseTimer: number | null = null;`,
    `let rollWorker: Worker | null = null;\nlet rollWorkerReleaseTimer: number | null = null;\nconst rollWorkerDefinitionKeys = new Set<string>();`,
    'worker registered definitions state',
  );
  source = replaceOnce(
    source,
    `  rollWorker?.terminate();\n  rollWorker = null;`,
    `  rollWorker?.terminate();\n  rollWorker = null;\n  rollWorkerDefinitionKeys.clear();`,
    'clear worker definition registry',
  );
  source = replaceOnce(
    source,
    `function createWorkerPhysicalEntries(states: readonly LaunchState[]): WorkerPhysicalPlanEntry[] {\n  const genericEntries = getPhysicalVisualPlanEntries();\n  if (genericEntries.length !== activeGenericPhysicalIndexes.length) {`,
    `function createWorkerPhysicalEntries(states: readonly LaunchState[]): WorkerPhysicalPlanEntry[] {\n  const genericEntries = getPhysicalVisualPlanEntries();\n  if (genericEntries.length !== physicalTable.visualCount) {`,
    'worker generic count registry',
  );
  source = replaceOnce(
    source,
    `    const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);`,
    `    const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);`,
    'worker canonical registry lookup',
  );
  source = replaceAllExact(
    source,
    `const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;`,
    `const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);`,
    4,
    'canonical physical index registry lookup',
  );
  source = replaceOnce(
    source,
    `      targetingMethod: 'shape-symmetry',`,
    ``,
    'remove hard-coded symmetry diagnostic',
  );
  source = replaceOnce(
    source,
    `function activeGenericPlanAssignments() {\n  return activeGenericPhysicalIndexes.map((physicalIndex) => {\n    const spec = activePhysicalSpecs[physicalIndex];\n    if (!spec) throw new Error(\`Generic physical descriptor is missing at \${physicalIndex}.\`);\n    return { id: spec.id, physicalIndex };\n  });\n}`,
    `function activeGenericPlanAssignments() {\n  return physicalTable.visualEntries().map((entry) => ({\n    id: entry.id,\n    physicalIndex: entry.physicalIndex,\n  }));\n}`,
    'generic plan assignments registry',
  );
  source = replaceOnce(
    source,
    `  commitPhysicalVisualPlan(\n    completed.transforms,`,
    `  const targetingCounts = entries.reduce(\n    (counts, entry) => {\n      counts[entry.definition.targeting] += 1;\n      return counts;\n    },\n    { symmetry: 0, relabel: 0, fixed: 0 },\n  );\n  const activeTargeting = (Object.entries(targetingCounts) as Array<\n    ['symmetry' | 'relabel' | 'fixed', number]\n  >).filter(([, count]) => count > 0);\n  completed.diagnostics = {\n    ...completed.diagnostics,\n    targetingMethod: activeTargeting.length === 1 ? activeTargeting[0][0] : 'mixed',\n    targetingCounts,\n  };\n  commitPhysicalVisualPlan(\n    completed.transforms,`,
    'accurate targeting diagnostics',
  );
  source = replaceOnce(
    source,
    `  const id = nextPlanId++;\n  const lockedTransforms = lockedTrajectory?.transforms.slice();`,
    `  const id = nextPlanId++;\n  const definitionsAdded = new Set<string>();\n  const workerEntries = entries.map((entry) => {\n    const definitionKey = entry.definition.id;\n    const includeDefinition =\n      !rollWorkerDefinitionKeys.has(definitionKey) && !definitionsAdded.has(definitionKey);\n    if (includeDefinition) definitionsAdded.add(definitionKey);\n    return {\n      definitionKey,\n      definition: includeDefinition ? entry.definition : undefined,\n      state: entry.state,\n      physics: entry.physics,\n      captureImpacts: entry.captureImpacts,\n    };\n  });\n  const lockedTransforms = lockedTrajectory?.transforms.slice();`,
    'serialize worker definition registry',
  );
  source = replaceOnce(
    source,
    `        entries,\n        boundsX: screenBounds.x,`,
    `        entries: workerEntries,\n        boundsX: screenBounds.x,`,
    'send registered worker entries',
  );
  source = replaceOnce(
    source,
    `      transfer,\n    );\n  });\n  return completePhysicalPlan(basePlan, entries, preservedPhysicalCount);`,
    `      transfer,\n    );\n    for (const key of definitionsAdded) rollWorkerDefinitionKeys.add(key);\n  });\n  return completePhysicalPlan(basePlan, entries, preservedPhysicalCount);`,
    'commit worker definition keys',
  );
  source = replaceOnce(
    source,
    `  dice.forEach((die, canonicalIndex) => {\n    const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;`,
    `  dice.forEach((die, canonicalIndex) => {\n    const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);`,
    'playback canonical registry lookup',
  );
  source = replaceOnce(
    source,
    `function physicalWorldPositionAt(\n  physicalIndex: number,\n  target = new THREE.Vector3(),\n): THREE.Vector3 | null {\n  const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);\n  if (canonicalIndex >= 0) {\n    const position = dice[canonicalIndex]?.getWorldPosition();\n    return position ? target.copy(position) : null;\n  }\n  const genericIndex = activeGenericPhysicalIndexes.indexOf(physicalIndex);\n  return genericPhysicalVisuals[genericIndex]?.getWorldPosition(target) ?? null;\n}`,
    `function physicalWorldPositionAt(\n  physicalIndex: number,\n  target = new THREE.Vector3(),\n): THREE.Vector3 | null {\n  return physicalTable.worldPosition(physicalIndex, target);\n}`,
    'world position registry',
  );
  source = replaceOnce(
    source,
    `        method: 'shape-symmetry',`,
    `        method: diagnostics.targetingMethod ?? 'mixed',`,
    'capture targeting method',
  );
  source = replaceOnce(
    source,
    `        naturalTrajectory: diagnostics.naturalTrajectory === true,`,
    `        naturalTrajectory: diagnostics.naturalTrajectory === true,\n        targetingCounts: diagnostics.targetingCounts ?? { symmetry: 0, relabel: 0, fixed: 0 },`,
    'capture targeting counts',
  );
  source = replaceOnce(
    source,
    `    activePhysicalSpecs = physical;\n    activeCanonicalPhysicalIndexes = split.canonicalIndexes;\n    activeGenericPhysicalIndexes = split.genericIndexes;`,
    `    resetPhysicalTable(physical);`,
    'replay physical registry reset',
  );
  source = replaceOnce(
    source,
    `    activePhysicalSpecs: activePhysicalSpecs.map(clonePhysicalVisual),\n    activeCanonicalPhysicalIndexes: activeCanonicalPhysicalIndexes.slice(),\n    activeGenericPhysicalIndexes: activeGenericPhysicalIndexes.slice(),`,
    `    activePhysicalSpecs: activePhysicalSpecs.map(clonePhysicalVisual),`,
    'additive snapshot remove parallel indexes',
  );
  source = replaceOnce(
    source,
    `  const appended = appendPhysicalDice(\n    normalized.canonicalKinds,`,
    `  physicalTable.append(normalized.physical);\n  const appended = appendPhysicalDice(\n    normalized.canonicalKinds,`,
    'append registry before runtime handles',
  );
  source = replaceOnce(
    source,
    `    activePhysicalSpecs.push(...normalized.physical.map(clonePhysicalVisual));\n    activeCanonicalPhysicalIndexes.push(\n      ...normalized.canonicalPhysicalIndexes.map((index) => existingPhysicalCount + index),\n    );\n    activeGenericPhysicalIndexes.push(\n      ...normalized.genericPhysicalIndexes.map((index) => existingPhysicalCount + index),\n    );`,
    `    activePhysicalSpecs.push(...normalized.physical.map(clonePhysicalVisual));\n    normalized.canonicalPhysicalIndexes.forEach((physicalIndex, index) => {\n      const spec = normalized.physical[physicalIndex];\n      const die = appended[index];\n      if (spec && die) physicalTable.bindCanonical(spec.id, die);\n    });`,
    'additive active physical registry bindings',
  );
  source = replaceOnce(
    source,
    `      id: physicalVisualId(activeCanonicalPhysicalIndexes[existingCanonicalCount + index]),`,
    `      id: physicalVisualId(physicalTable.physicalIndexForCanonical(existingCanonicalCount + index)),`,
    'additive canonical id registry',
  );
  source = replaceOnce(
    source,
    `    activePhysicalSpecs = previous.activePhysicalSpecs;\n    activeCanonicalPhysicalIndexes = previous.activeCanonicalPhysicalIndexes;\n    activeGenericPhysicalIndexes = previous.activeGenericPhysicalIndexes;`,
    `    resetPhysicalTable(previous.activePhysicalSpecs);`,
    'rollback physical registry',
  );
  source = replaceOnce(
    source,
    `    const physicalIndex = activeCanonicalPhysicalIndexes[index] ?? index;`,
    `    const physicalIndex = physicalTable.physicalIndexForCanonical(index);`,
    'sample active canonical index',
  );
  source = replaceOnce(
    source,
    `    genericPhysicalVisuals.push(visual);\n    return visual;`,
    `    physicalTable.bindVisual(spec.id, visual);\n    return visual;`,
    'append visual registry binding',
  );
  source = replaceOnce(
    source,
    `  genericPhysicalVisuals.splice(\n    Math.max(0, genericPhysicalVisuals.length - appended.length),\n    appended.length,\n  );`,
    `  for (const visual of appended) physicalTable.unbindVisual(visual.spec.id);`,
    'remove appended visual registry',
  );
  source = replaceOnce(
    source,
    `function physicalResultAt(\n  physicalIndex: number,\n  canonicalValues: readonly number[],\n): number | string {\n  const spec = activePhysicalSpecs[physicalIndex];\n  if (spec) return spec.result;\n  const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);\n  return canonicalIndex >= 0 ? (canonicalValues[canonicalIndex] ?? 0) : 0;\n}\n\nfunction physicalOutcomeAt(physicalIndex: number): EffectOutcome {\n  const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);`,
    `function physicalResultAt(\n  physicalIndex: number,\n  canonicalValues: readonly number[],\n): number | string {\n  const spec = activePhysicalSpecs[physicalIndex];\n  if (spec) return spec.result;\n  const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);\n  return canonicalIndex >= 0 ? (canonicalValues[canonicalIndex] ?? 0) : 0;\n}\n\nfunction physicalOutcomeAt(physicalIndex: number): EffectOutcome {\n  const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);`,
    'physical result/outcome registry',
  );
  source = replaceAllExact(
    source,
    `const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);`,
    `const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);`,
    1,
    'remaining effect canonical registry lookup',
  );
  source = replaceOnce(
    source,
    `function normalizePhysicalBridgeRequest(request: DiceRollRequest): NormalizedPhysicalBridgeRequest {\n  const physical = (request.physical ?? []).map(clonePhysicalVisual);\n  physical.forEach((visual) => {\n    if (\n      !Number.isSafeInteger(visual.sides) ||\n      visual.sides < 1 ||\n      visual.sides > 256 ||`,
    `function normalizePhysicalBridgeRequest(request: DiceRollRequest): NormalizedPhysicalBridgeRequest {\n  const physical = (request.physical ?? []).map(clonePhysicalVisual);\n  physical.forEach((visual) => {\n    const maximumSides = visual.definition ? 10_000 : 256;\n    if (\n      !Number.isSafeInteger(visual.sides) ||\n      visual.sides < 1 ||\n      visual.sides > maximumSides ||`,
    'custom bridge side budget',
  );
  source = replaceOnce(
    source,
    `      visual.outcomeIndex >= visual.sides ||\n      !THEME_MANIFESTS[visual.theme]`,
    `      visual.outcomeIndex >= visual.sides ||\n      (visual.definition !== undefined &&\n        (visual.definition.sides !== visual.sides ||\n          visual.definition.outcomes.length !== visual.sides ||\n          visual.canonicalKind !== undefined)) ||\n      !THEME_MANIFESTS[visual.theme]`,
    'custom bridge definition consistency',
  );
  // Replace generic-array references that are simple visual iteration/read operations.
  source = source.replaceAll('genericPhysicalVisuals.length', 'physicalTable.visualCount');
  source = source.replaceAll('genericPhysicalVisuals', 'physicalTable.visualInstances()');
  // The replacements above intentionally do not touch the registry-based spawn/append code written earlier.
  source = source.replaceAll('physicalTable.visualInstances().push(', 'physicalTable.visualInstances().push(');

  // Unified physical interaction target: canonical bodies and replay-backed arbitrary/custom visuals.
  source = replaceOnce(
    source,
    `let draggedDie: { die: DieInstance; index: number; pointerId: number; mass: number } | null = null;`,
    `let draggedDie:\n  | { entry: PhysicalTableEntry; pointerId: number; mass: number | null }\n  | null = null;`,
    'generic dragged physical state',
  );
  source = replaceOnce(
    source,
    /function findInteractiveDie\([\s\S]*?\nfunction finishDieDrag\(event: PointerEvent, cancelled = false\): boolean \{[\s\S]*?\n  return true;\n\}/,
    `function findInteractiveDie(event: PointerEvent): PhysicalTableEntry | null {\n  updateInteractionRay(event);\n  const roots = physicalTable.boundEntries().flatMap((entry) => {\n    const root = entry.die?.group ?? entry.visual?.group;\n    return root ? [root] : [];\n  });\n  const hit = interactionRaycaster.intersectObjects(roots, true)[0];\n  return hit ? physicalTable.findByObject(hit.object) : null;\n}\n\nfunction beginDieDrag(event: PointerEvent): boolean {\n  if (!interactionOptions.draggable || !hasCast || isRolling || isPlanning) return false;\n  const entry = findInteractiveDie(event);\n  if (!entry) return false;\n  let mass: number | null = null;\n  if (entry.die) {\n    mass = entry.die.body.mass;\n    entry.die.body.type = CANNON.Body.KINEMATIC;\n    entry.die.body.mass = 0;\n    entry.die.body.updateMassProperties();\n    entry.die.body.velocity.setZero();\n    entry.die.body.angularVelocity.setZero();\n    entry.die.body.wakeUp();\n  }\n  draggedDie = { entry, pointerId: event.pointerId, mass };\n  pointerStart = null;\n  canvas.setPointerCapture(event.pointerId);\n  return true;\n}\n\nfunction moveDraggedDie(event: PointerEvent): void {\n  if (!draggedDie || draggedDie.pointerId !== event.pointerId) return;\n  updateInteractionRay(event);\n  if (!interactionRaycaster.ray.intersectPlane(dragPlane, dragPoint)) return;\n  const { entry } = draggedDie;\n  const radius = entry.die?.getVisualRadius() ?? entry.visual?.getVisualRadius() ?? 0.7;\n  const x = THREE.MathUtils.clamp(dragPoint.x, -visibleBounds.x + radius, visibleBounds.x - radius);\n  const z = THREE.MathUtils.clamp(dragPoint.z, -visibleBounds.z + radius, visibleBounds.z - radius);\n  const y = Math.max(0.72, radius * 0.72);\n  if (entry.die) {\n    entry.die.body.position.set(x, y, z);\n    entry.die.body.velocity.setZero();\n    entry.die.body.angularVelocity.setZero();\n    entry.die.syncVisual();\n  } else if (entry.visual) {\n    entry.visual.moveTo(new THREE.Vector3(x, y, z));\n  }\n  requestRender();\n}\n\nfunction finishDieDrag(event: PointerEvent, cancelled = false): boolean {\n  if (!draggedDie || draggedDie.pointerId !== event.pointerId) return false;\n  const current = draggedDie;\n  draggedDie = null;\n  if (current.entry.die && current.mass !== null) {\n    current.entry.die.body.type = CANNON.Body.DYNAMIC;\n    current.entry.die.body.mass = current.mass;\n    current.entry.die.body.updateMassProperties();\n    current.entry.die.body.velocity.set(0, cancelled ? 0 : 0.08, 0);\n    current.entry.die.body.wakeUp();\n  }\n  const position = physicalTable.worldPosition(current.entry.physicalIndex) ?? new THREE.Vector3();\n  canvas.dispatchEvent(\n    new CustomEvent('draftroll:die-interaction', {\n      detail: {\n        action: 'move',\n        dieIndex: current.entry.physicalIndex,\n        dieId: current.entry.id,\n        position: { x: position.x, y: position.y, z: position.z },\n      },\n      bubbles: true,\n    }),\n  );\n  requestRender();\n  return true;\n}`,
    'generic physical dragging',
  );

  // Debug snapshot used by browser regression tests, intentionally bridge-internal rather than SDK API.
  source = replaceOnce(
    source,
    `      getPerformanceSnapshot: () => DicePerformanceSnapshot;`,
    `      getPerformanceSnapshot: () => DicePerformanceSnapshot;\n      getPhysicalSnapshot: () => Array<{\n        id: string;\n        physicalIndex: number;\n        implementation: 'canonical' | 'generated' | 'custom';\n        targeting: 'symmetry' | 'relabel' | 'fixed';\n        requestedOutcomeIndex: number;\n        landedOutcomeIndex: number | null;\n        result: number | string;\n        visible: boolean;\n        position: { x: number; y: number; z: number };\n      }>;`,
    'physical debug snapshot global type',
  );
  source = replaceOnce(
    source,
    `  getPerformanceSnapshot: () => ({`,
    `  getPhysicalSnapshot: () =>\n    activePhysicalSpecs.map((spec, physicalIndex) => {\n      const entry = physicalTable.entryAt(physicalIndex);\n      const position = physicalTable.worldPosition(physicalIndex) ?? new THREE.Vector3();\n      const visual = entry?.visual;\n      const definitionTargeting =\n        spec.definition?.targeting ?? (spec.canonicalKind ? 'symmetry' : 'relabel');\n      return {\n        id: spec.id,\n        physicalIndex,\n        implementation: spec.definition\n          ? ('custom' as const)\n          : spec.canonicalKind\n            ? ('canonical' as const)\n            : ('generated' as const),\n        targeting: definitionTargeting,\n        requestedOutcomeIndex: spec.outcomeIndex,\n        landedOutcomeIndex:\n          visual?.landedOutcomeIndex ?? activePlan?.landings[physicalIndex] ?? null,\n        result: spec.result,\n        visible: entry?.die?.group.visible ?? entry?.visual?.group.visible ?? false,\n        position: { x: position.x, y: position.y, z: position.z },\n      };\n    }),\n  getPerformanceSnapshot: () => ({`,
    'physical debug snapshot implementation',
  );

  // Final guard: the old active generated index arrays are no longer allowed.
  if (/activeCanonicalPhysicalIndexes|activeGenericPhysicalIndexes/.test(source)) {
    throw new Error('main.ts still contains parallel physical index arrays');
  }
  await write(path, source);
}

// Update architecture smoke to assert the new ownership rather than the old per-outcome texture path.
{
  const path = 'scripts/test-visual-fallbacks.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    `  rollWorker,\n  physicsShapes,`,
    `  rollWorker,\n  physicalTable,\n  physicsShapes,`,
    'smoke physical table fixture',
  );
  source = replaceOnce(
    source,
    `  readFile(new URL('../src/roll-worker.ts', import.meta.url), 'utf8'),\n  readFile(new URL('../src/physics-shapes.ts', import.meta.url), 'utf8'),`,
    `  readFile(new URL('../src/roll-worker.ts', import.meta.url), 'utf8'),\n  readFile(new URL('../src/physical-table.ts', import.meta.url), 'utf8'),\n  readFile(new URL('../src/physics-shapes.ts', import.meta.url), 'utf8'),`,
    'smoke physical table source',
  );
  source = replaceOnce(
    source,
    `/genericPhysicalVisuals\\.forEach\\(\\(visual\\) => visual\\.update\\(time, scale\\.x, scale\\.z\\)\\)/,`,
    `/physicalTable\\.visualInstances\\(\\)\\.forEach\\(\\(visual\\) => visual\\.update\\(time, scale\\.x, scale\\.z\\)\\)/,`,
    'smoke visual update registry',
  );
  source = replaceOnce(
    source,
    `assert.match(rollWorker, /definition: PhysicalDieDefinition/);`,
    `assert.match(rollWorker, /definitionKey: string/);\nassert.match(rollWorker, /definitions = new Map<string, PhysicalDieDefinition>/);`,
    'smoke worker definition registry',
  );
  source = replaceOnce(
    source,
    `assert.match(physicalVisuals, /createGeneratedPhysicalDieDefinition/);`,
    `assert.match(physicalVisuals, /createGeneratedPhysicalDieDefinition/);\nassert.match(physicalVisuals, /spec\\.definition/);\nassert.match(renderer, /physicalModels\\?:/);\nassert.match(renderer, /definition\\?: PhysicalDieDefinition/);`,
    'smoke custom physical models',
  );
  source = replaceOnce(
    source,
    `assert.match(engine, /activeGenericPhysicalIndexes/);`,
    `assert.doesNotMatch(engine, /activeGenericPhysicalIndexes|activeCanonicalPhysicalIndexes/);\nassert.match(engine, /PhysicalTableRegistry/);\nassert.match(physicalTable, /class PhysicalTableRegistry/);`,
    'smoke registry ownership',
  );
  source = replaceOnce(
    source,
    `assert.match(physicalMesh, /presentationTexture/);`,
    `assert.match(physicalMesh, /acquireLabelAtlas/);\nassert.match(physicalMesh, /swapOutcomeLabels/);`,
    'smoke atlas labels',
  );
  source = replaceOnce(
    source,
    `assert.match(physicalMesh, /function atlasCellTexture/);\nassert.match(physicalMesh, /LABEL_ATLAS_COLUMNS = 5/);`,
    `assert.doesNotMatch(physicalMesh, /function atlasCellTexture|presentationTexture/);\nassert.match(physicalMesh, /LABEL_ATLAS_COLUMNS = 5/);\nassert.match(physicalMesh, /labelAtlasCache/);\nassert.match(physicalMesh, /surfaceTextureCache/);`,
    'smoke no per-outcome textures',
  );
  await write(path, source);
}

// Browser regression: assert physical targeting/identity and generated/custom interaction snapshot.
{
  const path = 'tests/browser/specs/overlay.spec.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `  const generatedOnly = await generatedRoll;\n  expect(generatedOnly.dice).toBe(2);\n  expect(Number.isFinite(generatedOnly.total)).toBe(true);`,
    `  const generatedOnly = await generatedRoll;\n  expect(generatedOnly.dice).toBe(2);\n  expect(Number.isFinite(generatedOnly.total)).toBe(true);\n  const generatedSnapshot = await page\n    .frameLocator('iframe[title="Draftroll dice overlay"]')\n    .locator('body')\n    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());\n  expect(generatedSnapshot).toHaveLength(2);\n  expect(generatedSnapshot.every((entry) => entry.implementation === 'generated')).toBe(true);\n  expect(generatedSnapshot.every((entry) => entry.targeting === 'relabel')).toBe(true);\n  expect(generatedSnapshot.every((entry) => entry.visible)).toBe(true);\n  expect(\n    generatedSnapshot.every((entry) =>\n      Number.isInteger(entry.landedOutcomeIndex) &&\n      entry.requestedOutcomeIndex >= 0 &&\n      entry.requestedOutcomeIndex < (entry.id.includes('d3') ? 3 : 5),\n    ),\n  ).toBe(true);`,
    'browser generated snapshot assertions',
  );
  source = replaceOnce(
    source,
    `  const mixed = await page.evaluate(() => window.__draftrollTest.rollLocal('1d6+1d9+1d11'));\n  expect(mixed.dice).toBe(3);\n  expect(Number.isFinite(mixed.total)).toBe(true);\n  await expect(iframe).toHaveCSS('visibility', 'visible');`,
    `  const mixed = await page.evaluate(() => window.__draftrollTest.rollLocal('1d6+1d9+1d11'));\n  expect(mixed.dice).toBe(3);\n  expect(Number.isFinite(mixed.total)).toBe(true);\n  await expect(iframe).toHaveCSS('visibility', 'visible');\n  const mixedSnapshot = await page\n    .frameLocator('iframe[title="Draftroll dice overlay"]')\n    .locator('body')\n    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());\n  expect(mixedSnapshot.map((entry) => entry.implementation)).toEqual([\n    'canonical',\n    'generated',\n    'generated',\n  ]);\n  expect(mixedSnapshot.map((entry) => entry.targeting)).toEqual([\n    'symmetry',\n    'relabel',\n    'relabel',\n  ]);`,
    'browser mixed targeting snapshot',
  );
  await write(path, source);
}

console.log('final physical runtime migration applied');
