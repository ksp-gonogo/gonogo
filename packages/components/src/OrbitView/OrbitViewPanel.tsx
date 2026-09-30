import { AugmentSlot } from "@ksp-gonogo/core";
import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import type { ReckoningDecline } from "@ksp-gonogo/sitrep-sdk";
import { Badge, Panel } from "@ksp-gonogo/ui";
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
  /**
   * `caption` inlays the frame's name on the drawing itself rather than as a
   * second body element beside it, which is what lets the portrait branch
   * below stay Panel's lone-frame case: a body that is nothing but this
   * frame. The landscape branch never passes one, its sidebar already names
   * the body and has no room this saves.
   */
  function buildDiagram(caption?: ReactNode) {
    if (!diagram) return null;
    return (
      <FramedDisplay style={DIAGRAM_FRAME} caption={caption}>
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
    );
  }

  if (isLandscape && showDiagram && hasTrajectory) {
    // Wide-short slot: chrome in the sidebar, diagram beside it.
    return (
      <Panel
        panelTitle={panelTitle}
        panelSidebar={
          <LandscapeChrome>
            {bodyName !== undefined && (
              <Text level="muted" size="xs">
                {bodyName}
              </Text>
            )}
            <Badge tone={pill.tone}>{pill.label}</Badge>
          </LandscapeChrome>
        }
        sidebarSide="start"
        sidebarSize="8rem"
        sections={<Section fill>{buildDiagram()}</Section>}
      />
    );
  }

  const drawingShown = hasTrajectory && showDiagram;
  const showBodyNameInAside = drawingShown && bodyName !== undefined;
  const showBodyNameInBody =
    !drawingShown && showSubtitle && bodyName !== undefined;
  // An orbit that closes in one frame is a rosette in another, so a drawn diagram carries its frame's name inlaid on it.
  const frameCaption = drawingShown ? (
    <TrajectoryFrameCaption
      trajectory={trajectory}
      centreBodyIndex={centreBodyIndex}
    />
  ) : undefined;
  const diagramWithCaption = buildDiagram(frameCaption);
  // A refusal outranks the no-data sentence: the elements arrived, and nobody vouches for the path.
  const panelContent = () => {
    if (!hasOrbit && withheld === null)
      return <NoData>{noOrbitSentence(declined)}</NoData>;
    // The pill survives a refusal in tiny mode: the craft's state is still true, only the path is in question.
    if (!showDiagram)
      return (
        <PillFill>
          <Badge tone={pill.tone}>{pill.label}</Badge>
        </PillFill>
      );
    if (withheld) return <TrajectoryWithheld withheld={withheld} />;
    return diagramWithCaption;
  };

  return (
    <Panel
      panelTitle={panelTitle}
      panelAside={
        showBodyNameInAside ? (
          <Text level="muted" size="xs">
            {bodyName}
          </Text>
        ) : undefined
      }
      sections={[
        // Only a loose caption section when there is no frame to inlay it on: a drawn diagram carries its own caption instead, see `frameCaption`.
        !drawingShown && showBodyNameInBody && (
          <Section key="caption" full>
            <Text level="muted" size="xs">
              {bodyName}
            </Text>
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
