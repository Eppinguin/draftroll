import * as React from 'react';
import { DraftrollSession } from '@draftroll/sdk/browser';
import { createDraftrollReactBindings } from '@draftroll/react';

const { DraftrollProvider, useDraftrollRolls, useDraftrollSession } =
  createDraftrollReactBindings(React);
const session = new DraftrollSession();

function Roller() {
  const draftroll = useDraftrollSession();
  const rolls = useDraftrollRolls();
  return (
    <>
      <button onClick={() => void draftroll.roll('1d20+5')}>Roll</button>
      <output aria-live="polite">{rolls.at(-1)?.total ?? '—'}</output>
    </>
  );
}

export function App() {
  return (
    <DraftrollProvider session={session} disposeOnUnmount>
      <Roller />
    </DraftrollProvider>
  );
}
