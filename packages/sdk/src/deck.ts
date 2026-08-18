/**
 * Stateful, system-agnostic card deck primitives for Draftroll.
 *
 * @packageDocumentation
 */
import type {
  CustomDiceDefinition,
  CustomDieFace,
  DisplayRollInput,
  ExternalDieResult,
} from '../../protocol/src/index';

/**
 * Defines one card face and optional duplicate count inside a deck.
 *
 * @public
 */
export interface DraftrollCardDefinition extends Omit<CustomDieFace, 'weight'> {
  copies?: number;
}
/**
 * Configures initial shuffle behavior, randomness, and deck metadata.
 *
 * @public
 */
export interface DraftrollDeckOptions {
  shuffle?: boolean;
  /** Deterministic/test random source in [0, 1). Production defaults to unbiased WebCrypto sampling. */
  random?: () => number;
  metadata?: Record<string, unknown>;
}
/**
 * Detached public snapshot of a concrete card copy in a deck.
 *
 * @public
 */
export interface DraftrollCard {
  readonly id: string;
  readonly deckId: string;
  readonly faceIndex: number;
  readonly copyIndex: number;
  readonly result: number | string;
  readonly numericValue: number;
  readonly label: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
/**
 * Presentation metadata applied when a card draw is converted to display input.
 *
 * @public
 */
export interface DraftrollCardDisplayOptions {
  name?: string;
  expression?: string;
  themeId?: string;
  annotation?: string | null;
  comment?: string | null;
  metadata?: Record<string, unknown>;
}
/**
 * Result of drawing one or more cards, including exact display conversion.
 *
 * @public
 */
export interface DraftrollCardDraw {
  readonly deckId: string;
  readonly cards: readonly DraftrollCard[];
  readonly total: number;
  toDisplayInput(options?: DraftrollCardDisplayOptions): DisplayRollInput;
}

type IndexSampler = (upperExclusive: number) => number;

type MutableDraftrollCard = Omit<DraftrollCard, 'metadata'> & {
  metadata?: Record<string, unknown>;
};

function cloneMetadata(value?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value) as Record<string, unknown>;
    } catch {
      // Metadata is expected to be data-only, but keep a detached top-level object for unusual hosts.
    }
  }
  return { ...value };
}

function cloneCard(card: DraftrollCard): MutableDraftrollCard {
  return {
    ...card,
    metadata: cloneMetadata(card.metadata ? { ...card.metadata } : undefined),
  };
}

function snapshotCard(card: DraftrollCard): DraftrollCard {
  const metadata = cloneMetadata(card.metadata ? { ...card.metadata } : undefined);
  if (metadata) Object.freeze(metadata);
  return Object.freeze({ ...card, metadata });
}

function cloneDefinition(definition: CustomDiceDefinition): CustomDiceDefinition {
  return {
    ...definition,
    metadata: cloneMetadata(definition.metadata),
    faces: definition.faces.map((face) => ({
      ...face,
      metadata: cloneMetadata(face.metadata),
    })),
  };
}

function secureIndex(upperExclusive: number): number {
  if (upperExclusive <= 1) return 0;
  if (
    !Number.isSafeInteger(upperExclusive) ||
    upperExclusive < 1 ||
    upperExclusive > 0x1_0000_0000
  ) {
    throw new Error('Deck sample range must be a positive integer no larger than 2^32');
  }
  if (!globalThis.crypto?.getRandomValues)
    throw new Error('DraftrollDeck requires WebCrypto or an injected random()');
  const limit = Math.floor(0x1_0000_0000 / upperExclusive) * upperExclusive;
  const data = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(data);
  } while (data[0] >= limit);
  return data[0] % upperExclusive;
}

function samplerFromRandom(random?: () => number): IndexSampler {
  if (!random) return secureIndex;
  return (upperExclusive) => {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
      throw new Error('Deck random() must return a value in [0, 1)');
    return Math.floor(sample * upperExclusive);
  };
}

