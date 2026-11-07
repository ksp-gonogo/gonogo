import { ReadoutCaption, Text, Tooltip, Unit } from "@ksp-gonogo/ui-kit";
import { type Rect, ROW_HEIGHT } from "./layout";
import type { OrbitFrameAxis } from "./orbitFrame";
import { RangeRateArrow } from "./RangeRateArrow";

/** Two places while the rate is a thruster's worth, fewer as it grows, so a drift measured in kilometres a second does not print noise. */
function rateDecimals(axis: OrbitFrameAxis): number {
  return axis.rateSize < 10 ? 2 : axis.rateSize < 100 ? 1 : 0;
}

/**
 * Where the target is from the craft along the craft's own orbit, three rows:
 * how far ahead or behind, above or below, left or right, each with the rate
 * that offset is changing at and an arrow for whether it is nearing or moving
 * off. Useful for flying a rendezvous by the axes the orbit gives, where the
 * scene-axes range alone cannot say which way the target is drifting. Used by
 * the Rendezvous widget in the room round its circle that is otherwise empty.
 */
export function FrameReadout({
  axes,
  room,
}: Readonly<{ axes: readonly OrbitFrameAxis[]; room: Rect }>) {
  return (
    <div
      data-frame-readout=""
      style={{
        position: "absolute",
        left: room.x,
        top: room.y,
        width: room.w,
        height: room.h,
        pointerEvents: "auto",
      }}
    >
      {axes.map((axis) => (
        <div
          key={axis.key}
          data-frame-axis={axis.key}
          style={{
            display: "flex",
            alignItems: "baseline",
            columnGap: 8,
            height: ROW_HEIGHT,
            lineHeight: `${ROW_HEIGHT}px`,
            whiteSpace: "nowrap",
          }}
        >
          <Tooltip text={axis.positive}>
            <span style={{ flex: "0 0 7ch" }}>
              <ReadoutCaption>{axis.word}</ReadoutCaption>
            </span>
          </Tooltip>
          <Text size="sm">
            <Unit value={axis.offset} />
          </Text>
          <Text size="sm" level="muted">
            <Unit value={axis.rate} decimals={rateDecimals(axis)} />
            <RangeRateArrow closing={axis.closing} />
          </Text>
        </div>
      ))}
    </div>
  );
}
