import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contactPhase, type FleetVesselSilence } from "./fleet-contact";

/**
 * `silence.<guid>.state` carries `Sitrep.Host.Comms.SilenceState` as its NAME,
 * not its ordinal, so there is no number to branch on instead. What there has
 * to be, then, is a branch that cannot silently absorb a member nobody has
 * ruled on.
 *
 * `contactPhase` used to test for "Lost" and "Nominal" and let everything else
 * fall through to the Silent treatment. The phase drives FleetRoster's badge:
 * `lost` is `severity="critical"` with `role="alert"`, `waiting` renders
 * nothing at all. So a member appended to the C# enum, however grave, would
 * have been reported as a vessel quietly waiting to come back.
 *
 * Two checks, because either alone reports success while the other fails:
 * the union here has to keep covering the C# enum, and the branch has to keep
 * refusing a state it does not recognize.
 */

// packages/sitrep-client/src -> repo root
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SILENCE_TRACKER = "mod/Sitrep.Host/Comms/SilenceTracker.cs";

/** Members of the C# `SilenceState` enum, read out of the mod source. */
function declaredSilenceStates(): string[] {
  const source = readFileSync(join(REPO_ROOT, SILENCE_TRACKER), "utf8");
  const body = /\benum\s+SilenceState\b[^{]*\{([\s\S]*?)\n\s*\}/.exec(
    source,
  )?.[1];
  if (body === undefined) {
    throw new Error(`no enum SilenceState in ${SILENCE_TRACKER}`);
  }
  return body
    .split("\n")
    .map((line) =>
      line
        .replace(/\/\/.*$/, "")
        .trim()
        .replace(/,$/, ""),
    )
    .filter((line) => /^[A-Za-z_]\w*$/.test(line));
}

/** The union the client declares, as values rather than types. */
const CLIENT_STATES: ReadonlyArray<FleetVesselSilence["state"]> = [
  "Nominal",
  "Silent",
  "Lost",
];

describe("SilenceState stays in step with the mod", () => {
  it("reads the enum members out of the C# source at all", () => {
    // Guards the reader: an extractor that returned nothing would make any
    // union pass, and report success for the drift it was asked about.
    expect(declaredSilenceStates()).toEqual(["Nominal", "Silent", "Lost"]);
  });

  it("declares a client state for every C# member", () => {
    expect([...CLIENT_STATES].sort()).toEqual(declaredSilenceStates().sort());
  });

  it("gives each declared state its own phase", () => {
    const phases = CLIENT_STATES.map((state) =>
      contactPhase({ state } as FleetVesselSilence, 100),
    );
    expect(phases).toEqual(["nominal", "waiting", "lost"]);
  });
});

describe("contactPhase and a state it does not recognize", () => {
  /**
   * The arm that matters. A state the client has never heard of is not a
   * vessel waiting quietly: nothing has been reckoned about it, and the honest
   * answer is no phase at all, which FleetRoster renders as no badge rather
   * than as a claim of routine silence.
   */
  it("refuses to report an unknown state as a routine wait", () => {
    const silence = { state: "Destroyed" } as unknown as FleetVesselSilence;
    expect(contactPhase(silence, 100)).toBeUndefined();
  });

  it("refuses it whether or not a reacquisition was predicted", () => {
    const silence = {
      state: "Destroyed",
      predictedReacquisitionUt: 50,
    } as unknown as FleetVesselSilence;
    // With a prediction in the past this used to read "overdue", which is a
    // statement about a vessel we have no state for.
    expect(contactPhase(silence, 100)).toBeUndefined();
  });

  it("still says nothing when no silence record has arrived", () => {
    expect(contactPhase(undefined, 100)).toBeUndefined();
  });
});
