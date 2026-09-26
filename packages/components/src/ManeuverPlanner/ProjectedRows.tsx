import type { BodyDefinition, ManeuverPlan } from "@ksp-gonogo/core";
import { useStream } from "@ksp-gonogo/sitrep-client";
import {
  apsidesExist,
  type ControlFrame,
  controlFrameLabel,
  frameCaveat,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";
import { Label, PreviewValue } from "./styles";

interface ProjectedRowsProps {
  projected: ManeuverPlan["projected"] | null | undefined;
  body: BodyDefinition | undefined;
  prefix?: string;
}

export function ProjectedRows({
  projected,
  body,
  prefix = "New",
}: ProjectedRowsProps) {
  // A two-body frame has no centre, so projected apsides are as meaningless in it as current ones.
  const frameReading = useStream<ControlFrame>("system.frame");
  // The selected frame is a setting, which a quiet link does not change.
  const controlFrame =
    frameReading.state === "observed" || frameReading.state === "stale"
      ? frameReading.value
      : undefined;
  const apsides = apsidesExist(controlFrame);

  if (!projected) {
    // Ahead of the frame check: a plan that leaves no orbit outranks a view that cannot describe one.
    return (
      <>
        <Label>Projection</Label>
        <PreviewValue>escape / invalid</PreviewValue>
      </>
    );
  }
  if (apsides === "invalid") {
    // One row, not two empty ones: the plan is still committable, only the frame cannot describe it.
    return (
      <>
        <Label>{prefix} apsides</Label>
        <PreviewValue title={frameCaveat(apsides, "apsides")}>
          {`none in ${controlFrameLabel(controlFrame) ?? "this frame"}`}
        </PreviewValue>
      </>
    );
  }
  return (
    <>
      <Label>{prefix} Ap</Label>
      <PreviewValue $accent="ap">
        <Unit value={value("m", projected.ApR - (body?.radius ?? 0))} />
      </PreviewValue>
      <Label>{prefix} Pe</Label>
      <PreviewValue $accent="pe">
        <Unit value={value("m", projected.PeR - (body?.radius ?? 0))} />
      </PreviewValue>
      <Label>{prefix} Ecc</Label>
      <PreviewValue>{projected.eccentricity.toFixed(4)}</PreviewValue>
      <Label>{prefix} T</Label>
      <PreviewValue>
        <Unit value={value("s", projected.period)} />
      </PreviewValue>
      {projected.inclination !== undefined && (
        <>
          <Label>{prefix} Inc</Label>
          <PreviewValue>
            <Unit value={value("°", projected.inclination)} decimals={2} />
          </PreviewValue>
        </>
      )}
    </>
  );
}
