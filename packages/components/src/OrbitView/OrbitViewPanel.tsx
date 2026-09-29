import { AugmentSlot } from "@ksp-gonogo/core";
import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import type { ReckoningDecline } from "@ksp-gonogo/sitrep-sdk";
import { Panel, StatusPill } from "@ksp-gonogo/ui";
import { FramedDisplay, Section, Text } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import type { WithheldTrajectory } from "../shared/trajectoryWithheld";
import { noOrbitSentence, TrajectoryWithheld } from "./emptyStates";
import type { OrbitPill } from "./orbitPill";
import type { OrbitOverlayContext } from "./slots";
import {
  DiagramOverlayWrap,
  LandscapeChrome,
  NoData,
  OverlayLayer,
  PillFill,
} from "./styles";

export interface OrbitViewPanelProps {
  panelTitle: string;
  bodyName: string | null | undefined;
  pill: OrbitPill;
  layout: { isLandscape: boolean; showDiagram: boolean; showSubtitle: boolean };
  hasOrbit: boolean;
  trajectory: OrbitTrajectory | null;
  withheld: WithheldTrajectory | null;
  declined: ReckoningDecline | undefined;
  centreBodyIndex: number | undefined;
  /** The drawn orbit, or `null` when there is no trajectory to draw. */
  diagram: ReactNode;
  overlay: OrbitOverlayContext | null;
}

export function OrbitViewPanel({
  panelTitle,
  bodyName,
  pill,
  layout: { isLandscape, showDiagram, showSubtitle },
  hasOrbit,
  trajectory,
  withheld,
  declined,
  centreBodyIndex,
  diagram,
  overlay,
}: OrbitViewPanelProps) {
  const hasTrajectory = diagram !== null;
  const diagramWithOverlay = diagram ? (
    <FramedDisplay style={DIAGRAM_FRAME}>
      {overlay ? (
        <DiagramOverlayWrap>
          {diagram}
          <OverlayLayer>
            <AugmentSlot name="orbit-view.overlay" props={overlay} />
          </OverlayLayer>
        </DiagramOverlayWrap>
      ) : (
        diagram
      )}
    </FramedDisplay>
  ) : null;

  if (isLandscape && showDiagram && hasTrajectory) {
    // Wide-short slot: chrome in the sidebar, diagram beside it.
    return (
      <Panel
        panelTitle={panelTitle}
        panelSidebar={
          <LandscapeChrome>
            {bodyName !== undefined && (
              <Text tone="muted" size="xs">
                {bodyName}
              </Text>
            )}
            <StatusPill $tone={pill.tone}>{pill.label}</StatusPill>
          </LandscapeChrome>
        }
        sidebarSide="start"
        sidebarSize="8rem"
        sections={<Section fill>{diagramWithOverlay}</Section>}
      />
    );
  }

  const drawingShown = hasTrajectory && showDiagram;
  const showBodyNameInAside = drawingShown && bodyName !== undefined;
  const showBodyNameInBody =
    !drawingShown && showSubtitle && bodyName !== undefined;
  // A refusal outranks the no-data sentence: the elements arrived, and nobody vouches for the path.
  const panelContent = () => {
    if (!hasOrbit && withheld === null)
      return <NoData>{noOrbitSentence(declined)}</NoData>;
    // The pill survives a refusal in tiny mode: the craft's state is still true, only the path is in question.
    if (!showDiagram)
      return (
        <PillFill>
          <StatusPill $tone={pill.tone}>{pill.label}</StatusPill>
        </PillFill>
      );
    if (withheld) return <TrajectoryWithheld withheld={withheld} />;
    return diagramWithOverlay;
  };

  return (
    <Panel
      panelTitle={panelTitle}
      panelAside={
        showBodyNameInAside ? (
          <Text tone="muted" size="xs">
            {bodyName}
          </Text>
        ) : undefined
      }
      sections={[
        (showBodyNameInBody || showDiagram) && (
          <Section key="caption" full>
            {showBodyNameInBody && (
              <Text tone="muted" size="xs">
                {bodyName}
              </Text>
            )}
            {/* An orbit that closes in one frame is a rosette in another, so the drawing needs its frame's name. */}
            {showDiagram && (
              <TrajectoryFrameCaption
                trajectory={trajectory}
                centreBodyIndex={centreBodyIndex}
              />
            )}
          </Section>
        ),
        <Section key="orbit" fill>
          {panelContent()}
        </Section>,
      ]}
    />
  );
}

const DIAGRAM_FRAME = { flex: 1, minHeight: 0 } as const;
