/**
 * Vue bindings for a Draftroll lifecycle session.
 *
 * @remarks
 * Creates framework refs that track the session snapshot and active roll state.
 *
 * @packageDocumentation
 */

import type { DraftrollSession, DraftrollSessionRoll, DraftrollSessionSnapshot } from '../../sdk/src/index';

/**
 * Minimal readonly Vue ref shape used by the binding.
 *
 * @public
 */
export interface VueReadonlyRef<T> { readonly value: T }
/**
 * Minimal writable Vue ref shape used by the binding.
 *
 * @public
 */
export interface VueWritableRef<T> extends VueReadonlyRef<T> { value: T }
/**
 * Minimal Vue runtime surface required by the binding.
 *
 * @public
 */
export interface DraftrollVueRuntime {
  shallowRef<T>(value: T): VueWritableRef<T>;
  readonly<T>(value: VueWritableRef<T>): VueReadonlyRef<T>;
  onScopeDispose(cleanup: () => void): void;
}

/**
 * Vue refs and cleanup returned by the Draftroll binding.
 *
 * @public
 */
export interface DraftrollVueState {
  snapshot: VueReadonlyRef<DraftrollSessionSnapshot>;
  rolls: VueReadonlyRef<readonly DraftrollSessionRoll[]>;
  dispose(): void;
}

/**
 * Creates readonly Composition API state without coupling SDK entry points to Vue.
 *
 * @param Vue - Compatible Vue runtime used to create and dispose refs.
 * @param session - Lifecycle session whose state and roll log are observed.
 * @returns Readonly refs plus an idempotent manual cleanup function.
 *
 * @public
 */
export function useDraftroll(Vue: DraftrollVueRuntime, session: DraftrollSession): DraftrollVueState {
  const snapshot = Vue.shallowRef(session.snapshot);
  const rolls = Vue.shallowRef(session.rollLog);
  const updateState = () => { snapshot.value = session.snapshot; };
  const updateRolls = () => { rolls.value = session.rollLog; updateState(); };
  const unsubscribers = [
    session.on('state', updateState),
    session.on('rendererChanged', updateState),
    session.on('roll', updateRolls),
    session.on('hiddenRoll', updateRolls),
  ];
  const dispose = () => unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  Vue.onScopeDispose(dispose);
  return { snapshot: Vue.readonly(snapshot), rolls: Vue.readonly(rolls), dispose };
}
