import type { ReactNode } from "react";
import { createContext, useContext } from "react";

/**
 * Which screen a component is mounted on: a DEPLOYMENT CONFIGURATION, not a
 * role. `"main"` is direct-WS and peer-hosting, `"station"` is peer-fed,
 * `"pilot"` is direct-WS aboard the craft without hosting. The same registered
 * component can render different UIs on each when it participates in a
 * multi-role interaction (e.g. GO/NO-GO voting).
 */
export type Screen = "main" | "station" | "pilot";

/**
 * Where the operator is physically sitting. Every widget rule that cares about
 * light-time is a rule about the seat, never about the screen: a pilot on a
 * peer-fed page is a different screen and the same seat.
 */
export type Seat = "mission-control" | "pilot";

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

/**
 * Which seat a screen puts the operator in. A widget declares against the
 * SEAT, never the screen: a future remote pilot (peer-fed, aboard) lands as
 * one more screen mapping to `"pilot"` and every existing declaration stays
 * correct.
 */
export function seatOf(screen: Screen): Seat {
  return screen === "pilot" ? "pilot" : "mission-control";
}

/** The seat the current screen puts the operator in. */
export function useSeat(): Seat {
  return seatOf(useScreen());
}

/** Is the operator aboard the craft rather than at a command centre? */
export function useIsPilot(): boolean {
  return useSeat() === "pilot";
}
