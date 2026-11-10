import { describe, expect, it } from "vitest";
import { deriveSpaceCenterState } from "./space-center-state";

describe("deriveSpaceCenterState: pad occupancy off the raw spaceCenter.launchSites array", () => {
  it("undefined while spaceCenter.launchSites hasn't arrived (resyncing): never throws", () => {
    expect(deriveSpaceCenterState(undefined)).toBeUndefined();
  });

  it("null on a confirmed spaceCenter.launchSites tombstone", () => {
    expect(deriveSpaceCenterState(null)).toBeNull();
  });

  it("reads as unknown for an empty (but present) launch-sites array", () => {
    // An empty list reports no occupancy, which is not the same claim as a pad reported clear: a gate reading `!padOccupied` must not treat it as one.
    expect(deriveSpaceCenterState([])).toEqual({
      padOccupied: null,
      padVesselTitle: null,
    });
  });

  it("propagates padOccupied and padVesselTitle from the stock-pad entry", () => {
    expect(
      deriveSpaceCenterState([
        { padOccupied: true, padVesselTitle: "Kerbal X" },
      ]),
    ).toEqual({
      padOccupied: true,
      padVesselTitle: "Kerbal X",
    });
  });

  it("reports padOccupied:null when no entry carries the stock-pad occupancy flag", () => {
    expect(
      deriveSpaceCenterState([
        { padOccupied: null, padVesselTitle: null },
        { padOccupied: undefined, padVesselTitle: "Some Other Site" },
      ]),
    ).toEqual({
      // Sites exist but none of them reported occupancy: nobody has answered the question, so the channel does not answer it either.
      padOccupied: null,
      padVesselTitle: null,
    });
  });
});
