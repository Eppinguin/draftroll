import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing migration anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Ambiguous migration anchor: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: expected one match, found ${matches.length}`);
  return source.replace(pattern, replacement);
}

// --- Public renderer contract: physical means canonical OR generated/custom. ---
let renderer = await readFile(new URL('../packages/renderer/src/index.ts', import.meta.url), 'utf8');
renderer = replaceOnce(
  renderer,
  `export type {\n  AdaptiveResolutionOptions,\n  RendererPerformanceBudget,\n  RendererPerformanceBudgetInput,\n} from './performance';`,
  `export type {\n  AdaptiveResolutionOptions,\n  RendererPerformanceBudget,\n  RendererPerformanceBudgetInput,\n} from './performance';\nexport type {\n  CustomPhysicalDieDefinitionInput,\n  PhysicalDieDefinition,\n  PhysicalDieFaceContent,\n  PhysicalDieGeometrySource,\n  PhysicalDieModel,\n  PhysicalDieOutcomeSlot,\n  PhysicalDiePresentation,\n  PhysicalDieTargetingMode,\n  SerializedPhysicalCollider,\n} from './physical';\nimport type { PhysicalDieFaceContent, PhysicalDiePresentation } from './physical';`,
  'renderer physical exports',
);
renderer = replaceOnce(
  renderer,
  `  CustomDiceDefinition,\n  NormalizedDieResult,`,
  `  CustomDiceDefinition,\n  CustomDieFace,\n  NormalizedDieResult,`,
  'custom face import',
);
renderer = replaceOnce(
  renderer,
  `export type DraftrollEffectOutcome = 'positive' | 'neutral' | 'negative' | 'none';`,
  `export type DraftrollEffectOutcome = 'positive' | 'neutral' | 'negative' | 'none';\n\n/**\n * Serializable first-class physical die presented by the browser bridge.\n *\n * @remarks\n * Canonical, generated, and custom/theme dice use the same physical contract. The outcome index\n * selects a physical support slot while result/numericValue retain the host's semantic outcome.\n * Presentation is optional: ordinary numeric dice use renderer/theme defaults, while symbolic dice\n * can attach text or icon content to the same physical slots without changing game semantics.\n *\n * @public\n */\nexport interface DraftrollPhysicalVisual {\n  id: string;\n  /** Original normalized die type or custom die identifier. */\n  type: string;\n  /** Number of logical physical outcome slots. */\n  sides: number;\n  /** Zero-based physical outcome slot requested by the authoritative result. */\n  outcomeIndex: number;\n  /** Authoritative semantic result. */\n  result: number | string;\n  /** Numeric contribution retained independently from the face artwork. */\n  numericValue?: number;\n  /** Canonical optimized geometry when available; otherwise generated geometry is used. */\n  canonicalKind?: DraftrollDieKind;\n  title: string;\n  label: string;\n  theme: string;\n  outcome: DraftrollEffectOutcome;\n  physics?: DicePhysicsProperties;\n  /** Optional slot artwork such as custom text/icons. */\n  presentation?: PhysicalDiePresentation;\n  metadata?: Record<string, unknown>;\n}\n`,
  'public physical visual contract',
);
renderer = replaceOnce(
  renderer,
  `          /** Results belonging only to physical dice. May be empty for fallback-only rolls. */\n          results?: number[] | number;`,
  `          /** First-class physical dice. New integrations should use this instead of legacy parallel arrays. */\n          physical?: DraftrollPhysicalVisual[];\n          /** @deprecated Legacy canonical-only physical results. */\n          results?: number[] | number;`,
  'bridge physical request',
);
renderer = replaceOnce(
  renderer,
  `interface PhysicalVisual {\n  die: NormalizedDieResult;\n  kind: DraftrollDieKind;\n  value: number;\n  theme: string;\n  outcome: DraftrollEffectOutcome;\n  physics?: DicePhysicsProperties;\n}`,
  `interface PhysicalVisual extends DraftrollPhysicalVisual {\n  die: NormalizedDieResult;\n}\n\nfunction clonePreparedPhysicalVisual(visual: PhysicalVisual): DraftrollPhysicalVisual {\n  return {\n    id: visual.id,\n    type: visual.type,\n    sides: visual.sides,\n    outcomeIndex: visual.outcomeIndex,\n    result: visual.result,\n    numericValue: visual.numericValue,\n    canonicalKind: visual.canonicalKind,\n    title: visual.title,\n    label: visual.label,\n    theme: visual.theme,\n    outcome: visual.outcome,\n    physics: visual.physics ? { ...visual.physics } : undefined,\n    presentation: visual.presentation\n      ? { contents: visual.presentation.contents.map((content) => ({ ...content })) }\n      : undefined,\n    metadata: visual.metadata ? { ...visual.metadata } : undefined,\n  };\n}`,
  'prepared physical visual',
);
renderer = replaceOnce(
  renderer,
  `  physicalCount: number;\n  fallbackStart: number;`,
  `  physicalCount: number;\n  /** Stable IDs make group ownership independent from internal visual storage/ranges. */\n  dieIds: string[];\n  fallbackStart: number;`,
  'table roll die IDs',
);
const oldPrepareClassification = `      const definition = definitions.get(die.customDiceId ?? '');\n      const physicalFace = resolvePhysicalFace(die, definition);\n      const physicalKind = physicalFace?.kind ?? normalizeKind(die.type, die.sides);\n      const numericResult =\n        physicalFace?.value ?? (typeof die.result === 'number' ? die.result : Number(die.result));\n      const isPhysicalValue =\n        options.forceFallback !== true &&\n        physicalKind !== null &&\n        Number.isInteger(numericResult) &&\n        numericResult >= 1 &&\n        numericResult <= maximumPhysicalValue(physicalKind) &&\n        (physicalFace !== null || !isDistinctFallbackType(die.type));\n      const outcome =\n        options.outcomeResolver?.(die, result) ?? defaultOutcomeForDie(die, physicalKind);\n\n      if (isPhysicalValue && physicalKind) {\n        const index = physical.length;\n        physical.push({\n          die,\n          kind: physicalKind,\n          value: numericResult,\n          theme,\n          outcome,\n          physics: die.physics,\n        });\n        visualOrder.push({ kind: 'physical', index, dieId: die.id });\n        continue;\n      }\n\n      const index = fallbacks.length;\n      fallbacks.push(createFallbackVisual(die, theme, outcome, definition));\n      visualOrder.push({ kind: 'fallback', index, dieId: die.id });`;
const newPrepareClassification = `      const definition = definitions.get(die.customDiceId ?? '');\n      const physicalSlot = resolvePhysicalSlot(die, definition);\n      const outcome =\n        options.outcomeResolver?.(die, result) ?? defaultOutcomeForDie(die, physicalSlot?.sides);\n\n      if (options.forceFallback !== true && physicalSlot) {\n        const index = physical.length;\n        physical.push({\n          die,\n          id: die.id,\n          type: die.type,\n          sides: physicalSlot.sides,\n          outcomeIndex: physicalSlot.outcomeIndex,\n          result: die.result,\n          numericValue:\n            die.numericValue ?? (typeof die.result === 'number' ? die.result : undefined),\n          canonicalKind: physicalSlot.kind ?? undefined,\n          title: readPhysicalTitle(die, definition, physicalSlot.sides),\n          label: die.faceLabel ?? String(die.result),\n          theme,\n          outcome,\n          physics: die.physics,\n          presentation: definition\n            ? createCustomPhysicalPresentation(definition, physicalSlot.sides)\n            : undefined,\n          metadata: {\n            ...definition?.metadata,\n            ...die.metadata,\n            ...(die.faceMetadata ? { faceMetadata: die.faceMetadata } : {}),\n            ...(die.faceIndex !== undefined ? { faceIndex: die.faceIndex } : {}),\n          },\n        });\n        visualOrder.push({ kind: 'physical', index, dieId: die.id });\n        continue;\n      }\n\n      const index = fallbacks.length;\n      fallbacks.push(createFallbackVisual(die, theme, outcome, definition));\n      visualOrder.push({ kind: 'fallback', index, dieId: die.id });`;
renderer = replaceOnce(renderer, oldPrepareClassification, newPrepareClassification, 'prepare physical classification');
renderer = replaceOnce(
  renderer,
  `        ? (physical[entry.index]?.value ?? 0)`,
  `        ? (physical[entry.index]?.result ?? 0)`,
  'expected physical result',
);
renderer = replaceOnce(
  renderer,
  `    const numericResults: number[] = [];\n    const physicalKinds: DraftrollDieKind[] = [];\n    const themes: string[] = [];\n    const outcomes: DraftrollEffectOutcome[] = [];\n    const physics: DicePhysicsProperties[] = [];\n    const fallbacks: DraftrollFallbackVisual[] = [];`,
  `    const physical: DraftrollPhysicalVisual[] = [];\n    // Deprecated canonical arrays remain populated for older custom bridges. Built-in Draftroll\n    // treats physical[] as authoritative and ignores these when the new field is present.\n    const numericResults: number[] = [];\n    const physicalKinds: DraftrollDieKind[] = [];\n    const themes: string[] = [];\n    const outcomes: DraftrollEffectOutcome[] = [];\n    const physics: DicePhysicsProperties[] = [];\n    const fallbacks: DraftrollFallbackVisual[] = [];`,
  'execute physical declarations',
);
renderer = replaceOnce(
  renderer,
  `      const physicalStart = numericResults.length;\n      const fallbackStart = fallbacks.length;\n      entry.physical.forEach((visual) => {\n        numericResults.push(visual.value);\n        physicalKinds.push(visual.kind);\n        themes.push(visual.theme);\n        outcomes.push(visual.outcome);\n        physics.push({ ...visual.physics });\n      });`,
  `      const physicalStart = physical.length;\n      const fallbackStart = fallbacks.length;\n      entry.physical.forEach((visual) => {\n        physical.push(clonePreparedPhysicalVisual(visual));\n        if (visual.canonicalKind) {\n          numericResults.push(visual.outcomeIndex + 1);\n          physicalKinds.push(visual.canonicalKind);\n          themes.push(visual.theme);\n          outcomes.push(visual.outcome);\n          physics.push({ ...visual.physics });\n        }\n      });`,
  'execute physical accumulation',
);
renderer = replaceOnce(
  renderer,
  `        physicalCount: entry.physical.length,\n        fallbackStart,`,
  `        physicalCount: entry.physical.length,\n        dieIds: entry.visualOrder.map((visual) => visual.dieId),\n        fallbackStart,`,
  'table group ids',
);
renderer = replaceOnce(
  renderer,
  `    if (numericResults.length > 0 && presentationMode === 'replace') {`,
  `    if (physical.length > 0 && presentationMode === 'replace') {`,
  'bridge quantity condition',
);
renderer = replaceOnce(
  renderer,
  `      this.bridge.setQuantity(numericResults.length);\n      this.bridge.setTheme(themes[0] ?? this.fallbackThemeId);`,
  `      this.bridge.setQuantity(physical.length);\n      this.bridge.setTheme(physical[0]?.theme ?? this.fallbackThemeId);`,
  'bridge quantity physical',
);
renderer = replaceOnce(
  renderer,
  `    const bridgePromise = this.bridge.roll({\n      results: numericResults,`,
  `    const bridgePromise = this.bridge.roll({\n      physical,\n      results: numericResults,`,
  'bridge sends physical',
);

