export type BuiltInThemeName =
  | 'dragon'
  | 'nebula'
  | 'ember'
  | 'frost'
  | 'celestial'
  | 'tempest'
  | 'necrotic'
  | 'wildwood';

/** Runtime themes use arbitrary validated IDs while built-in names remain strongly documented. */
export type ThemeName = string;

export type ThemeSurfaceKind =
  | 'dragon-scale'
  | 'nebula'
  | 'magma'
  | 'ice'
  | 'celestial'
  | 'storm'
  | 'necrotic'
  | 'wildwood';

export interface ThemePalette {
  name: string;
  surface: ThemeSurfaceKind;
  base: number;
  edge: number;
  emissive: number;
  label: string;
  labelGlow: string;
  particle: number;
  shadow: number;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  bumpScale: number;
  emissiveIntensity: number;
  edgeOpacity: number;
  shellOpacity: number;
}

export const THEMES: Record<string, ThemePalette> = {
  dragon: {
    name: 'Wyrmfire',
    surface: 'dragon-scale',
    base: 0x4b0d0d,
    edge: 0xe2a24a,
    emissive: 0x5e1208,
    label: '#ffe7c1',
    labelGlow: '#ff8b2f',
    particle: 0xff8f3a,
    shadow: 0x160505,
    roughness: 0.58,
    metalness: 0.08,
    clearcoat: 0.22,
    clearcoatRoughness: 0.48,
    bumpScale: 0.08,
    emissiveIntensity: 0.3,
    edgeOpacity: 0.58,
    shellOpacity: 0.035,
  },
  nebula: {
    name: 'Astral Void',
    surface: 'nebula',
    base: 0x382461,
    edge: 0xd9baff,
    emissive: 0x251046,
    label: '#fff7ff',
    labelGlow: '#c79cff',
    particle: 0xd8b6ff,
    shadow: 0x07030f,
    roughness: 0.48,
    metalness: 0.1,
    clearcoat: 0.25,
    clearcoatRoughness: 0.44,
    bumpScale: 0.024,
    emissiveIntensity: 0.21,
    edgeOpacity: 0.38,
    shellOpacity: 0.025,
  },
  ember: {
    name: 'Phoenix Forge',
    surface: 'magma',
    base: 0x6f1d10,
    edge: 0xffc36a,
    emissive: 0x5d0b05,
    label: '#fff4d4',
    labelGlow: '#ff8a42',
    particle: 0xffa454,
    shadow: 0x140402,
    roughness: 0.56,
    metalness: 0.09,
    clearcoat: 0.16,
    clearcoatRoughness: 0.56,
    bumpScale: 0.064,
    emissiveIntensity: 0.28,
    edgeOpacity: 0.5,
    shellOpacity: 0.03,
  },
  frost: {
    name: 'Glacier Heart',
    surface: 'ice',
    base: 0x175674,
    edge: 0xc9f8ff,
    emissive: 0x06385f,
    label: '#f4feff',
    labelGlow: '#73ddff',
    particle: 0x8ce9ff,
    shadow: 0x06131f,
    roughness: 0.38,
    metalness: 0.12,
    clearcoat: 0.34,
    clearcoatRoughness: 0.32,
    bumpScale: 0.05,
    emissiveIntensity: 0.2,
    edgeOpacity: 0.46,
    shellOpacity: 0.04,
  },
  celestial: {
    name: 'Sunforged',
    surface: 'celestial',
    base: 0xd7c9a3,
    edge: 0xffd978,
    emissive: 0x6c4a0e,
    label: '#fff9e9',
    labelGlow: '#ffd66e',
    particle: 0xffe3a0,
    shadow: 0x241b0b,
    roughness: 0.4,
    metalness: 0.22,
    clearcoat: 0.3,
    clearcoatRoughness: 0.38,
    bumpScale: 0.032,
    emissiveIntensity: 0.13,
    edgeOpacity: 0.55,
    shellOpacity: 0.026,
  },
  tempest: {
    name: 'Stormbound',
    surface: 'storm',
    base: 0x17283d,
    edge: 0x7edcff,
    emissive: 0x0a3856,
    label: '#eafaff',
    labelGlow: '#58cfff',
    particle: 0x72d8ff,
    shadow: 0x040a12,
    roughness: 0.5,
    metalness: 0.24,
    clearcoat: 0.18,
    clearcoatRoughness: 0.48,
    bumpScale: 0.04,
    emissiveIntensity: 0.24,
    edgeOpacity: 0.54,
    shellOpacity: 0.024,
  },
  necrotic: {
    name: 'Gravebound',
    surface: 'necrotic',
    base: 0x20261d,
    edge: 0x96e05e,
    emissive: 0x173d0a,
    label: '#eaffd8',
    labelGlow: '#8de94d',
    particle: 0x8ee85c,
    shadow: 0x050805,
    roughness: 0.7,
    metalness: 0.06,
    clearcoat: 0.08,
    clearcoatRoughness: 0.74,
    bumpScale: 0.07,
    emissiveIntensity: 0.25,
    edgeOpacity: 0.48,
    shellOpacity: 0.028,
  },
  wildwood: {
    name: 'Verdant Oath',
    surface: 'wildwood',
    base: 0x244f32,
    edge: 0xb7e879,
    emissive: 0x173b20,
    label: '#f2ffe2',
    labelGlow: '#a8f16c',
    particle: 0xb7f57c,
    shadow: 0x07130b,
    roughness: 0.74,
    metalness: 0.02,
    clearcoat: 0.08,
    clearcoatRoughness: 0.72,
    bumpScale: 0.078,
    emissiveIntensity: 0.16,
    edgeOpacity: 0.4,
    shellOpacity: 0.022,
  },
};

