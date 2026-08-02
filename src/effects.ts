import * as THREE from 'three';
import type { DieKind } from './dice';
import { THEMES, type ThemeName } from './themes';

export type EffectOutcome = 'positive' | 'neutral' | 'negative' | 'none';
export type EffectPresetId =
  | 'dragon-awaken'
  | 'dragon-embers'
  | 'dragon-cinders'
  | 'void-rift'
  | 'stardust-orbit'
  | 'void-collapse'
  | 'phoenix-flare'
  | 'ember-drift'
  | 'ash-collapse'
  | 'ice-crown'
  | 'snow-orbit'
  | 'ice-shatter'
  | 'solar-ascension'
  | 'star-halo'
  | 'eclipse-collapse'
  | 'thunder-strike'
  | 'static-crown'
  | 'storm-fizzle'
  | 'soul-reaper'
  | 'grave-wisp'
  | 'soul-collapse'
  | 'verdant-bloom'
  | 'firefly-orbit'
  | 'thorn-bind'
  | 'major-burst'
  | 'subtle-pulse'
  | 'void-fracture'
  | 'ember-fracture'
  | 'frost-fracture'
  | 'none';

export type ThemeEffectSlots = Partial<Record<Exclude<EffectOutcome, 'none'>, EffectPresetId>>;

export interface OutcomeEffectOptions {
  kind: DieKind;
  value: number;
  hero?: boolean;
}

export interface EffectQualityConfig {
  particleScale?: number;
  motifScale?: number;
  lightningScale?: number;
  maxDynamicLights?: number;
}

interface ParticleBurst {
  /** Parameterized so the position attribute and material need no narrowing. */
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  life: number;
  duration: number;
  gravity: number;
}

interface AnimatedMesh {
  /** Parameterized so material properties need no narrowing at animation time. */
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  life: number;
  duration: number;
  startScale: number;
  endScale: number;
  spin: number;
}

interface AnimatedLine {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
    | THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  life: number;
  duration: number;
}

interface FlashLight {
  light: THREE.PointLight;
  life: number;
  duration: number;
  peak: number;
}

interface ScriptAnimation {
  root: THREE.Group;
  life: number;
  duration: number;
  update: (progress: number, dt: number) => void;
}

interface DragonAnimation {
  root: THREE.Group;
  life: number;
  duration: number;
  head: THREE.Object3D;
  leftWing: THREE.Object3D;
  rightWing: THREE.Object3D;
  wingMembraneLeft: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  wingMembraneRight: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  light: THREE.PointLight;
  fireOrigin: THREE.Object3D;
  fireDirection: THREE.Vector3;
  fireTimer: number;
  scale: number;
}

type MotifKind = 'orb' | 'shard' | 'leaf' | 'star' | 'bone';


interface ParticleBurstRequest {
  position: THREE.Vector3;
  color: number;
  count: number;
  duration: number;
  speed: number;
  gravity: number;
  size: number;
}

interface RingBatchRequest {
  position: THREE.Vector3;
  color: number;
  startScale: number;
  endScale: number;
  duration: number;
  spin: number;
}

interface MotifBatchRequest {
  position: THREE.Vector3;
  color: number;
  count: number;
  duration: number;
  motif: MotifKind;
  radiusStart: number;
  radiusEnd: number;
  speed: number;
}

interface LightBatchRequest {
  position: THREE.Vector3;
  color: number;
  peak: number;
  duration: number;
}

interface LightningBatchRequest {
  position: THREE.Vector3;
  color: number;
  count: number;
  duration: number;
}

interface AnimatedRingBatch {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  centers: Float32Array;
  life: number;
  duration: number;
  startScale: number;
  endScale: number;
  spin: number;
  rotation: number;
}

const runeTextureCache = new Map<string, THREE.CanvasTexture>();

function createRuneTexture(color: string): THREE.CanvasTexture {
  const cached = runeTextureCache.get(color);
  if (cached) return cached;
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  context.clearRect(0, 0, size, size);
  context.translate(size / 2, size / 2);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 18;
  context.lineWidth = 6;
  context.globalAlpha = 0.9;
  context.beginPath();
  context.arc(0, 0, 380, 0, Math.PI * 2);
  context.stroke();
  context.lineWidth = 2.5;
  context.globalAlpha = 0.35;
  context.beginPath();
  context.arc(0, 0, 326, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(0, 0, 250, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 0.74;
  context.lineWidth = 4;
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2;
    context.save();
    context.rotate(angle);
    context.translate(0, -353);
    context.beginPath();
    context.moveTo(-14, 18);
    context.lineTo(0, -22);
    context.lineTo(14, 18);
    context.moveTo(-9, 3);
    context.lineTo(9, 3);
    context.stroke();
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  runeTextureCache.set(color, texture);
  return texture;
}

function createRadialTexture(stops: Array<[number, string]>): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const gradient = context.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size * 0.49);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeWingGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.55, 0.16);
  shape.lineTo(1.25, 0.42);
  shape.lineTo(1.55, 0.08);
  shape.lineTo(1.7, -0.3);
  shape.lineTo(0.95, -0.18);
  shape.lineTo(0.42, -0.08);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function makeWingMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x5b1710,
    emissive: 0x220706,
    emissiveIntensity: 0.4,
    roughness: 0.86,
    metalness: 0.02,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
  });
}

