import { createContext, type ReactNode, useContext } from "react";

/**
 * "This screen meant the warp it is about to command", so its own unscheduled
 * warp banner stays quiet. Local and never broadcast: every other screen should
 * still see a warp it did not ask for.
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

/** `null` when nothing local watches warp, as on a station, where telling nobody is correct. */
export function useWarpIntent(): WarpIntentAnnouncer | null {
  return useContext(Context);
}
