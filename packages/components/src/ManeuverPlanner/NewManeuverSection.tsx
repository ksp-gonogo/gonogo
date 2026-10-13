import { Section } from "@ksp-gonogo/ui-kit";
import { PresetInput } from "./PresetInput";
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
  return (
    <Section title="New maneuver" gap="related">
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
        }}
      />
    </Section>
  );
}
