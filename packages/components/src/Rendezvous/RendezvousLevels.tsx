import { type EdgeCue, useElementSize } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useCallback, useState } from "react";
import { LensStack, type ViewOf } from "./LensStack";
import { LevelDots } from "./LevelDots";
import {
  type BandsWanted,
  type Box,
  DOTS_HEIGHT,
  type Layout,
  layoutFor,
  NO_BANDS,
} from "./layout";
import type { RendezvousLevel, TargetClass } from "./levels";

export interface RendezvousLevelsProps {
  target: TargetClass;
  /** The level the large circle should be at. */
  level: RendezvousLevel;
  /** The levels this target passes through, for the dots. */
  levels: readonly RendezvousLevel[];
  onSelect: (level: RendezvousLevel) => void;
  views: Partial<Record<RendezvousLevel, ViewOf | null>>;
  docking: (diameter: number) => ReactNode;
  /** A lit arc on a level's border, for the levels that have one. */
  cues?: Partial<Record<RendezvousLevel, EdgeCue | readonly EdgeCue[] | null>>;
  /**
   * Builds the figures from where the circles sit. The figures call `ask`
   * with the bands they want above and below the circle once they have
   * measured themselves; the circles then take the room that leaves.
   */
  figures: (
    layout: Layout,
    box: Box,
    ask: (wanted: BandsWanted) => void,
  ) => ReactNode;
}

/**
 * The Rendezvous body: the readout block fixed at the top left, the paired
 * circles filling the room to its right, and the row of dots at the foot, all
 * laid out from the measured box so the circles take whatever room the widget
 * has. Useful for reading a target's approach at the scale that matters
 * now. Used by the Rendezvous widget.
 */
export function RendezvousLevels({
  target,
  level,
  levels,
  onSelect,
  views,
  docking,
  cues,
  figures,
}: Readonly<RendezvousLevelsProps>) {
  const { ref, size } = useElementSize<HTMLDivElement>({ w: 1, h: 1 });
  const box: Box = { w: size.w, h: size.h };
  const [wanted, setWanted] = useState<BandsWanted>(NO_BANDS);
  const ask = useCallback((next: BandsWanted) => {
    setWanted((was) =>
      was.top === next.top && was.bottom === next.bottom ? was : next,
    );
  }, []);
  const layout = layoutFor(box, wanted);
  return (
    <div
      ref={ref}
      data-rendezvous-levels=""
      style={{ position: "relative", flex: 1, minHeight: 0, minWidth: 0 }}
    >
      <LensStack
        target={target}
        level={level}
        box={box}
        layout={layout}
        views={views}
        docking={docking}
        cues={cues}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      >
        {figures(layout, box, ask)}
      </div>
      {layout.dots && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: DOTS_HEIGHT,
          }}
        >
          <LevelDots levels={levels} current={level} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