function shuffle(items: unknown[], sampleIndex: IndexSampler): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = sampleIndex(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
}

/**
 * Owns generic shuffle/depletion/discard state while Draftroll remains stateless at the result boundary.
 * The card is selected before rendering; `toDisplayInput()` turns the draw into an exact external result.
 * Named game rules intentionally do not live here.
 * @public
 */
export class DraftrollDeck {
  readonly id: string;
  private readonly definitionState: CustomDiceDefinition;
  private readonly sampleIndex: IndexSampler;
  private readonly source: MutableDraftrollCard[];
  private drawPile: MutableDraftrollCard[];
  private discardPile: MutableDraftrollCard[] = [];
  private inPlay = new Map<string, MutableDraftrollCard>();

  /**
   * Creates an independent deck from system-agnostic card definitions.
   */
  constructor(
    id: string,
    cards: readonly DraftrollCardDefinition[],
    options: DraftrollDeckOptions = {},
  ) {
    this.id = id.trim();
    if (!this.id) throw new Error('A deck ID is required');
    if (!cards.length) throw new Error(`Deck '${this.id}' requires at least one card`);
    this.sampleIndex = samplerFromRandom(options.random);
    const normalized = cards.map((card, index) => {
      if (typeof card.result !== 'number' && typeof card.result !== 'string')
        throw new Error(`Card ${index + 1} requires a result`);
      if (typeof card.result === 'number' && !Number.isFinite(card.result))
        throw new Error(`Card ${index + 1} result must be finite`);
      if (card.value !== undefined && !Number.isFinite(card.value))
        throw new Error(`Card ${index + 1} value must be finite`);
      const copies = card.copies ?? 1;
      if (!Number.isSafeInteger(copies) || copies < 1)
        throw new Error(`Card ${index + 1} copies must be a positive safe integer`);
      return { ...card, copies, metadata: cloneMetadata(card.metadata) };
    });
    this.definitionState = {
      id: this.id,
      renderAs: 'card',
      metadata: cloneMetadata(options.metadata),
      faces: normalized.map(({ copies: _copies, ...card }) => ({
        ...card,
        metadata: cloneMetadata(card.metadata),
      })),
    };
    this.source = normalized.flatMap((card, faceIndex) =>
      Array.from({ length: card.copies }, (_, copyIndex) => ({
        id: `${this.id}:card:${faceIndex}:${copyIndex}`,
        deckId: this.id,
        faceIndex,
        copyIndex,
        result: card.result,
        numericValue: card.value ?? (typeof card.result === 'number' ? card.result : 0),
        label: card.label ?? String(card.result),
        metadata: cloneMetadata(card.metadata),
      })),
    );
    this.drawPile = this.source.map(cloneCard);
    if (options.shuffle !== false) this.shuffle();
  }

  /** Returns a detached custom-dice definition suitable for display/replay boundaries. */
  get definition(): CustomDiceDefinition {
    return cloneDefinition(this.definitionState);
  }

  /** Returns the total number of physical card copies in the deck. */
  get size(): number {
    return this.source.length;
  }
  /** Returns the number of cards currently available to draw. */
  get remaining(): number {
    return this.drawPile.length;
  }
  /** Returns the number of cards currently in the discard pile. */
  get discarded(): number {
    return this.discardPile.length;
  }
  /** Returns the number of cards currently drawn and still in play. */
  get active(): number {
    return this.inPlay.size;
  }
  /** Returns detached snapshots of the cards currently available to draw. */
  get remainingCards(): readonly DraftrollCard[] {
    return this.drawPile.map(snapshotCard);
  }
  /** Returns detached snapshots of the cards currently discarded. */
  get discardedCards(): readonly DraftrollCard[] {
    return this.discardPile.map(snapshotCard);
  }

  /** Randomizes the remaining draw pile in place. */
  shuffle(): this {
    shuffle(this.drawPile, this.sampleIndex);
    return this;
  }

