import './style.css';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DraftrollAudio } from './audio';
import { DraftrollEffects, type EffectOutcome, type ThemeEffectSlots } from './effects';
import {
  DieInstance,
  THEMES,
  invalidateDiceThemeResources,
  prewarmDiceTheme,
  type DieKind,
  type ThemeName,
} from './dice';
import { DIE_COLLIDER_RADIUS, DIE_RADIUS, isDieKind } from './physics-shapes';
import { THEME_MANIFESTS, type ThemeManifest } from './themes';
import { FallbackVisualInstance } from './fallback-visuals';
import { consumeSettledVisualIndexes, deriveDieSettleTimes } from './settlement';
import type {
  DraftrollFallbackVisual,
  DraftrollVisualOrderEntry,
  DraftrollThemeManifest,
  RendererCameraOptions,
  RendererInteractionOptions,
  RendererLateEventMode,
  RendererPreviewOptions,
} from '../packages/renderer/src/index';
import {
  AdaptiveResolutionController,
  resolveRendererPerformanceBudget,
} from '../packages/renderer/src/performance';
import {
  resolveOrthographicViewport,
  resolveRendererViewport,
} from '../packages/renderer/src/viewport';
import type { RuntimeThemeBundle } from '../packages/themes/src/index';
import type { DicePhysicsProperties } from '../packages/protocol/src/index';
import {
  getRuntimeThemeAudio,
  getRuntimeThemeEffects,
  getRuntimeThemePhysics,
  installRuntimeThemeBundle,
  isRecord,
  uninstallRuntimeTheme,
} from './runtime-themes';

export interface RollEffectContext {
  results: number[];
  /** First die kind for backwards compatibility. */
  dieKind: DieKind;
  dieKinds: DieKind[];
  quantity: number;
  context: Record<string, unknown>;
}

export interface DiceRollRequest {
  results?: number[] | number;
  outcomes?: EffectOutcome[] | EffectOutcome;
  themes?: ThemeName[] | ThemeName;
  /** Physical die type for each physical result. A single value is repeated. */
  kinds?: DieKind[] | DieKind;
  /** Token/card fallbacks animated alongside supported physical dice. */
  fallbacks?: DraftrollFallbackVisual[];
  /** Normalized ordering across physical dice and fallback visuals. */
  visualOrder?: DraftrollVisualOrderEntry[];
  context?: Record<string, unknown>;
  seed?: string | number;
  startAtMs?: number;
  seekToMs?: number;
  animationDurationMs?: number;
  settleImmediately?: boolean;
  lateMode?: RendererLateEventMode;
  settleAfterProgress?: number;
  /** Add this roll to the active table simulation when possible. */
  tableMode?: 'replace' | 'add';
  signal?: AbortSignal;
  reducedMotion?: boolean;
  physics?: DicePhysicsProperties[];
  physicsPreset?: 'standard' | 'compact' | 'heavy' | 'low-gravity';
}

export interface DraftrollRollCompletion {
  results: Array<number | string>;
  total: number;
  replay: RollReplay | null;
}

export interface DiceReplayOptions {
  seekToMs?: number;
  animationDurationMs?: number;
  settleImmediately?: boolean;
  lateMode?: RendererLateEventMode;
  settleAfterProgress?: number;
}

export interface DiceDismissOptions {
  durationMs?: number;
}

export type DicePerformanceProfile = 'auto' | 'battery' | 'quality';

export interface DiceTargetingSnapshot {
  method: 'shape-symmetry';
  planningMs: number;
  retargetedDiceCount: number;
  preservedTrajectoryDiceCount: number;
  naturalMatches: number;
  minimumFinalAlignment: number;
  targetSuccess: boolean;
  naturalTrajectory: boolean;
  /** @deprecated Shape-symmetry targeting uses exactly one physical plan. */
  candidateAttempts: number;
  /** @deprecated Use planningMs. */
  candidateSearchMs: number;
  /** @deprecated No assistance stage is executed. */
  assistedDiceCount: number;
  /** @deprecated No assistance stage is executed. */
  maximumAssistAngleRadians: number;
  /** @deprecated No continuity quaternion blend is applied. */
  continuityBlendedDiceCount: number;
}

export interface DicePerformanceSnapshot {
  profile: DicePerformanceProfile;
  pixelRatio: number;
  dynamicResolutionScale: number;
  targetFramesPerSecond: number;
  renderLoopActive: boolean;
  queuedPresentations: number;
  physicalDice: number;
  fallbackVisuals: number;
  renderedFrames: number;
  averageFrameIntervalMs: number;
  averageRenderCpuMs: number;
  maximumFrameIntervalMs: number;
  /** Chromium-only JS heap diagnostics when available. */
  usedJsHeapSize: number | null;
  jsHeapSizeLimit: number | null;
  /** Diagnostics from the most recently planned physical throw. */
  targeting: DiceTargetingSnapshot | null;
  /**
   * Roller labels for the table groups currently on screen, in presentation order.
   *
   * @remarks
   * Exposed so tests can wait for a specific set of rollers to share the table instead of
   * racing a fixed delay against the visible throw.
   */
  activeTableRolls: string[];
}

export interface DiceEngineConfig {
  outcomeResolver?: (roll: RollEffectContext) => EffectOutcome[] | EffectOutcome;
  neutralEffects?: boolean;
  maxHeroEffects?: number;
  adaptiveQuality?: boolean;
  performanceProfile?: DicePerformanceProfile;
  maximumPixelRatio?: number;
  activeFramesPerSecond?: number;
}

export interface RollReplayEvent {
  time: number;
  type: 'impact' | 'result';
  dieIndex: number;
  strength?: number;
  outcome?: EffectOutcome;
}

export interface RollReplay {
  formatVersion: 1;
  engineVersion: string;
  seed: string;
  createdAt: string;
  dieKind: DieKind;
  /** Per-die physical kinds. Missing in legacy homogeneous replays. */
  dieKinds?: DieKind[];
  theme: ThemeName;
  themes?: ThemeName[];
  /** Per-die physical overrides captured for deterministic replay. */
  physics?: DicePhysicsProperties[];
  /** Room/application-selected physical behavior preset. */
  physicsPreset?: DicePhysicsPreset;
  quantity: number;
  bounds: { x: number; z: number };
  step: number;
  frameCount: number;
  duration: number;
  transforms: Float32Array;
  /** Per-die release time used by large-pool pours. Missing in legacy replays. */
  activationDelays?: Float32Array;
  /** Earliest time each die remains at its authoritative final pose. */
  settleTimes?: Float32Array;
  impacts: Float32Array;
  results: number[];
  outcomes: EffectOutcome[];
  fallbacks?: DraftrollFallbackVisual[];
  visualOrder?: DraftrollVisualOrderEntry[];
  context: Record<string, unknown>;
  effectTimeline: RollReplayEvent[];
  settleReason: string;
  physicsSteps: number;
}

declare global {
  interface Window {
    draftrollDice: {
      roll: (request?: DiceRollRequest | number[] | number) => Promise<DraftrollRollCompletion>;
      setResults: (results: number[] | number) => void;
      clearResults: () => void;
      setDie: (kind: DieKind) => void;
      setQuantity: (count: number) => void;
      setTheme: (theme: ThemeName) => void;
      getThemes: () => ThemeManifest[];
      getThemeManifest: (theme: ThemeName) => ThemeManifest;
      installTheme: (bundle: RuntimeThemeBundle) => Promise<DraftrollThemeManifest>;
      unloadTheme: (themeId: string) => void;
      configure: (config: DiceEngineConfig) => void;
      configureThemeEffects: (theme: ThemeName, slots: ThemeEffectSlots) => void;
      getLastReplay: () => RollReplay | null;
      playReplay: (
        replay: RollReplay,
        options?: DiceReplayOptions,
      ) => Promise<DraftrollRollCompletion>;
      dismiss: (options?: DiceDismissOptions) => Promise<void>;
      clear: () => void;
      // These mirror `DraftrollBridge`, whose contract allows either a sync or async
      // implementation. Consumers such as the overlay bridge must be free to await them.
      pause: () => void | Promise<void>;
      resume: () => void | Promise<void>;
      screenshot: () => Promise<string>;
      configureCamera: (options: RendererCameraOptions) => void | Promise<void>;
      resetCamera: () => void | Promise<void>;
      preview: (
        options?: Omit<RendererPreviewOptions, 'signal'>,
      ) => Promise<DraftrollRollCompletion>;
      configureInteractions: (options: RendererInteractionOptions) => void | Promise<void>;
      getPerformanceSnapshot: () => DicePerformanceSnapshot;
    };
  }
}

interface LaunchState {
  position: CANNON.Vec3;
  quaternion: CANNON.Quaternion;
  velocity: CANNON.Vec3;
  angularVelocity: CANNON.Vec3;
  delay: number;
}

interface LockedTableTrajectory {
  count: number;
  step: number;
  frameCount: number;
  transforms: Float32Array;
}

interface RollImpact {
  time: number;
  dieIndex: number;
  strength: number;
}

interface RollPlanDiagnostics {
  targetingMethod?: 'shape-symmetry';
  candidateAttempts?: number;
  candidateSearchMs?: number;
  naturalTrajectory?: boolean;
  naturalMatches?: number;
  assistedDice?: number[];
  maximumAssistAngle?: number;
  finalTargetDots?: number[];
  targetSuccess?: boolean;
  retargetedDice?: number[];
  continuityBlendedDice?: number[];
  lockedKinematicDice?: number;
}

interface RollPlan {
  step: number;
  frameCount: number;
  dieCount: number;
  transforms: Float32Array;
  activationDelays?: Float32Array;
  settleTimes?: Float32Array;
  impacts: RollImpact[];
  duration: number;
  results: number[];
  settleReason: string;
  physicsSteps: number;
  sourceBounds?: { x: number; z: number };
  diagnostics?: RollPlanDiagnostics;
}

