import type { BodyTransferInfo, ManeuverPlan } from "@ksp-gonogo/core";
import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { Countdown, type ReckoningMarking, Unit } from "@ksp-gonogo/ui-kit";
import { AvailableRow } from "./AvailableRow";
import { Label, PreviewGrid, PreviewValue } from "./styles";

interface TransferPreviewProps {
  plan: ManeuverPlan;
  transfer: BodyTransferInfo;
  availableDeltaV: number | null;
  feasible: boolean | null;
  currentUT: Value<"ut"> | undefined;
  marking: ReckoningMarking | null;
}

/** A transfer to another body: the burn, when to light it, how long the flight is and the periapsis it is aimed to give. */
export function TransferPreview({
  plan,
  transfer,
  availableDeltaV,
  feasible,
  currentUT,
  marking,
}: TransferPreviewProps) {
  return (
    <PreviewGrid>
      <Label>ΔV</Label>
      <PreviewValue>
        <Unit
          value={value("m/s", plan.requiredDeltaV)}
          marked={marking}
          decimals={1}
        />
      </PreviewValue>

      <Label>Burn in</Label>
      <PreviewValue>
        <Countdown value={currentUT && plan.ut.minus(currentUT)} />
      </PreviewValue>

      <Label>Prograde</Label>
      <PreviewValue>
        <Unit
          value={value("m/s", plan.prograde)}
          marked={marking}
          decimals={1}
        />
      </PreviewValue>
      <Label>Normal</Label>
      <PreviewValue>
        <Unit value={value("m/s", plan.normal)} marked={marking} decimals={1} />
      </PreviewValue>
      <Label>Radial</Label>
      <PreviewValue>
        <Unit value={value("m/s", plan.radial)} marked={marking} decimals={1} />
      </PreviewValue>

      <Label>Flight</Label>
      <PreviewValue>
        <Unit value={value("s", transfer.transferTime)} marked={marking} />
      </PreviewValue>
      <Label>{transfer.target} Pe</Label>
      <PreviewValue $accent="pe">
        <Unit value={value("m", transfer.periapsisAltitude)} marked={marking} />
      </PreviewValue>

      <AvailableRow availableDeltaV={availableDeltaV} feasible={feasible} />
    </PreviewGrid>
  );
}