function createDragonModel(color = 0x7d1a0d): Omit<DragonAnimation, 'life' | 'duration' | 'fireTimer' | 'scale'> {
  const root = new THREE.Group();
  const bodyCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.95, 0.12, 0.55),
    new THREE.Vector3(-0.55, 0.14, 0.2),
    new THREE.Vector3(-0.12, 0.16, 0.05),
    new THREE.Vector3(0.32, 0.22, -0.02),
    new THREE.Vector3(0.7, 0.26, -0.36),
  ]);
  const body = new THREE.Mesh(
    new THREE.TubeGeometry(bodyCurve, 48, 0.14, 10, false),
    new THREE.MeshStandardMaterial({ color, emissive: 0x2c0906, emissiveIntensity: 0.58, roughness: 0.72, metalness: 0.04 }),
  );
  body.castShadow = true;
  root.add(body);

  const belly = new THREE.Mesh(
    new THREE.TubeGeometry(bodyCurve, 24, 0.08, 8, false),
    new THREE.MeshStandardMaterial({ color: 0xb8652e, emissive: 0x65210c, emissiveIntensity: 0.24, roughness: 0.76, metalness: 0.03 }),
  );
  belly.scale.set(0.88, 0.86, 0.82);
  belly.position.y = -0.012;
  root.add(belly);

  const headPivot = new THREE.Group();
  headPivot.position.set(0.82, 0.29, -0.43);
  headPivot.rotation.z = -0.18;
  root.add(headPivot);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.38, 8), new THREE.MeshStandardMaterial({ color, emissive: 0x2c0906, emissiveIntensity: 0.58, roughness: 0.72, metalness: 0.04 }));
  neck.rotation.z = Math.PI / 2;
  neck.position.set(-0.12, -0.03, 0);
  headPivot.add(neck);

  const head = new THREE.Group();
  headPivot.add(head);
  const skull = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.56, 5), new THREE.MeshStandardMaterial({ color, emissive: 0x2c0906, emissiveIntensity: 0.75, roughness: 0.68, metalness: 0.05 }));
  skull.rotation.z = -Math.PI / 2;
  skull.position.set(0.12, 0.02, 0);
  head.add(skull);

  const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 4), new THREE.MeshStandardMaterial({ color: 0xd1925c, emissive: 0x6f2f0c, emissiveIntensity: 0.24, roughness: 0.76, metalness: 0.03 }));
  jaw.rotation.z = -Math.PI / 2;
  jaw.scale.set(1, 0.52, 1);
  jaw.position.set(0.18, -0.055, 0);
  head.add(jaw);

  const fireOrigin = new THREE.Object3D();
  fireOrigin.position.set(0.38, 0.02, 0);
  head.add(fireOrigin);

  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffd973, toneMapped: false });
  const eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), eyeMaterial);
  eyeLeft.position.set(0.14, 0.075, 0.085);
  head.add(eyeLeft);
  const eyeRight = eyeLeft.clone();
  eyeRight.position.z *= -1;
  head.add(eyeRight);

  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 6), new THREE.MeshStandardMaterial({ color: 0xdab17b, roughness: 0.5, metalness: 0.08 }));
    horn.position.set(0.02, 0.17, side * 0.12);
    horn.rotation.x = side * 0.28;
    horn.rotation.z = -0.35;
    head.add(horn);
  }

  const spikeMaterial = new THREE.MeshStandardMaterial({ color: 0xd58a36, emissive: 0x6a240b, emissiveIntensity: 0.4, roughness: 0.52, metalness: 0.06 });
  for (let i = 0; i < 7; i += 1) {
    const t = i / 6;
    const point = bodyCurve.getPoint(t);
    const tangent = bodyCurve.getTangent(t).normalize();
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04 + t * 0.015, 0.18 + t * 0.06, 5), spikeMaterial);
    spike.position.copy(point).add(new THREE.Vector3(0, 0.14 + t * 0.04, 0));
    spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent.clone().add(new THREE.Vector3(0, 0.9, 0)).normalize());
    root.add(spike);
  }

  const wingPivotLeft = new THREE.Group();
  wingPivotLeft.position.set(0.08, 0.25, 0.19);
  root.add(wingPivotLeft);
  const wingBoneLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.95, 5), new THREE.MeshStandardMaterial({ color: 0x83411f, roughness: 0.8 }));
  wingBoneLeft.rotation.z = -Math.PI / 2.55;
  wingBoneLeft.position.set(0.4, 0, 0.06);
  wingPivotLeft.add(wingBoneLeft);
  const wingMembraneLeft = new THREE.Mesh(makeWingGeometry(), makeWingMaterial());
  wingMembraneLeft.rotation.set(-Math.PI / 2, Math.PI / 2.8, 0);
  wingMembraneLeft.position.set(0.18, -0.04, 0.08);
  wingPivotLeft.add(wingMembraneLeft);

  const wingPivotRight = wingPivotLeft.clone(true);
  wingPivotRight.position.z = -0.19;
  wingPivotRight.scale.z = -1;
  root.add(wingPivotRight);
  const wingMembraneRight = wingPivotRight.children.find(
    (child): child is THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> =>
      child instanceof THREE.Mesh
      && child.geometry instanceof THREE.ShapeGeometry
      && child.material instanceof THREE.MeshStandardMaterial,
  ) ?? wingMembraneLeft.clone();

  const tailFin = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 4), new THREE.MeshStandardMaterial({ color: 0xd5933d, emissive: 0x73280c, emissiveIntensity: 0.25, roughness: 0.54 }));
  tailFin.position.set(-1.02, 0.11, 0.55);
  tailFin.rotation.z = Math.PI * 0.72;
  root.add(tailFin);

  const light = new THREE.PointLight(0xff7030, 0, 5, 2);
  light.position.set(0.42, 0.35, -0.2);
  root.add(light);
  root.scale.setScalar(0.01);
  root.rotation.y = Math.PI * 0.32;

  return { root, head: headPivot, leftWing: wingPivotLeft, rightWing: wingPivotRight, wingMembraneLeft, wingMembraneRight, light, fireOrigin, fireDirection: new THREE.Vector3(1, 0.03, -0.08).normalize() };
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function motifGeometry(kind: MotifKind): THREE.BufferGeometry {
  switch (kind) {
    case 'shard': return new THREE.OctahedronGeometry(0.07, 0);
    case 'leaf': return new THREE.SphereGeometry(0.055, 7, 5);
    case 'star': return new THREE.OctahedronGeometry(0.055, 0);
    case 'bone': return new THREE.CylinderGeometry(0.022, 0.028, 0.14, 5);
    case 'orb': return new THREE.SphereGeometry(0.04, 7, 6);
  }
}

