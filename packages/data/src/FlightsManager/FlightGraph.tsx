import { getDataSource } from "@ksp-gonogo/core";
import type { ChartSeries, KeyOption } from "@ksp-gonogo/ui";
import { axisTitle, DataKeyMultiPicker, LineChart } from "@ksp-gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { plotValue } from "../hooks/useDataSeries";
import { useNumericFields } from "../hooks/useTopicFields";
import type { SeriesRange } from "../types";
import type { MissionHistorySource } from "./MissionHistorySource";

/**
 * Post-flight graph view: pick telemetry keys, pull their samples for one
 * recorded Mission via `queryRange` (replayed through
 * `buildFullHistoryStore`, see `MissionHistorySource`), render a
 * `LineChart`. Lives alongside the flight list so users can inspect any
 * recorded flight without needing the live dashboard.
 *
 * Unit note: Missions are UT-**seconds**-based (`fromUt`/
 * `toUt`), but `LineChart`'s default `xTickFormat`
 * (`timeXTickFormat`/`formatTimeLabel`) hard-assumes **milliseconds**: see
 * `packages/ui-kit/src/graph/lineChartMath.ts`. So `xDomain` and every series' x-values
 * here are **elapsed milliseconds since `fromUt`**, converted once at
 * the query-response boundary (`(validAtUt - fromUt) * 1000`), the
 * same anchor and unit `ChaptersEditor`'s `startMs`/`endMs` already use, so
 * a chapter's elapsed time and a graph's x-axis always agree.
 */

const PALETTE = [
  "var(--color-accent-fg)",
  "var(--color-info-mark)",
  "var(--color-warn-mark)",
  "var(--color-tag-purple-fg)",
  "var(--color-nogo-mark)",
  "var(--color-info-mark)",
  "var(--color-warn-mark)",
  "var(--color-accent-fg)",
];

function getSource(): MissionHistorySource | undefined {
  return getDataSource("missionHistory") as MissionHistorySource | undefined;
}

export interface FlightGraphProps {
  missionId: string;
  /** The earliest UT, in seconds, a sample of the recording is valid at: where the chart's elapsed time starts. */
  fromUt: number;
  /** The latest UT, in seconds, a sample of the recording is valid at. */
  toUt: number;
}

