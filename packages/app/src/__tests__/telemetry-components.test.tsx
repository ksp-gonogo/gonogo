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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});

afterEach(() => {
  cleanup();
  fake?.buffered.disconnect();
  fake = null;
  clearBodies();
});

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
    const telemetry = await setupTelemetry({ "o.referenceBody": "Kerbin" });
    renderWidget(<CurrentOrbitComponent id="t" />);
    telemetry.seed();
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
  it("renders MAP VIEW heading", () => {
    renderWidget(<MapViewComponent id="t" />);
    expect(screen.getByText("MAP VIEW")).toBeInTheDocument();
  });

  it('shows "Waiting for telemetry" before v.body arrives', () => {
    renderWidget(<MapViewComponent id="t" />);
    expect(screen.getByText("Waiting for telemetry...")).toBeInTheDocument();
  });

  it("shows body name in header once v.body arrives", async () => {
    const telemetry = await setupTelemetry({ "v.body": "Kerbin" });
    renderWidget(<MapViewComponent id="t" />);
    telemetry.seed();
    await waitFor(() => expect(screen.getByText("Kerbin")).toBeInTheDocument());
  });

  it('shows "No position data" when body is known but lat/lon not yet received', async () => {
    const telemetry = await setupTelemetry({ "v.body": "Kerbin" });
    renderWidget(<MapViewComponent id="t" />);
    telemetry.seed();
    await waitFor(() => expect(screen.getByText("Kerbin")).toBeInTheDocument());
    expect(screen.getByText("No position data")).toBeInTheDocument();
  });

  it('hides "No position data" overlay once position arrives', async () => {
    const telemetry = await setupTelemetry({
      "v.body": "Kerbin",
      "v.lat": -0.1,
      "v.long": 285.4,
    });
    renderWidget(<MapViewComponent id="t" />);
    telemetry.seed();
    await waitFor(() =>
      expect(screen.queryByText("No position data")).not.toBeInTheDocument(),
    );
  });
});
