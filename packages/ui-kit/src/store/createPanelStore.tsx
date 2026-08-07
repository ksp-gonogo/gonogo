import { createContext, type ReactNode, useContext, useRef } from "react";

/**
 * The one panel-specific difference on top of `createStore`: a per-panel React
 * context so both a widget body and the panel chrome reach the SAME off-tree
 * store, scoped to the nearest provider.
 *
 * `create` builds the store instance (any shape: the delay rail store, the
 * status store). The provider makes one and holds it in a ref for its whole
 * life, so its context value never changes identity and mounting it re-renders
 * nothing; the live data flows through the store's own `subscribe`, not the
 * context. `useStore` is `null` with no provider (a bare widget outside a
 * dashboard), which every reader treats as a no-op, the same posture the status
 * and delay hooks already take.
 *
 * `Context` is returned raw so a caller that owns the store's lifetime itself
 * (a `Panel` holding it in its own ref, a test injecting a pre-seeded store)
 * can render `<Context.Provider value={store}>` directly; `Provider` is the
 * common case that needs neither.
 */
export interface PanelStore<S> {
  Context: React.Context<S | null>;
  Provider: (props: { children?: ReactNode }) => ReactNode;
  useStore: () => S | null;
}

export function createPanelStore<S>(create: () => S): PanelStore<S> {
  const Context = createContext<S | null>(null);

  function Provider({ children }: { children?: ReactNode }) {
    const storeRef = useRef<S | null>(null);
    if (storeRef.current === null) storeRef.current = create();
    return (
      <Context.Provider value={storeRef.current}>{children}</Context.Provider>
    );
  }

  function useStore(): S | null {
    return useContext(Context);
  }

  return { Context, Provider, useStore };
}