// The caller names the expected element type; `querySelector` forwards it. The generic is
// only used in the return position, so this stays an assertion the DOM cannot verify --
// the missing-element check below is what turns a silent null into a loud failure.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
function mustElement<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element is missing: ${selector}`);
  return element;
}

const OVERLAY_MODE = document.documentElement.dataset.draftrollMode === 'overlay';
const canvas = mustElement<HTMLCanvasElement>('#scene');
const statusElement = mustElement<HTMLElement>('#status');
const statusText = mustElement<HTMLElement>('span:last-child', statusElement);
const resultPanel = mustElement<HTMLElement>('#result-panel');
const resultTotal = mustElement<HTMLElement>('#result-total');
const resultDetail = mustElement<HTMLElement>('#result-detail');
const rollButton = mustElement<HTMLButtonElement>('#roll-button');
const rollButtonText = mustElement<HTMLElement>('span:nth-child(2)', rollButton);
const quantityValue = mustElement<HTMLElement>('#quantity-value');
const flashElement = mustElement<HTMLElement>('#flash');
const soundToggle = mustElement<HTMLButtonElement>('#sound-toggle');
const gestureHint = mustElement<HTMLElement>('#gesture-hint');
const presetInput = mustElement<HTMLInputElement>('#preset-results');

const scene = new THREE.Scene();
scene.background = OVERLAY_MODE ? null : new THREE.Color(0x070912);
scene.fog = OVERLAY_MODE ? null : new THREE.FogExp2(0x070912, 0.045);

const VIEW_HEIGHT = 10;
const CAMERA_HEIGHT = 14;
const FIXED_STEP = 1 / 60;
const PLANNER_STEP = 1 / 120;
const PLANNER_RECORD_EVERY = 1;
const PLANNER_RECORD_STEP = PLANNER_STEP * PLANNER_RECORD_EVERY;
type DicePhysicsPreset = NonNullable<DiceRollRequest['physicsPreset']>;
const PHYSICS_PRESETS: Record<
  DicePhysicsPreset,
  {
    gravity: number;
    massScale: number;
    sizeScale: number;
    inertiaScale: number;
    linearDamping: number;
    angularDamping: number;
  }
> = {
  standard: {
    gravity: 20.5,
    massScale: 1,
    sizeScale: 1,
    inertiaScale: 1,
    linearDamping: 0.095,
    angularDamping: 0.085,
  },
  compact: {
    gravity: 22,
    massScale: 0.9,
    sizeScale: 0.86,
    inertiaScale: 0.9,
    linearDamping: 0.11,
    angularDamping: 0.1,
  },
  heavy: {
    gravity: 22.5,
    massScale: 1.65,
    sizeScale: 1.05,
    inertiaScale: 1.35,
    linearDamping: 0.08,
    angularDamping: 0.075,
  },
  'low-gravity': {
    gravity: 11.5,
    massScale: 0.85,
    sizeScale: 1,
    inertiaScale: 0.85,
    linearDamping: 0.06,
    angularDamping: 0.055,
  },
};

const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.05, 40);
camera.position.set(0, CAMERA_HEIGHT, 0);
camera.up.set(0, 0, -1);
camera.lookAt(0, 0, 0);

const REDUCED_MOTION = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
let performanceProfile: DicePerformanceProfile = REDUCED_MOTION ? 'battery' : 'auto';
let configuredMaximumPixelRatio: number | null = null;
let configuredActiveFramesPerSecond: number | null = null;
let dynamicResolutionScale = 1;
let currentPixelRatio = 1;

const renderer = new THREE.WebGLRenderer({
  canvas,
  // Idle-zero scheduling removes the old permanent GPU cost, so overlays can
  // retain edge antialiasing without running continuously.
  antialias: true,
  alpha: OVERLAY_MODE,
  powerPreference: OVERLAY_MODE ? 'low-power' : 'default',
  preserveDrawingBuffer: false,
});
if (OVERLAY_MODE) renderer.setClearColor(0x000000, 0);
const initialCanvasRect = canvas.getBoundingClientRect();
const initialViewport = resolveRendererViewport({
  canvas: { width: initialCanvasRect.width, height: initialCanvasRect.height },
  document: {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  },
  window: { width: window.innerWidth, height: window.innerHeight },
});
renderer.setSize(initialViewport.width, initialViewport.height, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.015).texture;
pmrem.dispose();

let bloomResolutionScale = 0.68;
const bloom: UnrealBloomPass | { strength: number } = OVERLAY_MODE
  ? { strength: 0 }
  : new UnrealBloomPass(
      new THREE.Vector2(initialViewport.width, initialViewport.height),
      0.18,
      0.62,
      0.9,
    );
const composer = OVERLAY_MODE ? null : new EffectComposer(renderer);
if (composer && bloom instanceof UnrealBloomPass) {
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  bloom.setSize(
    Math.ceil(initialViewport.width * bloomResolutionScale),
    Math.ceil(initialViewport.height * bloomResolutionScale),
  );
  composer.addPass(new OutputPass());
}

const effects = new DraftrollEffects(scene, bloom, flashElement);
effects.setBloomBase(0.18);
const audio = new DraftrollAudio();

const dicePhysicsMaterial = new CANNON.Material('draftroll');
const tablePhysicsMaterial = new CANNON.Material('draftroll-table');

function configureWorld(target: CANNON.World): void {
  target.allowSleep = true;
  target.broadphase = new CANNON.SAPBroadphase(target);
  // Cannon types `World.solver` as the abstract `Solver`, which has no iteration controls.
  // The default this build never replaces is a `GSSolver`, whose tuning the throw quality
  // depends on.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const solver = target.solver as CANNON.GSSolver;
  solver.iterations = 32;
  solver.tolerance = 0.00025;
  target.addContactMaterial(
    new CANNON.ContactMaterial(dicePhysicsMaterial, tablePhysicsMaterial, {
      friction: 0.28,
      restitution: 0.24,
      contactEquationStiffness: 2e7,
      contactEquationRelaxation: 4,
      frictionEquationStiffness: 1.5e7,
    }),
  );
  target.addContactMaterial(
    new CANNON.ContactMaterial(dicePhysicsMaterial, dicePhysicsMaterial, {
      friction: 0.19,
      restitution: 0.14,
      contactEquationStiffness: 4e7,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 2.2e7,
      frictionEquationRelaxation: 3,
    }),
  );
}

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20.5, 0) });
configureWorld(world);

const screenBounds = { x: 5, z: 5 };
const visibleBounds = { x: 5, z: 5 };
let rendererViewport = initialViewport;
const floorBody = new CANNON.Body({
  mass: 0,
  material: tablePhysicsMaterial,
  shape: new CANNON.Plane(),
});
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floorBody);

let wallBodies: CANNON.Body[] = [];

function addWallTo(
  target: CANNON.World,
  position: CANNON.Vec3,
  halfExtents: CANNON.Vec3,
): CANNON.Body {
  const body = new CANNON.Body({
    mass: 0,
    material: tablePhysicsMaterial,
    shape: new CANNON.Box(halfExtents),
  });
  body.position.copy(position);
  target.addBody(body);
  return body;
}

function addCurrentWalls(target: CANNON.World): CANNON.Body[] {
  const wallThickness = 1.1;
  const wallHalfHeight = 5.5;
  const wallCenterY = wallHalfHeight - 0.05;
  return [
    addWallTo(
      target,
      new CANNON.Vec3(-screenBounds.x - wallThickness, wallCenterY, 0),
      new CANNON.Vec3(wallThickness, wallHalfHeight, screenBounds.z + 1.6),
    ),
    addWallTo(
      target,
      new CANNON.Vec3(screenBounds.x + wallThickness, wallCenterY, 0),
      new CANNON.Vec3(wallThickness, wallHalfHeight, screenBounds.z + 1.6),
    ),
    addWallTo(
      target,
      new CANNON.Vec3(0, wallCenterY, -screenBounds.z - wallThickness),
      new CANNON.Vec3(screenBounds.x + 1.6, wallHalfHeight, wallThickness),
    ),
    addWallTo(
      target,
      new CANNON.Vec3(0, wallCenterY, screenBounds.z + wallThickness),
      new CANNON.Vec3(screenBounds.x + 1.6, wallHalfHeight, wallThickness),
    ),
  ];
}

function measureRendererViewport() {
  const rect = canvas.getBoundingClientRect();
  return resolveRendererViewport({
    canvas: { width: rect.width, height: rect.height },
    document: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
    window: { width: window.innerWidth, height: window.innerHeight },
  });
}

function rebuildScreenBounds(): void {
  rendererViewport = measureRendererViewport();
  const layout = resolveOrthographicViewport(rendererViewport, VIEW_HEIGHT);
  camera.left = -layout.halfWidth;
  camera.right = layout.halfWidth;
  camera.top = layout.halfHeight;
  camera.bottom = -layout.halfHeight;
  camera.updateProjectionMatrix();

  visibleBounds.x = layout.halfWidth;
  visibleBounds.z = layout.halfHeight;
  screenBounds.x = Math.max(2.45, layout.halfWidth - 0.18);
  screenBounds.z = layout.halfHeight - 0.18;
  for (const wall of wallBodies) world.removeBody(wall);
  wallBodies = addCurrentWalls(world);
}

function createScreenTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvasTexture = document.createElement('canvas');
  canvasTexture.width = size;
  canvasTexture.height = size;
  const context = canvasTexture.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');

  const base = context.createRadialGradient(
    size * 0.52,
    size * 0.44,
    20,
    size * 0.5,
    size * 0.5,
    size * 0.78,
  );
  base.addColorStop(0, '#22324f');
  base.addColorStop(0.38, '#142038');
  base.addColorStop(1, '#08111e');
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  const image = context.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * 18;
    data[i] = Math.max(0, Math.min(255, data[i] + grain * 0.18));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + grain * 0.36));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + grain * 0.72));
  }
  context.putImageData(image, 0, 0);

  for (let i = 0; i < 240; i += 1) {
    context.globalAlpha = 0.04 + Math.random() * 0.03;
    context.fillStyle = i % 3 === 0 ? 'rgba(80,120,168,.12)' : 'rgba(0,0,0,.08)';
    context.beginPath();
    context.arc(Math.random() * size, Math.random() * size, 8 + Math.random() * 28, 0, Math.PI * 2);
    context.fill();
  }

  context.save();
  context.translate(size / 2, size / 2);
  context.strokeStyle = 'rgba(177,207,255,.12)';
  context.lineWidth = 1.4;
  context.beginPath();
  context.arc(0, 0, 166, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 0.08;
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    context.beginPath();
    context.moveTo(Math.cos(angle) * 120, Math.sin(angle) * 120);
    context.lineTo(Math.cos(angle) * 350, Math.sin(angle) * 350);
    context.stroke();
  }
  context.restore();

  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function createScreenSurface(): void {
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 32),
    new THREE.MeshStandardMaterial({
      map: createScreenTexture(),
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.01,
      envMapIntensity: 0.04,
    }),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = -0.055;
  surface.receiveShadow = true;
  surface.name = 'screen-surface';
  scene.add(surface);
}

let keyLight: THREE.DirectionalLight;

function createAtmosphere(): void {
  scene.add(new THREE.HemisphereLight(0xc9ddff, 0x07101c, 1.1));

  keyLight = new THREE.DirectionalLight(0xfff3e7, 1.65);
  const key = keyLight;
  key.position.set(-5.2, 8.5, 4.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 24;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.00018;
  key.shadow.radius = 4;
  scene.add(key);

  const rim = new THREE.PointLight(0x5a9dff, 4.8, 14, 2);
  rim.position.set(-5.5, 3.5, -3.7);
  scene.add(rim);

  const warm = new THREE.PointLight(0xff7b35, 4.2, 14, 2);
  warm.position.set(4.5, 2.8, 3.4);
  scene.add(warm);

  const overhead = new THREE.PointLight(0xffffff, 2.4, 24, 2);
  overhead.position.set(0, 8.4, 0);
  scene.add(overhead);
}

rebuildScreenBounds();
if (!OVERLAY_MODE) createScreenSurface();
createAtmosphere();

let selectedKind: DieKind = 'd20';
let selectedTheme: ThemeName = 'dragon';
let quantity = 1;
let dice: DieInstance[] = [];
let fallbackVisuals: FallbackVisualInstance[] = [];
let isRolling = false;
let isPlanning = false;
let hasCast = false;
let dissolveAnimation: Animation | null = null;
let dissolveGeneration = 0;
let collisionSparkBudget = 0;
let queuedApiResults: number[] | null = null;
let queuedOutcomes: EffectOutcome[] | null = null;
let queuedContext: Record<string, unknown> = {};
let queuedSeed: string | number | null = null;
let queuedThemes: ThemeName[] | ThemeName | null = null;
let queuedKinds: DieKind[] | DieKind | null = null;
let queuedPhysics: DicePhysicsProperties[] | null = null;
let queuedPhysicsPreset: DicePhysicsPreset = 'standard';
let queuedFallbacks: DraftrollFallbackVisual[] | null = null;
let queuedVisualOrder: DraftrollVisualOrderEntry[] | null = null;
let queuedStartAtMs: number | null = null;
let queuedSeekToMs = 0;
let queuedAnimationDurationMs: number | null = null;
let queuedSettleImmediately = false;
let queuedLateMode: RendererLateEventMode = 'auto';
let queuedSettleAfterProgress = 0.78;
let activeStartAtMs: number | null = null;
let activeSeekToMs = 0;
let activeAnimationDurationMs: number | null = null;
let activeSettleImmediately = false;
let activeLateMode: RendererLateEventMode = 'auto';
let activeSettleAfterProgress = 0.78;
let activeThemes: ThemeName[] = [];
let activeKinds: DieKind[] = [selectedKind];
let activePhysics: DicePhysicsProperties[] = [{}];
let activePhysicsPreset: DicePhysicsPreset = 'standard';
interface PendingRollCompletion {
  resolve: (completion: DraftrollRollCompletion) => void;
  reject: (error: Error) => void;
}

const pendingRollCompletions = new Set<PendingRollCompletion>();
let activeTargets: Array<number | null> = [];
let activeOutcomes: EffectOutcome[] = [];
const playedOutcomeEffectIds = new Set<string>();
const outcomeHeroCounts = new Map<string, number>();
const announcedOutcomeGroupIds = new Set<string>();
let activeFallbackSpecs: DraftrollFallbackVisual[] = [];
let activeVisualOrder: DraftrollVisualOrderEntry[] = [];
let activeContext: Record<string, unknown> = {};
let activeSeed = '';
let lastReplay: RollReplay | null = null;
let lastTargetingSnapshot: DiceTargetingSnapshot | null = null;
let activePlan: RollPlan | null = null;
let planTime = 0;
let nextImpactIndex = 0;
let revealDelay = 0;
let tableReplanPaused = false;
let outcomeResolver: DiceEngineConfig['outcomeResolver'];
let neutralEffects = true;
let maxHeroEffects = 2;
let adaptiveQuality = true;
const ENGINE_VERSION = '1.8.1';
const replayQuaternionA = new THREE.Quaternion();
const replayQuaternionB = new THREE.Quaternion();
const dynamicBodies: CANNON.Body[] = [];

interface RendererTask<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const MAX_RENDERER_QUEUE = 32;
const rendererTaskQueue: RendererTask<unknown>[] = [];
const rendererIdleWaiters = new Set<() => void>();
let rendererTaskRunning = false;

function notifyRendererIdle(): void {
  if (isRolling || isPlanning) return;
  for (const resolve of rendererIdleWaiters) resolve();
  rendererIdleWaiters.clear();
}

function waitForRendererIdle(): Promise<void> {
  if (!isRolling && !isPlanning) return Promise.resolve();
  return new Promise<void>((resolve) => rendererIdleWaiters.add(resolve));
}

function enqueueRendererTask<T>(run: () => Promise<T>): Promise<T> {
  if (rendererTaskQueue.length >= MAX_RENDERER_QUEUE) {
    return Promise.reject(
      new Error(`Renderer presentation queue exceeded ${MAX_RENDERER_QUEUE} entries`),
    );
  }
  const promise = new Promise<T>((resolve, reject) => {
    // The queue is heterogeneous, so entries store their resolver at `unknown`. Each entry is
    // only ever settled with the value its own `run` produced, which is this promise's `T`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    rendererTaskQueue.push({ run, resolve: resolve as (value: unknown) => void, reject });
  });
  void drainRendererTaskQueue();
  return promise;
}

async function drainRendererTaskQueue(): Promise<void> {
  if (rendererTaskRunning) return;
  const task = rendererTaskQueue.shift();
  if (!task) return;
  rendererTaskRunning = true;
  try {
    await waitForRendererIdle();
    task.resolve(await task.run());
  } catch (error) {
    task.reject(error instanceof Error ? error : new Error(String(error)));
  } finally {
    rendererTaskRunning = false;
    queueMicrotask(() => {
      void drainRendererTaskQueue();
    });
  }
}

interface RuntimeQuality {
  shadowsEnabled: boolean;
  shadowMapSize: number;
  bloomScale: number;
  impactEffectsPerDie: number;
  particleScale: number;
  motifScale: number;
  lightningScale: number;
  maxDynamicLights: number;
  heroEffectLimit: number;
}

let runtimeQuality: RuntimeQuality = {
  shadowsEnabled: !OVERLAY_MODE,
  shadowMapSize: OVERLAY_MODE ? 1024 : 2048,
  bloomScale: 0.68,
  impactEffectsPerDie: 6,
  particleScale: 1,
  motifScale: 1,
  lightningScale: 1,
  maxDynamicLights: 8,
  heroEffectLimit: 3,
};

function qualityForCount(count: number): RuntimeQuality {
  const overlayShadowSize = OVERLAY_MODE ? 1024 : 2048;
  let quality: RuntimeQuality;
  if (!adaptiveQuality || count <= 8) {
    quality = {
      shadowsEnabled: true,
      shadowMapSize: overlayShadowSize,
      bloomScale: 0.68,
      impactEffectsPerDie: 5,
      particleScale: 0.92,
      motifScale: 0.92,
      lightningScale: 0.9,
      maxDynamicLights: 6,
      heroEffectLimit: 2,
    };
  } else if (count <= 16) {
    quality = {
      shadowsEnabled: true,
      shadowMapSize: 1024,
      bloomScale: 0.62,
      impactEffectsPerDie: 3,
      particleScale: 0.68,
      motifScale: 0.72,
      lightningScale: 0.68,
      maxDynamicLights: 4,
      heroEffectLimit: 2,
    };
  } else if (count <= 24) {
    quality = {
      shadowsEnabled: !OVERLAY_MODE,
      shadowMapSize: 1024,
      bloomScale: 0.56,
      impactEffectsPerDie: 2,
      particleScale: 0.48,
      motifScale: 0.52,
      lightningScale: 0.48,
      maxDynamicLights: 2,
      heroEffectLimit: 1,
    };
  } else {
    quality = {
      shadowsEnabled: false,
      shadowMapSize: 512,
      bloomScale: 0.5,
      impactEffectsPerDie: 1,
      particleScale: 0.34,
      motifScale: 0.4,
      lightningScale: 0.36,
      maxDynamicLights: 1,
      heroEffectLimit: 1,
    };
  }

  if (OVERLAY_MODE) {
    quality = {
      ...quality,
      // Small overlay rolls keep inexpensive shadows so rounded dice retain
      // depth. Larger pools shed them before they become a GPU bottleneck.
      shadowsEnabled: quality.shadowsEnabled && count <= 8,
      shadowMapSize: 512,
      impactEffectsPerDie: Math.min(4, quality.impactEffectsPerDie),
      particleScale: Math.min(0.78, quality.particleScale),
      motifScale: Math.min(0.8, quality.motifScale),
      lightningScale: Math.min(0.72, quality.lightningScale),
      maxDynamicLights: Math.min(4, quality.maxDynamicLights),
      heroEffectLimit: Math.min(1, quality.heroEffectLimit),
    };
  }

  if (performanceProfile === 'battery') {
    return {
      ...quality,
      shadowsEnabled: false,
      shadowMapSize: 512,
      bloomScale: Math.min(0.46, quality.bloomScale),
      impactEffectsPerDie: Math.min(1, quality.impactEffectsPerDie),
      particleScale: Math.min(0.36, quality.particleScale),
      motifScale: Math.min(0.42, quality.motifScale),
      lightningScale: Math.min(0.36, quality.lightningScale),
      maxDynamicLights: Math.min(1, quality.maxDynamicLights),
      heroEffectLimit: Math.min(1, quality.heroEffectLimit),
    };
  }
  if (performanceProfile === 'quality') {
    return {
      ...quality,
      shadowsEnabled: true,
      shadowMapSize: count <= 16 ? 2048 : quality.shadowMapSize,
      particleScale: Math.min(1, quality.particleScale * 1.12),
      motifScale: Math.min(1, quality.motifScale * 1.12),
      lightningScale: Math.min(1, quality.lightningScale * 1.08),
      maxDynamicLights: Math.min(8, quality.maxDynamicLights + 1),
      heroEffectLimit: Math.min(3, quality.heroEffectLimit + 1),
    };
  }
  return quality;
}

function currentPerformanceBudget(): { maximumPixelRatio: number; activeFramesPerSecond: number } {
  return resolveRendererPerformanceBudget({
    profile: performanceProfile,
    overlay: OVERLAY_MODE,
    reducedMotion: REDUCED_MOTION,
    visualCount: quantity + activeFallbackSpecs.length,
    devicePixelRatio: window.devicePixelRatio || 1,
    maximumPixelRatio: configuredMaximumPixelRatio ?? undefined,
    activeFramesPerSecond: configuredActiveFramesPerSecond ?? undefined,
  });
}

function maximumPixelRatio(): number {
  return currentPerformanceBudget().maximumPixelRatio;
}

function targetFramesPerSecond(): number {
  return currentPerformanceBudget().activeFramesPerSecond;
}

function applyRendererResolution(): void {
  rendererViewport = measureRendererViewport();
  const next = THREE.MathUtils.clamp(
    Math.min(window.devicePixelRatio || 1, maximumPixelRatio()) * dynamicResolutionScale,
    0.65,
    2,
  );
  if (Math.abs(next - currentPixelRatio) >= 0.025) {
    currentPixelRatio = next;
    renderer.setPixelRatio(currentPixelRatio);
  }
  renderer.setSize(rendererViewport.width, rendererViewport.height, false);
  composer?.setSize(rendererViewport.width, rendererViewport.height);
  if (bloom instanceof UnrealBloomPass) {
    bloom.setSize(
      Math.ceil(rendererViewport.width * bloomResolutionScale),
      Math.ceil(rendererViewport.height * bloomResolutionScale),
    );
  }
}

function applyRuntimeQuality(count: number): void {
  runtimeQuality = qualityForCount(count);
  renderer.shadowMap.enabled = runtimeQuality.shadowsEnabled;
  renderer.shadowMap.autoUpdate = runtimeQuality.shadowsEnabled;
  renderer.shadowMap.needsUpdate = runtimeQuality.shadowsEnabled;
  keyLight.castShadow = runtimeQuality.shadowsEnabled;
  if (keyLight.shadow.mapSize.x !== runtimeQuality.shadowMapSize) {
    keyLight.shadow.mapSize.set(runtimeQuality.shadowMapSize, runtimeQuality.shadowMapSize);
    keyLight.shadow.map?.dispose();
    keyLight.shadow.map = null;
  }
  bloomResolutionScale = runtimeQuality.bloomScale;
  if (bloom instanceof UnrealBloomPass) {
    bloom.setSize(
      Math.ceil(rendererViewport.width * bloomResolutionScale),
      Math.ceil(rendererViewport.height * bloomResolutionScale),
    );
  }
  effects.setQuality({
    particleScale: runtimeQuality.particleScale,
    motifScale: runtimeQuality.motifScale,
    lightningScale: runtimeQuality.lightningScale,
    maxDynamicLights: runtimeQuality.maxDynamicLights,
  });
  applyRendererResolution();
  nextFrameDeadline = 0;
}

function makeRandomSeed(): string {
  const values = new Uint32Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
  else
    for (let index = 0; index < values.length; index += 1)
      values[index] = Math.floor(Math.random() * 0xffffffff);
  return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('');
}

function normalizeSeed(seed: string | number | null | undefined): string {
  return seed === null || seed === undefined || String(seed).length === 0
    ? makeRandomSeed()
    : String(seed);
}

function hashSeed(seed: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneReplay(replay: RollReplay): RollReplay {
  return {
    ...replay,
    bounds: { ...replay.bounds },
    transforms: replay.transforms.slice(),
    activationDelays: replay.activationDelays?.slice(),
    settleTimes: replay.settleTimes?.slice(),
    impacts: replay.impacts.slice(),
    results: replay.results.slice(),
    outcomes: replay.outcomes.slice(),
    fallbacks: replay.fallbacks?.map((fallback) => ({
      ...fallback,
      metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
    })),
    visualOrder: replay.visualOrder?.map((entry) => ({ ...entry })),
    themes: replay.themes?.slice(),
    dieKinds: replay.dieKinds?.slice(),
    physics: replay.physics?.map((entry) => ({ ...entry })),
    context: { ...replay.context },
    effectTimeline: replay.effectTimeline.map((event) => ({ ...event })),
  };
}

function clearFallbackVisuals(): void {
  for (const visual of fallbackVisuals) {
    scene.remove(visual.group);
    visual.dispose();
  }
  fallbackVisuals = [];
}

function clearDice(): void {
  activePlan = null;
  playedOutcomeEffectIds.clear();
  outcomeHeroCounts.clear();
  announcedOutcomeGroupIds.clear();
  for (const die of dice) {
    world.removeBody(die.body);
    scene.remove(die.group);
    die.dispose();
  }
  dice = [];
  clearFallbackVisuals();
}

function spawnFallbackVisuals(specs: readonly DraftrollFallbackVisual[], seed: string): void {
  clearFallbackVisuals();
  if (specs.length === 0) return;
  const random = createSeededRandom(`${seed}:fallbacks`);
  fallbackVisuals = specs.map((spec, index) => {
    const visual = new FallbackVisualInstance(spec);
    visual.configureTrajectory(index, specs.length, screenBounds, random);
    scene.add(visual.group);
    return visual;
  });
}

function resetDissolveVisuals(): void {
  dissolveAnimation?.cancel();
  dissolveAnimation = null;
  canvas.style.opacity = '';
  canvas.style.filter = '';
  canvas.style.transform = '';
}

function cancelDissolve(clearCurrentDice = false): void {
  dissolveGeneration += 1;
  resetDissolveVisuals();
  if (clearCurrentDice) clearDice();
}

async function dissolveDice(options: DiceDismissOptions = {}): Promise<void> {
  if (isRolling || isPlanning) return;
  const durationMs = THREE.MathUtils.clamp(Math.round(options.durationMs ?? 320), 0, 2_000);
  const generation = ++dissolveGeneration;
  if (
    (dice.length === 0 && fallbackVisuals.length === 0) ||
    durationMs === 0 ||
    typeof canvas.animate !== 'function'
  ) {
    clearDice();
    hasCast = false;
    resultPanel.classList.remove('revealed', 'critical');
    resultTotal.textContent = '—';
    resultDetail.textContent = 'Ready';
    resetDissolveVisuals();
    return;
  }

  resetDissolveVisuals();
  dissolveAnimation = canvas.animate(
    [
      { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
      { opacity: 0.72, filter: 'blur(2px)', transform: 'scale(.995)', offset: 0.45 },
      { opacity: 0, filter: 'blur(12px)', transform: 'scale(.975)' },
    ],
    {
      duration: durationMs,
      easing: 'cubic-bezier(.22,.8,.25,1)',
      fill: 'forwards',
    },
  );

  try {
    await dissolveAnimation.finished;
  } catch {
    return;
  }
  if (generation !== dissolveGeneration) return;
  clearDice();
  hasCast = false;
  activePlan = null;
  lastReplay = null;
  resultPanel.classList.remove('revealed', 'critical');
  resultTotal.textContent = '—';
  resultDetail.textContent = 'Ready';
  resetDissolveVisuals();
}

function clampDieToVisibleArea(die: DieInstance): void {
  const radius = die.getVisualRadius();
  const padding = 0.14;
  const maximumX = Math.max(0.1, visibleBounds.x - radius - padding);
  const maximumZ = Math.max(0.1, visibleBounds.z - radius - padding);
  const previousX = die.body.position.x;
  const previousZ = die.body.position.z;
  die.body.position.x = THREE.MathUtils.clamp(previousX, -maximumX, maximumX);
  die.body.position.z = THREE.MathUtils.clamp(previousZ, -maximumZ, maximumZ);
  if (
    die.body.position.x !== previousX &&
    Math.sign(die.body.velocity.x) === Math.sign(previousX)
  ) {
    die.body.velocity.x *= -0.08;
  }
  if (
    die.body.position.z !== previousZ &&
    Math.sign(die.body.velocity.z) === Math.sign(previousZ)
  ) {
    die.body.velocity.z *= -0.08;
  }
}

function enforceBodiesBounds(bodies: CANNON.Body[], simulationTime = 0): void {
  const margin = 0.82;
  const minX = -screenBounds.x + margin;
  const maxX = screenBounds.x - margin;
  const minZ = -screenBounds.z + margin;
  const maxZ = screenBounds.z - margin;
  const crowd = THREE.MathUtils.clamp((bodies.length - 8) / 22, 0, 1);
  const maximumLinearSpeed = 12 - crowd * 2.2;
  const maximumVerticalSpeed = 7.5 - crowd * 1.4;
  const maximumAngularSpeed = 28 - crowd * 4;

  for (const body of bodies) {
    // These are emergency anti-tunnelling guards. The physical walls perform
    // the visible bounce; the guards remove outward energy instead of adding
    // a second synthetic rebound.
    if (body.position.x < minX) {
      body.position.x = minX + 0.002;
      if (body.velocity.x < 0) body.velocity.x = Math.min(0.35, -body.velocity.x * 0.08);
    } else if (body.position.x > maxX) {
      body.position.x = maxX - 0.002;
      if (body.velocity.x > 0) body.velocity.x = Math.max(-0.35, -body.velocity.x * 0.08);
    }
    if (body.position.z < minZ) {
      body.position.z = minZ + 0.002;
      if (body.velocity.z < 0) body.velocity.z = Math.min(0.35, -body.velocity.z * 0.08);
    } else if (body.position.z > maxZ) {
      body.position.z = maxZ - 0.002;
      if (body.velocity.z > 0) body.velocity.z = Math.max(-0.35, -body.velocity.z * 0.08);
    }
    if (body.position.y > 9.2) {
      body.position.y = 9.2;
      if (body.velocity.y > 0) body.velocity.y = -Math.min(1.2, body.velocity.y * 0.12);
    }
    if (body.position.y < -0.7) {
      body.position.y = 1.05;
      body.velocity.setZero();
      body.angularVelocity.scale(0.25, body.angularVelocity);
      body.wakeUp();
    }

    // Felt/cloth has rolling resistance that a rigid-body solver does not
    // model directly. Applying it only near the surface removes solver jitter
    // and shortens the tail of crowded rolls without affecting airborne arcs.
    if (body.position.y < 1.35 && Math.abs(body.velocity.y) < 0.65) {
      const linearResistance = 0.997 - crowd * 0.0015;
      const angularResistance = 0.993 - crowd * 0.002;
      body.velocity.x *= linearResistance;
      body.velocity.z *= linearResistance;
      body.angularVelocity.scale(angularResistance, body.angularVelocity);
    }

    if (crowd > 0 && simulationTime > 2.15 && body.position.y < 6.4) {
      const speed = body.velocity.length();
      const angularSpeed = body.angularVelocity.length();
      if (speed < 2.0 && angularSpeed < 4.0) {
        const ramp = THREE.MathUtils.clamp((simulationTime - 2.15) / 1.8, 0, 1) * crowd;
        body.velocity.scale(1 - 0.024 * ramp, body.velocity);
        body.angularVelocity.scale(1 - 0.036 * ramp, body.angularVelocity);
      }
      if (simulationTime > 4.6 && speed < 0.22 && angularSpeed < 0.46) {
        body.velocity.scale(0.72, body.velocity);
        body.angularVelocity.scale(0.62, body.angularVelocity);
        if (
          simulationTime > 5.25 &&
          body.velocity.length() < 0.075 &&
          body.angularVelocity.length() < 0.16
        )
          body.sleep();
      }
    }

    body.velocity.y = THREE.MathUtils.clamp(
      body.velocity.y,
      -maximumVerticalSpeed,
      maximumVerticalSpeed,
    );
    const linearSpeed = body.velocity.length();
    if (linearSpeed > maximumLinearSpeed)
      body.velocity.scale(maximumLinearSpeed / linearSpeed, body.velocity);
    const angularSpeed = body.angularVelocity.length();
    if (angularSpeed > maximumAngularSpeed)
      body.angularVelocity.scale(maximumAngularSpeed / angularSpeed, body.angularVelocity);
  }
}

function attachCollisionAudio(die: DieInstance): void {
  die.body.addEventListener('collide', (event: { contact: CANNON.ContactEquation }) => {
    if (activePlan || isRolling) return;
    const impact = Math.abs(event.contact.getImpactVelocityAlongNormal());
    audio.playImpact(impact, THEME_MANIFESTS[selectedTheme].surfaceAudio, selectedTheme);
  });
}

function spawnPreview(
  kinds: readonly DieKind[] = Array.from({ length: quantity }, () => selectedKind),
  force = false,
): void {
  quantity = THREE.MathUtils.clamp(kinds.length, 0, 30);
  activeKinds = Array.from({ length: quantity }, (_, index) => kinds[index] ?? selectedKind);
  quantityValue.textContent = String(quantity);
  applyRuntimeQuality(Math.max(1, quantity));
  clearDice();
  if (quantity === 0) {
    isRolling = false;
    statusElement.classList.remove('rolling');
    statusText.textContent = 'Ready to cast';
    resultPanel.classList.remove('revealed', 'critical');
    return;
  }
  if (OVERLAY_MODE && !hasCast && !force) {
    isRolling = false;
    statusElement.classList.remove('rolling');
    statusText.textContent = 'Ready to cast';
    resultPanel.classList.remove('revealed', 'critical');
    return;
  }
  const maximumRadius = Math.max(...activeKinds.map((kind) => DIE_RADIUS[kind]));
  const spacing = maximumRadius >= 0.77 ? 1.34 : 1.18;
  const availableWidth = Math.max(1.5, screenBounds.x * 2 - 1.4);
  const columns = Math.max(1, Math.min(quantity, Math.floor(availableWidth / spacing)));
  const rows = Math.ceil(quantity / columns);

  for (let i = 0; i < quantity; i += 1) {
    const kind = activeKinds[i] ?? selectedKind;
    const theme = activeThemes[i] ?? selectedTheme;
    const diePhysics = activePhysics[i] ?? {};
    const die = new DieInstance(kind, theme, dicePhysicsMaterial, {
      mass: 1.12 * (diePhysics.massScale ?? 1),
      sizeScale: diePhysics.sizeScale,
      inertiaScale: diePhysics.inertiaScale,
    });
    const column = i % columns;
    const row = Math.floor(i / columns);
    const rowCount = Math.min(columns, quantity - row * columns);
    const x = (column - (rowCount - 1) / 2) * spacing;
    const z = (row - (rows - 1) / 2) * spacing * 0.9;
    die.body.position.set(x, 1.05 + row * 0.12, z);
    die.body.quaternion.setFromEuler(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );
    die.body.angularVelocity.set(
      (Math.random() - 0.5) * 0.22,
      (Math.random() - 0.5) * 0.22,
      (Math.random() - 0.5) * 0.22,
    );
    world.addBody(die.body);
    scene.add(die.group);
    attachCollisionAudio(die);
    dice.push(die);
  }
  isRolling = false;
  statusElement.classList.remove('rolling');
  statusText.textContent = 'Ready to cast';
  resultPanel.classList.remove('revealed', 'critical');
  resultTotal.textContent = '—';
  const poolLabel = activeKinds.every((kind) => kind === activeKinds[0])
    ? `${quantity}${activeKinds[0].toUpperCase()}`
    : activeKinds.map((kind) => kind.toUpperCase()).join(' + ');
  resultDetail.textContent = `Ready · ${poolLabel}`;
  requestRender();
}

function setPhysicalDiceVisible(visible: boolean): void {
  for (const die of dice) die.group.visible = visible;
}

function setStatus(text: string, rolling: boolean): void {
  statusText.textContent = text;
  statusElement.classList.toggle('rolling', rolling);
}

function normalizeRequestedResults(values: number[]): number[] | null {
  if (values.length === 0) return [];
  const expanded =
    values.length === 1 ? Array.from({ length: quantity }, () => values[0]) : values.slice();
  if (expanded.length !== quantity) return null;
  if (
    expanded.some((value, index) => {
      const maximum = Number((activeKinds[index] ?? selectedKind).slice(1));
      return !Number.isInteger(value) || value < 1 || value > maximum;
    })
  )
    return null;
  return expanded;
}

function readRequestedResults(): number[] | null {
  if (quantity === 0) {
    queuedApiResults = null;
    return [];
  }
  if (queuedApiResults) {
    const requested = normalizeRequestedResults(queuedApiResults);
    queuedApiResults = null;
    return requested;
  }
  const raw = presetInput.value.trim();
  if (!raw) return [];
  const values = raw
    .split(/[\s,;|/]+/)
    .filter(Boolean)
    .map((token) => Number(token));
  return normalizeRequestedResults(values);
}

function normalizeOutcomes(
  values: EffectOutcome[] | EffectOutcome | null,
  count: number,
): EffectOutcome[] | null {
  if (values === null) return null;
  const source = Array.isArray(values) ? values : [values];
  const valid = new Set<EffectOutcome>(['positive', 'neutral', 'negative', 'none']);
  if (source.some((value) => !valid.has(value))) return null;
  if (source.length === 1) return Array.from({ length: count }, () => source[0]);
  if (source.length !== count) return null;
  return source.slice();
}

function defaultOutcomeResolver(results: number[]): EffectOutcome[] {
  const allEqual = results.length > 1 && results.every((value) => value === results[0]);
  return results.map((value, index) => {
    const max = Number((activeKinds[index] ?? selectedKind).slice(1));
    if (allEqual || value === max) return 'positive';
    if (value === 1) return 'negative';
    return neutralEffects ? 'neutral' : 'none';
  });
}

function resolveOutcomes(results: number[]): EffectOutcome[] {
  const explicit = normalizeOutcomes(queuedOutcomes, results.length);
  queuedOutcomes = null;
  if (explicit) return explicit;

  if (outcomeResolver) {
    const resolved = normalizeOutcomes(
      outcomeResolver({
        results: results.slice(),
        dieKind: activeKinds[0] ?? selectedKind,
        dieKinds: activeKinds.slice(),
        quantity,
        context: { ...activeContext },
      }),
      results.length,
    );
    if (resolved) return resolved;
  }
  return defaultOutcomeResolver(results);
}

function showPresetError(): void {
  presetInput.classList.add('invalid');
  const ranges = activeKinds.map((kind) => `1–${Number(kind.slice(1))}`).join(', ');
  setStatus(`Use valid values for ${ranges}`, false);
  presetInput.focus();
}

function normalizeThemes(
  values: ThemeName[] | ThemeName | null,
  count: number,
): ThemeName[] | null {
  if (count === 0)
    return values === null || (Array.isArray(values) && values.length === 0) ? [] : null;
  if (values === null) return Array.from({ length: count }, () => selectedTheme);
  const source = Array.isArray(values) ? values : [values];
  if (source.some((value) => !THEME_MANIFESTS[value])) return null;
  if (source.length === 1) return Array.from({ length: count }, () => source[0]);
  if (source.length !== count) return null;
  return source.slice();
}

function normalizeKinds(
  values: DieKind[] | DieKind | null,
  expectedCount: number,
): DieKind[] | null {
  if (expectedCount === 0)
    return values === null || (Array.isArray(values) && values.length === 0) ? [] : null;
  if (values === null) return Array.from({ length: expectedCount }, () => selectedKind);
  const source = Array.isArray(values) ? values : [values];
  const valid = new Set<DieKind>(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);
  if (source.some((kind) => !valid.has(kind))) return null;
  if (source.length === 1) return Array.from({ length: expectedCount }, () => source[0]);
  if (source.length !== expectedCount) return null;
  return source.slice();
}

function normalizePhysicalProperties(
  explicit: readonly DicePhysicsProperties[] | null,
  kinds: readonly DieKind[],
  themes: readonly ThemeName[],
  presetName: DicePhysicsPreset,
): DicePhysicsProperties[] | null {
  if (explicit && explicit.length !== kinds.length) return null;
  const preset = PHYSICS_PRESETS[presetName];
  return kinds.map((kind, index) => {
    const theme = getRuntimeThemePhysics(themes[index] ?? selectedTheme, kind) ?? {};
    const override = explicit?.[index] ?? {};
    return {
      sizeScale: THREE.MathUtils.clamp(
        (override.sizeScale ?? theme.sizeScale ?? 1) * preset.sizeScale,
        0.5,
        2,
      ),
      massScale: THREE.MathUtils.clamp(
        (override.massScale ?? theme.massScale ?? 1) * preset.massScale,
        0.25,
        4,
      ),
      inertiaScale: THREE.MathUtils.clamp(
        (override.inertiaScale ?? theme.inertiaScale ?? 1) * preset.inertiaScale,
        0.25,
        4,
      ),
    };
  });
}

function applyDiePhysicsRuntime(die: DieInstance, presetName: DicePhysicsPreset): void {
  const preset = PHYSICS_PRESETS[presetName];
  die.body.linearDamping = preset.linearDamping;
  die.body.angularDamping = preset.angularDamping;
}

function prepareTargets(): boolean {
  const explicitResultCount = queuedApiResults !== null ? queuedApiResults.length : null;
  const explicitKindCount = Array.isArray(queuedKinds) ? queuedKinds.length : null;
  const fallbackOnlyRequest =
    queuedFallbacks !== null &&
    queuedFallbacks.length > 0 &&
    queuedApiResults === null &&
    queuedKinds === null;
  const requestedCount = fallbackOnlyRequest
    ? 0
    : (explicitKindCount ?? explicitResultCount ?? quantity);
  const kinds = normalizeKinds(queuedKinds, requestedCount);
  queuedKinds = null;
  if (!kinds) {
    setStatus('Use one physical die kind per physical result', false);
    return false;
  }

  const validOutcomes = new Set<EffectOutcome>(['positive', 'neutral', 'negative', 'none']);
  // Defensive copy: callers own `queuedFallbacks`, so these must not be mutated in place.
  // oxlint-disable-next-line oxc/no-map-spread
  const fallbacks = (queuedFallbacks ?? []).map((fallback) => ({
    ...fallback,
    theme: THEME_MANIFESTS[fallback.theme] ? fallback.theme : selectedTheme,
    outcome: validOutcomes.has(fallback.outcome) ? fallback.outcome : 'neutral',
    metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
  }));
  queuedFallbacks = null;
  if (kinds.length + fallbacks.length < 1 || kinds.length + fallbacks.length > 30) {
    setStatus('A visual roll must contain between 1 and 30 components', false);
    return false;
  }

  activeKinds = kinds;
  quantity = kinds.length;
  quantityValue.textContent = String(quantity);

  const requested = readRequestedResults();
  if (requested === null) {
    showPresetError();
    return false;
  }
  presetInput.classList.remove('invalid');
  const themes = normalizeThemes(queuedThemes, quantity);
  queuedThemes = null;
  if (!themes) {
    setStatus(`Use one theme or ${quantity} per-die themes`, false);
    return false;
  }
  activeThemes = themes;
  activePhysicsPreset = queuedPhysicsPreset;
  const physics = normalizePhysicalProperties(
    queuedPhysics,
    activeKinds,
    activeThemes,
    activePhysicsPreset,
  );
  queuedPhysics = null;
  queuedPhysicsPreset = 'standard';
  if (!physics) {
    setStatus(`Use ${quantity} per-die physics entries`, false);
    return false;
  }
  activePhysics = physics;
  world.gravity.set(0, -PHYSICS_PRESETS[activePhysicsPreset].gravity, 0);
  spawnPreview(kinds, true);
  dice.forEach((die) => applyDiePhysicsRuntime(die, activePhysicsPreset));
  activeTargets =
    requested.length > 0
      ? requested.map((value) => value)
      : Array.from({ length: quantity }, () => null);
  activeFallbackSpecs = fallbacks;
  activeVisualOrder = normalizeVisualOrder(queuedVisualOrder, quantity, fallbacks.length);
  queuedVisualOrder = null;
  if (activeVisualOrder.length !== quantity + fallbacks.length) {
    setStatus('Visual ordering does not match the roll components', false);
    return false;
  }

  activeContext = { ...queuedContext };
  queuedContext = {};
  activeSeed = normalizeSeed(queuedSeed);
  queuedSeed = null;
  spawnFallbackVisuals(activeFallbackSpecs, activeSeed);
  activeStartAtMs = queuedStartAtMs;
  activeSeekToMs = queuedSeekToMs;
  activeAnimationDurationMs = queuedAnimationDurationMs;
  activeSettleImmediately = queuedSettleImmediately;
  activeLateMode = queuedLateMode;
  activeSettleAfterProgress = queuedSettleAfterProgress;
  queuedStartAtMs = null;
  queuedSeekToMs = 0;
  queuedAnimationDurationMs = null;
  queuedSettleImmediately = false;
  queuedLateMode = 'auto';
  queuedSettleAfterProgress = 0.78;
  return true;
}

function normalizeVisualOrder(
  order: DraftrollVisualOrderEntry[] | null,
  physicalCount: number,
  fallbackCount: number,
  defaultIdPrefix = '',
): DraftrollVisualOrderEntry[] {
  const fallbackOrder: DraftrollVisualOrderEntry[] = [
    ...Array.from({ length: physicalCount }, (_, index) => ({
      kind: 'physical' as const,
      index,
      dieId: `${defaultIdPrefix}physical_${index}`,
    })),
    ...Array.from({ length: fallbackCount }, (_, index) => ({
      kind: 'fallback' as const,
      index,
      dieId: `${defaultIdPrefix}fallback_${index}`,
    })),
  ];
  if (!order) return fallbackOrder;
  if (order.length !== physicalCount + fallbackCount) return [];
  const physicalIndexes = new Set<number>();
  const fallbackIndexes = new Set<number>();
  for (const entry of order) {
    if (entry.kind === 'physical') {
      if (entry.index < 0 || entry.index >= physicalCount || physicalIndexes.has(entry.index))
        return [];
      physicalIndexes.add(entry.index);
    } else {
      if (entry.index < 0 || entry.index >= fallbackCount || fallbackIndexes.has(entry.index))
        return [];
      fallbackIndexes.add(entry.index);
    }
  }
  return order.map((entry) => ({ ...entry }));
}

interface LaunchSpawn {
  position: CANNON.Vec3;
  scatterKey: number;
  releaseDelay: number;
}

interface ScatterBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function createOrganicPointCloud(
  count: number,
  bounds: ScatterBounds,
  minimumDistance: number,
  random: () => number,
  candidateCount = 48,
): THREE.Vector2[] {
  if (count <= 0) return [];
  const points: THREE.Vector2[] = [];
  const width = Math.max(0.001, bounds.maxX - bounds.minX);
  const depth = Math.max(0.001, bounds.maxZ - bounds.minZ);

  // Best-candidate sampling gives a blue-noise-like cluster: irregular, but
  // without the overlaps that caused the old delayed-spawn instability.
  for (let index = 0; index < count; index += 1) {
    let best = new THREE.Vector2(
      THREE.MathUtils.lerp(bounds.minX, bounds.maxX, random()),
      THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, random()),
    );
    let bestScore = -Infinity;
    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
      const candidate = new THREE.Vector2(
        THREE.MathUtils.lerp(bounds.minX, bounds.maxX, random()),
        THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, random()),
      );
      let nearest = Infinity;
      for (const point of points) nearest = Math.min(nearest, candidate.distanceToSquared(point));
      // A very small center preference keeps the set feeling like a handful
      // rather than an evenly populated technical test grid.
      const nx = (candidate.x - (bounds.minX + bounds.maxX) * 0.5) / width;
      const nz = (candidate.y - (bounds.minZ + bounds.maxZ) * 0.5) / depth;
      const centerPenalty = (nx * nx + nz * nz) * minimumDistance * minimumDistance * 0.025;
      const score =
        (points.length === 0 ? minimumDistance * minimumDistance : nearest) - centerPenalty;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    points.push(best);
  }

  // Relax the random set instead of arranging it into rows. Repulsion is
  // purely a launch-layout operation; it never acts on the visible roll.
  const iterations = 96;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const progress = iteration / Math.max(1, iterations - 1);
    const jitter = minimumDistance * 0.035 * (1 - progress) * (1 - progress);
    for (let left = 0; left < points.length; left += 1) {
      const point = points[left];
      point.x += (random() - 0.5) * jitter;
      point.y += (random() - 0.5) * jitter;
      for (let right = left + 1; right < points.length; right += 1) {
        const other = points[right];
        let dx = other.x - point.x;
        let dz = other.y - point.y;
        let distance = Math.hypot(dx, dz);
        if (distance >= minimumDistance) continue;
        if (distance < 1e-5) {
          const angle = random() * Math.PI * 2;
          dx = Math.cos(angle) * 1e-3;
          dz = Math.sin(angle) * 1e-3;
          distance = 1e-3;
        }
        const correction = (minimumDistance - distance) * 0.5;
        const normalX = dx / distance;
        const normalZ = dz / distance;
        point.x -= normalX * correction;
        point.y -= normalZ * correction;
        other.x += normalX * correction;
        other.y += normalZ * correction;
      }
      point.x = THREE.MathUtils.clamp(point.x, bounds.minX, bounds.maxX);
      point.y = THREE.MathUtils.clamp(point.y, bounds.minZ, bounds.maxZ);
    }
  }

  return points;
}

interface HandClusterBounds {
  centerX: number;
  centerY: number;
  centerZ: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}

function clampPointToEllipsoid(point: THREE.Vector3, bounds: HandClusterBounds): void {
  const nx = (point.x - bounds.centerX) / Math.max(0.001, bounds.halfX);
  const ny = (point.y - bounds.centerY) / Math.max(0.001, bounds.halfY);
  const nz = (point.z - bounds.centerZ) / Math.max(0.001, bounds.halfZ);
  const normalizedLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (normalizedLength > 0.985) {
    const scale = 0.985 / normalizedLength;
    point.set(
      bounds.centerX + nx * scale * bounds.halfX,
      bounds.centerY + ny * scale * bounds.halfY,
      bounds.centerZ + nz * scale * bounds.halfZ,
    );
  }
}

function sampleEllipsoid(bounds: HandClusterBounds, random: () => number): THREE.Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let lengthSquared = 2;
  while (lengthSquared > 1 || lengthSquared < 0.0001) {
    x = random() * 2 - 1;
    y = random() * 2 - 1;
    z = random() * 2 - 1;
    lengthSquared = x * x + y * y + z * z;
  }
  return new THREE.Vector3(
    bounds.centerX + x * bounds.halfX,
    bounds.centerY + y * bounds.halfY,
    bounds.centerZ + z * bounds.halfZ,
  );
}

function minimumSpawnDistance(points: THREE.Vector3[]): number {
  let minimum = Infinity;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      minimum = Math.min(minimum, points[left].distanceTo(points[right]));
    }
  }
  return points.length < 2 ? Infinity : minimum;
}

function createHandCluster(
  count: number,
  random: () => number,
  horizontalBias: number,
): LaunchSpawn[] {
  if (count <= 0) return [];
  const radius = Math.max(...activeKinds.map((kind) => DIE_COLLIDER_RADIUS[kind]));
  const diameter = radius * 2;
  const safeSpacing = Math.max(1.1, diameter * 1.012);
  const root = Math.sqrt(count);
  const largePool = count >= 12;

  // Small pools leave one compact handful. Large pools are treated as a broad
  // two-handed pour: they still launch together, but their top-down footprints
  // are already separated before the first visible frame. This avoids the
  // stack-then-explode effect that made 20d20 look like teleporting sprites.
  let halfX = Math.min(screenBounds.x - 0.9, largePool ? 1.48 + root * 0.58 : 0.92 + root * 0.39);
  let halfZ = Math.min(
    largePool ? 2.42 : 1.92,
    largePool ? 0.82 + root * 0.31 : 0.58 + root * 0.235,
  );
  let halfY = Math.min(largePool ? 2.1 : 2.8, largePool ? 0.72 + root * 0.29 : 0.52 + root * 0.39);
  const centerXLimit = Math.max(0, screenBounds.x - halfX - 0.92);
  const centerX = THREE.MathUtils.clamp(
    horizontalBias * screenBounds.x * 0.32,
    -centerXLimit,
    centerXLimit,
  );
  const centerZ = screenBounds.z - halfZ - 0.82;
  const centerY = (largePool ? 1.06 : 1.18) + halfY;
  let bounds: HandClusterBounds = { centerX, centerY, centerZ, halfX, halfY, halfZ };
  let points: THREE.Vector3[] = [];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    points = [];
    const candidatesPerPoint = count > 20 ? 220 : count > 10 ? 180 : 105;
    for (let index = 0; index < count; index += 1) {
      let best = sampleEllipsoid(bounds, random);
      let bestScore = -Infinity;
      for (let candidateIndex = 0; candidateIndex < candidatesPerPoint; candidateIndex += 1) {
        const candidate = sampleEllipsoid(bounds, random);
        let nearest = Infinity;
        for (const point of points) nearest = Math.min(nearest, candidate.distanceToSquared(point));

        // Slightly favour the lower-front half of the bundle, as if the dice
        // are sitting in a cupped palm rather than filling a perfect sphere.
        const vertical = (candidate.y - bounds.centerY) / bounds.halfY;
        const depth = (candidate.z - bounds.centerZ) / bounds.halfZ;
        const palmBias = vertical * 0.018 + depth * 0.01;
        const score = (points.length === 0 ? safeSpacing * safeSpacing : nearest) - palmBias;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      points.push(best);
    }

    // Resolve any remaining close pairs in 3D. There is no force during the
    // visible roll; this is only a safe initial packing operation.
    const packingIterations = largePool ? 168 : 120;
    for (let iteration = 0; iteration < packingIterations; iteration += 1) {
      const progress = iteration / Math.max(1, packingIterations - 1);
      for (let left = 0; left < points.length; left += 1) {
        const point = points[left];
        for (let right = left + 1; right < points.length; right += 1) {
          const other = points[right];
          const delta = other.clone().sub(point);
          let distance = delta.length();
          if (distance >= safeSpacing) continue;
          if (distance < 1e-5) {
            delta.set(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
            distance = 1e-3;
          } else delta.multiplyScalar(1 / distance);
          const correction = (safeSpacing - distance) * 0.505;
          point.addScaledVector(delta, -correction);
          other.addScaledVector(delta, correction);
        }
        const inward = new THREE.Vector3(bounds.centerX, bounds.centerY, bounds.centerZ).sub(point);
        point.addScaledVector(inward, 0.0018 * (1 - progress));
        clampPointToEllipsoid(point, bounds);
      }
    }

    if (minimumSpawnDistance(points) >= safeSpacing * 0.93) break;
    // Expand large pours laterally and in depth before adding more height.
    // Projected separation matters as much as 3D separation for a top-down
    // table, while the collider skin guarantees the physical bodies start clear.
    halfX = Math.min(screenBounds.x - 0.9, halfX + (largePool ? 0.16 : 0.08));
    halfZ = Math.min(largePool ? 2.65 : 2.08, halfZ + (largePool ? 0.11 : 0.055));
    halfY = Math.min(largePool ? 2.35 : 3.2, halfY + (largePool ? 0.12 : 0.24));
    bounds = {
      centerX,
      centerY: (largePool ? 1.06 : 1.18) + halfY,
      centerZ: screenBounds.z - halfZ - 0.82,
      halfX,
      halfY,
      halfZ,
    };
  }

  const handYaw = (random() - 0.5) * 0.22;
  const cos = Math.cos(handYaw);
  const sin = Math.sin(handYaw);
  const result = points.map((point) => {
    const dx = point.x - bounds.centerX;
    const dz = point.z - bounds.centerZ;
    return {
      position: new CANNON.Vec3(
        bounds.centerX + dx * cos - dz * sin,
        point.y,
        bounds.centerZ + dx * sin + dz * cos,
      ),
      scatterKey: random() - 0.5,
      releaseDelay: 0,
    };
  });

  // Random die identity inside the handful prevents stable layer patterns
  // while preserving the safe packed positions.
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  if (largePool) {
    // A person cannot release twenty polyhedra from one mathematical instant.
    // Use a short continuous pour, keeping every die hidden until its own
    // activation frame. The complete 20d20 release still fits inside roughly
    // half a second, but no inactive stack is ever visible.
    const ordered = result
      .map((spawn, index) => ({
        index,
        key: spawn.position.x * 0.72 - spawn.position.z * 0.28 + spawn.position.y * 0.08,
      }))
      .toSorted((left, right) => left.key - right.key);
    const waveSize = count >= 24 ? 7 : 6;
    const waveInterval = count >= 24 ? 0.105 : 0.115;
    ordered.forEach((entry, rank) => {
      const wave = Math.floor(rank / waveSize);
      result[entry.index].releaseDelay = wave * waveInterval + random() * 0.018;
    });
  }
  return result;
}

function createHandTargets(
  spawns: LaunchSpawn[],
  random: () => number,
  throwDirection: THREE.Vector2,
): THREE.Vector2[] {
  const count = spawns.length;
  if (count === 0) return [];
  const handCenter = spawns
    .reduce(
      (sum, spawn) => sum.add(new THREE.Vector2(spawn.position.x, spawn.position.z)),
      new THREE.Vector2(),
    )
    .multiplyScalar(1 / count);
  const side = new THREE.Vector2(-throwDirection.y, throwDirection.x);
  const root = Math.sqrt(count);
  const travel = THREE.MathUtils.clamp(
    (count >= 12 ? 4.35 : 4.9) + root * (count >= 12 ? 0.16 : 0.18),
    count >= 12 ? 4.35 : 4.9,
    count >= 12 ? 5.35 : 6.0,
  );
  const destination = handCenter.clone().addScaledVector(throwDirection, travel);
  destination.x = THREE.MathUtils.clamp(destination.x, -screenBounds.x + 2.0, screenBounds.x - 2.0);
  destination.y = THREE.MathUtils.clamp(
    destination.y,
    -screenBounds.z + 1.75,
    screenBounds.z - 2.0,
  );

  const radius = Math.max(...activeKinds.map((kind) => DIE_COLLIDER_RADIUS[kind]));
  const targetSpacing = Math.max(0.76, radius * (count > 20 ? 1.16 : count > 12 ? 1.24 : 1.3));
  const sideSpread = Math.min(
    screenBounds.x * 0.78,
    (count >= 12 ? 1.62 : 1.18) + root * (count >= 12 ? 0.55 : 0.51),
  );
  const depthSpread = Math.min(
    count >= 12 ? 2.65 : 2.2,
    (count >= 12 ? 1.02 : 0.78) + root * (count >= 12 ? 0.31 : 0.27),
  );
  const localCloud = createOrganicPointCloud(
    count,
    { minX: -sideSpread, maxX: sideSpread, minZ: -depthSpread, maxZ: depthSpread },
    targetSpacing,
    random,
    count > 20 ? 34 : 46,
  );

  // Preserve only a loose lateral relationship between palm and landing
  // positions. This produces a natural fan without the obvious parallel lanes
  // or grid identity that made previous multi-die throws look procedural.
  const spawnOrder = spawns
    .map((spawn, index) => {
      const relative = new THREE.Vector2(spawn.position.x, spawn.position.z).sub(handCenter);
      return { index, key: relative.dot(side) + spawn.scatterKey * 0.75 };
    })
    .toSorted((a, b) => a.key - b.key);
  const targetOrder = localCloud
    .map((target, index) => ({ index, key: target.x + (random() - 0.5) * 0.7 }))
    .toSorted((a, b) => a.key - b.key);

  // A few neighbour swaps emulate dice sliding between fingers and remove the
  // last visual trace of a perfect fan, while avoiding violent full-width
  // crossovers.
  const swaps = Math.floor(count * 0.28);
  for (let index = 0; index < swaps; index += 1) {
    const left = Math.floor(random() * Math.max(1, count - 1));
    const right = Math.min(count - 1, left + (random() > 0.72 ? 2 : 1));
    [targetOrder[left], targetOrder[right]] = [targetOrder[right], targetOrder[left]];
  }

  const targets = Array.from({ length: count }, () => new THREE.Vector2());
  for (let rank = 0; rank < count; rank += 1) {
    const spawnIndex = spawnOrder[rank].index;
    const local = localCloud[targetOrder[rank].index];
    const target = destination
      .clone()
      .addScaledVector(side, local.x)
      .addScaledVector(throwDirection, local.y);
    targets[spawnIndex].set(
      THREE.MathUtils.clamp(target.x, -screenBounds.x + 0.92, screenBounds.x - 0.92),
      THREE.MathUtils.clamp(target.y, -screenBounds.z + 0.92, screenBounds.z - 0.92),
    );
  }
  return targets;
}

function estimateFirstImpactTime(positionY: number, velocityY: number, radius: number): number {
  const gravity = 20.5;
  const landingHeight = Math.max(0.62, radius * 0.94);
  const drop = Math.max(0.05, positionY - landingHeight);
  return (velocityY + Math.sqrt(velocityY * velocityY + 2 * gravity * drop)) / gravity;
}

interface ActiveTableRollGroup {
  groupId: string;
  actorLabel?: string;
  rollLabel?: string;
  total: number;
  physicalStart: number;
  physicalCount: number;
  fallbackStart: number;
  fallbackCount: number;
  visualCount: number;
}

function readActiveTableRolls(): ActiveTableRollGroup[] {
  const raw = activeContext.tableRolls;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!isRecord(value)) return [];
    const entry = value;
    const physicalStart = Number(entry.physicalStart);
    const physicalCount = Number(entry.physicalCount);
    const fallbackStart = Number(entry.fallbackStart);
    const fallbackCount = Number(entry.fallbackCount);
    const visualCount = Number(entry.visualCount);
    const total = Number(entry.total);
    if (
      ![physicalStart, physicalCount, fallbackStart, fallbackCount, visualCount, total].every(
        Number.isFinite,
      )
    )
      return [];
    return [
      {
        groupId: typeof entry.groupId === 'string' ? entry.groupId : `table-roll-${physicalStart}`,
        actorLabel: typeof entry.actorLabel === 'string' ? entry.actorLabel : undefined,
        rollLabel: typeof entry.rollLabel === 'string' ? entry.rollLabel : undefined,
        total,
        physicalStart: Math.max(0, Math.floor(physicalStart)),
        physicalCount: Math.max(0, Math.floor(physicalCount)),
        fallbackStart: Math.max(0, Math.floor(fallbackStart)),
        fallbackCount: Math.max(0, Math.floor(fallbackCount)),
        visualCount: Math.max(0, Math.floor(visualCount)),
      },
    ];
  });
}

function createLaunchStatesForGroup(
  groupDice: readonly DieInstance[],
  random: () => number,
  throwDirection: THREE.Vector2,
  handBias: number,
): LaunchState[] {
  const spawns = createHandCluster(groupDice.length, random, handBias);
  const targets = createHandTargets(spawns, random, throwDirection);
  const handCenter = spawns
    .reduce(
      (sum, spawn) =>
        sum.add(new THREE.Vector3(spawn.position.x, spawn.position.y, spawn.position.z)),
      new THREE.Vector3(),
    )
    .multiplyScalar(1 / Math.max(1, spawns.length));
  const side = new THREE.Vector2(-throwDirection.y, throwDirection.x);
  const crowded = groupDice.length > 15;
  const largePool = groupDice.length >= 12;
  const maximumHorizontalSpeed = crowded
    ? 7.35
    : largePool
      ? 7.75
      : groupDice.length > 8
        ? 8.55
        : 9.4;
  const minimumHorizontalSpeed = crowded
    ? 4.65
    : largePool
      ? 4.95
      : groupDice.length > 8
        ? 5.7
        : 6.25;
  const globalWristTwist = (random() - 0.5) * (crowded ? 2.2 : 3.1);
  const releaseWindow =
    groupDice.length <= 2
      ? 0
      : THREE.MathUtils.lerp(
          0.024,
          largePool ? 0.09 : 0.056,
          THREE.MathUtils.clamp((groupDice.length - 3) / 27, 0, 1),
        );

  return groupDice.map((die, index) => {
    const spawn = spawns[index];
    const position = spawn.position;
    const quaternion = new CANNON.Quaternion();
    const sharedPitch = -0.28 + (random() - 0.5) * 0.28;
    const sharedYaw = Math.atan2(throwDirection.x, -throwDirection.y) + (random() - 0.5) * 0.46;
    quaternion.setFromEuler(
      sharedPitch + (random() - 0.5) * Math.PI * 0.9,
      sharedYaw + (random() - 0.5) * Math.PI * 0.75,
      (random() - 0.5) * Math.PI * 1.15,
    );
    const target = targets[index];
    const radius = DIE_COLLIDER_RADIUS[die.kind];
    const rollingRadius = Math.max(0.44, radius * 0.9);

    const relativeX = position.x - handCenter.x;
    const relativeY = position.y - handCenter.y;
    const relativeZ = position.z - handCenter.z;
    const localSide = relativeX * side.x + relativeZ * side.y;
    const localForward = relativeX * throwDirection.x + relativeZ * throwDirection.y;
    const normalish = random() + random() + random() - 1.5;
    const desiredVelocityY =
      (largePool ? 1.72 : 2.15) +
      random() * (largePool ? 1.05 : 1.25) +
      THREE.MathUtils.clamp(relativeY * 0.1, -0.18, 0.25);
    const headroom = Math.max(0.18, 9.0 - position.y);
    const ceilingSafeVelocityY = Math.sqrt(2 * 20.5 * headroom) * 0.72;
    const velocityY = Math.max(0.72, Math.min(desiredVelocityY, ceilingSafeVelocityY));
    const flightTime = Math.max(0.42, estimateFirstImpactTime(position.y, velocityY, radius));

    let velocityX = (target.x - position.x) / flightTime;
    let velocityZ = (target.y - position.z) / flightTime;
    const palmFan = THREE.MathUtils.clamp(localSide * 0.21, -0.65, 0.65) + normalish * 0.16;
    velocityX += side.x * palmFan + throwDirection.x * (0.12 + random() * 0.22);
    velocityZ += side.y * palmFan + throwDirection.y * (0.12 + random() * 0.22);
    velocityX += (random() - 0.5) * (crowded ? 0.34 : 0.48);
    velocityZ += (random() - 0.5) * (crowded ? 0.3 : 0.42);

    let horizontalSpeed = Math.hypot(velocityX, velocityZ);
    if (horizontalSpeed < minimumHorizontalSpeed) {
      const scale = minimumHorizontalSpeed / Math.max(0.001, horizontalSpeed);
      velocityX *= scale;
      velocityZ *= scale;
      horizontalSpeed = minimumHorizontalSpeed;
    }
    if (horizontalSpeed > maximumHorizontalSpeed) {
      const scale = maximumHorizontalSpeed / horizontalSpeed;
      velocityX *= scale;
      velocityZ *= scale;
    }

    const rollingX = velocityZ / rollingRadius;
    const rollingZ = -velocityX / rollingRadius;
    const rollingBlend = crowded ? 0.82 : largePool ? 0.77 : 0.7;
    const tumble = crowded ? 4.15 : largePool ? 4.45 : 4.25;
    const angularVelocity = new CANNON.Vec3(
      rollingX * rollingBlend +
        (random() - 0.5) * tumble +
        throwDirection.y * globalWristTwist * 0.34,
      globalWristTwist + (random() - 0.5) * (crowded ? 3.0 : 4.0),
      rollingZ * rollingBlend +
        (random() - 0.5) * tumble -
        throwDirection.x * globalWristTwist * 0.34,
    );

    const forwardPhase = THREE.MathUtils.clamp((localForward + 1.4) / 2.8, 0, 1);
    const heightPhase = THREE.MathUtils.clamp((relativeY + 2.2) / 4.4, 0, 1);
    const delay =
      spawn.releaseDelay +
      releaseWindow *
        THREE.MathUtils.clamp(
          (1 - forwardPhase) * 0.42 + heightPhase * 0.38 + random() * 0.2,
          0,
          1,
        );

    return {
      position,
      quaternion,
      velocity: new CANNON.Vec3(velocityX, velocityY, velocityZ),
      angularVelocity,
      delay,
    };
  });
}

function createLaunchStates(swipe: THREE.Vector2 | undefined, seed: string): LaunchState[] {
  const tableRolls = readActiveTableRolls().filter((group) => group.physicalCount > 0);
  if (tableRolls.length > 1) {
    const states: LaunchState[] = [];
    tableRolls.forEach((group, index) => {
      const lane =
        tableRolls.length === 1
          ? 0
          : THREE.MathUtils.lerp(-0.82, 0.82, index / (tableRolls.length - 1));
      const random = createSeededRandom(`${seed}:${group.groupId}`);
      const throwDirection = new THREE.Vector2(-lane * 0.28, -1)
        .normalize()
        .rotateAround(new THREE.Vector2(), (random() - 0.5) * 0.12);
      const groupDice = dice.slice(group.physicalStart, group.physicalStart + group.physicalCount);
      states.push(...createLaunchStatesForGroup(groupDice, random, throwDirection, lane));
    });
    if (states.length === dice.length) return states;
  }

  const random = createSeededRandom(seed);
  const swipeLateral = swipe ? THREE.MathUtils.clamp(swipe.x / 190, -0.78, 0.78) : 0;
  const swipeForward = swipe ? THREE.MathUtils.clamp(-swipe.y / 260, -0.3, 0.72) : 0;
  const naturalYaw = (random() - 0.5) * (dice.length > 12 ? 0.15 : 0.22);
  const throwDirection = new THREE.Vector2(swipeLateral * 0.62, -1 + swipeForward * 0.13)
    .normalize()
    .rotateAround(new THREE.Vector2(), naturalYaw);
  const handBias = swipeLateral * 0.48 + (random() - 0.5) * 0.12;
  return createLaunchStatesForGroup(dice, random, throwDirection, handBias);
}

function cloneDynamicBody(source: CANNON.Body, state: LaunchState): CANNON.Body {
  const clone = new CANNON.Body({ mass: source.mass, material: dicePhysicsMaterial });
  for (let index = 0; index < source.shapes.length; index += 1) {
    clone.addShape(
      source.shapes[index],
      source.shapeOffsets[index].clone(),
      source.shapeOrientations[index].clone(),
    );
  }
  clone.linearDamping = source.linearDamping;
  clone.angularDamping = source.angularDamping;
  clone.allowSleep = source.allowSleep;
  clone.sleepSpeedLimit = source.sleepSpeedLimit;
  clone.sleepTimeLimit = source.sleepTimeLimit;
  clone.position.copy(state.position);
  clone.quaternion.copy(state.quaternion);
  clone.velocity.copy(state.velocity);
  clone.angularVelocity.copy(state.angularVelocity);
  clone.wakeUp();
  return clone;
}

function appendFrame(buffer: number[], bodies: CANNON.Body[]): void {
  for (const body of bodies) {
    buffer.push(
      body.position.x,
      body.position.y,
      body.position.z,
      body.quaternion.x,
      body.quaternion.y,
      body.quaternion.z,
      body.quaternion.w,
    );
  }
}

/** Jaccard-style overlap of two sorted contact-index lists, used to detect settled dice. */
function contactSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  let left = 0;
  let right = 0;
  let intersection = 0;
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) {
      intersection += 1;
      left += 1;
      right += 1;
    } else if (a[left] < b[right]) left += 1;
    else right += 1;
  }
  return intersection / Math.max(1, Math.max(a.length, b.length));
}

function buildRollPlanSync(states: LaunchState[]): RollPlan {
  const planner = new CANNON.World({
    gravity: new CANNON.Vec3(0, -PHYSICS_PRESETS[activePhysicsPreset].gravity, 0),
  });
  configureWorld(planner);
  const plannerFloor = new CANNON.Body({
    mass: 0,
    material: tablePhysicsMaterial,
    shape: new CANNON.Plane(),
  });
  plannerFloor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  planner.addBody(plannerFloor);
  const staticBodies = [plannerFloor, ...addCurrentWalls(planner)];

  const plannerDice = dice.map((die, index) => cloneDynamicBody(die.body, states[index]));
  const plannerCrowd = THREE.MathUtils.clamp((plannerDice.length - 8) / 22, 0, 1);
  for (const body of plannerDice) {
    body.linearDamping = 0.095 + plannerCrowd * 0.025;
    body.angularDamping = 0.085 + plannerCrowd * 0.045;
    body.sleepSpeedLimit = 0.18 + plannerCrowd * 0.035;
    body.sleepTimeLimit = 0.5;
  }
  const plannerMasses = plannerDice.map((body) => body.mass);
  const activeFlags = Array.from({ length: plannerDice.length }, () => false);
  const impacts: RollImpact[] = [];
  let currentStep = 0;
  const activate = (body: CANNON.Body, index: number): void => {
    body.type = CANNON.Body.DYNAMIC;
    body.mass = plannerMasses[index] ?? 1.12;
    body.updateMassProperties();
    body.collisionResponse = true;
    body.velocity.copy(states[index].velocity);
    body.angularVelocity.copy(states[index].angularVelocity);
    body.wakeUp();
    activeFlags[index] = true;
  };
  plannerDice.forEach((body, dieIndex) => {
    body.addEventListener('collide', (event: { contact: CANNON.ContactEquation }) => {
      if (!activeFlags[dieIndex]) return;
      const strength = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (strength > 1.5) impacts.push({ time: currentStep * PLANNER_STEP, dieIndex, strength });
    });
    planner.addBody(body);
    if (states[dieIndex].delay > 0) {
      body.type = CANNON.Body.KINEMATIC;
      body.mass = 0;
      body.updateMassProperties();
      body.collisionResponse = false;
      body.velocity.setZero();
      body.angularVelocity.setZero();
    } else activate(body, dieIndex);
  });

  const bodyKeys = new Map<number, number>();
  plannerDice.forEach((body, index) => bodyKeys.set(body.id, index));
  staticBodies.forEach((body, index) => bodyKeys.set(body.id, plannerDice.length + index));
  const getContacts = (): number[] => {
    const keys: number[] = [];
    for (const contact of planner.contacts) {
      const a = bodyKeys.get(contact.bi.id);
      const b = bodyKeys.get(contact.bj.id);
      if (a === undefined || b === undefined) continue;
      keys.push(Math.min(a, b) * 128 + Math.max(a, b));
    }
    return Array.from(new Set(keys)).toSorted((a, b) => a - b);
  };
  const stablePositions = new Float32Array(plannerDice.length * 3);
  const copyStablePositions = (): void =>
    plannerDice.forEach((body, index) => {
      stablePositions[index * 3] = body.position.x;
      stablePositions[index * 3 + 1] = body.position.y;
      stablePositions[index * 3 + 2] = body.position.z;
    });
  const maxDisplacementSquared = (): number =>
    plannerDice.reduce((maximum, body, index) => {
      if (!activeFlags[index]) return maximum;
      const dx = body.position.x - stablePositions[index * 3];
      const dy = body.position.y - stablePositions[index * 3 + 1];
      const dz = body.position.z - stablePositions[index * 3 + 2];
      return Math.max(maximum, dx * dx + dy * dy + dz * dz);
    }, 0);

  const frameData: number[] = [];
  appendFrame(frameData, plannerDice);
  let frameCount = 1;
  let slowTime = 0;
  let contactStableTime = 0;
  let displacementStableTime = 0;
  let previousContacts: number[] = [];
  let settleReason = 'timeout';
  const maxSteps = 1_080;
  const minSteps = 120;
  const recordEvery = PLANNER_RECORD_EVERY;
  const maximumDelay = Math.max(0, ...states.map((state) => state.delay));
  copyStablePositions();

  for (currentStep = 1; currentStep <= maxSteps; currentStep += 1) {
    const simulationTime = currentStep * PLANNER_STEP;
    let activated = false;
    plannerDice.forEach((body, index) => {
      if (!activeFlags[index] && simulationTime + 1e-6 >= states[index].delay) {
        activate(body, index);
        activated = true;
      }
    });
    if (activated) {
      contactStableTime = 0;
      displacementStableTime = 0;
      previousContacts = [];
      copyStablePositions();
    }

    planner.step(PLANNER_STEP);
    enforceBodiesBounds(plannerDice, simulationTime);
    let linearSum = 0;
    let angularSum = 0;
    let allSlow = activeFlags.every(Boolean);
    let activeCount = 0;
    plannerDice.forEach((body, index) => {
      if (!activeFlags[index]) return;
      activeCount += 1;
      const speed = body.velocity.length();
      const angularSpeed = body.angularVelocity.length();
      linearSum += speed;
      angularSum += angularSpeed;
      if (!(body.sleepState === CANNON.Body.SLEEPING || (speed < 0.2 && angularSpeed < 0.28)))
        allSlow = false;
    });
    slowTime = allSlow ? slowTime + PLANNER_STEP : 0;
    const contacts = getContacts();
    if (contactSimilarity(contacts, previousContacts) >= 0.82) contactStableTime += PLANNER_STEP;
    else {
      previousContacts = contacts;
      contactStableTime = 0;
    }
    if (maxDisplacementSquared() <= 0.009 * 0.009) displacementStableTime += PLANNER_STEP;
    else {
      copyStablePositions();
      displacementStableTime = 0;
    }

    if (currentStep % recordEvery === 0) {
      appendFrame(frameData, plannerDice);
      frameCount += 1;
      const afterLastActivation = simulationTime >= maximumDelay + 0.3;
      const averageLinear = linearSum / Math.max(1, activeCount);
      const averageAngular = angularSum / Math.max(1, activeCount);
      const sleepSettled = afterLastActivation && slowTime > 0.5;
      const contactSettled =
        afterLastActivation &&
        averageLinear < 0.11 &&
        averageAngular < 0.18 &&
        contactStableTime > 0.24 &&
        displacementStableTime > 0.22;
      const microMotionSettled =
        afterLastActivation &&
        averageLinear < 0.035 &&
        averageAngular < 0.065 &&
        displacementStableTime > 0.2;
      if (currentStep >= minSteps && (sleepSettled || contactSettled || microMotionSettled)) {
        settleReason = contactSettled
          ? 'stable-contact-graph'
          : microMotionSettled
            ? 'micro-motion-stable'
            : 'sleep-threshold';
        break;
      }
    }
  }

  const transforms = new Float32Array(frameData);
  const stride = plannerDice.length * 7;
  const lastFrameOffset = (frameCount - 1) * stride;
  const results: number[] = [];
  dice.forEach((die, index) => {
    die.resetNumbering();
    const offset = lastFrameOffset + index * 7;
    const quaternion = {
      x: transforms[offset + 3],
      y: transforms[offset + 4],
      z: transforms[offset + 5],
      w: transforms[offset + 6],
    };
    const landingFace = die.getTopFaceIndex(quaternion);
    results.push(die.getValueForFaceIndex(landingFace));
  });

  return {
    step: PLANNER_RECORD_STEP,
    frameCount,
    dieCount: plannerDice.length,
    transforms,
    activationDelays: Float32Array.from(states, (state) => state.delay),
    impacts,
    duration: (frameCount - 1) * PLANNER_RECORD_STEP,
    results,
    settleReason,
    physicsSteps: currentStep,
  };
}

interface WorkerPlanResponse {
  id: number;
  step: number;
  frameCount: number;
  dieCount: number;
  transforms: ArrayBuffer;
  impacts: ArrayBuffer;
  duration: number;
  settleReason: string;
  physicsSteps: number;
  diagnostics?: RollPlanDiagnostics;
}

interface PendingPlan {
  resolve: (plan: Omit<RollPlan, 'results'>) => void;
  reject: (error: Error) => void;
}

let rollWorker: Worker | null = null;
let rollWorkerReleaseTimer: number | null = null;
const pendingPlans = new Map<number, PendingPlan>();
let nextPlanId = 1;

function releaseRollWorker(): void {
  if (pendingPlans.size > 0) return;
  rollWorker?.terminate();
  rollWorker = null;
  if (rollWorkerReleaseTimer !== null) window.clearTimeout(rollWorkerReleaseTimer);
  rollWorkerReleaseTimer = null;
}

function scheduleRollWorkerRelease(): void {
  if (rollWorkerReleaseTimer !== null) window.clearTimeout(rollWorkerReleaseTimer);
  rollWorkerReleaseTimer = window.setTimeout(releaseRollWorker, 45_000);
}

function getRollWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (rollWorker) return rollWorker;
  const worker = new Worker(new URL('./roll-worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<WorkerPlanResponse>) => {
    const response = event.data;
    const pending = pendingPlans.get(response.id);
    if (!pending) return;
    pendingPlans.delete(response.id);
    const impactData = new Float32Array(response.impacts);
    const impacts: RollImpact[] = Array.from(
      { length: Math.floor(impactData.length / 3) },
      (_, index) => {
        const offset = index * 3;
        return {
          time: impactData[offset],
          dieIndex: Math.round(impactData[offset + 1]),
          strength: impactData[offset + 2],
        };
      },
    );
    pending.resolve({
      step: response.step,
      frameCount: response.frameCount,
      dieCount: response.dieCount,
      transforms: new Float32Array(response.transforms),
      impacts,
      duration: response.duration,
      settleReason: response.settleReason,
      physicsSteps: response.physicsSteps,
      diagnostics: response.diagnostics,
    });
    if (pendingPlans.size === 0) scheduleRollWorkerRelease();
  });
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Roll worker failed.');
    for (const pending of pendingPlans.values()) pending.reject(error);
    pendingPlans.clear();
    releaseRollWorker();
  });
  rollWorker = worker;
  return worker;
}

function packLaunchStates(states: LaunchState[]): Float32Array {
  const packed = new Float32Array(states.length * 14);
  states.forEach((state, index) => {
    const offset = index * 14;
    packed[offset] = state.position.x;
    packed[offset + 1] = state.position.y;
    packed[offset + 2] = state.position.z;
    packed[offset + 3] = state.quaternion.x;
    packed[offset + 4] = state.quaternion.y;
    packed[offset + 5] = state.quaternion.z;
    packed[offset + 6] = state.quaternion.w;
    packed[offset + 7] = state.velocity.x;
    packed[offset + 8] = state.velocity.y;
    packed[offset + 9] = state.velocity.z;
    packed[offset + 10] = state.angularVelocity.x;
    packed[offset + 11] = state.angularVelocity.y;
    packed[offset + 12] = state.angularVelocity.z;
    packed[offset + 13] = state.delay;
  });
  return packed;
}

function readLandingValue(plan: RollPlan, transforms: Float32Array, dieIndex: number): number {
  const stride = plan.dieCount * 7;
  const offset = (plan.frameCount - 1) * stride + dieIndex * 7;
  const die = dice[dieIndex];
  die.resetNumbering();
  const landingIndex = die.getTopFaceIndex({
    x: transforms[offset + 3],
    y: transforms[offset + 4],
    z: transforms[offset + 5],
    w: transforms[offset + 6],
  });
  return die.getValueForFaceIndex(landingIndex);
}

/**
 * Exact-result targeting for regular dice without post-landing movement.
 *
 * A regular die is invariant under a finite set of proper rotations. Once a
 * natural trajectory has been simulated, a constant local-space symmetry can
 * be applied to every quaternion in that trajectory so the requested printed
 * face occupies the naturally landed face. Positions, collision timings,
 * bounces, and angular motion remain unchanged; there is no late torque,
 * relabeling, snap, or second settling phase.
 *
 * Existing dice in an additive presentation never receive a new symmetry,
 * because their already-visible orientation must stay continuous. In-flight
 * dice can follow a preserved kinematic trajectory; settled dice can re-enter
 * as ordinary dynamic bodies and be knocked naturally by the new handful.
 */
function applyShapeSymmetryTargets(plan: RollPlan, preservedCount = 0): RollPlan {
  const transforms = plan.transforms.slice();
  const frameStride = plan.dieCount * 7;
  const retargetedDice: number[] = [];
  const naturallyMatched = new Set<number>();
  const finalTargetDots: number[] = [];
  const baseQuaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  for (let dieIndex = 0; dieIndex < plan.dieCount; dieIndex += 1) {
    // Existing dice are already visible. Their current orientation must remain
    // continuous, so exact-result retargeting applies only to newly introduced
    // dice. In-flight existing dice use a preserved kinematic trajectory;
    // already-settled dice may be knocked naturally and show a different face.
    if (dieIndex < preservedCount) continue;

    const target = activeTargets[dieIndex];
    const rawLandingValue = readLandingValue(plan, transforms, dieIndex);
    if (target === null || target === undefined || rawLandingValue === target) {
      if (target !== null && target !== undefined) naturallyMatched.add(dieIndex);
      continue;
    }

    const symmetry = dice[dieIndex].getResultSymmetryRotation(target, rawLandingValue);
    retargetedDice.push(dieIndex);
    for (let frame = 0; frame < plan.frameCount; frame += 1) {
      const offset = frame * frameStride + dieIndex * 7;
      baseQuaternion
        .set(
          transforms[offset + 3],
          transforms[offset + 4],
          transforms[offset + 5],
          transforms[offset + 6],
        )
        .multiply(symmetry)
        .normalize();
      transforms[offset + 3] = baseQuaternion.x;
      transforms[offset + 4] = baseQuaternion.y;
      transforms[offset + 5] = baseQuaternion.z;
      transforms[offset + 6] = baseQuaternion.w;
    }
  }

  const results = dice
    .slice(0, plan.dieCount)
    .map((_die, index) => readLandingValue(plan, transforms, index));
  const failures: number[] = [];
  for (let index = preservedCount; index < plan.dieCount; index += 1) {
    const target = activeTargets[index];
    if (target !== null && target !== undefined && results[index] !== target) failures.push(index);
  }
  if (failures.length > 0) {
    throw new Error(
      `Shape-symmetry targeting failed for dice ${failures.map((index) => index + 1).join(', ')}.`,
    );
  }

  for (let index = 0; index < plan.dieCount; index += 1) {
    const target = activeTargets[index];
    if (index < preservedCount || target === null || target === undefined) {
      finalTargetDots.push(1);
      continue;
    }
    const offset = (plan.frameCount - 1) * frameStride + index * 7;
    const finalQuaternion = new THREE.Quaternion(
      transforms[offset + 3],
      transforms[offset + 4],
      transforms[offset + 5],
      transforms[offset + 6],
    );
    finalTargetDots.push(
      dice[index].getTargetNormal(target).applyQuaternion(finalQuaternion).normalize().dot(up),
    );
  }

  const completedPlan: RollPlan = {
    ...plan,
    transforms,
    results,
    settleReason:
      retargetedDice.length > 0 ? `${plan.settleReason}+shape-symmetry` : plan.settleReason,
    diagnostics: {
      ...plan.diagnostics,
      targetingMethod: 'shape-symmetry',
      candidateAttempts: 1,
      naturalTrajectory: true,
      naturalMatches: naturallyMatched.size,
      assistedDice: [],
      maximumAssistAngle: 0,
      finalTargetDots,
      targetSuccess: failures.length === 0,
      retargetedDice,
      continuityBlendedDice: [],
    },
  };
  completedPlan.settleTimes = deriveDieSettleTimes(completedPlan);
  return completedPlan;
}

async function buildRollPlan(
  states: LaunchState[],
  preservedCount = 0,
  lockedTrajectory?: LockedTableTrajectory,
): Promise<RollPlan> {
  const worker = getRollWorker();
  if (!worker) {
    if (preservedCount > 0) throw new Error('Additive table physics requires Web Worker support.');
    return applyShapeSymmetryTargets(buildRollPlanSync(states));
  }
  const lockedCount = lockedTrajectory ? preservedCount : 0;
  const id = nextPlanId++;
  const packed = packLaunchStates(states);
  const lockedTransforms = lockedTrajectory?.transforms.slice();
  const transfer: Transferable[] = [packed.buffer];
  if (lockedTransforms) transfer.push(lockedTransforms.buffer);
  const basePlan = await new Promise<Omit<RollPlan, 'results'>>((resolve, reject) => {
    pendingPlans.set(id, { resolve, reject });
    worker.postMessage(
      {
        id,
        kinds: activeKinds.slice(),
        count: states.length,
        boundsX: screenBounds.x,
        boundsZ: screenBounds.z,
        states: packed.buffer,
        lockedCount,
        lockedTrajectory: lockedTransforms?.buffer,
        lockedTrajectoryStep: lockedTrajectory?.step,
        lockedTrajectoryFrameCount: lockedTrajectory?.frameCount,
      },
      transfer,
    );
  });
  return applyShapeSymmetryTargets(
    {
      ...basePlan,
      results: [],
      activationDelays: Float32Array.from(states, (state) => state.delay),
    },
    preservedCount,
  );
}

function applyPlanTransform(plan: RollPlan, time: number): void {
  const framePosition = THREE.MathUtils.clamp(time / plan.step, 0, plan.frameCount - 1);
  const firstIndex = Math.floor(framePosition);
  const secondIndex = Math.min(firstIndex + 1, plan.frameCount - 1);
  const alpha = framePosition - firstIndex;
  const frameStride = plan.dieCount * 7;
  const firstFrameOffset = firstIndex * frameStride;
  const secondFrameOffset = secondIndex * frameStride;

  const scaleX = plan.sourceBounds
    ? Math.min(1, (screenBounds.x - 0.15) / Math.max(0.01, plan.sourceBounds.x))
    : 1;
  const scaleZ = plan.sourceBounds
    ? Math.min(1, (screenBounds.z - 0.15) / Math.max(0.01, plan.sourceBounds.z))
    : 1;
  dice.forEach((die, index) => {
    const activationDelay = plan.activationDelays?.[index] ?? 0;
    die.group.visible = time + plan.step * 0.5 >= activationDelay;
    const a = firstFrameOffset + index * 7;
    const b = secondFrameOffset + index * 7;
    die.body.position.set(
      THREE.MathUtils.lerp(plan.transforms[a], plan.transforms[b], alpha) * scaleX,
      THREE.MathUtils.lerp(plan.transforms[a + 1], plan.transforms[b + 1], alpha),
      THREE.MathUtils.lerp(plan.transforms[a + 2], plan.transforms[b + 2], alpha) * scaleZ,
    );
    replayQuaternionA.set(
      plan.transforms[a + 3],
      plan.transforms[a + 4],
      plan.transforms[a + 5],
      plan.transforms[a + 6],
    );
    replayQuaternionB.set(
      plan.transforms[b + 3],
      plan.transforms[b + 4],
      plan.transforms[b + 5],
      plan.transforms[b + 6],
    );
    replayQuaternionA.slerp(replayQuaternionB, alpha);
    die.body.quaternion.set(
      replayQuaternionA.x,
      replayQuaternionA.y,
      replayQuaternionA.z,
      replayQuaternionA.w,
    );
    clampDieToVisibleArea(die);
    die.syncVisual();
  });
}

function playImpacts(plan: RollPlan, previousTime: number, currentTime: number): void {
  while (nextImpactIndex < plan.impacts.length) {
    const impact = plan.impacts[nextImpactIndex];
    if (impact.time > currentTime) break;
    if (impact.time >= previousTime) {
      const impactTheme = activeThemes[impact.dieIndex] ?? selectedTheme;
      audio.playImpact(impact.strength, THEME_MANIFESTS[impactTheme].surfaceAudio, impactTheme);
      if (collisionSparkBudget > 0 && impact.strength > 3.4) {
        collisionSparkBudget -= 1;
        effects.impact(
          dice[impact.dieIndex].getWorldPosition(),
          THEMES[impactTheme].particle,
          impact.strength,
        );
      }
    }
    nextImpactIndex += 1;
  }
}

function packImpacts(impacts: RollImpact[]): Float32Array {
  const packed = new Float32Array(impacts.length * 3);
  impacts.forEach((impact, index) => {
    const offset = index * 3;
    packed[offset] = impact.time;
    packed[offset + 1] = impact.dieIndex;
    packed[offset + 2] = impact.strength;
  });
  return packed;
}

function createEffectTimeline(plan: RollPlan, outcomes: EffectOutcome[]): RollReplayEvent[] {
  const events: RollReplayEvent[] = plan.impacts.map((impact) => ({
    time: impact.time,
    type: 'impact',
    dieIndex: impact.dieIndex,
    strength: impact.strength,
  }));
  const settleTimes =
    plan.settleTimes?.length === plan.dieCount ? plan.settleTimes : deriveDieSettleTimes(plan);
  outcomes.forEach((outcome, dieIndex) => {
    events.push({
      time: settleTimes[dieIndex] ?? plan.duration,
      type: 'result',
      dieIndex,
      outcome,
    });
  });
  return events.toSorted((a, b) => a.time - b.time || a.dieIndex - b.dieIndex);
}

function captureReplay(plan: RollPlan): void {
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
    dieKind: activeKinds[0] ?? selectedKind,
    dieKinds: activeKinds.slice(),
    theme: selectedTheme,
    themes: activeThemes.slice(),
    physics: activePhysics.map((entry) => ({ ...entry })),
    physicsPreset: activePhysicsPreset,
    quantity,
    bounds: { x: screenBounds.x, z: screenBounds.z },
    step: plan.step,
    frameCount: plan.frameCount,
    duration: plan.duration,
    transforms: plan.transforms,
    activationDelays: plan.activationDelays?.slice(),
    settleTimes: plan.settleTimes?.slice(),
    impacts: packImpacts(plan.impacts),
    results: plan.results.slice(),
    outcomes: activeOutcomes.slice(),
    fallbacks: activeFallbackSpecs.map((fallback) => ({
      ...fallback,
      metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
    })),
    visualOrder: activeVisualOrder.map((entry) => ({ ...entry })),
    context: { ...activeContext },
    effectTimeline: createEffectTimeline(plan, activeOutcomes),
    settleReason: plan.settleReason,
    physicsSteps: plan.physicsSteps,
  };
}

function beginPlanPlayback(
  plan: RollPlan,
  options: { replaying?: boolean; initialTime?: number; settleImmediately?: boolean } = {},
): void {
  const replaying = options.replaying ?? false;
  const initialTime = THREE.MathUtils.clamp(options.initialTime ?? 0, 0, plan.duration);
  const settleImmediately = (options.settleImmediately ?? false) || document.hidden;
  const catchingUp = initialTime > 0.016;
  if (!catchingUp && !settleImmediately) audio.playWhoosh(activeThemes[0] ?? selectedTheme);
  hasCast = true;
  gestureHint.classList.add('hidden');
  isRolling = true;
  collisionSparkBudget = Math.max(
    6,
    Math.min(48, (quantity + activeFallbackSpecs.length) * runtimeQuality.impactEffectsPerDie),
  );
  resultPanel.classList.remove('revealed', 'critical');
  resultTotal.textContent = '…';
  const tableRolls = readActiveTableRolls();
  resultDetail.textContent =
    tableRolls.length > 1
      ? // Name the rollers while the throw is still in motion, matching the settled
        // panel's separator so the label does not change shape once the dice land.
        tableRolls
          .map((entry) => [entry.actorLabel, entry.rollLabel].filter(Boolean).join(' · ') || 'Roll')
          .join('  •  ')
      : settleImmediately
        ? 'Late event · presenting settled result'
        : catchingUp
          ? 'Synchronizing with roll already in progress'
          : replaying
            ? 'Replaying verified trajectory'
            : activeFallbackSpecs.length > 0
              ? 'Dice and result tokens in motion'
              : 'Dice in motion';
  setStatus(
    tableRolls.length > 1
      ? `${tableRolls.length} rollers casting`
      : settleImmediately
        ? 'Presenting settled result'
        : catchingUp
          ? 'Catching up to synchronized roll'
          : replaying
            ? 'Replaying verified roll'
            : quantity === 0
              ? 'Presenting fallback results'
              : activeTargets.some((target) => target !== null)
                ? 'Resolving exact physical throw'
                : 'Resolving physics',
    !settleImmediately,
  );
  activePlan = plan;
  if (!plan.settleTimes || plan.settleTimes.length !== plan.dieCount) {
    plan.settleTimes = deriveDieSettleTimes(plan);
  }
  if (initialTime > 0) markOutcomeEffectsThrough(plan, initialTime);
  planTime = settleImmediately ? plan.duration : initialTime;
  nextImpactIndex = plan.impacts.findIndex((impact) => impact.time > planTime);
  if (nextImpactIndex < 0) nextImpactIndex = plan.impacts.length;
  revealDelay = planTime >= plan.duration ? 0.29 : 0;
  // Commit transform data before the meshes become visible. No render can see
  // a preview pose, a provisional spawn layout, or an earlier candidate.
  applyPlanTransform(plan, planTime);
  const fallbackProgress = plan.duration > 0 ? planTime / plan.duration : 1;
  fallbackVisuals.forEach((visual) => visual.update(fallbackProgress));
  requestRender();
  if (settleImmediately) {
    fallbackVisuals.forEach((visual) => visual.settle());
    if (document.hidden) markOutcomeEffectsThrough(plan, plan.duration);
    else playSettledOutcomeEffects(plan, plan.duration);
    revealResults();
  }
}

function applyReplayNumbering(plan: RollPlan): void {
  // Current replays contain trajectories whose physical top faces already match
  // their authoritative values. Never rewrite visible face labels during a roll.
  dice.forEach((die) => die.resetNumbering());
  const stride = plan.dieCount * 7;
  const finalOffset = (plan.frameCount - 1) * stride;
  const matches = dice.every((die, index) => {
    const offset = finalOffset + index * 7;
    const landingIndex = die.getTopFaceIndex({
      x: plan.transforms[offset + 3],
      y: plan.transforms[offset + 4],
      z: plan.transforms[offset + 5],
      w: plan.transforms[offset + 6],
    });
    return die.getValueForFaceIndex(landingIndex) === plan.results[index];
  });
  if (!matches)
    throw new Error('Replay trajectory does not physically match its recorded results.');
}

function playRecordedReplay(
  replay: RollReplay,
  options: DiceReplayOptions = {},
): Promise<DraftrollRollCompletion> {
  if (isRolling || isPlanning || replay.formatVersion !== 1)
    return Promise.reject(new Error('Renderer is busy or replay format is unsupported'));
  rebuildScreenBounds();
  applyRendererResolution();
  // Defensive copy of the caller-supplied replay payload.
  // oxlint-disable-next-line oxc/no-map-spread
  const replayFallbacks = (replay.fallbacks ?? []).map((fallback) => ({
    ...fallback,
    metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
  }));
  const replayKinds =
    replay.dieKinds?.length === replay.quantity
      ? replay.dieKinds.slice()
      : Array.from({ length: replay.quantity }, () => replay.dieKind);
  const supportedKinds = new Set<DieKind>(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);
  if (replayKinds.some((kind) => !supportedKinds.has(kind)))
    return Promise.reject(new Error('Replay die type is unsupported'));
  const totalVisuals = replay.quantity + replayFallbacks.length;
  if (!THEME_MANIFESTS[replay.theme] || totalVisuals < 1 || totalVisuals > 30)
    return Promise.reject(new Error('Replay theme or visual count is invalid'));
  const expectedTransforms = replay.frameCount * replay.quantity * 7;
  if (replay.transforms.length !== expectedTransforms || replay.results.length !== replay.quantity)
    return Promise.reject(new Error('Replay buffers are invalid'));

  selectedKind = replayKinds[0] ?? replay.dieKind;
  selectedTheme = replay.theme;
  activeThemes =
    normalizeThemes(replay.themes ?? (replay.quantity > 0 ? replay.theme : []), replay.quantity) ??
    Array.from({ length: replay.quantity }, () => replay.theme);
  activeKinds = replayKinds;
  activePhysicsPreset = replay.physicsPreset ?? 'standard';
  activePhysics =
    normalizePhysicalProperties(
      replay.physics ?? null,
      replayKinds,
      activeThemes,
      activePhysicsPreset,
    ) ?? Array.from({ length: replay.quantity }, () => ({}));
  world.gravity.set(0, -PHYSICS_PRESETS[activePhysicsPreset].gravity, 0);
  spawnPreview(replayKinds, true);
  applyRuntimeQuality(totalVisuals);
  activeSeed = replay.seed;
  activeTargets = replay.results.slice();
  activeOutcomes =
    normalizeOutcomes(replay.outcomes, replay.quantity) ??
    Array.from({ length: replay.quantity }, () => 'neutral');
  activeFallbackSpecs = replayFallbacks;
  activeVisualOrder = normalizeVisualOrder(
    replay.visualOrder ?? null,
    replay.quantity,
    replayFallbacks.length,
  );
  if (activeVisualOrder.length !== totalVisuals)
    return Promise.reject(new Error('Replay visual ordering is invalid'));
  spawnFallbackVisuals(activeFallbackSpecs, activeSeed);
  dice.forEach((die, index) => {
    die.setTheme(activeThemes[index] ?? replay.theme);
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
    dieCount: replay.quantity,
    transforms: replay.transforms.slice(),
    activationDelays:
      replay.activationDelays?.length === replay.quantity
        ? replay.activationDelays.slice()
        : undefined,
    settleTimes:
      replay.settleTimes?.length === replay.quantity ? replay.settleTimes.slice() : undefined,
    impacts,
    duration: replay.duration,
    results: replay.results.slice(),
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

function registerRollCompletion(): {
  promise: Promise<DraftrollRollCompletion>;
  pending: PendingRollCompletion;
} {
  let pending!: PendingRollCompletion;
  const promise = new Promise<DraftrollRollCompletion>((resolve, reject) => {
    pending = { resolve, reject };
    pendingRollCompletions.add(pending);
  });
  return { promise, pending };
}

function createRollCompletionPromise(): Promise<DraftrollRollCompletion> {
  return registerRollCompletion().promise;
}

function createFallbackOnlyPlan(count: number): RollPlan {
  const duration = 1.45 + Math.min(0.85, count * 0.045);
  const step = FIXED_STEP;
  return {
    step,
    frameCount: Math.ceil(duration / step) + 1,
    dieCount: 0,
    transforms: new Float32Array(0),
    impacts: [],
    duration,
    results: [],
    settleReason: 'visual-fallback',
    physicsSteps: 0,
  };
}

function createStaticTablePlan(duration: number): RollPlan {
  const step = FIXED_STEP;
  const frameCount = Math.max(2, Math.ceil(duration / step) + 1);
  const dieCount = dice.length;
  const transforms = new Float32Array(frameCount * dieCount * 7);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let dieIndex = 0; dieIndex < dieCount; dieIndex += 1) {
      const die = dice[dieIndex];
      const offset = frame * dieCount * 7 + dieIndex * 7;
      transforms[offset] = die.body.position.x;
      transforms[offset + 1] = die.body.position.y;
      transforms[offset + 2] = die.body.position.z;
      transforms[offset + 3] = die.body.quaternion.x;
      transforms[offset + 4] = die.body.quaternion.y;
      transforms[offset + 5] = die.body.quaternion.z;
      transforms[offset + 6] = die.body.quaternion.w;
    }
  }
  const plan: RollPlan = {
    step,
    frameCount,
    dieCount,
    transforms,
    activationDelays: new Float32Array(dieCount),
    impacts: [],
    duration,
    results: activePlan?.results.slice(0, dieCount) ?? dice.map((die) => die.getTopValue()),
    settleReason: 'additive-fallback',
    physicsSteps: 0,
  };
  plan.settleTimes = deriveDieSettleTimes(plan);
  return plan;
}

interface AdditivePhysicalRequest {
  results: number[];
  kinds: DieKind[];
  themes: ThemeName[];
  outcomes: EffectOutcome[];
  physics: DicePhysicsProperties[];
  physicsPreset: DicePhysicsPreset;
  fallbacks: DraftrollFallbackVisual[];
  visualOrder: DraftrollVisualOrderEntry[];
  context: Record<string, unknown>;
  seed: string;
  startAtMs: number | null;
  animationDurationMs: number | null;
}

function normalizeAdditivePhysicalRequest(
  request: DiceRollRequest,
): AdditivePhysicalRequest | null {
  if (request.settleImmediately || request.lateMode === 'settled' || request.lateMode === 'replay')
    return null;
  const rawResults = request.results;
  const results =
    rawResults === undefined
      ? []
      : (Array.isArray(rawResults) ? rawResults : [rawResults]).map((value) => Math.round(value));
  if (results.some((value) => !Number.isFinite(value))) return null;
  const fallbacks =
    request.fallbacks?.map((fallback) => ({
      ...fallback,
      metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
    })) ?? [];
  if (results.length === 0 && fallbacks.length === 0) return null;
  const context = { ...request.context };
  const seed = String(request.seed ?? `table-add:${Date.now()}`);
  const defaultVisualPrefix =
    typeof context.rollId === 'string' ? `${context.rollId}:` : `${seed}:`;
  const visualOrder = normalizeVisualOrder(
    request.visualOrder ?? null,
    results.length,
    fallbacks.length,
    defaultVisualPrefix,
  );
  if (visualOrder.length !== results.length + fallbacks.length) return null;

  const rawKinds =
    request.kinds === undefined
      ? [selectedKind]
      : Array.isArray(request.kinds)
        ? request.kinds
        : [request.kinds];
  const kinds =
    rawKinds.length === 1
      ? Array.from({ length: results.length }, () => rawKinds[0])
      : rawKinds.slice();
  if (kinds.length !== results.length) return null;
  const supported = new Set<DieKind>(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);
  if (
    kinds.some(
      (kind, index) =>
        !supported.has(kind) || results[index] < 1 || results[index] > Number(kind.slice(1)),
    )
  )
    return null;

  const rawThemes =
    request.themes === undefined
      ? [selectedTheme]
      : Array.isArray(request.themes)
        ? request.themes
        : [request.themes];
  const themes =
    rawThemes.length === 1
      ? Array.from({ length: results.length }, () => rawThemes[0])
      : rawThemes.slice();
  if (themes.length !== results.length || themes.some((theme) => !THEME_MANIFESTS[theme]))
    return null;

  const rawOutcomes =
    request.outcomes === undefined
      ? []
      : Array.isArray(request.outcomes)
        ? request.outcomes
        : [request.outcomes];
  const outcomes = results.map((value, index) => {
    const explicit = rawOutcomes.length === 1 ? rawOutcomes[0] : rawOutcomes[index];
    if (
      explicit === 'positive' ||
      explicit === 'negative' ||
      explicit === 'neutral' ||
      explicit === 'none'
    )
      return explicit;
    const maximum = Number(kinds[index].slice(1));
    if (value === maximum) return 'positive';
    if (value === 1 && maximum !== 2) return 'negative';
    return 'neutral';
  });

  const physicsPreset = request.physicsPreset ?? activePhysicsPreset;
  const physics = normalizePhysicalProperties(
    request.physics ?? null,
    kinds,
    themes,
    physicsPreset,
  );
  if (!physics) return null;

  return {
    results,
    kinds,
    themes,
    outcomes,
    physics,
    physicsPreset,
    fallbacks,
    visualOrder,
    context,
    seed,
    startAtMs:
      typeof request.startAtMs === 'number' && Number.isFinite(request.startAtMs)
        ? request.startAtMs
        : null,
    animationDurationMs:
      typeof request.animationDurationMs === 'number' &&
      Number.isFinite(request.animationDurationMs)
        ? Math.max(1, request.animationDurationMs)
        : null,
  };
}

function samplePlanTransform(
  plan: RollPlan,
  time: number,
  dieIndex: number,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const framePosition = THREE.MathUtils.clamp(time / plan.step, 0, plan.frameCount - 1);
  const firstIndex = Math.floor(framePosition);
  const secondIndex = Math.min(firstIndex + 1, plan.frameCount - 1);
  const alpha = framePosition - firstIndex;
  const frameStride = plan.dieCount * 7;
  const a = firstIndex * frameStride + dieIndex * 7;
  const b = secondIndex * frameStride + dieIndex * 7;
  const scaleX = plan.sourceBounds
    ? Math.min(1, (screenBounds.x - 0.15) / Math.max(0.01, plan.sourceBounds.x))
    : 1;
  const scaleZ = plan.sourceBounds
    ? Math.min(1, (screenBounds.z - 0.15) / Math.max(0.01, plan.sourceBounds.z))
    : 1;
  const position = new THREE.Vector3(
    THREE.MathUtils.lerp(plan.transforms[a], plan.transforms[b], alpha) * scaleX,
    THREE.MathUtils.lerp(plan.transforms[a + 1], plan.transforms[b + 1], alpha),
    THREE.MathUtils.lerp(plan.transforms[a + 2], plan.transforms[b + 2], alpha) * scaleZ,
  );
  const qa = new THREE.Quaternion(
    plan.transforms[a + 3],
    plan.transforms[a + 4],
    plan.transforms[a + 5],
    plan.transforms[a + 6],
  );
  const qb = new THREE.Quaternion(
    plan.transforms[b + 3],
    plan.transforms[b + 4],
    plan.transforms[b + 5],
    plan.transforms[b + 6],
  );
  qa.slerp(qb, alpha);
  return { position, quaternion: qa.normalize() };
}

function sampleActiveLaunchStates(plan: RollPlan, time: number): LaunchState[] {
  return dice.map((_die, index) => {
    const current = samplePlanTransform(plan, time, index);
    const nextTime = Math.min(plan.duration, time + Math.max(plan.step, 1 / 60));
    const next = samplePlanTransform(plan, nextTime, index);
    const deltaTime = Math.max(1 / 240, nextTime - time);
    const velocity = new CANNON.Vec3(
      (next.position.x - current.position.x) / deltaTime,
      (next.position.y - current.position.y) / deltaTime,
      (next.position.z - current.position.z) / deltaTime,
    );
    const inverse = current.quaternion.clone().invert();
    const delta = next.quaternion.clone().multiply(inverse).normalize();
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(delta.w, -1, 1));
    const denominator = Math.sqrt(Math.max(1e-10, 1 - delta.w * delta.w));
    const axis =
      denominator > 1e-5
        ? new THREE.Vector3(delta.x / denominator, delta.y / denominator, delta.z / denominator)
        : new THREE.Vector3(0, 1, 0);
    const angularVelocity = new CANNON.Vec3(
      (axis.x * angle) / deltaTime,
      (axis.y * angle) / deltaTime,
      (axis.z * angle) / deltaTime,
    );
    return {
      position: new CANNON.Vec3(current.position.x, current.position.y, current.position.z),
      quaternion: new CANNON.Quaternion(
        current.quaternion.x,
        current.quaternion.y,
        current.quaternion.z,
        current.quaternion.w,
      ),
      velocity,
      angularVelocity,
      delay: 0,
    };
  });
}

function createLockedTableTrajectory(
  plan: RollPlan,
  time: number,
  count: number,
): LockedTableTrajectory {
  const step = plan.step;
  const remaining = Math.max(0, plan.duration - time);
  const frameCount = Math.max(2, Math.ceil(remaining / step) + 1);
  const transforms = new Float32Array(frameCount * count * 7);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sampleTime = Math.min(plan.duration, time + frame * step);
    for (let dieIndex = 0; dieIndex < count; dieIndex += 1) {
      const sample = samplePlanTransform(plan, sampleTime, dieIndex);
      const offset = frame * count * 7 + dieIndex * 7;
      transforms[offset] = sample.position.x;
      transforms[offset + 1] = sample.position.y;
      transforms[offset + 2] = sample.position.z;
      transforms[offset + 3] = sample.quaternion.x;
      transforms[offset + 4] = sample.quaternion.y;
      transforms[offset + 5] = sample.quaternion.z;
      transforms[offset + 6] = sample.quaternion.w;
    }
  }
  return { count, step, frameCount, transforms };
}

function appendPhysicalDice(
  kinds: readonly DieKind[],
  themes: readonly ThemeName[],
  physics: readonly DicePhysicsProperties[] = [],
): DieInstance[] {
  const appended: DieInstance[] = [];
  kinds.forEach((kind, index) => {
    const properties = physics[index] ?? {};
    const die = new DieInstance(kind, themes[index] ?? selectedTheme, dicePhysicsMaterial, {
      mass: 1.12 * (properties.massScale ?? 1),
      sizeScale: properties.sizeScale,
      inertiaScale: properties.inertiaScale,
    });
    applyDiePhysicsRuntime(die, activePhysicsPreset);
    die.group.visible = false;
    world.addBody(die.body);
    scene.add(die.group);
    attachCollisionAudio(die);
    dice.push(die);
    appended.push(die);
  });
  return appended;
}

function appendFallbackVisuals(
  specs: readonly DraftrollFallbackVisual[],
  seed: string,
): FallbackVisualInstance[] {
  if (specs.length === 0) return [];
  const start = fallbackVisuals.length;
  const total = start + specs.length;
  const random = createSeededRandom(`${seed}:additive-fallbacks`);
  const appended = specs.map((spec, offset) => {
    const visual = new FallbackVisualInstance(spec);
    visual.configureTrajectory(start + offset, total, screenBounds, random);
    scene.add(visual.group);
    fallbackVisuals.push(visual);
    return visual;
  });
  return appended;
}

function removeAppendedFallbackVisuals(appended: readonly FallbackVisualInstance[]): void {
  for (const visual of appended) {
    scene.remove(visual.group);
    visual.dispose();
  }
  fallbackVisuals.splice(Math.max(0, fallbackVisuals.length - appended.length), appended.length);
}

function removeAppendedDice(appended: readonly DieInstance[]): void {
  for (const die of appended) {
    world.removeBody(die.body);
    scene.remove(die.group);
    die.dispose();
  }
  dice.splice(Math.max(0, dice.length - appended.length), appended.length);
}

function incomingTableRolls(
  context: Record<string, unknown>,
  physicalStart: number,
  physicalCount: number,
  fallbackStart: number,
  fallbackCount: number,
): ActiveTableRollGroup[] {
  const raw = Array.isArray(context.tableRolls) ? context.tableRolls : [];
  if (raw.length > 0) {
    return raw.flatMap((value, index) => {
      if (!isRecord(value)) return [];
      const entry = value;
      return [
        {
          groupId:
            typeof entry.groupId === 'string'
              ? entry.groupId
              : `table-add-${physicalStart}-${index}`,
          actorLabel: typeof entry.actorLabel === 'string' ? entry.actorLabel : undefined,
          rollLabel: typeof entry.rollLabel === 'string' ? entry.rollLabel : undefined,
          total: Number.isFinite(Number(entry.total)) ? Number(entry.total) : 0,
          physicalStart: physicalStart + Math.max(0, Math.floor(Number(entry.physicalStart) || 0)),
          physicalCount: Math.max(0, Math.floor(Number(entry.physicalCount) || physicalCount)),
          fallbackStart: fallbackStart + Math.max(0, Math.floor(Number(entry.fallbackStart) || 0)),
          fallbackCount: Math.max(0, Math.floor(Number(entry.fallbackCount) || fallbackCount)),
          visualCount: Math.max(
            0,
            Math.floor(Number(entry.visualCount) || physicalCount + fallbackCount),
          ),
        },
      ];
    });
  }
  const metadata = isRecord(context.metadata) ? context.metadata : undefined;
  return [
    {
      groupId: typeof context.rollId === 'string' ? context.rollId : `table-add-${physicalStart}`,
      actorLabel: typeof context.name === 'string' ? context.name : undefined,
      rollLabel: typeof metadata?.actionName === 'string' ? metadata.actionName : undefined,
      total: Number.isFinite(Number(context.normalizedTotal)) ? Number(context.normalizedTotal) : 0,
      physicalStart,
      physicalCount,
      fallbackStart,
      fallbackCount,
      visualCount: physicalCount + fallbackCount,
    },
  ];
}

function mergeRenderedDieIds(current: unknown, incoming: unknown): string[] {
  const ids = [
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ].filter((value): value is string => typeof value === 'string');
  return [...new Set(ids)];
}

function mergeRenderedDiceState(current: unknown, incoming: unknown): Record<string, unknown>[] {
  const orderedIds: string[] = [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const value of [
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ]) {
    if (!isRecord(value)) continue;
    const die = value;
    if (typeof die.id !== 'string') continue;
    if (!byId.has(die.id)) orderedIds.push(die.id);
    byId.set(die.id, { ...die });
  }
  return orderedIds.flatMap((id) => {
    const die = byId.get(id);
    return die ? [die] : [];
  });
}

function mergeTableRollGroups(
  existing: readonly ActiveTableRollGroup[],
  incoming: readonly ActiveTableRollGroup[],
  completedTotal: number | null,
): ActiveTableRollGroup[] {
  const merged = existing.map((entry) => ({ ...entry }));
  const singleRollCompletedTotal = incoming.length === 1 ? completedTotal : null;
  for (const addition of incoming) {
    const index = merged.findIndex((entry) => entry.groupId === addition.groupId);
    if (index < 0) {
      merged.push({
        ...addition,
        total: singleRollCompletedTotal ?? addition.total,
      });
      continue;
    }
    const previous = merged[index];
    merged[index] = {
      ...previous,
      actorLabel: addition.actorLabel ?? previous.actorLabel,
      rollLabel: addition.rollLabel ?? previous.rollLabel,
      total: singleRollCompletedTotal ?? previous.total,
      physicalCount: previous.physicalCount + addition.physicalCount,
      fallbackCount: previous.fallbackCount + addition.fallbackCount,
      visualCount: previous.visualCount + addition.visualCount,
    };
  }
  return merged;
}

function mergeAdditiveContext(
  context: Record<string, unknown>,
  physicalStart: number,
  physicalCount: number,
  fallbackStart: number,
  fallbackCount: number,
): void {
  const incomingSequenceId =
    typeof context.modifierSequenceId === 'string' ? context.modifierSequenceId : undefined;
  const renderedDieIds = mergeRenderedDieIds(activeContext.renderedDieIds, context.renderedDieIds);
  const renderedDice = mergeRenderedDiceState(activeContext.renderedDice, context.renderedDice);
  const recordedTableRolls = readActiveTableRolls();
  const existing =
    recordedTableRolls.length > 0 || typeof activeContext.rollId !== 'string'
      ? recordedTableRolls
      : incomingTableRolls(activeContext, 0, physicalStart, 0, fallbackStart);
  const incoming = incomingTableRolls(
    context,
    physicalStart,
    physicalCount,
    fallbackStart,
    fallbackCount,
  );
  const normalizedTotal = Number(context.normalizedTotal);
  const completedTotal = Number.isFinite(normalizedTotal) ? normalizedTotal : null;
  const updated = mergeTableRollGroups(existing, incoming, completedTotal);
  const displayName =
    updated.length > 1
      ? `${updated.length} table rolls`
      : typeof context.name === 'string'
        ? context.name
        : typeof activeContext.name === 'string'
          ? activeContext.name
          : undefined;

  activeContext = {
    ...activeContext,
    ...context,
    authority: 'table',
    ...(displayName ? { name: displayName } : {}),
    normalizedTotal: updated.reduce((sum, entry) => sum + entry.total, 0),
    tableRolls: updated,
    renderedDieIds,
    renderedDice,
    ...(incomingSequenceId
      ? {
          modifierSequenceId: incomingSequenceId,
          modifierSequenceStage: context.modifierSequenceStage,
          modifierSequenceStages: context.modifierSequenceStages,
          modifierSequencePending: context.modifierSequencePending,
          modifierSequenceGeneratedBy: context.modifierSequenceGeneratedBy,
          rollId: context.rollId,
        }
      : {}),
  };
}

async function appendTableRoll(request: DiceRollRequest): Promise<DraftrollRollCompletion> {
  const normalized = normalizeAdditivePhysicalRequest(request);
  if (
    !normalized ||
    !activePlan ||
    (!isRolling && !hasCast) ||
    isPlanning ||
    (dice.length === 0 && activeFallbackSpecs.length === 0)
  ) {
    throw new Error('Active table roll cannot accept this presentation');
  }
  if (dissolveAnimation) cancelDissolve(false);
  const existingCount = dice.length;
  if (
    existingCount +
      activeFallbackSpecs.length +
      normalized.results.length +
      normalized.fallbacks.length >
    30
  ) {
    throw new Error('Active table visual limit exceeded');
  }
  const existingFallbackCount = activeFallbackSpecs.length;

  const registered = registerRollCompletion();
  const previous = {
    activeKinds: activeKinds.slice(),
    activeThemes: activeThemes.slice(),
    activePhysics: activePhysics.map((entry) => ({ ...entry })),
    activePhysicsPreset,
    activeTargets: activeTargets.slice(),
    activeOutcomes: activeOutcomes.slice(),
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
    ? createLockedTableTrajectory(activePlan, planTime, existingCount)
    : undefined;
  activePhysicsPreset = normalized.physicsPreset;
  world.gravity.set(0, -PHYSICS_PRESETS[activePhysicsPreset].gravity, 0);
  const appended = appendPhysicalDice(normalized.kinds, normalized.themes, normalized.physics);
  const appendedFallbacks = appendFallbackVisuals(normalized.fallbacks, normalized.seed);
  try {
    activeKinds.push(...normalized.kinds);
    activeThemes.push(...normalized.themes);
    activePhysics.push(...normalized.physics);
    activeTargets.push(...normalized.results);
    activeOutcomes.push(...normalized.outcomes);
    activeFallbackSpecs.push(...normalized.fallbacks);
    normalized.visualOrder.forEach((entry) =>
      activeVisualOrder.push(
        entry.kind === 'physical'
          ? { kind: 'physical', index: existingCount + entry.index, dieId: entry.dieId }
          : { kind: 'fallback', index: existingFallbackCount + entry.index, dieId: entry.dieId },
      ),
    );
    quantity = dice.length;
    quantityValue.textContent = String(quantity);
    mergeAdditiveContext(
      normalized.context,
      existingCount,
      normalized.results.length,
      existingFallbackCount,
      normalized.fallbacks.length,
    );
    activeSeed = `${activeSeed}|${normalized.seed}`;
    activeAnimationDurationMs =
      Math.max(activeAnimationDurationMs ?? 0, normalized.animationDurationMs ?? 0) || null;
    applyRuntimeQuality(quantity + activeFallbackSpecs.length);

    const groupIndex = Math.max(0, readActiveTableRolls().length - 1);
    const random = createSeededRandom(normalized.seed);
    const lane = THREE.MathUtils.clamp(
      ((groupIndex % 5) - 2) / 2.4 + (random() - 0.5) * 0.12,
      -0.88,
      0.88,
    );
    const direction = new THREE.Vector2(-lane * 0.32, -1)
      .normalize()
      .rotateAround(new THREE.Vector2(), (random() - 0.5) * 0.1);
    const newStates = createLaunchStatesForGroup(appended, random, direction, lane);
    const scheduledDelay =
      normalized.startAtMs === null ? 0 : Math.max(0, (normalized.startAtMs - Date.now()) / 1_000);
    newStates.forEach((state) => {
      state.delay += scheduledDelay;
    });

    tableReplanPaused = true;
    isPlanning = true;
    setStatus(`${readActiveTableRolls().length} rollers sharing the table`, true);
    const plan =
      newStates.length > 0
        ? await buildRollPlan([...existingStates, ...newStates], existingCount, lockedTrajectory)
        : createStaticTablePlan(
            createFallbackOnlyPlan(Math.max(1, appendedFallbacks.length)).duration,
          );
    appended.forEach((die) => {
      die.group.visible = true;
    });
    activeOutcomes = activeOutcomes.slice(0, plan.results.length);
    captureReplay(plan);
    beginPlanPlayback(plan, { initialTime: 0, settleImmediately: false });
    return registered.promise;
  } catch (error) {
    pendingRollCompletions.delete(registered.pending);
    registered.pending.reject(error instanceof Error ? error : new Error(String(error)));
    removeAppendedDice(appended);
    removeAppendedFallbackVisuals(appendedFallbacks);
    activeKinds = previous.activeKinds;
    activeThemes = previous.activeThemes;
    activePhysics = previous.activePhysics;
    activePhysicsPreset = previous.activePhysicsPreset;
    activeTargets = previous.activeTargets;
    activeOutcomes = previous.activeOutcomes;
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

function canAppendTableRequest(request: DiceRollRequest): boolean {
  return (
    request.tableMode === 'add' &&
    (isRolling || hasCast) &&
    !isPlanning &&
    activePlan !== null &&
    (dice.length > 0 || activeFallbackSpecs.length > 0) &&
    normalizeAdditivePhysicalRequest(request) !== null
  );
}

async function castDice(swipe?: THREE.Vector2): Promise<DraftrollRollCompletion> {
  if (isRolling || isPlanning) throw new Error('Renderer is busy');
  // The host can reveal an iframe that was laid out at a provisional size.
  // Re-measure immediately before every presentation so camera and backing
  // buffer always use the same CSS viewport and cannot stretch the scene.
  rebuildScreenBounds();
  applyRendererResolution();
  if (dissolveAnimation) cancelDissolve(true);
  const hasQueuedVisualRequest =
    queuedApiResults !== null || queuedKinds !== null || queuedFallbacks !== null;
  if (dice.length === 0 && !hasQueuedVisualRequest) spawnPreview();
  if (!prepareTargets()) throw new Error('Roll request is invalid');

  const totalVisuals = quantity + activeFallbackSpecs.length;
  applyRuntimeQuality(totalVisuals);
  let plan: RollPlan;
  if (quantity === 0) {
    activeOutcomes = [];
    plan = createFallbackOnlyPlan(activeFallbackSpecs.length);
  } else {
    const states = createLaunchStates(swipe, activeSeed);
    // Never leave preview/layout transforms visible while an off-screen plan is
    // being calculated. The first visible transform belongs to the single
    // committed trajectory, which removes large-pool grid/cluster flicker.
    setPhysicalDiceVisible(false);
    isPlanning = true;
    setStatus(
      activeTargets.some((target) => target !== null)
        ? 'Planning exact physical throw'
        : 'Planning throw',
      true,
    );
    try {
      plan = await buildRollPlan(states);
    } catch (error) {
      console.error('Roll planner failed; using local fallback.', error);
      try {
        plan = applyShapeSymmetryTargets(buildRollPlanSync(states));
      } catch (fallbackError) {
        // Planning is intentionally invisible. Restore the current meshes if
        // neither planner can produce a committed trajectory so a failed roll
        // cannot leave the overlay in a permanently hidden state.
        setPhysicalDiceVisible(true);
        throw fallbackError;
      }
    } finally {
      isPlanning = false;
    }
    activeOutcomes = resolveOutcomes(plan.results);
  }

  captureReplay(plan);
  const scheduledStartAtMs = activeStartAtMs;
  const scheduledDelay = scheduledStartAtMs === null ? 0 : scheduledStartAtMs - Date.now();
  if (scheduledDelay > 0)
    await new Promise<void>((resolve) => window.setTimeout(resolve, scheduledDelay));

  const authoritativeDurationMs = Math.max(1, activeAnimationDurationMs ?? plan.duration * 1_000);
  const startLatenessMs =
    scheduledStartAtMs === null || activeLateMode === 'replay'
      ? 0
      : Math.max(0, Date.now() - scheduledStartAtMs);
  const elapsedMs = activeLateMode === 'replay' ? 0 : Math.max(activeSeekToMs, startLatenessMs);
  const progress = elapsedMs / authoritativeDurationMs;
  const settleImmediately =
    activeSettleImmediately || (activeLateMode === 'auto' && progress >= activeSettleAfterProgress);
  const initialTime = activeLateMode === 'replay' ? 0 : Math.min(1, progress) * plan.duration;

  activeStartAtMs = null;
  activeSeekToMs = 0;
  activeAnimationDurationMs = null;
  activeSettleImmediately = false;
  activeLateMode = 'auto';
  activeSettleAfterProgress = 0.78;
  // Register completion only after a valid committed plan exists. A planner
  // failure therefore cannot leak an unresolved completion handle.
  const completion = createRollCompletionPromise();
  beginPlanPlayback(plan, { initialTime, settleImmediately });
  return completion;
}

function collectOrderedVisualResults(physicalValues: readonly number[]): Array<number | string> {
  return activeVisualOrder.map((entry) =>
    entry.kind === 'physical'
      ? (physicalValues[entry.index] ?? 0)
      : (activeFallbackSpecs[entry.index]?.result ?? ''),
  );
}

function formatVisualResult(
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
    const kind = activeKinds[entry.index] ?? selectedKind;
    return `${kind.toUpperCase()} ${physicalValues[entry.index] ?? 0}${suffix}`;
  }
  const fallback = activeFallbackSpecs[entry.index];
  return fallback ? `${fallback.title} ${fallback.label}${suffix}` : `Result${suffix}`;
}

function readRenderedDieState(dieId: string): { kept?: boolean; generatedBy?: string } | undefined {
  const raw = activeContext.renderedDice;
  if (!Array.isArray(raw)) return undefined;
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const value = raw[index];
    if (!isRecord(value)) continue;
    const candidate = value;
    if (candidate.id !== dieId) continue;
    return {
      kept: typeof candidate.kept === 'boolean' ? candidate.kept : undefined,
      generatedBy: typeof candidate.generatedBy === 'string' ? candidate.generatedBy : undefined,
    };
  }
  return undefined;
}

function physicalVisualId(index: number): string {
  return (
    activeVisualOrder.find((entry) => entry.kind === 'physical' && entry.index === index)?.dieId ??
    `physical_${index}`
  );
}

function fallbackVisualId(index: number): string {
  return (
    activeVisualOrder.find((entry) => entry.kind === 'fallback' && entry.index === index)?.dieId ??
    activeFallbackSpecs[index]?.id ??
    `fallback_${index}`
  );
}

function effectGroupId(kind: 'physical' | 'fallback', index: number): string {
  const group = readActiveTableRolls().find((entry) =>
    kind === 'physical'
      ? index >= entry.physicalStart && index < entry.physicalStart + entry.physicalCount
      : index >= entry.fallbackStart && index < entry.fallbackStart + entry.fallbackCount,
  );
  if (group) return group.groupId;
  if (typeof activeContext.rollId === 'string') return activeContext.rollId;
  if (typeof activeContext.modifierSequenceId === 'string') return activeContext.modifierSequenceId;
  return activeSeed || 'active-roll';
}

function reserveHeroEffect(groupId: string, outcome: EffectOutcome): boolean {
  if (outcome !== 'positive') return false;
  const heroLimit = Math.min(maxHeroEffects, runtimeQuality.heroEffectLimit);
  const used = outcomeHeroCounts.get(groupId) ?? 0;
  if (used >= heroLimit) return false;
  outcomeHeroCounts.set(groupId, used + 1);
  return true;
}

function markOutcomeEffectsThrough(plan: RollPlan, time: number): void {
  const settleTimes =
    plan.settleTimes?.length === plan.dieCount ? plan.settleTimes : deriveDieSettleTimes(plan);
  plan.settleTimes = settleTimes;
  consumeSettledVisualIndexes(
    Array.from({ length: plan.dieCount }, (_value, index) => physicalVisualId(index)),
    settleTimes,
    time,
    playedOutcomeEffectIds,
  );
  consumeSettledVisualIndexes(
    activeFallbackSpecs.map((_spec, index) => fallbackVisualId(index)),
    activeFallbackSpecs.map(() => plan.duration),
    time,
    playedOutcomeEffectIds,
  );
}

/**
 * Plays each outcome effect exactly once, at the earliest recorded point from
 * which that visual remains at its authoritative final pose. Retained table
 * dice keep their IDs in playedOutcomeEffectIds, so additive rerolls and
 * explosions cannot replay an old effect.
 */
function playSettledOutcomeEffects(plan: RollPlan, currentTime: number): void {
  const settleTimes =
    plan.settleTimes?.length === plan.dieCount ? plan.settleTimes : deriveDieSettleTimes(plan);
  plan.settleTimes = settleTimes;
  const physicalIndexes = consumeSettledVisualIndexes(
    Array.from({ length: plan.dieCount }, (_value, index) => physicalVisualId(index)),
    settleTimes,
    currentTime,
    playedOutcomeEffectIds,
  );
  const fallbackIndexes = consumeSettledVisualIndexes(
    activeFallbackSpecs.map((_spec, index) => fallbackVisualId(index)),
    activeFallbackSpecs.map(() => plan.duration),
    currentTime,
    playedOutcomeEffectIds,
  );
  if (physicalIndexes.length === 0 && fallbackIndexes.length === 0) return;
  if (document.hidden) return;

  effects.beginBatch();
  try {
    physicalIndexes.forEach((index) => {
      const outcome = activeOutcomes[index] ?? (neutralEffects ? 'neutral' : 'none');
      effects.playOutcome(
        activeThemes[index] ?? selectedTheme,
        outcome,
        dice[index].getWorldPosition().setY(0.05),
        {
          kind: activeKinds[index] ?? selectedKind,
          value: plan.results[index],
          hero: reserveHeroEffect(effectGroupId('physical', index), outcome),
        },
      );
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
}

function outcomeSummaryForGroups(groups: readonly ActiveTableRollGroup[]): {
  positive: boolean;
  negative: boolean;
} {
  let positive = false;
  let negative = false;
  for (const group of groups) {
    for (
      let index = group.physicalStart;
      index < group.physicalStart + group.physicalCount;
      index += 1
    ) {
      if (activeOutcomes[index] === 'positive') positive = true;
      if (activeOutcomes[index] === 'negative') negative = true;
    }
    for (
      let index = group.fallbackStart;
      index < group.fallbackStart + group.fallbackCount;
      index += 1
    ) {
      if (activeFallbackSpecs[index]?.outcome === 'positive') positive = true;
      if (activeFallbackSpecs[index]?.outcome === 'negative') negative = true;
    }
  }
  return { positive, negative };
}

function announceCompletedOutcomeOnce(tableRolls: readonly ActiveTableRollGroup[]): void {
  const groups =
    tableRolls.length > 0
      ? tableRolls
      : [
          {
            groupId:
              typeof activeContext.rollId === 'string'
                ? activeContext.rollId
                : activeSeed || 'active-roll',
            total: 0,
            physicalStart: 0,
            physicalCount: activeOutcomes.length,
            fallbackStart: 0,
            fallbackCount: activeFallbackSpecs.length,
            visualCount: activeOutcomes.length + activeFallbackSpecs.length,
          },
        ];
  const newlyCompleted = groups.filter((group) => !announcedOutcomeGroupIds.has(group.groupId));
  if (newlyCompleted.length === 0) return;
  newlyCompleted.forEach((group) => announcedOutcomeGroupIds.add(group.groupId));
  const summary = outcomeSummaryForGroups(newlyCompleted);
  if (summary.positive && !summary.negative) audio.playSuccess();
  else if (summary.negative && !summary.positive) audio.playFailure();
  else if (summary.positive && summary.negative) audio.playSuccess();
}

function revealResults(): void {
  if (!isRolling) return;
  isRolling = false;
  const physicalValues = activePlan?.results.slice() ?? dice.map((die) => die.getTopValue());
  const fallbackTotal = activeFallbackSpecs.reduce(
    (sum, fallback) => sum + (fallback.numericValue ?? 0),
    0,
  );
  const physicalTotal = physicalValues.reduce((sum, value) => sum + value, 0);
  const normalizedTotal = Number(activeContext.normalizedTotal);
  const total = Number.isFinite(normalizedTotal) ? normalizedTotal : physicalTotal + fallbackTotal;
  const tableRolls = readActiveTableRolls();
  const modifierSequencePending = activeContext.modifierSequencePending === true;
  if (modifierSequencePending) {
    const generatedBy =
      typeof activeContext.modifierSequenceGeneratedBy === 'string'
        ? activeContext.modifierSequenceGeneratedBy
        : 'modifier';
    resultTotal.textContent = '…';
    resultDetail.textContent =
      generatedBy === 'explosion'
        ? 'Maximum rolled · adding exploding dice'
        : generatedBy === 'reroll' || generatedBy === 'reroll-add'
          ? 'Reroll triggered · rolling follow-up dice'
          : 'Resolving follow-up dice';
    resultPanel.classList.remove('revealed', 'critical');
    setStatus('Follow-up dice required', false);
  } else if (tableRolls.length > 1) {
    resultTotal.textContent = `${tableRolls.length}`;
    resultDetail.textContent = tableRolls
      .map((entry) => {
        const label = [entry.actorLabel, entry.rollLabel].filter(Boolean).join(' · ') || 'Roll';
        return `${label}: ${entry.total}`;
      })
      .join('  •  ');
    setStatus(`Cast complete · ${tableRolls.length} rollers`, false);
  } else {
    resultTotal.textContent = String(total);
    const resultParts = activeVisualOrder.map((entry) => formatVisualResult(entry, physicalValues));
    const actor = typeof activeContext.name === 'string' ? activeContext.name : '';
    const metadata = isRecord(activeContext.metadata) ? activeContext.metadata : undefined;
    const action = typeof metadata?.actionName === 'string' ? metadata.actionName : '';
    const prefix = [actor, action].filter(Boolean).join(' · ');
    resultDetail.textContent = `${prefix ? `${prefix} · ` : ''}${resultParts.join(' + ')}`;
    setStatus('Cast complete', false);
  }
  if (!modifierSequencePending) resultPanel.classList.add('revealed');

  for (const die of dice) {
    die.body.velocity.setZero();
    die.body.angularVelocity.setZero();
    die.body.force.setZero();
    die.body.torque.setZero();
    die.body.sleep();
  }
  fallbackVisuals.forEach((visual) => visual.settle());
  // Keep the completed plan while the table remains visible. A later concurrent
  // throw can sample these settled transforms and add new dynamic dice without
  // clearing or reconstructing the visible table.

  const allOutcomes = outcomeSummaryForGroups(
    tableRolls.length > 0
      ? tableRolls
      : [
          {
            groupId: 'active-roll',
            total,
            physicalStart: 0,
            physicalCount: activeOutcomes.length,
            fallbackStart: 0,
            fallbackCount: activeFallbackSpecs.length,
            visualCount: activeOutcomes.length + activeFallbackSpecs.length,
          },
        ],
  );
  if (allOutcomes.positive || allOutcomes.negative) resultPanel.classList.add('critical');
  if (!modifierSequencePending) {
    if (allOutcomes.positive && !allOutcomes.negative)
      resultDetail.textContent = `${resultDetail.textContent} · POSITIVE`;
    else if (allOutcomes.negative && !allOutcomes.positive)
      resultDetail.textContent = `${resultDetail.textContent} · NEGATIVE`;
    else if (allOutcomes.positive && allOutcomes.negative)
      resultDetail.textContent = `${resultDetail.textContent} · MIXED`;
    announceCompletedOutcomeOnce(tableRolls);
  }

  requestRender();
  notifyRendererIdle();

  const completion: DraftrollRollCompletion = {
    results: collectOrderedVisualResults(physicalValues),
    total,
    replay: lastReplay ? cloneReplay(lastReplay) : null,
  };
  for (const pending of pendingRollCompletions) pending.resolve(completion);
  pendingRollCompletions.clear();
}

function updateQuantity(next: number): void {
  if (isRolling || isPlanning) return;
  quantity = THREE.MathUtils.clamp(next, 1, 30);
  quantityValue.textContent = String(quantity);
  spawnPreview();
  rollButtonText.textContent = `CAST ${quantity > 1 ? `${quantity}× ` : ''}${selectedKind.toUpperCase()}`;
}

function selectKind(kind: DieKind): void {
  if (isRolling || isPlanning) return;
  selectedKind = kind;
  document.querySelectorAll<HTMLButtonElement>('.die-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.die === kind);
  });
  rollButtonText.textContent = `CAST ${quantity > 1 ? `${quantity}× ` : ''}${kind.toUpperCase()}`;
  spawnPreview();
}

function selectTheme(theme: ThemeName): void {
  if (isRolling || isPlanning) return;
  if (!THEME_MANIFESTS[theme] || !THEMES[theme]) return;
  selectedTheme = theme;
  document.querySelectorAll<HTMLButtonElement>('.theme-swatch').forEach((button) => {
    button.classList.toggle('active', button.dataset.theme === theme);
  });
  for (const die of dice) die.setTheme(theme);
  const palette = THEMES[theme];
  document.documentElement.style.setProperty(
    '--accent',
    `#${palette.edge.toString(16).padStart(6, '0')}`,
  );
  document.documentElement.style.setProperty('--accent-bright', palette.label);
  statusText.textContent = `${palette.name} · ready to cast`;
  statusElement.classList.remove('rolling');
  if (!OVERLAY_MODE) void renderer.compileAsync(scene, camera).catch(() => undefined);
  requestRender();
}

