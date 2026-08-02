import { Draftroll, DraftrollOverlayRenderer, type SdkRollResponse } from '../packages/sdk/src/browser';

const output = document.querySelector<HTMLPreElement>('#output');
const overlay = new DraftrollOverlayRenderer({
  src: '/overlay.html',
  results: {
    position: 'top-right',
    allowReroll: true,
    showThemes: true,
  },
});
await overlay.mount();
const draftroll = new Draftroll({ renderer: overlay });
let current: SdkRollResponse | null = null;

showMessage('Draftroll mounted. Create a roll, then revise it with or without animation.');

/** Runs an async click handler, reporting failures instead of leaving a floating promise. */
function onClick(selector: string, handler: () => Promise<void>): void {
  document.querySelector(selector)?.addEventListener('click', () => {
    handler().catch((error: unknown) => {
      showMessage(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
}

onClick('#attack', async () => {
  current = draftroll.roll('2d20kh1+5 [Attack]', {
    themes: ['dragon', 'frost'],
  });
  await showPresentation(current);
});

onClick('#mixed-themes', async () => {
  current = draftroll.roll('3d6+2 [Damage]', {
    themes: ['tempest', 'ember', 'wildwood'],
  });
  await showPresentation(current);
});

onClick('#correct-log', async () => {
  if (!current) {
    showMessage('Create a roll before updating it.');
    return;
  }
  current = current.update({
    dice: [{ id: current.result.dice[0].id, result: maximumFor(current.result.dice[0].type), themeId: 'ember' }],
    annotation: 'Corrected by the host application',
  }, {
    mode: 'log-only',
  });
  await showPresentation(current);
});

onClick('#replace-formula', async () => {
  if (!current) {
    showMessage('Create a roll before replacing its formula.');
    return;
  }
  current = current.update({
    expression: '3d20kh1+7 [Revised attack]',
  }, {
    mode: 'animate',
    reroll: true,
    animateDice: 'all',
    themes: ['dragon', 'frost', 'ember'],
  });
  await showPresentation(current);
});

document.querySelector('#clear')?.addEventListener('click', () => void overlay.clear());

async function showPresentation(response: SdkRollResponse): Promise<void> {
  showMessage(JSON.stringify({
    status: 'rolling',
    rollId: response.id,
    expression: response.result.expression,
  }, null, 2));
  await response.wait();
  showResult(response);
}

function showResult(response: SdkRollResponse): void {
  if (!output) return;
  output.textContent = JSON.stringify({
    current: response.result,
    logEntries: draftroll.rollLog.length,
    currentRevision: response.result.revision,
  }, null, 2);
}

function showMessage(message: string): void {
  if (output) output.textContent = message;
}

function maximumFor(type: string): number {
  const match = /^d(\d+)$/i.exec(type);
  return match ? Number(match[1]) : 1;
}
