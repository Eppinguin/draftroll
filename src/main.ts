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
import { PhysicalRollPlanner, type PhysicalRollPlanResult } from './physical-roll-planner';
import { PhysicalTableRegistry, type PhysicalTableEntry } from './physical-table';
import { THEME_MANIFESTS, type ThemeManifest } from './themes';
import { FallbackVisualInstance } from './fallback-visuals';
import {
  PhysicalDieVisualInstance,
  assignPendingPhysicalLaunchStates,
  commitPhysicalVisualPlan,
  getPhysicalVisualPlanEntries,
  getPendingPhysicalLaunchParticipants,
  hasConfiguredPhysicalVisuals,
  hasPendingPhysicalVisuals,
  type PendingPhysicalLaunchParticipant,
} from './physical-die-visuals';
import { createCanonicalPhysicalDieDefinition, type PhysicalDieDefinition } from './physical-dice';
import {
  createPhysicalLaunchStates,
  type PhysicalLaunchParticipant,
  type PhysicalLaunchState,
} from './physical-launch';
import { consumeSettledVisualIndexes, deriveDieSettleTimes } from './settlement';
import { clonePhysicalDieDefinition } from '../packages/renderer/src/physical';
import type {
  DraftrollFallbackVisual,
  DraftrollPhysicalVisual,
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
  getRuntimeThemePresentation,
  installRuntimeThemeBundle,
  isRecord,
  uninstallRuntimeTheme,
} from './runtime-themes';

export interface RollEffectContext {
  results: number[];
  dieKinds: DieKind[];
  quantity: number;
  context: Record<string, unknown>;
}

export interface DiceRollRequest {
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
  method: 'symmetry' | 'relabel' | 'fixed' | 'mixed';
  planningMs: number;
  retargetedDiceCount: number;
  preservedTrajectoryDiceCount: number;
  naturalMatches: number;
  minimumFinalAlignment: number;
  targetSuccess: boolean;
  naturalTrajectory: boolean;
  targetingCounts: { symmetry: number; relabel: number; fixed: number };
}

export interface DicePerformanceSnapshot {
  profile: DicePerformanceProfile;
  physicsPreset: DicePhysicsPreset;
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
  physical: DraftrollPhysicalVisual[];
  physicsPreset?: DicePhysicsPreset;
  bounds: { x: number; z: number };
  step: number;
  frameCount: number;
  duration: number;
  transforms: Float32Array;
  landings: Int32Array;
  activationDelays?: Float32Array;
  settleTimes?: Float32Array;
  impacts: Float32Array;
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
      roll: (request?: DiceRollRequest) => Promise<DraftrollRollCompletion>;
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
      /** Internal browser regression diagnostics; not part of DraftrollBridge. */
      getPhysicalSnapshot: () => Array<{
        id: string;
        physicalIndex: number;
        sides: number;
        implementation: 'canonical' | 'generated' | 'custom';
        targeting: 'symmetry' | 'relabel' | 'fixed';
        requestedOutcomeIndex: number;
        displayedOutcomeIndex: number;
        landedOutcomeIndex: number | null;
        result: number | string;
        visible: boolean;
        position: { x: number; y: number; z: number };
        quaternion: { x: number; y: number; z: number; w: number };
        screenPosition: { x: number; y: number };
      }>;
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
  targetingMethod?: 'symmetry' | 'relabel' | 'fixed' | 'mixed';
  targetingCounts?: { symmetry: number; relabel: number; fixed: number };
  planningMs?: number;
  naturalTrajectory?: boolean;
  naturalMatches?: number;
  finalTargetDots?: number[];
  targetSuccess?: boolean;
  retargetedDice?: number[];
  lockedKinematicDice?: number;
}

