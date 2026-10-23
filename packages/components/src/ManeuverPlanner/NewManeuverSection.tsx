import { useMemo } from "react";
import { PresetInput } from "./PresetInput";
import { transferTargets as transferTargetsOf } from "./transferPlan";
import type { PlannerInputsApi } from "./usePlannerInputs";
import type { PlannerTelemetry } from "./usePlannerTelemetry";

interface NewManeuverSectionProps {
  api: PlannerInputsApi;
  telemetry: PlannerTelemetry;
}

export function NewManeuverSection({
  api,
  telemetry,
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
      }}
    />
  );
}
