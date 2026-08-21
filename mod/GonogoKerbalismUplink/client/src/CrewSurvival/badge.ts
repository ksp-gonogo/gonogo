import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import { KERBALISM } from "../uplink";
import { CREW_SURVIVAL, type CrewSurvival } from "./processor";

// ---------------------------------------------------------------------------
// CrewStatus's panel badge (mirrors `ShipSystems/badge.ts`'s
// `ship-systems-badge`): a pure contribution to the widget's auto-wired
// `crew-status.badges` slot (the collapsed-header badge the panel-header
// redesign surfaces, contribution-slots-spec §13.2 `panelBadges`). The
// widget-authored per-row AugmentSlot that used to share this exact string is
// now `crew-status.row-badges`: one name across two registries rendered in two
// places on screen and gave an author no way to tell which they were binding.
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
  compute: (topics) =>
    survivalBadges(topics[CREW_SURVIVAL.id] as CrewSurvival | undefined),
});

export { survivalBadges };
