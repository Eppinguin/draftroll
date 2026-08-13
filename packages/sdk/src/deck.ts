/** Stateful, system-agnostic card decks for Draftroll. */
import type { CustomDiceDefinition, CustomDieFace, DisplayRollInput, ExternalDieResult } from '../../protocol/src/index';

export interface DraftrollCardDefinition extends Omit<CustomDieFace, 'weight'> { copies?: number; }
export interface DraftrollDeckOptions { shuffle?: boolean; random?: () => number; metadata?: Record<string, unknown>; }
export interface DraftrollCard {
  id: string; deckId: string; faceIndex: number; copyIndex: number;
  result: number | string; numericValue: number; label: string; metadata?: Record<string, unknown>;
}
export interface DraftrollCardDisplayOptions {
  name?: string; expression?: string; themeId?: string; annotation?: string | null;
  comment?: string | null; metadata?: Record<string, unknown>;
}
export interface DraftrollCardDraw {
  readonly deckId: string; readonly cards: readonly DraftrollCard[]; readonly total: number;
  toDisplayInput(options?: DraftrollCardDisplayOptions): DisplayRollInput;
}

const cloneMeta = (value?: Record<string, unknown>) => value ? { ...value } : undefined;
const cloneCard = (card: DraftrollCard): DraftrollCard => ({ ...card, metadata: cloneMeta(card.metadata) });

function defaultRandom(): number {
  if (!globalThis.crypto?.getRandomValues) throw new Error('DraftrollDeck requires WebCrypto or an injected random()');
  const data = new Uint32Array(1); globalThis.crypto.getRandomValues(data); return data[0] / 0x1_0000_0000;
}
function shuffle<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('Deck random() must return a value in [0, 1)');
    const j = Math.floor(sample * (i + 1)); [items[i], items[j]] = [items[j], items[i]];
  }
}

/**
 * Owns shuffle/depletion/discard state while Draftroll remains stateless at the result boundary.
 * The card is chosen before rendering; `toDisplayInput()` turns the draw into an exact external result.
 * @public
 */
export class DraftrollDeck {
  readonly id: string;
  readonly definition: CustomDiceDefinition;
  private readonly random: () => number;
  private readonly source: DraftrollCard[];
  private drawPile: DraftrollCard[];
  private discardPile: DraftrollCard[] = [];
  private inPlay = new Map<string, DraftrollCard>();

  constructor(id: string, cards: readonly DraftrollCardDefinition[], options: DraftrollDeckOptions = {}) {
    this.id = id.trim();
    if (!this.id) throw new Error('A deck ID is required');
    if (!cards.length) throw new Error(`Deck '${this.id}' requires at least one card`);
    this.random = options.random ?? defaultRandom;
    const normalized = cards.map((card, index) => {
      if (typeof card.result !== 'number' && typeof card.result !== 'string') throw new Error(`Card ${index + 1} requires a result`);
      if (typeof card.result === 'number' && !Number.isFinite(card.result)) throw new Error(`Card ${index + 1} result must be finite`);
      if (card.value !== undefined && !Number.isFinite(card.value)) throw new Error(`Card ${index + 1} value must be finite`);
      const copies = card.copies ?? 1;
      if (!Number.isSafeInteger(copies) || copies < 1) throw new Error(`Card ${index + 1} copies must be a positive safe integer`);
      return { ...card, copies, metadata: cloneMeta(card.metadata) };
    });
    this.definition = {
      id: this.id, renderAs: 'card', metadata: cloneMeta(options.metadata),
      faces: normalized.map(({ copies: _copies, ...card }) => ({ ...card, metadata: cloneMeta(card.metadata) })),
    };
    this.source = normalized.flatMap((card, faceIndex) => Array.from({ length: card.copies }, (_, copyIndex) => ({
      id: `${this.id}:card:${faceIndex}:${copyIndex}`, deckId: this.id, faceIndex, copyIndex,
      result: card.result, numericValue: card.value ?? (typeof card.result === 'number' ? card.result : 0),
      label: card.label ?? String(card.result), metadata: cloneMeta(card.metadata),
    })));
    this.drawPile = this.source.map(cloneCard);
    if (options.shuffle !== false) this.shuffle();
  }

  get size(): number { return this.source.length; }
  get remaining(): number { return this.drawPile.length; }
  get discarded(): number { return this.discardPile.length; }
  get active(): number { return this.inPlay.size; }
  get remainingCards(): readonly DraftrollCard[] { return this.drawPile.map(cloneCard); }
  get discardedCards(): readonly DraftrollCard[] { return this.discardPile.map(cloneCard); }

  shuffle(): this { shuffle(this.drawPile, this.random); return this; }

  draw(count = 1): DraftrollCardDraw {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('Draw count must be a positive safe integer');
    if (count > this.drawPile.length) throw new Error(`Deck '${this.id}' has only ${this.drawPile.length} card(s) remaining`);
    const cards: DraftrollCard[] = [];
    for (let i = 0; i < count; i += 1) {
      const card = this.drawPile.pop()!; this.inPlay.set(card.id, card); cards.push(cloneCard(card));
    }
    const total = cards.reduce((sum, card) => sum + card.numericValue, 0);
    const deck = this;
    return Object.freeze({ deckId: this.id, cards: Object.freeze(cards.map(cloneCard)), total,
      toDisplayInput(options: DraftrollCardDisplayOptions = {}): DisplayRollInput {
        const dice: ExternalDieResult[] = cards.map((card) => ({
          id: card.id, type: deck.id, customDiceId: deck.id, faceIndex: card.faceIndex,
          result: card.result, numericValue: card.numericValue, kept: true, generatedBy: 'external',
          metadata: { ...cloneMeta(card.metadata), deckId: deck.id, copyIndex: card.copyIndex },
        }));
        return { mode: 'display', dice, total, name: options.name, expression: options.expression,
          themeId: options.themeId, annotation: options.annotation, comment: options.comment,
          customDice: [deck.definition], metadata: { ...cloneMeta(options.metadata), deckId: deck.id, cardDraw: true } };
      },
    });
  }

  discard(cards: DraftrollCard | string | readonly (DraftrollCard | string)[]): this {
    for (const item of Array.isArray(cards) ? cards : [cards]) {
      const id = typeof item === 'string' ? item : item.id; const card = this.inPlay.get(id);
      if (!card) throw new Error(`Card '${id}' is not active in deck '${this.id}'`);
      this.inPlay.delete(id); this.discardPile.push(card);
    }
    return this;
  }

  return(cards: DraftrollCard | string | readonly (DraftrollCard | string)[], options: { shuffle?: boolean } = {}): this {
    for (const item of Array.isArray(cards) ? cards : [cards]) {
      const id = typeof item === 'string' ? item : item.id; const card = this.inPlay.get(id);
      if (!card) throw new Error(`Card '${id}' is not active in deck '${this.id}'`);
      this.inPlay.delete(id); this.drawPile.push(card);
    }
    if (options.shuffle !== false) this.shuffle(); return this;
  }

  reshuffleDiscard(): this { this.drawPile.push(...this.discardPile.splice(0)); return this.shuffle(); }
  reset(options: { shuffle?: boolean } = {}): this {
    this.inPlay.clear(); this.discardPile = []; this.drawPile = this.source.map(cloneCard);
    if (options.shuffle !== false) this.shuffle(); return this;
  }
}

export function createDeck(id: string, cards: readonly DraftrollCardDefinition[], options?: DraftrollDeckOptions): DraftrollDeck {
  return new DraftrollDeck(id, cards, options);
}
