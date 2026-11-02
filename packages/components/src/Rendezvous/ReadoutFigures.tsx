import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  LiveRegion,
  ModelledAlongside,
  NULL_DISPLAY,
  ReadoutCaption,
  reckoningBasisPhrase,
  Text,
  Unit,
  UnitSharedFormat,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import type { CraftGeometry } from "./geometry/craft";
import {
  type Box,
  type FigureRoom,
  figureRooms,
  type Layout,
  ROW_HEIGHT,
  rowTop,
} from "./layout";
import type { RendezvousLevel } from "./levels";
import { DisplayDash } from "./RendezvousView";
import { useOwnSize } from "./useOwnSize";
import type { RendezvousReading } from "./useRendezvousReading";

export interface ReadoutFiguresProps {
  level: RendezvousLevel;
  name: string;
  reading: RendezvousReading;
  /** The craft circles' geometry, for the phase. */
  craft: CraftGeometry | null;
  /** The body's periapsis, at the Encounter level. */
  periapsis: { inSeconds: number | null; altitude: number } | null;
  layout: Layout;
  box: Box;
  /** The two ports are joined, or the target was cleared as they joined. */
  docked: boolean;
  /** The target was cleared without the ports having joined. */
  noTarget: boolean;
  /** A port is targeted inside docking range and the docking channel reports nothing. */
  noDockingData: boolean;
}

/** The gap before a figure's tail. */
const TAIL_GAP = 6;

/** The line height of a name wrapped over the circle. */
const NAME_LINE_HEIGHT = 14;

const FIGURE_STYLE: CSSProperties = {
  position: "absolute",
  whiteSpace: "nowrap",
  lineHeight: `${ROW_HEIGHT}px`,
  height: ROW_HEIGHT,
};

/**
 * One figure in a corner of the box. It is left out, not cut short, where its
 * own width does not fit the room it has; the name alone is ellipsised.
 */
function Figure({
  row,
  side,
  room,
  layout,
  ellipsis = false,
  tail,
  children,
}: {
  row: "top" | "bottom";
  side: "left" | "right";
  room: FigureRoom;
  layout: Layout;
  ellipsis?: boolean;
  /** More of the figure, shown after it only where it fits as well. */
  tail?: ReactNode;
  children: ReactNode;
}) {
  const { ref, size } = useOwnSize<HTMLSpanElement>();
  const { ref: tailRef, size: tailSize } = useOwnSize<HTMLSpanElement>();
  const measured = size.w > 1;
  const fits = ellipsis || !measured || size.w <= room.width;
  const tailFits =
    tail !== undefined &&
    tail !== null &&
    measured &&
    size.w + TAIL_GAP + tailSize.w <= room.width;
  return (
    <div
      data-figure={`${row}-${side}`}
      style={{
        ...FIGURE_STYLE,
        top: rowTop(layout, row),
        [side]: room.inset,
        maxWidth: room.width,
        overflow: ellipsis ? "hidden" : undefined,
        textOverflow: ellipsis ? "ellipsis" : undefined,
        visibility: fits ? "visible" : "hidden",
      }}
    >
      <span
        ref={ref}
        style={
          ellipsis
            ? { display: "block", overflow: "hidden", textOverflow: "ellipsis" }
            : { display: "inline-block" }
        }
      >
        {children}
      </span>
      {tail !== undefined && tail !== null && (
        <span
          ref={tailRef}
          style={{
            display: "inline-block",
            marginLeft: TAIL_GAP,
            ...(tailFits ? {} : { position: "absolute", visibility: "hidden" }),
          }}
        >
          {tail}
        </span>
      )}
    </div>
  );
}

function degrees(v: number | null | undefined, decimals: number): ReactNode {
  return v === null || v === undefined || !Number.isFinite(v) ? (
    NULL_DISPLAY
  ) : (
    <Unit value={value("°", v)} decimals={decimals} />
  );
}

/** The faint letters before a figure that its unit alone does not name. */
function Tag({ children }: { children: string }) {
  return (
    <ReadoutCaption style={{ marginRight: 4, letterSpacing: "0.08em" }}>
      {children}
    </ReadoutCaption>
  );
}

