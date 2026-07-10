import { getDataSource } from "@ksp-gonogo/core";
import type { ChartSeries, KeyOption } from "@ksp-gonogo/ui";
import { DataKeyMultiPicker, LineChart } from "@ksp-gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import type { BufferedDataSource } from "../BufferedDataSource";
import { useDataSchema } from "../hooks/useDataSchema";

/**
 * Post-flight graph view — pick telemetry keys, pull their samples from
 * IndexedDB via `queryRange`, render a `LineChart`. Lives alongside the
 * flight list so users can inspect any recorded flight without needing
 * the live dashboard.
 */

const PALETTE = [
  "var(--color-accent-fg)",
  "var(--color-status-info-fg)",
  "var(--color-status-warning-bg)",
  "var(--color-tag-purple-fg)",
  "var(--color-status-nogo-bg)",
  "var(--color-status-info-fg)",
  "var(--color-status-warning-bg)",
  "var(--color-accent-fg)",
];

function getSource(): BufferedDataSource | undefined {
  return getDataSource("data") as BufferedDataSource | undefined;
}

export interface FlightGraphProps {
  flightId: string;
  /** Flight bounds in unix ms. Becomes the chart's x-domain. */
  launchedAt: number;
  lastSampleAt: number;
}

export function FlightGraph({
  flightId,
  launchedAt,
  lastSampleAt,
}: FlightGraphProps) {
  const schema = useDataSchema("data");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [series, setSeries] = useState<ChartSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Measure the container so the SVG chart picks a width without requiring
  // the caller to hardcode one — `useDataSchema` already re-renders on
  // schema change so we'd need to re-measure anyway.
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

  // Only numeric keys are chartable. The meta tags strings as `enum`,
  // complex objects as `raw`, and booleans as `bool` — filter those out so
  // the picker stays focused.
  const options: KeyOption[] = useMemo(() => {
    return schema
      .filter(
        (k) =>
          k.unit !== undefined &&
          k.unit !== "bool" &&
          k.unit !== "enum" &&
          k.unit !== "raw",
      )
      .map((k) => ({
        key: k.key,
        label: k.label ?? k.key,
        unit: k.unit,
        group: keyGroup(k.key),
      }));
  }, [schema]);

  // Re-fetch whenever the selection or the flight changes. Each key is a
  // separate IndexedDB range query; running them in parallel is fine — the
  // store serialises inside a single transaction but the JS-side promise
  // fan-in is cheap.
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
      keys.map((key) =>
        source.queryRange(key, launchedAt, lastSampleAt, flightId),
      ),
    )
      .then((ranges) => {
        if (cancelled) return;
        const meta = new Map(schema.map((s) => [s.key, s]));
        // Build a series per key. Non-finite values are dropped rather than
        // letting them wreck the LineChart's autoscale.
        const next: ChartSeries[] = keys.map((key, i) => {
          const raw = ranges[i];
          const xs: number[] = [];
          const ys: number[] = [];
          for (let j = 0; j < raw.t.length; j++) {
            const v = raw.v[j];
            if (typeof v === "number" && Number.isFinite(v)) {
              xs.push(raw.t[j]);
              ys.push(v);
            }
          }
          const m = meta.get(key);
          return {
            id: key,
            label: m?.label ?? key,
            axis: "primary",
            color: PALETTE[i % PALETTE.length],
            type: "line",
            data: { x: xs, y: ys },
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
  }, [selected, flightId, launchedAt, lastSampleAt, schema]);

  // LineChart wants a non-empty x-domain. Fall back to a 1-minute placeholder
  // window if the flight has zero duration so we never divide by zero.
  const xDomain: [number, number] =
    lastSampleAt > launchedAt
      ? [launchedAt, lastSampleAt]
      : [launchedAt, launchedAt + 60_000];

  const anyData = series.some((s) => s.data.x.length > 0);

  return (
    <Wrap>
      <Toolbar>
        <PickerLabel>Series</PickerLabel>
        <DataKeyMultiPicker
          keys={options}
          value={selected}
          onChange={setSelected}
          placeholder="Add a data key…"
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
          {loading && <LoadingBadge>Loading…</LoadingBadge>}
          {!loading && !anyData && (
            <Placeholder>
              No recorded samples for the selected keys.
            </Placeholder>
          )}
          {anyData && (
            <LineChart
              series={series}
              xDomain={xDomain}
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
 * Group data keys by their Telemachus prefix for the picker's group
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
  gap: 8px;
  padding: 10px 12px;
  background: var(--color-surface-panel);
  border-top: 1px solid var(--color-surface-raised);
`;

const Toolbar = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const PickerLabel = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const ChartWrap = styled.div`
  position: relative;
  min-height: 260px;
`;

const Placeholder = styled.div`
  font-size: var(--font-size-sm);
  color: var(--color-text-faint);
  padding: 24px 0;
  text-align: center;
`;

const LoadingBadge = styled.div`
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  background: rgba(0, 0, 0, 0.6);
  padding: 2px 8px;
  border-radius: 2px;
  z-index: 2;
`;

const ErrorLine = styled.div`
  font-size: var(--font-size-sm);
  color: var(--color-status-nogo-fg);
  background: var(--color-tag-dark-brown-bg);
  border: 1px solid var(--color-status-alert-muted);
  padding: 4px 8px;
  border-radius: 2px;
`;
