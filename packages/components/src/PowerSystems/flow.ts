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
