import { magnitudeOf, type PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Box } from "../Box";
import { FramedDisplay } from "../FramedDisplay";
import { GraphNotice, placeGraphNotice } from "../GraphNotice";
import { Panel } from "../Panel";
import { resolveCurrency, type UnitValue } from "../readingCurrency";
import { Section } from "../Section";
import { speakQuantity } from "../units";
import {
  type AxisScale,
  type ChartSeries,
  LineChart,
  type ThresholdKind,
  type ThresholdRule,
} from "./LineChart";
import type { LimitSide } from "./limitCrossings";
import { unitTick, writeThreeFigures } from "./ticks";

/**
 * A static curve drawn behind the series of a graph whose x axis is not time,
 * given as parallel `xs` and `ys` arrays. Useful for showing the operator the
 * figure a model expects at each x, such as the pressure a body's atmosphere
 * should have at each altitude. Passed in the `referenceCurves` prop of
 * {@link Graph}, which subscribes to nothing for it.
 *
 * @category Graph
 */
export interface ReferenceCurve {
  /** Unique among the curves and the series of the graph. */
  id: string;
  /** Names the curve in the legend and in the chart's accessible name. */
  label: string;
  /** The x of each sample. */
  xs: number[];
  /** The y of each sample. */
  ys: number[];
  /** CSS colour of the stroke; a dim accent when omitted. */
  color?: string;
  /** The y axis the curve is read against; `"primary"` when omitted. */
  axis?: "primary" | "secondary";
}

/**
 * A horizontal line across a graph at a quantity in its axis's unit. Useful for
 * showing the operator how far a trace is from the figure that matters. Passed
 * in the `thresholds` prop of {@link Graph}, which places the line, writes the
 * quantity after the label and picks the tone from `kind` and the plotted data.
 * Pass the whole reading where the figure came from one: the line then stands at
 * the model's figure where a model carried it, and its label is marked held or
 * modelled as the reading is.
 *
 * @category Graph
 */
export type GraphThreshold = {
  /** Defaults to the line's position in the list. */
  id?: string;
  /** The figure the line stands at, with its unit. */
  value: UnitValue;
  /** Names the line; the figure is written after it. */
  label?: string;
  /** The y axis the line is read against; `"primary"` when omitted. */
  axis?: "primary" | "secondary";
} & (
  | {
      /** A figure not to pass. */
      kind: "limit";
      /** The side of the line that is out of bounds: `above` for a ceiling, `below` for a floor. */
      bad: LimitSide;
    }
  | {
      /** A figure to reach, or the place something is now. */
      kind: Exclude<ThresholdKind, "limit">;
    }
);

/**
 * Where a graph's newest sample stands, and the figure each reference curve has
 * at that x. Useful for a readout that names the present state beside the
 * graph. Handed to a `plotReadout` function of {@link Graph} in the `present` of
 * its {@link ReadoutRoom}.
 *
 * @category Graph
 */
export interface PresentPoint {
  /** The x of the newest sample of the first plotted series. */
  x: number;
  /** The y of that sample. */
  y: number;
  /** Reference curves read at `x`, by curve id; a curve that does not reach `x` is left out. */
  references: Readonly<Record<string, number>>;
}

/**
 * The space a graph offers its readout, so the readout can answer with a form
 * that fits: a column has all it needs, a card on the plot has the plot's.
 * Useful for choosing between a spread-out and a compact readout. Handed to a
 * `plotReadout` function of {@link Graph}.
 *
 * @category Graph
 */
export interface ReadoutRoom {
  /** The width on offer, in pixels. */
  width: number;
  /** The height on offer, in pixels. */
  height: number;
  /** Where the first plotted series stands now and what each reference curve reads there, in the plot's own numbers. Absent on a time axis or before a sample arrives. */
  present?: PresentPoint;
  /** Figures set beside their labels have no clear corner, so they should be stacked under them. */
  compact: boolean;
  /** Stacked figures have no clear corner either, so they should be drawn as small as they can be. */
  tight: boolean;
}

/**
 * Props for {@link Graph}. Useful for giving the operator a chart of one or more
 * series against a time or value axis, with its reference lines, notice and
 * readout. Taken by {@link Graph}.
 *
 * @category Graph
 */
