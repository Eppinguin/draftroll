/**
 * Svelte store bindings for a Draftroll lifecycle session.
 *
 * @remarks
 * Creates a readable store that mirrors session snapshots and disposes subscriptions predictably.
 *
 * @packageDocumentation
 */

import type { DraftrollSession, DraftrollSessionRoll, DraftrollSessionSnapshot } from '../../sdk/src/index';

/**
 * Svelte store snapshot containing session state and retained rolls.
 *
 * @public
 */
export interface DraftrollSvelteSnapshot {
  session: DraftrollSessionSnapshot;
  rolls: readonly DraftrollSessionRoll[];
}

/**
 * Readable Svelte-compatible store plus deterministic cleanup.
 *
 * @public
 */
export interface DraftrollSvelteStore {
  subscribe(run: (value: DraftrollSvelteSnapshot) => void): () => void;
}

/**
 * Creates a Svelte-compatible readable store for one lifecycle session.
 *
 * @param session - Lifecycle session whose snapshot and roll log are observed.
 * @returns A store whose unsubscribe function releases every session listener.
 *
 * @public
 */
export function createDraftrollStore(session: DraftrollSession): DraftrollSvelteStore {
  return {
    subscribe(run) {
      const emit = () => run({ session: session.snapshot, rolls: session.rollLog });
      emit();
      const unsubscribers = [
        session.on('state', emit),
        session.on('rendererChanged', emit),
        session.on('roll', emit),
        session.on('hiddenRoll', emit),
      ];
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
  };
}
