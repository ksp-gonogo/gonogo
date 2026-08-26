import { isReadOnlySetting, settingTypeOf } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { PrincipiaSettings } from "../__generated__/contract";
import { FRAME_TYPE } from "../plottingFrame";
import { PRINCIPIA_SETTINGS } from "./registerPrincipiaSettings";

/*
 * The rows are asserted through the SAME two predicates the renderer asks,
 * `isReadOnlySetting` and `settingTypeOf`, rather than by reading the literals
 * back. A row that declared `type: "text"` and answered a boolean would pass a
 * literal check and render "On" where a frame name belongs.
 */

function rowById(id: string) {
  const row = PRINCIPIA_SETTINGS.find((r) => r.id === id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return row;
}

/** What a row shows for a given payload, through its own `select`. */
function shown(id: string, payload: unknown): unknown {
  const row = rowById(id);
  if (row.backing !== "stream-backed") throw new Error(`${id} is not a stream`);
  return row.select(payload);
}

/** The wrapped form a `Value`-carrying field arrives in off the wire. */
function quantity<U extends string>(unit: U, magnitude: number) {
  return { magnitude, unit } as never;
}

const FULL: PrincipiaSettings = {
  pluginVersion: "principia 2026080123-Grassmann",
  readingSuspended: false,
  observedAtUt: quantity("ut", 1_000_000),
  plottingFrame: {
    selector: "Plotting frame",
    type: FRAME_TYPE.bodyCentredInertial,
    centreBody: "Kerbin",
    primaryBodies: ["Kerbin"],
    secondaryBodies: [],
    targetFrameSelected: false,
  },
  displayPatchedConics: true,
  predictionVesselId: "kerbal-x",
  predictionToleranceMetres: quantity("m", 1),
  predictionMaxSteps: quantity("count", 1_000_000),
  analysisMissionDurationRequestedSeconds: quantity("s", 7 * 86_400),
  recurrenceAutodetect: true,
  historyLengthSeconds: quantity("s", 3600),
  verboseLevel: quantity("count", 0),
  logThreshold: quantity("count", 0),
  stderrThreshold: quantity("count", 2),
  flushThreshold: quantity("count", 3),
  recordJournalRequested: false,
  journaling: false,
};

describe("Principia settings rows", () => {
  it("registers every row read-only, because nothing here has a writer", () => {
    expect(PRINCIPIA_SETTINGS.length).toBeGreaterThan(0);
    for (const row of PRINCIPIA_SETTINGS) {
      expect(isReadOnlySetting(row), row.id).toBe(true);
      expect(row.backing, row.id).toBe("stream-backed");
    }
  });

  it("files every row under one category, in named groups", () => {
    const categories = new Set(PRINCIPIA_SETTINGS.map((r) => r.category));
    expect([...categories]).toEqual(["Principia"]);

    const groups = [
      ...new Set(
        PRINCIPIA_SETTINGS.map((r) => r.group).filter(
          (g): g is string => g !== undefined,
        ),
      ),
    ];
    expect(groups).toEqual([
      "Plotting frame",
      "Target",
      "KSP features",
      "Prediction",
      "Flight plan",
      "Analysis",
      "Drawing",
      "In-game navball",
      "Diagnostics",
    ]);
  });

  it("gives every row a unique id", () => {
    const ids = PRINCIPIA_SETTINGS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows nothing at all while the Topic is silent", () => {
    // The renderer hands `undefined` when it has no payload. Every row has to
    // answer with absence rather than with a zero, an empty string or a
    // fabricated "Off": a settings panel full of zeroes reads as a plugin
    // configured to zero.
    for (const row of PRINCIPIA_SETTINGS) {
      if (row.backing !== "stream-backed") continue;
      expect(row.select(undefined) ?? undefined, row.id).toBeUndefined();
    }
  });

  it("shows nothing for a field the payload did not carry", () => {
    // Reading is suspended, so the plugin sends the gate and nothing else.
    const suspended: PrincipiaSettings = {
      readingSuspended: true,
      readingSuspendedReason: "Principia is recording a journal",
    };
    expect(shown("principia.settings.health", suspended)).toBe(
      "Reading suspended",
    );
    expect(shown("principia.settings.suspendedReason", suspended)).toBe(
      "Principia is recording a journal",
    );
    expect(shown("principia.settings.frame", suspended)).toBeUndefined();
    expect(
      shown("principia.settings.predictionTolerance", suspended),
    ).toBeUndefined();
    expect(shown("principia.settings.verboseLevel", suspended)).toBeUndefined();
  });

  it("declines the frame's name from the bodies the payload carried", () => {
    expect(shown("principia.settings.frame", FULL)).toBe(
      "Kerbin-Centred Inertial",
    );
    expect(shown("principia.settings.frameKind", FULL)).toBe(
      "Body-centred inertial",
    );
  });

  it("says whether apsides exist and whether lengths pulsate in this frame", () => {
    expect(shown("principia.settings.frameHasApsides", FULL)).toBe(true);
    expect(shown("principia.settings.frameLengthsPulsate", FULL)).toBe(false);

    const lagrange: PrincipiaSettings = {
      plottingFrame: {
        type: FRAME_TYPE.rotatingPulsating,
        primaryBody: "Kerbol",
        secondaryBody: "Kerbin",
      },
    };
    expect(shown("principia.settings.frameHasApsides", lagrange)).toBe(false);
    expect(shown("principia.settings.frameLengthsPulsate", lagrange)).toBe(
      true,
    );
  });

  it("renders an empty body list as absence rather than as an empty line", () => {
    expect(shown("principia.settings.framePrimaries", FULL)).toBe("Kerbin");
    expect(shown("principia.settings.frameSecondaries", FULL)).toBeUndefined();
  });

  it("hands a quantity through as a Value, so it renders with its unit", () => {
    // The wire carries these wrapped, and the row passes the wrapper along
    // rather than unwrapping to a bare number: a tolerance shown as a naked 1
    // is the readout `Unit` exists to stop.
    expect(
      settingTypeOf(rowById("principia.settings.predictionTolerance")),
    ).toBe("number");
    expect(shown("principia.settings.predictionTolerance", FULL)).toMatchObject(
      {
        magnitude: 1,
        unit: "m",
      },
    );
    expect(shown("principia.settings.historyLength", FULL)).toMatchObject({
      magnitude: 3600,
      unit: "s",
    });
  });

  it("names the log severities rather than showing their ordinals", () => {
    expect(shown("principia.settings.logThreshold", FULL)).toBe("INFO");
    expect(shown("principia.settings.stderrThreshold", FULL)).toBe("ERROR");
    expect(shown("principia.settings.flushThreshold", FULL)).toBe("FATAL");
  });

  it("shows an unknown severity as itself rather than as a neighbour", () => {
    const future: PrincipiaSettings = { logThreshold: quantity("count", 9) };
    expect(shown("principia.settings.logThreshold", future)).toBe("Severity 9");
  });

  it("separates a journal that was asked for from one that is running", () => {
    expect(shown("principia.settings.recordJournalRequested", FULL)).toBe(
      false,
    );
    expect(shown("principia.settings.journaling", FULL)).toBe(false);
    expect(shown("principia.settings.health", FULL)).toBe("Reading");
  });
});
