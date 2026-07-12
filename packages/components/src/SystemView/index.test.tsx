import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * SystemView reads entirely off the stream. The body table
 * (`useCelestialBodies`) now rides the mod's `system.bodies` Topic — the old
 * Telemachus `b.*[i]` fan-out via `getDataSource("data")` is gone — and the
 * orbit / target / encounter / apsis scalars + view-UT come off the streamed
 * `vessel.*` Topics via `useTelemetry` / `useViewUt`, all through a real
 * `TelemetryProvider` + `TimelineStore` (`setupStreamFixture`).
 */

// Kerbin's GM — makes the client-side period / true-anomaly derivation land on
// real numbers so the predicted arc actually renders.
const KERBIN_MU = 3.5316e12;

// A Kerbin parking orbit that encounters the Mun (stable body index 1). `epoch`
// == the pinned view-UT so the derivation reads a clean mean-anomaly-at-epoch.
function encounterOrbit() {
  return {
    referenceBodyIndex: 0,
    sma: 8_000_000,
    ecc: 0.4,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 100,
    mu: KERBIN_MU,
    encounter: { transitionType: 2, transitionUt: 600, bodyIndex: 1 },
  };
}

// The Kerbin system as it lands off `system.bodies`: Kerbin as the frame root
// (orbit null) with its GM so children get a parent μ for period/true-anomaly
// derivation, plus Mun and Minmus with full orbits + almanac fields.
function kerbinSystem() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbin",
        parentIndex: null,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        sphereOfInfluence: 84_159_286,
        rotationPeriod: 21_549.425,
        hasOcean: true,
        atmosphere: {
          depth: 70_000,
          hasOxygen: true,
          seaLevelPressure: 101.325,
        },
        orbit: null,
      },
      {
        index: 1,
        name: "Mun",
        parentIndex: 0,
        radius: 200_000,
        gravParameter: 6.5138398e10,
        rotationPeriod: 138_984.38,
        tidallyLocked: true,
        hasOcean: false,
        atmosphere: null,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 100,
        },
      },
      {
        index: 2,
        name: "Minmus",
        parentIndex: 0,
        radius: 60_000,
        gravParameter: 1.7658e9,
        hasOcean: false,
        atmosphere: null,
        orbit: {
          sma: 47_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 100,
        },
      },
    ],
  };
}

describe("SystemViewComponent", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.identity",
        "vessel.target",
        "system.bodies",
      ],
      pinnedUt: 100,
    });
  });

  afterEach(() => {
    cleanup();
  });

  // Body tree + vessel identity + orbit — everything off the stream.
  function primeStream(orbit?: unknown) {
    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
      if (orbit !== undefined) fixture.emit("vessel.orbit", orbit);
    });
  }

  it("waits for body data before rendering anything", () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{}} id="sv" />
      </fixture.Provider>,
    );
    expect(screen.getByText(/Waiting for body data/i)).toBeInTheDocument();
  });

  it("renders the almanac panel for the vessel's body when nothing is hovered", async () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{}} id="sv" />
      </fixture.Provider>,
    );
    primeStream();
    // "Kerbin" appears in both the SVG parent label and the almanac title —
    // both confirm the panel landed on the vessel's body (v.body, resolved off
    // vessel.identity.parentBodyIndex + system.bodies).
    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThanOrEqual(2),
    );
  });

  it("renders almanac fields when they're available", async () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream();
    await waitFor(() => expect(screen.getByText("Radius")).toBeInTheDocument());
  });

  it("renders the child bodies of the frame in the diagram", async () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream();
    // Mun + Minmus are Kerbin's children (parentIndex 0), drawn in the diagram.
    await waitFor(() =>
      expect(screen.getAllByText("Minmus").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Mun").length).toBeGreaterThan(0);
  });

  it("client-propagates the current orbit into a predicted arc from vessel.orbit + view-UT", async () => {
    const { container } = render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream(encounterOrbit());
    // The single client-reconstructed conic renders as a predicted <path> arc
    // (the post-encounter conic isn't on the wire, so there is exactly one).
    await waitFor(() =>
      expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(
        1,
      ),
    );
  });

  it("renders without crashing on a hyperbolic (escape) orbit", async () => {
    // ecc >= 1 makes the client-side Kepler solver (`solveAnomalies`) throw a
    // RangeError — a routine state for a system-wide diagram during an
    // interplanetary escape/flyby. The derivation must degrade the orbital
    // scalars to null instead of crashing the widget mid-render (no error
    // boundary inside it).
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream({
      referenceBodyIndex: 0,
      sma: -8_000_000, // negative sma — a hyperbolic conic
      ecc: 1.3,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 100,
      mu: KERBIN_MU,
      encounter: { transitionType: 3, transitionUt: 600, bodyIndex: 1 },
    });
    // Frame label still lands (widget rendered, didn't throw). The escape is
    // surfaced from the raw `vessel.orbit.encounter` scalar, not the thrown
    // derivation.
    await waitFor(() =>
      expect(screen.getByText(/next escape:\s*Mun/i)).toBeInTheDocument(),
    );
  });

  it("surfaces the next encounter body in the subtitle from vessel.orbit.encounter", async () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeStream(encounterOrbit());
    await waitFor(() =>
      expect(screen.getByText(/next encounter:\s*Mun/i)).toBeInTheDocument(),
    );
  });
});
