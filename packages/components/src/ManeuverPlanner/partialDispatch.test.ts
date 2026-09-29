import { FaultCode } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  describeNodeRejection,
  describePartialDispatch,
} from "./partialDispatch";

/** A rejection as the spine throws one: a message plus the code a structural reader classifies on. */
function rejection(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`raw ${code} message`), { code, ...extra });
}

const LOST = rejection("E_LOST");
const REFUSED = rejection("E_REFUSED", {
  errorCode: "modeUnavailable",
  detail: "Maneuver nodes need the Tracking Station upgraded",
});
const UNDELIVERED = rejection(FaultCode.Undelivered);
const BROKEN = rejection("E_SOMETHING");

const ADD = { command: "vessel.maneuver.add", label: "Add maneuver node" };

describe("describeNodeRejection", () => {
  it("says a command with no reply may have run, never that it failed", () => {
    const said = describeNodeRejection(LOST, ADD);
    expect(said).toBe("Add maneuver node: no reply. May have run.");
    expect(said).not.toMatch(/fail/i);
  });

  it("says a refusal in the game's own words", () => {
    expect(describeNodeRejection(REFUSED, ADD)).toBe(
      "Add maneuver node refused: Maneuver nodes need the Tracking Station upgraded.",
    );
  });

  it("says a command that never left is safe to re-send", () => {
    expect(describeNodeRejection(UNDELIVERED, ADD)).toBe(
      "Add maneuver node: never sent. Safe to re-send.",
    );
  });

  it("calls only a broken dispatch failed, and never quotes the machinery's message", () => {
    const said = describeNodeRejection(BROKEN, ADD);
    expect(said).toBe(
      "Add maneuver node: failed, with no verdict from the game.",
    );
    expect(said).not.toContain("raw");
  });
});

describe("describePartialDispatch", () => {
  it("leads with what KSP confirmed, then names the burn it stopped at", () => {
    expect(
      describePartialDispatch({
        confirmed: 3,
        total: 5,
        err: LOST,
        dispatch: ADD,
      }),
    ).toBe("3 of 5 burns confirmed. Burn 4: no reply. May have run.");
  });

  it("names the stopping burn as the one AFTER those confirmed", () => {
    // An off-by-one here misnames the missing node, so the boundaries are pinned.
    expect(
      describePartialDispatch({
        confirmed: 0,
        total: 4,
        err: LOST,
        dispatch: ADD,
      }),
    ).toContain("Burn 1:");
    expect(
      describePartialDispatch({
        confirmed: 3,
        total: 4,
        err: LOST,
        dispatch: ADD,
      }),
    ).toContain("Burn 4:");
  });

  it("carries a refusal's reason for the stopping burn", () => {
    expect(
      describePartialDispatch({
        confirmed: 1,
        total: 2,
        err: REFUSED,
        dispatch: ADD,
      }),
    ).toBe(
      "1 of 2 burns confirmed. Burn 2 refused: Maneuver nodes need the Tracking Station upgraded.",
    );
  });

  it("says only the command's outcome for a single-burn plan", () => {
    expect(
      describePartialDispatch({
        confirmed: 0,
        total: 1,
        err: LOST,
        dispatch: ADD,
      }),
    ).toBe("Add maneuver node: no reply. May have run.");
  });

  it("does not claim a count it cannot have, for an empty plan", () => {
    expect(
      describePartialDispatch({
        confirmed: 0,
        total: 0,
        err: LOST,
        dispatch: ADD,
      }),
    ).toBe("Add maneuver node: no reply. May have run.");
  });
});
