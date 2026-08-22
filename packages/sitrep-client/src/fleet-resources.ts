import { useMemo } from "react";
import { useStream } from "./use-stream";

/**
 * One resource aboard a fleet vessel, as `fleet.<guid>.resources` delivers it.
 *
 * Amounts only. There is deliberately no rate and no exhaustion time: a
 * consumption rate for an unloaded craft is background simulation, which is a
 * life-support Uplink's business and not core's, and a core-published "runs out
 * at UT X" would be core claiming a model it does not have. Whatever models the
 * draw contributes the exhaustion time on top of these amounts.
 */
export interface FleetVesselResource {
  name: string;
  current: number;
  max: number;
  /**
   * Whether the producer actually read this resource on the tick it published.
   * It exists so a present-but-empty tank stays distinguishable from one that
   * stopped being reported, the same guarantee `vessel.resources` makes.
   */
  active: boolean;
}

/** The raw wire shape: a map keyed by resource name, values unit-wrapped or bare. */
type WireAmount = {
  current?: { magnitude: number } | number | null;
  max?: { magnitude: number } | number | null;
  active?: boolean;
};

function magnitude(
  v: { magnitude: number } | number | null | undefined,
): number | null {
  const n = typeof v === "object" && v !== null ? v.magnitude : v;
  return n == null || !Number.isFinite(n) ? null : n;
}

/**
 * The wire map as a sorted list, which is what a renderer wants. Sorted by name
 * so a re-emission cannot reorder the rows under the operator's eyes; the wire
 * map's own key order is not a promise.
 *
 * A row whose amounts cannot be read is dropped rather than shown as zero: an
 * unreadable tank and an empty one are different, and only one of them is worth
 * acting on.
 */
export function fleetVesselResourceList(
  payload: { resources?: Record<string, WireAmount> | null } | undefined,
): readonly FleetVesselResource[] {
  const rows: FleetVesselResource[] = [];
  for (const [name, amount] of Object.entries(payload?.resources ?? {})) {
    const current = magnitude(amount?.current);
    const max = magnitude(amount?.max);
    if (current == null || max == null) continue;
    rows.push({ name, current, max, active: amount?.active !== false });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What is in fleet vessel `guid`'s tanks, or undefined until the topic
 * delivers. An empty array is a craft carrying nothing, which is a different
 * statement and stays distinguishable.
 */
export function useFleetVesselResources(
  guid: string,
): readonly FleetVesselResource[] | undefined {
  const raw = useStream<{ resources?: Record<string, WireAmount> | null }>(
    `fleet.${guid}.resources`,
  );
  return useMemo(() => (raw ? fleetVesselResourceList(raw) : undefined), [raw]);
}