document.querySelectorAll<HTMLButtonElement>('.die-button').forEach((button) => {
  button.addEventListener('click', () => {
    // `dataset.die` is only correct by convention with index.html; ignore a button whose
    // attribute drifted rather than selecting an unsupported kind.
    if (isDieKind(button.dataset.die)) selectKind(button.dataset.die);
  });
});
document.querySelectorAll<HTMLButtonElement>('.theme-swatch').forEach((button) => {
  button.addEventListener('click', () => {
    const theme = button.dataset.theme;
    if (theme !== undefined) selectTheme(theme);
  });
});
document
  .querySelector<HTMLButtonElement>('#quantity-minus')
  ?.addEventListener('click', () => updateQuantity(quantity - 1));
document
  .querySelector<HTMLButtonElement>('#quantity-plus')
  ?.addEventListener('click', () => updateQuantity(quantity + 1));
rollButton.addEventListener('click', () => {
  void enqueueRendererTask(() => castDice()).catch((error) => console.error(error));
});
soundToggle.addEventListener('click', () => {
  audio.setEnabled(!audio.enabled);
  soundToggle.setAttribute('aria-pressed', String(audio.enabled));
});
presetInput.addEventListener('input', () => {
  presetInput.classList.remove('invalid');
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
  setStatus('Ready to cast', false);
});
presetInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void enqueueRendererTask(() => castDice()).catch((error) => console.error(error));
  }
});