const oldPhysicalHelpers = `function maximumPhysicalValue(kind: DraftrollDieKind): number {\n  return kind === 'coin' ? 2 : Number(kind.slice(1));\n}\n\nfunction resolvePhysicalFace(\n  die: NormalizedDieResult,\n  definition: CustomDiceDefinition | undefined,\n): { kind: DraftrollDieKind; value: number } | null {\n  const kind = normalizeKind(definition?.renderAs ?? '', undefined);\n  if (!definition || !kind) return null;\n  const maximum = maximumPhysicalValue(kind);\n  let faceIndex = die.faceIndex;\n  if (faceIndex === undefined) {\n    const matches = definition.faces\n      .map((face, index) => ({ face, index }))\n      .filter(\n        ({ face }) =>\n          face.result === die.result &&\n          (face.value ?? numericFaceValue(face.result)) ===\n            (die.numericValue ?? numericFaceValue(die.result)),\n      );\n    if (matches.length === 1) faceIndex = matches[0].index;\n  }\n  if (faceIndex === undefined || !Number.isInteger(faceIndex) || faceIndex < 0) return null;\n  return { kind, value: (faceIndex % maximum) + 1 };\n}\n\nfunction numericFaceValue(value: number | string): number {\n  return typeof value === 'number' ? value : Number(value) || 0;\n}`;
const newPhysicalHelpers = `const MAXIMUM_EXACT_PHYSICAL_SIDES = 256;\n\ninterface ResolvedPhysicalSlot {\n  kind: DraftrollDieKind | null;\n  sides: number;\n  outcomeIndex: number;\n}\n\nfunction maximumPhysicalValue(kind: DraftrollDieKind): number {\n  return kind === 'coin' ? 2 : Number(kind.slice(1));\n}\n\nfunction numericPhysicalSides(type: string, sides?: number): number | null {\n  if (Number.isSafeInteger(sides) && (sides ?? 0) >= 1) return sides!;\n  const match = /^d(\\d+)$/i.exec(type);\n  const parsed = match ? Number(match[1]) : NaN;\n  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;\n}\n\nfunction resolveCustomFaceIndex(\n  die: NormalizedDieResult,\n  definition: CustomDiceDefinition,\n): number | null {\n  let faceIndex = die.faceIndex;\n  if (faceIndex === undefined) {\n    const matches = definition.faces\n      .map((face, index) => ({ face, index }))\n      .filter(\n        ({ face }) =>\n          face.result === die.result &&\n          (face.value ?? numericFaceValue(face.result)) ===\n            (die.numericValue ?? numericFaceValue(die.result)),\n      );\n    if (matches.length === 1) faceIndex = matches[0].index;\n  }\n  return faceIndex !== undefined && Number.isInteger(faceIndex) && faceIndex >= 0\n    ? faceIndex\n    : null;\n}\n\nfunction resolvePhysicalSlot(\n  die: NormalizedDieResult,\n  definition: CustomDiceDefinition | undefined,\n): ResolvedPhysicalSlot | null {\n  if (definition && !definition.renderAs) return null;\n  if (!definition && isDistinctFallbackType(die.type)) return null;\n  const sourceType = definition?.renderAs ?? die.type;\n  const kind = normalizeKind(sourceType, definition ? undefined : die.sides);\n  const sides = kind\n    ? maximumPhysicalValue(kind)\n    : numericPhysicalSides(sourceType, definition ? undefined : die.sides);\n  if (sides === null || sides > MAXIMUM_EXACT_PHYSICAL_SIDES) return null;\n\n  if (definition) {\n    const faceIndex = resolveCustomFaceIndex(die, definition);\n    return faceIndex === null ? null : { kind, sides, outcomeIndex: faceIndex % sides };\n  }\n\n  const value = typeof die.result === 'number' ? die.result : Number(die.result);\n  if (!Number.isInteger(value) || value < 1 || value > sides) return null;\n  return { kind, sides, outcomeIndex: value - 1 };\n}\n\nfunction physicalFaceContent(face: CustomDieFace, slot: number): PhysicalDieFaceContent {\n  const icon = typeof face.metadata?.icon === 'string' ? face.metadata.icon : undefined;\n  if (icon) return { kind: 'icon', icon, label: face.label };\n  const asset =\n    typeof face.metadata?.texture === 'string'\n      ? face.metadata.texture\n      : typeof face.metadata?.asset === 'string'\n        ? face.metadata.asset\n        : undefined;\n  if (asset) return { kind: 'texture', asset, label: face.label };\n  if (typeof face.result === 'number') {\n    return { kind: 'number', value: slot + 1, label: face.label ?? String(face.result) };\n  }\n  return { kind: 'text', text: face.label ?? String(face.result) };\n}\n\nfunction createCustomPhysicalPresentation(\n  definition: CustomDiceDefinition,\n  sides: number,\n): PhysicalDiePresentation {\n  const contents: PhysicalDieFaceContent[] = Array.from({ length: sides }, (_entry, index) => ({\n    kind: 'number' as const,\n    value: index + 1,\n  }));\n  definition.faces.forEach((face, faceIndex) => {\n    const slot = faceIndex % sides;\n    contents[slot] = physicalFaceContent(face, slot);\n  });\n  return { contents };\n}\n\nfunction readPhysicalTitle(\n  die: NormalizedDieResult,\n  definition: CustomDiceDefinition | undefined,\n  sides: number,\n): string {\n  const metadataLabel = typeof die.metadata?.label === 'string' ? die.metadata.label : undefined;\n  const definitionLabel =\n    typeof definition?.metadata?.name === 'string' ? definition.metadata.name : undefined;\n  return metadataLabel ?? definitionLabel ?? (definition?.id || `d${sides}`);\n}\n\nfunction numericFaceValue(value: number | string): number {\n  return typeof value === 'number' ? value : Number(value) || 0;\n}`;
renderer = replaceOnce(renderer, oldPhysicalHelpers, newPhysicalHelpers, 'generic physical slot helpers');
renderer = replaceOnce(
  renderer,
  `function defaultOutcomeForDie(\n  die: NormalizedDieResult,\n  physicalKind: DraftrollDieKind | null,\n): DraftrollEffectOutcome {`,
  `function defaultOutcomeForDie(\n  die: NormalizedDieResult,\n  physicalMaximum?: number,\n): DraftrollEffectOutcome {`,
  'default outcome signature',
);
renderer = replaceOnce(
  renderer,
  `    const maximum = physicalKind ? maximumPhysicalValue(physicalKind) : die.sides;`,
  `    const maximum = physicalMaximum ?? die.sides;`,
  'default outcome maximum',
);
await writeFile(new URL('../packages/renderer/src/index.ts', import.meta.url), renderer);

