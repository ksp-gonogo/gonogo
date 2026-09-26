import { OrbitDiagram } from "../shared/OrbitDiagram";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import type { ManeuverPreviewProps } from "./ManeuverPreview";
import { isSequence } from "./planning";
import { DiagramWrap } from "./styles";

export function ManeuverDiagram({
  plan,
  currentOrbit,
  currentTrajectory,
  body,
  preset,
  burnTrueAnomaly,
  diagram,
  prograde,
  radial,
  setPrograde,
  setRadial,
}: ManeuverPreviewProps) {
  if (!plan || !currentOrbit || !diagram.ApR || !diagram.PeR) return null;
  // Every curve here extrapolates the current orbit, so a refusal withholds the whole drawing.
  if (currentTrajectory?.shape === "withheld") {
    return (
      <DiagramWrap>
        <TrajectoryWithheldNote withheld={currentTrajectory} />
      </DiagramWrap>
    );
  }
  const customWithHandles =
    preset === "custom-apo" ||
    preset === "custom-peri" ||
    preset === "custom-ut";
  // A sequence draws its transfer ellipse dashed and its final orbit solid.
  const projected = isSequence(plan) ? plan.transferEllipse : plan.projected;
  const secondaryProjected = isSequence(plan) ? plan.finalProjected : null;
  return (
    <DiagramWrap>
      <OrbitDiagram
        variant="mini"
        // The seam's arc when it gave one; null lets the diagram draw its own conic.
        trajectoryPath={
          currentTrajectory?.shape === "arc" ? currentTrajectory.points : null
        }
        trajectoryFarEnd={
          currentTrajectory?.shape === "arc" ? currentTrajectory.farEnd : null
        }
        sma={diagram.sma ?? 0}
        ecc={diagram.ecc ?? 0}
        apoapsis={diagram.ApR}
        periapsis={diagram.PeR}
        trueAnomaly={diagram.trueAnomaly ?? 0}
        argPe={diagram.argPe ?? 0}
        bodyColor={body?.color}
        bodyRadius={body?.radius}
        projected={
          projected
            ? {
                sma: projected.sma,
                ecc: projected.eccentricity,
                apoapsis: projected.ApR,
                periapsis: projected.PeR,
              }
            : null
        }
        secondaryProjected={
          secondaryProjected
            ? {
                sma: secondaryProjected.sma,
                ecc: secondaryProjected.eccentricity,
                apoapsis: secondaryProjected.ApR,
                periapsis: secondaryProjected.PeR,
              }
            : null
        }
        maneuverHandles={
          burnTrueAnomaly !== null && customWithHandles
            ? {
                burnTrueAnomaly,
                prograde,
                radial,
                onPrograde: setPrograde,
                onRadial: setRadial,
              }
            : null
        }
      />
    </DiagramWrap>
  );
}
