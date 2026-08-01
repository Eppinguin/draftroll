import { Draftroll } from '@draftroll/sdk/browser';

const draftroll = await Draftroll.createOverlay({
  overlayUrl: '/draftroll/overlay.html',
  resultPanel: { position: 'bottom-right' },
});

document.querySelector('#roll')?.addEventListener('click', () => {
  void draftroll.roll('2d6+3', { metadata: { source: 'stream-overlay' } });
});