  /** Draws cards from the current draw pile and marks them active. */
  draw(count = 1): DraftrollCardDraw {
    if (!Number.isSafeInteger(count) || count < 1)
      throw new Error('Draw count must be a positive safe integer');
    if (count > this.drawPile.length)
      throw new Error(`Deck '${this.id}' has only ${this.drawPile.length} card(s) remaining`);
    const cards: DraftrollCard[] = [];
    for (let i = 0; i < count; i += 1) {
      const card = this.drawPile.pop()!;
      this.inPlay.set(card.id, card);
      cards.push(snapshotCard(card));
    }
    const frozenCards = Object.freeze(cards.slice());
    const total = frozenCards.reduce((sum, card) => sum + card.numericValue, 0);
    return Object.freeze({
      deckId: this.id,
      cards: frozenCards,
      total,
      toDisplayInput: (options: DraftrollCardDisplayOptions = {}): DisplayRollInput => {
        const dice: ExternalDieResult[] = frozenCards.map((card) => ({
          id: card.id,
          type: this.id,
          customDiceId: this.id,
          faceIndex: card.faceIndex,
          result: card.result,
          numericValue: card.numericValue,
          kept: true,
          generatedBy: 'external',
          metadata: {
            ...cloneMetadata(card.metadata ? { ...card.metadata } : undefined),
            deckId: this.id,
            copyIndex: card.copyIndex,
          },
        }));
        return {
          mode: 'display',
          dice,
          total,
          name: options.name,
          expression: options.expression,
          themeId: options.themeId,
          annotation: options.annotation,
          comment: options.comment,
          customDice: [cloneDefinition(this.definitionState)],
          metadata: { ...cloneMetadata(options.metadata), deckId: this.id, cardDraw: true },
        };
      },
    });
  }

  /** Moves active cards into the discard pile as one atomic operation. */
  discard(cards: DraftrollCard | string | readonly (DraftrollCard | string)[]): this {
    const resolved = this.resolveActiveCards(cards);
    for (const card of resolved) {
      this.inPlay.delete(card.id);
      this.discardPile.push(card);
    }
    return this;
  }

  /** Returns active cards to the draw pile as one atomic operation, optionally reshuffling them. */
  return(
    cards: DraftrollCard | string | readonly (DraftrollCard | string)[],
    options: { shuffle?: boolean } = {},
  ): this {
    const resolved = this.resolveActiveCards(cards);
    for (const card of resolved) {
      this.inPlay.delete(card.id);
      this.drawPile.push(card);
    }
    if (options.shuffle !== false) this.shuffle();
    return this;
  }

  /** Moves every discarded card back into the draw pile and shuffles it. */
  reshuffleDiscard(): this {
    this.drawPile.push(...this.discardPile.splice(0));
    return this.shuffle();
  }
  /** Restores every card copy to the draw pile and optionally shuffles it. */
  reset(options: { shuffle?: boolean } = {}): this {
    this.inPlay.clear();
    this.discardPile = [];
    this.drawPile = this.source.map(cloneCard);
    if (options.shuffle !== false) this.shuffle();
    return this;
  }

  private resolveActiveCards(
    cards: DraftrollCard | string | readonly (DraftrollCard | string)[],
  ): MutableDraftrollCard[] {
    const items = Array.isArray(cards) ? cards : [cards];
    const ids = items.map((item) => (typeof item === 'string' ? item : item.id));
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new Error(`Deck '${this.id}' card operation contains duplicate card IDs`);
    }
    return ids.map((id) => {
      const card = this.inPlay.get(id);
      if (!card) throw new Error(`Card '${id}' is not active in deck '${this.id}'`);
      return card;
    });
  }
}

/**
 * Creates a stateful Draftroll deck from system-agnostic card definitions.
 *
 * @public
 */
export function createDeck(
  id: string,
  cards: readonly DraftrollCardDefinition[],
  options?: DraftrollDeckOptions,
): DraftrollDeck {
  return new DraftrollDeck(id, cards, options);
}
