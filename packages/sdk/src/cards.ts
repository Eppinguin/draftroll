/**
 * System-agnostic helpers for standard French-suited playing-card decks.
 *
 * @packageDocumentation
 */

import { DraftrollDeck, type DraftrollCardDefinition, type DraftrollDeckOptions } from './deck';

/**
 * Suit identifiers used by the standard playing-card helpers.
 *
 * @public
 */
export type StandardSuit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
/**
 * Rank identifiers used by the standard playing-card helpers.
 *
 * @public
 */
export type StandardRank =
  | 'A'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K';

/**
 * Configures construction of a standard French-suited Draftroll deck.
 *
 * @public
 */
export interface StandardDeckOptions extends DraftrollDeckOptions {
  /** Number of generic jokers to append. Defaults to zero. */
  jokers?: 0 | 1 | 2;
}

const SUITS: ReadonlyArray<{
  id: StandardSuit;
  symbol: string;
  label: string;
  color: 'red' | 'black';
}> = [
  { id: 'spades', symbol: '♠', label: 'Spades', color: 'black' },
  { id: 'hearts', symbol: '♥', label: 'Hearts', color: 'red' },
  { id: 'diamonds', symbol: '♦', label: 'Diamonds', color: 'red' },
  { id: 'clubs', symbol: '♣', label: 'Clubs', color: 'black' },
];

const RANKS: ReadonlyArray<{ id: StandardRank; label: string }> = [
  { id: 'A', label: 'Ace' },
  { id: '2', label: 'Two' },
  { id: '3', label: 'Three' },
  { id: '4', label: 'Four' },
  { id: '5', label: 'Five' },
  { id: '6', label: 'Six' },
  { id: '7', label: 'Seven' },
  { id: '8', label: 'Eight' },
  { id: '9', label: 'Nine' },
  { id: '10', label: 'Ten' },
  { id: 'J', label: 'Jack' },
  { id: 'Q', label: 'Queen' },
  { id: 'K', label: 'King' },
];

/**
 * Returns generic French-suited playing-card definitions.
 *
 * @remarks
 * Numeric values intentionally remain zero. Blackjack values, poker ranking, trump rules, and
 * every other game-specific interpretation belong to the consuming application.
 *
 * @public
 */
export function standardPlayingCards(
  options: Pick<StandardDeckOptions, 'jokers'> = {},
): DraftrollCardDefinition[] {
  const cards: DraftrollCardDefinition[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({
        result: `${rank.id}${suit.symbol}`,
        value: 0,
        label: `${rank.id}${suit.symbol}`,
        metadata: {
          rank: rank.id,
          rankLabel: rank.label,
          suit: suit.id,
          suitLabel: suit.label,
          suitSymbol: suit.symbol,
          color: suit.color,
          cardLabel: `${rank.label} of ${suit.label}`,
        },
      });
    }
  }
  const jokers = options.jokers ?? 0;
  for (let index = 0; index < jokers; index += 1) {
    cards.push({
      result: `joker-${index + 1}`,
      value: 0,
      label: 'Joker',
      metadata: { joker: true, jokerIndex: index + 1, cardLabel: 'Joker' },
    });
  }
  return cards;
}

/**
 * Creates a shuffled, stateful standard playing-card deck.
 *
 * @public
 */
export function createStandardDeck(
  id = 'standard-52',
  options: StandardDeckOptions = {},
): DraftrollDeck {
  const { jokers = 0, ...deckOptions } = options;
  return new DraftrollDeck(id, standardPlayingCards({ jokers }), {
    ...deckOptions,
    metadata: {
      name:
        jokers > 0
          ? `Standard deck + ${jokers} joker${jokers === 1 ? '' : 's'}`
          : 'Standard 52-card deck',
      deckKind: 'standard-playing-cards',
      ...deckOptions.metadata,
    },
  });
}
