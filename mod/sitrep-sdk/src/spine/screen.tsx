import type { ReactNode } from "react";
import { createContext, useContext } from "react";

/**
 * Which screen a component is mounted on. The same registered component
 * can render different UIs on main vs station when it participates in a
 * multi-role interaction (e.g. GO/NO-GO voting).
 */
export type Screen = "main" | "station";

const ScreenContext = createContext<Screen | null>(null);

export function ScreenProvider({
  value,
  children,
}: {
  value: Screen;
  children: ReactNode;
}) {
  return (
    <ScreenContext.Provider value={value}>{children}</ScreenContext.Provider>
  );
}

/**
 * Returns the current screen. Defaults to "main" outside a provider so
 * tests and one-off renders don't need to set one up for components that
 * don't actually branch. Components that rely on the distinction should
 * still wrap with a ScreenProvider explicitly.
 */
export function useScreen(): Screen {
  return useContext(ScreenContext) ?? "main";
}
