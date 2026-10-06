import type { DataKeyMeta, TopicFieldHandle } from "@ksp-gonogo/data";
import {
  seriesKeyOf,
  splitRawFieldSubtopic,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { resolveAxes } from "./axes";
import type { GraphConfig, GraphThreshold, GraphViewConfig } from "./types";
import { TIME_AXIS } from "./types";

/** The field a saved flat key names: split at the Topic it sits under, or the whole key for a Topic that is itself the quantity. */
export function handleOfKey(key: string): TopicFieldHandle {
  const split = splitRawFieldSubtopic(key);
  if (split === undefined) return { topic: key };
  return { topic: split.rawTopic, field: split.fieldPath.join(".") };
}

/** The Graph widget's saved configuration as the `GraphView` it asks for. */
export function graphViewConfigOf(
  saved: GraphConfig | undefined,
): GraphViewConfig | undefined {
  if (saved === undefined) return undefined;
  const { series, xKey, thresholds: _thresholds, ...frame } = saved;
  return {
    ...frame,
    series: (series ?? []).map(({ key, keyHigh, ...rest }) => ({
      ...rest,
      source: handleOfKey(key),
      high: keyHigh ? handleOfKey(keyHigh) : undefined,
    })),
    x: xKey === undefined || xKey === TIME_AXIS ? undefined : handleOfKey(xKey),
  };
}

/**
 * The saved threshold lines as quantities. A saved line is a bare number, so
 * it takes the unit of the first series drawn against its axis, which is the
 * unit that axis is in; an axis with no known unit takes a plain number.
 */
export function graphThresholdsOf(
  saved: GraphConfig | undefined,
  catalog: readonly DataKeyMeta[],
): GraphThreshold[] {
  const lines = saved?.thresholds ?? [];
  if (lines.length === 0) return [];
  const view = graphViewConfigOf(saved)?.series ?? [];
  const metaMap = new Map(catalog.map((k) => [k.key, k]));
  const axes = resolveAxes(view, metaMap);
  return lines.map((line) => {
    const onAxis = view.findIndex((_, i) => axes[i] === line.axis);
    const unit =
      (onAxis >= 0 && metaMap.get(seriesKeyOf(view[onAxis].source))?.unit) ||
      "1";
    return {
      id: line.id,
      value: value(unit, line.value),
      ...(line.kind === "target"
        ? { kind: "target" as const }
        : { kind: "limit" as const, bad: line.bad ?? "above" }),
      label: line.label || undefined,
      axis: line.axis,
    };
  });
}
