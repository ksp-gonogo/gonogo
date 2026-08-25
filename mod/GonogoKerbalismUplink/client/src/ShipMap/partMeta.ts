import type { ContributionEntry } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "@ksp-gonogo/ui-kit";
import type { KerbalismLifeSupport } from "../__generated__/contract";
import { KERBALISM } from "../uplink";

// ---------------------------------------------------------------------------
// The Kerbalism `ship-map.part-meta` contribution: per-part status rows for
// things that aren't a fill-level meter. Today the ONLY real per-part
// granularity on the wire is a fitted process's running/broken/idle state
// (`KerbalismLifeSupport.processes[].flightId`), so that's all this emits.
//
// Habitat pressure, radiation dose, and reliability MTBF are named in the
// design plan as the eventual `ship-map.part-meta` payload, but NONE of them
// are on the wire with per-part granularity today:
//   - `KerbalismLifeSupport.habitat` is one vessel-wide aggregate, not
//     per-part. Attaching it to every crewed part would fabricate a
//     distinct-per-part reading that doesn't exist.
//   - Radiation dose is per-CREW (a `KerbalismCrewEntry` rule), not per-part.
//   - There is no MTBF/failure-rate field on the wire at all;
//     `KerbalismFeatures.reliability` is only a boolean feature flag.
// This is real debt: extending the wire contract to carry these is a mod-
// side change (Sitrep.Contract + a full mod sln test pass), out of scope for
// this pass. Flagged rather than faked with a fabricated per-part number.
// ---------------------------------------------------------------------------

type PartMetaEntry = ContributionEntry<"ship-map.part-meta">;

/**
 * Pure core of the Kerbalism part-meta contribution, exported so a test can
 * call it directly against a plain `KerbalismLifeSupport` fixture (mirrors
 * `spaceWeatherBadges`'s export-the-pure-core pattern).
 */
export function computeKerbalismPartMeta(
  lifeSupport: KerbalismLifeSupport | undefined,
): PartMetaEntry[] {
  if (!lifeSupport) return [];
  const entries: PartMetaEntry[] = [];
  for (const entry of lifeSupport.processes ?? []) {
    // A flightID that did not arrive attaches to no part, and defaulting it
    // would attach the row to part "0", which is a different part's status.
    const flightId = magnitudeOf(entry.flightId);
    if (flightId === null) continue;
    const label = entry.title || entry.resource || "process";
    const running = entry.running === true;
    const broken = entry.broken === true;
    entries.push({
      partId: String(flightId),
      label,
      tone: broken ? "nogo" : running ? "go" : "neutral",
      kind: "text",
      text: broken ? "broken" : running ? "running" : "idle",
    });
  }
  return entries;
}

KERBALISM.registerContribution({
  id: "ship-map-part-meta",
  contributes: "ship-map.part-meta",
  deps: ["kerbalism.lifesupport"],
  requires: "kerbalism",
  compute: (topics) =>
    computeKerbalismPartMeta(
      topics["kerbalism.lifesupport"] as KerbalismLifeSupport | undefined,
    ),
});
