import type { MeterEntry } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { KERBALISM } from "../uplink";
import { CREW_SURVIVAL, type CrewSurvival, toneFor } from "./processor";

// ---------------------------------------------------------------------------
// Per-kerbal survival meters, as DATA.
//
// This was `CrewSurvivalAugment`, a React component bound to a
// `crew-status.survival` augment slot, and its entire render was a `Stack` of
// `Meter` and nothing else: zero pixels CrewStatus did not already own. The
// test for which mechanism a slot wants is whether the host already has chrome
// for what the extension draws, and for a stack of labelled 0..1 bars it plainly
// does.
//
// As a contribution the host gets back what an augment could never give it: it
// can count what arrived, order it, and lay it out with its own rows. And the
// rows are the point, `row` carries the kerbal's name, which is exactly what
// let a per-row extension stop being a bespoke widget slot at all.
// ---------------------------------------------------------------------------

/**
 * Wire rule names that mean the radiation dose accumulator: "radiation" is
 * Kerbalism's stock default-profile name, "dose" shows up under some other
 * profiles. Both read as a bare word on their own ("Radiation", "Dose") that
 * doesn't say what is being measured; naming the quantity ("Radiation dose")
 * reads clearly regardless of which name the loaded profile uses.
 */
const RADIATION_DOSE_RULE_NAMES = new Set(["radiation", "dose"]);

/** Title-cases a wire rule name for display, with the radiation dose rule
 *  mapped to a clearer label (see `RADIATION_DOSE_RULE_NAMES`). */
export function ruleLabel(name: string): string {
  if (RADIATION_DOSE_RULE_NAMES.has(name.toLowerCase())) {
    return "Radiation dose";
  }
  return name.length > 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

/** A string because it feeds `valueLabel`, which is also the spoken `aria-valuetext`. */
const pct = (v: number): string =>
  writeQuantity(value("%", v * 100), { decimals: 0 });

/**
 * EVERY rule Kerbalism reports for each kerbal, not only the worst one, so a
 * radiation dose sitting at 40% never hides behind a stress rule the operator
 * happened to be watching. Each meter is generic telemetry: a 0..1-toward-fatal
 * magnitude, nothing more.
 *
 * A kerbal with no rule reported contributes nothing, so a vessel with no
 * Kerbalism data leaves every row exactly as CrewStatus renders it alone.
 *
 * Pure, and exported, so a test can call it against a plain `CrewSurvival`
 * fixture without going through the contribution registry (the same shape
 * `survivalBadges` uses in `badge.ts`).
 */
export function survivalMeters(
  survival: CrewSurvival | undefined,
): MeterEntry[] | null {
  if (!survival) return null;
  const entries: MeterEntry[] = [];
  for (const kerbal of survival.kerbals) {
    for (const rule of kerbal.rules) {
      entries.push({
        // Namespaced by kerbal: two kerbals both have a "stress" rule, and a
        // meter stack keyed on the rule name alone would collide across rows.
        id: `${kerbal.name}:${rule.name}`,
        label: ruleLabel(rule.name),
        value: rule.fraction,
        tone: toneFor(rule.fraction),
        valueLabel: pct(rule.fraction),
        // The roster row this meter belongs beside. CrewStatus mounts one
        // `<WidgetMeters row={name}>` per kerbal, so each entry lands under the
        // kerbal it is about.
        row: kerbal.name,
      });
    }
  }
  return entries.length > 0 ? entries : null;
}

KERBALISM.registerContribution({
  id: "crew-survival-meters",
  contributes: "crew-status.meters",
  deps: [CREW_SURVIVAL],
  requires: "kerbalism",
  compute: (topics) => survivalMeters(topics[CREW_SURVIVAL.id]),
});