export interface GraphProps {
  /** The lines to draw, each already holding its samples. */
  series: ChartSeries[];
  /** The x range the plot covers. */
  xDomain: [number, number];
  /** Pins the primary y domain; derived from the series and thresholds when absent. */
  yDomainPrimary?: [number, number];
  /** Pins the secondary y domain; derived from the series and thresholds when absent. */
  yDomainSecondary?: [number, number];
  /** Linear or log10 scale of the primary y axis; linear when absent. */
  yScalePrimary?: AxisScale;
  /** Linear or log10 scale of the secondary y axis; linear when absent. */
  yScaleSecondary?: AxisScale;
  /** Writes an x tick. Takes precedence over `xUnit`; elapsed time when both are absent. Handed every tick of the axis as well, so it can give them the decimals that tell them apart. */
  xTickFormat?: (
    value: number,
    domain: readonly [number, number],
    ticks?: readonly number[],
  ) => string;
  /** Writes the x of the crosshair's heading and announcement, where it should differ from a tick label. */
  xReadFormat?: (value: number, domain: readonly [number, number]) => string;
  /** Writes a primary or secondary y tick. Takes precedence over `yUnit`. */
  yTickFormat?: (value: number, ticks?: readonly number[]) => string;
  /** The unit symbol the x ticks are in, written through the unit ladder with the decimals that tell the ticks apart. Ignored when `xTickFormat` is given. */
  xUnit?: string;
  /** The unit symbol the y ticks are in, written through the unit ladder. Ignored when `yTickFormat` is given. */
  yUnit?: string;
  /** Lines across the plot, each at a quantity in its axis's unit. */
  thresholds?: readonly GraphThreshold[];
  /** Static curves drawn behind the series; ignored while `xKind` is `"time"`. */
  referenceCurves?: readonly ReferenceCurve[];
  /** Everything drawn beyond the series, in data space. */
  layers?: readonly PlotLayer[];
  /** What x is: `"time"` (the default) reads a series at its own instants, `"value"` reads it at the sample nearest the crosshair. */
  xKind?: "time" | "value";
  /** Names the x axis, with its unit, under the tick labels. */
  xAxisLabel?: string;
  /** Names the primary y axis, with its unit, up the left edge. */
  yAxisLabel?: string;
  /** Names the secondary y axis, with its unit, down the right edge. */
  ySecondaryAxisLabel?: string;
  /** Names what the chart is, before its layers add their own clauses. */
  "aria-label"?: string;
  /** Drops the x tick ladder and its gridlines, for a one-dimensional plot. */
  hideXAxis?: boolean;
  /** A view of a place rather than a chart: no tick ladders, content to the frame edges, equal scale on both axes. */
  spatial?: boolean;
  /** Scales the pitch of a spatial plot's dot lattice, 0.5 to 2. */
  gridScale?: number;
  /** Reads every series at one x on pointer hover and from the keyboard. On unless `hideXAxis` is set. */
  crosshair?: boolean;
  /** What the graph cannot show, such as "plotting trace only". Placed over an empty plot with room, beside a wide short one, below the rest. */
  notice?: ReactNode;
  /** Shown as a notice while there are no series, curves or layers. */
  emptyState?: ReactNode;
  /** A line inlaid over the frame's bottom-left corner, for a warning about what is drawn. */
  footer?: ReactNode;
  /**
   * Figures the plot shows about the present, as one fixed card. Where the plot
   * has measured room for it, the card takes a column beside the plot, inside
   * its frame. Where it does not, the card stands over the plot in a corner no
   * trace, line or legend chip crosses, and where no corner is clear it is not
   * drawn.
   */
  plotReadout?: ReactNode | ((room: ReadoutRoom) => ReactNode);
  /** `"panel"` (the default) wraps the plot in a panel with a header; `"bare"` draws the framed plot alone, for a plot composed inside another layout. */
  chrome?: "panel" | "bare";
  /** The panel header. Only read while `chrome` is `"panel"`. */
  title?: ReactNode;
  /** Controls placed in the panel header. Only read while `chrome` is `"panel"`. */
  headerActions?: ReactNode;
  /** A fixed height in pixels; the graph fills its parent when absent. */
  height?: number;
  /** Placed inside the frame after the plot, for something that draws nothing, such as a data subscription. */
  children?: ReactNode;
}

/** The value of a sampled curve at `x` by straight lines between samples, or nothing outside the curve. */
function readCurveAt(
  xs: readonly number[],
  ys: readonly number[],
  x: number,
): number | undefined {
  for (let i = 1; i < xs.length; i++) {
    const [x0, x1] = [xs[i - 1], xs[i]];
    if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && x1 !== x0) {
      return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - x0)) / (x1 - x0);
    }
  }
  return undefined;
}

/**
 * A threshold as the chart draws it: placed at the figure its quantity
 * resolves to, which is the model's where the reading carries one, and labelled
 * with that figure after the caller's own words. A line with no finite figure
 * is not drawn.
 */
