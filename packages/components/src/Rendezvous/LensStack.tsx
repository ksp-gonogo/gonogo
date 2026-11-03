import { type EdgeCue, FramedDisplay, Text, Tooltip } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { type CircleView, DRAW } from "./circles";

/** A level's drawing, made for the drawn units one screen pixel takes at the size it is shown. */
export type ViewOf = (unit: number, small: boolean) => CircleView;

import type { Box, Layout } from "./layout";
import {
  previousLevel,
  type RendezvousLevel,
  type TargetClass,
} from "./levels";
import { lengthLabel, niceLength } from "./scaleBar";
import { type Places, type Pose, pivotFor, stepPoses } from "./turret";
import { useTurret } from "./useTurret";

/** What a level is called to a reader of the screen. */
export const LEVEL_NAMES: Readonly<Record<RendezvousLevel, string>> = {
  far: "Far",
  approach: "Approach",
  docking: "Docking",
  encounter: "Encounter",
};

export interface LensStackProps {
  target: TargetClass;
  /** The level the view should be at; the stack turns to it one step at a time. */
  level: RendezvousLevel;
  box: Box;
  layout: Layout;
  /** The drawn circles, for the levels that are drawings. */
  views: Partial<Record<RendezvousLevel, ViewOf | null>>;
  /** The contents of the Docking circle, given its diameter in pixels. */
  docking: (diameter: number) => ReactNode;
  /** A lit arc on a level's border, for the levels that have one. */
  cues?: Partial<Record<RendezvousLevel, EdgeCue | null>>;
}

/** Drawn units one screen pixel takes for a circle of `diameter` pixels drawn at `scale`. */
const unitFor = (diameter: number, scale: number) =>
  DRAW / Math.max(diameter * scale, 1);

function Lens({
  level,
  pose,
  diameter,
  view,
  docking,
  cue,
}: {
  level: RendezvousLevel;
  pose: Pose;
  diameter: number;
  view: ViewOf | null | undefined;
  docking: (diameter: number) => ReactNode;
  cue: EdgeCue | null | undefined;
}) {
  return (
    <div
      data-lens={level}
      style={{
        position: "absolute",
        left: pose.x - diameter / 2,
        top: pose.y - diameter / 2,
        width: diameter,
        height: diameter,
        transform: `rotate(${pose.tilt}rad) scale(${pose.scale})`,
        transformOrigin: "center",
      }}
    >
      <FramedDisplay
        shape="circle"
        edgeCue={cue === undefined ? undefined : (cue ?? [])}
        style={{ width: diameter, height: diameter }}
        aria-label={`${LEVEL_NAMES[level]} level`}
        role="group"
      >
        {level === "docking"
          ? docking(diameter)
          : view?.(unitFor(diameter, pose.scale), pose.scale < 0.9).svg}
      </FramedDisplay>
    </div>
  );
}

/** The height the scale bar's label and line take, pixels. */
const SCALE_BAR_HEIGHT_PX = 22;
/** Below this diameter the circle is too small to carry a scale bar's label. */
const SCALE_BAR_MIN_DIAMETER_PX = 96;

/**
 * The scale bar at the bottom centre of the large circle's place. It does not
 * turn with the circles: it stays where it is and its length and words change
 * with the level, dipping out and back in across the middle of a step.
 */
function ScaleBar({
  pxPerMetre,
  diameter,
  at,
  opacity,
}: {
  pxPerMetre: number | null;
  diameter: number;
  at: { x: number; y: number };
  opacity: number;
}) {
  if (diameter < SCALE_BAR_MIN_DIAMETER_PX) return null;
  const px = pxPerMetre === null ? null : pxPerMetre * (diameter / DRAW);
  const length = px === null ? null : niceLength(px, diameter * 0.26);
  if (px === null || length === null) return null;
  return (
    <Tooltip text={`Scale bar: ${lengthLabel(length)}`}>
      <div
        data-scale-bar=""
        style={{
          position: "absolute",
          left: at.x,
          // Above the circle's lower edge by the height of the label and the line, so neither is cut off.
          top: at.y + diameter / 2 - diameter * 0.05 - SCALE_BAR_HEIGHT_PX,
          transform: "translateX(-50%)",
          width: length * px,
          height: SCALE_BAR_HEIGHT_PX,
          opacity,
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        <Text size="xs" level="muted">
          {lengthLabel(length)}
        </Text>
        <div style={{ borderTop: "2px solid var(--color-text-muted)" }} />
      </div>
    </Tooltip>
  );
}

/**
 * The paired circles of the Rendezvous view: the large one at the right, the
 * level just left as a small one at the bottom left, and the turning that moves
 * from one level to the next. Useful for showing the operator that each level
 * is the one before it seen closer. Used by the Rendezvous widget.
 */
export function LensStack({
  target,
  level,
  box,
  layout,
  views,
  docking,
  cues,
}: Readonly<LensStackProps>) {
  const { shown, step } = useTurret(target, level);
  const d = layout.diameter;
  if (d === 0) return null;
  const smallScale = layout.small.diameter / d;
  const places: Places = {
    large: layout.large,
    small: { x: layout.small.x, y: layout.small.y },
    out: { x: -layout.small.diameter / 2 - 12, y: layout.small.y },
    incoming: { x: box.w + d / 2 + 12, y: layout.large.y },
    smallScale,
  };
  const upright = (p: { x: number; y: number }, scale = 1): Pose => ({
    ...p,
    tilt: 0,
    scale,
  });

  let circles: Array<{ level: RendezvousLevel; pose: Pose }>;
  let scaleLevel: RendezvousLevel;
  let scaleOpacity = 1;
  if (step === null) {
    const prev = previousLevel(target, shown);
    // The small circle is drawn last so it sits over the large one where the two overlap.
    circles = [{ level: shown, pose: upright(places.large) }];
    if (prev !== null) {
      circles.push({ level: prev, pose: upright(places.small, smallScale) });
    }
    scaleLevel = shown;
  } else {
    const poses = stepPoses(pivotFor(box), places, step.u);
    const before = previousLevel(target, step.lower);
    circles = [
      { level: step.upper, pose: poses.arriving },
      { level: step.lower, pose: poses.leaving },
    ];
    if (before !== null) circles.push({ level: before, pose: poses.old });
    scaleLevel = step.u < 0.5 ? step.lower : step.upper;
    scaleOpacity = Math.abs(2 * step.u - 1);
  }

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {circles.map((c) => (
        <Lens
          key={c.level}
          level={c.level}
          pose={c.pose}
          diameter={d}
          view={views[c.level]}
          docking={docking}
          cue={cues?.[c.level]}
        />
      ))}
      <ScaleBar
        pxPerMetre={views[scaleLevel]?.(1, false).pxPerMetre ?? null}
        diameter={d}
        at={places.large}
        opacity={scaleOpacity}
      />
    </div>
  );
}
