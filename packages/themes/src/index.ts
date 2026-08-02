/**
 * Runtime dice-theme contracts and providers.
 *
 * @remarks
 * Validates theme manifests, resolves assets, and composes bundled, HTTP, and cached providers.
 *
 * @packageDocumentation
 */

/**
 * Current runtime theme-manifest schema version.
 *
 * @public
 */
export const DRAFTROLL_THEME_SCHEMA_VERSION = 1 as const;

/**
 * Die identifier that a theme can style.
 *
 * @public
 */
export type ThemeDieType = 'd2' | 'd4' | 'd6' | 'd8' | 'd10' | 'd10x' | 'd12' | 'd20' | 'd100' | 'dF' | (string & {});
/**
 * Semantic outcome slots available to a theme.
 *
 * @public
 */
export type ThemeEffectOutcome = 'positive' | 'neutral' | 'negative';

/**
 * Validated URI, integrity, and byte limits for one theme asset.
 *
 * @public
 */
export interface ThemeAssetReference {
  src: string;
  mimeType?: string;
  integrity?: string;
}

/**
 * PBR material overrides supplied by a theme.
 *
 * @public
 */
export interface ThemeMaterialDefinition {
  color?: string | number;
  emissive?: string | number;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  opacity?: number;
  surfaceTexture?: ThemeAssetReference;
  normalTexture?: ThemeAssetReference;
  roughnessTexture?: ThemeAssetReference;
}

/**
 * Label atlas and typography settings supplied by a theme.
 *
 * @public
 */
export interface ThemeLabelDefinition {
  color?: string;
  glowColor?: string;
  fontFamily?: string;
  font?: ThemeAssetReference;
  /** A 5x4 atlas containing values 1 through 20. */
  atlas?: ThemeAssetReference;
  /** Optional die-specific atlas override. */
  atlases?: Partial<Record<ThemeDieType, ThemeAssetReference>>;
}

/**
 * Validated visual mesh reference supplied by a theme.
 *
 * @public
 */
export interface ThemeMeshDefinition {
  /** glTF binary (`.glb`) or JSON glTF. */
  asset: ThemeAssetReference;
  scale?: number;
  maxVertices?: number;
}

/**
 * Audio asset references and gain settings supplied by a theme.
 *
 * @public
 */
export interface ThemeAudioDefinition {
  impact?: ThemeAssetReference;
  roll?: ThemeAssetReference;
  volume?: number;
  playbackRate?: [number, number];
}

/**
 * Built-in or custom visual effect configuration.
 *
 * @public
 */
export type ThemeEffectPreset =
  | 'major-burst'
  | 'subtle-pulse'
  | 'void-fracture'
  | 'ember-fracture'
  | 'frost-fracture'
  | 'none';

/**
 * Per-theme physical scaling defaults.
 *
 * @public
 */
export interface ThemePhysicsDefinition {
  sizeScale?: number;
  massScale?: number;
  inertiaScale?: number;
}

/**
 * Optional feature flags advertised by a theme.
 *
 * @public
 */
export interface DiceThemeCapabilities {
  materials?: boolean;
  textures?: boolean;
  decals?: boolean;
  fonts?: boolean;
  audio?: boolean;
  effects?: boolean;
  meshes?: boolean;
  physics?: boolean;
}

/**
 * Validated manifest for one runtime dice theme.
 *
 * @public
 */
export interface DiceTheme {
  schemaVersion: typeof DRAFTROLL_THEME_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  renderer?: 'draftroll' | (string & {});
  description?: string;
  author?: string;
  previews?: Partial<Record<ThemeDieType | 'default', string>>;
  availableDice?: ThemeDieType[];
  capabilities?: DiceThemeCapabilities;
  material?: ThemeMaterialDefinition;
  materials?: Partial<Record<ThemeDieType, ThemeMaterialDefinition>>;
  labels?: ThemeLabelDefinition;
  meshes?: Partial<Record<ThemeDieType, ThemeMeshDefinition>>;
  audio?: ThemeAudioDefinition;
  effects?: Partial<Record<ThemeEffectOutcome, ThemeEffectPreset>>;
  physics?: ThemePhysicsDefinition & { dice?: Partial<Record<ThemeDieType, ThemePhysicsDefinition>> };
  metadata?: Record<string, unknown>;
}

