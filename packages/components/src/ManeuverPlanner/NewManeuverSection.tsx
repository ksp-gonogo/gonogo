import { useMemo } from "react";
import { PresetInput } from "./PresetInput";
import { transferTargets as transferTargetsOf } from "./transferPlan";
import type { PlannerInputsApi } from "./usePlannerInputs";
import type { PlannerTelemetry } from "./usePlannerTelemetry";

interface NewManeuverSectionProps {
  api: PlannerInputsApi;
  telemetry: PlannerTelemetry;
  /** Whether the craft is inbound on a hyperbolic orbit, where the section plans a capture. */
  capturing: boolean;
}

export function NewManeuverSection({
  api,
  telemetry,
  capturing,
}: NewManeuverSectionProps) {
  const transferTargets = useMemo(
    () =>
      transferTargetsOf(telemetry.celestialBodies, telemetry.craftBody).map(
        (b) => b.name ?? "",
      ),
    [telemetry.celestialBodies, telemetry.craftBody],
  );
  return (
    <PresetInput
      api={api}
      telemetry={{
        currentUT: telemetry.currentUT,
        inclination: telemetry.inclination,
        lan: telemetry.lan,
        targetName: telemetry.targetName,
        targetInclinationLive: telemetry.targetInclinationLive,
        targetLanLive: telemetry.targetLanLive,
        targetPeA: telemetry.targetPeA,
        orbitMarking: telemetry.orbitMarking,
        targetMarking: telemetry.targetMarking,
        transferTargets,
        capture:
          capturing && telemetry.openOrbit
            ? {
                periapsisKm: telemetry.body
                  ? (telemetry.openOrbit.PeR - telemetry.body.radius) / 1000
                  : undefined,
              }
            : null,
      }}
    />
  );
}