function bottomFigures(props: ReadoutFiguresProps): {
  left: ReactNode;
  right: ReactNode;
  rightTail?: ReactNode;
} {
  const { level, reading, craft, periapsis, docked } = props;
  if (level === "docking") {
    const closing = reading.dockingClosing;
    const approaching =
      docked ||
      (closing !== undefined && Number.isFinite(closing) && closing > 0);
    return {
      left:
        closing === undefined || !Number.isFinite(closing) ? (
          NULL_DISPLAY
        ) : (
          <span
            style={{
              color: approaching
                ? "var(--color-accent-fg)"
                : "var(--color-warn-mark)",
            }}
          >
            <Unit value={value("m/s", closing)} decimals={2} />
          </span>
        ),
      right:
        reading.dockX === undefined || reading.dockY === undefined ? (
          NULL_DISPLAY
        ) : (
          <UnitSharedFormat>
            <Unit
              value={value("m", reading.dockX)}
              decimals={2}
              hideUnitInGroup
            />
            {" / "}
            <Unit value={value("m", reading.dockY)} decimals={2} />
          </UnitSharedFormat>
        ),
    };
  }
  if (level === "encounter" || periapsis !== null) {
    return {
      left:
        periapsis === null ? (
          NULL_DISPLAY
        ) : (
          <>
            <Tag>PE</Tag>
            <Unit value={value("m", periapsis.altitude)} />
          </>
        ),
      right:
        periapsis === null || periapsis.inSeconds === null ? null : (
          <Unit value={value("s", periapsis.inSeconds)} decimals={0} />
        ),
    };
  }
  const miss = reading.closestApproachDistance;
  return {
    left: degrees(craft?.phase, 1),
    right: (
      <>
        <Tag>CA</Tag>
        {miss.value === undefined ? (
          NULL_DISPLAY
        ) : (
          <Unit value={miss} decimals={1} />
        )}
      </>
    ),
    rightTail:
      reading.timeToClosestApproach.value === undefined ? null : (
        <Countdown value={reading.timeToClosestApproach} clock precise />
      ),
  };
}

/** The one line the readout may say about the figures' standing, or null. */
function noticeFor(props: ReadoutFiguresProps): string | null {
  const { level, reading, layout, docked, noDockingData } = props;
  if (docked) return "Docked";
  if (props.noTarget) return "No target set in KSP";
  if (noDockingData) return "No docking data";
  if (layout.compact) return null;
  if (reading.alignmentWithheld) return "Docking alignment withheld";
  if (level === "docking" && reading.modelledAlignment) {
    return `Alignment reckoned, ${reckoningBasisPhrase(reading.modelledAlignment)}`;
  }
  if (reading.reckoned !== undefined && level !== "docking") {
    return `Modelled, ${reckoningBasisPhrase(reading.reckoned.basis)}`;
  }
  return null;
}

