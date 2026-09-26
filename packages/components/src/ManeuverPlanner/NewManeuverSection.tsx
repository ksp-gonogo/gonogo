import { ReadoutCaption, SectionTitle } from "@ksp-gonogo/ui-kit";
import { PresetInput } from "./PresetInput";
import { PaddedSection } from "./styles";
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
    <PaddedSection>
      <SectionTitle as="h4">New maneuver</SectionTitle>
      {/* The plan still renders; the caption stops its Δv being read as measured now. */}
      {telemetry.elementsNeedDating && (
        <ReadoutCaption>
          Planned from the last known orbit, which is no longer current
        </ReadoutCaption>
      )}
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
        }}
      />
    </PaddedSection>
  );
}
