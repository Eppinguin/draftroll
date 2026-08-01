import { Draftroll } from '@draftroll/sdk/browser';

const draftroll = await Draftroll.createOverlay({
  overlayUrl: 'https://assets.example.test/draftroll/overlay.html',
  targetOrigin: 'https://assets.example.test',
});
document.querySelector('#roll')?.addEventListener('click', () => void draftroll.roll('1d20'));
