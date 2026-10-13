import { AugmentSlot } from "@ksp-gonogo/core";
import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import type { ReckoningDecline } from "@ksp-gonogo/sitrep-sdk";
import type { WithheldTrajectory } from "@ksp-gonogo/sitrep-sdk/frames";
import { Badge, Panel } from "@ksp-gonogo/ui";
import { FramedDisplay, Section, Text, Tooltip } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { InlaidTrajectoryFrameCaption } from "../shared/trajectoryFrame";
import { WithheldPath } from "../shared/WithheldPath";
import { noOrbitSentence } from "./emptyStates";
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
  /** The orbit drawn is the last one observed, held with nothing carrying it to now: the panel says so. */
  held: boolean;
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
  held,
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
        panelStatus={held ? "held" : undefined}
        panelSidebar={
          <LandscapeChrome>
            {bodyName !== undefined && (
              <Text level="muted" size="xs">
                {bodyName}
              </Text>
            )}
            <PillBadge pill={pill} />
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
    <InlaidTrajectoryFrameCaption
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
          <PillBadge pill={pill} />
        </PillFill>
      );
    if (withheld) return <WithheldPath withheld={withheld} layout="fill" />;
    return diagramWithCaption;
  };

  return (
    <Panel
      panelTitle={panelTitle}
      panelStatus={held ? "held" : undefined}
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

/** The regime pill, with what it waits for on its tooltip where it has no answer yet. */
function PillBadge({ pill }: Readonly<{ pill: OrbitPill }>) {
  const badge = <Badge tone={pill.tone}>{pill.label}</Badge>;
  return pill.title === undefined ? (
    badge
  ) : (
    <Tooltip text={pill.title} focusable>
      {badge}
    </Tooltip>
  );
}
