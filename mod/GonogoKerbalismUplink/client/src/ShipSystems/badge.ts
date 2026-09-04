import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import { SHIP_SYSTEMS, type ShipSystems } from "../processor";
import { KERBALISM } from "../uplink";

// The Ship Systems panel badge.
//
// A pure contribution to the widget's auto-wired `${componentId}.badges` slot,
// fed by the SAME `SHIP_SYSTEMS` Processor the widget body reads via
// useProcessor. This is the dogfood: one per-frame `summarise` evaluation, two
// consumers (the widget renders the rows, this derives a one-line header
// status), never two derivations. The host mounts it on the Panel with zero
// widget-side wiring.
//
// The badge flags only a problem: the single most-urgent shortage (a root
// cause first, since acting on a symptom is wasted effort, then a supply below
// its low threshold). It returns null when nothing is short, so a nominal
// vessel carries no header clutter.
// ---------------------------------------------------------------------------

function statusBadges(ship: ShipSystems | undefined): BadgeEntry[] | null {
  if (!ship) return null;
  const { causes, supplies } = ship.summary;
  const rootCause = causes[0];
  if (rootCause !== undefined) {
    return [
      {
        id: "ship-systems-status",
        label: `${rootCause.displayName} critical`,
        tone: "nogo",
      },
    ];
  }
  const low = supplies.find((row) => row.belowLowThreshold === true);
  if (low !== undefined) {
    return [
      {
        id: "ship-systems-status",
        label: `${low.displayName} low`,
        tone: "warn",
      },
    ];
  }
  return null;
}

KERBALISM.registerContribution({
  id: "ship-systems-badge",
  contributes: "ship-systems.badges",
  deps: [SHIP_SYSTEMS],
  requires: "flight",
  compute: (topics) => statusBadges(topics[SHIP_SYSTEMS.id]),
});
