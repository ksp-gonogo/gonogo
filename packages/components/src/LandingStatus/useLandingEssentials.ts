import { useTelemetry } from "@ksp-gonogo/core";
import type { Reading, TinyEssential, Value } from "@ksp-gonogo/sitrep-sdk";

/** Whether a field's reading holds a figure: one the vessel never reported, or reported as unknown, leaves the radar altitude to stand in. */
function carriesFigure(reading: Reading<Value<"m">>): boolean {
  return (
    (reading.state === "observed" || reading.state === "held") &&
    reading.value != null
  );
}

/** Height over the ground and how fast it is closing. */
export function useLandingEssentials(): readonly TinyEssential[] {
  const flight = useTelemetry("vessel.flight");
  const surface = useTelemetry("vessel.surface");
  return [
    // The widget's own datum: the lowest point above terrain, with the radar altitude of the centre of mass only where `vessel.surface` says nothing.
    {
      label: "Alt AGL",
      value: carriesFigure(surface.heightFromTerrain)
        ? surface.heightFromTerrain
        : flight.altitudeTerrain,
    },
    { label: "V/S", value: flight.verticalSpeed },
  ];
}