/**
 * Loads theme manifests and their referenced assets.
 *
 * @public
 */
export interface ThemeProvider {
  getTheme(id: string, options?: { signal?: AbortSignal }): Promise<DiceTheme>;
  getAsset(reference: string, options?: { signal?: AbortSignal }): Promise<ArrayBuffer | Blob>;
  listThemes?(options?: { signal?: AbortSignal }): Promise<DiceTheme[]>;
}

/**
 * Resolved asset bytes and content type returned by a provider.
 *
 * @public
 */
export interface ThemeResourceAsset {
  mimeType: string;
  data: ArrayBuffer;
}

/**
 * Prepared theme plus resolved runtime assets.
 *
 * @public
 */
export interface RuntimeThemeBundle {
  manifest: DiceTheme;
  assets: Record<string, ThemeResourceAsset>;
}

/**
 * Theme loading lifecycle events.
 *
 * @public
 */
export type ThemeLoadEvent =
  | { type: 'manifest'; themeId: string }
  | { type: 'asset-start'; themeId: string; reference: string; loaded: number; total: number }
  | { type: 'asset-complete'; themeId: string; reference: string; loaded: number; total: number }
  | { type: 'complete'; themeId: string; loaded: number; total: number }
  | { type: 'error'; themeId: string; reference?: string; error: Error };

/**
 * Controls cancellation, progress reporting, and per-asset or aggregate byte limits.
 *
 * @public
 */
export interface PrepareThemeOptions {
  signal?: AbortSignal;
  onEvent?: (event: ThemeLoadEvent) => void;
  maximumAssetBytes?: number;
  maximumTotalBytes?: number;
}

/**
 * Error raised for theme not found failures.
 *
 * @public
 */
export class ThemeNotFoundError extends Error {
  /**
   * Creates a ThemeNotFoundError instance.
   */
  constructor(public readonly themeId: string) {
    super(`Theme not found: ${themeId}`);
    this.name = 'ThemeNotFoundError';
  }
}

/**
 * Error raised for invalid theme failures.
 *
 * @public
 */
export class InvalidThemeError extends Error {
  /**
   * Creates a InvalidThemeError instance.
   */
  constructor(message: string, public readonly path?: string) {
    super(path ? `${message} (${path})` : message);
    this.name = 'InvalidThemeError';
  }
}

/**
 * Error raised for theme asset limit failures.
 *
 * @public
 */
export class ThemeAssetLimitError extends Error {
  /**
   * Creates a ThemeAssetLimitError instance.
   */
  constructor(message: string, public readonly reference: string) {
    super(message);
    this.name = 'ThemeAssetLimitError';
  }
}

/**
 * Validates and normalizes an untrusted theme manifest.
 *
 * @public
 */
export function decodeDiceTheme(value: unknown): DiceTheme {
  if (!isRecord(value)) throw new InvalidThemeError('Theme manifest must be an object');
  if (value.schemaVersion !== DRAFTROLL_THEME_SCHEMA_VERSION) {
    throw new InvalidThemeError(`Unsupported theme schema version: ${String(value.schemaVersion)}`, 'schemaVersion');
  }
  const id = readIdentifier(value.id, 'id');
  const name = readText(value.name, 'name', 120);
  const version = readText(value.version, 'version', 64);
  // Trusted narrowing point: the field checks above and the per-section validation
  // below establish the manifest shape before it is returned to callers.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const theme = structuredClone(value) as unknown as DiceTheme;
  theme.id = id;
  theme.name = name;
  theme.version = version;

  if (theme.availableDice) {
    if (!Array.isArray(theme.availableDice) || theme.availableDice.length > 128) {
      throw new InvalidThemeError('availableDice must be an array with at most 128 entries', 'availableDice');
    }
    theme.availableDice = theme.availableDice.map((entry, index) => readIdentifier(entry, `availableDice.${index}`));
  }
  validateMaterial(theme.material, 'material');
  for (const [die, material] of Object.entries(theme.materials ?? {})) validateMaterial(material, `materials.${die}`);
  validateLabels(theme.labels);
  validateAsset(theme.audio?.impact, 'audio.impact');
  validateAsset(theme.audio?.roll, 'audio.roll');
  for (const [die, mesh] of Object.entries(theme.meshes ?? {})) {
    if (!mesh) continue;
    validateAsset(mesh.asset, `meshes.${die}.asset`);
    validateRange(mesh.scale, 0.05, 20, `meshes.${die}.scale`);
    validateRange(mesh.maxVertices, 3, 250_000, `meshes.${die}.maxVertices`);
  }
  validatePhysics(theme.physics, 'physics');
  for (const [die, physics] of Object.entries(theme.physics?.dice ?? {})) validatePhysics(physics, `physics.dice.${die}`);
  return theme;
}