export function FlightGraph({ missionId, fromUt, toUt }: FlightGraphProps) {
  const numericFields = useNumericFields();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [series, setSeries] = useState<ChartSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drop this mission's cached full-history TimelineStore (built by
  // buildFullHistoryStore, unbounded retention) once the graph panel that
  // requested it collapses or unmounts. historyCache lives on the single
  // module-level MissionHistorySource shared by the main screen AND every
  // station's query-range-request: without this, it grows unboundedly:
  // a full unbounded-retention TimelineStore per distinct mission ever
  // graphed by anyone, for the host tab's lifetime. Keyed on missionId (not
  // just "on unmount") so it's still correct if this component is ever
  // reused across missions instead of remounted per row.
  useEffect(() => {
    return () => {
      getSource()?.evictFullHistoryStore(missionId);
    };
  }, [missionId]);

  // Measure the container so the SVG chart picks a width without requiring the caller to hardcode one.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(Math.floor(w));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Only a number can be plotted: the same fields a live graph axis offers.
  const options: KeyOption[] = useMemo(
    () =>
      numericFields.map((k) => ({
        key: k.key,
        label: k.label ?? k.key,
        unit: k.unit,
        group: keyGroup(k.key),
      })),
    [numericFields],
  );

  // Re-fetch whenever the selection or the mission changes. Each key is a
  // separate full-history-store range query (memoized per missionId by
  // MissionHistorySource: the fixture only replays once); running them in
  // parallel is fine.
  useEffect(() => {
    const source = getSource();
    if (!source || selected.size === 0) {
      setSeries([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const keys = [...selected];
    Promise.all(
      keys.map((key) => source.queryRange(key, fromUt, toUt, missionId)),
    )
      .then((ranges) => {
        if (cancelled) return;
        const meta = new Map(numericFields.map((s) => [s.key, s]));
        const next: ChartSeries[] = keys.map((key, i) => {
          const data = plottedPoints(ranges[i], fromUt);
          const m = meta.get(key);
          return {
            id: key,
            label: m?.label ?? key,
            axis: "primary",
            color: PALETTE[i % PALETTE.length],
            type: "line",
            data,
          };
        });
        setSeries(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected, missionId, fromUt, toUt, numericFields]);

  // LineChart wants a non-empty x-domain, in elapsed ms since fromUt
  // (0-based: see the unit note above). Fall back to a 1-minute placeholder
  // window if the mission has zero duration so we never divide by zero.
  const durationMs = Math.max(0, (toUt - fromUt) * 1000);
  const xDomain: [number, number] =
    durationMs > 0 ? [0, durationMs] : [0, 60_000];

  const anyData = series.some((s) => s.data.x.length > 0);

  // One name per distinct series label, up to two, and the unit only where every plotted key shares it.
  const selectedMeta = [...selected].map((key) =>
    numericFields.find((field) => field.key === key),
  );
  const names = [
    ...new Set(selectedMeta.map((meta, i) => meta?.label ?? [...selected][i])),
  ];
  const units = [...new Set(selectedMeta.map((meta) => meta?.unit))];
  const yAxisLabel = axisTitle(
    names.length > 0 && names.length <= 2 ? names.join(" / ") : undefined,
    units.length === 1 ? units[0] : undefined,
  );

  return (
    <Wrap>
      <Toolbar>
        <PickerLabel>Series</PickerLabel>
        <DataKeyMultiPicker
          keys={options}
          value={selected}
          onChange={setSelected}
          placeholder="Add a data key..."
          emptyHint={
            options.length === 0
              ? "No numeric keys in the current schema"
              : "No matches"
          }
        />
      </Toolbar>

      {error && (
        <ErrorLine role="alert">Failed to load samples: {error}</ErrorLine>
      )}

      {selected.size === 0 ? (
        <Placeholder>
          Pick one or more numeric telemetry keys above to plot them.
        </Placeholder>
      ) : (
        <ChartWrap ref={wrapRef}>
          {loading && <LoadingBadge>Loading...</LoadingBadge>}
          {!loading && !anyData && (
            <Placeholder>
              No recorded samples for the selected keys.
            </Placeholder>
          )}
          {anyData && (
            <LineChart
              series={series}
              xDomain={xDomain}
              xAxisLabel="Mission time"
              yAxisLabel={yAxisLabel}
              width={width}
              height={260}
            />
          )}
        </ChartWrap>
      )}
    </Wrap>
  );
}

/**
 * One recorded range as the points a line chart draws: x in elapsed
 * milliseconds since `fromUt`, y the magnitude of each sample. A range
 * holds decoded samples, so a quantity arrives as a value with its unit. A
 * sample with no finite number is left out, since it would wreck the chart's
 * autoscale.
 */
export function plottedPoints(
  range: SeriesRange,
  fromUt: number,
): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (let j = 0; j < range.t.length; j++) {
    const v = plotValue(range.v[j]);
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    x.push((range.t[j] - fromUt) * 1000);
    y.push(v);
  }
  return { x, y };
}

/**
 * Group data keys by their flat-key prefix for the picker's group
 * headers. Anything unknown lands under "Other". The picker's own group
 * sort takes over after this.
 */
function keyGroup(key: string): string {
  const prefix = key.split(".")[0];
  switch (prefix) {
    case "v":
      return "Vessel";
    case "o":
      return "Orbit";
    case "t":
      return "Time";
    case "r":
      return "Resources";
    case "dv":
      return "ΔV";
    case "n":
      return "Navigation";
    case "f":
      return "Flight controls";
    case "tar":
      return "Target";
    case "dock":
      return "Docking";
    case "comm":
      return "CommNet";
    case "therm":
      return "Thermal";
    case "land":
      return "Landing";
    case "b":
      return "Bodies";
    case "s":
      return "Sensors";
    case "a":
      return "API / meta";
    default:
      return "Other";
  }
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  background: var(--color-surface-panel);
  border-top: 1px solid var(--color-surface-raised);
`;

const Toolbar = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const PickerLabel = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const ChartWrap = styled.div`
  position: relative;
  min-height: 260px;
`;

const Placeholder = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  padding: var(--inset-chart-empty);
  text-align: center;
`;

const LoadingBadge = styled.div`
  position: absolute;
  top: var(--offset-corner);
  right: var(--offset-corner);
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  background: rgba(0, 0, 0, 0.6);
  padding: var(--inset-chip);
  border-radius: var(--radius-regular);
  /* Local sibling ordering inside ChartWrap only: this badge just has to sit
     over the chart canvas beside it. The absolute number is meaningless
     outside that context, so it stays off the app-global z ladder. */
  z-index: 2;
`;

const ErrorLine = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-nogo-text);
  background: var(--color-tag-dark-brown-bg);
  border: 1px solid var(--color-nogo-muted);
  padding: var(--inset-surface);
  border-radius: var(--radius-regular);
`;
