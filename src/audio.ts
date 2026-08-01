import type { ThemeSurfaceAudio } from './themes';

export class DraftrollAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private impactCooldown = 0;
  private impactNoise: AudioBuffer | null = null;
  private readonly themeAudio = new Map<string, { impact?: ArrayBuffer; roll?: ArrayBuffer; volume: number; playbackRate: [number, number] }>();
  private readonly decodedThemeAudio = new Map<string, { impact?: AudioBuffer; roll?: AudioBuffer }>();
  private readonly decodingThemeAudio = new Map<string, Promise<void>>();
  public enabled = true;

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(enabled ? 0.45 : 0, this.context.currentTime, 0.02);
    }
  }

  update(dt: number): void {
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
  }

  registerThemeAudio(
    themeId: string,
    audio: { impact?: ArrayBuffer; roll?: ArrayBuffer; volume?: number; playbackRate?: [number, number] },
  ): void {
    this.themeAudio.set(themeId, {
      impact: audio.impact?.slice(0),
      roll: audio.roll?.slice(0),
      volume: audio.volume ?? 0.8,
      playbackRate: audio.playbackRate ? [...audio.playbackRate] : [0.96, 1.04],
    });
    this.decodedThemeAudio.delete(themeId);
    if (this.context) void this.decodeThemeAudio(themeId);
  }

  unregisterThemeAudio(themeId: string): void {
    this.themeAudio.delete(themeId);
    this.decodedThemeAudio.delete(themeId);
    this.decodingThemeAudio.delete(themeId);
  }

  playWhoosh(themeId?: string): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    if (themeId && this.playThemeBuffer(themeId, 'roll', 0.7)) return;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(190, now);
    oscillator.frequency.exponentialRampToValueAtTime(58, now + 0.34);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1100, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.34);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
    oscillator.connect(filter).connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.38);
  }

  private getImpactNoise(ctx: AudioContext): AudioBuffer {
    if (this.impactNoise && this.impactNoise.sampleRate === ctx.sampleRate) return this.impactNoise;
    const length = Math.ceil(ctx.sampleRate * 0.2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const envelope = Math.pow(1 - i / data.length, 2.8);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    this.impactNoise = buffer;
    return buffer;
  }

  playImpact(strength: number, profile?: ThemeSurfaceAudio, themeId?: string): void {
    if (this.impactCooldown > 0 || strength < 0.9) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    if (themeId && this.playThemeBuffer(themeId, 'impact', Math.min(1, strength / 10))) {
      this.impactCooldown = strength > 7 ? 0.025 : 0.035;
      return;
    }
    const sound = profile ?? {
      impactSet: 'resin' as const,
      pitchRange: [0.94, 1.06] as [number, number],
      resonance: 0.35,
      weight: 1,
      brightness: 0.5,
    };
    this.impactCooldown = strength > 7 ? 0.025 : 0.035;
    const now = ctx.currentTime;
    const normalized = Math.min(1, strength / 11);
    const pitch = sound.pitchRange[0] + Math.random() * (sound.pitchRange[1] - sound.pitchRange[0]);
    const durationBySet: Record<ThemeSurfaceAudio['impactSet'], number> = {
      stone: 0.105,
      metal: 0.17,
      crystal: 0.19,
      resin: 0.09,
      wood: 0.075,
      bone: 0.065,
    };
    const baseFrequency: Record<ThemeSurfaceAudio['impactSet'], number> = {
      stone: 165,
      metal: 520,
      crystal: 940,
      resin: 285,
      wood: 145,
      bone: 410,
    };
    const length = durationBySet[sound.impactSet] * (0.82 + normalized * 0.35);
    const frequency = baseFrequency[sound.impactSet] * pitch * (0.86 + sound.brightness * 0.42);

    const source = ctx.createBufferSource();
    source.buffer = this.getImpactNoise(ctx);
    source.playbackRate.value = pitch;
    const filter = ctx.createBiquadFilter();
    filter.type = sound.impactSet === 'wood' || sound.impactSet === 'stone' ? 'lowpass' : 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.55 + sound.resonance * 4.2;
    const gain = ctx.createGain();
    const noisePeak = Math.min(0.14, (0.016 + strength * 0.008) * sound.weight);
    gain.gain.setValueAtTime(noisePeak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now, 0, Math.min(0.2, length));

    const oscillator = ctx.createOscillator();
    const toneGain = ctx.createGain();
    oscillator.type = sound.impactSet === 'metal' || sound.impactSet === 'crystal' ? 'sine' : sound.impactSet === 'bone' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency * (sound.impactSet === 'stone' || sound.impactSet === 'wood' ? 0.42 : 1), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(34, frequency * 0.72), now + length);
    const tonePeak = Math.min(0.1, (0.01 + normalized * 0.055) * (0.5 + sound.resonance) * sound.weight);
    toneGain.gain.setValueAtTime(tonePeak, now);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + length * (0.75 + sound.resonance * 0.7));
    oscillator.connect(toneGain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + length * (0.9 + sound.resonance * 0.8));

    if (sound.impactSet === 'crystal' && normalized > 0.42) {
      const overtone = ctx.createOscillator();
      const overtoneGain = ctx.createGain();
      overtone.type = 'sine';
      overtone.frequency.value = frequency * 1.84;
      overtoneGain.gain.setValueAtTime(tonePeak * 0.42, now);
      overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + length * 1.2);
      overtone.connect(overtoneGain).connect(this.master);
      overtone.start(now);
      overtone.stop(now + length * 1.25);
    }
  }

  private playThemeBuffer(themeId: string, kind: 'impact' | 'roll', strength: number): boolean {
    const ctx = this.context;
    const master = this.master;
    const definition = this.themeAudio.get(themeId);
    if (!ctx || !master || !definition) return false;
    const buffer = this.decodedThemeAudio.get(themeId)?.[kind];
    if (!buffer) {
      void this.decodeThemeAudio(themeId);
      return false;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const [minimum, maximum] = definition.playbackRate;
    source.playbackRate.value = minimum + Math.random() * Math.max(0, maximum - minimum);
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, definition.volume * Math.max(0.15, strength)));
    source.connect(gain).connect(master);
    source.start();
    return true;
  }

  private async decodeThemeAudio(themeId: string): Promise<void> {
    const existing = this.decodingThemeAudio.get(themeId);
    if (existing) return existing;
    const definition = this.themeAudio.get(themeId);
    const ctx = this.ensureContext();
    if (!definition || !ctx) return;
    const decoding = (async () => {
      const decoded: { impact?: AudioBuffer; roll?: AudioBuffer } = {};
      if (definition.impact) decoded.impact = await ctx.decodeAudioData(definition.impact.slice(0));
      if (definition.roll) decoded.roll = await ctx.decodeAudioData(definition.roll.slice(0));
      this.decodedThemeAudio.set(themeId, decoded);
    })().catch(() => undefined).finally(() => this.decodingThemeAudio.delete(themeId));
    this.decodingThemeAudio.set(themeId, decoding);
    return decoding;
  }

  playSuccess(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    [0, 0.09, 0.2, 0.34].forEach((offset, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = index === 3 ? 'sine' : 'triangle';
      oscillator.frequency.value = [261.6, 392, 523.3, 784][index];
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(index === 3 ? 0.075 : 0.05, now + offset + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.7);
      oscillator.connect(gain).connect(this.master!);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.72);
    });
  }

  playFailure(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const gain = ctx.createGain();
    const subGain = ctx.createGain();
    oscillator.type = 'sawtooth';
    sub.type = 'sine';
    oscillator.frequency.setValueAtTime(96, now);
    oscillator.frequency.exponentialRampToValueAtTime(41, now + 0.72);
    sub.frequency.setValueAtTime(54, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.78);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(0.08, now + 0.04);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);
    oscillator.connect(gain).connect(this.master);
    sub.connect(subGain).connect(this.master);
    oscillator.start(now);
    sub.start(now);
    oscillator.stop(now + 0.8);
    sub.stop(now + 0.84);
  }
}
