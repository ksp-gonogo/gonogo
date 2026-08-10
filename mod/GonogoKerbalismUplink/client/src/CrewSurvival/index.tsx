import type { SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useProcessor, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  formatDuration,
  Meter,
  type MeterTone,
  Stack,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { KERBALISM } from "../uplink";
import {
  CREW_SURVIVAL,
  type CrewSurvival,
  type KerbalRuleState,
  type KerbalSurvival,
  toneFor,
} from "./processor";

/**
 * Shared lookup: matched by `crewIndex` first (the row order CrewStatus
 * renders IS `vessel.crew.crew`'s own order, and so is `CREW_SURVIVAL.kerbals`,
 * both built from the same array), falling back to a name search only if that
 * position's name has drifted (e.g. a future base-widget change that
 * filters/reorders the roster).
 */
function findKerbal(
  survival: CrewSurvival,
  crewName: string,
  crewIndex: number,
): KerbalSurvival | undefined {
  const byIndex = survival.kerbals[crewIndex];
  return byIndex?.name === crewName
    ? byIndex
    : survival.kerbals.find((k) => k.name === crewName);
}

// A string because it feeds `valueLabel` props, not JSX children.
const pct = (v: number): string =>
  writeQuantity(value("%", v * 100), { decimals: 0 });

/**
 * Wire rule names that mean the radiation dose accumulator: "radiation" is
 * Kerbalism's stock default-profile name, "dose" shows up under some other
 * profiles. Both read as a bare word on their own ("Radiation", "Dose") that
 * doesn't say what is being measured; naming the quantity ("Radiation dose")
 * reads clearly regardless of which name the loaded profile uses.
 */
const RADIATION_DOSE_RULE_NAMES = new Set(["radiation", "dose"]);

/** Title-cases a wire rule name for display, e.g. "co2 poisoning" -> "Co2
 *  poisoning", with the radiation dose rule mapped to a clearer label (see
 *  `RADIATION_DOSE_RULE_NAMES`). */
function ruleLabel(name: string): string {
  if (RADIATION_DOSE_RULE_NAMES.has(name.toLowerCase()))
    return "Radiation dose";
  return name.length > 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

function RuleMeter({ rule }: Readonly<{ rule: KerbalRuleState }>) {
  return (
    <Meter
      size="sm"
      label={ruleLabel(rule.name)}
      value={rule.fraction}
      tone={toneFor(rule.fraction)}
      valueLabel={pct(rule.fraction)}
    />
  );
}

/**
 * CrewStatus's `crew-status.survival` augment: fills the base widget's
 * generic per-row survival slot with EVERY rule Kerbalism reports for this
 * kerbal (`CREW_SURVIVAL`, processor.ts), not only the worst one, so a
 * radiation dose sitting at 40% never hides behind a stress rule the
 * operator happened to be watching. Each meter is GENERIC telemetry, a
 * 0..1-toward-fatal magnitude, nothing more. It used to also carry a badge
 * that just restated the same rule name and percentage underneath itself
 * (redundant with the meter directly above it); that badge has moved to
 * `CrewSurvivalBadgeAugment` below, which states the CONSEQUENCE instead and
 * lives next to the kerbal's name, not stacked under its own meter.
 *
 * Renders EVERY rule Kerbalism reports for this kerbal, unconditionally: no
 * overflow disclosure. An earlier version collapsed rules past a visible
 * count behind a "Show N more" `Disclosure` (reasoned as "Kerbalism's stock
 * profile only ever reports two rules per kerbal"), but the full profile
 * reports up to ~7 (eating, drinking, breathing, co2 poisoning, radiation,
 * climatization, stress); hiding most of them behind an extra click was
 * exactly the kind of clutter-avoidance nobody asked for, and the operator
 * confirmed the disclosure served no purpose. A crowded profile just renders
 * a taller Stack.
 *
 * Renders nothing when the kerbal has no rule reported at all, so a vessel
 * with no Kerbalism data (or a kerbal Kerbalism has nothing to say about
 * yet) leaves the row exactly as the base widget renders it alone.
 */
function CrewSurvivalAugment({
  crewName,
  crewIndex,
}: SlotProps<"crew-status.survival">) {
  const survival = useProcessor(CREW_SURVIVAL);
  if (!survival) return null;
  const kerbal = findKerbal(survival, crewName, crewIndex);
  if (!kerbal || kerbal.rules.length === 0) return null;
  return (
    <Stack
      gap="xs"
      style={{
        paddingBottom: "var(--space-4)",
        paddingLeft: "var(--space-12)",
      }}
      aria-label="survival meters"
    >
      {kerbal.rules.map((rule) => (
        <RuleMeter key={rule.name} rule={rule} />
      ))}
    </Stack>
  );
}

/**
 * The consequence a kerbal's derived state implies, never a restated meter
 * number: only fires in the danger band (`tone === "nogo"`, the same
 * threshold `processor.ts`'s `kerbalTone` uses for an imminent death clock
 * or a rule past its critical fraction). A merely-elevated ("warn") kerbal
 * is already flagged by the meter's own colour in `.survival`; this badge
 * exists for the case that actually threatens the kerbal, so a nominal or
 * warn-tier kerbal carries no redundant badge next to their name.
 */
function warningFor(
  kerbal: KerbalSurvival,
): { label: string; tone: MeterTone } | null {
  if (kerbal.tone !== "nogo") return null;
  if (kerbal.deathClockSec !== null) {
    // A death clock is a DURATION, not a scalar quantity: it must render
    // through `formatDuration`, the same composite ladder the delay/countdown
    // strips use, never `speakQuantity(value("s", ...))`. Routing a duration
    // through the scalar `time` unit-kind is how this used to render "~4M TO
    // FATAL", an ambiguous "M" indistinguishable from metres once the Badge's
    // `text-transform: uppercase` got hold of it.
    return {
      label: `~${formatDuration(Math.max(0, kerbal.deathClockSec))} to fatal`,
      tone: kerbal.tone,
    };
  }
  if (kerbal.worstRule) {
    return {
      label: `${ruleLabel(kerbal.worstRule.name)} critical`,
      tone: kerbal.tone,
    };
  }
  return null;
}

/**
 * CrewStatus's `crew-status.badges` augment: the name-adjacent per-row
 * slot (renders inline in the roster row's `Cluster`, right next to the
 * kerbal's name, per `CrewBadgeContext`'s own doc comment: "a future
 * Kerbalism Habitat/Radiation Uplink can badge each kerbal"). Fed by the
 * SAME `CREW_SURVIVAL` Processor `CrewSurvivalAugment` above reads, one
 * per-frame derivation, two consumers, same dogfood pattern as
 * `ShipSystems/badge.ts`'s `ship-systems-badge`.
 */
function CrewSurvivalBadgeAugment({
  crewName,
  crewIndex,
}: SlotProps<"crew-status.badges">) {
  const survival = useProcessor(CREW_SURVIVAL);
  if (!survival) return null;
  const kerbal = findKerbal(survival, crewName, crewIndex);
  if (!kerbal) return null;
  const warning = warningFor(kerbal);
  if (!warning) return null;
  return (
    <Badge tone={warning.tone} size="sm">
      {warning.label}
    </Badge>
  );
}

registerAugment({
  id: "crew-status-survival",
  augments: "crew-status.survival",
  component: CrewSurvivalAugment,
  requires: "kerbalism",
  owner: KERBALISM,
});

registerAugment({
  id: "crew-status-survival-badge",
  augments: "crew-status.badges",
  component: CrewSurvivalBadgeAugment,
  requires: "kerbalism",
  owner: KERBALISM,
});

export { CrewSurvivalAugment, CrewSurvivalBadgeAugment };
