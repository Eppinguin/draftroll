import { DraftrollSession } from '@draftroll/sdk/headless';

const session = new DraftrollSession();
await session.connectRoom({
  url: process.env.DRAFTROLL_ROOM_URL,
  roomId: process.env.DRAFTROLL_ROOM_ID,
  token: process.env.DRAFTROLL_ROOM_TOKEN,
  participant: { participantId: 'rules-bot', sessionId: crypto.randomUUID(), name: 'Rules bot' },
  autoPresent: false,
});

const roll = await session.roll(process.argv[2] ?? '1d20');
console.log(JSON.stringify(roll.result, null, 2));
await session.dispose();
