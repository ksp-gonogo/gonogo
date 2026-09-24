import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import { KERBALISM } from "../uplink";
import {
  CREW_SURVIVAL,
  CRITICAL_FRACTION,
  type CrewSurvival,
} from "./processor";
import { CREW_RULE_READINGS, type RuleReadings } from "./ruleReadings";

// ---------------------------------------------------------------------------
// CrewStatus's panel badge (mirrors `ShipSystems/badge.ts`'s
// `ship-systems-badge`): a pure contribution to the widget's auto-wired
// `crew-status.badges` slot, the collapsed-header `panelBadges` row. The
// widget-authored per-row AugmentSlot is deliberately a DIFFERENT string,
// `crew-status.row-badges`: one name across two registries renders in two
// places on screen and leaves an author no way to tell which they bound.
// Fed by the SAME `CREW_SURVIVAL` Processor `index.tsx`'s per-row augment
// reads: one per-frame evaluation, two consumers.
//
// States the condition at VESSEL level ("Crew critical" / "2 crew
// critical"), never a specific kerbal's name: the header has room for one
// line, and a name-dropping badge would need to change shape the moment a
// second kerbal joins the danger band. Fires only in the danger band
// (`tone === "nogo"`, the same threshold the per-row badge in `index.tsx`'s
// `warningFor` uses for an imminent death clock or a rule past its critical
// fraction): a merely-elevated ("warn") crew is already flagged per-kerbal by
// the `.survival` meter's own colour, so the header stays quiet for that
// case and reserves itself for what actually threatens someone. Returns null
// when nobody is critical, so a nominal vessel carries no header clutter.
// ---------------------------------------------------------------------------

function survivalBadges(
  survival: CrewSurvival | undefined,
): BadgeEntry[] | null {
  if (!survival) return null;
  const critical = survival.kerbals.filter((k) => k.tone === "nogo").length;
  if (critical === 0) return null;
  const label = critical === 1 ? "Crew critical" : `${critical} crew critical`;
  return [{ id: "crew-survival-status", label, tone: "nogo" }];
}

KERBALISM.registerContribution({
  id: "crew-survival-badge",
  contributes: "crew-status.badges",
  deps: [CREW_SURVIVAL],
  requires: "kerbalism",
  compute: (topics) => survivalBadges(topics[CREW_SURVIVAL.id]),
});

/**
 * Kerbals the crew model says COULD be critical while their own figures are
 * not: a rule whose model interval reaches the critical fraction on its
 * pessimistic end.
 *
 * On the toward-fatal axis worse is higher, so the end that matters is the
 * band's high one. A kerbal already critical on their figures is left to
 * `survivalBadges`, and a rule the model does not band says nothing either
 * way, because no band is not a band that is comfortably clear.
 *
 * The words say it is the model's range. Not `bandClaim`: that qualifies a
 * statement that the value is INSIDE an interval, and this is a statement that
 * the interval's far end reaches a line, so "about two thirds of the time"
 * appended here would claim the crew reaches critical two times in three.
 */
function bandBadges(
  readings: RuleReadings | undefined,
  survival: CrewSurvival | undefined,
): BadgeEntry[] | null {
  if (!readings) return null;
  const criticalNow = new Set(
    (survival?.kerbals ?? [])
      .filter((k) => k.tone === "nogo")
      .map((k) => k.name),
  );
  const atRisk = new Set<string>();
  for (const [key, reading] of Object.entries(readings)) {
    const kerbal = key.slice(0, key.lastIndexOf(":"));
    if (criticalNow.has(kerbal)) continue;
    if (reading.reckoning.status !== "available") continue;
    const band = reading.reckoning.band;
    if (band === undefined) continue;
    if (!band.hi.greaterThanOrEqual(CRITICAL_FRACTION)) continue;
    const figure =
      reading.state === "observed" || reading.state === "stale"
        ? reading.value
        : undefined;
    if (figure?.greaterThanOrEqual(CRITICAL_FRACTION)) continue;
    atRisk.add(kerbal);
  }
  if (atRisk.size === 0) return null;
  const label =
    atRisk.size === 1
      ? "Crew critical in model range"
      : `${atRisk.size} crew critical in model range`;
  return [{ id: "crew-survival-band", label, tone: "warn" }];
}

KERBALISM.registerContribution({
  id: "crew-survival-band-badge",
  contributes: "crew-status.badges",
  deps: [CREW_RULE_READINGS, CREW_SURVIVAL],
  requires: "kerbalism",
  compute: (topics) =>
    bandBadges(topics[CREW_RULE_READINGS.id], topics[CREW_SURVIVAL.id]),
});

export { bandBadges, survivalBadges };
