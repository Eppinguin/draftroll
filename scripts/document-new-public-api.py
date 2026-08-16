from pathlib import Path


def replace_once(path: str, before: str, after: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(before)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    target.write_text(source.replace(before, after, 1))


poly = Path('packages/renderer/src/polyhedra.ts')
source = poly.read_text()
package_doc = """/**
 * Generated readable convex-polyhedron geometry for physical Draftroll dice.
 *
 * @packageDocumentation
 */

"""
if not source.startswith('export type PolyhedronVertex'):
    raise SystemExit('polyhedra entry point has unexpected header')
source = package_doc + source
poly.write_text(source)
replace_once(
    str(poly),
    'export type PolyhedronVertex = readonly [number, number, number];',
    """/**
 * Immutable local-space XYZ coordinate used by generated physical geometry.
 *
 * @public
 */
export type PolyhedronVertex = readonly [number, number, number];""",
    'PolyhedronVertex docs',
)
replace_once(
    str(poly),
    "export type PolyhedronLabelKind = 'face' | 'edge' | 'vertex';",
    """/**
 * Surface feature used to place a readable outcome label on a generated die.
 *
 * @public
 */
export type PolyhedronLabelKind = 'face' | 'edge' | 'vertex';""",
    'PolyhedronLabelKind docs',
)
replace_once(
    str(poly),
    'export interface PolyhedronLabelAnchor {',
    """/**
 * Local-space placement and orientation for one printed outcome label.
 *
 * @public
 */
export interface PolyhedronLabelAnchor {""",
    'PolyhedronLabelAnchor docs',
)
replace_once(
    str(poly),
    'export interface PolyhedronOutcome {',
    """/**
 * Maps one logical die outcome to its physical support state and readable labels.
 *
 * @public
 */
export interface PolyhedronOutcome {""",
    'PolyhedronOutcome docs',
)
replace_once(
    str(poly),
    'export interface ReadablePolyhedron {',
    """/**
 * Serializable generated convex geometry with explicit physical outcome semantics.
 *
 * @public
 */
export interface ReadablePolyhedron {""",
    'ReadablePolyhedron docs',
)
replace_once(
    str(poly),
    'export interface ReadablePolyhedronOptions {',
    """/**
 * Bounds the complexity of generated physical die geometry.
 *
 * @public
 */
export interface ReadablePolyhedronOptions {""",
    'ReadablePolyhedronOptions docs',
)
replace_once(
    str(poly),
    """ * Geometry never determines randomness; Draftroll supplies the authoritative
 * logical result and the renderer uses its outcome only for presentation.
 */
export function createReadablePolyhedron""",
    """ * Geometry never determines randomness; Draftroll supplies the authoritative
 * logical result and the renderer uses its outcome only for presentation.
 *
 * @public
 */
export function createReadablePolyhedron""",
    'createReadablePolyhedron release tag',
)

cards = Path('packages/sdk/src/cards.ts')
source = cards.read_text()
package_doc = """/**
 * System-agnostic helpers for standard French-suited playing-card decks.
 *
 * @packageDocumentation
 */

"""
if not source.startswith('import {'):
    raise SystemExit('cards entry point has unexpected header')
cards.write_text(package_doc + source)
replace_once(
    str(cards),
    "export type StandardSuit = 'spades' | 'hearts' | 'diamonds' | 'clubs';",
    """/**
 * Suit identifiers used by the standard playing-card helpers.
 *
 * @public
 */
export type StandardSuit = 'spades' | 'hearts' | 'diamonds' | 'clubs';""",
    'StandardSuit docs',
)
replace_once(
    str(cards),
    "export type StandardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';",
    """/**
 * Rank identifiers used by the standard playing-card helpers.
 *
 * @public
 */
export type StandardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';""",
    'StandardRank docs',
)
replace_once(
    str(cards),
    'export interface StandardDeckOptions extends DraftrollDeckOptions {',
    """/**
 * Configures construction of a standard French-suited Draftroll deck.
 *
 * @public
 */
export interface StandardDeckOptions extends DraftrollDeckOptions {""",
    'StandardDeckOptions docs',
)
replace_once(
    str(cards),
    """ * every other game-specific interpretation belong to the consuming application.
 */
export function standardPlayingCards""",
    """ * every other game-specific interpretation belong to the consuming application.
 *
 * @public
 */
export function standardPlayingCards""",
    'standardPlayingCards release tag',
)
replace_once(
    str(cards),
    '/** Creates a shuffled, stateful standard playing-card deck. */\nexport function createStandardDeck',
    """/**
 * Creates a shuffled, stateful standard playing-card deck.
 *
 * @public
 */
export function createStandardDeck""",
    'createStandardDeck docs',
)

deck = Path('packages/sdk/src/deck.ts')
source = deck.read_text()
old_header = '/** Stateful, system-agnostic card decks for Draftroll. */\n'
new_header = """/**
 * Stateful, system-agnostic card deck primitives for Draftroll.
 *
 * @packageDocumentation
 */
"""
if source.count(old_header) != 1:
    raise SystemExit('deck package header not found')
deck.write_text(source.replace(old_header, new_header, 1))
replace_once(
    str(deck),
    "export interface DraftrollCardDefinition extends Omit<CustomDieFace, 'weight'> {",
    """/**
 * Defines one card face and optional duplicate count inside a deck.
 *
 * @public
 */
export interface DraftrollCardDefinition extends Omit<CustomDieFace, 'weight'> {""",
    'DraftrollCardDefinition docs',
)
replace_once(
    str(deck),
    'export interface DraftrollDeckOptions {',
    """/**
 * Configures initial shuffle behavior, randomness, and deck metadata.
 *
 * @public
 */
export interface DraftrollDeckOptions {""",
    'DraftrollDeckOptions docs',
)
replace_once(
    str(deck),
    'export interface DraftrollCard {',
    """/**
 * Immutable public snapshot of a concrete card copy in a deck.
 *
 * @public
 */
export interface DraftrollCard {""",
    'DraftrollCard docs',
)
replace_once(
    str(deck),
    'export interface DraftrollCardDisplayOptions {',
    """/**
 * Presentation metadata applied when a card draw is converted to display input.
 *
 * @public
 */
export interface DraftrollCardDisplayOptions {""",
    'DraftrollCardDisplayOptions docs',
)
replace_once(
    str(deck),
    'export interface DraftrollCardDraw {',
    """/**
 * Result of drawing one or more cards, including exact display conversion.
 *
 * @public
 */
export interface DraftrollCardDraw {""",
    'DraftrollCardDraw docs',
)
replace_once(
    str(deck),
    '  constructor(\n    id: string,',
    """  /**
   * Creates an independent deck from system-agnostic card definitions.
   */
  constructor(
    id: string,""",
    'DraftrollDeck constructor docs',
)
replace_once(
    str(deck),
    '  get size(): number {',
    """  /** Returns the total number of physical card copies in the deck. */
  get size(): number {""",
    'deck size docs',
)
replace_once(
    str(deck),
    '  get remaining(): number {',
    """  /** Returns the number of cards currently available to draw. */
  get remaining(): number {""",
    'deck remaining docs',
)
replace_once(
    str(deck),
    '  get discarded(): number {',
    """  /** Returns the number of cards currently in the discard pile. */
  get discarded(): number {""",
    'deck discarded docs',
)
replace_once(
    str(deck),
    '  get active(): number {',
    """  /** Returns the number of cards currently drawn and still in play. */
  get active(): number {""",
    'deck active docs',
)
replace_once(
    str(deck),
    '  get remainingCards(): readonly DraftrollCard[] {',
    """  /** Returns detached snapshots of the cards currently available to draw. */
  get remainingCards(): readonly DraftrollCard[] {""",
    'remainingCards docs',
)
replace_once(
    str(deck),
    '  get discardedCards(): readonly DraftrollCard[] {',
    """  /** Returns detached snapshots of the cards currently discarded. */
  get discardedCards(): readonly DraftrollCard[] {""",
    'discardedCards docs',
)
replace_once(
    str(deck),
    '  shuffle(): this {',
    """  /** Randomizes the remaining draw pile in place. */
  shuffle(): this {""",
    'shuffle docs',
)
replace_once(
    str(deck),
    '  draw(count = 1): DraftrollCardDraw {',
    """  /** Draws cards from the current draw pile and marks them active. */
  draw(count = 1): DraftrollCardDraw {""",
    'draw docs',
)
replace_once(
    str(deck),
    '  discard(cards: DraftrollCard | string | readonly (DraftrollCard | string)[]): this {',
    """  /** Moves active cards into the discard pile. */
  discard(cards: DraftrollCard | string | readonly (DraftrollCard | string)[]): this {""",
    'discard docs',
)
replace_once(
    str(deck),
    '  return(\n    cards: DraftrollCard | string | readonly (DraftrollCard | string)[],',
    """  /** Returns active cards to the draw pile, optionally reshuffling them. */
  return(
    cards: DraftrollCard | string | readonly (DraftrollCard | string)[],""",
    'return docs',
)
replace_once(
    str(deck),
    '  reshuffleDiscard(): this {',
    """  /** Moves every discarded card back into the draw pile and shuffles it. */
  reshuffleDiscard(): this {""",
    'reshuffleDiscard docs',
)
replace_once(
    str(deck),
    '  reset(options: { shuffle?: boolean } = {}): this {',
    """  /** Restores every card copy to the draw pile and optionally shuffles it. */
  reset(options: { shuffle?: boolean } = {}): this {""",
    'reset docs',
)
replace_once(
    str(deck),
    'export function createDeck(\n  id: string,',
    """/**
 * Creates a stateful Draftroll deck from system-agnostic card definitions.
 *
 * @public
 */
export function createDeck(
  id: string,""",
    'createDeck docs',
)
