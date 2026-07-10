import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * SystemView post-R6 de-Telemachus. The widget's orbit / target / encounter /
 * apsis reads + view-UT now come off the streamed `vessel.*` / `system.bodies`
 * Topics via the canonical `useTelemetry(TopicId)` hook + `useViewUt`, with the
 * derived scalars (trueAnomaly / next-apsis / encounter) reconstructed
 * client-side from `vessel.orbit`'s elements — genuinely running off a real
 * `TelemetryProvider` + `TimelineStore` (`setupStreamFixture`), no legacy
 * `DataSource` leg for any of them.
 *
 * The one thing still on the legacy `MockDataSource("data")` is the shared body
 * fan-out (`useCelestialBodies`/`usePhaseAngles`, also used by TargetPicker /
 * OrbitView) — those hooks subscribe via `getDataSource("data")` directly, not
 * through the shim, so they're their own separate migration. This test feeds the
 * body table + phase angles through that legacy source and everything else
 * through the stream.
 */
const BODY_KEYS: DataKey[] = [
  { key: "b.number" },
  { key: "b.name[0]" },
  { key: "b.name[1]" },
  { key: "b.name[2]" },
  { key: "b.referenceBody[0]" },
  { key: "b.referenceBody[1]" },
  { key: "b.referenceBody[2]" },
  { key: "b.radius[0]" },
  { key: "b.radius[1]" },
  { key: "b.radius[2]" },
  { key: "b.mass[1]" },
  { key: "b.geeASL[1]" },
  { key: "b.rotationPeriod[1]" },
  { key: "b.atmosphere[1]" },
  { key: "b.o.sma[1]" },
  { key: "b.o.sma[2]" },
  { key: "b.o.eccentricity[1]" },
  { key: "b.o.eccentricity[2]" },
  { key: "b.o.phaseAngle[1]" },
  { key: "b.o.phaseAngle[2]" },
];

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

describe("SystemViewComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let fixture: StreamFixture;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: BODY_KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
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
    buffered.disconnect();
  });

  // Body table + phase angles over the legacy source (shared hooks).
  function primeBodies() {
    act(() => {
      source.emit("b.number", 3);
      source.emit("b.name[0]", "Kerbin");
      source.emit("b.name[1]", "Mun");
      source.emit("b.name[2]", "Minmus");
      source.emit("b.referenceBody[1]", "Kerbin");
      source.emit("b.referenceBody[2]", "Kerbin");
      source.emit("b.radius[0]", 600_000);
      source.emit("b.radius[1]", 200_000);
      source.emit("b.radius[2]", 60_000);
      source.emit("b.mass[1]", 9.76e20);
      source.emit("b.geeASL[1]", 0.166);
      source.emit("b.rotationPeriod[1]", 138984);
      source.emit("b.atmosphere[1]", false);
      source.emit("b.o.sma[1]", 12_000_000);
      source.emit("b.o.sma[2]", 47_000_000);
      source.emit("b.o.eccentricity[1]", 0);
      source.emit("b.o.eccentricity[2]", 0);
    });
  }

  // Vessel identity + the stable-index → name table over the stream (drives
  // `v.body` = Kerbin and the encounter-body name resolution).
  function primeStream(orbit?: unknown) {
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 0,
            name: "Kerbin",
            parentIndex: null,
            radius: 600_000,
            orbit: null,
          },
          {
            index: 1,
            name: "Mun",
            parentIndex: 0,
            radius: 200_000,
            orbit: null,
          },
          {
            index: 2,
            name: "Minmus",
            parentIndex: 0,
            radius: 60_000,
            orbit: null,
          },
        ],
      });
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
    primeBodies();
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
    primeBodies();
    primeStream();
    await waitFor(() => expect(screen.getByText("Radius")).toBeInTheDocument());
  });

  it("subscribes to phase angle keys for child bodies of the frame", async () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeBodies();
    primeStream();
    act(() => {
      source.emit("b.o.phaseAngle[1]", 47.2);
      source.emit("b.o.phaseAngle[2]", 12);
    });
    // The numeric phase-angle labels render inside SystemDiagram. They're
    // signed-normalised, so 47.2° survives unchanged.
    await waitFor(() =>
      expect(screen.getAllByText(/47°/).length).toBeGreaterThan(0),
    );
  });

  it("client-propagates the current orbit into a predicted arc from vessel.orbit + view-UT", async () => {
    const { container } = render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeBodies();
    primeStream(encounterOrbit());
    // The single client-reconstructed conic renders as a predicted <path> arc
    // (the post-encounter conic isn't on the wire, so there is exactly one).
    await waitFor(() =>
      expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(
        1,
      ),
    );
  });

  it("surfaces the next encounter body in the subtitle from vessel.orbit.encounter", async () => {
    render(
      <fixture.Provider>
        <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
      </fixture.Provider>,
    );
    primeBodies();
    primeStream(encounterOrbit());
    await waitFor(() =>
      expect(screen.getByText(/next encounter:\s*Mun/i)).toBeInTheDocument(),
    );
  });
});
