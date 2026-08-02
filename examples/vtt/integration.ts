import { DraftrollSession, type DraftrollSessionRoll } from '@draftroll/sdk/browser';

export interface VttChatAdapter {
  publishRoll(roll: DraftrollSessionRoll): void;
}

export function connectDraftrollToVtt(session: DraftrollSession, chat: VttChatAdapter): () => void {
  return session.on('roll', (roll) => chat.publishRoll(roll));
}

export async function rollSelectedToken(
  session: DraftrollSession,
  tokenId: string,
  formula: string,
) {
  return session.roll(formula, { metadata: { source: 'vtt', tokenId } });
}
