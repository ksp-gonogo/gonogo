import { createContext, type ReactNode, useContext } from "react";

/**
 * "This screen meant the warp it is about to command", so its own unscheduled
 * warp banner stays quiet. It never quiets another screen's banner: every other
 * screen should still see a warp it did not ask for. A station's announcement
 * reaches the main screen only to end a running warp to an alarm.
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

/** `null` when nothing under this provider announces warp presses. */
export function useWarpIntent(): WarpIntentAnnouncer | null {
  return useContext(Context);
}
