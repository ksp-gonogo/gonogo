import {
  useObservedVantage,
  useSelectedVantage,
} from "@ksp-gonogo/sitrep-client";
import { useEffect } from "react";
import type { PeerHostService } from "./PeerHostService";

/**
 * The command centre this screen stands at: the one it chose, or before it has
 * chosen, the one its frames arrive from; null until either is known.
 */
export function useHostCentre(): string | null {
  const selected = useSelectedVantage();
  const observed = useObservedVantage();
  return selected ?? observed ?? null;
}

/**
 * Tells the peer mesh which command centre this screen stands at: the one it
 * chose, or before it has chosen, the one its frames arrive from. The same
 * answer the vantage picker shows.
 *
 * A pilot needs it because the delay that matters to a human aboard is how far
 * their words travel to mission control, and a pilot's own session is at the
 * craft, where nothing on the wire says where mission control is standing.
 */
export function HostCommandCentreAnnouncer({
  host,
}: {
  host: Pick<PeerHostService, "setCommandCentre">;
}) {
  const centreId = useHostCentre();
  useEffect(() => {
    host.setCommandCentre(centreId);
  }, [host, centreId]);
  return null;
}
