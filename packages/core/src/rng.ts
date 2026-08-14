/**
 * Minimal random-number source consumed by the evaluator.
 *
 * @public
 */
export interface DiceRng {
  integer(min: number, max: number): number;
}

/**
 * Cryptographically strong random-number source backed by Web Crypto.
 *
 * @public
 */
export class CryptoRng implements DiceRng {
  /**
   * Integer.
   */
  integer(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError(`Invalid integer range: ${min}..${max}`);
    }
    const span = max - min + 1;
    if (span <= 0 || span > 0x1_0000_0000) throw new RangeError('Range is too large');

    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) {
      throw new Error('Cryptographically secure randomness is unavailable in this runtime');
    }

    const limit = Math.floor(0x1_0000_0000 / span) * span;
    const buffer = new Uint32Array(1);
    do cryptoApi.getRandomValues(buffer);
    while (buffer[0] >= limit);
    return min + (buffer[0] % span);
  }
}

/**
 * Deterministic pseudo-random source intended for tests and reproducible simulations.
 *
 * @public
 */
export class SeededRng implements DiceRng {
  private state: number;

  /**
   * Creates a SeededRng instance.
   */
  constructor(seed: string | number) {
    this.state = hashSeed(String(seed)) || 0x9e3779b9;
  }

  /**
   * Integer.
   */
  integer(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError(`Invalid integer range: ${min}..${max}`);
    }
    const value = this.next();
    return min + Math.floor(value * (max - min + 1));
  }

  private next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  }
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
