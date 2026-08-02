import * as THREE from 'three';
import type {
  DraftrollFallbackKind,
  DraftrollFallbackVisual,
} from '../packages/renderer/src/index';
import { THEMES, type ThemeName } from './themes';

export interface FallbackVisualBounds {
  x: number;
  z: number;
}

interface Trajectory {
  start: THREE.Vector3;
  end: THREE.Vector3;
  arcHeight: number;
  rotationStart: number;
  rotationTurns: number;
  delay: number;
}

let shadowTexture: THREE.CanvasTexture | null = null;

function getShadowTexture(): THREE.CanvasTexture {
  if (shadowTexture) return shadowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const gradient = context.createRadialGradient(128, 64, 4, 128, 64, 112);
  gradient.addColorStop(0, 'rgba(0,0,0,.5)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,.2)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  shadowTexture = new THREE.CanvasTexture(canvas);
  shadowTexture.colorSpace = THREE.SRGBColorSpace;
  return shadowTexture;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function polygon(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  sides: number,
): void {
  context.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = -Math.PI / 2 + (index / sides) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

function createVisualTexture(spec: DraftrollFallbackVisual): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 440;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable.');
  const palette = THEMES[normalizeTheme(spec.theme)];
  const base = `#${palette.base.toString(16).padStart(6, '0')}`;
  const edge = `#${palette.edge.toString(16).padStart(6, '0')}`;
  const shadow = `#${palette.shadow.toString(16).padStart(6, '0')}`;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.shadowColor = 'rgba(0,0,0,.55)';
  context.shadowBlur = 28;
  context.shadowOffsetY = 14;

  const bounds = visualBounds(spec.kind);
  if (spec.kind === 'coin' || spec.kind === 'spinner') {
    context.beginPath();
    context.arc(canvas.width / 2, canvas.height / 2, bounds.radius, 0, Math.PI * 2);
  } else if (spec.kind === 'percentile') {
    polygon(context, canvas.width / 2, canvas.height / 2, bounds.radius, 10);
  } else if (spec.kind === 'fate') {
    roundedRect(context, bounds.x, bounds.y, bounds.width, bounds.height, 62);
  } else {
    roundedRect(
      context,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      spec.kind === 'card' ? 48 : 100,
    );
  }

  const fill = context.createLinearGradient(120, 70, 520, 390);
  fill.addColorStop(0, edge);
  fill.addColorStop(0.08, base);
  fill.addColorStop(0.72, shadow);
  fill.addColorStop(1, base);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 14;
  context.strokeStyle = edge;
  context.stroke();
  context.restore();

  context.save();
  context.globalAlpha = 0.18;
  context.strokeStyle = palette.label;
  context.lineWidth = 3;
  for (let index = 0; index < 9; index += 1) {
    context.beginPath();
    context.arc(
      canvas.width * (0.22 + index * 0.07),
      canvas.height * (0.24 + Math.sin(index * 1.7) * 0.08),
      26 + index * 4,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
  context.restore();

  if (spec.kind === 'spinner') {
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.fillStyle = edge;
    context.beginPath();
    context.moveTo(0, -172);
    context.lineTo(-24, -118);
    context.lineTo(24, -118);
    context.closePath();
    context.fill();
    context.restore();
  }

  const label = truncate(spec.label, 14);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.font = `700 ${label.length > 6 ? 104 : 146}px system-ui, sans-serif`;
  context.lineWidth = 14;
  context.strokeStyle = 'rgba(0,0,0,.62)';
  context.strokeText(label, canvas.width / 2, canvas.height / 2 + 12);
  context.fillStyle = palette.label;
  context.shadowColor = palette.labelGlow;
  context.shadowBlur = 18;
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 12);

  context.shadowBlur = 0;
  context.font = '600 34px system-ui, sans-serif';
  context.fillStyle = 'rgba(255,255,255,.88)';
  context.fillText(truncate(spec.title, 28), canvas.width / 2, canvas.height - 54);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function visualBounds(kind: DraftrollFallbackKind): {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
} {
  if (kind === 'coin' || kind === 'spinner' || kind === 'percentile') {
    return { x: 120, y: 20, width: 400, height: 400, radius: 188 };
  }
  if (kind === 'fate') return { x: 130, y: 30, width: 380, height: 380, radius: 0 };
  if (kind === 'token') return { x: 84, y: 66, width: 472, height: 308, radius: 0 };
  return { x: 62, y: 42, width: 516, height: 356, radius: 0 };
}

function normalizeTheme(theme: string): ThemeName {
  return Object.prototype.hasOwnProperty.call(THEMES, theme) ? theme : 'dragon';
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(1, maximum - 1))}…`;
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function easeOutBack(value: number): number {
  const overshoot = 1.70158;
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
}

export class FallbackVisualInstance {
  readonly group = new THREE.Group();
  readonly spec: DraftrollFallbackVisual;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private readonly sprite: THREE.Sprite;
  private readonly shadowMaterial: THREE.SpriteMaterial;
  private readonly shadow: THREE.Sprite;
  private trajectory: Trajectory | null = null;
  private settled = false;

  constructor(spec: DraftrollFallbackVisual) {
    this.spec = spec;
    this.texture = createVisualTexture(spec);
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    const scale = visualScale(spec.kind);
    this.sprite.scale.set(scale.x, scale.y, 1);
    this.sprite.renderOrder = 5;
    this.group.add(this.sprite);

    this.shadowMaterial = new THREE.SpriteMaterial({
      map: getShadowTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.shadow = new THREE.Sprite(this.shadowMaterial);
    this.shadow.scale.set(scale.x * 0.82, scale.y * 0.34, 1);
    this.shadow.position.y = -0.38;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);

    this.group.visible = false;
  }

  configureTrajectory(
    index: number,
    count: number,
    bounds: FallbackVisualBounds,
    random: () => number,
  ): void {
    const columns = Math.min(5, Math.max(1, count));
    const rows = Math.ceil(count / columns);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const rowCount = Math.min(columns, count - row * columns);
    const spacingX = Math.min(2.45, (bounds.x * 2 - 1.8) / Math.max(1, rowCount));
    const x = (column - (rowCount - 1) / 2) * spacingX;
    const z = -bounds.z + 1.18 + row * Math.min(1.5, 2.8 / Math.max(1, rows));
    const fromLeft = index % 2 === 0;
    this.settled = false;
    this.trajectory = {
      start: new THREE.Vector3(
        (fromLeft ? -bounds.x - 1.4 : bounds.x + 1.4) + (random() - 0.5) * 0.8,
        2.8 + random() * 1.6,
        bounds.z * (0.25 + random() * 0.75),
      ),
      end: new THREE.Vector3(
        THREE.MathUtils.clamp(x + (random() - 0.5) * 0.22, -bounds.x + 0.8, bounds.x - 0.8),
        0.48,
        THREE.MathUtils.clamp(z + (random() - 0.5) * 0.18, -bounds.z + 0.72, bounds.z - 0.72),
      ),
      arcHeight: 2.1 + random() * 1.5,
      rotationStart: (random() - 0.5) * Math.PI,
      rotationTurns: (fromLeft ? 1 : -1) * (1.2 + random() * 2.2),
      delay: Math.min(0.22, index * 0.028 + random() * 0.035),
    };
    this.group.position.copy(this.trajectory.start);
    this.material.rotation = this.trajectory.rotationStart;
    this.material.opacity = 0;
    this.shadowMaterial.opacity = 0;
    this.group.scale.setScalar(0.55);
  }

  update(progress: number): void {
    if (this.settled) return;
    const trajectory = this.trajectory;
    if (!trajectory) return;
    const normalized = THREE.MathUtils.clamp(
      (progress - trajectory.delay) / Math.max(0.001, 1 - trajectory.delay),
      0,
      1,
    );
    this.group.visible = normalized > 0;
    if (normalized <= 0) return;

    const travel = easeOutCubic(normalized);
    this.group.position.lerpVectors(trajectory.start, trajectory.end, travel);
    const arc = Math.sin(normalized * Math.PI) * trajectory.arcHeight * (1 - normalized * 0.38);
    const settleBounce =
      normalized > 0.72 ? Math.sin((normalized - 0.72) * Math.PI * 7) * (1 - normalized) * 0.36 : 0;
    this.group.position.y = trajectory.end.y + arc + settleBounce;
    this.material.rotation =
      trajectory.rotationStart +
      trajectory.rotationTurns * Math.PI * 2 * (1 - Math.pow(1 - normalized, 2));
    this.material.opacity = THREE.MathUtils.clamp(normalized * 5, 0, 1);
    this.shadowMaterial.opacity =
      THREE.MathUtils.clamp((normalized - 0.22) * 1.2, 0, 0.34) * (1 - Math.min(0.8, arc / 5));
    const scale = easeOutBack(Math.min(1, normalized * 1.45));
    this.group.scale.setScalar(Math.max(0.2, scale));
  }

  settle(): void {
    if (this.settled) return;
    this.update(1);
    this.settled = true;
  }

  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.group.getWorldPosition(target);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.shadowMaterial.dispose();
  }
}

function visualScale(kind: DraftrollFallbackKind): THREE.Vector2 {
  if (kind === 'card') return new THREE.Vector2(2.15, 1.48);
  if (kind === 'token') return new THREE.Vector2(1.95, 1.28);
  if (kind === 'fate') return new THREE.Vector2(1.55, 1.55);
  return new THREE.Vector2(1.62, 1.16);
}
