import { describe, expect, it } from "vitest";
import type {
  PrincipiaReferenceFrame,
  PrincipiaSettings,
} from "../__generated__/contract";
import { FRAME_TYPE } from "../plottingFrame";
import { PRINCIPIA_SETTINGS } from "./registerPrincipiaSettings";

/*
 * Completeness: a setting the mod publishes has a row on the settings surface.
 *
 * The settings tab is the FLOOR rather than one of several possible homes. A
 * field that reaches the console and appears only inside some widget is
 * reachable only by whoever placed that widget, and the operator who goes
 * looking for it where settings live does not find it. So this test asks the
 * question the other direction from the row assertions next door: not "does
 * each row work", but "is anything on the wire missing a row at all".
 *
 * It does that WITHOUT a hand-written list of surfaced fields, because a list
 * like that is the thing that silently stops matching the code. Two mechanisms
 * instead:
 *
 *   1. `EVERY_FIELD` is typed `Required<PrincipiaSettings>`, so a field added to
 *      the contract fails to compile here until it is filled in. That is what
 *      makes `Object.keys` on it a trustworthy enumeration of the payload.
 *   2. Which field a row reads is DISCOVERED by putting one field at a time
 *      through every row's own `select` and watching what changes, rather than
 *      declared. A row that stops reading a field stops covering it here, even
 *      though its own literals never changed.
 *
 * The only declaration is {@link NOT_A_SETTING}, and it is short on purpose.
 */

/** The wrapped form a `Value`-carrying field arrives in off the wire. */
function quantity<U extends string>(unit: U, magnitude: number) {
  return { magnitude, unit } as never;
}

/**
 * Fields that are keys rather than settings, with the reason each is exempt.
 *
 * A guid is not something an operator sets, reads or judges another number by,
 * and the vessel it names has a row carrying the same fact in a form that can be
 * read. Anything else absent from the surface is a gap, not an exemption.
 */
const NOT_A_SETTING: Readonly<Record<string, string>> = {
  targetVesselId: "a guid; the target vessel's name is a row of its own",
};

/** As above, for the fields of the frame sub-object. */
const NOT_A_FRAME_SETTING: Readonly<Record<string, string>> = {
  targetVesselId: "a guid; the frame's target vessel name is a row of its own",
};

const EVERY_FRAME_FIELD: Required<PrincipiaReferenceFrame> = {
  selector: "Plotting frame",
  type: FRAME_TYPE.parentDirection,
  centreBody: "Kerbin",
  primaryBody: "Kerbol",
  secondaryBody: "Kerbin",
  primaryBodies: ["Kerbol", "Moho"],
  secondaryBodies: ["Kerbin", "Mun"],
  targetFrameSelected: true,
  targetVesselId: "88888888-4444-4444-4444-121212121212",
  targetVesselName: "Ares IV",
  targetPrimaryBody: "Duna",
};

