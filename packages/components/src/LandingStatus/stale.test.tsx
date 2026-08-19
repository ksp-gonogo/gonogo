import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

/**
 * What LandingStatus does when the telemetry the burn solve rests on is no longer
 * current.
 *
 * SUPERSEDED once, and the correction is the interesting part. The first version of
 * this file asserted that the whole board suspended. That was wrong for the reason
 * the case itself makes obvious: losing contact mid-descent is the EXPECTED case, and
 * a blank board during a descent nobody is tracking is the worst available answer.
 *
 * The rule now splits by what the operator DOES with a number, not by which field it
 * came from. A DESCRIPTION renders from the best value available and says it is
 * dated; an INSTRUCTION does not render from a reckoned state at all.
 *
 * The old decision, for the record: it stopped solving entirely. A suicide-burn countdown names an instant a few
 * seconds away, computed from a position, a velocity and a thrust. Recomputed from
 * readings taken some seconds ago it still counts down, still looks live, and
 * names the wrong instant. An operator would burn on it. There is no honest way to
 * caption that, unlike a dated altitude readout, because the number IS the
 * instruction.
 *
 * The second assertion in each case is the one that earns the file: an empty board
 * is the widget's own "No landing in progress" state, which is a reassuring
 * statement about a vessel in orbit. Suspended and not-descending have to be
 * distinguishable from outside the component, or the failure mode is a calm board
 * during a descent nobody is tracking.
 */

const CARRIED = [
  "vessel.state",
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
    stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
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
    // The control. Without it every assertion below would also pass on a widget
    // that never solves at all.
    const { container } = renderWidget();
    emitDescent();
    await waitFor(() => {
      expect(visibleText(container)).not.toContain("No landing in progress");
    });
    expect(visibleText(container)).not.toContain("Descent solve suspended");
  });

  it("keeps describing the board, and SAYS which reading is no longer current", async () => {
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
      expect(visibleText(container)).toContain("Described from last known");
    });
    // Named, not merely captioned. Which reading went is the operator's first
    // question and the widget already knows the answer.
    expect(visibleText(container)).toContain("flight");
    // And the board is still THERE: the descent picture is the thing that stays.
    expect(visibleText(container)).not.toContain("No landing in progress");
  });

  it("does not present the described board as a vessel with no descent", async () => {
    // The distinction this file exists for. "No landing in progress" is what a
    // vessel in orbit shows, and reaching it from stale telemetry would report a
    // calm sky during an untracked descent.
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
      expect(visibleText(container)).toContain("Described from last known"),
    );
    expect(visibleText(container)).not.toContain("No landing in progress");
  });

  it("refuses the INSTRUCTION while still describing everything around it", async () => {
    // The hero is the instruction. A countdown recomputed from a stale position
    // is not a stale number, it is a wrong one, so nothing in the suspended board
    // may present an ignition clock.
    const { container } = renderWidget();
    emitDescent();
    await waitFor(() =>
      expect(visibleText(container)).not.toContain("No landing in progress"),
    );

    act(() => {
      stream.store.setTransportConnected(false);
      stream.store.beginFrame();
    });

    // "NEEDS A LINK" rather than "NEEDS CURRENT TELEMETRY", and that is the arms
    // working: this fixture drops the whole transport, so the link itself is the
    // more specific answer and the operator can act on it. The currency wording is
    // for a link that is delivering while these particular readings are not.
    await waitFor(() =>
      expect(visibleText(container)).toContain("BURN TIMING NEEDS A LINK"),
    );
    // The hero is the one number an operator acts on at a named moment, so it is
    // the one number withheld. A modelled ignition instant is not a dated reading,
    // it is a wrong instruction.
    expect(visibleText(container)).not.toContain("SUICIDE BURN");
    expect(visibleText(container)).not.toContain("IGNITE");
  });

  it("says nothing about dated readings before anything has ever arrived", async () => {
    // A cold start is not a dated board. "Described from last known" is a lie when
    // nothing has ever arrived, and conflating the two would accuse the link of
    // dropping on first paint.
    const { container } = renderWidget();
    await waitFor(() => {
      expect(visibleText(container)).not.toContain("Described from last known");
    });
  });
});
