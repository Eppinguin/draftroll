/**
 * React bindings for a Draftroll lifecycle session.
 *
 * @remarks
 * The package is runtime-injected so it does not bundle or pin a second React copy.
 *
 * @packageDocumentation
 */

import { DraftrollStateError } from '../../errors/src/index';
import type {
  DraftrollSession,
  DraftrollSessionRoll,
  DraftrollSessionSnapshot,
} from '../../sdk/src/index';

/**
 * React context value exposing a session and its current snapshot.
 *
 * @public
 */
export interface DraftrollReactContext<T> {
  Provider: unknown;
  _defaultValue?: T;
}

/**
 * Minimal React runtime surface required by the binding factory.
 *
 * @public
 */
export interface DraftrollReactRuntime {
  createContext<T>(defaultValue: T): DraftrollReactContext<T>;
  createElement(type: unknown, props: Record<string, unknown>, ...children: unknown[]): unknown;
  useContext<T>(context: DraftrollReactContext<T>): T;
  useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T;
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void;
  useSyncExternalStore<T>(
    subscribe: (notify: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T;
}

/**
 * Props accepted by the generated Draftroll provider component.
 *
 * @public
 */
export interface DraftrollProviderProps {
  session: DraftrollSession;
  children?: unknown;
  disposeOnUnmount?: boolean;
}

/**
 * Provider and hooks returned by the React binding factory.
 *
 * @public
 */
export interface DraftrollReactBindings {
  DraftrollContext: DraftrollReactContext<DraftrollSession | null>;
  DraftrollProvider(props: DraftrollProviderProps): unknown;
  useDraftrollSession(): DraftrollSession;
  useDraftrollSnapshot(): DraftrollSessionSnapshot;
  useDraftrollRolls(): readonly DraftrollSessionRoll[];
  useDraftrollRoll(rollId: string): DraftrollSessionRoll | null;
}

/**
 * Creates provider and hook bindings against the consumer’s React runtime.
 *
 * @remarks
 * Runtime injection keeps React a peer dependency and prevents headless SDK entry points from importing it.
 *
 * @param React - Compatible React runtime used to create context and hooks.
 * @returns A provider plus session, snapshot, and roll hooks bound to that runtime.
 *
 * @public
 */
export function createDraftrollReactBindings(React: DraftrollReactRuntime): DraftrollReactBindings {
  const DraftrollContext = React.createContext<DraftrollSession | null>(null);

  function DraftrollProvider(props: DraftrollProviderProps): unknown {
    React.useEffect(() => {
      // Returning `undefined` tells React there is no cleanup for this effect.
      if (!props.disposeOnUnmount) return undefined;
      return () => {
        void props.session.dispose();
      };
    }, [props.session, props.disposeOnUnmount]);
    return React.createElement(DraftrollContext.Provider, { value: props.session }, props.children);
  }

  function useDraftrollSession(): DraftrollSession {
    const session = React.useContext(DraftrollContext);
    if (!session)
      throw new DraftrollStateError('useDraftrollSession must be used inside DraftrollProvider', {
        package: 'sdk',
      });
    return session;
  }

  function useVersionedSnapshot<T>(read: (session: DraftrollSession) => T): T {
    const session = useDraftrollSession();
    const subscription = React.useMemo(() => createSessionSubscription(session), [session]);
    return React.useSyncExternalStore(
      subscription.subscribe,
      () => read(session),
      () => read(session),
    );
  }

  return {
    DraftrollContext,
    DraftrollProvider,
    useDraftrollSession,
    useDraftrollSnapshot: () => useVersionedSnapshot((session) => session.snapshot),
    useDraftrollRolls: () => useVersionedSnapshot((session) => session.rollLog),
    useDraftrollRoll: (rollId) => useVersionedSnapshot((session) => session.getRoll(rollId)),
  };
}

function createSessionSubscription(session: DraftrollSession): {
  subscribe(this: void, notify: () => void): () => void;
} {
  return {
    // `this: void` documents and enforces that the method is safe to pass unbound,
    // which `useSyncExternalStore` requires.
    subscribe(this: void, notify) {
      const unsubscribers = [
        session.on('state', notify),
        session.on('rendererChanged', notify),
        session.on('roll', notify),
        session.on('hiddenRoll', notify),
      ];
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
  };
}