export class DraftrollEffects {
  private readonly scene: THREE.Scene;
  private readonly bloom: { strength: number };
  private readonly flashElement: HTMLElement;
  private readonly bursts: ParticleBurst[] = [];
  private readonly meshes: AnimatedMesh[] = [];
  private readonly lines: AnimatedLine[] = [];
  private readonly lights: FlashLight[] = [];
  private readonly scripts: ScriptAnimation[] = [];
  private readonly dragons: DragonAnimation[] = [];
  private readonly ringBatches: AnimatedRingBatch[] = [];
  private batching = false;
  private readonly pendingParticles: ParticleBurstRequest[] = [];
  private readonly pendingRings: RingBatchRequest[] = [];
  private readonly pendingMotifs: MotifBatchRequest[] = [];
  private readonly pendingLights: LightBatchRequest[] = [];
  private readonly pendingLightning: LightningBatchRequest[] = [];
  private readonly fireTexture = createRadialTexture([
    [0, 'rgba(255,255,240,1)'],
    [0.26, 'rgba(255,220,120,1)'],
    [0.55, 'rgba(255,110,35,.95)'],
    [0.82, 'rgba(185,28,16,.55)'],
    [1, 'rgba(185,28,16,0)'],
  ]);
  private readonly softTexture = createRadialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.35, 'rgba(255,255,255,.72)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  private readonly themeEffects: Record<ThemeName, Required<ThemeEffectSlots>> = {
    dragon: { positive: 'dragon-awaken', neutral: 'dragon-embers', negative: 'dragon-cinders' },
    nebula: { positive: 'void-rift', neutral: 'stardust-orbit', negative: 'void-collapse' },
    ember: { positive: 'phoenix-flare', neutral: 'ember-drift', negative: 'ash-collapse' },
    frost: { positive: 'ice-crown', neutral: 'snow-orbit', negative: 'ice-shatter' },
    celestial: { positive: 'solar-ascension', neutral: 'star-halo', negative: 'eclipse-collapse' },
    tempest: { positive: 'thunder-strike', neutral: 'static-crown', negative: 'storm-fizzle' },
    necrotic: { positive: 'soul-reaper', neutral: 'grave-wisp', negative: 'soul-collapse' },
    wildwood: { positive: 'verdant-bloom', neutral: 'firefly-orbit', negative: 'thorn-bind' },
  };
  private shakeTime = 0;
  private shakeDuration = 0;
  private shakePower = 0;
  private bloomBase = 0.18;
  private bloomKick = 0;
  private readonly cameraOffset = { position: new THREE.Vector3(), roll: 0 };
  private readonly batchDummy = new THREE.Object3D();
  private pendingFlash: 'success' | 'failure' | 'mixed' | null = null;
  private particleScale = 1;
  private motifScale = 1;
  private lightningScale = 1;
  private maxDynamicLights = 8;

  constructor(scene: THREE.Scene, bloom: { strength: number }, flashElement: HTMLElement) {
    this.scene = scene;
    this.bloom = bloom;
    this.flashElement = flashElement;
  }

  setBloomBase(value: number): void {
    this.bloomBase = value;
  }

  configureThemeEffects(theme: ThemeName, slots: ThemeEffectSlots): void {
    this.themeEffects[theme] = { ...this.themeEffects[theme], ...slots };
  }

  setQuality(config: EffectQualityConfig): void {
    if (config.particleScale !== undefined) this.particleScale = THREE.MathUtils.clamp(config.particleScale, 0.2, 1);
    if (config.motifScale !== undefined) this.motifScale = THREE.MathUtils.clamp(config.motifScale, 0.25, 1);
    if (config.lightningScale !== undefined) this.lightningScale = THREE.MathUtils.clamp(config.lightningScale, 0.25, 1);
    if (config.maxDynamicLights !== undefined) this.maxDynamicLights = THREE.MathUtils.clamp(Math.round(config.maxDynamicLights), 0, 12);
  }


  beginBatch(): void {
    this.batching = true;
  }

  endBatch(): void {
    if (!this.batching) return;
    this.batching = false;
    this.flushParticleBatches();
    this.flushRingBatches();
    this.flushMotifBatches();
    this.flushLightBatches();
    this.flushLightningBatches();
    if (this.pendingFlash) {
      this.applyFlash(this.pendingFlash);
      this.pendingFlash = null;
    }
  }

  impact(position: THREE.Vector3, color: number, strength: number): void {
    if (strength < 3.2) return;
    this.createParticleBurst(position.clone().setY(0.08), color, Math.min(12, 3 + Math.floor(strength)), 0.35, 1.2, 1.1, 0.045);
  }

  playOutcome(theme: ThemeName, outcome: EffectOutcome, position: THREE.Vector3, options: OutcomeEffectOptions): void {
    if (outcome === 'none') return;
    const preset = this.themeEffects[theme][outcome];
    const color = THEMES[theme].particle;
    switch (preset) {
      case 'dragon-awaken': this.dragonAwaken(position, options); break;
      case 'dragon-embers': this.dragonEmbers(position); break;
      case 'dragon-cinders': this.dragonCinders(position); break;
      case 'void-rift': this.voidRift(position, options.hero !== false); break;
      case 'stardust-orbit': this.stardustOrbit(position); break;
      case 'void-collapse': this.voidCollapse(position); break;
      case 'phoenix-flare': this.phoenixFlare(position, options.hero !== false); break;
      case 'ember-drift': this.emberDrift(position); break;
      case 'ash-collapse': this.ashCollapse(position); break;
      case 'ice-crown': this.iceCrown(position, options.hero !== false); break;
      case 'snow-orbit': this.snowOrbit(position); break;
      case 'ice-shatter': this.iceShatter(position); break;
      case 'solar-ascension': this.solarAscension(position, options.hero !== false); break;
      case 'star-halo': this.starHalo(position); break;
      case 'eclipse-collapse': this.eclipseCollapse(position); break;
      case 'thunder-strike': this.thunderStrike(position, options.hero !== false); break;
      case 'static-crown': this.staticCrown(position); break;
      case 'storm-fizzle': this.stormFizzle(position); break;
      case 'soul-reaper': this.soulReaper(position, options.hero !== false); break;
      case 'grave-wisp': this.graveWisp(position); break;
      case 'soul-collapse': this.soulCollapse(position); break;
      case 'verdant-bloom': this.verdantBloom(position, options.hero !== false); break;
      case 'firefly-orbit': this.fireflyOrbit(position); break;
      case 'thorn-bind': this.thornBind(position); break;
      case 'major-burst': this.majorBurst(position, color, options.hero !== false); break;
      case 'subtle-pulse': this.subtlePulse(position, color); break;
      case 'frost-fracture': this.failureTinted(position, 0x64cfff, 0x123d6b); break;
      case 'ember-fracture': this.failureTinted(position, 0xff4b25, 0x5c0a05); break;
      case 'void-fracture': this.failureTinted(position, 0xbb68ff, 0x1c062e); break;
      case 'none': break;
    }
  }

  private dragonAwaken(position: THREE.Vector3, options: OutcomeEffectOptions): void {
    this.triggerFlash('success');
    this.createRune(position, 0xff9e48, 3.9, 1.7, 0.48);
    this.createRing(position, 0xff7b2c, 0.26, 4.8, 1.35, 0.18);
    this.createRing(position, 0xffc36f, 0.55, 3.8, 1.6, -0.1);
    this.createParticleBurst(position.clone().add(new THREE.Vector3(0, 0.22, 0)), 0xffa34f, 150, 1.8, 5.4, 1.6, 0.075);
    if (options.kind === 'd20' && options.hero !== false) this.spawnDragon(position.clone());
    else this.createSpikeCrown(position, 0xff9c45, 12, 1.45, 0.75, 1.15);
    this.createLight(position, 0xff7a2d, 7, 1.4);
    this.shake(1.0, 0.2);
    this.bloomKick = Math.max(this.bloomKick, 0.62);
  }

  private dragonEmbers(position: THREE.Vector3): void {
    this.createOrbitingMotifs(position, 0xff9a45, 14, 0.88, 'orb', 0.6, 1.25, 1.8);
    this.createParticleBurst(position.clone().add(new THREE.Vector3(0, 0.12, 0)), 0xff8b36, 22, 0.82, 1.45, 0.7, 0.045);
    this.createRing(position, 0xffad58, 0.3, 1.5, 0.72);
  }

  private dragonCinders(position: THREE.Vector3): void {
    this.triggerFlash('failure');
    this.createRing(position, 0x8b170c, 0.35, 3.4, 1.05, -0.2);
    this.createParticleBurst(position.clone().setY(0.18), 0xff4a22, 76, 1.2, 3.2, 4.7, 0.06);
    this.createOrbitingMotifs(position, 0x5b0905, 18, 1.15, 'shard', 1.7, 0.42, -2.2);
    this.createLight(position, 0xff321b, 4.2, 0.72);
    this.shake(0.5, 0.1);
  }

  private voidRift(position: THREE.Vector3, hero: boolean): void {
    this.triggerFlash('success');
    this.createDarkDisk(position, 0x05020b, 1.7, hero ? 1.65 : 1.15, false);
    this.createRing(position, 0xd8b6ff, 0.22, hero ? 4.6 : 3.2, 1.35, 1.4);
    this.createRing(position, 0x5dc6ff, 0.5, hero ? 3.5 : 2.5, 1.55, -1.2);
    this.createOrbitingMotifs(position, 0xe5c8ff, hero ? 38 : 24, 1.75, 'star', 0.7, hero ? 2.5 : 1.8, 4.6);
    this.createParticleBurst(position.clone().setY(0.25), 0xb066ff, hero ? 112 : 68, 1.55, 4.2, 0.2, 0.058);
    this.createLight(position, 0x7f39ff, 5.5, 1.25);
    this.shake(0.72, 0.13);
    this.bloomKick = Math.max(this.bloomKick, 0.52);
  }

  private stardustOrbit(position: THREE.Vector3): void {
    this.createOrbitingMotifs(position, 0xdac2ff, 18, 1.0, 'star', 0.52, 1.25, 3.2);
    this.createRing(position, 0xa36bff, 0.2, 1.65, 0.85, 0.8);
    this.createLight(position, 0x8a52e8, 1.3, 0.5);
  }

  private voidCollapse(position: THREE.Vector3): void {
    this.triggerFlash('failure');
    this.createDarkDisk(position, 0x020005, 1.45, 1.25, true);
    this.createOrbitingMotifs(position, 0xb86cff, 30, 1.35, 'shard', 2.25, 0.08, 6.0);
    this.createRing(position, 0x8c3fe0, 2.3, 0.18, 1.2, -2.2);
    this.createParticleBurst(position.clone().setY(0.1), 0x5e1f8f, 58, 0.95, 1.4, 4.2, 0.05);
    this.createLight(position, 0x6d21c7, 4.2, 0.75);
    this.shake(0.66, 0.14);
  }

  private phoenixFlare(position: THREE.Vector3, hero: boolean): void {
    this.triggerFlash('success');
    this.createRune(position, 0xffbd62, hero ? 3.4 : 2.5, 1.4, 0.35);
    this.createRing(position, 0xff7a28, 0.28, hero ? 4.3 : 3.0, 1.1);
    this.createFlameWings(position, hero ? 1.8 : 1.25);
    this.createParticleBurst(position.clone().setY(0.2), 0xffa23e, hero ? 145 : 82, 1.55, 5.6, 1.1, 0.075);
    this.createParticleBurst(position.clone().setY(0.25), 0xffe08c, hero ? 70 : 36, 1.1, 4.3, 0.4, 0.055);
    this.createLight(position, 0xff6a1e, 6.8, 1.15);
    this.shake(0.72, 0.15);
    this.bloomKick = Math.max(this.bloomKick, 0.58);
  }

  private emberDrift(position: THREE.Vector3): void {
    this.createParticleBurst(position.clone().setY(0.16), 0xffa454, 30, 0.92, 1.65, 0.6, 0.05);
    this.createOrbitingMotifs(position, 0xffc16b, 12, 0.82, 'orb', 0.45, 1.1, 2.4);
    this.createRing(position, 0xff8d3d, 0.22, 1.5, 0.72);
  }

  private ashCollapse(position: THREE.Vector3): void {
    this.triggerFlash('failure');
    this.createRing(position, 0x7c1b10, 2.2, 0.28, 1.1, -0.5);
    this.createOrbitingMotifs(position, 0x44201b, 26, 1.2, 'shard', 1.9, 0.25, -3.5);
    this.createParticleBurst(position.clone().setY(0.15), 0x7e2d20, 84, 1.28, 2.4, 5.2, 0.055);
    this.createLight(position, 0xff4b25, 3.4, 0.62);
    this.shake(0.48, 0.09);
  }

  private iceCrown(position: THREE.Vector3, hero: boolean): void {
    this.triggerFlash('success');
    this.createRing(position, 0xb9f7ff, 0.24, hero ? 4.2 : 3.0, 1.25, 0.18);
    this.createSpikeCrown(position, 0x9beaff, hero ? 18 : 12, 1.65, hero ? 1.18 : 0.82, hero ? 1.8 : 1.3);
    this.createOrbitingMotifs(position, 0xe6fdff, hero ? 34 : 20, 1.55, 'shard', 0.6, hero ? 2.0 : 1.5, 2.4);
    this.createParticleBurst(position.clone().setY(0.18), 0x9defff, hero ? 92 : 56, 1.4, 3.8, 2.8, 0.055);
    this.createLight(position, 0x77ddff, 5.5, 1.1);
    this.shake(0.62, 0.12);
    this.bloomKick = Math.max(this.bloomKick, 0.46);
  }

  private snowOrbit(position: THREE.Vector3): void {
    this.createOrbitingMotifs(position, 0xe9fdff, 20, 1.05, 'shard', 0.5, 1.25, 2.7);
    this.createParticleBurst(position.clone().setY(0.12), 0xc9f8ff, 24, 0.95, 1.2, 0.25, 0.04);
    this.createRing(position, 0x7edfff, 0.2, 1.5, 0.8);
  }

  private iceShatter(position: THREE.Vector3): void {
    this.triggerFlash('failure');
    this.createSpikeCrown(position, 0x68d9ff, 12, 0.92, 0.72, 1.15, true);
    this.createParticleBurst(position.clone().setY(0.18), 0x8ce9ff, 96, 1.05, 4.7, 5.3, 0.055);
    this.createLightning(position, 0xb8f5ff, 7, 0.65);
    this.createRing(position, 0x3b9aca, 0.2, 3.5, 0.9);
    this.createLight(position, 0x64cfff, 4.5, 0.7);
    this.shake(0.58, 0.13);
  }

  private solarAscension(position: THREE.Vector3, hero: boolean): void {
    this.triggerFlash('success');
    this.createRune(position, 0xffd978, hero ? 3.7 : 2.7, 1.55, 0.28);
    this.createHaloBeams(position, 0xffe39a, hero ? 18 : 12, 1.5, hero ? 2.4 : 1.7);
    this.createOrbitingMotifs(position, 0xfff1bd, hero ? 28 : 18, 1.5, 'star', 0.65, hero ? 2.1 : 1.55, 2.2);
    this.createRing(position, 0xffd15b, 0.35, hero ? 4.5 : 3.2, 1.28, 0.42);
    this.createLight(position, 0xffc74e, 7.5, 1.25);
    this.shake(0.55, 0.09);
    this.bloomKick = Math.max(this.bloomKick, 0.6);
  }

  private starHalo(position: THREE.Vector3): void {
    this.createOrbitingMotifs(position, 0xffe9a4, 16, 1.0, 'star', 0.65, 1.18, 1.8);
    this.createRing(position, 0xffd978, 0.32, 1.55, 0.8, 0.3);
    this.createLight(position, 0xffd06b, 1.5, 0.52);
  }

  private eclipseCollapse(position: THREE.Vector3): void {
    this.triggerFlash('failure');
    this.createDarkDisk(position, 0x090806, 1.5, 1.28, true);
    this.createRing(position, 0xffc64f, 2.0, 0.38, 1.15, -0.8);
    this.createOrbitingMotifs(position, 0x7d6842, 20, 1.1, 'star', 1.9, 0.32, -2.4);
    this.createParticleBurst(position.clone().setY(0.12), 0x7e6334, 58, 1.05, 2.2, 4.8, 0.045);
    this.createLight(position, 0xb77b22, 3.2, 0.65);
    this.shake(0.46, 0.08);
  }

  private thunderStrike(position: THREE.Vector3, hero: boolean): void {
    this.triggerFlash('success');
    this.createStormStrike(position, hero ? 14 : 9, hero ? 1.35 : 0.95);
    this.createRing(position, 0xaeeeff, 0.18, hero ? 5.0 : 3.4, 0.92, 0.1);
    this.createRing(position, 0x4cc8ff, 0.4, hero ? 3.7 : 2.6, 1.2, -0.2);
    this.createParticleBurst(position.clone().setY(0.18), 0x7edcff, hero ? 120 : 72, 1.12, 5.2, 3.4, 0.058);
    this.createLight(position, 0x72d8ff, 9.5, 0.72);
    this.shake(0.82, 0.22);
    this.bloomKick = Math.max(this.bloomKick, 0.68);
  }

  private staticCrown(position: THREE.Vector3): void {
    this.createLightning(position, 0x72d8ff, 5, 0.55);
    this.createOrbitingMotifs(position, 0xb7f2ff, 14, 0.78, 'orb', 0.5, 1.2, 4.2);
    this.createRing(position, 0x59cbff, 0.2, 1.6, 0.68);
  }

  private stormFizzle(position: THREE.Vector3): void {
    this.triggerFlash('failure');
    this.createLightning(position, 0x426c82, 9, 0.92);
    this.createOrbitingMotifs(position, 0x5b8295, 24, 1.05, 'shard', 1.75, 0.3, -5.2);
    this.createRing(position, 0x456a7a, 2.1, 0.25, 1.0, -1.4);
    this.createParticleBurst(position.clone().setY(0.12), 0x4d7b90, 54, 0.9, 2.4, 4.5, 0.04);
    this.shake(0.48, 0.1);
  }

  private soulReaper(position: THREE.Vector3, hero: boolean): void {
    this.triggerFlash('success');
    this.createRune(position, 0x98ec65, hero ? 3.5 : 2.6, 1.55, -0.42);
    this.createWraith(position, hero ? 1.55 : 1.1);
    this.createOrbitingMotifs(position, 0xb1ff7b, hero ? 28 : 18, 1.65, 'bone', 0.55, hero ? 2.0 : 1.45, 3.0);
    this.createParticleBurst(position.clone().setY(0.22), 0x8ee85c, hero ? 100 : 62, 1.45, 3.6, 0.8, 0.055);
    this.createRing(position, 0x6fc844, 0.3, hero ? 4.1 : 3.0, 1.24, -0.7);
    this.createLight(position, 0x72d94a, 5.5, 1.1);
    this.shake(0.7, 0.13);
    this.bloomKick = Math.max(this.bloomKick, 0.48);
  }

  private graveWisp(position: THREE.Vector3): void {
    this.createOrbitingMotifs(position, 0x9ae96b, 14, 1.0, 'orb', 0.48, 1.12, 2.0);
    this.createParticleBurst(position.clone().setY(0.12), 0x80ca56, 20, 1.0, 1.0, -0.15, 0.047);
    this.createRing(position, 0x5f9d3e, 0.2, 1.4, 0.8, -0.25);
  }

  private soulCollapse(position: THREE.Vector3): void {
    this.triggerFlash('failure');
    this.createDarkDisk(position, 0x050805, 1.3, 1.05, true);
    this.createOrbitingMotifs(position, 0x8ee85c, 28, 1.28, 'orb', 2.0, 0.08, 5.5);
    this.createRing(position, 0x4d842f, 2.2, 0.22, 1.08, -1.2);
    this.createParticleBurst(position.clone().setY(0.1), 0x425b35, 62, 1.1, 1.8, 5.0, 0.045);
    this.createLight(position, 0x63ba38, 3.8, 0.65);
    this.shake(0.55, 0.11);
  }

  private verdantBloom(position: THREE.Vector3, hero: boolean): void {
    this.triggerFlash('success');
    this.createRune(position, 0xb7f57c, hero ? 3.5 : 2.6, 1.55, 0.22);
    this.createLeafBloom(position, hero ? 32 : 20, hero ? 1.65 : 1.2);
    this.createOrbitingMotifs(position, 0xd5ff9c, hero ? 24 : 16, 1.5, 'leaf', 0.45, hero ? 2.0 : 1.45, 1.8);
    this.createRing(position, 0x99d968, 0.25, hero ? 4.0 : 2.9, 1.2, 0.4);
    this.createParticleBurst(position.clone().setY(0.14), 0xb7f57c, hero ? 76 : 48, 1.3, 3.0, 1.4, 0.048);
    this.createLight(position, 0x8cd557, 4.5, 1.0);
    this.shake(0.52, 0.08);
    this.bloomKick = Math.max(this.bloomKick, 0.36);
  }

  private fireflyOrbit(position: THREE.Vector3): void {
    this.createOrbitingMotifs(position, 0xc8ff82, 18, 1.05, 'orb', 0.45, 1.2, 1.55);
    this.createRing(position, 0x77b84d, 0.2, 1.45, 0.8, 0.2);
    this.createLight(position, 0x9edb62, 1.2, 0.5);
  }

  private thornBind(position: THREE.Vector3): void {
    this.triggerFlash('failure');
    this.createThornCage(position, 14, 1.22);
    this.createRing(position, 0x355f2a, 2.0, 0.38, 1.1, -0.5);
    this.createParticleBurst(position.clone().setY(0.14), 0x6f9f4a, 62, 1.05, 2.8, 4.5, 0.045);
    this.createLight(position, 0x5a8f3d, 3.1, 0.64);
    this.shake(0.48, 0.09);
  }

  private majorBurst(position: THREE.Vector3, color: number, major: boolean): void {
    this.triggerFlash('success');
    this.createRune(position, color, major ? 3.2 : 2.2, major ? 1.45 : 1.0);
    this.createRing(position, color, 0.25, major ? 4.4 : 2.9, major ? 1.1 : 0.8);
    this.createParticleBurst(position.clone().add(new THREE.Vector3(0, 0.32, 0)), color, major ? 110 : 58, major ? 1.45 : 1.0, major ? 4.8 : 3.2, 2.1, major ? 0.06 : 0.05);
    this.createLight(position, color, major ? 7 : 3.8, major ? 1.0 : 0.7);
    this.shake(major ? 0.62 : 0.32, major ? 0.14 : 0.07);
    this.bloomKick = Math.max(this.bloomKick, major ? 0.55 : 0.28);
  }

  private subtlePulse(position: THREE.Vector3, color: number): void {
    this.createRing(position, color, 0.22, 1.8, 0.72);
    this.createParticleBurst(position.clone().add(new THREE.Vector3(0, 0.16, 0)), color, 24, 0.7, 1.65, 1.6, 0.042);
    this.createLight(position, color, 1.5, 0.42);
    this.bloomKick = Math.max(this.bloomKick, 0.08);
  }

  private failureTinted(position: THREE.Vector3, primary: number, secondary: number): void {
    this.triggerFlash('failure');
    this.createRune(position, primary, 2.45, 1.08, -0.8);
    this.createRing(position, primary, 0.18, 3.2, 0.9);
    this.createRing(position, secondary, 0.4, 4.0, 1.15, -0.1);
    this.createParticleBurst(position.clone().add(new THREE.Vector3(0, 0.18, 0)), primary, 68, 1.05, 3.4, 3.8, 0.052);
    this.createLight(position, primary, 4.2, 0.78);
    this.shake(0.52, 0.12);
  }

  private triggerFlash(className: 'success' | 'failure'): void {
    if (this.batching) {
      if (this.pendingFlash && this.pendingFlash !== className) this.pendingFlash = 'mixed';
      else if (!this.pendingFlash) this.pendingFlash = className;
      return;
    }
    this.applyFlash(className);
  }

  private applyFlash(className: 'success' | 'failure' | 'mixed'): void {
    this.flashElement.classList.remove('success', 'failure', 'mixed');
    void this.flashElement.offsetWidth;
    this.flashElement.classList.add(className);
  }

  private shake(duration: number, power: number): void {
    this.shakeDuration = duration;
    this.shakeTime = duration;
    this.shakePower = Math.max(this.shakePower, power);
  }

  getCameraOffset(): { position: THREE.Vector3; roll: number } {
    if (this.shakeTime <= 0 || this.shakeDuration <= 0) {
      this.cameraOffset.position.set(0, 0, 0);
      this.cameraOffset.roll = 0;
      return this.cameraOffset;
    }
    const envelope = this.shakeTime / this.shakeDuration;
    const power = this.shakePower * envelope * envelope;
    this.cameraOffset.position.set((Math.random() - 0.5) * power, (Math.random() - 0.5) * power * 0.65, (Math.random() - 0.5) * power);
    this.cameraOffset.roll = (Math.random() - 0.5) * power * 0.06;
    return this.cameraOffset;
  }

  private flushParticleBatches(): void {
    const groups = new Map<string, ParticleBurstRequest[]>();
    for (const request of this.pendingParticles) {
      const key = `${request.color}:${request.duration}:${request.speed}:${request.gravity}:${request.size}`;
      const group = groups.get(key);
      if (group) group.push(request); else groups.set(key, [request]);
    }
    this.pendingParticles.length = 0;
    groups.forEach((requests) => this.spawnParticleBurstBatch(requests));
  }

  private flushRingBatches(): void {
    const groups = new Map<string, RingBatchRequest[]>();
    for (const request of this.pendingRings) {
      const key = `${request.color}:${request.startScale}:${request.endScale}:${request.duration}:${request.spin}`;
      const group = groups.get(key);
      if (group) group.push(request); else groups.set(key, [request]);
    }
    this.pendingRings.length = 0;
    groups.forEach((requests) => this.spawnRingBatch(requests));
  }

  private flushMotifBatches(): void {
    const groups = new Map<string, MotifBatchRequest[]>();
    for (const request of this.pendingMotifs) {
      const key = `${request.color}:${request.count}:${request.duration}:${request.motif}:${request.radiusStart}:${request.radiusEnd}:${request.speed}`;
      const group = groups.get(key);
      if (group) group.push(request); else groups.set(key, [request]);
    }
    this.pendingMotifs.length = 0;
    groups.forEach((requests) => this.spawnOrbitingMotifBatch(requests));
  }

  private flushLightBatches(): void {
    const groups = new Map<string, LightBatchRequest[]>();
    for (const request of this.pendingLights) {
      const key = `${request.color}:${request.peak}:${request.duration}`;
      const group = groups.get(key);
      if (group) group.push(request); else groups.set(key, [request]);
    }
    this.pendingLights.length = 0;
    groups.forEach((requests) => {
      const chunkSize = 5;
      for (let start = 0; start < requests.length; start += chunkSize) {
        const chunk = requests.slice(start, start + chunkSize);
        const position = chunk.reduce((sum, request) => sum.add(request.position), new THREE.Vector3()).multiplyScalar(1 / chunk.length);
        const first = chunk[0];
        this.spawnLight(position, first.color, first.peak * Math.min(1.85, Math.sqrt(chunk.length)), first.duration);
      }
    });
  }

  private flushLightningBatches(): void {
    const groups = new Map<string, LightningBatchRequest[]>();
    for (const request of this.pendingLightning) {
      const key = `${request.color}:${request.duration}`;
      const group = groups.get(key);
      if (group) group.push(request); else groups.set(key, [request]);
    }
    this.pendingLightning.length = 0;
    groups.forEach((requests) => this.spawnLightningBatch(requests));
  }

  private createParticleBurst(position: THREE.Vector3, color: number, count: number, duration: number, speed: number, gravity: number, size: number): void {
    const scaledCount = Math.max(count >= 20 ? 4 : 1, Math.round(count * this.particleScale));
    const request: ParticleBurstRequest = { position: position.clone(), color, count: scaledCount, duration, speed, gravity, size };
    if (this.batching) {
      this.pendingParticles.push(request);
      return;
    }
    this.spawnParticleBurstBatch([request]);
  }

  private spawnParticleBurstBatch(requests: ParticleBurstRequest[]): void {
    const count = requests.reduce((sum, request) => sum + request.count, 0);
    if (count <= 0) return;
    const first = requests[0];
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    let particleIndex = 0;
    for (const request of requests) {
      for (let i = 0; i < request.count; i += 1) {
        const index = particleIndex * 3;
        positions[index] = request.position.x + (Math.random() - 0.5) * 0.18;
        positions[index + 1] = request.position.y + Math.random() * 0.18;
        positions[index + 2] = request.position.z + (Math.random() - 0.5) * 0.18;
        const angle = Math.random() * Math.PI * 2;
        const horizontal = request.speed * (0.25 + Math.random() * 0.75);
        velocities[index] = Math.cos(angle) * horizontal;
        velocities[index + 1] = request.speed * (0.38 + Math.random() * 0.95);
        velocities[index + 2] = Math.sin(angle) * horizontal;
        particleIndex += 1;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: first.color, size: first.size, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, map: this.softTexture, alphaTest: 0.01 });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 10;
    this.scene.add(points);
    this.bursts.push({ points, velocities, life: first.duration, duration: first.duration, gravity: first.gravity });
  }

  private createDirectionalBurst(position: THREE.Vector3, direction: THREE.Vector3, color: number, count: number, duration: number, speed: number): void {
    count = Math.max(4, Math.round(count * this.particleScale));
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const basis = direction.clone().normalize();
    const side = new THREE.Vector3(-basis.z, 0, basis.x).normalize();
    for (let i = 0; i < count; i += 1) {
      const index = i * 3;
      const spreadA = (Math.random() - 0.5) * 0.28;
      const spreadB = (Math.random() - 0.5) * 0.2;
      const spawn = position.clone().addScaledVector(side, spreadA * 0.35).add(new THREE.Vector3(0, spreadB * 0.2, 0));
      positions[index] = spawn.x;
      positions[index + 1] = spawn.y;
      positions[index + 2] = spawn.z;
      const v = basis.clone().multiplyScalar(speed * (0.7 + Math.random() * 0.55));
      v.addScaledVector(side, spreadA * speed * 0.55);
      v.y += 0.5 + Math.random() * 0.45;
      velocities[index] = v.x;
      velocities[index + 1] = v.y;
      velocities[index + 2] = v.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color, size: 0.11, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, map: this.fireTexture, alphaTest: 0.01 });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 11;
    this.scene.add(points);
    this.bursts.push({ points, velocities, life: duration, duration, gravity: 1.4 });
  }

  private createRing(position: THREE.Vector3, color: number, startScale: number, endScale: number, duration: number, spin = 0.1): void {
    const request: RingBatchRequest = { position: position.clone().setY(0.035), color, startScale, endScale, duration, spin };
    if (this.batching) {
      this.pendingRings.push(request);
      return;
    }
    const geometry = new THREE.RingGeometry(0.78, 0.84, 72);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(request.position);
    mesh.scale.setScalar(startScale);
    mesh.renderOrder = 8;
    this.scene.add(mesh);
    this.meshes.push({ mesh, life: duration, duration, startScale, endScale, spin });
  }

  private spawnRingBatch(requests: RingBatchRequest[]): void {
    if (requests.length === 0) return;
    const first = requests[0];
    const geometry = new THREE.RingGeometry(0.78, 0.84, 72);
    const material = new THREE.MeshBasicMaterial({ color: first.color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geometry, material, requests.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.renderOrder = 8;
    const centers = new Float32Array(requests.length * 3);
    requests.forEach((request, index) => {
      centers[index * 3] = request.position.x;
      centers[index * 3 + 1] = request.position.y;
      centers[index * 3 + 2] = request.position.z;
    });
    this.scene.add(mesh);
    this.ringBatches.push({ mesh, centers, life: first.duration, duration: first.duration, startScale: first.startScale, endScale: first.endScale, spin: first.spin, rotation: 0 });
  }

  private createRune(position: THREE.Vector3, color: number, endScale: number, duration: number, spin = 0.65): void {
    const texture = createRuneTexture(`#${color.toString(16).padStart(6, '0')}`);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.position.copy(position).setY(0.045);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(0.2);
    mesh.renderOrder = 7;
    this.scene.add(mesh);
    this.meshes.push({ mesh, life: duration, duration, startScale: 0.2, endScale, spin });
  }

  private createLightning(position: THREE.Vector3, color: number, count: number, duration: number): void {
    const scaledCount = Math.max(1, Math.round(count * this.lightningScale));
    const request: LightningBatchRequest = { position: position.clone(), color, count: scaledCount, duration };
    if (this.batching) {
      this.pendingLightning.push(request);
      return;
    }
    this.spawnLightningBatch([request]);
  }

  private spawnLightningBatch(requests: LightningBatchRequest[]): void {
    if (requests.length === 0) return;
    const first = requests[0];
    const positions: number[] = [];
    for (const request of requests) {
      for (let i = 0; i < request.count; i += 1) {
        const angle = (i / request.count) * Math.PI * 2 + Math.random() * 0.5;
        const distance = 1.2 + Math.random() * 2.1;
        const segments = 7;
        let previous = request.position.clone().setY(0.07);
        for (let j = 1; j <= segments; j += 1) {
          const t = j / segments;
          const spread = Math.sin(t * Math.PI) * 0.24;
          const next = new THREE.Vector3(
            request.position.x + Math.cos(angle) * distance * t + (Math.random() - 0.5) * spread,
            0.07 + Math.sin(t * Math.PI) * (0.08 + Math.random() * 0.12),
            request.position.z + Math.sin(angle) * distance * t + (Math.random() - 0.5) * spread,
          );
          positions.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
          previous = next;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: first.color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, toneMapped: false });
    const line = new THREE.LineSegments(geometry, material);
    line.renderOrder = 9;
    this.scene.add(line);
    this.lines.push({ line, life: first.duration, duration: first.duration });
  }

  private createLight(position: THREE.Vector3, color: number, peak: number, duration: number): void {
    const request: LightBatchRequest = { position: position.clone().setY(0.45), color, peak, duration };
    if (this.batching) {
      this.pendingLights.push(request);
      return;
    }
    this.spawnLight(request.position, color, peak, duration);
  }

  private spawnLight(position: THREE.Vector3, color: number, peak: number, duration: number): void {
    if (this.maxDynamicLights <= 0 || this.lights.length >= this.maxDynamicLights) return;
    const light = new THREE.PointLight(color, peak, 8, 2);
    light.position.copy(position);
    this.scene.add(light);
    this.lights.push({ light, life: duration, duration, peak });
  }

  private addScript(root: THREE.Group, duration: number, update: ScriptAnimation['update']): void {
    this.scene.add(root);
    this.scripts.push({ root, life: duration, duration, update });
  }

  private createOrbitingMotifs(position: THREE.Vector3, color: number, count: number, duration: number, motif: MotifKind, radiusStart: number, radiusEnd: number, speed: number): void {
    const scaledCount = Math.max(3, Math.round(count * this.motifScale));
    const request: MotifBatchRequest = { position: position.clone().setY(0.08), color, count: scaledCount, duration, motif, radiusStart, radiusEnd, speed };
    if (this.batching) {
      this.pendingMotifs.push(request);
      return;
    }
    this.spawnOrbitingMotifBatch([request]);
  }

  private spawnOrbitingMotifBatch(requests: MotifBatchRequest[]): void {
    if (requests.length === 0) return;
    const first = requests[0];
    const root = new THREE.Group();
    const geometry = motifGeometry(first.motif);
    const additive = first.motif !== 'leaf' && first.motif !== 'bone';
    const material = new THREE.MeshBasicMaterial({ color: first.color, transparent: true, opacity: 0.9, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !additive });
    const totalCount = requests.reduce((sum, request) => sum + request.count, 0);
    const mesh = new THREE.InstancedMesh(geometry, material, totalCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(mesh);

    const centers = new Float32Array(totalCount * 3);
    const angles = new Float32Array(totalCount);
    const radiusNoise = new Float32Array(totalCount);
    const phase = new Float32Array(totalCount);
    const direction = new Float32Array(totalCount);
    let cursor = 0;
    for (const request of requests) {
      for (let index = 0; index < request.count; index += 1) {
        centers[cursor * 3] = request.position.x;
        centers[cursor * 3 + 1] = request.position.y;
        centers[cursor * 3 + 2] = request.position.z;
        angles[cursor] = (index / request.count) * Math.PI * 2 + Math.random() * 0.45;
        radiusNoise[cursor] = 0.72 + Math.random() * 0.48;
        phase[cursor] = Math.random() * Math.PI * 2;
        direction[cursor] = index % 2 === 0 ? 1 : -0.72;
        cursor += 1;
      }
    }

    const dummy = new THREE.Object3D();
    this.addScript(root, first.duration, (progress) => {
      const radius = THREE.MathUtils.lerp(first.radiusStart, first.radiusEnd, 1 - Math.pow(1 - progress, 2));
      const envelope = Math.sin(Math.PI * Math.min(1, progress));
      material.opacity = Math.max(0, envelope * 0.92);
      for (let index = 0; index < totalCount; index += 1) {
        const angle = angles[index] + progress * first.speed * direction[index];
        const r = radius * radiusNoise[index];
        dummy.position.set(
          centers[index * 3] + Math.cos(angle) * r,
          centers[index * 3 + 1] + 0.04 + Math.sin(phase[index] + progress * 8) * 0.12 + progress * 0.3,
          centers[index * 3 + 2] + Math.sin(angle) * r,
        );
        dummy.rotation.set(progress * 5 + phase[index], angle, progress * 7);
        const pulse = 0.65 + Math.sin(phase[index] + progress * 12) * 0.28;
        if (first.motif === 'leaf') dummy.scale.set(1.8 * pulse, 0.34 * pulse, 0.82 * pulse);
        else if (first.motif === 'bone') dummy.scale.setScalar(0.78 + pulse * 0.4);
        else dummy.scale.setScalar(pulse);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private createSpikeCrown(position: THREE.Vector3, color: number, count: number, duration: number, height: number, radius: number, invert = false): void {
    const root = new THREE.Group();
    root.position.copy(position).setY(0.03);
    const geometry = new THREE.ConeGeometry(0.08, 1, 6);
    const material = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.2, roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.9, clearcoat: 0.25, clearcoatRoughness: 0.3 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    root.add(mesh);
    const dummy = new THREE.Object3D();
    this.addScript(root, duration, (progress, dt) => {
      root.rotation.y += dt * (invert ? -0.25 : 0.18);
      const grow = Math.sin(Math.min(1, progress * 1.35) * Math.PI * 0.5);
      const fade = progress > 0.7 ? (1 - progress) / 0.3 : 1;
      material.opacity = Math.max(0, fade * 0.9);
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        const h = height * (0.74 + (i % 3) * 0.12) * grow;
        dummy.position.set(Math.cos(angle) * radius, h * 0.5, Math.sin(angle) * radius);
        dummy.rotation.set(invert ? Math.PI : 0, -angle, 0);
        dummy.scale.set(1, Math.max(0.02, h), 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private createHaloBeams(position: THREE.Vector3, color: number, count: number, duration: number, radius: number): void {
    const root = new THREE.Group();
    root.position.copy(position).setY(0.05);
    const geometry = new THREE.BoxGeometry(0.035, 0.025, 1);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    root.add(mesh);
    const dummy = new THREE.Object3D();
    this.addScript(root, duration, (progress, dt) => {
      root.rotation.y += dt * 0.3;
      const grow = Math.sin(Math.min(1, progress * 1.5) * Math.PI * 0.5);
      material.opacity = Math.sin(Math.PI * progress) * 0.85;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        const length = radius * (0.65 + (i % 4) * 0.1) * grow;
        dummy.position.set(Math.cos(angle) * length * 0.58, 0, Math.sin(angle) * length * 0.58);
        dummy.rotation.set(0, -angle, 0);
        dummy.scale.set(1, 1, Math.max(0.01, length));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private createDarkDisk(position: THREE.Vector3, color: number, endScale: number, duration: number, collapse: boolean): void {
    const root = new THREE.Group();
    root.position.copy(position).setY(0.025);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide });
    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.72, 72), material);
    disk.rotation.x = -Math.PI / 2;
    root.add(disk);
    this.addScript(root, duration, (progress) => {
      const t = collapse ? 1 - progress : progress;
      const scale = 0.15 + endScale * (1 - Math.pow(1 - t, 3));
      disk.scale.setScalar(Math.max(0.03, scale));
      material.opacity = Math.sin(Math.PI * progress) * 0.8;
    });
  }

  private createStormStrike(position: THREE.Vector3, count: number, duration: number): void {
    this.createLightning(position, 0xc9f6ff, count, duration);
    const root = new THREE.Group();
    root.position.copy(position).setY(0.04);
    const material = new THREE.MeshBasicMaterial({ color: 0xe9fdff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.16, 4.5, 8), material);
    column.position.y = 2.1;
    root.add(column);
    this.addScript(root, duration, (progress) => {
      column.scale.x = column.scale.z = 0.4 + Math.random() * 0.8;
      material.opacity = Math.max(0, (1 - progress) * (Math.random() > 0.2 ? 0.9 : 0.25));
    });
  }

  private createFlameWings(position: THREE.Vector3, duration: number): void {
    const root = new THREE.Group();
    root.position.copy(position).setY(0.09);
    const material = new THREE.MeshBasicMaterial({ color: 0xff8d31, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    const left = new THREE.Mesh(makeWingGeometry(), material);
    left.rotation.x = -Math.PI / 2;
    left.position.set(-0.18, 0, 0);
    left.scale.set(1.2, 1.2, 1.2);
    root.add(left);
    const right = left.clone();
    right.scale.x = -1.2;
    right.position.x = 0.18;
    root.add(right);
    this.addScript(root, duration, (progress, dt) => {
      root.rotation.y += dt * 0.12;
      const spread = Math.sin(Math.min(1, progress * 1.45) * Math.PI * 0.5);
      left.rotation.z = -0.18 - spread * 0.42 + Math.sin(progress * 16) * 0.05;
      right.rotation.z = 0.18 + spread * 0.42 - Math.sin(progress * 16) * 0.05;
      const scale = 0.2 + spread * 1.1;
      left.scale.set(scale, scale, scale);
      right.scale.set(-scale, scale, scale);
      material.opacity = Math.sin(Math.PI * progress) * 0.88;
    });
  }

  private createWraith(position: THREE.Vector3, duration: number): void {
    const root = new THREE.Group();
    root.position.copy(position).setY(0.08);
    const spectral = new THREE.MeshStandardMaterial({ color: 0x6dba43, emissive: 0x58c839, emissiveIntensity: 1.2, transparent: true, opacity: 0.68, roughness: 0.6, depthWrite: false });
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 8, 1, true), spectral);
    hood.position.y = 0.45;
    root.add(hood);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshStandardMaterial({ color: 0xcde7aa, emissive: 0x6acb42, emissiveIntensity: 0.5, roughness: 0.8, transparent: true, opacity: 0.85 }));
    skull.position.y = 0.54;
    skull.scale.z = 0.75;
    root.add(skull);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x9cff5d, toneMapped: false });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 5), eyeMaterial);
      eye.position.set(side * 0.052, 0.57, -0.115);
      root.add(eye);
    }
    this.addScript(root, duration, (progress, dt) => {
      const appear = Math.sin(Math.PI * progress);
      root.scale.setScalar(0.15 + appear * 1.55);
      root.position.y = 0.08 + Math.sin(progress * Math.PI) * 0.75;
      root.rotation.y += dt * 0.7;
      spectral.opacity = appear * 0.7;
    });
  }

  private createLeafBloom(position: THREE.Vector3, count: number, duration: number): void {
    const root = new THREE.Group();
    root.position.copy(position).setY(0.05);
    const geometry = new THREE.SphereGeometry(0.075, 7, 5);
    const material = new THREE.MeshStandardMaterial({ color: 0xa9df6c, emissive: 0x355c26, emissiveIntensity: 0.25, roughness: 0.75, transparent: true, opacity: 0.9 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    root.add(mesh);
    const dummy = new THREE.Object3D();
    this.addScript(root, duration, (progress, dt) => {
      root.rotation.y += dt * 0.18;
      const bloom = 1 - Math.pow(1 - Math.min(1, progress * 1.25), 3);
      material.opacity = progress > 0.78 ? (1 - progress) / 0.22 : 0.9;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.18;
        const radius = (0.45 + (i % 5) * 0.12) * bloom * 1.9;
        dummy.position.set(Math.cos(angle) * radius, Math.sin(progress * Math.PI) * 0.12 + (i % 4) * 0.015, Math.sin(angle) * radius);
        dummy.rotation.set(0.2 + Math.sin(angle) * 0.2, -angle, progress * 2 + i);
        const s = (0.3 + bloom * 0.9) * (0.8 + (i % 3) * 0.12);
        dummy.scale.set(1.9 * s, 0.34 * s, 0.82 * s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private createThornCage(position: THREE.Vector3, count: number, duration: number): void {
    const root = new THREE.Group();
    root.position.copy(position).setY(0.03);
    const material = new THREE.MeshStandardMaterial({ color: 0x49682f, emissive: 0x19301c, emissiveIntensity: 0.2, roughness: 0.9, transparent: true, opacity: 0.95 });
    const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.055, 0.8, 5), material, count);
    root.add(mesh);
    const dummy = new THREE.Object3D();
    this.addScript(root, duration, (progress) => {
      const bind = Math.sin(Math.min(1, progress * 1.4) * Math.PI * 0.5);
      material.opacity = progress > 0.72 ? (1 - progress) / 0.28 : 0.95;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        const radius = THREE.MathUtils.lerp(1.5, 0.72, bind);
        dummy.position.set(Math.cos(angle) * radius, 0.26, Math.sin(angle) * radius);
        dummy.rotation.set(Math.PI * 0.18, -angle + Math.PI / 2, Math.PI * 0.35);
        dummy.scale.set(1, 0.45 + bind * 0.9, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private spawnDragon(position: THREE.Vector3): void {
    const dragon = createDragonModel();
    dragon.root.position.copy(position).setY(0.06);
    this.scene.add(dragon.root);
    this.dragons.push({ ...dragon, life: 2.8, duration: 2.8, fireTimer: 0, scale: 1.45 });
  }

  hasActiveAnimations(): boolean {
    return this.shakeTime > 0.001
      || this.shakePower > 0.001
      || this.bloomKick > 0.001
      || this.bursts.length > 0
      || this.meshes.length > 0
      || this.ringBatches.length > 0
      || this.lines.length > 0
      || this.lights.length > 0
      || this.scripts.length > 0
      || this.dragons.length > 0;
  }

  update(dt: number): void {
    if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
    this.shakePower = THREE.MathUtils.lerp(this.shakePower, 0, 1 - Math.pow(0.002, dt));
    this.bloomKick = THREE.MathUtils.lerp(this.bloomKick, 0, 1 - Math.pow(0.0008, dt));
    this.bloom.strength = this.bloomBase + this.bloomKick;

    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i];
      burst.life -= dt;
      const positions = burst.points.geometry.getAttribute('position');
      for (let j = 0; j < positions.count; j += 1) {
        const index = j * 3;
        burst.velocities[index + 1] -= burst.gravity * dt;
        positions.array[index] += burst.velocities[index] * dt;
        positions.array[index + 1] += burst.velocities[index + 1] * dt;
        positions.array[index + 2] += burst.velocities[index + 2] * dt;
      }
      positions.needsUpdate = true;
      burst.points.material.opacity = Math.max(0, burst.life / burst.duration);
      if (burst.life <= 0) {
        this.scene.remove(burst.points);
        burst.points.geometry.dispose();
        burst.points.material.dispose();
        this.bursts.splice(i, 1);
      }
    }

    for (let i = this.meshes.length - 1; i >= 0; i -= 1) {
      const animation = this.meshes[i];
      animation.life -= dt;
      const progress = THREE.MathUtils.clamp(1 - animation.life / animation.duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const scale = THREE.MathUtils.lerp(animation.startScale, animation.endScale, eased);
      animation.mesh.scale.setScalar(scale);
      animation.mesh.rotation.z += animation.spin * dt;
      animation.mesh.material.opacity = Math.sin(Math.min(1, progress) * Math.PI) * (1 - progress * 0.35);
      if (animation.life <= 0) {
        this.scene.remove(animation.mesh);
        animation.mesh.geometry.dispose();
        animation.mesh.material.dispose();
        this.meshes.splice(i, 1);
      }
    }

    for (let i = this.ringBatches.length - 1; i >= 0; i -= 1) {
      const animation = this.ringBatches[i];
      animation.life -= dt;
      animation.rotation += animation.spin * dt;
      const progress = THREE.MathUtils.clamp(1 - animation.life / animation.duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const scale = THREE.MathUtils.lerp(animation.startScale, animation.endScale, eased);
      animation.mesh.material.opacity = Math.sin(Math.min(1, progress) * Math.PI) * (1 - progress * 0.35);
      for (let instance = 0; instance < animation.mesh.count; instance += 1) {
        this.batchDummy.position.set(animation.centers[instance * 3], animation.centers[instance * 3 + 1], animation.centers[instance * 3 + 2]);
        this.batchDummy.rotation.set(-Math.PI / 2, animation.rotation, 0);
        this.batchDummy.scale.setScalar(scale);
        this.batchDummy.updateMatrix();
        animation.mesh.setMatrixAt(instance, this.batchDummy.matrix);
      }
      animation.mesh.instanceMatrix.needsUpdate = true;
      if (animation.life <= 0) {
        this.scene.remove(animation.mesh);
        animation.mesh.geometry.dispose();
        animation.mesh.material.dispose();
        this.ringBatches.splice(i, 1);
      }
    }

    for (let i = this.lines.length - 1; i >= 0; i -= 1) {
      const animation = this.lines[i];
      animation.life -= dt;
      animation.line.material.opacity = Math.max(0, animation.life / animation.duration) * (Math.random() > 0.25 ? 1 : 0.18);
      if (animation.life <= 0) {
        this.scene.remove(animation.line);
        animation.line.geometry.dispose();
        animation.line.material.dispose();
        this.lines.splice(i, 1);
      }
    }

    for (let i = this.lights.length - 1; i >= 0; i -= 1) {
      const animation = this.lights[i];
      animation.life -= dt;
      const progress = Math.max(0, animation.life / animation.duration);
      animation.light.intensity = animation.peak * progress * progress;
      if (animation.life <= 0) {
        this.scene.remove(animation.light);
        animation.light.dispose();
        this.lights.splice(i, 1);
      }
    }

    for (let i = this.scripts.length - 1; i >= 0; i -= 1) {
      const animation = this.scripts[i];
      animation.life -= dt;
      const progress = THREE.MathUtils.clamp(1 - animation.life / animation.duration, 0, 1);
      animation.update(progress, dt);
      if (animation.life <= 0) {
        this.scene.remove(animation.root);
        disposeObject(animation.root);
        this.scripts.splice(i, 1);
      }
    }

    for (let i = this.dragons.length - 1; i >= 0; i -= 1) {
      const dragon = this.dragons[i];
      dragon.life -= dt;
      dragon.fireTimer += dt;
      const progress = THREE.MathUtils.clamp(1 - dragon.life / dragon.duration, 0, 1);
      const appear = progress < 0.2 ? progress / 0.2 : progress > 0.88 ? (1 - progress) / 0.12 : 1;
      const easedAppear = THREE.MathUtils.clamp(appear, 0, 1);
      const scale = dragon.scale * (0.2 + 0.8 * easedAppear);
      dragon.root.scale.setScalar(scale);
      dragon.root.position.y = 0.05 + Math.sin(Math.min(progress, 0.65) / 0.65 * Math.PI) * 0.32;
      dragon.root.rotation.y += dt * 0.35;
      dragon.root.rotation.z = Math.sin(progress * Math.PI * 2.2) * 0.08;
      dragon.head.rotation.y = Math.sin(progress * Math.PI * 2.3) * 0.16;
      dragon.head.rotation.x = -0.1 + Math.sin(progress * Math.PI * 3.1) * 0.06;
      const flap = Math.sin(progress * Math.PI * 7.5);
      dragon.leftWing.rotation.z = -0.35 - flap * 0.35;
      dragon.leftWing.rotation.y = 0.22 + flap * 0.08;
      dragon.rightWing.rotation.z = 0.35 + flap * 0.35;
      dragon.rightWing.rotation.y = -0.22 - flap * 0.08;
      dragon.wingMembraneLeft.material.opacity = 0.82 + Math.abs(flap) * 0.1;
      dragon.wingMembraneRight.material.opacity = 0.82 + Math.abs(flap) * 0.1;
      dragon.light.intensity = easedAppear * (progress > 0.35 && progress < 0.75 ? 3.8 : 1.6);

      if (progress > 0.24 && progress < 0.78 && dragon.fireTimer > 0.06) {
        dragon.fireTimer = 0;
        const mouth = new THREE.Vector3();
        dragon.fireOrigin.getWorldPosition(mouth);
        const dir = dragon.fireDirection.clone().applyQuaternion(dragon.root.quaternion).normalize();
        this.createDirectionalBurst(mouth, dir, 0xff8f30, 22, 0.6, 4.3);
        this.createDirectionalBurst(mouth, dir.clone().add(new THREE.Vector3(0.05, 0, -0.05)).normalize(), 0xffd56a, 10, 0.45, 3.2);
      }

      if (progress > 0.32 && Math.random() > 0.72) {
        const mouth = new THREE.Vector3();
        dragon.fireOrigin.getWorldPosition(mouth);
        this.createLight(mouth, 0xff8e2e, 1.4, 0.16);
      }

      if (dragon.life <= 0) {
        this.scene.remove(dragon.root);
        disposeObject(dragon.root);
        dragon.light.dispose();
        this.dragons.splice(i, 1);
      }
    }
  }
}
