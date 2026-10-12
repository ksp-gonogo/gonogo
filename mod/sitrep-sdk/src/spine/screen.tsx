import type { ReactNode } from "react";
import { createContext, useContext } from "react";

/**
 * Which kind of screen a component is mounted on, by how that screen gets its
 * data. `"main"` reads the game's stream directly and hosts station screens,
 * `"station"` is fed by a main screen over a peer connection, and `"pilot"`
 * reads the stream directly aboard the craft and hosts nothing. Useful for a
 * component that draws a different UI on each screen. Used by GO/NO-GO
 * voting. It says nothing about the operator's role, and `Seat` says where
 * they sit.
 */
export type Screen = "main" | "station" | "pilot";

/**
 * Where the operator is physically sitting: `"mission-control"` or `"pilot"`.
 * Useful for deciding what a widget offers, since every rule about signal delay
 * is a rule about the seat and never about the screen: a pilot on a peer-fed
 * page is a different screen and the same seat. Used by the seat guard that
 * hides widgets unavailable to a seat.
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
 * The screen this component is on. Useful for drawing a different interface on
 * the main screen than on a station. Used by the settings panel. With no screen
 * provider above it, as in a test that mounts a widget on its own, it is
 * `"main"`.
 *
 * @category Host and runtime
 * @categoryDescription Host and runtime
 * The app a widget is running in: which screen and seat it sits on, the host
 * and its versions, the health each Uplink reports, and the relay and ICE
 * servers a station connects through.
 */
export function useScreen(): Screen {
  return useContext(ScreenContext) ?? "main";
}

/**
 * The seat a screen puts the operator in. Useful for declaring a widget's
 * availability against the seat rather than the screen. Used by {@link useSeat}.
 *
 * @category Host and runtime
 */
export function seatOf(screen: Screen): Seat {
  return screen === "pilot" ? "pilot" : "mission-control";
}

/**
 * The seat the current screen puts the operator in. Useful for showing or hiding
 * a control depending on where the operator sits. Used by the seat guard that
 * hides widgets unavailable to a seat.
 *
 * @category Host and runtime
 */
export function useSeat(): Seat {
  return seatOf(useScreen());
}

/**
 * Whether the operator is aboard the craft rather than at mission control.
 *
 * @category Host and runtime
 */
export function useIsPilot(): boolean {
  return useSeat() === "pilot";
}