window.draftrollDice = {
  roll: (request) => {
    if (
      request &&
      typeof request === 'object' &&
      !Array.isArray(request) &&
      canAppendTableRequest(request)
    ) {
      return appendTableRoll(request);
    }
    return enqueueRendererTask(async () => {
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
      if (typeof request === 'number') {
        queuedApiResults = [request];
      } else if (Array.isArray(request)) {
        queuedApiResults = request.slice();
      } else if (request) {
        const results = request.results;
        queuedApiResults =
          results === undefined ? null : Array.isArray(results) ? results.slice() : [results];
        queuedOutcomes =
          request.outcomes === undefined
            ? null
            : Array.isArray(request.outcomes)
              ? request.outcomes.slice()
              : [request.outcomes];
        queuedContext = { ...request.context };
        queuedSeed = request.seed ?? null;
        queuedThemes = request.themes ?? null;
        queuedKinds = request.kinds ?? null;
        queuedPhysics = request.physics?.map((entry) => ({ ...entry })) ?? null;
        queuedPhysicsPreset = request.physicsPreset ?? 'standard';
        queuedFallbacks =
          request.fallbacks?.map((fallback) => ({
            ...fallback,
            metadata: fallback.metadata ? { ...fallback.metadata } : undefined,
          })) ?? [];
        queuedVisualOrder = request.visualOrder?.map((entry) => ({ ...entry })) ?? null;
        queuedStartAtMs =
          typeof request.startAtMs === 'number' && Number.isFinite(request.startAtMs)
            ? request.startAtMs
            : null;
        queuedSeekToMs =
          typeof request.seekToMs === 'number' && Number.isFinite(request.seekToMs)
            ? Math.max(0, request.seekToMs)
            : 0;
        queuedAnimationDurationMs =
          typeof request.animationDurationMs === 'number' &&
          Number.isFinite(request.animationDurationMs)
            ? Math.max(1, request.animationDurationMs)
            : null;
        queuedSettleImmediately = request.settleImmediately === true;
        queuedLateMode =
          request.lateMode === 'seek' ||
          request.lateMode === 'settled' ||
          request.lateMode === 'replay'
            ? request.lateMode
            : 'auto';
        queuedSettleAfterProgress =
          typeof request.settleAfterProgress === 'number' &&
          Number.isFinite(request.settleAfterProgress)
            ? THREE.MathUtils.clamp(request.settleAfterProgress, 0, 1)
            : 0.78;
      }
      return castDice();
    });
  },
  setResults: (results) => {
    const values = Array.isArray(results) ? results : [results];
    presetInput.value = values.join(',');
    presetInput.classList.remove('invalid');
    queuedApiResults = null;
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
  },
  clearResults: () => {
    presetInput.value = '';
    presetInput.classList.remove('invalid');
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
  },
  setDie: (kind) => selectKind(kind),
  setQuantity: (count) => updateQuantity(count),
  setTheme: (theme) => selectTheme(theme),
  // Deep copy so callers cannot mutate the shared THEME_MANIFESTS module state.
  getThemes: () =>
    // oxlint-disable-next-line oxc/no-map-spread
    Object.values(THEME_MANIFESTS).map((manifest) => ({
      ...manifest,
      capabilities: { ...manifest.capabilities },
      surfaceAudio: {
        ...manifest.surfaceAudio,
        pitchRange: [...manifest.surfaceAudio.pitchRange] as [number, number],
      },
    })),
  getThemeManifest: (theme) => {
    const manifest = THEME_MANIFESTS[theme];
    if (!manifest) throw new Error(`Unknown Draftroll theme: ${theme}`);
    return {
      ...manifest,
      capabilities: { ...manifest.capabilities },
      surfaceAudio: {
        ...manifest.surfaceAudio,
        pitchRange: [...manifest.surfaceAudio.pitchRange] as [number, number],
      },
    };
  },
  installTheme: async (bundle) => {
    invalidateDiceThemeResources(bundle.manifest.id);
    const manifest = await installRuntimeThemeBundle(bundle);
    const effectSlots = getRuntimeThemeEffects(manifest.id);
    if (effectSlots) effects.configureThemeEffects(manifest.id, effectSlots);
    const themeAudio = getRuntimeThemeAudio(manifest.id);
    if (themeAudio) audio.registerThemeAudio(manifest.id, themeAudio);
    prewarmDiceTheme(manifest.id);
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      previews: manifest.previews ? { ...manifest.previews } : undefined,
      availableDice: manifest.availableDice ? [...manifest.availableDice] : undefined,
      capabilities: { ...manifest.capabilities },
    };
  },
  unloadTheme: (themeId) => {
    if (!THEME_MANIFESTS[themeId] || themeId === 'dragon') return;
    if (selectedTheme === themeId) selectTheme('dragon');
    invalidateDiceThemeResources(themeId);
    audio.unregisterThemeAudio(themeId);
    uninstallRuntimeTheme(themeId);
  },
  configure: (config) => {
    if (config.outcomeResolver !== undefined) outcomeResolver = config.outcomeResolver;
    if (config.neutralEffects !== undefined) neutralEffects = config.neutralEffects;
    if (config.maxHeroEffects !== undefined)
      maxHeroEffects = THREE.MathUtils.clamp(Math.round(config.maxHeroEffects), 0, 30);
    if (config.adaptiveQuality !== undefined) adaptiveQuality = config.adaptiveQuality;
    if (config.performanceProfile !== undefined) performanceProfile = config.performanceProfile;
    if (config.maximumPixelRatio !== undefined)
      configuredMaximumPixelRatio = THREE.MathUtils.clamp(config.maximumPixelRatio, 0.65, 2);
    if (config.activeFramesPerSecond !== undefined)
      configuredActiveFramesPerSecond = THREE.MathUtils.clamp(
        Math.round(config.activeFramesPerSecond),
        15,
        60,
      );
    applyRuntimeQuality(Math.max(1, quantity + activeFallbackSpecs.length));
    requestRender();
  },
  configureThemeEffects: (theme, slots) => effects.configureThemeEffects(theme, slots),
  getLastReplay: () => (lastReplay ? cloneReplay(lastReplay) : null),
  playReplay: (replay, options) => enqueueRendererTask(() => playRecordedReplay(replay, options)),
  dismiss: (options) => dissolveDice(options),
  clear: () => {
    if (isRolling || isPlanning) return;
    cancelDissolve();
    clearDice();
    hasCast = false;
    activePlan = null;
    activeFallbackSpecs = [];
    activeVisualOrder = [];
    lastReplay = null;
    resultPanel.classList.remove('revealed', 'critical');
    resultTotal.textContent = '—';
    resultDetail.textContent = 'Ready';
    notifyRendererIdle();
    requestRender();
  },
  pause: () => {
    manuallyPaused = true;
    if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  },
  resume: () => {
    if (!manuallyPaused) return;
    manuallyPaused = false;
    lastFrameTimestamp = 0;
    nextFrameDeadline = 0;
    requestRender();
  },
  screenshot: async () => canvas.toDataURL('image/png'),
  configureCamera: (options) => {
    if (typeof options.yaw === 'number' && Number.isFinite(options.yaw))
      configuredCameraYaw = THREE.MathUtils.clamp(options.yaw, -Math.PI, Math.PI);
    if (typeof options.pitch === 'number' && Number.isFinite(options.pitch))
      configuredCameraPitch = THREE.MathUtils.clamp(options.pitch, 0, Math.PI / 6);
    if (typeof options.zoom === 'number' && Number.isFinite(options.zoom))
      configuredCameraZoom = THREE.MathUtils.clamp(options.zoom, 0.65, 1.8);
    if (options.autoRotate !== undefined) cameraAutoRotate = options.autoRotate;
    requestRender();
  },
  resetCamera: () => {
    configuredCameraYaw = 0;
    configuredCameraPitch = 0;
    configuredCameraZoom = 1;
    cameraAutoRotate = false;
    requestRender();
  },
  preview: async (options = {}) => {
    if (options.themeId && THEME_MANIFESTS[options.themeId]) selectTheme(options.themeId);
    const requestedKind = isDieKind(options.dieType) ? options.dieType : selectedKind;
    selectKind(requestedKind);
    const value =
      typeof options.value === 'number' && Number.isInteger(options.value)
        ? options.value
        : Math.ceil(Number(requestedKind.slice(1)) / 2);
    return window.draftrollDice.roll({
      results: [value],
      kinds: [requestedKind],
      themes: [selectedTheme],
      context: { preview: true },
    });
  },
  configureInteractions: (options) => {
    interactionOptions = {
      click: options.click ?? interactionOptions.click,
      draggable: options.draggable ?? interactionOptions.draggable,
    };
    canvas.style.pointerEvents =
      interactionOptions.click === 'none' && !interactionOptions.draggable ? '' : 'auto';
  },
  getPerformanceSnapshot: () => ({
    profile: performanceProfile,
    pixelRatio: currentPixelRatio,
    dynamicResolutionScale,
    targetFramesPerSecond: targetFramesPerSecond(),
    renderLoopActive: animationFrameId !== null,
    queuedPresentations: rendererTaskQueue.length + (rendererTaskRunning ? 1 : 0),
    physicalDice: dice.length,
    fallbackVisuals: fallbackVisuals.length,
    renderedFrames,
    averageFrameIntervalMs,
    averageRenderCpuMs,
    maximumFrameIntervalMs,
    usedJsHeapSize:
      (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
        ?.usedJSHeapSize ?? null,
    jsHeapSizeLimit:
      (performance as Performance & { memory?: { jsHeapSizeLimit?: number } }).memory
        ?.jsHeapSizeLimit ?? null,
    targeting: lastTargetingSnapshot ? { ...lastTargetingSnapshot } : null,
    activeTableRolls: readActiveTableRolls().map((group) => group.actorLabel ?? ''),
  }),
};

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    void enqueueRendererTask(() => castDice()).catch((error) => console.error(error));
  }
  const mapping: Record<string, DieKind> = {
    Digit1: 'd4',
    Digit2: 'd6',
    Digit3: 'd8',
    Digit4: 'd10',
    Digit5: 'd12',
    Digit6: 'd20',
  };
  const kind = mapping[event.code];
  if (kind) selectKind(kind);
});

