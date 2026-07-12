import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { deriveSpaceCenterState } from "./space-center-state";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";

interface LaunchSiteWireEntry {
  padOccupied?: boolean | null;
  padVesselTitle?: string | null;
}

function launchSitesPoint(
  payload: LaunchSiteWireEntry[] | null,
): TimelinePoint<LaunchSiteWireEntry[]> {
  return {
    validAt: 0,
    payload,
    meta: makeMeta({
      validAt: 0,
      quality: Quality.OnRails,
      source: "spaceCenter",
    }),
    epoch: 0,
  };
}

function fakeGet(
  point: TimelinePoint<LaunchSiteWireEntry[]> | undefined,
): DerivedGet {
  return (<T>(topic: string) =>
    topic === "spaceCenter.launchSites"
      ? (point as unknown as TimelinePoint<T> | undefined)
      : undefined) as DerivedGet;
}

describe("deriveSpaceCenterState — pad occupancy off the raw spaceCenter.launchSites array", () => {
  it("undefined while spaceCenter.launchSites hasn't arrived (resyncing) — never throws", () => {
    expect(deriveSpaceCenterState(fakeGet(undefined))).toBeUndefined();
  });

  it("null on a confirmed spaceCenter.launchSites tombstone", () => {
    expect(deriveSpaceCenterState(fakeGet(launchSitesPoint(null)))).toBeNull();
  });

  it("reads as clear for an empty (but present) launch-sites array", () => {
    expect(deriveSpaceCenterState(fakeGet(launchSitesPoint([])))).toEqual({
      padOccupied: false,
      padVesselTitle: null,
    });
  });

  it("propagates padOccupied and padVesselTitle from the stock-pad entry", () => {
    expect(
      deriveSpaceCenterState(
        fakeGet(
          launchSitesPoint([{ padOccupied: true, padVesselTitle: "Kerbal X" }]),
        ),
      ),
    ).toEqual({
      padOccupied: true,
      padVesselTitle: "Kerbal X",
    });
  });

  it("reports padOccupied:false, padVesselTitle:null when no entry carries the stock-pad occupancy flag", () => {
    expect(
      deriveSpaceCenterState(
        fakeGet(
          launchSitesPoint([
            { padOccupied: null, padVesselTitle: null },
            { padOccupied: undefined, padVesselTitle: "Some Other Site" },
          ]),
        ),
      ),
    ).toEqual({
      padOccupied: false,
      padVesselTitle: null,
    });
  });
});
