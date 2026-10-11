import type { ReactNode } from "react";
import { createContext, useContext } from "react";

/**
 * Which kind of screen a component is mounted on, by how that screen gets its
 * data. `"main"` reads the game's stream directly and hosts station screens,
 * `"station"` is fed by a main screen over a peer connection, and `"pilot"`
 * reads the stream directly aboard the craft and hosts nothing. Useful for a
 * component that draws a different UI on each screen. Used by GO/NO-GO
 * voting. It says nothing about the user's role, and `Seat` says where they
 * sit.
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
 * The screen this component is on. With no screen provider above it, as in a
 * test that mounts a widget on its own, it is `"main"`.
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
 * The seat a screen puts the operator in. Declare a widget's availability
 * against the seat, not the screen.
 *
 * @category Host and runtime
 */
export function seatOf(screen: Screen): Seat {
  return screen === "pilot" ? "pilot" : "mission-control";
}

/**
 * The seat the current screen puts the operator in.
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
