import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import { KERBALISM } from "../uplink";
import {
  CREW_SURVIVAL,
  type CrewSurvival,
  type KerbalSurvival,
} from "./processor";

// ---------------------------------------------------------------------------
// CrewManifest's panel badge (mirrors `ShipSystems/badge.ts`'s
// `ship-systems-badge`): a pure contribution to the widget's auto-wired
// `crew-manifest.badges` slot, fed by the SAME `CREW_SURVIVAL` Processor the
// `crew-manifest.survival` augment renders. One per-frame evaluation, two
// consumers.
//
// Flags only the single most-urgent kerbal (worst tone, ties broken by
// soonest death clock, then highest rule fraction). Returns null when the
// whole crew is fine, so a nominal vessel carries no header clutter.
// ---------------------------------------------------------------------------

function severityRank(tone: KerbalSurvival["tone"]): number {
  return tone === "nogo" ? 2 : tone === "warn" ? 1 : 0;
}

function worstKerbal(
  kerbals: readonly KerbalSurvival[],
): KerbalSurvival | undefined {
  let worst: KerbalSurvival | undefined;
  for (const k of kerbals) {
    if (k.tone === "go") continue;
    if (!worst) {
      worst = k;
      continue;
    }
    const rankDiff = severityRank(k.tone) - severityRank(worst.tone);
    if (rankDiff > 0) {
      worst = k;
      continue;
    }
    if (rankDiff < 0) continue;

    const kClock = k.deathClockSec ?? Number.POSITIVE_INFINITY;
    const worstClock = worst.deathClockSec ?? Number.POSITIVE_INFINITY;
    if (kClock < worstClock) {
      worst = k;
      continue;
    }
    if (
      kClock === worstClock &&
      (k.worstRule?.fraction ?? 0) > (worst.worstRule?.fraction ?? 0)
    ) {
      worst = k;
    }
  }
  return worst;
}

function survivalBadges(
  survival: CrewSurvival | undefined,
): BadgeEntry[] | null {
  if (!survival) return null;
  const worst = worstKerbal(survival.kerbals);
  if (!worst) return null;
  const label =
    worst.deathClockSec !== null
      ? `${worst.name} critical`
      : worst.worstRule
        ? `${worst.name}: ${worst.worstRule.name}`
        : `${worst.name} critical`;
  return [{ id: "crew-survival-status", label, tone: worst.tone }];
}

KERBALISM.registerContribution({
  id: "crew-survival-badge",
  contributes: "crew-manifest.badges",
  deps: [CREW_SURVIVAL],
  requires: "kerbalism",
  compute: (topics) =>
    survivalBadges(topics[CREW_SURVIVAL.id] as CrewSurvival | undefined),
});
