import type { DataKeyMeta } from "@ksp-gonogo/data";
import type { CSSProperties, ReactNode } from "react";
import type { GraphSeriesConfig } from "./types";

/** The header names the plotted units, not the series, because units dedupe where names do not; with no known unit it stays "GRAPH". */
export function computeUnitsLabel(
  series: readonly GraphSeriesConfig[],
  metaMap: Map<string, DataKeyMeta>,
  axes: Array<"primary" | "secondary">,
  xIsTime: boolean,
  xMeta: DataKeyMeta | null,
  xKey: string,
): string {
  const byAxis: Record<"primary" | "secondary", string[]> = {
    primary: [],
    secondary: [],
  };
  series.forEach((cfg, i) => {
    const unit = metaMap.get(cfg.key)?.unit;
    if (!unit) return;
    const bucket = byAxis[axes[i]];
    if (!bucket.includes(unit)) bucket.push(unit);
  });
  const sides = [byAxis.primary, byAxis.secondary]
    .filter((u) => u.length > 0)
    .map((u) => u.join(" & "));
  if (sides.length === 0) return "";
  const against = xIsTime ? "" : `${xMeta?.unit ?? xMeta?.label ?? xKey} x `;
  return `${against}${sides.join(" x ")}`;
}

/** The series names, as the header's tooltip. */
export function computeFullTitle(
  series: readonly GraphSeriesConfig[],
  metaMap: Map<string, DataKeyMeta>,
): string | undefined {
  return (
    series
      .map((cfg) => cfg.label ?? metaMap.get(cfg.key)?.label ?? cfg.key)
      .join(", ") || undefined
  );
}

export function resolvePanelTitle(
  title: string | undefined,
  units: string,
  fullTitle: string | undefined,
): ReactNode {
  if (title !== undefined) return title;
  if (!units) return "GRAPH";
  return (
    <>
      GRAPH{" "}
      <span title={fullTitle} style={GRAPH_UNITS}>
        {units}
      </span>
    </>
  );
}

// Unit symbols are case-sensitive, so they opt out of the header's uppercase.
const GRAPH_UNITS: CSSProperties = { textTransform: "none" };
