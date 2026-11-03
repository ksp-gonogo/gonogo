import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  LiveRegion,
  ModelledAlongside,
  NULL_DISPLAY,
  ReadoutCaption,
  reckoningBasisPhrase,
  Text,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useState,
} from "react";
import type { CraftGeometry } from "./geometry/craft";
import {
  type BandsWanted,
  type Box,
  type FigureRoom,
  figureRooms,
  type Layout,
  NO_BANDS,
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
  /** Asks for a band above and below the circle, from what the figures measured. */
  ask: (wanted: BandsWanted) => void;
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
 * One figure in a corner of the box. A figure whose own width does not fit the
 * room it has is held back and reported through `onMisfit`, so the figures can
 * move to bands instead of one being cut short or left out.
 */
function Figure({
  row,
  side,
  room,
  layout,
  tail,
  tailGap = TAIL_GAP,
  onMisfit,
  children,
}: {
  row: "top" | "bottom";
  side: "left" | "right";
  room: FigureRoom;
  layout: Layout;
  /** More of the figure, shown after it only where it fits as well. */
  tail?: ReactNode;
  tailGap?: number;
  onMisfit: () => void;
  children: ReactNode;
}) {
  const { ref, size } = useOwnSize<HTMLSpanElement>();
  const { ref: tailRef, size: tailSize } = useOwnSize<HTMLSpanElement>();
  const measured = size.w > 1;
  const fits = !measured || size.w <= room.width;
  const tailFits =
    tail !== undefined &&
    tail !== null &&
    measured &&
    size.w + tailGap + tailSize.w <= room.width;
  useLayoutEffect(() => {
    if (!fits) onMisfit();
  }, [fits, onMisfit]);
  return (
    <div
      data-figure={`${row}-${side}`}
      style={{
        ...FIGURE_STYLE,
        top: rowTop(layout, row),
        [side]: room.inset,
        visibility: fits ? "visible" : "hidden",
      }}
    >
      <span ref={ref} style={{ display: "inline-block" }}>
        {children}
      </span>
      {tail !== undefined && tail !== null && (
        <span
          ref={tailRef}
          style={{
            display: "inline-block",
            marginLeft: tailGap,
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
function FigureTag({ children }: { children: string }) {
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
          <>
            <AxisArrow direction="right" />
            <Unit value={value("m", reading.dockX)} decimals={2} />
            <span style={{ marginLeft: "1.1em" }}>
              <AxisArrow direction="up" />
              <Unit value={value("m", reading.dockY)} decimals={2} />
            </span>
          </>
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
            <FigureTag>PE</FigureTag>
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
        <FigureTag>CA</FigureTag>
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

/** A short tag the readout may show about the figures' standing, and the words a hover gives it in full. */
interface Notice {
  tag: string;
  detail?: string;
}

function noticeFor(props: ReadoutFiguresProps): Notice | null {
  const { level, reading, layout, docked, noDockingData } = props;
  if (docked) return { tag: "Docked" };
  if (props.noTarget) return { tag: "No target set in KSP" };
  if (noDockingData) return { tag: "No docking data" };
  if (layout.compact) return null;
  if (reading.alignmentWithheld) return { tag: "Alignment withheld" };
  if (level === "docking" && reading.modelledAlignment) {
    return {
      tag: "Reckoned",
      detail: `Alignment reckoned, ${reckoningBasisPhrase(reading.modelledAlignment)}`,
    };
  }
  if (reading.reckoned !== undefined && level !== "docking") {
    return {
      tag: "Modelled",
      detail: `Modelled, ${reckoningBasisPhrase(reading.reckoned.basis)}`,
    };
  }
  return null;
}

/** Whether an arrow beside the range says if the target is closing or opening; one switch to take it out. */
export const RANGE_RATE_ARROW = true;

/** Below this range rate, metres per second, neither arrow is drawn. */
const RANGE_RATE_DEADBAND = 0.05;

/** A small arrow beside the range: down and green while closing, up and amber while opening. */
function RangeRateArrow({
  closing,
}: Readonly<{ closing: number | undefined }>) {
  if (
    closing === undefined ||
    !Number.isFinite(closing) ||
    Math.abs(closing) < RANGE_RATE_DEADBAND
  ) {
    return null;
  }
  const closes = closing > 0;
  return (
    <svg
      data-range-rate={closes ? "closing" : "opening"}
      role="img"
      aria-label={closes ? "Closing" : "Opening"}
      width={9}
      height={11}
      viewBox="0 0 9 11"
      style={{ marginLeft: 4, verticalAlign: "-0.1em" }}
    >
      <path
        d={closes ? "M4.5 10L0.5 4.5H8.5Z" : "M4.5 1L0.5 6.5H8.5Z"}
        fill={closes ? "var(--color-accent-fg)" : "var(--color-warn-mark)"}
      />
    </svg>
  );
}

/**
 * A small arrow before a docking offset, pointing the way that offset counts as
 * positive: across to the right, or up. It takes no width of its own, so the
 * figure keeps the room it already fits in: it sits in the space just before
 * the number.
 */
function AxisArrow({ direction }: Readonly<{ direction: "right" | "up" }>) {
  const right = direction === "right";
  return (
    <span
      style={{
        display: "inline-block",
        position: "relative",
        width: 0,
        height: "1em",
      }}
    >
      <svg
        data-axis-arrow={direction}
        role="img"
        aria-label={right ? "Positive to the right" : "Positive upward"}
        width={right ? 7 : 5}
        height={right ? 6 : 7}
        viewBox={right ? "0 0 7 6" : "0 0 5 7"}
        style={{
          position: "absolute",
          right: 2,
          top: "64%",
          marginTop: right ? -3 : -4,
        }}
      >
        <path
          d={right ? "M6.5 3L0.5 0.5V5.5Z" : "M2.5 0.5L0.5 6.5H4.5Z"}
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

/**
 * The name and the range across the top of the box: on one row where both fit,
 * the range on a row of its own where they do not, and the name wrapping rather
 * than being cut. Reports its height, which the circle gives up.
 */
function TopRow({
  width,
  name,
  range,
  onHeight,
}: Readonly<{
  width: number;
  name: ReactNode;
  range: ReactNode;
  onHeight?: (height: number) => void;
}>) {
  const { ref, size } = useOwnSize<HTMLDivElement>();
  useLayoutEffect(() => {
    onHeight?.(size.h > 1 ? size.h : ROW_HEIGHT);
  }, [size.h, onHeight]);
  return (
    <div
      ref={ref}
      data-figure="top"
      style={{
        ...FIGURE_STYLE,
        top: 0,
        left: 0,
        width,
        display: "flex",
        flexWrap: "wrap",
        columnGap: 8,
        whiteSpace: "normal",
        height: "auto",
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>
        {name}
      </div>
      <div style={{ flex: "none", whiteSpace: "nowrap", marginLeft: "auto" }}>
        {range}
      </div>
    </div>
  );
}

/**
 * The bottom figures along the foot of the box, the second wrapping under the
 * first where the two do not fit one row. Reports its height, which the circle
 * gives up.
 */
function BottomRow({
  layout,
  width,
  left,
  right,
  tail,
  onHeight,
}: Readonly<{
  layout: Layout;
  width: number;
  left: ReactNode;
  right: ReactNode;
  tail: ReactNode;
  onHeight: (height: number) => void;
}>) {
  const { ref, size } = useOwnSize<HTMLDivElement>();
  const { ref: leftRef, size: leftSize } = useOwnSize<HTMLSpanElement>();
  const { ref: rightRef, size: rightSize } = useOwnSize<HTMLSpanElement>();
  const { ref: tailRef, size: tailSize } = useOwnSize<HTMLSpanElement>();
  useLayoutEffect(() => {
    onHeight(size.h > 1 ? size.h : ROW_HEIGHT);
  }, [size.h, onHeight]);
  const hasTail = tail !== undefined && tail !== null;
  const tailFits =
    hasTail &&
    rightSize.w > 1 &&
    leftSize.w + TAIL_GAP + rightSize.w + TAIL_GAP + tailSize.w <= width;
  return (
    <div
      ref={ref}
      data-figure="bottom"
      style={{
        ...FIGURE_STYLE,
        left: 0,
        top: "auto",
        bottom: layout.dotsHeight,
        width,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "space-between",
        columnGap: 8,
        whiteSpace: "normal",
        height: "auto",
      }}
    >
      <span ref={leftRef} style={{ whiteSpace: "nowrap" }}>
        {left}
      </span>
      <span style={{ whiteSpace: "nowrap" }}>
        <span ref={rightRef} style={{ display: "inline-block" }}>
          {right}
        </span>
        {hasTail && (
          <span
            ref={tailRef}
            style={{
              display: "inline-block",
              marginLeft: TAIL_GAP,
              ...(tailFits
                ? {}
                : { position: "absolute", visibility: "hidden" }),
            }}
          >
            {tail}
          </span>
        )}
      </span>
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
              padding: "var(--inset-figure-backing)",
              boxSizing: "border-box",
            }),
      }}
    >
      {row === "top" ? (
        <span
          style={{
            background: "var(--color-surface-sunken)",
            borderRadius: 3,
            padding: "var(--inset-figure-backing)",
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
  const { level, name, reading, layout, box, ask } = props;
  const docking = level === "docking";
  const distance = docking ? reading.dockingDistance : reading.tarDistance;
  const rangeR: Reading<Value<"m">> = reading.rangeR;
  // Every level but the first has the level before it as a small circle in the corner.
  const smallShown = level !== "far";
  const top = figureRooms(layout, box, "top", smallShown);
  const bottom = figureRooms(layout, box, "bottom", smallShown);
  const notice = noticeFor(props);
  const bottoms = bottomFigures(props);

  /*
   * Figures sit in the circle's corners while each fits the room it has there.
   * Once one does not, all of them move to a band above and below the circle,
   * and stay there until the box, the name or the level changes, which is when
   * the corners are tried again: the choice is read off the corner's own room,
   * which does not depend on the bands, so it cannot flip back and forth.
   */
  const choiceKey = `${box.w}x${box.h}|${name}|${level}`;
  const [chosen, setChosen] = useState({ key: choiceKey, bands: false });
  const misfit = useCallback(
    () => setChosen({ key: choiceKey, bands: true }),
    [choiceKey],
  );
  const named = name !== "";
  const banded =
    named &&
    !layout.overlay &&
    (layout.compact || (chosen.key === choiceKey && chosen.bands));
  const [heights, setHeights] = useState({ top: 0, bottom: 0 });
  const topHeight = useCallback(
    (h: number) =>
      setHeights((was) => (was.top === h ? was : { ...was, top: h })),
    [],
  );
  const bottomHeight = useCallback(
    (h: number) =>
      setHeights((was) => (was.bottom === h ? was : { ...was, bottom: h })),
    [],
  );
  useLayoutEffect(() => {
    ask(
      banded
        ? {
            top: heights.top || ROW_HEIGHT,
            bottom: heights.bottom || ROW_HEIGHT,
          }
        : NO_BANDS,
    );
  }, [ask, banded, heights.top, heights.bottom]);

  const rangeMain =
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
        {!docking && RANGE_RATE_ARROW && (
          <RangeRateArrow closing={reading.relVel} />
        )}
      </Text>
    );
  // The modelled figure is more of the range, drawn only where there is room beside it, so it never hides the range itself.
  const rangeTail =
    distance === undefined || docking ? null : (
      <Text size="sm" style={{ fontWeight: 600 }}>
        <ModelledAlongside
          observed={rangeR.value}
          modelled={
            reading.reckonedDistance === undefined
              ? undefined
              : value("m", reading.reckonedDistance)
          }
        />
      </Text>
    );
  const range = (
    <>
      {rangeMain}
      {rangeTail}
    </>
  );
  // A tall box leaves the top clear of the circle: the name and range sit in a row there, wrapping rather than reserving a band.
  const clearTop =
    layout.diameter === 0 || layout.large.y - layout.diameter / 2 >= ROW_HEIGHT;
  const nameSmall = <Text size="xs">{name}</Text>;
  const nameText = (
    <Text size="sm" style={{ letterSpacing: "0.05em" }}>
      {name}
    </Text>
  );
  const bottomRowShown = banded && layout.bottomBand > 0;
  return (
    <>
      {named ? (
        layout.overlay ? (
          <OverlayRows
            layout={layout}
            boxWidth={box.w}
            name={nameSmall}
            range={range}
          />
        ) : banded ? (
          <>
            <TopRow
              width={box.w}
              name={nameText}
              range={range}
              onHeight={topHeight}
            />
            {bottomRowShown && (
              <BottomRow
                layout={layout}
                width={box.w}
                left={bottoms.left}
                right={bottoms.right}
                tail={bottoms.rightTail}
                onHeight={bottomHeight}
              />
            )}
          </>
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
                  onMisfit={misfit}
                >
                  {nameText}
                </Figure>
                <Figure
                  row="top"
                  side="right"
                  room={top.right}
                  layout={layout}
                  tail={rangeTail}
                  tailGap={0}
                  onMisfit={misfit}
                >
                  {rangeMain}
                </Figure>
              </>
            )}
            <Figure
              row="bottom"
              side="left"
              room={bottom.left}
              layout={layout}
              onMisfit={misfit}
            >
              {bottoms.left}
            </Figure>
            <Figure
              row="bottom"
              side="right"
              room={bottom.right}
              layout={layout}
              tail={bottoms.rightTail}
              onMisfit={misfit}
            >
              {bottoms.right}
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
          pointerEvents: "none",
        }}
      >
        <LiveRegion>
          {notice !== null && <NoticeTag notice={notice} />}
        </LiveRegion>
      </div>
    </>
  );
}

/** The tag, with its fuller words on hover where it has them. */
function NoticeTag({ notice }: Readonly<{ notice: Notice }>) {
  const tag = (
    <ReadoutCaption
      style={{
        background: "var(--color-surface-sunken)",
        borderRadius: 3,
        padding: "var(--inset-chip)",
        pointerEvents: "auto",
      }}
    >
      {notice.tag}
    </ReadoutCaption>
  );
  return notice.detail === undefined ? (
    tag
  ) : (
    <Tooltip text={notice.detail}>{tag}</Tooltip>
  );
}
