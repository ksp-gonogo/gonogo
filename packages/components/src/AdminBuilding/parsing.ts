import { asQuantityish, magnitudeOf } from "../shared/magnitude";
import type { Strategy } from "./types";

// A career model that sends no source only ever answered from inside the building, so its verdicts are screened.
function resolveActivateVerdictSource(
  e: Record<string, unknown>,
): Strategy["activateVerdictSource"] {
  if (e.activateVerdictSource === "derived") return "derived";
  if (e.activateVerdictSource === "none") return "none";
  return "screened";
}

/** Parses the strategy list; the wire's `department` becomes `departmentName`. */
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
      departmentName: typeof e.department === "string" ? e.department : "",
      isActive: e.isActive === true,
      factor: magnitudeOf(asQuantityish(e.factor)),
      dateActivated: magnitudeOf(asQuantityish(e.dateActivated)),
      requiredReputation: magnitudeOf(asQuantityish(e.requiredReputation)),
      initialCostFunds: magnitudeOf(asQuantityish(e.initialCostFunds)),
      initialCostScience: magnitudeOf(asQuantityish(e.initialCostScience)),
      initialCostReputation: magnitudeOf(
        asQuantityish(e.initialCostReputation),
      ),
      hasFactorSlider: e.hasFactorSlider === true,
      factorSliderDefault: magnitudeOf(asQuantityish(e.factorSliderDefault)),
      factorSliderSteps: magnitudeOf(asQuantityish(e.factorSliderSteps)),
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

/**
 * The commitment slider's lower bound and step size, or null when the record
 * carries either one: a slider cannot be drawn from a guessed range.
 */
export function factorSliderOf(
  s: Strategy,
): { min: number; step: number } | null {
  if (!s.hasFactorSlider) return null;
  if (s.factorSliderDefault === null || s.factorSliderSteps === null)
    return null;
  return {
    min: s.factorSliderDefault,
    step: (1 - s.factorSliderDefault) / Math.max(s.factorSliderSteps, 1),
  };
}

/**
 * The factor an activation sends, or null when the strategy has a slider whose
 * position is unknown and so no commitment can be named. A strategy without a
 * slider ignores the figure.
 */
export function activationFactor(
  s: Strategy,
  factor: number | null,
): number | null {
  if (factor !== null) return factor;
  return s.hasFactorSlider ? null : 0;
}