const EVERY_FIELD: Required<PrincipiaSettings> = {
  observedAtUt: quantity("ut", 1_000_000),
  pluginVersion: "principia 2026080123-Grassmann",
  readingSuspended: true,
  readingSuspendedReason: "recording a journal",
  plottingFrame: EVERY_FRAME_FIELD,
  burnFrames: [EVERY_FRAME_FIELD],
  selectingTargetVessel: true,
  targetVesselId: "88888888-4444-4444-4444-121212121212",
  targetVesselName: "Ares IV",
  selectingTargetCelestial: true,
  targetCelestialBody: "Duna",
  displayPatchedConics: true,
  analysisMissionDurationRequestedSeconds: quantity("s", 604_800),
  recurrenceAutodetect: true,
  recurrenceRevolutionsPerCycle: quantity("count", 43),
  recurrenceDaysPerCycle: quantity("count", 3),
  groundTrackRevolution: quantity("count", 2),
  predictionVesselId: "kerbal-x",
  predictionToleranceMetres: quantity("m", 1),
  predictionMaxSteps: quantity("count", 1_000_000),
  planToleranceMetres: quantity("m", 10),
  planMaxSteps: quantity("count", 1_048_576),
  planInitialTimeUt: quantity("ut", 1_000_100),
  planDesiredFinalTimeUt: quantity("ut", 2_000_000),
  planActualFinalTimeUt: quantity("ut", 1_500_000),
  flightPlanCount: quantity("count", 3),
  selectedFlightPlan: quantity("count", 1),
  optimiserTargetAltitudeMetres: quantity("m", 250_000),
  optimiserTargetInclinationDegrees: quantity("°", 51.6),
  historyLengthSeconds: quantity("s", 3600),
  unpinnedMarkersHiddenHere: true,
  framesHidingUnpinnedMarkers: quantity("count", 2),
  unpinnedCelestialsHiddenHere: true,
  framesHidingUnpinnedCelestials: quantity("count", 1),
  pinnedCelestials: ["Mun", "Minmus"],
  targetPinned: true,
  showManoeuvreOnNavball: true,
  stabilityGridMaxEccentricityMinInclination: true,
  stabilityGridMinEccentricityMaxInclination: true,
  showElementGraphs: true,
  verboseLevel: quantity("count", 1),
  logThreshold: quantity("count", 0),
  stderrThreshold: quantity("count", 2),
  flushThreshold: quantity("count", 3),
  recordJournalRequested: true,
  journaling: true,
};

/** Every row's own `select`, applied to one payload. */
function readAll(payload: unknown): string[] {
  return PRINCIPIA_SETTINGS.map((r) => {
    if (r.backing !== "stream-backed")
      throw new Error(`${r.id} is not a stream`);
    return JSON.stringify(r.select(payload) ?? null);
  });
}

/**
 * The fields of `fields` that no row reads, discovered rather than declared.
 *
 * One field at a time against a baseline that carries none of them: a field is
 * surfaced when adding it alone moves at least one row's answer. Alone rather
 * than in combination because a row reading two fields would otherwise let the
 * first vouch for the second.
 */
function unsurfaced(
  fields: Record<string, unknown>,
  wrap: (partial: Record<string, unknown>) => unknown,
): string[] {
  const baseline = readAll(wrap({}));
  const missing: string[] = [];
  for (const [name, v] of Object.entries(fields)) {
    const shown = readAll(wrap({ [name]: v }));
    if (shown.every((s, i) => s === baseline[i])) missing.push(name);
  }
  return missing;
}

describe("Principia settings coverage", () => {
  it("gives every field the payload carries a row", () => {
    const missing = unsurfaced(EVERY_FIELD, (partial) => partial).filter(
      (name) => !(name in NOT_A_SETTING),
    );
    expect(missing).toEqual([]);
  });

  it("gives every field of the plotting frame a row", () => {
    const missing = unsurfaced(EVERY_FRAME_FIELD, (partial) => ({
      plottingFrame: partial,
    })).filter((name) => !(name in NOT_A_FRAME_SETTING));
    expect(missing).toEqual([]);
  });

  it("names a reason for each field it exempts", () => {
    for (const [name, reason] of [
      ...Object.entries(NOT_A_SETTING),
      ...Object.entries(NOT_A_FRAME_SETTING),
    ]) {
      expect(reason, name).not.toBe("");
    }
  });

  /*
   * The detector's own failure mode. It reports a gap by finding NOTHING, which
   * is also what a broken detector reports, so a green result above means
   * "every field is surfaced" only if this passes: a field no row can possibly
   * read has to come back named.
   */
  it("reports a field no row reads", () => {
    const planted = { ...EVERY_FIELD, aFieldNoRowReads: true };
    expect(unsurfaced(planted, (partial) => partial)).toContain(
      "aFieldNoRowReads",
    );
  });

  it("reports a frame field no row reads", () => {
    const planted = { ...EVERY_FRAME_FIELD, aFrameFieldNoRowReads: true };
    expect(
      unsurfaced(planted, (partial) => ({ plottingFrame: partial })),
    ).toContain("aFrameFieldNoRowReads");
  });
});