interface RollPlan {
  step: number;
  frameCount: number;
  dieCount: number;
  transforms: Float32Array;
  landings: Int32Array;
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
const physicalTable = new PhysicalTableRegistry();
let fallbackVisuals: FallbackVisualInstance[] = [];
let isRolling = false;
let isPlanning = false;
let hasCast = false;
let dissolveAnimation: Animation | null = null;
let dissolveGeneration = 0;
let collisionSparkBudget = 0;
let queuedPhysical: DraftrollPhysicalVisual[] | null = null;
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
let activePhysicalSpecs: DraftrollPhysicalVisual[] = [];
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
  generation: number;
  run: (generation: number) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const MAX_RENDERER_QUEUE = 32;
const rendererTaskQueue: RendererTask<unknown>[] = [];
const rendererIdleWaiters = new Set<() => void>();
let rendererTaskRunning = false;
let presentationGeneration = 0;

function presentationClearedError(): Error {
  return new Error('Draftroll presentation was cleared');
}

function assertPresentationGeneration(generation: number): void {
  if (generation !== presentationGeneration) throw presentationClearedError();
}

function notifyRendererIdle(): void {
  if (isRolling || isPlanning) return;
  for (const resolve of rendererIdleWaiters) resolve();
  rendererIdleWaiters.clear();
}

function waitForRendererIdle(): Promise<void> {
  if (!isRolling && !isPlanning) return Promise.resolve();
  return new Promise<void>((resolve) => rendererIdleWaiters.add(resolve));
}

function enqueueRendererTask<T>(run: (generation: number) => Promise<T>): Promise<T> {
  if (rendererTaskQueue.length >= MAX_RENDERER_QUEUE) {
    return Promise.reject(
      new Error(`Renderer presentation queue exceeded ${MAX_RENDERER_QUEUE} entries`),
    );
  }
  const promise = new Promise<T>((resolve, reject) => {
    // The queue is heterogeneous, so entries store their resolver at `unknown`. Each entry is
    // only ever settled with the value its own `run` produced, which is this promise's `T`.
    rendererTaskQueue.push({
      generation: presentationGeneration,
      run,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      resolve: resolve as (value: unknown) => void,
      reject,
    });
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
    assertPresentationGeneration(task.generation);
    task.resolve(await task.run(task.generation));
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
    visualCount: activePhysicalSpecs.length + activeFallbackSpecs.length,
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

function clonePhysicalVisual(visual: DraftrollPhysicalVisual): DraftrollPhysicalVisual {
  return {
    ...visual,
    physics: visual.physics ? { ...visual.physics } : undefined,
    definition: visual.definition ? clonePhysicalDieDefinition(visual.definition) : undefined,
    presentation: visual.presentation
      ? { contents: visual.presentation.contents.map((content) => ({ ...content })) }
      : undefined,
    metadata: visual.metadata ? { ...visual.metadata } : undefined,
  };
}

function cloneFallbackVisual(fallback: DraftrollFallbackVisual): DraftrollFallbackVisual {
  return Object.assign({}, fallback, {
    metadata: fallback.metadata ? Object.assign({}, fallback.metadata) : undefined,
  });
}

function cloneReplay(replay: RollReplay): RollReplay {
  return {
    ...replay,
    physical: replay.physical.map(clonePhysicalVisual),
    bounds: { ...replay.bounds },
    transforms: replay.transforms.slice(),
    landings: replay.landings.slice(),
    activationDelays: replay.activationDelays?.slice(),
    settleTimes: replay.settleTimes?.slice(),
    impacts: replay.impacts.slice(),
    fallbacks: replay.fallbacks?.map(cloneFallbackVisual),
    visualOrder: replay.visualOrder?.map((entry) => ({ ...entry })),
    context: { ...replay.context },
    effectTimeline: replay.effectTimeline.map((event) => ({ ...event })),
  };
}

function clearGenericPhysicalVisuals(): void {
  for (const entry of physicalTable.visualEntries()) {
    const visual = entry.visual;
    if (!visual) continue;
    const visualIndex = entry.visualIndex;
    if (visualIndex === null) throw new Error('Physical table visual entry has no visual index.');
    scene.remove(visual.group);
    visual.dispose();
    physicalTable.unbindVisualAt(visualIndex, visual);
  }
}

function rebindCanonicalPhysicalTableRuntime(): void {
  if (physicalTable.canonicalCount !== dice.length) {
    throw new Error(
      `Physical table canonical runtime count mismatch: ${physicalTable.canonicalCount} entries for ${dice.length} dice`,
    );
  }
  dice.forEach((die, canonicalIndex) => physicalTable.bindCanonicalAt(canonicalIndex, die));
}

function physicalTableSpec(spec: DraftrollPhysicalVisual) {
  return {
    dieId: spec.id,
    implementation: usesCanonicalPhysicalImplementation(spec)
      ? ('canonical' as const)
      : ('visual' as const),
  };
}

function resetPhysicalTable(specs: DraftrollPhysicalVisual[], preserveBindings = false): void {
  activePhysicalSpecs = specs;
  physicalTable.reset(specs.map(physicalTableSpec), preserveBindings);
  rebindCanonicalPhysicalTableRuntime();
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
  clearGenericPhysicalVisuals();
  clearFallbackVisuals();
  physicalTable.reset([]);
}

function spawnGenericPhysicalVisuals(specs: readonly DraftrollPhysicalVisual[]): void {
  clearGenericPhysicalVisuals();
  if (specs.length === 0) return;
  specs.forEach((spec, visualIndex) => {
    const visual = new PhysicalDieVisualInstance(spec);
    visual.prepare();
    scene.add(visual.group);
    physicalTable.bindVisualAt(visualIndex, visual);
  });
}

function spawnFallbackVisuals(specs: readonly DraftrollFallbackVisual[], seed: string): void {
  clearFallbackVisuals();
  if (specs.length === 0) return;
  const random = createSeededRandom(`${seed}:fallbacks`);
  const occupied: THREE.Vector2[] = [];
  fallbackVisuals = specs.map((spec, index) => {
    const visual = new FallbackVisualInstance(spec);
    visual.configureTrajectory(index, specs.length, screenBounds, random, occupied);
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
    (dice.length === 0 && physicalTable.visualCount === 0 && fallbackVisuals.length === 0) ||
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
      mass: baseDieMass(kind) * (diePhysics.massScale ?? 1),
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
  const ranges = activeKinds.map((kind) => `1–${maximumDieValue(kind)}`).join(', ');
  setStatus(`Use valid values for ${ranges}`, false);
  presetInput.focus();
}

function maximumDieValue(kind: DieKind): number {
  return kind === 'coin' ? 2 : Number(kind.slice(1));
}

function baseDieMass(kind: DieKind): number {
  return kind === 'coin' ? 0.42 : 1.12;
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
  const valid = new Set<DieKind>(['coin', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20']);
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

function usesCanonicalPhysicalImplementation(visual: DraftrollPhysicalVisual): boolean {
  if (
    visual.definition ||
    !visual.canonicalKind ||
    !isDieKind(visual.canonicalKind) ||
    visual.presentation
  )
    return false;
  return !getRuntimeThemePresentation(visual.theme, visual.type, visual.canonicalKind);
}

function splitPhysicalSpecs(physical: readonly DraftrollPhysicalVisual[]): {
  canonicalIndexes: number[];
  genericIndexes: number[];
} {
  const canonicalIndexes: number[] = [];
  const genericIndexes: number[] = [];
  physical.forEach((visual, index) => {
    (usesCanonicalPhysicalImplementation(visual) ? canonicalIndexes : genericIndexes).push(index);
  });
  return { canonicalIndexes, genericIndexes };
}

function currentGenericPhysicalSpecs(): DraftrollPhysicalVisual[] {
  return physicalTable.visualEntries().flatMap((entry) => {
    const visual = activePhysicalSpecs[entry.physicalIndex];
    return visual ? [visual] : [];
  });
}

function prepareTargets(): boolean {
  const requestedPhysical = queuedPhysical?.map(clonePhysicalVisual) ?? null;
  queuedPhysical = null;
  const explicitResultCount = queuedApiResults !== null ? queuedApiResults.length : null;
  const explicitKindCount = Array.isArray(queuedKinds) ? queuedKinds.length : null;
  const fallbackOnlyRequest =
    queuedFallbacks !== null &&
    queuedFallbacks.length > 0 &&
    (requestedPhysical?.length ?? 0) === 0 &&
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
  const physicalVisualCount = requestedPhysical?.length ?? kinds.length;
  if (physicalVisualCount + fallbacks.length < 1 || physicalVisualCount + fallbacks.length > 30) {
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
  if (requestedPhysical) {
    resetPhysicalTable(requestedPhysical);
    if (physicalTable.canonicalCount !== quantity) {
      setStatus('Physical implementation split does not match canonical dice', false);
      return false;
    }
  } else {
    resetPhysicalTable(
      kinds.map((kind, index) => {
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
      }),
    );
  }
  rebindCanonicalPhysicalTableRuntime();
  activeFallbackSpecs = fallbacks;
  activeVisualOrder = normalizeVisualOrder(
    queuedVisualOrder,
    activePhysicalSpecs.length,
    fallbacks.length,
  );
  queuedVisualOrder = null;
  if (activeVisualOrder.length !== activePhysicalSpecs.length + fallbacks.length) {
    setStatus('Visual ordering does not match the roll components', false);
    return false;
  }

  activeContext = { ...queuedContext };
  queuedContext = {};
  activeSeed = normalizeSeed(queuedSeed);
  queuedSeed = null;
  spawnGenericPhysicalVisuals(currentGenericPhysicalSpecs());
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

interface ActiveTableRollGroup {
  groupId: string;
  /** Logical die IDs retained only for semantic/reporting state. */
  dieIds?: string[];
  actorLabel?: string;
  rollLabel?: string;
  total: number;
  physicalStart: number;
  physicalCount: number;
  fallbackStart: number;
  fallbackCount: number;
  visualCount: number;
  /** Exact runtime table membership; unlike logical die IDs, these are unique on the live table. */
  physicalIndexes: number[];
  fallbackIndexes: number[];
}

function tableIndexRange(start: number, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_value, offset) => start + offset);
}

function readTableIndexes(value: unknown, start: number, count: number): number[] {
  if (!Array.isArray(value)) return tableIndexRange(start, count);
  const indexes = value
    .filter((entry): entry is number => Number.isSafeInteger(entry) && entry >= 0)
    .map((entry) => Math.floor(entry));
  return [...new Set(indexes)].toSorted((left, right) => left - right);
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
    const normalizedPhysicalStart = Math.max(0, Math.floor(physicalStart));
    const normalizedPhysicalCount = Math.max(0, Math.floor(physicalCount));
    const normalizedFallbackStart = Math.max(0, Math.floor(fallbackStart));
    const normalizedFallbackCount = Math.max(0, Math.floor(fallbackCount));
    return [
      {
        groupId: typeof entry.groupId === 'string' ? entry.groupId : `table-roll-${physicalStart}`,
        dieIds: Array.isArray(entry.dieIds)
          ? entry.dieIds.filter((id): id is string => typeof id === 'string')
          : undefined,
        actorLabel: typeof entry.actorLabel === 'string' ? entry.actorLabel : undefined,
        rollLabel: typeof entry.rollLabel === 'string' ? entry.rollLabel : undefined,
        total,
        physicalStart: normalizedPhysicalStart,
        physicalCount: normalizedPhysicalCount,
        fallbackStart: normalizedFallbackStart,
        fallbackCount: normalizedFallbackCount,
        visualCount: Math.max(0, Math.floor(visualCount)),
        physicalIndexes: readTableIndexes(
          entry.physicalIndexes,
          normalizedPhysicalStart,
          normalizedPhysicalCount,
        ),
        fallbackIndexes: readTableIndexes(
          entry.fallbackIndexes,
          normalizedFallbackStart,
          normalizedFallbackCount,
        ),
      },
    ];
  });
}

interface CanonicalLaunchParticipant {
  die: DieInstance;
  index: number;
  physicalIndex: number;
}

interface GenericLaunchParticipant extends PendingPhysicalLaunchParticipant {
  physicalIndex: number;
}

function pendingGenericLaunchParticipants(): GenericLaunchParticipant[] {
  return getPendingPhysicalLaunchParticipants(physicalTable.visualInstances()).map((entry) => ({
    visualIndex: entry.visualIndex,
    radius: entry.radius,
    coinLike: entry.coinLike,
    physicalIndex: physicalTable.physicalIndexForVisual(entry.visualIndex),
  }));
}

function toLaunchState(state: PhysicalLaunchState): LaunchState {
  return {
    position: new CANNON.Vec3(...state.position),
    quaternion: new CANNON.Quaternion(...state.quaternion),
    velocity: new CANNON.Vec3(...state.velocity),
    angularVelocity: new CANNON.Vec3(...state.angularVelocity),
    delay: state.delay,
  };
}

function createMixedPhysicalLaunchStates(
  canonical: readonly CanonicalLaunchParticipant[],
  generic: readonly GenericLaunchParticipant[],
  random: () => number,
  throwDirection: THREE.Vector2,
  handBias: number,
  delayOffset = 0,
): LaunchState[] {
  const participants: PhysicalLaunchParticipant[] = [
    ...canonical.map(({ die }) => ({
      radius: DIE_COLLIDER_RADIUS[die.kind],
      coinLike: die.kind === 'coin',
    })),
    ...generic.map(({ radius, coinLike }) => ({ radius, coinLike })),
  ];
  const generated = createPhysicalLaunchStates(participants, {
    bounds: screenBounds,
    random,
    throwDirection,
    handBias,
    gravity: PHYSICS_PRESETS[activePhysicsPreset].gravity,
    delayOffset,
  });
  const canonicalStates = generated.slice(0, canonical.length).map(toLaunchState);
  assignPendingPhysicalLaunchStates(
    physicalTable.visualInstances(),
    generic.map((entry, index) => ({
      visualIndex: entry.visualIndex,
      state: generated[canonical.length + index],
    })),
  );
  return canonicalStates;
}

function allCanonicalLaunchParticipants(): CanonicalLaunchParticipant[] {
  return dice.map((die, index) => ({
    die,
    index,
    physicalIndex: physicalTable.physicalIndexForCanonical(index),
  }));
}

function groupContainsPhysicalIndex(group: ActiveTableRollGroup, physicalIndex: number): boolean {
  return group.physicalIndexes.includes(physicalIndex);
}

function createLaunchStates(swipe: THREE.Vector2 | undefined, seed: string): LaunchState[] {
  const canonical = allCanonicalLaunchParticipants();
  const generic = pendingGenericLaunchParticipants();
  const tableRolls = readActiveTableRolls().filter(
    (group) =>
      canonical.some((entry) => groupContainsPhysicalIndex(group, entry.physicalIndex)) ||
      generic.some((entry) => groupContainsPhysicalIndex(group, entry.physicalIndex)),
  );
  if (tableRolls.length > 1) {
    const states: Array<LaunchState | undefined> = Array.from({ length: canonical.length });
    let assignedGeneric = 0;
    for (let groupIndex = 0; groupIndex < tableRolls.length; groupIndex += 1) {
      const group = tableRolls[groupIndex];
      const groupCanonical = canonical.filter((entry) =>
        groupContainsPhysicalIndex(group, entry.physicalIndex),
      );
      const groupGeneric = generic.filter((entry) =>
        groupContainsPhysicalIndex(group, entry.physicalIndex),
      );
      if (groupCanonical.length + groupGeneric.length === 0) continue;
      const lane = THREE.MathUtils.lerp(-0.82, 0.82, groupIndex / (tableRolls.length - 1));
      const random = createSeededRandom(`${seed}:${group.groupId}`);
      const throwDirection = new THREE.Vector2(-lane * 0.28, -1)
        .normalize()
        .rotateAround(new THREE.Vector2(), (random() - 0.5) * 0.12);
      const groupStates = createMixedPhysicalLaunchStates(
        groupCanonical,
        groupGeneric,
        random,
        throwDirection,
        lane,
      );
      groupCanonical.forEach((entry, index) => {
        states[entry.index] = groupStates[index];
      });
      assignedGeneric += groupGeneric.length;
    }
    if (states.every(Boolean) && assignedGeneric === generic.length) {
      return states.filter((state): state is LaunchState => state !== undefined);
    }
  }

  const random = createSeededRandom(seed);
  const swipeLateral = swipe ? THREE.MathUtils.clamp(swipe.x / 190, -0.78, 0.78) : 0;
  const swipeForward = swipe ? THREE.MathUtils.clamp(-swipe.y / 260, -0.3, 0.72) : 0;
  const total = canonical.length + generic.length;
  const naturalYaw = (random() - 0.5) * (total > 12 ? 0.15 : 0.22);
  const throwDirection = new THREE.Vector2(swipeLateral * 0.62, -1 + swipeForward * 0.13)
    .normalize()
    .rotateAround(new THREE.Vector2(), naturalYaw);
  const handBias = swipeLateral * 0.48 + (random() - 0.5) * 0.12;
  return createMixedPhysicalLaunchStates(canonical, generic, random, throwDirection, handBias);
}

interface WorkerPhysicalPlanEntry {
  definition: PhysicalDieDefinition;
  state: number[];
  physics?: {
    mass?: number;
    sizeScale?: number;
    inertiaScale?: number;
    linearDamping?: number;
    angularDamping?: number;
  };
  captureImpacts?: boolean;
}

interface WorkerPlanResponse {
  id: number;
  step: number;
  frameCount: number;
  dieCount: number;
  transforms: ArrayBuffer;
  impacts: ArrayBuffer;
  landings: ArrayBuffer;
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
const rollWorkerDefinitionKeys = new Set<string>();
const pendingPlans = new Map<number, PendingPlan>();
let nextPlanId = 1;

function releaseRollWorker(): void {
  if (pendingPlans.size > 0) return;
  rollWorker?.terminate();
  rollWorker = null;
  rollWorkerDefinitionKeys.clear();
  if (rollWorkerReleaseTimer !== null) window.clearTimeout(rollWorkerReleaseTimer);
  rollWorkerReleaseTimer = null;
}

function cancelPendingRollPlans(error: Error): void {
  for (const pending of pendingPlans.values()) pending.reject(error);
  pendingPlans.clear();
  releaseRollWorker();
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
      landings: new Int32Array(response.landings),
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

function serializePlannerState(state: LaunchState): number[] {
  return [
    state.position.x,
    state.position.y,
    state.position.z,
    state.quaternion.x,
    state.quaternion.y,
    state.quaternion.z,
    state.quaternion.w,
    state.velocity.x,
    state.velocity.y,
    state.velocity.z,
    state.angularVelocity.x,
    state.angularVelocity.y,
    state.angularVelocity.z,
    state.delay,
  ];
}

function genericPlannerPhysics(spec: DraftrollPhysicalVisual): WorkerPhysicalPlanEntry['physics'] {
  const preset = PHYSICS_PRESETS[activePhysicsPreset];
  const theme =
    getRuntimeThemePhysics(spec.theme, spec.type) ??
    getRuntimeThemePhysics(spec.theme, `d${spec.sides}`) ??
    {};
  const override = spec.physics ?? {};
  const sizeScale = THREE.MathUtils.clamp(
    (override.sizeScale ?? theme.sizeScale ?? 1) * preset.sizeScale,
    0.5,
    2,
  );
  const massScale = THREE.MathUtils.clamp(
    (override.massScale ?? theme.massScale ?? 1) * preset.massScale,
    0.25,
    4,
  );
  const inertiaScale = THREE.MathUtils.clamp(
    (override.inertiaScale ?? theme.inertiaScale ?? 1) * preset.inertiaScale,
    0.25,
    4,
  );
  return {
    mass: (spec.sides === 2 ? 0.42 : 1.12) * massScale,
    sizeScale,
    inertiaScale,
    linearDamping: preset.linearDamping,
    angularDamping: preset.angularDamping,
  };
}

function createWorkerPhysicalEntries(states: readonly LaunchState[]): WorkerPhysicalPlanEntry[] {
  const genericEntries = getPhysicalVisualPlanEntries(physicalTable.visualInstances());
  if (genericEntries.length !== physicalTable.visualCount) {
    throw new Error('Generic physical visuals do not match the active physical descriptors.');
  }
  const genericByVisualIndex = new Map(
    genericEntries.map((entry) => [entry.visualIndex, entry] as const),
  );
  return activePhysicalSpecs.map((spec, physicalIndex) => {
    const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);
    if (canonicalIndex >= 0) {
      const state = states[canonicalIndex];
      const kind = activeKinds[canonicalIndex];
      if (!state || !kind)
        throw new Error(`Canonical physical state is missing at ${physicalIndex}.`);
      const properties = activePhysics[canonicalIndex] ?? {};
      const preset = PHYSICS_PRESETS[activePhysicsPreset];
      return {
        definition: createCanonicalPhysicalDieDefinition(kind),
        state: serializePlannerState(state),
        physics: {
          mass: baseDieMass(kind) * (properties.massScale ?? 1),
          sizeScale: properties.sizeScale,
          inertiaScale: properties.inertiaScale,
          linearDamping: preset.linearDamping,
          angularDamping: preset.angularDamping,
        },
        captureImpacts: true,
      };
    }
    const visualIndex = physicalTable.visualIndex(physicalIndex);
    if (visualIndex < 0) {
      throw new Error(`Generic physical visual index is missing at ${physicalIndex}.`);
    }
    const generic = genericByVisualIndex.get(visualIndex);
    if (!generic) throw new Error(`Generic physical state is missing at ${physicalIndex}.`);
    return {
      definition: generic.definition,
      state: generic.state.slice(),
      physics: genericPlannerPhysics(spec),
      captureImpacts: true,
    };
  });
}

function readLandingValue(
  plan: RollPlan,
  transforms: Float32Array,
  canonicalIndex: number,
): number {
  const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);
  const stride = plan.dieCount * 7;
  const offset = (plan.frameCount - 1) * stride + physicalIndex * 7;
  const die = dice[canonicalIndex];
  die.resetNumbering();
  const landingIndex = die.getTopFaceIndex({
    x: transforms[offset + 3],
    y: transforms[offset + 4],
    z: transforms[offset + 5],
    w: transforms[offset + 6],
  });
  return die.getValueForFaceIndex(landingIndex);
}

function applyShapeSymmetryTargets(plan: RollPlan, preservedPhysicalCount = 0): RollPlan {
  const transforms = plan.transforms.slice();
  const landings = plan.landings.slice();
  const frameStride = plan.dieCount * 7;
  const retargetedDice: number[] = [];
  const naturallyMatched = new Set<number>();
  const finalTargetDots: number[] = [];
  const baseQuaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  for (let canonicalIndex = 0; canonicalIndex < dice.length; canonicalIndex += 1) {
    const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);
    if (physicalIndex < preservedPhysicalCount) continue;
    const target = activeTargets[canonicalIndex];
    const rawLandingValue = readLandingValue(plan, transforms, canonicalIndex);
    if (target === null || target === undefined || rawLandingValue === target) {
      if (target !== null && target !== undefined) naturallyMatched.add(physicalIndex);
      continue;
    }

    const symmetry = dice[canonicalIndex].getResultSymmetryRotation(target, rawLandingValue);
    retargetedDice.push(physicalIndex);
    for (let frame = 0; frame < plan.frameCount; frame += 1) {
      const offset = frame * frameStride + physicalIndex * 7;
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

  const results = dice.map((_die, canonicalIndex) =>
    readLandingValue(plan, transforms, canonicalIndex),
  );
  const failures: number[] = [];
  for (let canonicalIndex = 0; canonicalIndex < dice.length; canonicalIndex += 1) {
    const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);
    landings[physicalIndex] = Math.max(0, (results[canonicalIndex] ?? 1) - 1);
    if (physicalIndex < preservedPhysicalCount) continue;
    const target = activeTargets[canonicalIndex];
    if (target !== null && target !== undefined && results[canonicalIndex] !== target) {
      failures.push(physicalIndex);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Shape-symmetry targeting failed for physical indexes ${failures.join(', ')}.`);
  }

  for (let canonicalIndex = 0; canonicalIndex < dice.length; canonicalIndex += 1) {
    const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);
    const target = activeTargets[canonicalIndex];
    if (physicalIndex < preservedPhysicalCount || target === null || target === undefined) {
      finalTargetDots.push(1);
      continue;
    }
    const offset = (plan.frameCount - 1) * frameStride + physicalIndex * 7;
    const finalQuaternion = new THREE.Quaternion(
      transforms[offset + 3],
      transforms[offset + 4],
      transforms[offset + 5],
      transforms[offset + 6],
    );
    finalTargetDots.push(
      dice[canonicalIndex]
        .getTargetNormal(target)
        .applyQuaternion(finalQuaternion)
        .normalize()
        .dot(up),
    );
  }

  const completedPlan: RollPlan = {
    ...plan,
    transforms,
    landings,
    results,
    settleReason:
      retargetedDice.length > 0 ? `${plan.settleReason}+shape-symmetry` : plan.settleReason,
    diagnostics: {
      ...plan.diagnostics,

      naturalTrajectory: true,
      naturalMatches: naturallyMatched.size,
      finalTargetDots,
      targetSuccess: failures.length === 0,
      retargetedDice,
    },
  };
  completedPlan.settleTimes = deriveDieSettleTimes(completedPlan);
  return completedPlan;
}

const mainThreadPhysicalPlanner = new PhysicalRollPlanner();

function activeGenericPlanAssignments() {
  return physicalTable.visualEntries().map((entry) => {
    if (entry.visualIndex === null) {
      throw new Error(`Physical table visual index is missing at ${entry.physicalIndex}.`);
    }
    return {
      visualIndex: entry.visualIndex,
      physicalIndex: entry.physicalIndex,
    };
  });
}

function plannerResultAsRollPlan(
  result: PhysicalRollPlanResult,
  dieCount: number,
  lockedCount: number,
): Omit<RollPlan, 'results'> {
  const impacts: RollImpact[] = [];
  for (let offset = 0; offset + 2 < result.impacts.length; offset += 3) {
    impacts.push({
      time: result.impacts[offset],
      dieIndex: Math.round(result.impacts[offset + 1]),
      strength: result.impacts[offset + 2],
    });
  }
  return {
    step: result.step,
    frameCount: result.frameCount,
    dieCount,
    transforms: result.transforms,
    landings: result.landings,
    impacts,
    duration: result.duration,
    settleReason: result.settleReason,
    physicsSteps: result.physicsSteps,
    diagnostics: {
      planningMs: result.planningMs,
      naturalTrajectory: true,
      naturalMatches: dieCount,
      targetSuccess: true,
      lockedKinematicDice: lockedCount,
    },
  };
}

function completePhysicalPlan(
  basePlan: Omit<RollPlan, 'results'>,
  entries: readonly WorkerPhysicalPlanEntry[],
  preservedPhysicalCount: number,
): RollPlan {
  const completed = applyShapeSymmetryTargets(
    {
      ...basePlan,
      results: [],
      activationDelays: Float32Array.from(entries, (entry) => entry.state[13] ?? 0),
    },
    preservedPhysicalCount,
  );
  const targetingCounts = entries.reduce(
    (counts, entry) => {
      counts[entry.definition.targeting] += 1;
      return counts;
    },
    { symmetry: 0, relabel: 0, fixed: 0 },
  );
  const activeTargeting = (['symmetry', 'relabel', 'fixed'] as const).filter(
    (targeting) => targetingCounts[targeting] > 0,
  );
  completed.diagnostics = {
    ...completed.diagnostics,
    targetingMethod: activeTargeting.length === 1 ? activeTargeting[0] : 'mixed',
    targetingCounts,
  };
  commitPhysicalVisualPlan(
    physicalTable.visualInstances(),
    completed.transforms,
    completed.frameCount,
    completed.step,
    completed.dieCount,
    activeGenericPlanAssignments(),
    completed.landings,
    completed.activationDelays,
  );
  return completed;
}

async function buildRollPlan(
  states: LaunchState[],
  preservedPhysicalCount = 0,
  lockedTrajectory?: LockedTableTrajectory,
): Promise<RollPlan> {
  const entries = createWorkerPhysicalEntries(states);
  const lockedCount = lockedTrajectory ? preservedPhysicalCount : 0;
  const worker = getRollWorker();
  if (!worker) {
    const result = mainThreadPhysicalPlanner.simulate({
      entries,
      boundsX: screenBounds.x,
      boundsZ: screenBounds.z,
      lockedCount,
      lockedMotion:
        lockedTrajectory && lockedCount > 0
          ? {
              count: lockedCount,
              step: lockedTrajectory.step,
              frameCount: lockedTrajectory.frameCount,
              transforms: lockedTrajectory.transforms,
            }
          : undefined,
      gravity: PHYSICS_PRESETS[activePhysicsPreset].gravity,
    });
    return completePhysicalPlan(
      plannerResultAsRollPlan(result, entries.length, lockedCount),
      entries,
      preservedPhysicalCount,
    );
  }

  const id = nextPlanId++;
  const definitionsAdded = new Set<string>();
  const workerEntries = entries.map((entry) => {
    const definitionKey = entry.definition.id;
    const includeDefinition =
      !rollWorkerDefinitionKeys.has(definitionKey) && !definitionsAdded.has(definitionKey);
    if (includeDefinition) definitionsAdded.add(definitionKey);
    return {
      definitionKey,
      definition: includeDefinition ? entry.definition : undefined,
      state: entry.state,
      physics: entry.physics,
      captureImpacts: entry.captureImpacts,
    };
  });
  const lockedTransforms = lockedTrajectory?.transforms.slice();
  const transfer: Transferable[] = [];
  if (lockedTransforms) transfer.push(lockedTransforms.buffer);
  const basePlan = await new Promise<Omit<RollPlan, 'results'>>((resolve, reject) => {
    pendingPlans.set(id, { resolve, reject });
    worker.postMessage(
      {
        id,
        entries: workerEntries,
        boundsX: screenBounds.x,
        boundsZ: screenBounds.z,
        lockedCount,
        lockedTrajectory: lockedTransforms?.buffer,
        lockedTrajectoryStep: lockedTrajectory?.step,
        lockedTrajectoryFrameCount: lockedTrajectory?.frameCount,
        gravity: PHYSICS_PRESETS[activePhysicsPreset].gravity,
      },
      transfer,
    );
    for (const key of definitionsAdded) rollWorkerDefinitionKeys.add(key);
  });
  return completePhysicalPlan(basePlan, entries, preservedPhysicalCount);
}

function planDisplayScale(plan: RollPlan): { x: number; z: number } {
  return {
    x: plan.sourceBounds
      ? Math.min(1, (screenBounds.x - 0.15) / Math.max(0.01, plan.sourceBounds.x))
      : 1,
    z: plan.sourceBounds
      ? Math.min(1, (screenBounds.z - 0.15) / Math.max(0.01, plan.sourceBounds.z))
      : 1,
  };
}

function applyPlanTransform(plan: RollPlan, time: number, scaleX: number, scaleZ: number): void {
  const framePosition = THREE.MathUtils.clamp(time / plan.step, 0, plan.frameCount - 1);
  const firstIndex = Math.floor(framePosition);
  const secondIndex = Math.min(firstIndex + 1, plan.frameCount - 1);
  const alpha = framePosition - firstIndex;
  const frameStride = plan.dieCount * 7;
  const firstFrameOffset = firstIndex * frameStride;
  const secondFrameOffset = secondIndex * frameStride;

  dice.forEach((die, canonicalIndex) => {
    const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);
    const activationDelay = plan.activationDelays?.[physicalIndex] ?? 0;
    die.group.visible = time + plan.step * 0.5 >= activationDelay;
    const a = firstFrameOffset + physicalIndex * 7;
    const b = secondFrameOffset + physicalIndex * 7;
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

function physicalWorldPositionAt(
  physicalIndex: number,
  target = new THREE.Vector3(),
): THREE.Vector3 | null {
  return physicalTable.worldPosition(physicalIndex, target);
}

function playImpacts(plan: RollPlan, previousTime: number, currentTime: number): void {
  while (nextImpactIndex < plan.impacts.length) {
    const impact = plan.impacts[nextImpactIndex];
    if (impact.time > currentTime) break;
    if (impact.time >= previousTime) {
      const impactTheme = activePhysicalSpecs[impact.dieIndex]?.theme ?? selectedTheme;
      const position = physicalWorldPositionAt(impact.dieIndex);
      audio.playImpact(impact.strength, THEME_MANIFESTS[impactTheme].surfaceAudio, impactTheme);
      if (position && collisionSparkBudget > 0 && impact.strength > 3.4) {
        collisionSparkBudget -= 1;
        effects.impact(position, THEMES[impactTheme].particle, impact.strength);
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
        method: diagnostics.targetingMethod ?? 'mixed',
        planningMs: diagnostics.planningMs ?? 0,
        retargetedDiceCount: diagnostics.retargetedDice?.length ?? 0,
        preservedTrajectoryDiceCount: diagnostics.lockedKinematicDice ?? 0,
        naturalMatches: diagnostics.naturalMatches ?? 0,
        minimumFinalAlignment: diagnostics.finalTargetDots?.length
          ? Math.min(...diagnostics.finalTargetDots)
          : 1,
        targetSuccess: diagnostics.targetSuccess !== false,
        naturalTrajectory: diagnostics.naturalTrajectory === true,
        targetingCounts: diagnostics.targetingCounts ?? { symmetry: 0, relabel: 0, fixed: 0 },
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
    landings: plan.landings.slice(),
    activationDelays: plan.activationDelays?.slice(),
    settleTimes: plan.settleTimes?.slice(),
    impacts: packImpacts(plan.impacts),
    fallbacks: activeFallbackSpecs.map(cloneFallbackVisual),
    visualOrder: activeVisualOrder.map((entry) => ({ ...entry })),
    context: { ...activeContext },
    effectTimeline: createEffectTimeline(
      plan,
      activePhysicalSpecs.map((_spec, index) => physicalOutcomeAt(index)),
    ),
    settleReason: plan.settleReason,
    physicsSteps: plan.physicsSteps,
  };
}

function updatePlanVisuals(plan: RollPlan, time: number): void {
  const scale = planDisplayScale(plan);
  applyPlanTransform(plan, time, scale.x, scale.z);
  physicalTable.forEachVisual((visual) => visual.update(time, scale.x, scale.z));
  const progress = plan.duration > 0 ? time / plan.duration : 1;
  fallbackVisuals.forEach((visual) => visual.update(progress, plan.duration));
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
    Math.min(
      48,
      (activePhysicalSpecs.length + activeFallbackSpecs.length) *
        runtimeQuality.impactEffectsPerDie,
    ),
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
  updatePlanVisuals(plan, planTime);
  if (OVERLAY_MODE) {
    // Paint the first committed frame before notifying the host. The host keeps
    // its iframe hidden until this exact signal, avoiding both a retained old
    // frame and a blank visibility handoff while planning is still in progress.
    renderer.render(scene, camera);
    canvas.style.visibility = '';
    window.dispatchEvent(new Event('draftroll:frame-ready'));
  }
  requestRender();
  if (settleImmediately) {
    physicalTable.forEachVisual((visual) => visual.settle());
    fallbackVisuals.forEach((visual) => visual.settle());
    if (document.hidden) markOutcomeEffectsThrough(plan, plan.duration);
    else playSettledOutcomeEffects(plan, plan.duration);
    revealResults();
  }
}

function applyReplayNumbering(plan: RollPlan): void {
  dice.forEach((die) => die.resetNumbering());
  const stride = plan.dieCount * 7;
  const finalOffset = (plan.frameCount - 1) * stride;
  const matches = dice.every((die, canonicalIndex) => {
    const physicalIndex = physicalTable.physicalIndexForCanonical(canonicalIndex);
    const offset = finalOffset + physicalIndex * 7;
    const landingIndex = die.getTopFaceIndex({
      x: plan.transforms[offset + 3],
      y: plan.transforms[offset + 4],
      z: plan.transforms[offset + 5],
      w: plan.transforms[offset + 6],
    });
    return die.getValueForFaceIndex(landingIndex) === plan.results[canonicalIndex];
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

  const physical = replay.physical.map(clonePhysicalVisual);
  const fallbacks = (replay.fallbacks ?? []).map(cloneFallbackVisual);
  const split = splitPhysicalSpecs(physical);
  const canonical = split.canonicalIndexes.map((index) => physical[index]);
  const generic = split.genericIndexes.map((index) => physical[index]);
  const kinds = canonical.map((visual) => visual.canonicalKind).filter(isDieKind);
  if (kinds.length !== canonical.length)
    return Promise.reject(new Error('Replay canonical physical descriptors are invalid'));
  const themes = canonical.map((visual) => visual.theme);
  if (physical.some((visual) => !THEME_MANIFESTS[visual.theme]))
    return Promise.reject(new Error('Replay references an unavailable theme'));
  const totalVisuals = physical.length + fallbacks.length;
  if (totalVisuals < 1 || totalVisuals > 30)
    return Promise.reject(new Error('Replay visual count is invalid'));
  const expectedTransforms = replay.frameCount * physical.length * 7;
  if (replay.transforms.length !== expectedTransforms)
    return Promise.reject(new Error('Replay transform buffer is invalid'));
  if (replay.landings.length !== physical.length)
    return Promise.reject(new Error('Replay landing buffer is invalid'));

  selectedKind = kinds[0] ?? 'd20';
  selectedTheme = physical[0]?.theme ?? fallbacks[0]?.theme ?? 'dragon';
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
  resetPhysicalTable(physical);
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
  spawnGenericPhysicalVisuals(generic);
  spawnFallbackVisuals(activeFallbackSpecs, activeSeed);
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
    dieCount: physical.length,
    transforms: replay.transforms.slice(),
    landings: replay.landings.slice(),
    activationDelays:
      replay.activationDelays?.length === physical.length
        ? replay.activationDelays.slice()
        : undefined,
    settleTimes:
      replay.settleTimes?.length === physical.length ? replay.settleTimes.slice() : undefined,
    impacts,
    duration: replay.duration,
    results: canonical.map((visual) => visual.outcomeIndex + 1),
    settleReason: replay.settleReason,
    physicsSteps: replay.physicsSteps,
    sourceBounds: { ...replay.bounds },
  };
  if (!plan.settleTimes) plan.settleTimes = deriveDieSettleTimes(plan);
  commitPhysicalVisualPlan(
    physicalTable.visualInstances(),
    plan.transforms,
    plan.frameCount,
    plan.step,
    plan.dieCount,
    activeGenericPlanAssignments(),
    plan.landings,
    plan.activationDelays,
  );
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

function createFallbackOnlyPlan(specs: readonly DraftrollFallbackVisual[]): RollPlan {
  const count = specs.length;
  const duration = specs.some((spec) => spec.kind === 'card')
    ? 1.7 + Math.min(0.5, count * 0.04)
    : 1.35 + Math.min(0.7, count * 0.04);
  const step = FIXED_STEP;
  return {
    step,
    frameCount: Math.ceil(duration / step) + 1,
    dieCount: 0,
    transforms: new Float32Array(0),
    landings: new Int32Array(0),
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
  const dieCount = activePhysicalSpecs.length;
  const transforms = new Float32Array(frameCount * dieCount * 7);
  const source = activePlan;
  if (dieCount > 0 && (!source || source.dieCount !== dieCount)) {
    throw new Error('Active physical plan does not match the visible table.');
  }
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let physicalIndex = 0; physicalIndex < dieCount; physicalIndex += 1) {
      const sample = samplePlanTransform(
        source!,
        Math.min(source!.duration, planTime),
        physicalIndex,
      );
      const offset = frame * dieCount * 7 + physicalIndex * 7;
      transforms[offset] = sample.position.x;
      transforms[offset + 1] = sample.position.y;
      transforms[offset + 2] = sample.position.z;
      transforms[offset + 3] = sample.quaternion.x;
      transforms[offset + 4] = sample.quaternion.y;
      transforms[offset + 5] = sample.quaternion.z;
      transforms[offset + 6] = sample.quaternion.w;
    }
  }
  const plan: RollPlan = {
    step,
    frameCount,
    dieCount,
    transforms,
    landings: source?.landings.slice() ?? new Int32Array(dieCount),
    activationDelays: new Float32Array(dieCount),
    impacts: [],
    duration,
    results: source?.results.slice() ?? dice.map((die) => die.getTopValue()),
    settleReason: 'additive-static',
    physicsSteps: 0,
  };
  plan.settleTimes = deriveDieSettleTimes(plan);
  return plan;
}

interface NormalizedPhysicalBridgeRequest {
  physical: DraftrollPhysicalVisual[];
  canonicalResults: number[];
  canonicalKinds: DieKind[];
  canonicalThemes: ThemeName[];
  canonicalOutcomes: EffectOutcome[];
  canonicalPhysics: DicePhysicsProperties[];
  canonicalPhysicalIndexes: number[];
  genericPhysical: DraftrollPhysicalVisual[];
  genericPhysicalIndexes: number[];
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
    const maximumSides = visual.definition ? 10_000 : 256;
    if (
      !Number.isSafeInteger(visual.sides) ||
      visual.sides < 1 ||
      visual.sides > maximumSides ||
      !Number.isSafeInteger(visual.outcomeIndex) ||
      visual.outcomeIndex < 0 ||
      visual.outcomeIndex >= visual.sides ||
      (visual.definition !== undefined &&
        (visual.definition.sides !== visual.sides ||
          visual.definition.outcomes.length !== visual.sides ||
          visual.definition.targeting !== 'relabel' ||
          visual.canonicalKind !== undefined)) ||
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
  const fallbacks = (request.fallbacks ?? []).map(cloneFallbackVisual);
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
    canonicalPhysics: canonical.map((visual) => Object.assign({}, visual.physics)),
    canonicalPhysicalIndexes: split.canonicalIndexes,
    genericPhysical: split.genericIndexes.map((index) => physical[index]),
    genericPhysicalIndexes: split.genericIndexes,
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
}

interface AdditivePhysicalRequest extends NormalizedPhysicalBridgeRequest {}

function normalizeAdditivePhysicalRequest(
  request: DiceRollRequest,
): AdditivePhysicalRequest | null {
  if (request.settleImmediately || request.lateMode === 'settled' || request.lateMode === 'replay')
    return null;
  try {
    const normalized = normalizePhysicalBridgeRequest(request);
    if (normalized.physical.length + normalized.fallbacks.length === 0) return null;
    return normalized;
  } catch {
    return null;
  }
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
    const physicalIndex = physicalTable.physicalIndexForCanonical(index);
    const current = samplePlanTransform(plan, time, physicalIndex);
    const nextTime = Math.min(plan.duration, time + Math.max(plan.step, 1 / 60));
    const next = samplePlanTransform(plan, nextTime, physicalIndex);
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
      mass: baseDieMass(kind) * (properties.massScale ?? 1),
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

function appendGenericPhysicalVisuals(
  specs: readonly DraftrollPhysicalVisual[],
  firstVisualIndex: number,
): PhysicalDieVisualInstance[] {
  if (specs.length === 0) return [];
  return specs.map((spec, offset) => {
    const visual = new PhysicalDieVisualInstance(spec);
    visual.prepare();
    scene.add(visual.group);
    physicalTable.bindVisualAt(firstVisualIndex + offset, visual);
    return visual;
  });
}

function appendFallbackVisuals(
  specs: readonly DraftrollFallbackVisual[],
  seed: string,
): FallbackVisualInstance[] {
  if (specs.length === 0) return [];
  const start = fallbackVisuals.length;
  const total = start + specs.length;
  const random = createSeededRandom(`${seed}:additive-fallbacks`);
  const occupied = fallbackVisuals.map((visual) => visual.getSettledPosition());
  const appended = specs.map((spec, offset) => {
    const visual = new FallbackVisualInstance(spec);
    visual.configureTrajectory(start + offset, total, screenBounds, random, occupied);
    scene.add(visual.group);
    fallbackVisuals.push(visual);
    return visual;
  });
  return appended;
}

function removeAppendedGenericPhysicalVisuals(
  appended: readonly PhysicalDieVisualInstance[],
  firstVisualIndex: number,
): void {
  appended.forEach((visual, offset) => {
    scene.remove(visual.group);
    visual.dispose();
    physicalTable.unbindVisualAt(firstVisualIndex + offset, visual);
  });
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
      const localPhysicalStart = Math.max(0, Math.floor(Number(entry.physicalStart) || 0));
      const localPhysicalCount = Math.max(
        0,
        Math.floor(Number(entry.physicalCount) || physicalCount),
      );
      const localFallbackStart = Math.max(0, Math.floor(Number(entry.fallbackStart) || 0));
      const localFallbackCount = Math.max(
        0,
        Math.floor(Number(entry.fallbackCount) || fallbackCount),
      );
      const resolvedPhysicalStart = physicalStart + localPhysicalStart;
      const resolvedFallbackStart = fallbackStart + localFallbackStart;
      return [
        {
          groupId:
            typeof entry.groupId === 'string'
              ? entry.groupId
              : `table-add-${physicalStart}-${index}`,
          dieIds: Array.isArray(entry.dieIds)
            ? entry.dieIds.filter((id): id is string => typeof id === 'string')
            : undefined,
          actorLabel: typeof entry.actorLabel === 'string' ? entry.actorLabel : undefined,
          rollLabel: typeof entry.rollLabel === 'string' ? entry.rollLabel : undefined,
          total: Number.isFinite(Number(entry.total)) ? Number(entry.total) : 0,
          physicalStart: resolvedPhysicalStart,
          physicalCount: localPhysicalCount,
          fallbackStart: resolvedFallbackStart,
          fallbackCount: localFallbackCount,
          visualCount: Math.max(
            0,
            Math.floor(Number(entry.visualCount) || localPhysicalCount + localFallbackCount),
          ),
          physicalIndexes: tableIndexRange(resolvedPhysicalStart, localPhysicalCount),
          fallbackIndexes: tableIndexRange(resolvedFallbackStart, localFallbackCount),
        },
      ];
    });
  }
  const metadata = isRecord(context.metadata) ? context.metadata : undefined;
  return [
    {
      groupId: typeof context.rollId === 'string' ? context.rollId : `table-add-${physicalStart}`,
      dieIds: Array.isArray(context.renderedDieIds)
        ? context.renderedDieIds.filter((id): id is string => typeof id === 'string')
        : undefined,
      actorLabel: typeof context.name === 'string' ? context.name : undefined,
      rollLabel: typeof metadata?.actionName === 'string' ? metadata.actionName : undefined,
      total: Number.isFinite(Number(context.normalizedTotal)) ? Number(context.normalizedTotal) : 0,
      physicalStart,
      physicalCount,
      fallbackStart,
      fallbackCount,
      visualCount: physicalCount + fallbackCount,
      physicalIndexes: tableIndexRange(physicalStart, physicalCount),
      fallbackIndexes: tableIndexRange(fallbackStart, fallbackCount),
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
    const physicalIndexes = [
      ...new Set([...previous.physicalIndexes, ...addition.physicalIndexes]),
    ].toSorted((left, right) => left - right);
    const fallbackIndexes = [
      ...new Set([...previous.fallbackIndexes, ...addition.fallbackIndexes]),
    ].toSorted((left, right) => left - right);
    merged[index] = {
      ...previous,
      actorLabel: addition.actorLabel ?? previous.actorLabel,
      rollLabel: addition.rollLabel ?? previous.rollLabel,
      total: singleRollCompletedTotal ?? previous.total,
      dieIds: [...new Set([...(previous.dieIds ?? []), ...(addition.dieIds ?? [])])],
      physicalStart: physicalIndexes[0] ?? previous.physicalStart,
      physicalCount: physicalIndexes.length,
      fallbackStart: fallbackIndexes[0] ?? previous.fallbackStart,
      fallbackCount: fallbackIndexes.length,
      visualCount: physicalIndexes.length + fallbackIndexes.length,
      physicalIndexes,
      fallbackIndexes,
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
  const existingVisualCount = physicalTable.visualCount;
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
    ? createLockedTableTrajectory(activePlan, planTime, existingPhysicalCount)
    : undefined;
  activePhysicsPreset = normalized.physicsPreset;
  world.gravity.set(0, -PHYSICS_PRESETS[activePhysicsPreset].gravity, 0);
  physicalTable.append(normalized.physical.map(physicalTableSpec));
  const appended = appendPhysicalDice(
    normalized.canonicalKinds,
    normalized.canonicalThemes,
    normalized.canonicalPhysics,
  );
  const appendedAdditional = appendGenericPhysicalVisuals(
    normalized.genericPhysical,
    existingVisualCount,
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
    appended.forEach((die, index) =>
      physicalTable.bindCanonicalAt(existingCanonicalCount + index, die),
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
      physicalIndex: physicalTable.physicalIndexForCanonical(existingCanonicalCount + index),
    }));
    const newStates = createMixedPhysicalLaunchStates(
      appendedCanonical,
      pendingGenericLaunchParticipants(),
      random,
      direction,
      lane,
      scheduledDelay,
    );

    tableReplanPaused = true;
    isPlanning = true;
    setStatus(`${readActiveTableRolls().length} rollers sharing the table`, true);
    const needsSharedPhysicalPlan =
      newStates.length > 0 || hasPendingPhysicalVisuals(physicalTable.visualInstances());
    const plan = needsSharedPhysicalPlan
      ? await buildRollPlan(
          [...existingStates, ...newStates],
          existingPhysicalCount,
          lockedTrajectory,
        )
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
    removeAppendedGenericPhysicalVisuals(appendedAdditional, existingVisualCount);
    removeAppendedFallbackVisuals(appendedFallbacks);
    activeKinds = previous.activeKinds;
    activeThemes = previous.activeThemes;
    activePhysics = previous.activePhysics;
    activePhysicsPreset = previous.activePhysicsPreset;
    activeTargets = previous.activeTargets;
    activeOutcomes = previous.activeOutcomes;
    resetPhysicalTable(previous.activePhysicalSpecs, true);
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
    (activePhysicalSpecs.length > 0 || activeFallbackSpecs.length > 0) &&
    normalizeAdditivePhysicalRequest(request) !== null
  );
}

async function castDice(
  swipe?: THREE.Vector2,
  generation = presentationGeneration,
): Promise<DraftrollRollCompletion> {
  assertPresentationGeneration(generation);
  if (isRolling || isPlanning) throw new Error('Renderer is busy');
  // The host can reveal an iframe that was laid out at a provisional size.
  // Re-measure immediately before every presentation so camera and backing
  // buffer always use the same CSS viewport and cannot stretch the scene.
  rebuildScreenBounds();
  applyRendererResolution();
  if (dissolveAnimation) cancelDissolve(true);
  const hasQueuedVisualRequest =
    queuedPhysical !== null ||
    queuedApiResults !== null ||
    queuedKinds !== null ||
    queuedFallbacks !== null;
  if (dice.length === 0 && !hasQueuedVisualRequest) spawnPreview();
  if (!prepareTargets()) throw new Error('Roll request is invalid');

  const totalVisuals = activePhysicalSpecs.length + activeFallbackSpecs.length;
  applyRuntimeQuality(totalVisuals);
  let plan: RollPlan;
  const hasArbitraryPhysicalDice = hasConfiguredPhysicalVisuals(physicalTable.visualInstances());
  if (quantity === 0 && !hasArbitraryPhysicalDice) {
    activeOutcomes = [];
    plan = createFallbackOnlyPlan(activeFallbackSpecs);
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
      assertPresentationGeneration(generation);
      console.error('Roll worker failed; using shared main-thread planner.', error);
      try {
        const fallbackEntries = createWorkerPhysicalEntries(states);
        const fallbackResult = mainThreadPhysicalPlanner.simulate({
          entries: fallbackEntries,
          boundsX: screenBounds.x,
          boundsZ: screenBounds.z,
          gravity: PHYSICS_PRESETS[activePhysicsPreset].gravity,
        });
        plan = completePhysicalPlan(
          plannerResultAsRollPlan(fallbackResult, fallbackEntries.length, 0),
          fallbackEntries,
          0,
        );
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
    assertPresentationGeneration(generation);
    activeOutcomes = resolveOutcomes(plan.results);
    syncCanonicalPhysicalSpecs(plan.results);
  }

  captureReplay(plan);
  const scheduledStartAtMs = activeStartAtMs;
  const scheduledDelay = scheduledStartAtMs === null ? 0 : scheduledStartAtMs - Date.now();
  if (scheduledDelay > 0)
    await new Promise<void>((resolve) => window.setTimeout(resolve, scheduledDelay));
  assertPresentationGeneration(generation);

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

function physicalResultAt(
  physicalIndex: number,
  canonicalValues: readonly number[],
): number | string {
  const spec = activePhysicalSpecs[physicalIndex];
  if (spec) return spec.result;
  const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);
  return canonicalIndex >= 0 ? (canonicalValues[canonicalIndex] ?? 0) : 0;
}

function physicalOutcomeAt(physicalIndex: number): EffectOutcome {
  const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);
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
    const spec = activePhysicalSpecs[entry.index];
    if (spec) return `${spec.title} ${spec.label}${suffix}`;
    return `Die ${String(physicalResultAt(entry.index, physicalValues))}${suffix}`;
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

function physicalRuntimeKey(index: number): string {
  return `physical:${index}`;
}

function fallbackRuntimeKey(index: number): string {
  return `fallback:${index}`;
}

function effectGroupId(kind: 'physical' | 'fallback', index: number): string {
  const group = readActiveTableRolls().find((entry) =>
    kind === 'physical'
      ? entry.physicalIndexes.includes(index)
      : entry.fallbackIndexes.includes(index),
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
    Array.from({ length: plan.dieCount }, (_value, index) => physicalRuntimeKey(index)),
    settleTimes,
    time,
    playedOutcomeEffectIds,
  );
  consumeSettledVisualIndexes(
    activeFallbackSpecs.map((_spec, index) => fallbackRuntimeKey(index)),
    fallbackVisuals.map((visual) => visual.getSettleTime(plan.duration)),
    time,
    playedOutcomeEffectIds,
  );
}

function playSettledOutcomeEffects(plan: RollPlan, currentTime: number): void {
  const settleTimes =
    plan.settleTimes?.length === plan.dieCount ? plan.settleTimes : deriveDieSettleTimes(plan);
  plan.settleTimes = settleTimes;
  const physicalIndexes = consumeSettledVisualIndexes(
    Array.from({ length: plan.dieCount }, (_value, index) => physicalRuntimeKey(index)),
    settleTimes,
    currentTime,
    playedOutcomeEffectIds,
  );
  const fallbackIndexes = consumeSettledVisualIndexes(
    activeFallbackSpecs.map((_spec, index) => fallbackRuntimeKey(index)),
    fallbackVisuals.map((visual) => visual.getSettleTime(plan.duration)),
    currentTime,
    playedOutcomeEffectIds,
  );
  if (physicalIndexes.length === 0 && fallbackIndexes.length === 0) return;
  if (document.hidden) return;

  effects.beginBatch();
  try {
    physicalIndexes.forEach((physicalIndex) => {
      const spec = activePhysicalSpecs[physicalIndex];
      const position = physicalWorldPositionAt(physicalIndex);
      if (!spec || !position) return;
      const canonicalIndex = physicalTable.canonicalIndex(physicalIndex);
      const outcome = physicalOutcomeAt(physicalIndex);
      const kind =
        canonicalIndex >= 0
          ? (activeKinds[canonicalIndex] ?? selectedKind)
          : spec.canonicalKind && isDieKind(spec.canonicalKind)
            ? spec.canonicalKind
            : 'd6';
      const value =
        canonicalIndex >= 0
          ? (plan.results[canonicalIndex] ?? spec.numericValue ?? 0)
          : (spec.numericValue ?? (typeof spec.result === 'number' ? spec.result : 0));
      effects.playOutcome(spec.theme, outcome, position.setY(0.05), {
        kind,
        value,
        hero: reserveHeroEffect(effectGroupId('physical', physicalIndex), outcome),
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
}

function outcomeSummaryForGroups(groups: readonly ActiveTableRollGroup[]): {
  positive: boolean;
  negative: boolean;
} {
  let positive = false;
  let negative = false;
  for (const group of groups) {
    for (const index of group.physicalIndexes) {
      const outcome = physicalOutcomeAt(index);
      if (outcome === 'positive') positive = true;
      if (outcome === 'negative') negative = true;
    }
    for (const index of group.fallbackIndexes) {
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
            physicalCount: activePhysicalSpecs.length,
            fallbackStart: 0,
            fallbackCount: activeFallbackSpecs.length,
            visualCount: activePhysicalSpecs.length + activeFallbackSpecs.length,
            physicalIndexes: tableIndexRange(0, activePhysicalSpecs.length),
            fallbackIndexes: tableIndexRange(0, activeFallbackSpecs.length),
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

function syncCanonicalPhysicalSpecs(results: readonly number[]): void {
  physicalTable.canonicalEntries().forEach(({ physicalIndex, canonicalIndex }) => {
    if (canonicalIndex === null) return;
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

function revealResults(): void {
  if (!isRolling) return;
  isRolling = false;
  const physicalValues = activePlan?.results.slice() ?? dice.map((die) => die.getTopValue());
  const fallbackTotal = activeFallbackSpecs.reduce(
    (sum, fallback) => sum + (fallback.numericValue ?? 0),
    0,
  );
  const genericPhysicalTotal = currentGenericPhysicalSpecs().reduce(
    (sum, visual) =>
      sum + (visual.numericValue ?? (typeof visual.result === 'number' ? visual.result : 0)),
    0,
  );
  const physicalTotal =
    physicalValues.reduce((sum, value) => sum + value, 0) + genericPhysicalTotal;
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
  physicalTable.forEachVisual((visual) => visual.settle());
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
            physicalCount: activePhysicalSpecs.length,
            fallbackStart: 0,
            fallbackCount: activeFallbackSpecs.length,
            visualCount: activePhysicalSpecs.length + activeFallbackSpecs.length,
            physicalIndexes: tableIndexRange(0, activePhysicalSpecs.length),
            fallbackIndexes: tableIndexRange(0, activeFallbackSpecs.length),
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
  void enqueueRendererTask((generation) => castDice(undefined, generation)).catch((error) =>
    console.error(error),
  );
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
    void enqueueRendererTask((generation) => castDice(undefined, generation)).catch((error) =>
      console.error(error),
    );
  }
});

window.draftrollDice = {
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
        queuedFallbacks = normalized.fallbacks.map(cloneFallbackVisual);
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
    applyRuntimeQuality(Math.max(1, activePhysicalSpecs.length + activeFallbackSpecs.length));
    requestRender();
  },
  configureThemeEffects: (theme, slots) => effects.configureThemeEffects(theme, slots),
  getLastReplay: () => (lastReplay ? cloneReplay(lastReplay) : null),
  playReplay: (replay, options) => enqueueRendererTask(() => playRecordedReplay(replay, options)),
  dismiss: (options) => dissolveDice(options),
  clear: () => {
    presentationGeneration += 1;
    const error = presentationClearedError();
    rendererTaskQueue.splice(0).forEach((task) => task.reject(error));
    cancelPendingRollPlans(error);
    for (const pending of pendingRollCompletions) pending.reject(error);
    pendingRollCompletions.clear();
    isRolling = false;
    isPlanning = false;
    tableReplanPaused = false;
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
    // The host can hide and later reuse the overlay iframe before a scheduled
    // render has painted the empty scene. Clear the transparent backbuffer now
    // so the browser cannot composite the previous roll for a frame when the
    // iframe is shown again.
    if (OVERLAY_MODE) {
      canvas.style.visibility = 'hidden';
      renderer.clear(true, true, true);
    }
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
    const sides = maximumDieValue(requestedKind);
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
  getPhysicalSnapshot: () =>
    activePhysicalSpecs.map((spec, physicalIndex) => {
      const entry = physicalTable.entryAt(physicalIndex);
      const position = physicalTable.worldPosition(physicalIndex) ?? new THREE.Vector3();
      const visual = entry?.visual;
      const quaternion =
        entry?.die?.group.getWorldQuaternion(new THREE.Quaternion()) ??
        visual?.getWorldQuaternion(new THREE.Quaternion()) ??
        new THREE.Quaternion();
      const projected = position.clone().project(camera);
      const canvasBounds = canvas.getBoundingClientRect();
      const definitionTargeting =
        spec.definition?.targeting ?? (spec.canonicalKind ? 'symmetry' : 'relabel');
      return {
        id: spec.id,
        physicalIndex,
        sides: spec.sides,
        implementation: spec.definition
          ? ('custom' as const)
          : spec.canonicalKind
            ? ('canonical' as const)
            : ('generated' as const),
        targeting: definitionTargeting,
        requestedOutcomeIndex: spec.outcomeIndex,
        displayedOutcomeIndex: visual?.displayedOutcomeIndex ?? spec.outcomeIndex,
        landedOutcomeIndex:
          visual?.landedOutcomeIndex ?? activePlan?.landings[physicalIndex] ?? null,
        result: spec.result,
        visible: entry?.die?.group.visible ?? entry?.visual?.group.visible ?? false,
        position: { x: position.x, y: position.y, z: position.z },
        quaternion: {
          x: quaternion.x,
          y: quaternion.y,
          z: quaternion.z,
          w: quaternion.w,
        },
        screenPosition: {
          x: ((projected.x + 1) / 2) * canvasBounds.width,
          y: ((1 - projected.y) / 2) * canvasBounds.height,
        },
      };
    }),
  getPerformanceSnapshot: () => ({
    profile: performanceProfile,
    physicsPreset: activePhysicsPreset,
    pixelRatio: currentPixelRatio,
    dynamicResolutionScale,
    targetFramesPerSecond: targetFramesPerSecond(),
    renderLoopActive: animationFrameId !== null,
    queuedPresentations: rendererTaskQueue.length + (rendererTaskRunning ? 1 : 0),
    physicalDice: activePhysicalSpecs.length,
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
    void enqueueRendererTask((generation) => castDice(undefined, generation)).catch((error) =>
      console.error(error),
    );
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
let draggedDie: { entry: PhysicalTableEntry; pointerId: number; mass: number | null } | null = null;

function updateInteractionRay(event: PointerEvent): void {
  const bounds = canvas.getBoundingClientRect();
  interactionPointer.set(
    ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1,
    -((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1,
  );
  interactionRaycaster.setFromCamera(interactionPointer, camera);
}

function findInteractiveDie(event: PointerEvent): PhysicalTableEntry | null {
  updateInteractionRay(event);
  const roots = physicalTable.boundEntries().flatMap((entry) => {
    const root = entry.die?.group ?? entry.visual?.group;
    return root ? [root] : [];
  });
  const hit = interactionRaycaster.intersectObjects(roots, true)[0];
  return hit ? physicalTable.findByObject(hit.object) : null;
}

function beginDieDrag(event: PointerEvent): boolean {
  if (!interactionOptions.draggable || !hasCast || isRolling || isPlanning) return false;
  const entry = findInteractiveDie(event);
  if (!entry) return false;
  let mass: number | null = null;
  if (entry.die) {
    mass = entry.die.body.mass;
    entry.die.body.type = CANNON.Body.KINEMATIC;
    entry.die.body.mass = 0;
    entry.die.body.updateMassProperties();
    entry.die.body.velocity.setZero();
    entry.die.body.angularVelocity.setZero();
    entry.die.body.wakeUp();
  }
  draggedDie = { entry, pointerId: event.pointerId, mass };
  pointerStart = null;
  canvas.setPointerCapture(event.pointerId);
  return true;
}

function moveDraggedDie(event: PointerEvent): void {
  if (!draggedDie || draggedDie.pointerId !== event.pointerId) return;
  updateInteractionRay(event);
  if (!interactionRaycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
  const { entry } = draggedDie;
  const radius = entry.die?.getVisualRadius() ?? entry.visual?.getVisualRadius() ?? 0.7;
  const x = THREE.MathUtils.clamp(dragPoint.x, -visibleBounds.x + radius, visibleBounds.x - radius);
  const z = THREE.MathUtils.clamp(dragPoint.z, -visibleBounds.z + radius, visibleBounds.z - radius);
  const y = Math.max(0.72, radius * 0.72);
  if (entry.die) {
    entry.die.body.position.set(x, y, z);
    entry.die.body.velocity.setZero();
    entry.die.body.angularVelocity.setZero();
    entry.die.syncVisual();
  } else if (entry.visual) {
    entry.visual.moveTo(new THREE.Vector3(x, y, z));
  }
  requestRender();
}

function finishDieDrag(event: PointerEvent, cancelled = false): boolean {
  if (!draggedDie || draggedDie.pointerId !== event.pointerId) return false;
  const current = draggedDie;
  draggedDie = null;
  if (current.entry.die && current.mass !== null) {
    current.entry.die.body.type = CANNON.Body.DYNAMIC;
    current.entry.die.body.mass = current.mass;
    current.entry.die.body.updateMassProperties();
    current.entry.die.body.velocity.set(0, cancelled ? 0 : 0.08, 0);
    current.entry.die.body.wakeUp();
  }
  const position = physicalTable.worldPosition(current.entry.physicalIndex) ?? new THREE.Vector3();
  canvas.dispatchEvent(
    new CustomEvent('draftroll:die-interaction', {
      detail: {
        action: 'move',
        dieIndex: current.entry.physicalIndex,
        dieId: current.entry.dieId,
        position: { x: position.x, y: position.y, z: position.z },
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
    void enqueueRendererTask((generation) => castDice(swipe, generation)).catch((error) =>
      console.error(error),
    );
    return;
  }
  if (hasCast && interactionOptions.click !== 'none') {
    canvas.dispatchEvent(
      new CustomEvent('draftroll:die-interaction', {
        detail: {
          action: interactionOptions.click,
          results: lastReplay?.physical.map((visual) => visual.result) ?? [],
        },
        bubbles: true,
      }),
    );
    if (interactionOptions.click === 'reroll')
      void enqueueRendererTask((generation) => castDice(undefined, generation)).catch((error) =>
        console.error(error),
      );
    if (interactionOptions.click === 'drop')
      void dissolveDice({ durationMs: 180 }).catch(() => undefined);
    if (interactionOptions.click === 'explode')
      effects.playOutcome(selectedTheme, 'positive', new THREE.Vector3(0, 0.5, 0), {
        hero: true,
        kind: activeKinds[0] ?? selectedKind,
        value: lastReplay?.physical[0]?.numericValue ?? 1,
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
    updatePlanVisuals(activePlan, planTime);
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
      updatePlanVisuals(activePlan, planTime);
      physicalTable.forEachVisual((visual) => visual.settle());
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
