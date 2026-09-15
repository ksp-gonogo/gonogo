import { createContext, type ReactNode, useContext } from "react";

/**
 * "This screen meant the warp it is about to command."
 *
 * The app watches the game's own warp state and raises an UNSCHEDULED WARP
 * banner for any elevated warp it did not see coming, which is how an operator
 * finds out somebody warped inside KSP, or at another console. That watcher
 * reads the game rather than the dashboard, so it cannot tell a deliberate
 * press here from a warp nobody at this screen asked for, and a widget that
 * commands warp silently trips its own screen's alarm.
 *
 * <p>Announcing is LOCAL and deliberately not broadcast. A command centre
 * flagging a pilot's warp as unscheduled is wanted rather than a defect: the
 * ground will not otherwise know what a pilot is doing. So this suppresses
 * only the alert a screen raises against its own action, and every other
 * screen still sees the warp it did not ask for.</p>
 *
 * The provider lives in `@ksp-gonogo/app`, the only layer holding the
 * observer. Components stay framework-agnostic: a widget announces when a
 * provider is present and carries on when it is not, exactly as
 * `useAlarmsLauncher` does, so a station (which runs no observer of its own)
 * and a bare test tree both work unchanged.
 */
export type WarpIntentAnnouncer = () => void;

const Context = createContext<WarpIntentAnnouncer | null>(null);

export function WarpIntentProvider({
  announce,
  children,
}: {
  announce: WarpIntentAnnouncer;
  children: ReactNode;
}) {
  return <Context.Provider value={announce}>{children}</Context.Provider>;
}

/**
 * The announcer when a screen keeps its own warp watcher, or `null` when
 * nothing local is watching. A null is not a degraded mode: a station has no
 * observer to tell, and telling nobody is the right outcome there.
 */
export function useWarpIntent(): WarpIntentAnnouncer | null {
  return useContext(Context);
}