/**
 * Returns every asset reference declared by a theme.
 *
 * @public
 */
export function listThemeAssetReferences(theme: DiceTheme): ThemeAssetReference[] {
  const references: ThemeAssetReference[] = [];
  const add = (reference?: ThemeAssetReference) => {
    if (reference && !references.some((candidate) => candidate.src === reference.src)) references.push(reference);
  };
  add(theme.material?.surfaceTexture);
  add(theme.material?.normalTexture);
  add(theme.material?.roughnessTexture);
  for (const material of Object.values(theme.materials ?? {})) {
    if (!material) continue;
    add(material.surfaceTexture);
    add(material.normalTexture);
    add(material.roughnessTexture);
  }
  add(theme.labels?.font);
  add(theme.labels?.atlas);
  for (const atlas of Object.values(theme.labels?.atlases ?? {})) add(atlas);
  for (const mesh of Object.values(theme.meshes ?? {})) if (mesh) add(mesh.asset);
  add(theme.audio?.impact);
  add(theme.audio?.roll);
  return references;
}

/**
 * Loads, validates, integrity-checks, and size-bounds all assets required by a theme.
 *
 * @param provider - Application or network-backed source for manifests and assets.
 * @param themeId - Stable theme identifier to prepare.
 * @param options - Cancellation, progress, and resource-limit controls.
 * @returns A detached validated manifest and its loaded assets.
 * @throws {@link ThemeNotFoundError} when the provider cannot resolve `themeId`.
 * @throws {@link InvalidThemeError} when the manifest or an asset is invalid.
 * @throws {@link ThemeAssetLimitError} when configured byte limits are exceeded.
 *
 * @public
 */
export async function prepareRuntimeTheme(
  provider: ThemeProvider,
  themeId: string,
  options: PrepareThemeOptions = {},
): Promise<RuntimeThemeBundle> {
  throwIfAborted(options.signal);
  const manifest = decodeDiceTheme(await provider.getTheme(themeId, { signal: options.signal }));
  options.onEvent?.({ type: 'manifest', themeId });
  const references = listThemeAssetReferences(manifest);
  if (references.length > 128) throw new InvalidThemeError('A theme may reference at most 128 assets');
  const assets: Record<string, ThemeResourceAsset> = {};
  const maxAsset = options.maximumAssetBytes ?? 8 * 1024 * 1024;
  const maxTotal = options.maximumTotalBytes ?? 24 * 1024 * 1024;
  let loaded = 0;

  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    throwIfAborted(options.signal);
    options.onEvent?.({ type: 'asset-start', themeId, reference: reference.src, loaded: index, total: references.length });
    try {
      const resource = await provider.getAsset(reference.src, { signal: options.signal });
      const data = resource instanceof Blob ? await resource.arrayBuffer() : resource.slice(0);
      if (data.byteLength > maxAsset) throw new ThemeAssetLimitError(`Theme asset exceeds ${maxAsset} bytes`, reference.src);
      if (reference.integrity) await verifyAssetIntegrity(data, reference.integrity, reference.src);
      loaded += data.byteLength;
      if (loaded > maxTotal) throw new ThemeAssetLimitError(`Theme assets exceed ${maxTotal} total bytes`, reference.src);
      assets[reference.src] = {
        mimeType: reference.mimeType ?? (resource instanceof Blob && resource.type ? resource.type : inferMimeType(reference.src)),
        data,
      };
      options.onEvent?.({ type: 'asset-complete', themeId, reference: reference.src, loaded: index + 1, total: references.length });
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      options.onEvent?.({ type: 'error', themeId, reference: reference.src, error: normalized });
      throw normalized;
    }
  }
  options.onEvent?.({ type: 'complete', themeId, loaded: references.length, total: references.length });
  return { manifest, assets };
}

