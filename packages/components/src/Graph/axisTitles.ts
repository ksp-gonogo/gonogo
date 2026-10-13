import type { DataKeyMeta } from "@ksp-gonogo/data";
import { seriesKeyOf } from "@ksp-gonogo/sitrep-sdk";
import { axisTitle } from "@ksp-gonogo/ui";
import type { GraphSeries } from "./types";

export { axisTitle };

/**
 * The title of one y axis: the caller's own name where it gave one, else, with
 * `derive`, the names of the series drawn on it (one name, or two joined; more
 * than two name nothing). The unit is the caller's, else the one every series
 * on the axis shares.
 */
export function yAxisTitle({
  axis,
  series,
  axes,
  metaMap,
  name,
  unit,
  derive,
}: {
  axis: "primary" | "secondary";
  series: readonly GraphSeries[];
  axes: ReadonlyArray<"primary" | "secondary">;
  metaMap: Map<string, DataKeyMeta>;
  name: string | undefined;
  unit: string | undefined;
  derive: boolean;
}): string | undefined {
  const onAxis = series.filter((_, i) => axes[i] === axis);
  const names = [
    ...new Set(
      onAxis.map(
        (cfg) =>
          cfg.label ??
          metaMap.get(seriesKeyOf(cfg.source))?.label ??
          seriesKeyOf(cfg.source),
      ),
    ),
  ];
  const units = [
    ...new Set(
      onAxis
        .map((cfg) => metaMap.get(seriesKeyOf(cfg.source))?.unit)
        .filter((u): u is string => u !== undefined && u !== "raw"),
    ),
  ];
  return axisTitle(
    name ??
      (derive && names.length > 0 && names.length <= 2
        ? names.join(" / ")
        : undefined),
    unit ?? (units.length === 1 ? units[0] : undefined),
  );
}
