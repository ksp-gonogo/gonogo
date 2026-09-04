import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import type { KerbalismSpaceWeather } from "../__generated__/contract";
import { KERBALISM } from "../uplink";

// The Space Weather panel badge.
//
// A pure contribution to the SpaceWeather widget's auto-wired
// `space-weather.badges` slot, fed straight off the `kerbalism.spaceweather`
// Topic (no Processor: unlike Ship Systems, nothing else shares this
// derivation, so a Topic dep is enough). The host mounts it on the widget's
// Panel with zero widget-side wiring.
//
// The badge flags only a hazard, and mirrors the widget's own `statusFor`
// vocabulary so header and body agree: a storm in progress reads "Storm in
// progress" (nogo), an incoming storm or a radiation belt is "Exposed"
// (warn). A badge states the CONDITION; it never instructs the operator
// (no "take cover", no imperative of any kind), the operator decides what to
// do with that fact. It returns null when the vessel is sheltered, so a
// quiet magnetosphere carries no header clutter.
// ---------------------------------------------------------------------------

function spaceWeatherBadges(
  weather: KerbalismSpaceWeather | undefined,
): BadgeEntry[] | null {
  if (!weather) return null;
  if (weather.stormInProgress === true) {
    return [
      { id: "space-weather-status", label: "Storm in progress", tone: "nogo" },
    ];
  }
  if (
    weather.stormIncoming === true ||
    weather.innerBelt === true ||
    weather.outerBelt === true
  ) {
    return [{ id: "space-weather-status", label: "Exposed", tone: "warn" }];
  }
  return null;
}

KERBALISM.registerContribution({
  id: "space-weather-badge",
  contributes: "space-weather.badges",
  deps: ["kerbalism.spaceweather"],
  requires: "kerbalism",
  compute: (topics) => spaceWeatherBadges(topics["kerbalism.spaceweather"]),
});

export { spaceWeatherBadges };