function thresholdRuleOf(
  line: GraphThreshold,
  index: number,
): ThresholdRule | null {
  const { shown } = resolveCurrency(line.value, { drawsReckoning: true });
  // The one number the chart's scale needs, taken where the line is placed.
  const at = magnitudeOf(shown);
  if (at === null) return null;
  return {
    id: line.id ?? `threshold-${index}`,
    value: at,
    ...(line.kind === "limit"
      ? { kind: line.kind, bad: line.bad }
      : { kind: line.kind }),
    axis: line.axis,
    // Drawn with the unit's symbol like every other figure on the chart, and read aloud with its word.
    label: [line.label, shown ? writeThreeFigures(shown) : undefined]
      .filter(Boolean)
      .join(": "),
    spokenLabel: [line.label, speakQuantity(shown)].filter(Boolean).join(": "),
    reading: "state" in line.value ? line.value : undefined,
  };
}

/** Referentially stable, so an unlayered chart does not remount its layer renderer every render. */
const EMPTY_LAYERS: readonly PlotLayer[] = Object.freeze([]);

/** A column beside the plot is assumed this wide until it has been measured. */
const ASIDE_GUESS_PX = 180;
/** The column's padding and border around the readout it holds, which the measured readout does not include. */
const ASIDE_CHROME_PX = 24;
/** What the plot must keep, its axes included, once the column is taken. */
const ASIDE_PLOT_KEEPS_PX = 300;

const CHART_BODY: CSSProperties = {
  flex: 1,
  display: "flex",
  position: "relative",
  minHeight: 0,
  minWidth: 0,
};

const CHART_FRAME: CSSProperties = { flex: 1, minHeight: 0, minWidth: 0 };

const PLOT_ASIDE: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  borderLeft: "1px solid var(--color-border-subtle)",
};

const CHART_AREA: CSSProperties = {
  flex: 1,
  position: "relative",
  minHeight: 0,
  minWidth: 0,
};

/**
 * A chart that measures the region it is given: a plot with tick ladders, one
 * or two y axes, reference lines and curves, a crosshair that reads every
 * series at one x, and the notice and readout a widget lays over or beside it.
 * Useful for showing the operator how readings move over time or against one
 * another. Used by the graph widget and the flight history list. Fills its
 * parent, or takes a fixed `height`; its parent must have a height of its own
 * when `height` is absent.
 *
 * @category Graph
 */
