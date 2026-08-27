import { describe, expect, it } from "vitest";
import { CrewStanding, KspRosterStatus } from "./__generated__/contract";
import {
  CREW_STANDING_NAMES,
  CREW_STANDING_ORDER,
  crewStandingFromRosterStatus,
  crewStandingLabel,
  isFatality,
  isOffTheBooks,
} from "./crew-standing";

describe("CREW_STANDING_ORDER", () => {
  it("covers every declared standing exactly once", () => {
    // The Astronaut Complex builds its sub-tabs off this, so a standing missing
    // from it is a standing with no tab and a bucket of kerbals nobody sees.
    expect([...CREW_STANDING_ORDER].sort((a, b) => a - b)).toEqual(
      [...CREW_STANDING_NAMES.keys()].sort((a, b) => a - b),
    );
    expect(new Set(CREW_STANDING_ORDER).size).toBe(CREW_STANDING_ORDER.length);
  });

  it("puts Unknown last despite it being ordinal zero", () => {
    // A surface should show what it does know before what it does not.
    expect(CREW_STANDING_ORDER[CREW_STANDING_ORDER.length - 1]).toBe(
      CrewStanding.Unknown,
    );
  });

  /**
   * The whole reason this list is derived rather than transcribed. The
   * predecessor derived the same ordering from KSP's `RosterStatus` and carried
   * a comment promising a mod's "Retired" a tab for free; it never got one,
   * because RP-1 appends no roster status.
   */
  it("carries Retired, which no KSP roster status supplies", () => {
    expect(CREW_STANDING_ORDER).toContain(CrewStanding.Retired);
  });
});

describe("crewStandingFromRosterStatus", () => {
  it.each([
    [KspRosterStatus.Available, CrewStanding.Available],
    [KspRosterStatus.Assigned, CrewStanding.Assigned],
    [KspRosterStatus.Dead, CrewStanding.Dead],
    [KspRosterStatus.Missing, CrewStanding.Missing],
  ])("maps roster status %i to standing %i", (ordinal, expected) => {
    expect(crewStandingFromRosterStatus(ordinal, false)).toBe(expected);
  });

  it("calls an applicant an applicant with no ordinal to go on", () => {
    expect(crewStandingFromRosterStatus(null, true)).toBe(
      CrewStanding.Applicant,
    );
    expect(crewStandingFromRosterStatus(undefined, true)).toBe(
      CrewStanding.Applicant,
    );
  });

  it("refuses to guess at an ordinal it does not declare", () => {
    // Unknown is a third answer: not "available" (we cannot promise the kerbal
    // can fly) and not "dead" (we have no grounds to say so).
    expect(crewStandingFromRosterStatus(9, false)).toBe(CrewStanding.Unknown);
    expect(crewStandingFromRosterStatus(null, false)).toBe(
      CrewStanding.Unknown,
    );
    expect(crewStandingFromRosterStatus(undefined, false)).toBe(
      CrewStanding.Unknown,
    );
  });

  /**
   * The direction that matters. This exists for version skew against a mod
   * build older than the crew-standing capability, and against such a build
   * there is no retiree set to consult: an RP-1 retiree carries stock's Dead
   * and reads as a fatality. That is the truth about that pairing, and
   * inventing a retirement from the ordinal alone would be a guess the client
   * has no grounds for.
   */
  it("never invents a retirement, because the ordinal cannot supply one", () => {
    for (const ordinal of [-1, 0, 1, 2, 3, 4, 5, 6, 9, null, undefined]) {
      expect(crewStandingFromRosterStatus(ordinal, false)).not.toBe(
        CrewStanding.Retired,
      );
      expect(crewStandingFromRosterStatus(ordinal, true)).not.toBe(
        CrewStanding.Retired,
      );
    }
  });
});

describe("crewStandingLabel", () => {
  it("names every declared standing", () => {
    for (const [standing, name] of CREW_STANDING_NAMES) {
      expect(crewStandingLabel(standing)).toBe(name);
    }
  });

  it("invents no label for a value this build does not declare", () => {
    // A label invented for an unknown number is a label an operator reads as a
    // fact; a caller with nothing to show should show nothing.
    expect(crewStandingLabel(99)).toBeNull();
    expect(crewStandingLabel(null)).toBeNull();
    expect(crewStandingLabel(undefined)).toBeNull();
  });
});

describe("isFatality / isOffTheBooks", () => {
  /**
   * THE distinction, in the one helper every badge severity reads. Retiring is
   * not dying, and a badge that cannot tell them apart is what told operators
   * their astronauts had been killed.
   */
  it("counts a retirement as off the books but not as a fatality", () => {
    expect(isOffTheBooks(CrewStanding.Retired)).toBe(true);
    expect(isFatality(CrewStanding.Retired)).toBe(false);
  });

  it("counts a death and a disappearance as both", () => {
    for (const standing of [CrewStanding.Dead, CrewStanding.Missing]) {
      expect(isOffTheBooks(standing)).toBe(true);
      expect(isFatality(standing)).toBe(true);
    }
  });

  it("counts a flying career as neither", () => {
    for (const standing of [
      CrewStanding.Available,
      CrewStanding.Assigned,
      CrewStanding.Applicant,
      CrewStanding.Unknown,
      null,
      undefined,
    ]) {
      expect(isOffTheBooks(standing)).toBe(false);
      expect(isFatality(standing)).toBe(false);
    }
  });
});
