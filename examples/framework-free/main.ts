import { DraftrollSession } from '@draftroll/sdk/browser';
import { DraftrollTextRenderer } from '@draftroll/renderer';

const resultRegion = document.querySelector<HTMLElement>('#result');
if (!resultRegion) throw new Error('Missing result region');

const renderer = new DraftrollTextRenderer({ container: resultRegion });
const session = new DraftrollSession({ renderer });

document.querySelector<HTMLFormElement>('#roll-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const expression = document.querySelector<HTMLInputElement>('#formula')?.value ?? '1d20';
  void session.roll(expression, { metadata: { source: 'framework-free-example' } });
});
