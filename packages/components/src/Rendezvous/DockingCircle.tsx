import { AugmentSlot } from "@ksp-gonogo/core";
import {
  type DockMarkSide,
  dockMarkGeometry,
  dockMarkPath,
  dockMarkStyles,
  type RendezvousPicture,
} from "@ksp-gonogo/sitrep-sdk";
import { useElementSize } from "@ksp-gonogo/ui-kit";
import { Crosshair, HorizTick, Reticle, VertTick } from "./DockingReticle";
import { DRAWN_FIELD_HALF_DEG, DRAWN_PICTURE } from "./edgeCue";
import {
  type Picture,
  reticleOffset,
  reticleTravelPx,
} from "./reticleGeometry";
import type { RendezvousHudContext } from "./slots";

export interface DockingCircleProps {
  /** Distance to the target port in metres, for the augments. */
  distance: number | undefined;
  /** The reading the alignment and distance were drawn from, handed to the augments. */
  figuresReading: RendezvousHudContext["held"];
  ax: number | undefined;
  ay: number | undefined;
  /** Cosine of the angle between the two ports' forward vectors (-1 when they face head-on); takes priority for the reticle tint. */
  forwardDot: number | undefined;
  /** True once the own docking port is pre-attached or docked to the target. */
  docked: boolean;
  /** The targeted port's persistent ids, handed to the augments so a camera can mark it. */
  targetPort: RendezvousHudContext["targetPort"];
  showCamera: boolean;
  cameraFlightId: number | null | undefined;
  /** The picture the camera slot reported, if it has. */
  picture: RendezvousPicture | null;
  /** Told the picture the camera slot reports, for the reticle's scale and the border cue. */
  onPicture: (picture: RendezvousPicture | null) => void;
  /** The target was cleared (KSP clears it when a dock completes): the picture stays, the reticle and overlay go. */
  cleared?: boolean;
}

/** Without a camera picture the circle is the picture: its rim is this many degrees off the port's line, and past it the pilot is reorienting, not docking, so the reticle stops at the rim. */
const MAX_DEG = DRAWN_FIELD_HALF_DEG;
/** The reticle's own radius, which the rim keeps clear. */
const RETICLE_R = 12;
/** A docking port's radius in metres, for how large the triangles round it read at a range. */
const PORT_RADIUS_M = 0.625;
const SIDES: readonly DockMarkSide[] = ["top", "right", "bottom", "left"];
/** The width of the frame's own border, which the slot's box sits inside. */
const FRAME_BORDER_PX = 1;

/**
 * The contents of the Docking level's circle: the camera slot, the reticle
 * where there is no picture, and the overlay slot, all in the square the frame
 * clips to a disc. Useful for flying the final metres on the picture or, with
 * none, on the reticle. Used by the Rendezvous widget.
 */
