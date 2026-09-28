import type { CelestialBody } from "@ksp-gonogo/sitrep-client";
import { kspCalendar, kspYearDays, type Severity } from "@ksp-gonogo/ui-kit";
import type { ReachVerdict } from "./transferData";

export const VERDICT_LABEL: Record<ReachVerdict, string> = {
  go: "GO",
  "one-way": "ONE WAY",
  marginal: "MARGINAL",
  no: "NO",
};

// `one-way` is a WARNING, not a failure: a flyby or an impactor is a real mission. `marginal` is the coplanar model declining to commit.
export const VERDICT_SEVERITY: Record<ReachVerdict, Severity | undefined> = {
  go: "go",
  "one-way": "warn",
  marginal: "warn",
  no: "nogo",
};

export const STATUS_LABEL: Record<string, string> = {
  go: "IDEAL",
  soon: "NEAR",
  off: "FAR",
};

// Being far from a window is "not yet", not an alarm, so FAR carries no severity.
export const STATUS_SEVERITY: Record<string, Severity | undefined> = {
  go: "go",
  soon: "warn",
  off: undefined,
};

// Days and years are Kerbin's, the calendar the game's own map view uses.
export const fmtDays = (sec: number): string =>
  `${Math.round(sec / kspCalendar().day)} d`;

export const fmtCountdown = (sec: number): string => {
  const d = sec / kspCalendar().day;
  if (d < 1) return "now";
  if (d < 1000) return `in ${Math.round(d)} d`;
  return `in ${(d / kspYearDays()).toFixed(1)} y`;
};

/** The catalogue's own name when the save sent one, its index otherwise, never a fabricated name. */
export function bodyLabel(body: CelestialBody): string {
  return body.name ?? `Body ${body.index}`;
}
