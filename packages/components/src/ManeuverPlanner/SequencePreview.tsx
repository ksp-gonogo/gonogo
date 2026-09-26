import type { BodyDefinition, ManeuverSequence } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Countdown, SectionTitle, Unit } from "@ksp-gonogo/ui-kit";
import { AvailableRow } from "./AvailableRow";
import { ProjectedRows } from "./ProjectedRows";
import { Label, PreviewGrid, PreviewValue } from "./styles";

interface SequencePreviewProps {
  seq: ManeuverSequence;
  body: BodyDefinition | undefined;
  /** Vessel-total ΔV in m/s off the shared budget, `null` when there is no usable figure. */
  availableDeltaV: number | null;
  feasible: boolean | null;
  currentUT: number | undefined;
}

export function SequencePreview({
  seq,
  body,
  availableDeltaV,
  feasible,
  currentUT,
}: SequencePreviewProps) {
  const burn1 = seq.burns[0];
  const burn2 = seq.burns[1];
  return (
    <>
      <PreviewGrid>
        <Label>Total ΔV</Label>
        <PreviewValue>
          <Unit value={value("m/s", seq.totalDeltaV)} decimals={1} />
        </PreviewValue>

        <AvailableRow availableDeltaV={availableDeltaV} feasible={feasible} />
      </PreviewGrid>

      <SectionTitle as="h4">Burn 1</SectionTitle>
      <PreviewGrid>
        <Label>ΔV</Label>
        <PreviewValue>
          <Unit value={value("m/s", burn1.prograde)} decimals={1} /> prograde
        </PreviewValue>
        <Label>Burn in</Label>
        <PreviewValue>
          <Countdown value={burn1.ut - (currentUT ?? 0)} />
        </PreviewValue>
        <ProjectedRows
          projected={seq.transferEllipse}
          body={body}
          prefix="Transfer"
        />
      </PreviewGrid>

      {burn2 && (
        <>
          <SectionTitle as="h4">Burn 2</SectionTitle>
          <PreviewGrid>
            <Label>ΔV</Label>
            <PreviewValue>
              <Unit value={value("m/s", burn2.prograde)} decimals={1} />{" "}
              prograde
            </PreviewValue>
            <Label>Burn in</Label>
            <PreviewValue>
              <Countdown value={burn2.ut - (currentUT ?? 0)} />
            </PreviewValue>
            <ProjectedRows
              projected={seq.finalProjected}
              body={body}
              prefix="Final"
            />
          </PreviewGrid>
        </>
      )}
    </>
  );
}
