import { DraftrollSession, type DraftrollRoomRoll } from '../../packages/sdk/src/browser';

const session = new DraftrollSession();
let latest: DraftrollRoomRoll | null = null;
const events = document.querySelector<HTMLElement>('#events');
const report = (value: unknown) => {
  if (events) events.textContent += `${JSON.stringify(value)}\n`;
};

session.on('roll', (roll) => {
  latest = roll;
  report({ visible: true, id: roll.id, total: roll.total });
});
session.on('hiddenRoll', (roll) => report({ visible: false, id: roll.id }));

document.querySelector('#connect')?.addEventListener('click', () => {
  const participantId =
    document.querySelector<HTMLInputElement>('#participant')?.value ?? crypto.randomUUID();
  void session.connectRoom({
    url: 'ws://127.0.0.1:8787/rooms/hidden/connect',
    roomId: 'hidden',
    participant: { participantId, sessionId: crypto.randomUUID(), name: participantId },
    autoPresent: false,
  });
});
document.querySelector('#hidden')?.addEventListener('click', () => {
  void session.roll('1d20', { visibility: { type: 'roller' } }).then(
    (roll) => {
      latest = roll;
    },
    (error: unknown) => {
      report({ error: error instanceof Error ? error.message : String(error) });
    },
  );
});
document.querySelector('#reveal')?.addEventListener('click', () => {
  if (latest) void latest.reveal({ audit: { reason: 'Example reveal' } });
});