// --- Browser bridge compatibility adapter. Public physical[] is authoritative. ---
let main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
main = replaceOnce(
  main,
  `  DraftrollFallbackVisual,\n  DraftrollVisualOrderEntry,`,
  `  DraftrollFallbackVisual,\n  DraftrollPhysicalVisual,\n  DraftrollVisualOrderEntry,`,
  'engine physical type import',
);
main = replaceOnce(
  main,
  `export interface DiceRollRequest {\n  results?: number[] | number;`,
  `export interface DiceRollRequest {\n  /** First-class physical dice. Legacy results/kinds remain accepted for backwards compatibility. */\n  physical?: DraftrollPhysicalVisual[];\n  results?: number[] | number;`,
  'engine physical request',
);
main = replaceRegexOnce(
  main,
  /interface ActiveTableRollGroup \{([\s\S]*?)groupId: string;/,
  (match, prefix) => `interface ActiveTableRollGroup {${prefix}groupId: string;\n  dieIds?: string[];`,
  'active table die ids',
);
const adapter = `function cloneBridgePhysicalPresentation(\n  presentation: DraftrollPhysicalVisual['presentation'],\n): DraftrollPhysicalVisual['presentation'] {\n  return presentation\n    ? { contents: presentation.contents.map((content) => ({ ...content })) }\n    : undefined;\n}\n\nfunction physicalBridgeFallback(visual: DraftrollPhysicalVisual): DraftrollFallbackVisual {\n  return {\n    id: visual.id,\n    type: visual.type,\n    kind: 'spinner',\n    result: visual.outcomeIndex + 1,\n    numericValue: visual.outcomeIndex + 1,\n    sides: visual.sides,\n    title: visual.title,\n    label: visual.label,\n    theme: visual.theme,\n    outcome: visual.outcome,\n    metadata: {\n      ...visual.metadata,\n      draftrollPhysicalModel: true,\n      draftrollPhysicalOutcomeIndex: visual.outcomeIndex,\n      draftrollPhysicalSemanticResult: visual.result,\n      ...(visual.presentation\n        ? { draftrollPhysicalPresentation: cloneBridgePhysicalPresentation(visual.presentation) }\n        : {}),\n    },\n  };\n}\n\nfunction translatePhysicalTableContext(\n  context: Record<string, unknown>,\n  visualOrder: readonly DraftrollVisualOrderEntry[],\n): Record<string, unknown> {\n  const raw = Array.isArray(context.tableRolls) ? context.tableRolls : null;\n  if (!raw) return context;\n  const tableRolls = raw.map((value) => {\n    if (!isRecord(value) || !Array.isArray(value.dieIds)) return value;\n    const dieIds = value.dieIds.filter((id): id is string => typeof id === 'string');\n    const ids = new Set(dieIds);\n    const physicalIndexes = visualOrder\n      .filter((entry) => entry.kind === 'physical' && ids.has(entry.dieId))\n      .map((entry) => entry.index);\n    const fallbackIndexes = visualOrder\n      .filter((entry) => entry.kind === 'fallback' && ids.has(entry.dieId))\n      .map((entry) => entry.index);\n    return {\n      ...value,\n      dieIds,\n      physicalStart: physicalIndexes.length > 0 ? Math.min(...physicalIndexes) : 0,\n      physicalCount: physicalIndexes.length,\n      fallbackStart: fallbackIndexes.length > 0 ? Math.min(...fallbackIndexes) : 0,\n      fallbackCount: fallbackIndexes.length,\n      visualCount: physicalIndexes.length + fallbackIndexes.length,\n    };\n  });\n  return { ...context, tableRolls };\n}\n\n/**\n * Converts the new all-physical bridge contract into the engine's temporary canonical/supplemental\n * storage layout. The distinction stops here: the shared worker receives both as physical bodies.\n */\nfunction normalizePhysicalBridgeRequest(request: DiceRollRequest): DiceRollRequest {\n  if (!request.physical) return request;\n  const physical = request.physical.map((visual) => ({\n    ...visual,\n    physics: visual.physics ? { ...visual.physics } : undefined,\n    presentation: cloneBridgePhysicalPresentation(visual.presentation),\n    metadata: visual.metadata ? { ...visual.metadata } : undefined,\n  }));\n  const canonicalResults: number[] = [];\n  const canonicalKinds: DieKind[] = [];\n  const canonicalThemes: ThemeName[] = [];\n  const canonicalOutcomes: EffectOutcome[] = [];\n  const canonicalPhysics: DicePhysicsProperties[] = [];\n  const canonicalByPublicIndex = new Map<number, number>();\n  const generatedByPublicIndex = new Map<number, number>();\n  const generatedFallbacks: DraftrollFallbackVisual[] = [];\n\n  physical.forEach((visual, publicIndex) => {\n    if (\n      !Number.isSafeInteger(visual.sides) ||\n      visual.sides < 1 ||\n      visual.sides > 256 ||\n      !Number.isSafeInteger(visual.outcomeIndex) ||\n      visual.outcomeIndex < 0 ||\n      visual.outcomeIndex >= visual.sides\n    ) {\n      throw new Error(\`Invalid physical die descriptor: \${visual.id}\`);\n    }\n    const canonicalKind =\n      visual.canonicalKind && isDieKind(visual.canonicalKind)\n        ? visual.canonicalKind\n        : isDieKind(visual.type)\n          ? visual.type\n          : null;\n    if (canonicalKind) {\n      canonicalByPublicIndex.set(publicIndex, canonicalResults.length);\n      canonicalResults.push(visual.outcomeIndex + 1);\n      canonicalKinds.push(canonicalKind);\n      canonicalThemes.push(visual.theme);\n      canonicalOutcomes.push(visual.outcome);\n      canonicalPhysics.push({ ...visual.physics });\n      return;\n    }\n    generatedByPublicIndex.set(publicIndex, generatedFallbacks.length);\n    generatedFallbacks.push(physicalBridgeFallback(visual));\n  });\n\n  const ordinaryFallbacks =\n    request.fallbacks?.map((fallback) => ({\n      ...fallback,\n      metadata: fallback.metadata ? { ...fallback.metadata } : undefined,\n    })) ?? [];\n  const publicOrder =\n    request.visualOrder ??\n    [\n      ...physical.map((visual, index) => ({\n        kind: 'physical' as const,\n        index,\n        dieId: visual.id,\n      })),\n      ...ordinaryFallbacks.map((fallback, index) => ({\n        kind: 'fallback' as const,\n        index,\n        dieId: fallback.id,\n      })),\n    ];\n  const visualOrder = publicOrder.map((entry): DraftrollVisualOrderEntry => {\n    if (entry.kind === 'fallback') {\n      return { ...entry, index: generatedFallbacks.length + entry.index };\n    }\n    const canonicalIndex = canonicalByPublicIndex.get(entry.index);\n    if (canonicalIndex !== undefined) return { ...entry, index: canonicalIndex };\n    const generatedIndex = generatedByPublicIndex.get(entry.index);\n    if (generatedIndex === undefined) throw new Error('Physical visual ordering is invalid');\n    return { kind: 'fallback', index: generatedIndex, dieId: entry.dieId };\n  });\n  const context = translatePhysicalTableContext({ ...request.context }, visualOrder);\n  return {\n    ...request,\n    physical: undefined,\n    results: canonicalResults,\n    kinds: canonicalKinds,\n    themes: canonicalThemes,\n    outcomes: canonicalOutcomes,\n    physics: canonicalPhysics,\n    fallbacks: [...generatedFallbacks, ...ordinaryFallbacks],\n    visualOrder,\n    context,\n  };\n}\n\n`;
main = replaceOnce(main, `interface AdditivePhysicalRequest {`, `${adapter}interface AdditivePhysicalRequest {`, 'physical bridge adapter insertion');
main = replaceOnce(
  main,
  `  roll: (request) => {\n    if (\n      request &&\n      typeof request === 'object' &&\n      !Array.isArray(request) &&\n      canAppendTableRequest(request)`,
  `  roll: (input) => {\n    const request =\n      input && typeof input === 'object' && !Array.isArray(input)\n        ? normalizePhysicalBridgeRequest(input)\n        : input;\n    if (\n      request &&\n      typeof request === 'object' &&\n      !Array.isArray(request) &&\n      canAppendTableRequest(request)`,
  'bridge normalizes physical request',
);
main = replaceOnce(
  main,
  `          groupId:\n            typeof entry.groupId === 'string'\n              ? entry.groupId\n              : \`table-add-\${physicalStart}-\${index}\`,`,
  `          groupId:\n            typeof entry.groupId === 'string'\n              ? entry.groupId\n              : \`table-add-\${physicalStart}-\${index}\`,\n          dieIds: Array.isArray(entry.dieIds)\n            ? entry.dieIds.filter((id): id is string => typeof id === 'string')\n            : undefined,`,
  'incoming raw group ids',
);
main = replaceOnce(
  main,
  `      groupId: typeof context.rollId === 'string' ? context.rollId : \`table-add-\${physicalStart}\`,\n      actorLabel:`,
  `      groupId: typeof context.rollId === 'string' ? context.rollId : \`table-add-\${physicalStart}\`,\n      dieIds: Array.isArray(context.renderedDieIds)\n        ? context.renderedDieIds.filter((id): id is string => typeof id === 'string')\n        : undefined,\n      actorLabel:`,
  'default incoming group ids',
);
main = replaceOnce(
  main,
  `      total: singleRollCompletedTotal ?? previous.total,\n      physicalCount: previous.physicalCount + addition.physicalCount,`,
  `      total: singleRollCompletedTotal ?? previous.total,\n      dieIds: [...new Set([...(previous.dieIds ?? []), ...(addition.dieIds ?? [])])],\n      physicalCount: previous.physicalCount + addition.physicalCount,`,
  'merge group ids',
);
const oldEffectGroup = `function effectGroupId(kind: 'physical' | 'fallback', index: number): string {\n  const group = readActiveTableRolls().find((entry) =>\n    kind === 'physical'\n      ? index >= entry.physicalStart && index < entry.physicalStart + entry.physicalCount\n      : index >= entry.fallbackStart && index < entry.fallbackStart + entry.fallbackCount,\n  );`;
const newEffectGroup = `function effectGroupId(kind: 'physical' | 'fallback', index: number): string {\n  const dieId = kind === 'physical' ? physicalVisualId(index) : fallbackVisualId(index);\n  const group = readActiveTableRolls().find((entry) =>\n    entry.dieIds?.includes(dieId) ??\n    (kind === 'physical'\n      ? index >= entry.physicalStart && index < entry.physicalStart + entry.physicalCount\n      : index >= entry.fallbackStart && index < entry.fallbackStart + entry.fallbackCount),\n  );`;
main = replaceOnce(main, oldEffectGroup, newEffectGroup, 'effect groups use ids');
await writeFile(new URL('../src/main.ts', import.meta.url), main);

// --- Generated physical presentation: semantic text/icons + arbitrary theme meshes. ---
let physicalVisuals = await readFile(new URL('../src/physical-die-visuals.ts', import.meta.url), 'utf8');
physicalVisuals = replaceOnce(
  physicalVisuals,
  `  createDefaultPhysicalDiePresentation,\n  createGeneratedPhysicalDieDefinition,\n  physicalDieColliderRadius,\n  remapPhysicalDiePresentation,\n  type PhysicalDieDefinition,\n  type PhysicalDiePresentation,`,
  `  createDefaultPhysicalDiePresentation,\n  createGeneratedPhysicalDieDefinition,\n  createPhysicalDiePresentation,\n  physicalDieColliderRadius,\n  type PhysicalDieDefinition,\n  type PhysicalDieFaceContent,\n  type PhysicalDiePresentation,`,
  'physical presentation imports',
);
physicalVisuals = replaceOnce(
  physicalVisuals,
  `import { getRuntimeThemeMaterial, getRuntimeThemeTexture } from './runtime-themes';`,
  `import {\n  getRuntimeThemeFont,\n  getRuntimeThemeMaterial,\n  getRuntimeThemeMesh,\n  getRuntimeThemeTexture,\n} from './runtime-themes';\nimport { THEMES } from './themes';`,
  'theme physical visual imports',
);
physicalVisuals = replaceOnce(
  physicalVisuals,
  `function resultOf(spec: DraftrollFallbackVisual, sides: number): number {\n  const raw = typeof spec.result === 'number' ? spec.result : Number(spec.numericValue);\n  return Number.isFinite(raw) ? THREE.MathUtils.clamp(Math.round(raw), 1, sides) : 1;\n}`,
  `function requestedOutcomeIndex(spec: DraftrollFallbackVisual, sides: number): number {\n  const explicit = spec.metadata?.draftrollPhysicalOutcomeIndex;\n  if (Number.isSafeInteger(explicit) && Number(explicit) >= 0 && Number(explicit) < sides) {\n    return Number(explicit);\n  }\n  const raw = typeof spec.result === 'number' ? spec.result : Number(spec.numericValue);\n  const value = Number.isFinite(raw) ? THREE.MathUtils.clamp(Math.round(raw), 1, sides) : 1;\n  return value - 1;\n}\n\nfunction parsePhysicalFaceContent(value: unknown): PhysicalDieFaceContent | null {\n  if (!value || typeof value !== 'object') return null;\n  const record = value as Record<string, unknown>;\n  const label = typeof record.label === 'string' ? record.label : undefined;\n  if (record.kind === 'number' && typeof record.value === 'number' && Number.isFinite(record.value)) {\n    return { kind: 'number', value: record.value, label };\n  }\n  if (record.kind === 'text' && typeof record.text === 'string') {\n    return { kind: 'text', text: record.text };\n  }\n  if (record.kind === 'icon' && typeof record.icon === 'string') {\n    return { kind: 'icon', icon: record.icon, label };\n  }\n  if (record.kind === 'texture' && typeof record.asset === 'string') {\n    return { kind: 'texture', asset: record.asset, label };\n  }\n  return null;\n}\n\nfunction readPhysicalPresentation(\n  spec: DraftrollFallbackVisual,\n  definition: PhysicalDieDefinition,\n): { presentation: PhysicalDiePresentation; explicit: boolean } {\n  const raw = spec.metadata?.draftrollPhysicalPresentation;\n  if (raw && typeof raw === 'object' && Array.isArray((raw as { contents?: unknown }).contents)) {\n    const contents = (raw as { contents: unknown[] }).contents.map(parsePhysicalFaceContent);\n    if (contents.length === definition.outcomes.length && contents.every(Boolean)) {\n      return {\n        presentation: createPhysicalDiePresentation(\n          definition,\n          contents.filter((content): content is PhysicalDieFaceContent => content !== null),\n        ),\n        explicit: true,\n      };\n    }\n  }\n  return { presentation: createDefaultPhysicalDiePresentation(definition), explicit: false };\n}\n\nfunction presentationTexture(\n  spec: DraftrollFallbackVisual,\n  content: PhysicalDieFaceContent,\n): THREE.CanvasTexture {\n  const canvas = document.createElement('canvas');\n  canvas.width = 256;\n  canvas.height = 256;\n  const context = canvas.getContext('2d');\n  if (!context) throw new Error('Canvas 2D context unavailable.');\n  const palette = THEMES[spec.theme] ?? THEMES.dragon;\n  const text =\n    content.kind === 'number'\n      ? (content.label ?? String(content.value))\n      : content.kind === 'text'\n        ? content.text\n        : content.kind === 'icon'\n          ? content.icon\n          : (content.label ?? '◆');\n  const length = [...text].length;\n  const fontSize = content.kind === 'icon' ? 148 : length >= 5 ? 64 : length >= 3 ? 86 : 132;\n  context.textAlign = 'center';\n  context.textBaseline = 'middle';\n  context.lineJoin = 'round';\n  context.font = `800 ${fontSize}px ${getRuntimeThemeFont(spec.theme) ?? 'system-ui, sans-serif'}`;\n  context.lineWidth = Math.max(7, Math.round(fontSize * 0.08));\n  context.strokeStyle = 'rgba(0,0,0,.72)';\n  context.strokeText(text, 128, 126);\n  context.fillStyle = palette.label;\n  context.fillText(text, 128, 126);\n  const texture = new THREE.CanvasTexture(canvas);\n  texture.colorSpace = THREE.SRGBColorSpace;\n  texture.anisotropy = 8;\n  return texture;\n}`,
  'semantic physical presentation helpers',
);
physicalVisuals = replaceOnce(
  physicalVisuals,
  `  private readonly defaultPresentation: PhysicalDiePresentation;`,
  `  private readonly defaultPresentation: PhysicalDiePresentation;\n  private readonly requestedOutcome: number;`,
  'requested outcome field',
);
physicalVisuals = replaceOnce(
  physicalVisuals,
  `    this.definition = createGeneratedPhysicalDieDefinition(sides);\n    this.defaultPresentation = createDefaultPhysicalDiePresentation(this.definition);`,
  `    this.definition = createGeneratedPhysicalDieDefinition(sides);\n    const resolvedPresentation = readPhysicalPresentation(spec, this.definition);\n    this.defaultPresentation = resolvedPresentation.presentation;\n    this.requestedOutcome = requestedOutcomeIndex(spec, sides);`,
  'resolve physical presentation',
);
physicalVisuals = replaceOnce(
  physicalVisuals,
  `      body.material.needsUpdate = true;\n    }\n\n    const labelMeshes = inner.children`,
  `      body.material.needsUpdate = true;\n\n      const runtimeMesh =\n        getRuntimeThemeMesh(spec.theme, spec.type) ??\n        getRuntimeThemeMesh(spec.theme, \`d\${sides}\`);\n      if (runtimeMesh) {\n        const themedGeometry = runtimeMesh.clone();\n        themedGeometry.computeBoundingSphere();\n        const radius = themedGeometry.boundingSphere?.radius ?? 0;\n        if (radius > 1e-6) {\n          const scale = this.definition.radius / radius;\n          themedGeometry.scale(scale, scale, scale);\n        }\n        themedGeometry.computeVertexNormals();\n        themedGeometry.computeBoundingSphere();\n        body.geometry = themedGeometry;\n        this.extraGeometries.push(themedGeometry);\n        const edgeObject = inner.children[1];\n        if (edgeObject instanceof THREE.LineSegments) {\n          const themedEdges = new THREE.EdgesGeometry(themedGeometry, 18);\n          edgeObject.geometry = themedEdges;\n          this.extraGeometries.push(themedEdges);\n        }\n      }\n    }\n\n    const labelMeshes = inner.children`,
  'arbitrary theme mesh override',
);
const oldLabelMapBlock = `    const runtimeAtlas =\n      getRuntimeThemeTexture(spec.theme, spec.type, 'label') ??\n      getRuntimeThemeTexture(spec.theme, \`d\${sides}\`, 'label');\n    if (runtimeAtlas && sides <= 20) {\n      this.originalLabelMaps = this.definition.outcomes.map((outcome) => {\n        const texture = atlasCellTexture(runtimeAtlas, outcome.value);\n        this.ownedLabelTextures.push(texture);\n        return texture;\n      });\n      this.labelMaterials.forEach((material, index) => {\n        material.map = this.originalLabelMaps[index] ?? null;\n        material.needsUpdate = true;\n      });\n    } else {\n      this.originalLabelMaps = this.labelMaterials.map((material) => material.map);\n    }`;
const newLabelMapBlock = `    const runtimeAtlas =\n      getRuntimeThemeTexture(spec.theme, spec.type, 'label') ??\n      getRuntimeThemeTexture(spec.theme, \`d\${sides}\`, 'label');\n    this.originalLabelMaps = this.definition.outcomes.map((outcome, index) => {\n      if (resolvedPresentation.explicit) {\n        const texture = presentationTexture(\n          spec,\n          this.defaultPresentation.contents[index] ?? { kind: 'number', value: outcome.value },\n        );\n        this.ownedLabelTextures.push(texture);\n        return texture;\n      }\n      if (runtimeAtlas && sides <= 20) {\n        const texture = atlasCellTexture(runtimeAtlas, outcome.value);\n        this.ownedLabelTextures.push(texture);\n        return texture;\n      }\n      return this.labelMaterials[index]?.map ?? null;\n    });\n    this.labelMaterials.forEach((material, index) => {\n      material.map = this.originalLabelMaps[index] ?? null;\n      material.needsUpdate = true;\n    });`;
physicalVisuals = replaceOnce(physicalVisuals, oldLabelMapBlock, newLabelMapBlock, 'physical label map selection');
const oldApplyRequested = `  private applyRequestedResult(landed: number): void {\n    const requested = resultOf(this.spec, this.sides);\n    const remapped = remapPhysicalDiePresentation(\n      this.definition,\n      this.defaultPresentation,\n      requested,\n      landed,\n    );\n    remapped.contents.forEach((content, targetIndex) => {\n      const sourceIndex =\n        content.kind === 'number'\n          ? this.definition.outcomes.findIndex((outcome) => outcome.value === content.value)\n          : targetIndex;\n      const material = this.labelMaterials[targetIndex];\n      if (!material) return;\n      material.map = this.originalLabelMaps[sourceIndex >= 0 ? sourceIndex : targetIndex] ?? null;\n      material.needsUpdate = true;\n    });\n  }`;
const newApplyRequested = `  private applyRequestedResult(landed: number): void {\n    if (this.definition.targeting !== 'relabel') return;\n    const requested = THREE.MathUtils.clamp(\n      Math.round(this.requestedOutcome),\n      0,\n      this.definition.outcomes.length - 1,\n    );\n    const landing = THREE.MathUtils.clamp(\n      Math.round(landed),\n      0,\n      this.definition.outcomes.length - 1,\n    );\n    if (requested === landing) return;\n    const requestedMap = this.originalLabelMaps[requested] ?? null;\n    const landingMap = this.originalLabelMaps[landing] ?? null;\n    const requestedMaterial = this.labelMaterials[requested];\n    const landingMaterial = this.labelMaterials[landing];\n    if (requestedMaterial) {\n      requestedMaterial.map = landingMap;\n      requestedMaterial.needsUpdate = true;\n    }\n    if (landingMaterial) {\n      landingMaterial.map = requestedMap;\n      landingMaterial.needsUpdate = true;\n    }\n  }`;
physicalVisuals = replaceOnce(physicalVisuals, oldApplyRequested, newApplyRequested, 'slot presentation remap');
await writeFile(new URL('../src/physical-die-visuals.ts', import.meta.url), physicalVisuals);

// --- Runtime themes: arbitrary die IDs may supply a visual mesh. ---
let runtimeThemes = await readFile(new URL('../src/runtime-themes.ts', import.meta.url), 'utf8');
runtimeThemes = replaceOnce(runtimeThemes, `import type { DieKind } from './physics-shapes';\n`, ``, 'remove canonical mesh type import');
runtimeThemes = replaceOnce(
  runtimeThemes,
  `export function getRuntimeThemeMesh(\n  themeId: string,\n  kind: DieKind,\n): THREE.BufferGeometry | undefined {`,
  `export function getRuntimeThemeMesh(\n  themeId: string,\n  kind: string,\n): THREE.BufferGeometry | undefined {`,
  'generic runtime theme mesh lookup',
);
runtimeThemes = replaceOnce(
  runtimeThemes,
  `    if (!definition || !isPhysicalKind(kind)) continue;`,
  `    if (!definition) continue;`,
  'load arbitrary theme meshes',
);
runtimeThemes = replaceRegexOnce(
  runtimeThemes,
  /\nfunction isPhysicalKind\(value: string\): value is DieKind \{[\s\S]*?\n\}\n?$/,
  `\n`,
  'remove canonical theme mesh guard',
);
await writeFile(new URL('../src/runtime-themes.ts', import.meta.url), runtimeThemes);

let themes = await readFile(new URL('../packages/themes/src/index.ts', import.meta.url), 'utf8');
themes = replaceOnce(
  themes,
  `  /** A 5x4 atlas containing values 1 through 20. */`,
  `  /** A 5x4 atlas containing physical outcome slots 1 through 20; cells may be numbers or icons. */`,
  'theme atlas semantics',
);
themes = replaceOnce(
  themes,
  `  /** Optional die-specific atlas override. */`,
  `  /** Optional die-specific outcome-slot atlas override, including arbitrary dN identifiers. */`,
  'theme die atlas docs',
);
await writeFile(new URL('../packages/themes/src/index.ts', import.meta.url), themes);

// --- Tests now assert public physical classification rather than spinner promotion. ---
let mixed = await readFile(new URL('./test-mixed-renderer.mjs', import.meta.url), 'utf8');
mixed = replaceOnce(
  mixed,
  `      const physicalResults = Array.isArray(request.results)\n        ? request.results\n        : request.results === undefined\n          ? []\n          : [request.results];\n      const fallbackResults = (request.fallbacks ?? []).map((fallback) => fallback.result);\n      return {\n        results: [...physicalResults, ...fallbackResults],\n        total: physicalResults.reduce((sum, value) => sum + value, 0),`,
  `      const physicalResults = (request.physical ?? []).map((visual) => visual.result);\n      const physicalValues = (request.physical ?? []).map((visual) =>\n        typeof visual.numericValue === 'number'\n          ? visual.numericValue\n          : typeof visual.result === 'number'\n            ? visual.result\n            : 0,\n      );\n      const fallbackResults = (request.fallbacks ?? []).map((fallback) => fallback.result);\n      return {\n        results: [...physicalResults, ...fallbackResults],\n        total: physicalValues.reduce((sum, value) => sum + value, 0),`,
  'mixed bridge understands physical descriptors',
);
mixed = replaceOnce(
  mixed,
  `  assert.deepEqual(calls[0].kinds, ['d20', 'd8', 'd6', 'd6']);\n  assert.deepEqual(calls[0].results, [17, 6, 4, 4]);\n  assert.deepEqual(calls[0].themes, ['dragon', 'frost', 'ember', 'dragon']);`,
  `  assert.deepEqual(\n    calls[0].physical.map((visual) => visual.canonicalKind),\n    ['d20', 'd8', 'd6', 'd6'],\n  );\n  assert.deepEqual(\n    calls[0].physical.map((visual) => visual.result),\n    [17, 6, 4, 4],\n  );\n  assert.deepEqual(\n    calls[0].physical.map((visual) => visual.theme),\n    ['dragon', 'frost', 'ember', 'dragon'],\n  );`,
  'mixed physical assertions',
);
mixed = replaceOnce(
  mixed,
  `  assert.deepEqual(calls[1].kinds, ['d20', 'coin']);\n  assert.deepEqual(calls[1].results, [17, 2]);\n  assert.deepEqual(\n    calls[1].fallbacks.map((fallback) => fallback.kind),\n    ['coin', 'fate', 'spinner', 'percentile', 'card', 'token'],\n  );`,
  `  assert.deepEqual(\n    calls[1].physical.map((visual) => visual.type),\n    ['d20', 'd2', 'd9'],\n  );\n  assert.deepEqual(\n    calls[1].physical.map((visual) => visual.outcomeIndex),\n    [16, 1, 6],\n  );\n  assert.deepEqual(\n    calls[1].fallbacks.map((fallback) => fallback.kind),\n    ['coin', 'fate', 'percentile', 'card', 'token'],\n  );`,
  'universal physical classification',
);
mixed = replaceOnce(
  mixed,
  `      'fallback',\n      'fallback',\n      'fallback',\n      'fallback',\n      'fallback',\n      'fallback',`,
  `      'fallback',\n      'fallback',\n      'physical',\n      'fallback',\n      'fallback',\n      'fallback',`,
  'universal order classification',
);
mixed = replaceOnce(mixed, `  assert.equal(calls[1].fallbacks[4].label, 'Success');\n  assert.equal(calls[1].fallbacks[5].label, 'Storm');`, `  assert.equal(calls[1].fallbacks[3].label, 'Success');\n  assert.equal(calls[1].fallbacks[4].label, 'Storm');`, 'fallback shifted labels');
mixed = replaceOnce(mixed, `  assert.deepEqual(calls[2].results, []);`, `  assert.deepEqual(calls[2].physical, []);`, 'total-only physical');
mixed = replaceOnce(
  mixed,
  `        physicalKinds: calls[0].kinds,`,
  `        physicalKinds: calls[0].physical.map((visual) => visual.canonicalKind ?? visual.type),`,
  'mixed output physical kinds',
);
await writeFile(new URL('./test-mixed-renderer.mjs', import.meta.url), mixed);

let smoke = await readFile(new URL('./test-visual-fallbacks.mjs', import.meta.url), 'utf8');
smoke = replaceOnce(
  smoke,
  `assert.match(renderer, /DraftrollFallbackVisual/);\nassert.match(renderer, /visualOrder/);`,
  `assert.match(renderer, /DraftrollFallbackVisual/);\nassert.match(renderer, /interface DraftrollPhysicalVisual/);\nassert.match(renderer, /physical\?: DraftrollPhysicalVisual\[\]/);\nassert.match(renderer, /resolvePhysicalSlot/);\nassert.match(renderer, /createCustomPhysicalPresentation/);\nassert.match(renderer, /visualOrder/);`,
  'smoke public physical bridge',
);
smoke = replaceOnce(
  smoke,
  `// Numeric spinner inputs are promoted immediately into the physical model.`,
  `// Legacy spinner inputs are accepted only at the browser compatibility boundary; SDK dN is physical.`,
  'smoke physical classification comment',
);
smoke = replaceOnce(
  smoke,
  `assert.match(physicalVisuals, /remapPhysicalDiePresentation/);`,
  `assert.match(physicalVisuals, /draftrollPhysicalPresentation/);\nassert.match(physicalVisuals, /presentationTexture/);\nassert.match(physicalVisuals, /content\.kind === 'icon'/);`,
  'smoke semantic physical presentation',
);
smoke = replaceOnce(
  smoke,
  `assert.match(physicalVisuals, /getRuntimeThemeMaterial/);`,
  `assert.match(physicalVisuals, /getRuntimeThemeMaterial/);\nassert.match(physicalVisuals, /getRuntimeThemeMesh/);`,
  'smoke arbitrary theme mesh',
);
smoke = replaceOnce(
  smoke,
  `      runtimeThemeArtwork: true,`,
  `      runtimeThemeArtwork: true,\n      publicGeneratedDiceArePhysical: true,\n      semanticPhysicalFaceContent: true,\n      arbitraryThemeMeshes: true,`,
  'smoke output bridge flags',
);
await writeFile(new URL('./test-visual-fallbacks.mjs', import.meta.url), smoke);

console.log('Unified physical bridge migration applied.');
