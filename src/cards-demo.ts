import { Draftroll } from '../packages/sdk/src/index';
import { createStandardDeck } from '../packages/sdk/src/cards';
import type { DraftrollCard } from '../packages/sdk/src/deck';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing cards demo element: ${selector}`);
  return element;
}

const remaining = requireElement<HTMLElement>('#card-remaining');
const discarded = requireElement<HTMLElement>('#card-discarded');
const discardTop = requireElement<HTMLElement>('#discard-top');
const drawCount = requireElement<HTMLSelectElement>('#card-draw-count');
const theme = requireElement<HTMLSelectElement>('#card-theme');
const jokers = requireElement<HTMLInputElement>('#card-jokers');
const drawButton = requireElement<HTMLButtonElement>('#card-draw');
const deckButton = requireElement<HTMLButtonElement>('#card-deck');
const shuffleButton = requireElement<HTMLButtonElement>('#card-shuffle');
const resetButton = requireElement<HTMLButtonElement>('#card-reset');
const hand = requireElement<HTMLElement>('#card-hand');
const handTitle = requireElement<HTMLElement>('#hand-title');
const status = requireElement<HTMLElement>('#card-status');

const draftroll = await Draftroll.createOverlay({
  overlay: {
    src: '/overlay.html',
    dismissOnPointer: false,
    dismissDurationMs: 260,
    dismissResultPanel: true,
    fallbackThemeId: 'dragon',
    results: {
      position: 'bottom-right',
      title: 'Latest draw',
      allowReroll: false,
      showThemes: true,
    },
  },
  warmupThemes: ['dragon'],
});

let deck = createStandardDeck('demo-standard-deck');
let currentHand: DraftrollCard[] = [];
let busy = false;

function cardName(card: DraftrollCard): string {
  return typeof card.metadata?.cardLabel === 'string' ? card.metadata.cardLabel : card.label;
}

function renderHand(): void {
  hand.replaceChildren();
  if (currentHand.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hand';
    empty.textContent = 'Draw from the deck to deal cards onto the Draftroll table.';
    hand.append(empty);
    handTitle.textContent = 'No cards drawn';
    return;
  }

  handTitle.textContent = `${currentHand.length} card${currentHand.length === 1 ? '' : 's'} dealt`;
  currentHand.forEach((card, index) => {
    const element = document.createElement('article');
    const color = card.metadata?.color === 'red' ? ' red' : '';
    element.className = `playing-card${color}`;
    element.style.setProperty('--rotation', `${(index - (currentHand.length - 1) / 2) * 1.6}deg`);
    element.title = cardName(card);

    const rank = document.createElement('div');
    rank.className = 'card-rank';
    rank.textContent = typeof card.metadata?.rank === 'string' ? card.metadata.rank : card.label;
    const suit = document.createElement('div');
    suit.className = 'card-suit';
    suit.textContent = typeof card.metadata?.suitSymbol === 'string' ? card.metadata.suitSymbol : '✦';
    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = cardName(card);
    element.append(rank, suit, name);
    hand.append(element);
  });
}

function renderDeckState(): void {
  remaining.textContent = String(deck.remaining);
  discarded.textContent = String(deck.discarded);
  const top = deck.discardedCards.at(-1);
  discardTop.textContent = top ? top.label : '—';
  drawButton.disabled = busy || deck.remaining === 0;
  deckButton.disabled = busy || deck.remaining === 0;
  shuffleButton.disabled = busy;
  resetButton.disabled = busy;
}

function sweepCurrentHand(): void {
  if (currentHand.length === 0) return;
  deck.discard(currentHand);
  currentHand = [];
}

async function drawCards(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    sweepCurrentHand();
    const count = Math.max(1, Number(drawCount.value) || 1);
    if (count > deck.remaining) deck.reshuffleDiscard();
    if (count > deck.remaining) throw new Error(`Only ${deck.remaining} cards remain in the deck`);

    const draw = deck.draw(count);
    currentHand = [...draw.cards];
    renderHand();
    renderDeckState();
    status.textContent = 'Dealing…';

    const response = draftroll.display(
      draw.toDisplayInput({
        name: 'Card draw',
        expression: `deck:${count}`,
        themeId: theme.value,
        metadata: {
          source: 'cards-demo',
          deckRemaining: deck.remaining,
          deckDiscarded: deck.discarded,
        },
      }),
      { defaultThemeId: theme.value },
    );
    await response.wait();
    status.textContent = `Dealt ${count} · ${deck.remaining} remaining`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
    renderDeckState();
  }
}

function shuffleAll(): void {
  if (busy) return;
  sweepCurrentHand();
  deck.reshuffleDiscard();
  currentHand = [];
  void draftroll.clearDice();
  renderHand();
  renderDeckState();
  status.textContent = 'Discard returned and deck shuffled';
}

function resetDeck(): void {
  if (busy) return;
  deck.reset({ shuffle: true });
  currentHand = [];
  void draftroll.clearDice();
  renderHand();
  renderDeckState();
  status.textContent = 'Fresh shuffled deck';
}

function rebuildDeck(): void {
  if (busy) return;
  deck = createStandardDeck('demo-standard-deck', { jokers: jokers.checked ? 2 : 0 });
  currentHand = [];
  void draftroll.clearDice();
  renderHand();
  renderDeckState();
  status.textContent = jokers.checked ? 'Fresh 54-card deck' : 'Fresh 52-card deck';
}

drawButton.addEventListener('click', () => void drawCards());
deckButton.addEventListener('click', () => void drawCards());
shuffleButton.addEventListener('click', shuffleAll);
resetButton.addEventListener('click', resetDeck);
jokers.addEventListener('change', rebuildDeck);

renderHand();
renderDeckState();
status.textContent = 'Ready';
