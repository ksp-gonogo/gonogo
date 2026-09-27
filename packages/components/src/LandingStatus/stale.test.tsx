import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

/**
 * What LandingStatus does when the telemetry the burn solve rests on is no longer current.
 *
 * A DESCRIPTION renders from the best value available and says it is dated; an INSTRUCTION never renders from a reckoned state, since a countdown recomputed from old readings still looks live and names the wrong instant. Each case also proves the board is not the reassuring "No landing in progress" state, which would be a calm board during an untracked descent.
 */

const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.target",
  "vessel.propulsion",
  "vessel.surface",
  "vessel.landing",
  "dv.summary",
  "dv.stages",
  "vessel.structure",
  "comms.delay",
];

const MUN = { index: 3, name: "Mun", radius: 200_000, mu: 6.5138398e10 };

describe("LandingStatus when the solve inputs are not current", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    registerStockBodies();
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "land-stale" }}>
          <LandingStatusComponent id="land-stale" w={8} h={12} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  /** A viable Mun descent: 5 km AGL, 50 m/s down, thrust to spare. */
  function emitDescent(): void {
    act(() => {
      stream.emit("system.bodies", {
        bodies: [
          {
            name: MUN.name,
            index: MUN.index,
            parentIndex: 0,
            radius: MUN.radius,
            orbit: null,
          },
        ],
      });
      stream.emit("vessel.identity", {
        vesselId: "test-vessel",
        name: "Test Vessel",
        vesselType: 0,
        situation: 6,
        parentBodyIndex: MUN.index,
        launchUt: null,
      });
      stream.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: MUN.index,
          sma: 250_000,
          ecc: 0.01,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 10,
          mu: MUN.mu,
        },
        { quality: Quality.Loaded },
      );
      stream.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: 0,
        altitudeTerrain: 5000,
        verticalSpeed: -50,
        surfaceSpeed: 60,
        orbitalSpeed: 60,
        atmDensity: 0,
      });
      stream.emit("vessel.propulsion", {
        totalMass: 5,
        dryMass: 3,
        currentThrust: 0,
        availableThrust: 60,
      });
    });
  }

  it("solves the descent while its inputs are current", async () => {
    // The control: without it every assertion below would pass on a widget that never solves.
    const { container } = renderWidget();
    emitDescent();
    await waitFor(() => {
      expect(visibleText(container)).not.toContain("No landing in progress");
    });
    expect(visibleText(container)).not.toContain("Descent solve suspended");
  });

  it("keeps describing the board, its held figures marked by their own Units and no caption beside them", async () => {
    const { container } = renderWidget();
    emitDescent();
    await waitFor(() =>
      expect(visibleText(container)).not.toContain("No landing in progress"),
    );

    act(() => {
      stream.store.setTransportConnected(false);
      stream.store.beginFrame();
    });

    await waitFor(() => {
      expect(container.querySelector("[data-held-mark]")).not.toBeNull();
    });
    expect(visibleText(container)).not.toContain("Described from last known");
    // And the descent picture stays.
    expect(visibleText(container)).not.toContain("No landing in progress");
  });

  it("does not present the described board as a vessel with no descent", async () => {
    // Reaching "No landing in progress" from stale telemetry would report a calm sky during an untracked descent.
    const { container } = renderWidget();
    emitDescent();
    await waitFor(() =>
      expect(visibleText(container)).not.toContain("No landing in progress"),
    );

    act(() => {
      stream.store.setTransportConnected(false);
      stream.store.beginFrame();
    });

    await waitFor(() =>
      expect(container.querySelector("[data-held-mark]")).not.toBeNull(),
    );
    expect(visibleText(container)).not.toContain("No landing in progress");
  });

  it("refuses the INSTRUCTION while still describing everything around it", async () => {
    // A countdown recomputed from a stale position is wrong, not stale, so no ignition clock may show.
    const { container } = renderWidget();
    emitDescent();
    await waitFor(() =>
      expect(visibleText(container)).not.toContain("No landing in progress"),
    );

    act(() => {
      stream.store.setTransportConnected(false);
      stream.store.beginFrame();
    });

    // The whole transport is dropped, so "needs a link" is the more specific answer than the currency wording.
    await waitFor(() =>
      expect(visibleText(container)).toContain("BURN TIMING NEEDS A LINK"),
    );
    expect(visibleText(container)).not.toContain("SUICIDE BURN");
    expect(visibleText(container)).not.toContain("IGNITE");
  });

  it("marks nothing held before anything has ever arrived", async () => {
    const { container } = renderWidget();
    await waitFor(() => {
      expect(container.querySelector("[data-held-mark]")).toBeNull();
    });
  });
});