export function Graph({
  series,
  xDomain,
  yDomainPrimary,
  yDomainSecondary,
  yScalePrimary,
  yScaleSecondary,
  xTickFormat,
  xReadFormat,
  yTickFormat,
  xUnit,
  yUnit,
  thresholds,
  referenceCurves,
  layers: ownLayers,
  xKind = "time",
  xAxisLabel,
  yAxisLabel,
  ySecondaryAxisLabel,
  "aria-label": ariaLabel,
  hideXAxis,
  spatial,
  gridScale,
  crosshair,
  notice,
  emptyState,
  footer,
  plotReadout,
  chrome = "panel",
  title,
  headerActions,
  height,
  children,
}: GraphProps) {
  const layers = ownLayers ?? EMPTY_LAYERS;
  const xIsTime = xKind === "time";

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setArea({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [asideSize, setAsideSize] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [asideEl, setAsideEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!asideEl) return;
    const ro = new ResizeObserver(() =>
      setAsideSize({
        w: asideEl.offsetWidth + ASIDE_CHROME_PX,
        h: asideEl.offsetHeight + ASIDE_CHROME_PX,
      }),
    );
    ro.observe(asideEl);
    return () => ro.disconnect();
  }, [asideEl]);

  const thresholdRules = (thresholds ?? [])
    .map(thresholdRuleOf)
    .filter((rule): rule is ThresholdRule => rule !== null);

  // Reference curves are functions of X, so a time-axis graph skips them.
  const overlaySeries: ChartSeries[] =
    !xIsTime && referenceCurves
      ? referenceCurves.map((curve) => ({
          id: `__ref_${curve.id}`,
          label: curve.label,
          axis: curve.axis ?? "primary",
          color: curve.color ?? "var(--color-text-faint)",
          type: "line" as const,
          dashed: true,
          readBetween: true,
          data: { x: curve.xs, y: curve.ys },
        }))
      : [];

  const chartSeries: ChartSeries[] = [...series, ...overlaySeries];

  const resolvedXTickFormat =
    xTickFormat ??
    (xUnit
      ? (
          v: number,
          _domain: readonly [number, number],
          ticks?: readonly number[],
        ) => unitTick(xUnit, v, ticks)
      : undefined);
  const resolvedYTickFormat =
    yTickFormat ??
    (yUnit
      ? (v: number, ticks?: readonly number[]) => unitTick(yUnit, v, ticks)
      : undefined);

  const plotIsEmpty =
    series.length === 0 && overlaySeries.length === 0 && layers.length === 0;
  const plotHasData =
    layers.length > 0 || chartSeries.some((cs) => (cs.data.x?.length ?? 0) > 0);
  const notices: ReactNode[] = [];
  if (plotIsEmpty && emptyState !== undefined) notices.push(emptyState);
  if (notice) notices.push(notice);
  // Until the first measurement an empty plot is assumed roomy, so a frame that will end up alone in its panel does not start out with a notice beside it.
  const noticePlacement = area
    ? placeGraphNotice({ width: area.w, height: area.h, plotHasData })
    : plotHasData
      ? "inline"
      : "center";

  const noticeNode = (
    <GraphNotice placement={noticePlacement}>
      {notices.map((n, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the list is rebuilt whole each render and never reordered
        <div key={i}>{n}</div>
      ))}
    </GraphNotice>
  );

  const present = ((): PresentPoint | undefined => {
    if (xIsTime) return undefined;
    const lead = series.find((s) => s.type !== "band" && s.data.x.length > 0);
    if (!lead) return undefined;
    let last = lead.data.x.length - 1;
    while (
      last >= 0 &&
      !(
        Number.isFinite(lead.data.x[last]) && Number.isFinite(lead.data.y[last])
      )
    ) {
      last -= 1;
    }
    if (last < 0) return undefined;
    const x = lead.data.x[last];
    const references: Record<string, number> = {};
    for (const curve of referenceCurves ?? []) {
      const at = readCurveAt(curve.xs, curve.ys, x);
      if (at !== undefined) references[curve.id] = at;
    }
    return { x, y: lead.data.y[last], references };
  })();
  // A readout that answers with nothing for the present state has nothing to place.
  const columnReadout =
    typeof plotReadout === "function"
      ? plotReadout({
          width: Number.POSITIVE_INFINITY,
          height: Number.POSITIVE_INFINITY,
          present,
          compact: false,
          tight: false,
        })
      : plotReadout;
  const hasReadout = columnReadout !== undefined && columnReadout !== null;
  // Beside the plot only where the plot keeps a usable width and the column fits the height; until the column has been measured it is assumed a typical width.
  const readoutBeside =
    hasReadout &&
    area !== null &&
    area.w - (asideSize?.w ?? ASIDE_GUESS_PX) >= ASIDE_PLOT_KEEPS_PX &&
    area.h >= (asideSize?.h ?? 0);

  const chartBody = (
    <div
      ref={areaRef}
      style={{
        ...CHART_BODY,
        ...(height === undefined ? {} : { flex: "0 0 auto", height }),
        flexDirection: noticePlacement === "beside" ? "row" : "column",
      }}
    >
      <FramedDisplay style={CHART_FRAME} footer={footer}>
        <div ref={containerRef} style={CHART_AREA}>
          {size && (
            <LineChart
              series={chartSeries}
              xDomain={xDomain}
              xTickFormat={resolvedXTickFormat}
              xReadFormat={xReadFormat}
              yDomainPrimary={yDomainPrimary}
              yDomainSecondary={yDomainSecondary}
              yScalePrimary={yScalePrimary}
              yScaleSecondary={yScaleSecondary}
              yTickFormat={resolvedYTickFormat}
              thresholds={thresholdRules}
              layers={layers}
              hideXAxis={hideXAxis}
              spatial={spatial}
              gridScale={gridScale}
              aria-label={ariaLabel}
              crosshair={crosshair ?? !hideXAxis}
              xKind={xKind}
              xAxisLabel={spatial ? undefined : xAxisLabel}
              yAxisLabel={spatial ? undefined : yAxisLabel}
              ySecondaryAxisLabel={spatial ? undefined : ySecondaryAxisLabel}
              card={
                hasReadout && !readoutBeside
                  ? typeof plotReadout === "function"
                    ? (room) =>
                        plotReadout({
                          width: room.width,
                          height: room.height,
                          present,
                          compact: room.form > 0,
                          tight: room.form > 1,
                        })
                    : plotReadout
                  : undefined
              }
              cardForms={typeof plotReadout === "function" ? 3 : 1}
              width={size.w}
              height={size.h}
            />
          )}
          {/* Inside the frame, so a notice laid over an empty plot leaves the frame the body's only content. */}
          {notices.length > 0 && noticePlacement === "center" && noticeNode}
        </div>
        {readoutBeside && (
          <Box pad="surface" style={PLOT_ASIDE}>
            <div ref={setAsideEl} data-plot-aside="">
              {columnReadout}
            </div>
          </Box>
        )}
        {/* Draws nothing, so it rides inside the frame and leaves it the chart's only content when there's no notice beside it. */}
        {children}
      </FramedDisplay>
      {notices.length > 0 && noticePlacement !== "center" && noticeNode}
    </div>
  );

  if (chrome === "bare") return chartBody;

  return (
    <Panel
      panelTitle={title}
      panelAside={headerActions}
      sections={<Section fill>{chartBody}</Section>}
    />
  );
}