/**
 * Serves themes and assets supplied directly by the application.
 *
 * @public
 */
export class BundledThemeProvider implements ThemeProvider {
  private readonly themes: Map<string, DiceTheme>;
  private readonly assets: Map<string, ArrayBuffer | Blob>;

  /**
   * Creates a provider from in-memory themes and assets.
   */
  constructor(themes: Iterable<DiceTheme>, assets: Iterable<readonly [string, ArrayBuffer | Blob]> = []) {
    this.themes = new Map(Array.from(themes, (theme) => {
      const decoded = decodeDiceTheme(theme);
      return [decoded.id, decoded] as const;
    }));
    this.assets = new Map(assets);
  }

  /**
   * Loads a theme manifest by ID.
   */
  async getTheme(id: string, options: { signal?: AbortSignal } = {}): Promise<DiceTheme> {
    throwIfAborted(options.signal);
    const theme = this.themes.get(id);
    if (!theme) throw new ThemeNotFoundError(id);
    return structuredClone(theme);
  }

  /**
   * Lists theme manifests available from this provider.
   */
  async listThemes(options: { signal?: AbortSignal } = {}): Promise<DiceTheme[]> {
    throwIfAborted(options.signal);
    return [...this.themes.values()].map((theme) => structuredClone(theme));
  }

  /**
   * Loads a theme asset by reference.
   */
  async getAsset(reference: string, options: { signal?: AbortSignal } = {}): Promise<ArrayBuffer | Blob> {
    throwIfAborted(options.signal);
    const asset = this.assets.get(reference);
    if (!asset) throw new Error(`Theme asset not found: ${reference}`);
    return asset instanceof ArrayBuffer ? asset.slice(0) : asset;
  }
}

/**
 * Loads theme manifests and assets over HTTP.
 *
 * @public
 */
export class HttpThemeProvider implements ThemeProvider {
  /**
   * Creates an HTTP theme provider.
   */
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /**
   * Loads a theme manifest by ID.
   */
  async getTheme(id: string, options: { signal?: AbortSignal } = {}): Promise<DiceTheme> {
    const response = await this.fetcher(this.resolve(`themes/${encodeURIComponent(id)}.json`), { signal: options.signal });
    if (response.status === 404) throw new ThemeNotFoundError(id);
    if (!response.ok) throw new Error(`Theme request failed (${response.status})`);
    const value = decodeDiceTheme(await response.json());
    if (value.id !== id) throw new InvalidThemeError(`Theme ID '${value.id}' does not match requested ID '${id}'`, 'id');
    return value;
  }

  /**
   * Lists theme manifests available from this provider.
   */
  async listThemes(options: { signal?: AbortSignal } = {}): Promise<DiceTheme[]> {
    const response = await this.fetcher(this.resolve('themes/index.json'), { signal: options.signal });
    if (!response.ok) throw new Error(`Theme index request failed (${response.status})`);
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new InvalidThemeError('Theme index must be an array');
    return value.map(decodeDiceTheme);
  }

  /**
   * Loads a theme asset by reference.
   */
  async getAsset(reference: string, options: { signal?: AbortSignal } = {}): Promise<ArrayBuffer> {
    const response = await this.fetcher(this.resolve(reference), { signal: options.signal });
    if (!response.ok) throw new Error(`Theme asset request failed (${response.status})`);
    return response.arrayBuffer();
  }