export function DockingCircle({
  distance,
  figuresReading,
  ax,
  ay,
  forwardDot,
  docked,
  targetPort,
  showCamera,
  cameraFlightId,
  picture: reported,
  onPicture,
  cleared = false,
}: Readonly<DockingCircleProps>) {
  const { ref, size } = useElementSize<HTMLDivElement>({ w: 1, h: 1 });
  const cameraPicture: Picture | null =
    showCamera && reported !== null
      ? {
          aspect: reported.frameWidth / reported.frameHeight,
          verticalFovDeg: reported.vfovDeg,
        }
      : null;
  // With no camera picture the circle is the picture: square, its rim at MAX_DEG.
  const drawn = cameraPicture === null;
  const picture: Picture = cameraPicture ?? {
    aspect: DRAWN_PICTURE.frameWidth / DRAWN_PICTURE.frameHeight,
    verticalFovDeg: DRAWN_PICTURE.vfovDeg,
  };
  const side = Math.min(size.w, size.h);
  const travel = reticleTravelPx(
    { width: size.w, height: size.h },
    picture,
    MAX_DEG,
  );
  // -ay puts "nose up" at top.
  const rawX = ax === undefined ? 0 : reticleOffset(ax, MAX_DEG, picture);
  const rawY = ay === undefined ? 0 : -reticleOffset(ay, MAX_DEG, picture);
  // On the drawn picture the offset stops on the rim, radially, so the reticle is never lost in a corner of the square.
  const radial = (limit: number) => {
    const length = Math.hypot(rawX, rawY);
    return drawn && length > limit && length > 0
      ? { x: (rawX * limit) / length, y: (rawY * limit) / length }
      : { x: rawX, y: rawY };
  };
  const { x: dx, y: dy } = radial(1);
  const rimLimit =
    travel > 0 ? Math.max(0, (side / 2 - RETICLE_R) / travel) : 0;
  const placed = radial(rimLimit);
  const tick = (units: number) => `calc(50% + ${units * travel}px)`;
  // Past the rim the target is off the picture: the border cue says so and the ring is not drawn.
  const inField =
    ax === undefined ||
    ay === undefined ||
    Math.hypot(Math.tan((ax * Math.PI) / 180), Math.tan((ay * Math.PI) / 180)) <
      Math.tan((MAX_DEG * Math.PI) / 180);
  // Head-on ports have antiparallel forward vectors, so aligned is a dot near -1; 0.9998 is within about 1 degree of dead-on.
  const aligned =
    forwardDot !== undefined
      ? forwardDot < -0.9998
      : ax !== undefined &&
        ay !== undefined &&
        Math.abs(ax) < 1 &&
        Math.abs(ay) < 1;
  const context: RendezvousHudContext = {
    maxDeg: MAX_DEG,
    reticleOffset: { x: dx, y: dy },
    reticleTravelPx: travel,
    reportPicture: onPicture,
    aligned,
    ax,
    ay,
    distance,
    targetPort,
    docked,
    held: figuresReading,
    cameraFlightId,
    pictureCircle: {
      cx: side / 2,
      cy: side / 2,
      radius: side / 2,
      borderWidth: FRAME_BORDER_PX,
    },
  };
  return (
    <>
      {showCamera && <AugmentSlot name="rendezvous.camera" props={context} />}
      <div
        ref={ref}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          background:
            "radial-gradient(circle at center, rgba(0, 255, 136, 0.08) 0%, rgba(0, 0, 0, 0.3) 70%)",
        }}
      >
        {drawn && (!cleared || docked) && (
          <>
            <Crosshair />
            {!docked && inField && (
              <Reticle
                aligned={aligned}
                left={`calc(50% + ${placed.x * travel}px)`}
                top={`calc(50% + ${placed.y * travel}px)`}
              />
            )}
            {/* Axis ticks at half and full travel give the pilot the scale, the same on both axes. */}
            {[-1, -0.5, 0.5, 1].map((units) => (
              <HorizTick key={`h${units}`} left={tick(units)} />
            ))}
            {[-1, -0.5, 0.5, 1].map((units) => (
              <VertTick key={`v${units}`} top={tick(units)} />
            ))}
            <DrawnMarks
              side={side}
              x={side / 2 + (docked ? 0 : placed.x * travel)}
              y={side / 2 + (docked ? 0 : placed.y * travel)}
              distance={distance}
              travel={travel}
              ax={ax}
              ay={ay}
              aligned={aligned}
              docked={docked}
            />
          </>
        )}
        {!cleared && <AugmentSlot name="rendezvous.overlay" props={context} />}
      </div>
    </>
  );
}

/**
 * The four triangles round the target port on the drawn picture, drawn the
 * same way the camera's picture has them: the look from `dockMarkStyles`, the
 * shape from `dockMarkPath`, sized with the port's range. Left out while the
 * port is past the rim, where the border cue says which way it went.
 */
function DrawnMarks({
  side,
  x,
  y,
  distance,
  travel,
  ax,
  ay,
  aligned,
  docked,
}: {
  side: number;
  x: number;
  y: number;
  distance: number | undefined;
  travel: number;
  ax: number | undefined;
  ay: number | undefined;
  aligned: boolean;
  docked: boolean;
}) {
  if (!(side > 1)) return null;
  const edge = Math.tan((MAX_DEG * Math.PI) / 180);
  const inside =
    docked ||
    (ax !== undefined &&
      ay !== undefined &&
      Math.hypot(
        Math.tan((ax * Math.PI) / 180),
        Math.tan((ay * Math.PI) / 180),
      ) < edge);
  const styles = dockMarkStyles({ visible: inside, ax, ay, aligned, docked });
  // Pixels the drawn picture takes for one unit of tangent, then the port's radius at its range.
  const focal = travel / edge;
  const radiusPx =
    distance !== undefined && distance > 0
      ? (focal * PORT_RADIUS_M) / distance
      : 0;
  const geometry = dockMarkGeometry({ x, y }, Math.min(radiusPx, side * 0.22), {
    half: Math.max(8, side * 0.075),
    arm: Math.max(4, side * 0.03),
    stroke: side > 150 ? 2 : 1.5,
  });
  return (
    <svg
      aria-hidden="true"
      data-dock-marks=""
      width={side}
      height={side}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      {SIDES.map((name) => {
        const style = styles[name];
        if (style.hidden) return null;
        const colour = style.colour ?? "var(--color-accent-fg)";
        return (
          <path
            key={name}
            data-mark={name}
            d={dockMarkPath(name, geometry)}
            strokeWidth={geometry.stroke}
            strokeDasharray={style.dashed ? "3 2" : undefined}
            style={{
              fill: style.dashed ? "none" : colour,
              stroke: colour,
            }}
          />
        );
      })}
    </svg>
  );
}
