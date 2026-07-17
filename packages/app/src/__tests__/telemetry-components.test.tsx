/**
 * Smoke tests for telemetry visualisation components:
 * CurrentOrbit, DistanceToTarget, OrbitView, MapView.
 *
 * These are integration tests: real data source, real hooks, real components —
 * only the network is intercepted by MSW.
 */

import {
  CurrentOrbitComponent,
  DistanceToTargetComponent,
  MapViewComponent,
  OrbitViewComponent,
} from "@ksp-gonogo/components";
import {
  clearBodies,
  clearRegistry,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FakeTelemachusHandle,
  setupFakeTelemachus,
} from "./fixtures/fakeTelemachus";

function renderWidget(tree: ReactElement, instanceId = "t") {
  return render(
    <DashboardItemContext.Provider value={{ instanceId }}>
      {tree}
    </DashboardItemContext.Provider>,
  );
}

let fake: FakeTelemachusHandle | null = null;

beforeEach(() => {
  clearRegistry();
  registerStockBodies();

  // MapView's `useMapResize` constructs a `ResizeObserver` on mount; jsdom
  // has no implementation. Stub the same fixed-size fake the widget's own
  // `MapView/index.test.tsx` uses so the full-map render path can measure.
  vi.stubGlobal(
    "ResizeObserver",
    class FakeResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(_el: Element) {
        this.cb(
          [
            {
              contentRect: { width: 600, height: 300 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  fake?.buffered.disconnect();
  fake = null;
  clearBodies();
  vi.unstubAllGlobals();
});

// The eight `vesselStateChannel` inputs — carrying all of them makes every
// derived `vessel.state.*` field (here: `parentBodyName`) resolvable. Mirrors
// the allowlist in MapView's own `stream.test.tsx`.
const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

// ---------------------------------------------------------------------------
// Helper: exercise the LEGACY `useDataValue("data", key)` shim branch (no
// `TelemetryProvider` mounted) via a `MockDataSource`-backed fake instead of
// a real Telemachus WS round trip. `seed()` must be called AFTER the widget
// renders/subscribes — see `fixtures/fakeTelemachus.ts`.
// ---------------------------------------------------------------------------
async function setupTelemetry(
  snapshot: Record<string, unknown>,
): Promise<FakeTelemachusHandle> {
  fake = await setupFakeTelemachus(snapshot);
  return fake;
}

// ---------------------------------------------------------------------------
// Helper: mount a real TelemetryProvider (TelemetryClient + TimelineStore
// over a StubTransport) for widgets that read via the canonical `useTelemetry`
// stream path post-P1 de-Telemachus migration. Mirrors
// `packages/components/src/test/setupStreamFixture.tsx` (the pattern used by
// DistanceToTarget's and OrbitView's own dedicated stream tests) — duplicated
// here in miniature rather than imported, since `@ksp-gonogo/components`'s test
// helpers aren't part of its published surface.
// ---------------------------------------------------------------------------
function setupTelemetryStream(carriedChannels: Iterable<string>) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  store.registerDerivedChannel(vesselStateChannel);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={carriedChannels}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return {
    emit: (topic: string, payload: unknown) => transport.emit(topic, payload),
    Provider,
  };
}

// ---------------------------------------------------------------------------
// CurrentOrbit
// ---------------------------------------------------------------------------
describe("CurrentOrbitComponent", () => {
  it("renders ORBIT heading", () => {
    renderWidget(<CurrentOrbitComponent id="t" />);
    expect(screen.getByText("ORBIT")).toBeInTheDocument();
  });

  it("shows dashes before data arrives", () => {
    renderWidget(<CurrentOrbitComponent id="t" />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("shows apoapsis value when data arrives", async () => {
    const telemetry = await setupTelemetry({
      "o.ApA": 250_000,
      "o.PeA": 80_000,
      "o.eccentricity": 0.1,
    });
    renderWidget(<CurrentOrbitComponent id="t" />);
    telemetry.seed();
    // formatDistance(250_000) = '250.0 km'
    await waitFor(() =>
      expect(screen.getByText("250.0 km")).toBeInTheDocument(),
    );
  });

  it("shows reference body when provided", async () => {
    // P1 de-Telemachus: the subtitle reads the derived
    // `vessel.state.referenceBodyName` now (the mapped home of the legacy
    // `o.referenceBody` scalar), which `deriveVesselState` resolves from
    // `vessel.orbit.referenceBodyIndex` against `system.bodies` — so feed the
    // derivation those two inputs rather than the retired flat key.
    const stream = setupTelemetryStream(VESSEL_STATE_INPUTS);
    renderWidget(
      <stream.Provider>
        <CurrentOrbitComponent id="t" />
      </stream.Provider>,
    );
    act(() => {
      stream.emit("vessel.orbit", { referenceBodyIndex: 1 });
      stream.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
    });
    await waitFor(() => expect(screen.getByText("Kerbin")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// DistanceToTarget
// ---------------------------------------------------------------------------
describe("DistanceToTargetComponent", () => {
  it('shows "No target set in KSP" when tar.name is not yet received', () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    expect(screen.getByText("No target set in KSP")).toBeInTheDocument();
  });

  it("shows target name and distance when telemetry arrives", async () => {
    // P1 de-Telemachus: the widget no longer reads a legacy `tar.distance`
    // scalar — it derives distance client-side from the `vessel.target` Vec3
    // `relativePosition` (see DistanceToTarget's own `stream.test.tsx`).
    // `tar.name` maps to `vessel.target.name`, a raw-field subtopic of the
    // same carried record, so it rides the stream too — no legacy "data"
    // WS emission needed for this case.
    const stream = setupTelemetryStream(["vessel.target"]);
    render(
      <stream.Provider>
        <DistanceToTargetComponent config={{}} id="tar" />
      </stream.Provider>,
    );
    act(() => {
      // Magnitude of (12_000_000, 0, 0) = 12_000_000 m.
      stream.emit("vessel.target", {
        name: "Mun",
        kind: 1,
        vesselId: null,
        bodyIndex: 2,
        relativePosition: { x: 12_000_000, y: 0, z: 0 },
        relativeVelocity: { x: 0, y: 0, z: 0 },
      });
    });
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
    // formatDistance(12_000_000) = '12.00 Mm'
    await waitFor(() =>
      expect(screen.getByText("12.00 Mm")).toBeInTheDocument(),
    );
  });

  it("shows target name with dash when distance is unavailable", async () => {
    const telemetry = await setupTelemetry({ "tar.name": "Duna" });
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    telemetry.seed();
    await waitFor(() => expect(screen.getByText("Duna")).toBeInTheDocument());
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// OrbitView
// ---------------------------------------------------------------------------
describe("OrbitViewComponent", () => {
  it("renders ORBIT VIEW heading", () => {
    renderWidget(<OrbitViewComponent id="t" />);
    expect(screen.getByText("ORBIT VIEW")).toBeInTheDocument();
  });

  it('shows "No orbital data" before any values arrive', () => {
    renderWidget(<OrbitViewComponent id="t" />);
    expect(screen.getByText("No orbital data")).toBeInTheDocument();
  });

  it("renders SVG diagram when orbital data arrives", async () => {
    // P1 de-Telemachus: OrbitView reads exclusively off the canonical
    // `useTelemetry("vessel.orbit")` stream overload now — no legacy
    // DataSource fallback (see OrbitView's own `stream.test.tsx`). Apoapsis/
    // periapsis radii are derived in-widget from `sma`/`ecc`, so emitting
    // just those two (plus `argPe`) is enough to satisfy `hasOrbit`.
    const stream = setupTelemetryStream(["vessel.orbit"]);
    renderWidget(
      <stream.Provider>
        <OrbitViewComponent id="t" />
      </stream.Provider>,
    );
    act(() => {
      stream.emit("vessel.orbit", {
        sma: 700_000,
        ecc: 0.1,
        argPe: 0,
      });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: /orbital diagram/i }),
      ).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// MapView
// ---------------------------------------------------------------------------
describe("MapViewComponent", () => {
  // P1 de-Telemachus: MapView reads position off the canonical stream now —
  // `vessel.flight.latitude`/`.longitude` for lat/lon, and the derived
  // `vessel.state.parentBodyName` (index→name resolved against `system.bodies`)
  // for the header body label — not the old `v.body`/`v.lat`/`v.long` keys.
  // The body-name derivation gates on `vessel.orbit` (whole-record input) plus
  // `vessel.identity.parentBodyIndex` + `system.bodies`.
  function emitKerbin(stream: ReturnType<typeof setupTelemetryStream>) {
    stream.emit("vessel.orbit", {});
    stream.emit("vessel.identity", { parentBodyIndex: 1, launchUt: null });
    stream.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
  }

  it("renders MAP VIEW heading", () => {
    renderWidget(<MapViewComponent id="t" />);
    expect(screen.getByText("MAP VIEW")).toBeInTheDocument();
  });

  it('shows "Waiting for telemetry" before a body arrives', () => {
    renderWidget(<MapViewComponent id="t" />);
    expect(screen.getByText("Waiting for telemetry...")).toBeInTheDocument();
  });

  it("shows body name in header once vessel state arrives", async () => {
    const stream = setupTelemetryStream(VESSEL_STATE_INPUTS);
    renderWidget(
      <stream.Provider>
        <MapViewComponent id="t" />
      </stream.Provider>,
    );
    act(() => emitKerbin(stream));
    await waitFor(() => expect(screen.getByText("Kerbin")).toBeInTheDocument());
  });

  it('shows "No position data" when body is known but lat/lon not yet received', async () => {
    const stream = setupTelemetryStream(VESSEL_STATE_INPUTS);
    renderWidget(
      <stream.Provider>
        <MapViewComponent id="t" />
      </stream.Provider>,
    );
    act(() => emitKerbin(stream));
    await waitFor(() => expect(screen.getByText("Kerbin")).toBeInTheDocument());
    expect(screen.getByText("No position data")).toBeInTheDocument();
  });

  it('hides "No position data" overlay once position arrives', async () => {
    const stream = setupTelemetryStream(VESSEL_STATE_INPUTS);
    renderWidget(
      <stream.Provider>
        <MapViewComponent id="t" />
      </stream.Provider>,
    );
    act(() => {
      emitKerbin(stream);
      stream.emit("vessel.flight", { latitude: -0.1, longitude: 285.4 });
    });
    await waitFor(() =>
      expect(screen.queryByText("No position data")).not.toBeInTheDocument(),
    );
  });
});
