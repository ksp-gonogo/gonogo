import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import { EmptyState, SectionTitle } from "@ksp-gonogo/ui-kit";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import { HyperbolicNotice, WaitingPanel } from "./styles";

interface NotPlannableNoticeProps {
  hyperbolic: boolean;
  currentTrajectory: OrbitTrajectory | null;
}

/** What stands in for the preview while the current orbit cannot be planned from. */
export function NotPlannableNotice({
  hyperbolic,
  currentTrajectory,
}: NotPlannableNoticeProps) {
  if (hyperbolic) {
    return (
      <WaitingPanel>
        <SectionTitle as="h4">Hyperbolic trajectory</SectionTitle>
        <HyperbolicNotice>
          Escaping on a hyperbolic orbit (no apoapsis), maneuver planning is not
          available.
        </HyperbolicNotice>
      </WaitingPanel>
    );
  }
  // A withheld trajectory is a propagation refusal, not missing telemetry, and has a different remedy.
  if (currentTrajectory !== null && currentTrajectory.shape === "withheld") {
    return (
      <WaitingPanel>
        <TrajectoryWithheldNote withheld={currentTrajectory} />
      </WaitingPanel>
    );
  }
  return <EmptyState>Awaiting orbit telemetry.</EmptyState>;
}
