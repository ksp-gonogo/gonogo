import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  DeclinedEmptyState,
  EmptyState,
  SectionTitle,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type { CaptureFault } from "./planning";
import { HyperbolicNotice, WaitingPanel } from "./styles";

interface NotPlannableNoticeProps {
  hyperbolic: boolean;
  landed: boolean;
  meetsSurface: boolean;
  captureFault: CaptureFault | null;
  currentTrajectory: OrbitTrajectory | null;
}

/** What stands in for the preview while the current orbit cannot be planned from. */
export function NotPlannableNotice({
  hyperbolic,
  landed,
  meetsSurface,
  captureFault,
  currentTrajectory,
}: NotPlannableNoticeProps) {
  if (landed) {
    return (
      <WaitingPanel>
        <SectionTitle as="h4">On the ground</SectionTitle>
        <HyperbolicNotice>
          The vessel is landed, so there is no orbit to plan a maneuver on.
        </HyperbolicNotice>
      </WaitingPanel>
    );
  }
  if (meetsSurface) {
    return (
      <WaitingPanel>
        <SectionTitle as="h4">Meets the surface</SectionTitle>
      </WaitingPanel>
    );
  }
  if (captureFault) {
    const { title, fact } = captureFactOf(captureFault);
    return (
      <WaitingPanel>
        <SectionTitle as="h4">{title}</SectionTitle>
        <HyperbolicNotice>{fact}</HyperbolicNotice>
      </WaitingPanel>
    );
  }
  if (hyperbolic) {
    return (
      <WaitingPanel>
        <SectionTitle as="h4">Hyperbolic trajectory</SectionTitle>
        <HyperbolicNotice>
          Escaping on a hyperbolic orbit with periapsis behind the vessel, so
          there is nothing to plan a burn on. A capture burn can be planned on
          the approach, before periapsis.
        </HyperbolicNotice>
      </WaitingPanel>
    );
  }
  // A withheld trajectory is a propagation refusal, not missing telemetry, and has a different remedy.
  if (currentTrajectory !== null && currentTrajectory.shape === "withheld") {
    return (
      <WaitingPanel>
        <DeclinedEmptyState
          declined={currentTrajectory.declined}
          layout="fill"
        />
      </WaitingPanel>
    );
  }
  return <EmptyState>Awaiting orbit telemetry</EmptyState>;
}

/** The title and the one fact that bounds the target altitude. */
function captureFactOf(fault: CaptureFault): {
  title: string;
  fact: ReactNode;
} {
  switch (fault.kind) {
    case "inside-atmosphere":
      return {
        title: "Inside the atmosphere",
        fact: (
          <>
            The atmosphere ends at{" "}
            <Unit value={value("m", fault.limitAltitude)} />.
          </>
        ),
      };
    case "below-surface":
      return { title: "Below the surface", fact: "The surface is at 0 m." };
    case "outside-influence":
      return {
        title: "Outside the sphere of influence",
        fact: (
          <>
            The sphere of influence ends at{" "}
            <Unit value={value("m", fault.limitAltitude)} />.
          </>
        ),
      };
  }
}
