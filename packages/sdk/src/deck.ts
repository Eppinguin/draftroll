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

type CardReference = Readonly<{
  faceIndex: number;
  copyIndex: number;
}>;

const MAXIMUM_DECK_SIZE = 100_000;

function cloneMetadata(
  value?: Readonly<Record<string, unknown>>,
  context = 'Deck metadata',
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof structuredClone !== 'function') {
    throw new Error('DraftrollDeck requires structuredClone() to isolate metadata safely');
  }
  try {
    return structuredClone(value) as Record<string, unknown>;
  } catch (cause) {
    throw new TypeError(`${context} must be structured-cloneable`, { cause });
  }
}

function cloneDefinition(definition: CustomDiceDefinition): CustomDiceDefinition {
  return {
    ...definition,
    metadata: cloneMetadata(definition.metadata, `Deck '${definition.id}' metadata`),
    faces: definition.faces.map((face, index) => ({
      ...face,
      metadata: cloneMetadata(face.metadata, `Deck '${definition.id}' face ${index + 1} metadata`),
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

function shuffle<T>(items: T[], sampleIndex: IndexSampler): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = sampleIndex(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function toDrawPile(cards: readonly CardReference[]): CardReference[] {
  return cards.slice().reverse();
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
  private readonly source: readonly CardReference[];
  private drawPile: CardReference[];
  private discardPile: CardReference[] = [];
  private inPlay = new Map<string, CardReference>();

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

    let totalCopies = 0;
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
      totalCopies += copies;
      if (totalCopies > MAXIMUM_DECK_SIZE) {
        throw new Error(`Deck '${this.id}' may contain at most ${MAXIMUM_DECK_SIZE} card copies`);
      }
      return {
        face: {
          result: card.result,
          value: card.value,
          label: card.label,
          metadata: cloneMetadata(card.metadata, `Card ${index + 1} metadata`),
        } satisfies CustomDieFace,
        copies,
      };
    });

    this.definitionState = {
      id: this.id,
      renderAs: 'card',
      metadata: cloneMetadata(options.metadata, `Deck '${this.id}' metadata`),
      faces: normalized.map(({ face }) => face),
    };

    const source: CardReference[] = [];
    normalized.forEach(({ copies }, faceIndex) => {
      for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
        source.push({ faceIndex, copyIndex });
      }
    });
    this.source = source;
    this.drawPile = toDrawPile(this.source);
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
  /** Returns detached snapshots in the same order they would be drawn. */
  get remainingCards(): readonly DraftrollCard[] {
    return this.drawPile
      .slice()
      .reverse()
      .map((reference) => this.snapshotCard(reference));
  }
  /** Returns detached snapshots of the cards currently discarded. */
  get discardedCards(): readonly DraftrollCard[] {
    return this.discardPile.map((reference) => this.snapshotCard(reference));
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

    const references: CardReference[] = [];
    for (let i = 0; i < count; i += 1) {
      const reference = this.drawPile.pop()!;
      this.inPlay.set(this.cardId(reference), reference);
      references.push(reference);
    }

    const cards = references.map((reference) => this.snapshotCard(reference));
    const total = references.reduce((sum, reference) => sum + this.numericValue(reference), 0);

    return {
      deckId: this.id,
      cards,
      total,
      toDisplayInput: (options: DraftrollCardDisplayOptions = {}): DisplayRollInput => ({
        mode: 'display',
        dice: references.map((reference) => this.externalResult(reference)),
        total,
        name: options.name,
        expression: options.expression,
        themeId: options.themeId,
        annotation: options.annotation,
        comment: options.comment,
        customDice: [cloneDefinition(this.definitionState)],
        metadata: {
          ...cloneMetadata(options.metadata, `Deck '${this.id}' display metadata`),
          deckId: this.id,
          cardDraw: true,
        },
      }),
    };
  }

  /** Moves active cards into the discard pile as one atomic operation. */
  discard(cards: DraftrollCard | string | readonly (DraftrollCard | string)[]): this {
    const resolved = this.resolveActiveCards(cards);
    for (const reference of resolved) {
      this.inPlay.delete(this.cardId(reference));
      this.discardPile.push(reference);
    }
    return this;
  }

  /** Returns active cards to the top of the draw pile as one atomic operation, optionally reshuffling. */
  return(
    cards: DraftrollCard | string | readonly (DraftrollCard | string)[],
    options: { shuffle?: boolean } = {},
  ): this {
    const resolved = this.resolveActiveCards(cards);
    for (const reference of resolved) this.inPlay.delete(this.cardId(reference));
    if (options.shuffle === true) {
      this.drawPile.push(...resolved);
      this.shuffle();
    } else {
      this.drawPile.push(...resolved.slice().reverse());
    }
    return this;
  }

  /** Moves every discarded card back into the draw pile and shuffles it. */
  reshuffleDiscard(): this {
    if (this.discardPile.length === 0) return this;
    this.drawPile.push(...this.discardPile.splice(0));
    return this.shuffle();
  }
  /** Restores every card copy to the draw pile and optionally shuffles it. */
  reset(options: { shuffle?: boolean } = {}): this {
    this.inPlay.clear();
    this.discardPile = [];
    this.drawPile = toDrawPile(this.source);
    if (options.shuffle !== false) this.shuffle();
    return this;
  }

  private cardId(reference: CardReference): string {
    return `${this.id}:card:${reference.faceIndex}:${reference.copyIndex}`;
  }

  private face(reference: CardReference): CustomDieFace {
    return this.definitionState.faces[reference.faceIndex];
  }

  private numericValue(reference: CardReference): number {
    const face = this.face(reference);
    return face.value ?? (typeof face.result === 'number' ? face.result : 0);
  }

  private snapshotCard(reference: CardReference): DraftrollCard {
    const face = this.face(reference);
    return {
      id: this.cardId(reference),
      deckId: this.id,
      faceIndex: reference.faceIndex,
      copyIndex: reference.copyIndex,
      result: face.result,
      numericValue: this.numericValue(reference),
      label: face.label ?? String(face.result),
      metadata: cloneMetadata(
        face.metadata,
        `Deck '${this.id}' face ${reference.faceIndex + 1} metadata`,
      ),
    };
  }

  private externalResult(reference: CardReference): ExternalDieResult {
    const card = this.snapshotCard(reference);
    return {
      id: card.id,
      type: this.id,
      customDiceId: this.id,
      faceIndex: card.faceIndex,
      result: card.result,
      numericValue: card.numericValue,
      kept: true,
      generatedBy: 'external',
      metadata: {
        ...cloneMetadata(card.metadata, `Card '${card.id}' metadata`),
        deckId: this.id,
        copyIndex: card.copyIndex,
      },
    };
  }

  private resolveActiveCards(
    cards: DraftrollCard | string | readonly (DraftrollCard | string)[],
  ): CardReference[] {
    const items = Array.isArray(cards) ? cards : [cards];
    const ids = items.map((item) => (typeof item === 'string' ? item : item.id));
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new Error(`Deck '${this.id}' card operation contains duplicate card IDs`);
    }
    return ids.map((id) => {
      const reference = this.inPlay.get(id);
      if (!reference) throw new Error(`Card '${id}' is not active in deck '${this.id}'`);
      return reference;
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
