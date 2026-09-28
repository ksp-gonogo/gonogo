import { createContext, type ReactNode, useContext, useRef } from "react";

/**
 * A per-panel React context so both a widget body and the panel chrome reach
 * the same off-tree store, scoped to the nearest provider.
 *
 * The provider creates one store and holds it for its whole life, so its
 * context value never changes identity; live data flows through the store's
 * own `subscribe`. `useStore` is `null` with no provider, which every reader
 * treats as a no-op. `Context` is returned raw for a caller that owns the
 * store's lifetime itself (a test injecting a pre-seeded store).
 */
export interface PanelStore<Store> {
  Context: React.Context<Store | null>;
  Provider: (props: { children?: ReactNode }) => ReactNode;
  useStore: () => Store | null;
}

export function createPanelStore<Store>(
  create: () => Store,
): PanelStore<Store> {
  const Context = createContext<Store | null>(null);

  function Provider({ children }: { children?: ReactNode }) {
    const storeRef = useRef<Store | null>(null);
    if (storeRef.current === null) storeRef.current = create();
    return (
      <Context.Provider value={storeRef.current}>{children}</Context.Provider>
    );
  }

  function useStore(): Store | null {
    return useContext(Context);
  }

  return { Context, Provider, useStore };
}
