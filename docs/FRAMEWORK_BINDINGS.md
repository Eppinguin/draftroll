# Framework bindings

Draftroll framework bindings are optional adapters over `DraftrollSession`. They do not contain application-specific state and do not pull React, Vue, or Svelte into headless SDK entry points.

## React

`@draftroll/react` uses a consumer-supplied React runtime so React remains a peer dependency.

```tsx
import * as React from 'react';
import { createDraftrollReactBindings } from '@draftroll/react';
import { DraftrollSession } from '@draftroll/sdk/browser';

const session = new DraftrollSession();
const { DraftrollProvider, useDraftrollSnapshot, useDraftrollRolls } =
  createDraftrollReactBindings(React);

function DicePanel() {
  const snapshot = useDraftrollSnapshot();
  const rolls = useDraftrollRolls();
  return (
    <output>
      {snapshot.status}: {rolls.length} rolls
    </output>
  );
}

export function App() {
  return (
    <DraftrollProvider session={session} disposeOnUnmount>
      <DicePanel />
    </DraftrollProvider>
  );
}
```

The hooks use `useSyncExternalStore`, provide a server snapshot, and keep the same session object across local/realtime and renderer transitions.

## Vue

```ts
import * as Vue from 'vue';
import { useDraftroll } from '@draftroll/vue';

const state = useDraftroll(Vue, session);
// state.snapshot and state.rolls are readonly refs.
```

The adapter unregisters its listeners on scope disposal. `dispose()` is also exposed for non-component scopes.

## Svelte

```ts
import { createDraftrollStore } from '@draftroll/svelte';

const draftroll = createDraftrollStore(session);
const unsubscribe = draftroll.subscribe(({ session, rolls }) => {
  console.log(session.status, rolls.length);
});
```

The store follows the standard readable-store contract and emits immediately on subscription.

## Binding boundary

Framework packages import only SDK types at runtime, except the React adapter's shared state error. They never import Three.js, Cannon-es, the overlay runtime, or Worker code. Use the generic session/events directly when an application already has a state-management layer.