let pointerStart: THREE.Vector2 | null = null;
const interactionRaycaster = new THREE.Raycaster();
const interactionPointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.72);
const dragPoint = new THREE.Vector3();
let draggedDie: { die: DieInstance; index: number; pointerId: number; mass: number } | null = null;

function updateInteractionRay(event: PointerEvent): void {
  const bounds = canvas.getBoundingClientRect();
  interactionPointer.set(
    ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1,
    -((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1,
  );
  interactionRaycaster.setFromCamera(interactionPointer, camera);
}

function findInteractiveDie(event: PointerEvent): { die: DieInstance; index: number } | null {
  updateInteractionRay(event);
  const hit = interactionRaycaster.intersectObjects(
    dice.map((die) => die.group),
    true,
  )[0];
  if (!hit) return null;
  const index = dice.findIndex((die) => {
    let object: THREE.Object3D | null = hit.object;
    while (object) {
      if (object === die.group) return true;
      object = object.parent;
    }
    return false;
  });
  return index >= 0 ? { die: dice[index], index } : null;
}

function beginDieDrag(event: PointerEvent): boolean {
  if (!interactionOptions.draggable || !hasCast || isRolling || isPlanning) return false;
  const target = findInteractiveDie(event);
  if (!target) return false;
  const mass = target.die.body.mass;
  target.die.body.type = CANNON.Body.KINEMATIC;
  target.die.body.mass = 0;
  target.die.body.updateMassProperties();
  target.die.body.velocity.setZero();
  target.die.body.angularVelocity.setZero();
  target.die.body.wakeUp();
  draggedDie = { ...target, pointerId: event.pointerId, mass };
  pointerStart = null;
  canvas.setPointerCapture(event.pointerId);
  return true;
}

function moveDraggedDie(event: PointerEvent): void {
  if (!draggedDie || draggedDie.pointerId !== event.pointerId) return;
  updateInteractionRay(event);
  if (!interactionRaycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
  const radius = draggedDie.die.getVisualRadius();
  const x = THREE.MathUtils.clamp(dragPoint.x, -visibleBounds.x + radius, visibleBounds.x - radius);
  const z = THREE.MathUtils.clamp(dragPoint.z, -visibleBounds.z + radius, visibleBounds.z - radius);
  draggedDie.die.body.position.set(x, Math.max(0.72, radius * 0.72), z);
  draggedDie.die.body.velocity.setZero();
  draggedDie.die.body.angularVelocity.setZero();
  draggedDie.die.syncVisual();
  requestRender();
}

function finishDieDrag(event: PointerEvent, cancelled = false): boolean {
  if (!draggedDie || draggedDie.pointerId !== event.pointerId) return false;
  const current = draggedDie;
  draggedDie = null;
  current.die.body.type = CANNON.Body.DYNAMIC;
  current.die.body.mass = current.mass;
  current.die.body.updateMassProperties();
  current.die.body.velocity.set(0, cancelled ? 0 : 0.08, 0);
  current.die.body.wakeUp();
  canvas.dispatchEvent(
    new CustomEvent('draftroll:die-interaction', {
      detail: {
        action: 'move',
        dieIndex: current.index,
        position: {
          x: current.die.body.position.x,
          y: current.die.body.position.y,
          z: current.die.body.position.z,
        },
      },
      bubbles: true,
    }),
  );
  requestRender();
  return true;
}

canvas.addEventListener('pointerdown', (event) => {
  if (beginDieDrag(event)) return;
  if (isRolling || isPlanning) return;
  pointerStart = new THREE.Vector2(event.clientX, event.clientY);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', moveDraggedDie);
canvas.addEventListener('pointerup', (event) => {
  if (finishDieDrag(event)) return;
  if (!pointerStart) return;
  const swipe = new THREE.Vector2(event.clientX, event.clientY).sub(pointerStart);
  pointerStart = null;
  if (swipe.length() > 22) {
    void enqueueRendererTask(() => castDice(swipe)).catch((error) => console.error(error));
    return;
  }
  if (hasCast && interactionOptions.click !== 'none') {
    canvas.dispatchEvent(
      new CustomEvent('draftroll:die-interaction', {
        detail: { action: interactionOptions.click, results: lastReplay?.results.slice() ?? [] },
        bubbles: true,
      }),
    );
    if (interactionOptions.click === 'reroll')
      void enqueueRendererTask(() => castDice()).catch((error) => console.error(error));
    if (interactionOptions.click === 'drop')
      void dissolveDice({ durationMs: 180 }).catch(() => undefined);
    if (interactionOptions.click === 'explode')
      effects.playOutcome(selectedTheme, 'positive', new THREE.Vector3(0, 0.5, 0), {
        hero: true,
        kind: activeKinds[0] ?? selectedKind,
        value: lastReplay?.results[0] ?? 1,
      });
  }
});
canvas.addEventListener('pointercancel', (event) => {
  finishDieDrag(event, true);
  pointerStart = null;
});

let resizeFrame: number | null = null;

function applyResize(): void {
  resizeFrame = null;
  rebuildScreenBounds();
  applyRendererResolution();
  if (!isRolling && !isPlanning && !hasCast) spawnPreview();
  requestRender();
}

window.addEventListener(
  'resize',
  () => {
    if (resizeFrame !== null) return;
    resizeFrame = window.requestAnimationFrame(applyResize);
  },
  { passive: true },
);

const viewportResizeObserver =
  typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        if (resizeFrame !== null) return;
        resizeFrame = window.requestAnimationFrame(applyResize);
      })
    : null;
viewportResizeObserver?.observe(document.documentElement);

let physicsAccumulator = 0;
let elapsed = 0;
let cameraZoom = 1;
let configuredCameraZoom = 1;
let configuredCameraYaw = 0;
let configuredCameraPitch = 0;
let cameraAutoRotate = false;
let manuallyPaused = false;
let interactionOptions: Required<RendererInteractionOptions> = { click: 'none', draggable: false };
let animationFrameId: number | null = null;
let lastFrameTimestamp = 0;
let nextFrameDeadline = 0;
const adaptiveResolution = new AdaptiveResolutionController({
  minimumScale: OVERLAY_MODE ? 0.8 : 0.7,
});
let renderedFrames = 0;
let averageFrameIntervalMs = 0;
let averageRenderCpuMs = 0;
let maximumFrameIntervalMs = 0;

function hasAwakeDice(): boolean {
  return dice.some((die) => die.body.sleepState !== CANNON.Body.SLEEPING);
}

function shouldContinueRendering(): boolean {
  return (
    isRolling ||
    effects.hasActiveAnimations() ||
    hasAwakeDice() ||
    Math.abs(cameraZoom - 1) > 0.0005
  );
}

function requestRender(): void {
  if (document.hidden || manuallyPaused || animationFrameId !== null) return;
  if (
    OVERLAY_MODE &&
    !isRolling &&
    dice.length === 0 &&
    fallbackVisuals.length === 0 &&
    !effects.hasActiveAnimations()
  )
    return;
  animationFrameId = window.requestAnimationFrame(animate);
}

function updateDynamicResolution(frameDurationMs: number): void {
  if (performanceProfile !== 'auto' || !isRolling) {
    adaptiveResolution.reset();
    return;
  }
  const next = adaptiveResolution.observe(
    frameDurationMs,
    targetFramesPerSecond(),
    dynamicResolutionScale,
  );
  if (next === null || next === dynamicResolutionScale) return;
  dynamicResolutionScale = next;
  applyRendererResolution();
}

function animate(timestamp: number): void {
  animationFrameId = null;
  if (document.hidden || manuallyPaused) return;

  const minimumFrameInterval = 1_000 / targetFramesPerSecond();
  if (nextFrameDeadline > 0 && timestamp < nextFrameDeadline - 0.75) {
    requestRender();
    return;
  }

  const dt =
    lastFrameTimestamp > 0
      ? Math.min((timestamp - lastFrameTimestamp) / 1_000, 0.1)
      : Math.min(1 / targetFramesPerSecond(), 0.05);
  lastFrameTimestamp = timestamp;
  nextFrameDeadline =
    nextFrameDeadline > 0
      ? Math.max(nextFrameDeadline + minimumFrameInterval, timestamp + minimumFrameInterval * 0.2)
      : timestamp + minimumFrameInterval;
  elapsed += dt;
  if (isRolling || effects.hasActiveAnimations()) audio.update(dt);
  if (isRolling || effects.hasActiveAnimations()) effects.update(dt);

  if (activePlan && isRolling) {
    const previousTime = planTime;
    if (!tableReplanPaused) planTime = Math.min(activePlan.duration, planTime + dt);
    applyPlanTransform(activePlan, planTime);
    const fallbackProgress = activePlan.duration > 0 ? planTime / activePlan.duration : 1;
    fallbackVisuals.forEach((visual) => visual.update(fallbackProgress));
    if (!tableReplanPaused) {
      playImpacts(activePlan, previousTime, planTime);
      playSettledOutcomeEffects(activePlan, planTime);
    }
    if (!tableReplanPaused && planTime >= activePlan.duration) {
      revealDelay += dt;
      if (revealDelay > 0.28) revealResults();
    }
  } else if (!isPlanning && hasAwakeDice()) {
    physicsAccumulator = Math.min(physicsAccumulator + dt, FIXED_STEP * 4);
    dynamicBodies.length = dice.length;
    for (let index = 0; index < dice.length; index += 1) dynamicBodies[index] = dice[index].body;
    while (physicsAccumulator >= FIXED_STEP) {
      world.step(FIXED_STEP);
      enforceBodiesBounds(dynamicBodies);
      physicsAccumulator -= FIXED_STEP;
    }
    for (const die of dice) {
      clampDieToVisibleArea(die);
      die.syncVisual();
    }
  }

  const shake = effects.getCameraOffset();
  if (cameraAutoRotate && !isPlanning) configuredCameraYaw += dt * 0.12;
  const horizontal = CAMERA_HEIGHT * Math.sin(configuredCameraPitch);
  const height = CAMERA_HEIGHT * Math.cos(configuredCameraPitch);
  camera.position.set(
    shake.position.x + Math.sin(configuredCameraYaw) * horizontal,
    height,
    shake.position.z + Math.cos(configuredCameraYaw) * horizontal,
  );
  camera.up.set(
    Math.sin(shake.roll + configuredCameraYaw),
    0,
    -Math.cos(shake.roll + configuredCameraYaw),
  );
  camera.lookAt(shake.position.x * 0.12, 0, shake.position.z * 0.12);
  const targetZoom = configuredCameraZoom * (isRolling ? 0.988 : 1);
  cameraZoom = THREE.MathUtils.lerp(cameraZoom, targetZoom, 1 - Math.pow(0.002, dt));
  camera.zoom = cameraZoom;
  camera.updateProjectionMatrix();

  if (!hasCast && elapsed > 5.5)
    gestureHint.classList.toggle('hidden', Math.sin(elapsed * 1.6) < -0.9);
  const renderStartedAt = performance.now();
  if (OVERLAY_MODE) renderer.render(scene, camera);
  else composer?.render();
  const renderCpuMs = performance.now() - renderStartedAt;
  const frameIntervalMs = dt * 1_000;
  renderedFrames += 1;
  const smoothing = renderedFrames === 1 ? 1 : 0.08;
  averageFrameIntervalMs += (frameIntervalMs - averageFrameIntervalMs) * smoothing;
  averageRenderCpuMs += (renderCpuMs - averageRenderCpuMs) * smoothing;
  maximumFrameIntervalMs = Math.max(maximumFrameIntervalMs, frameIntervalMs);
  updateDynamicResolution(frameIntervalMs);

  if (shouldContinueRendering()) requestRender();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    lastFrameTimestamp = 0;
    if (isRolling && activePlan) {
      planTime = activePlan.duration;
      applyPlanTransform(activePlan, planTime);
      fallbackVisuals.forEach((visual) => visual.settle());
      markOutcomeEffectsThrough(activePlan, activePlan.duration);
      revealResults();
    }
    return;
  }
  lastFrameTimestamp = 0;
  nextFrameDeadline = 0;
  requestRender();
});

selectTheme(selectedTheme);
selectKind(selectedKind);
if (!OVERLAY_MODE) void renderer.compileAsync(scene, camera).catch(() => undefined);
applyRuntimeQuality(Math.max(1, quantity));
if (!OVERLAY_MODE) requestRender();
