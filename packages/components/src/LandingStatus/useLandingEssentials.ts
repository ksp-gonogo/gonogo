import { useTelemetry } from "@ksp-gonogo/core";
import type { TinyEssential } from "@ksp-gonogo/sitrep-sdk";

/** Height over the ground and how fast it is closing. */
export function useLandingEssentials(): readonly TinyEssential[] {
  const flight = useTelemetry("vessel.flight");
  return [
    { label: "Alt AGL", value: flight.altitudeTerrain },
    { label: "V/S", value: flight.verticalSpeed },
  ];
}
