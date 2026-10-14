import { AugmentSlot } from "@ksp-gonogo/core";
import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import {
  DeclinedEmptyState,
  FramedDisplay,
  Panel,
  Section,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { InlaidTrajectoryFrameCaption } from "../shared/trajectoryFrame";
import type { OrbitOverlayContext } from "./slots";
import { DiagramOverlayWrap, OverlayLayer } from "./styles";

export interface OrbitViewPanelProps {
  panelTitle: string;
  /** The orbit drawn is the last one observed, held with nothing carrying it to now: the panel says so. */
  held: boolean;
  /** The figures: always the body, or the sidebar once the diagram has the body. */
  figures: ReactNode;
  /** Whether the tile has room for the diagram beside or above the figures. */
  diagramSlot: boolean;
  /** The drawn orbit, or `null` when there is no trajectory to draw. */
  diagram: ReactNode;
  withheld: Extract<OrbitTrajectory, { shape: "withheld" }> | null;
  trajectory: OrbitTrajectory | null;
  centreBodyIndex: number | undefined;
  overlay: OrbitOverlayContext | null;
}

export function OrbitViewPanel({
  panelTitle,
  held,
  figures,
  diagramSlot,
  diagram,
  withheld,
  trajectory,
  centreBodyIndex,
  overlay,
}: OrbitViewPanelProps) {
  if (!diagramSlot) {
    return (
      <Panel
        panelTitle={panelTitle}
        panelStatus={held ? "held" : undefined}
        sections={
          <Section full key="figures">
            {figures}
          </Section>
        }
      />
    );
  }

  /* A refusal outranks the drawing: the elements arrived, and nobody vouches for the path. */
  const drawing =
    withheld !== null ? (
      <DeclinedEmptyState declined={withheld.declined} layout="fill" />
    ) : overlay ? (
      <DiagramOverlayWrap>
        {diagram}
        <OverlayLayer>
          <AugmentSlot name="orbit-view.overlay" props={overlay} />
        </OverlayLayer>
      </DiagramOverlayWrap>
    ) : (
      diagram
    );

  return (
    <Panel
      panelTitle={panelTitle}
      panelStatus={held ? "held" : undefined}
      panelSidebar={figures}
      sections={
        <Section fill key="orbit">
          {/* An orbit that closes in one frame is a rosette in another, so a drawn diagram carries its frame's name inlaid on it. */}
          <FramedDisplay
            style={DIAGRAM_FRAME}
            caption={
              withheld === null ? (
                <InlaidTrajectoryFrameCaption
                  trajectory={trajectory}
                  centreBodyIndex={centreBodyIndex}
                />
              ) : undefined
            }
          >
            {drawing}
          </FramedDisplay>
        </Section>
      }
    />
  );
}

const DIAGRAM_FRAME = { flex: 1, minHeight: 0, minWidth: 0 } as const;
