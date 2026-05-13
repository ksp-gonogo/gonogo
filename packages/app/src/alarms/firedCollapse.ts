import type { Alarm } from "./types";

/**
 * Collapse 2+ fired contract-parameter alarms into a single banner row.
 * Contract-parameter fires are informational ("the objective completed")
 * rather than actionable, so a long stack of them in the alarm banner
 * just becomes noise. A single "N completed — Ack all" entry covers the
 * same ground without flooding the operator's view.
 */
export interface CollapsedContractParamFires {
  count: number;
  ids: string[];
}

export function collapseFiredContractParam(
  firedAlarms: readonly Alarm[],
): CollapsedContractParamFires | null {
  const cp = firedAlarms.filter((a) => a.trigger.kind === "contract-parameter");
  if (cp.length < 2) return null;
  return { count: cp.length, ids: cp.map((a) => a.id) };
}
