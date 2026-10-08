import { useFleetVesselSilence } from "@ksp-gonogo/sitrep-client";

/** Keeps one vessel's `silence.<guid>.state` subscribed, which a hook cannot do for a vessel that is not there yet. */
export function VesselSilenceSubscription({ guid }: { guid: string }) {
  useFleetVesselSilence(guid);
  return null;
}