export const THEME_ORDER: BuiltInThemeName[] = [
  'dragon',
  'celestial',
  'tempest',
  'frost',
  'nebula',
  'ember',
  'necrotic',
  'wildwood',
];

export type ThemeImpactSet = 'stone' | 'metal' | 'crystal' | 'resin' | 'wood' | 'bone';

export interface ThemeSurfaceAudio {
  impactSet: ThemeImpactSet;
  pitchRange: [number, number];
  resonance: number;
  weight: number;
  brightness: number;
}

export interface ThemeCapabilities {
  positiveEffect: boolean;
  neutralEffect: boolean;
  negativeEffect: boolean;
  customModel: boolean;
  customCollider: boolean;
  customAudio: boolean;
}

export interface ThemeManifest {
  id: ThemeName;
  name: string;
  version: string;
  description?: string;
  author?: string;
  previews?: Record<string, string>;
  availableDice?: string[];
  capabilities: ThemeCapabilities;
  surfaceAudio: ThemeSurfaceAudio;
}

export const THEME_MANIFESTS: Record<string, ThemeManifest> = {
  dragon: {
    id: 'dragon', name: THEMES.dragon.name, version: '1.0.0',
    capabilities: { positiveEffect: true, neutralEffect: true, negativeEffect: true, customModel: true, customCollider: false, customAudio: true },
    surfaceAudio: { impactSet: 'stone', pitchRange: [0.88, 1.04], resonance: 0.34, weight: 1.28, brightness: 0.42 },
  },
  celestial: {
    id: 'celestial', name: THEMES.celestial.name, version: '1.0.0',
    capabilities: { positiveEffect: true, neutralEffect: true, negativeEffect: true, customModel: false, customCollider: false, customAudio: true },
    surfaceAudio: { impactSet: 'metal', pitchRange: [0.98, 1.12], resonance: 0.7, weight: 1.05, brightness: 0.76 },
  },
  tempest: {
    id: 'tempest', name: THEMES.tempest.name, version: '1.0.0',
    capabilities: { positiveEffect: true, neutralEffect: true, negativeEffect: true, customModel: false, customCollider: false, customAudio: true },
    surfaceAudio: { impactSet: 'metal', pitchRange: [0.84, 1.02], resonance: 0.52, weight: 1.2, brightness: 0.58 },
  },
  frost: {
    id: 'frost', name: THEMES.frost.name, version: '1.0.0',
    capabilities: { positiveEffect: true, neutralEffect: true, negativeEffect: true, customModel: false, customCollider: false, customAudio: true },
    surfaceAudio: { impactSet: 'crystal', pitchRange: [1.02, 1.22], resonance: 0.82, weight: 0.82, brightness: 0.92 },
  },
  nebula: {
    id: 'nebula', name: THEMES.nebula.name, version: '1.0.0',
    capabilities: { positiveEffect: true, neutralEffect: true, negativeEffect: true, customModel: false, customCollider: false, customAudio: true },
    surfaceAudio: { impactSet: 'resin', pitchRange: [0.9, 1.08], resonance: 0.44, weight: 0.92, brightness: 0.5 },
  },
  ember: {
    id: 'ember', name: THEMES.ember.name, version: '1.0.0',
    capabilities: { positiveEffect: true, neutralEffect: true, negativeEffect: true, customModel: false, customCollider: false, customAudio: true },
    surfaceAudio: { impactSet: 'stone', pitchRange: [0.82, 1.0], resonance: 0.26, weight: 1.36, brightness: 0.35 },
  },
  necrotic: {
    id: 'necrotic', name: THEMES.necrotic.name, version: '1.0.0',
    capabilities: { positiveEffect: true, neutralEffect: true, negativeEffect: true, customModel: false, customCollider: false, customAudio: true },
    surfaceAudio: { impactSet: 'bone', pitchRange: [0.92, 1.12], resonance: 0.25, weight: 0.76, brightness: 0.68 },
  },
  wildwood: {
    id: 'wildwood', name: THEMES.wildwood.name, version: '1.0.0',
    capabilities: { positiveEffect: true, neutralEffect: true, negativeEffect: true, customModel: false, customCollider: false, customAudio: true },
    surfaceAudio: { impactSet: 'wood', pitchRange: [0.86, 1.06], resonance: 0.18, weight: 0.88, brightness: 0.3 },
  },
};
