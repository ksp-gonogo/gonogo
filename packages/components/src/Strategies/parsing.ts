import { asQuantityish, magnitudeOf, magnitudeOr } from "../shared/magnitude";
import type { Strategy } from "./types";

function resolveDepartmentName(e: Record<string, unknown>): string {
  if (typeof e.departmentName === "string") return e.departmentName;
  if (typeof e.department === "string") return e.department;
  return "";
}

// A career model that sends no source only ever answered from inside the building, so its verdicts are screened.
function resolveActivateVerdictSource(
  e: Record<string, unknown>,
): Strategy["activateVerdictSource"] {
  if (e.activateVerdictSource === "derived") return "derived";
  if (e.activateVerdictSource === "none") return "none";
  return "screened";
}

/**
 * Parses the strategy list, accepting `department` or `departmentName`. An
 * absent `effectiveCostReputation` falls back to `initialCostReputation`.
 */
export function parseStrategies(raw: unknown): Strategy[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: Strategy[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : null;
    if (!id) continue;
    out.push({
      id,
      title: typeof e.title === "string" ? e.title : id,
      description: typeof e.description === "string" ? e.description : "",
      departmentName: resolveDepartmentName(e),
      isActive: e.isActive === true,
      factor: magnitudeOr(asQuantityish(e.factor), 0),
      dateActivated: magnitudeOr(asQuantityish(e.dateActivated), 0),
      requiredReputation: magnitudeOr(asQuantityish(e.requiredReputation), 0),
      initialCostFunds: magnitudeOr(asQuantityish(e.initialCostFunds), 0),
      initialCostScience: magnitudeOr(asQuantityish(e.initialCostScience), 0),
      initialCostReputation: magnitudeOr(
        asQuantityish(e.initialCostReputation),
        0,
      ),
      effectiveCostReputation:
        magnitudeOf(asQuantityish(e.effectiveCostReputation)) ??
        magnitudeOr(asQuantityish(e.initialCostReputation), 0),
      hasFactorSlider: e.hasFactorSlider === true,
      factorSliderDefault: magnitudeOr(asQuantityish(e.factorSliderDefault), 0),
      factorSliderSteps: magnitudeOr(asQuantityish(e.factorSliderSteps), 1),
      // Only a real boolean is an answer; absent and null both mean the question went unasked.
      canActivate: typeof e.canActivate === "boolean" ? e.canActivate : null,
      activateBlockedReason:
        typeof e.activateBlockedReason === "string"
          ? e.activateBlockedReason
          : "",
      activateVerdictSource: resolveActivateVerdictSource(e),
      canDeactivate: e.canDeactivate === true,
      deactivateBlockedReason:
        typeof e.deactivateBlockedReason === "string"
          ? e.deactivateBlockedReason
          : "",
      effect: typeof e.effect === "string" ? e.effect : "",
    });
  }
  return out;
}

/**
 * Strips KSP's rich-text markup from strategy effect text and returns the
 * bullet lines under "Effects:", dropping the "Setup Cost:" block that
 * duplicates the explicit cost fields.
 */
export function parseEffectLines(raw: string): string[] {
  const stripped = raw
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .trim();
  const lines: string[] = [];
  for (const line of stripped.split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (/^effects?:/i.test(t)) continue;
    if (/^setup cost:?/i.test(t)) break;
    if (t.startsWith("*")) {
      lines.push(t.slice(1).trim());
    } else {
      lines.push(t);
    }
  }
  return lines;
}
