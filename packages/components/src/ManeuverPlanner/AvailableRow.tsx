import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";
import { FeasibilityChip, Label, PreviewValue, ValueNum } from "./styles";

interface AvailableRowProps {
  /** Vessel-total ΔV in m/s off the shared budget, `null` when there is no usable figure. */
  availableDeltaV: number | null;
  feasible: boolean | null;
}

/** The vessel's available ΔV beside the plan's feasibility verdict. */
export function AvailableRow({ availableDeltaV, feasible }: AvailableRowProps) {
  return (
    <>
      <Label>Available</Label>
      <PreviewValue>
        <ValueNum>
          {availableDeltaV === null ? (
            NULL_DISPLAY
          ) : (
            <Unit value={value("m/s", availableDeltaV)} decimals={0} />
          )}
        </ValueNum>
        {feasible !== null && (
          <FeasibilityChip $ok={feasible}>
            {feasible ? "OK" : "SHORT"}
          </FeasibilityChip>
        )}
      </PreviewValue>
    </>
  );
}
