import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

/**
 * LandingStatus genuinely running OFF THE STREAM (a real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`) — no legacy
 * `DataSource` is registered anywhere in this file, so a value only reaches the
 * widget if it actually streamed.
 *
 * The rebooted widget runs a FULL-VECTOR suicide-burn solve client-side off the
 * streamed `vessel.flight` / `vessel.propulsion` / `vessel.orbit` channels plus
 * the static stock-body radius (`getBody`), with NO derived `vessel.state.
 * landing*` fields involved. This file proves the whole chain — subscription,
 * carried-channel promotion, derived `vessel.state` body resolution, and the
 * DOM render — works end to end on a real Mun descent, with the horizontal
 * component (the correctness fix) surfaced.
 *
 * `carriedChannels` mirrors `index.test.tsx`'s superset: the carried gate is
 * parent-channel-scoped, and `vessel.orbit` is emitted `{ quality:
 * Quality.Loaded }` so the MEASURED basis is live.
 */
const CARRIED = [
  "vessel.state",
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.propulsion",
  "vessel.surface",
  "dv.summary",
  "comms.delay",
];

const MUN = { index: 3, name: "Mun", radius: 200_000, mu: 6.5138398e10 };

describe("LandingStatus — full-vector solve genuinely runs off the stream", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    registerStockBodies();
    stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "landing-stream" }}>
          <LandingStatusComponent id="landing-stream" w={8} h={10} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  function emitMunDescent() {
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
      situation: 0,
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
    // h=5km, descending 50 m/s but carrying 540 m/s of (mostly horizontal)
    // surface speed — the whole point of the full-vector solve.
    stream.emit("vessel.flight", {
      latitude: 0,
      longitude: 0,
      altitudeAsl: 0,
      altitudeTerrain: 5000,
      verticalSpeed: -50,
      surfaceSpeed: 540,
      orbitalSpeed: 540,
      atmDensity: 0,
    });
    // aMax = availableThrust/totalMass = 20 m/s^2.
    stream.emit("vessel.propulsion", {
      totalMass: 1,
      dryMass: 0.5,
      currentThrust: 0,
      availableThrust: 20,
    });
  }

  it("renders the Mun descent board off the derived vessel.state + streamed flight/propulsion", async () => {
    const { container } = renderWidget();

    // Nothing arrived yet — the empty state shows.
    expect(container.textContent).toContain("No landing in progress");
    // A real subscription must have happened for StubTransport (which is
    // subscription-gated) to deliver at all.
    expect(stream.transport.isSubscribed("vessel.flight")).toBe(true);

    act(() => {
      emitMunDescent();
    });

    // The velocity split — vertical AND horizontal — renders off the stream.
    expect(await screen.findByText("Vertical")).toBeInTheDocument();
    expect(screen.getByText("Horizontal")).toBeInTheDocument();
    // The horizontal component the old vertical-only model ignored (≈538 m/s).
    expect(screen.getByText(/538 m\/s/)).toBeInTheDocument();
    // The Height section surfaces the streamed AGL datum (5.00 km).
    expect(screen.getByText("AGL")).toBeInTheDocument();
    expect(screen.getByText(/5\.00 km/)).toBeInTheDocument();
    // The subtitle resolves the body off the derived vessel.state channel.
    expect(screen.getByText(/mun · vacuum/i)).toBeInTheDocument();
    // Empty state is gone once the descent is streaming.
    expect(container.textContent).not.toContain("No landing in progress");
  });
});