  private resolve(path: string): string {
    return new URL(path.replace(/^\//, ''), this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).toString();
  }
}

/**
 * Queries multiple theme providers in priority order.
 *
 * @public
 */
export class CompositeThemeProvider implements ThemeProvider {
  /**
   * Creates a provider that queries sources in order.
   */
  constructor(private readonly providers: readonly ThemeProvider[]) {
    if (providers.length === 0) throw new Error('CompositeThemeProvider requires at least one provider');
  }

  /**
   * Loads a theme manifest by ID.
   */
  async getTheme(id: string, options: { signal?: AbortSignal } = {}): Promise<DiceTheme> {
    const errors: unknown[] = [];
    for (const provider of this.providers) {
      try {
        return await provider.getTheme(id, options);
      } catch (error) {
        errors.push(error);
      }
    }
    throw new AggregateError(errors, `No theme provider could resolve '${id}'`);
  }

  /**
   * Lists theme manifests available from this provider.
   */
  async listThemes(options: { signal?: AbortSignal } = {}): Promise<DiceTheme[]> {
    const byId = new Map<string, DiceTheme>();
    for (const provider of this.providers) {
      if (!provider.listThemes) continue;
      try {
        for (const theme of await provider.listThemes(options)) if (!byId.has(theme.id)) byId.set(theme.id, theme);
      } catch {
        // A composite index is best effort. Individual getTheme calls still expose failures.
      }
    }
    return [...byId.values()];
  }

  /**
   * Loads a theme asset by reference.
   */
  async getAsset(reference: string, options: { signal?: AbortSignal } = {}): Promise<ArrayBuffer | Blob> {
    const errors: unknown[] = [];
    for (const provider of this.providers) {
      try {
        return await provider.getAsset(reference, options);
      } catch (error) {
        errors.push(error);
      }
    }
    throw new AggregateError(errors, `No theme provider could resolve asset '${reference}'`);
  }
}

/**
 * Caches manifests and assets loaded from another theme provider.
 *
 * @public
 */
export class CachedThemeProvider implements ThemeProvider {
  private readonly themes = new Map<string, DiceTheme>();
  private readonly assets = new Map<string, ArrayBuffer | Blob>();

  /**
   * Creates a caching wrapper around another provider.
   */
  constructor(private readonly upstream: ThemeProvider) {}

  /**
   * Loads a theme manifest by ID.
   */
  async getTheme(id: string, options: { signal?: AbortSignal } = {}): Promise<DiceTheme> {
    throwIfAborted(options.signal);
    const cached = this.themes.get(id);
    if (cached) return structuredClone(cached);
    const theme = await this.upstream.getTheme(id, options);
    this.themes.set(id, structuredClone(theme));
    return theme;
  }

  /**
   * Lists theme manifests available from this provider.
   */
  async listThemes(options: { signal?: AbortSignal } = {}): Promise<DiceTheme[]> {
    throwIfAborted(options.signal);
    if (!this.upstream.listThemes) return [...this.themes.values()].map((theme) => structuredClone(theme));
    const themes = await this.upstream.listThemes(options);
    for (const theme of themes) this.themes.set(theme.id, structuredClone(theme));
    return themes;
  }

  /**
   * Loads a theme asset by reference.
   */
  async getAsset(reference: string, options: { signal?: AbortSignal } = {}): Promise<ArrayBuffer | Blob> {
    throwIfAborted(options.signal);
    const cached = this.assets.get(reference);
    if (cached) return cached instanceof ArrayBuffer ? cached.slice(0) : cached;
    const asset = await this.upstream.getAsset(reference, options);
    this.assets.set(reference, asset instanceof ArrayBuffer ? asset.slice(0) : asset);
    return asset;
  }

  /**
   * Evicts one theme and its cached assets.
   */
  invalidate(themeId?: string): void {
    if (themeId) this.themes.delete(themeId);
    else this.themes.clear();
    // Asset references can be shared by versions. Clear all to avoid stale cross-version data.
    this.assets.clear();
  }

  /**
   * Clears all cached themes and assets.
   */
  clear(): void {
    this.invalidate();
  }
}


async function verifyAssetIntegrity(data: ArrayBuffer, integrity: string, reference: string): Promise<void> {
  const match = integrity.match(/^sha256-([A-Za-z0-9+/=]+)$/);
  if (!match) throw new InvalidThemeError('Only sha256 Subresource Integrity values are supported', `asset:${reference}.integrity`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const actual = btoa(binary);
  if (actual !== match[1]) throw new InvalidThemeError('Theme asset integrity check failed', `asset:${reference}`);
}

function validateMaterial(material: ThemeMaterialDefinition | undefined, path: string): void {
  if (!material) return;
  validateRange(material.emissiveIntensity, 0, 20, `${path}.emissiveIntensity`);
  validateRange(material.roughness, 0, 1, `${path}.roughness`);
  validateRange(material.metalness, 0, 1, `${path}.metalness`);
  validateRange(material.clearcoat, 0, 1, `${path}.clearcoat`);
  validateRange(material.clearcoatRoughness, 0, 1, `${path}.clearcoatRoughness`);
  validateRange(material.opacity, 0.05, 1, `${path}.opacity`);
  validateAsset(material.surfaceTexture, `${path}.surfaceTexture`);
  validateAsset(material.normalTexture, `${path}.normalTexture`);
  validateAsset(material.roughnessTexture, `${path}.roughnessTexture`);
}

function validateLabels(labels: ThemeLabelDefinition | undefined): void {
  if (!labels) return;
  if (labels.fontFamily !== undefined) readText(labels.fontFamily, 'labels.fontFamily', 128);
  validateAsset(labels.font, 'labels.font');
  validateAsset(labels.atlas, 'labels.atlas');
  for (const [die, atlas] of Object.entries(labels.atlases ?? {})) validateAsset(atlas, `labels.atlases.${die}`);
}

function validatePhysics(physics: ThemePhysicsDefinition | undefined, path: string): void {
  if (!physics) return;
  validateRange(physics.sizeScale, 0.5, 2, `${path}.sizeScale`);
  validateRange(physics.massScale, 0.25, 4, `${path}.massScale`);
  validateRange(physics.inertiaScale, 0.25, 4, `${path}.inertiaScale`);
}

function validateAsset(reference: ThemeAssetReference | undefined, path: string): void {
  if (!reference) return;
  if (!isRecord(reference)) throw new InvalidThemeError('Asset reference must be an object', path);
  const src = readText(reference.src, `${path}.src`, 2048);
  if (/^(?:javascript|data):/i.test(src)) throw new InvalidThemeError('Unsafe asset URL scheme', `${path}.src`);
  if (reference.mimeType !== undefined) readText(reference.mimeType, `${path}.mimeType`, 128);
  if (reference.integrity !== undefined) readText(reference.integrity, `${path}.integrity`, 256);
}

function validateRange(value: number | undefined, minimum: number, maximum: number, path: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new InvalidThemeError(`Expected a number between ${minimum} and ${maximum}`, path);
  }
}

function readIdentifier(value: unknown, path: string): string {
  const text = readText(value, path, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(text)) throw new InvalidThemeError('Invalid identifier', path);
  return text;
}

function readText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new InvalidThemeError(`Expected a non-empty string up to ${maximum} characters`, path);
  }
  return value;
}

function inferMimeType(reference: string): string {
  const normalized = reference.toLowerCase().split(/[?#]/, 1)[0];
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.woff2')) return 'font/woff2';
  if (normalized.endsWith('.woff')) return 'font/woff';
  if (normalized.endsWith('.mp3')) return 'audio/mpeg';
  if (normalized.endsWith('.ogg')) return 'audio/ogg';
  if (normalized.endsWith('.wav')) return 'audio/wav';
  if (normalized.endsWith('.glb')) return 'model/gltf-binary';
  if (normalized.endsWith('.gltf')) return 'model/gltf+json';
  return 'application/octet-stream';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Operation aborted', 'AbortError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
