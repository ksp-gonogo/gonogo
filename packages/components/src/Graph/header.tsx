import type { DataKeyMeta } from "@ksp-gonogo/data";
import { seriesKeyOf } from "@ksp-gonogo/sitrep-sdk";
import { Tooltip } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type { GraphSeries } from "./types";

/** The plotted units, as the header's tooltip: the y units per side, led by the x quantity when x is not time. */
export function computeUnitsLabel(
  series: readonly GraphSeries[],
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
    const unit = metaMap.get(seriesKeyOf(cfg.source))?.unit;
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

/** The header of an unconfigured graph: the names of the series it plots, each once. A series with no label of its own or in the catalog is left out, rather than named by its raw key. */
export function computeFullTitle(
  series: readonly GraphSeries[],
  metaMap: Map<string, DataKeyMeta>,
): string | undefined {
  const names = new Set<string>();
  for (const cfg of series) {
    const label = cfg.label ?? metaMap.get(seriesKeyOf(cfg.source))?.label;
    if (label) names.add(label);
  }
  return [...names].join(" / ") || undefined;
}

export function resolvePanelTitle(
  title: string | undefined,
  units: string,
  fullTitle: string | undefined,
): ReactNode {
  if (title !== undefined) return title;
  if (!fullTitle) return "GRAPH";
  return (
    <>
      GRAPH{" "}
      <Tooltip text={units || undefined} focusable>
        <span>{fullTitle}</span>
      </Tooltip>
    </>
  );
}