/** The name and the range on one row across the top of the box, the name giving way to an ellipsis. */
function TopRow({
  width,
  name,
  range,
}: Readonly<{ width: number; name: ReactNode; range: ReactNode }>) {
  return (
    <div
      data-figure="top"
      style={{
        ...FIGURE_STYLE,
        top: 0,
        left: 0,
        width,
        display: "flex",
        gap: 8,
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </div>
      <div style={{ flex: "none" }}>{range}</div>
    </div>
  );
}

/**
 * The name across the top of the circle and the range at its foot, clear of the small circle, each
 * on a backing laid over the circle, in a box too narrow to leave them a
 * corner: the circle keeps its size.
 */
function OverlayRows({
  layout,
  boxWidth,
  name,
  range,
}: Readonly<{
  layout: Layout;
  boxWidth: number;
  name: ReactNode;
  range: ReactNode;
}>) {
  const r = layout.diameter / 2;
  const inset = r * 0.16;
  const half = Math.sqrt(Math.max(r * r - (r - inset - ROW_HEIGHT) ** 2, 0));
  const pill = (row: "top" | "bottom", children: ReactNode) => (
    <div
      data-figure={row}
      style={{
        ...FIGURE_STYLE,
        top: row === "top" ? 0 : layout.large.y + r - inset - ROW_HEIGHT,
        left: row === "top" ? 0 : layout.large.x + half * 0.8,
        transform: row === "top" ? undefined : "translateX(-100%)",
        maxWidth: row === "top" ? undefined : half * 0.8,
        ...(row === "top"
          ? {
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              textAlign: "center",
              lineHeight: `${NAME_LINE_HEIGHT}px`,
              height: "auto",
              width: boxWidth,
            }
          : {}),
        ...(row === "top"
          ? {}
          : {
              background: "var(--color-surface-sunken)",
              borderRadius: 3,
              padding: "0 3px",
              boxSizing: "border-box",
            }),
      }}
    >
      {row === "top" ? (
        <span
          style={{
            background: "var(--color-surface-sunken)",
            borderRadius: 3,
            padding: "0 3px",
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {children}
        </span>
      ) : (
        children
      )}
    </div>
  );
  return (
    <>
      {pill("top", name)}
      {pill("bottom", range)}
    </>
  );
}

/**
 * The target's name and range along the top of the view and two more figures
 * along the bottom, in the corners the large circle leaves, the same corners
 * at every level: only the figures change as the view zooms. A figure that
 * would not fit its corner is left out, and a narrow box keeps the name and
 * the range alone. Useful for reading the numbers of the approach whichever
 * circle is large. Used by the Rendezvous widget.
 */
export function ReadoutFigures(props: Readonly<ReadoutFiguresProps>) {
  const { level, name, reading, layout, box } = props;
  const docking = level === "docking";
  const distance = docking ? reading.dockingDistance : reading.tarDistance;
  const rangeR: Reading<Value<"m">> = reading.rangeR;
  // Every level but the first has the level before it as a small circle in the corner.
  const smallShown = level !== "far";
  const top = figureRooms(layout, box, "top", smallShown);
  const bottom = figureRooms(layout, box, "bottom", smallShown);
  const notice = noticeFor(props);
  const bottoms = layout.compact ? null : bottomFigures(props);
  const range =
    distance === undefined ? (
      <DisplayDash />
    ) : (
      <Text
        size="sm"
        tone={reading.outOfContact ? undefined : "go"}
        level="muted"
        style={{ fontWeight: 600 }}
      >
        {docking ? (
          <Unit
            value={value("m", props.docked ? 0 : distance)}
            decimals={props.docked || distance < 10 ? 2 : 1}
          />
        ) : (
          <Unit value={rangeR} />
        )}
        {!docking && (
          <ModelledAlongside
            observed={rangeR.value}
            modelled={
              reading.reckonedDistance === undefined
                ? undefined
                : value("m", reading.reckonedDistance)
            }
          />
        )}
      </Text>
    );
  // A narrow box has one figure to a row, the width of the box where the circle leaves it clear.
  const clearTop =
    layout.diameter === 0 || layout.large.y - layout.diameter / 2 >= ROW_HEIGHT;
  const nameSmall = <Text size="xs">{name}</Text>;
  const nameText = (
    <Text size="sm" style={{ letterSpacing: "0.05em" }}>
      {name}
    </Text>
  );
  return (
    <>
      {name !== "" ? (
        layout.overlay ? (
          <OverlayRows
            layout={layout}
            boxWidth={box.w}
            name={nameSmall}
            range={range}
          />
        ) : layout.compact ? (
          <TopRow width={box.w} name={nameText} range={range} />
        ) : (
          <>
            {clearTop ? (
              <TopRow width={box.w} name={nameText} range={range} />
            ) : (
              <>
                <Figure
                  row="top"
                  side="left"
                  room={top.left}
                  layout={layout}
                  ellipsis
                >
                  {nameText}
                </Figure>
                <Figure row="top" side="right" room={top.right} layout={layout}>
                  {range}
                </Figure>
              </>
            )}
            <Figure row="bottom" side="left" room={bottom.left} layout={layout}>
              {bottoms?.left}
            </Figure>
            <Figure
              row="bottom"
              side="right"
              room={bottom.right}
              layout={layout}
              tail={bottoms?.rightTail}
            >
              {bottoms?.right}
            </Figure>
          </>
        )
      ) : null}
      <div
        data-readout-notice=""
        style={{
          position: "absolute",
          left: layout.large.x,
          top: layout.large.y - layout.diameter / 2 + layout.diameter * 0.07,
          transform: "translateX(-50%)",
          maxWidth: Math.max(layout.diameter * 0.9, 0),
          textAlign: "center",
          whiteSpace: layout.diameter >= 140 ? "nowrap" : "normal",
          pointerEvents: "none",
        }}
      >
        <LiveRegion>
          {notice !== null && (
            <ReadoutCaption
              style={{
                background: "var(--color-surface-sunken)",
                borderRadius: 3,
                padding: "1px 6px",
              }}
            >
              {notice}
            </ReadoutCaption>
          )}
        </LiveRegion>
      </div>
    </>
  );
}
