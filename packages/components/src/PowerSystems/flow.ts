import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

export interface Contribution {
  flightId: number;
  partTitle: string;
  /** Zero when nothing was reported; read `flowKnown` before believing it. */
  flow: number;
  /** Whether `flow` is a measurement: a part can be listed on its `nominalFlow` alone, and an unmeasured panel is not a panel in shadow. */
  flowKnown: boolean;
  nominalFlow?: number;
}

export type NetTone = "go" | "warn" | "neutral";

/** Surplus, deficit, or balanced within a micro-unit per second. */
export function netToneOf(net: number): NetTone {
  if (net > 1e-6) return "go";
  if (net < -1e-6) return "warn";
  return "neutral";
}

/** The tone of NET, a surplus withheld while a process with no published rate runs, since its draw is missing from the figure. */
export function netToneWithUnrated(net: number, unratedCount: number): NetTone {
  return unratedCount > 0 && net > 0 ? "neutral" : netToneOf(net);
}

/** Spaces a camelCase resource id so its word breaks survive the uppercase transform. */
export function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function formatUnits(v: number): string {
  if (!Number.isFinite(v)) return NULL_DISPLAY;
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(1);
}

/**
 * How many parts run a process that draws or yields `resource` with no published rate (a converter, a drill, a fuel cell), which each row says through `unratedProcess`. A part with a rate is counted by its rate instead, and a part that only stores is never counted.
 */
export function countUnratedProcesses(
  parts: ReadonlyArray<{ flightId: number }>,
  liveByFlightId: ReadonlyMap<
    number,
    {
      resources?: Record<
        string,
        { flow?: number; nominalFlow?: number } | undefined
      >;
    }
  >,
  resource: string,
): number {
  let count = 0;
  for (const part of parts) {
    const row = liveByFlightId.get(part.flightId)?.resources?.[resource];
    if (!row || !("unratedProcess" in row) || row.unratedProcess !== true) {
      continue;
    }
    const rated =
      (typeof row.flow === "number" && row.flow !== 0) ||
      (typeof row.nominalFlow === "number" && row.nominalFlow !== 0);
    if (!rated) count += 1;
  }
  return count;
}
