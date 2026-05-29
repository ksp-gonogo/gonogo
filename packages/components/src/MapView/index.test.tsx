import type { DataKey, OrbitPatch } from "@gonogo/core";
import {
  clearBodies,
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerDataSource,
  registerStockBodies,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { MapViewComponent } from "./index";
import { MapViewConfigComponent } from "./MapViewConfig";

const MAPVIEW_KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.lat" },
  { key: "v.long" },
  { key: "v.body" },
  { key: "v.altitude" },
  { key: "v.dynamicPressure" },
  { key: "v.mach" },
  { key: "v.surfaceSpeed" },
  { key: "v.verticalSpeed" },
  { key: "o.orbitPatches" },
  { key: "o.maneuverNodes" },
  { key: "t.universalTime" },
  { key: "a.physicsMode" },
  { key: "land.predictedLat" },
  { key: "land.predictedLon" },
  { key: "scan.scanningVessels" },
  { key: "scan.anomalies[Kerbin]" },
  { key: "scan.coverage[Kerbin,2]" },
  { key: "scan.coverage[Kerbin,1]" },
  { key: "scan.coverage[Kerbin,8]" },
  { key: "scan.coverage[Kerbin,256]" },
  { key: "scan.coverage[Kerbin,128]" },
];

function kerbinCircularPatch(overrides: Partial<OrbitPatch> = {}): OrbitPatch {
  return {
    startUT: 0,
    endUT: 1_000_000,
    patchStartTransition: "INITIAL",
    patchEndTransition: "FINAL",
    PeA: 100_000,
    ApA: 100_000,
    inclination: 0,
    eccentricity: 0,
    epoch: 0,
    period: 2000,
    argumentOfPeriapsis: 0,
    sma: 700_000,
    lan: 0,
    maae: 0,
    referenceBody: "Kerbin",
    semiLatusRectum: 700_000,
    semiMinorAxis: 700_000,
    closestEncounterBody: null,
    ...overrides,
  };
}

describe("MapViewComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    clearBodies();
    registerStockBodies();

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

    source = new MockDataSource({ keys: MAPVIEW_KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
    vi.unstubAllGlobals();
    clearBodies();
  });

  function primeFlight(): void {
    source.emit("v.name", "Kerbal X");
    source.emit("v.missionTime", 0);
  }

  /** MapView reads DashboardItemContext via useActionInput — wrap in the provider. */
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <DashboardItemContext.Provider value={{ instanceId: "map-test" }}>
        {children}
      </DashboardItemContext.Provider>
    );
  }

  it("renders without crashing with no data", () => {
    const { container } = render(
      <Wrap>
        <MapViewComponent config={{}} id="map-test" />
      </Wrap>,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("renders the N-body chip when physicsMode is n_body", async () => {
    const { findByText } = render(
      <Wrap>
        <MapViewComponent config={{}} id="map-test" />
      </Wrap>,
    );
    act(() => {
      primeFlight();
      source.emit("v.lat", 0);
      source.emit("v.long", 0);
      source.emit("v.body", "Kerbin");
      source.emit("t.universalTime", 0);
      source.emit("o.orbitPatches", [kerbinCircularPatch()]);
      source.emit("a.physicsMode", "n_body");
    });
    const chip = await findByText(/Prediction unavailable/i);
    expect(chip).not.toBeNull();
  });

  it("does NOT render the N-body chip when showPrediction is false", () => {
    const { queryByText } = render(
      <Wrap>
        <MapViewComponent config={{ showPrediction: false }} id="map-test" />
      </Wrap>,
    );
    act(() => {
      primeFlight();
      source.emit("v.body", "Kerbin");
      source.emit("a.physicsMode", "n_body");
    });
    expect(queryByText(/Prediction unavailable/i)).toBeNull();
  });

  it("does NOT render the N-body chip on stock installs (patched_conics)", () => {
    const { queryByText } = render(
      <Wrap>
        <MapViewComponent config={{}} id="map-test" />
      </Wrap>,
    );
    act(() => {
      primeFlight();
      source.emit("v.body", "Kerbin");
      source.emit("a.physicsMode", "patched_conics");
    });
    expect(queryByText(/Prediction unavailable/i)).toBeNull();
  });

  it("renders without crashing with full prediction + impact data", () => {
    const { container } = render(
      <Wrap>
        <MapViewComponent config={{}} id="map-test" />
      </Wrap>,
    );
    act(() => {
      primeFlight();
      source.emit("v.lat", 12.5);
      source.emit("v.long", -70);
      source.emit("v.body", "Kerbin");
      source.emit("t.universalTime", 5_000);
      source.emit("o.orbitPatches", [kerbinCircularPatch()]);
      source.emit("o.maneuverNodes", []);
      source.emit("a.physicsMode", "patched_conics");
      source.emit("land.predictedLat", 13.2);
      source.emit("land.predictedLon", -69.5);
    });
    // 5 canvases: base, overlay, persistent-data, prediction, data.
    expect(container.querySelectorAll("canvas")).toHaveLength(5);
  });

  // ── SCANsat extensions ────────────────────────────────────────────────

  /** Prime a Kerbin-LKO flight + a couple of SCANsat anomalies / vessels. */
  function primeScanScenario(): void {
    primeFlight();
    source.emit("v.lat", 12);
    source.emit("v.long", 35);
    source.emit("v.body", "Kerbin");
    source.emit("v.altitude", 100_000);
    source.emit("t.universalTime", 5_000);
    source.emit("a.physicsMode", "patched_conics");
    source.emit("scan.anomalies[Kerbin]", [
      // Near the vessel (lat 12, lon 35) → smallest distance.
      {
        name: "Near Site",
        latitude: 10,
        longitude: 33,
        known: true,
        detail: true,
      },
      // Far across the planet.
      {
        name: "Far Site",
        latitude: -40,
        longitude: -120,
        known: true,
        detail: true,
      },
      // known=false → excluded from the panel.
      {
        name: "Hidden",
        latitude: 0,
        longitude: 0,
        known: false,
        detail: false,
      },
    ]);
    source.emit("scan.scanningVessels", [
      {
        vesselId: "v1",
        vesselName: "Mapper",
        body: "Kerbin",
        subLatitude: 12,
        subLongitude: 35,
        altitude: 250_000,
        sensors: [
          {
            type: 2,
            fov: 5,
            minAlt: 5000,
            maxAlt: 500_000,
            bestAlt: 250_000,
            inRange: true,
            bestRange: true,
          },
          {
            type: 8,
            fov: 5,
            minAlt: 5000,
            maxAlt: 500_000,
            bestAlt: 250_000,
            inRange: true,
            bestRange: false,
          },
        ],
        groundTrackWidthDeg: 6,
        groundTrackLonHalfDeg: 6.1,
        trackColor: { r: 0, g: 255, b: 200, a: 200 },
      },
    ]);
    source.emit("scan.coverage[Kerbin,2]", 45.6);
    source.emit("scan.coverage[Kerbin,1]", 67.6);
    source.emit("scan.coverage[Kerbin,8]", 29.6);
    source.emit("scan.coverage[Kerbin,256]", 7.4);
    source.emit("scan.coverage[Kerbin,128]", 0);
  }

  it("anomaly panel lists known anomalies sorted by distance with bearing", () => {
    render(
      <Wrap>
        <MapViewComponent
          config={{ showAnomalyPanel: true }}
          id="map-test"
          w={14}
          h={12}
        />
      </Wrap>,
    );
    act(() => {
      primeScanScenario();
    });
    const panel = screen.getByRole("region", { name: /Anomalies near/i });
    const items = within(panel).getAllByRole("listitem");
    // Hidden (known=false) excluded; Near before Far (ascending distance).
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Near Site");
    expect(items[1]).toHaveTextContent("Far Site");
    // Distance + a compass bearing render on the nearest entry.
    expect(items[0]).toHaveTextContent(/km|m/);
    expect(items[0]).toHaveTextContent(/\b\d+°/);
  });

  it("coverage readout shows per-type percentages and live in-range chips", () => {
    render(
      <Wrap>
        <MapViewComponent
          config={{ showCoverage: true }}
          id="map-test"
          w={12}
          h={12}
        />
      </Wrap>,
    );
    act(() => {
      primeScanScenario();
    });
    const panel = screen.getByRole("region", {
      name: /Scan coverage for Kerbin/i,
    });
    expect(within(panel).getByText("46%")).toBeInTheDocument(); // AltHiRes
    expect(within(panel).getByText("68%")).toBeInTheDocument(); // AltLoRes
    expect(within(panel).getByText("30%")).toBeInTheDocument(); // Biome
    // AltHiRes sensor is bestRange → "best"; Biome sensor inRange → "scan".
    expect(within(panel).getByText("best")).toBeInTheDocument();
    expect(within(panel).getAllByText("scan").length).toBeGreaterThan(0);
  });

  it("body override pins the map to another body and suppresses vessel chrome", () => {
    render(
      <Wrap>
        <MapViewComponent
          config={{ bodyOverride: "Mun", showAnomalyPanel: true }}
          id="map-test"
          w={14}
          h={12}
        />
      </Wrap>,
    );
    act(() => {
      primeScanScenario();
    });
    // Label shows the pinned body, not the vessel's Kerbin.
    expect(screen.getByText(/Mun \(pinned\)/)).toBeInTheDocument();
    // Follow toggle is suppressed (vessel isn't on the mapped body).
    expect(screen.queryByLabelText("Follow")).toBeNull();
    // Kerbin's anomaly panel does not appear under a Mun override.
    expect(
      screen.queryByRole("region", { name: /Anomalies near/i }),
    ).toBeNull();
  });

  it("a11y smoke: widget with anomaly + coverage panels has no violations", async () => {
    const { container } = render(
      <Wrap>
        <MapViewComponent
          config={{ showAnomalyPanel: true, showCoverage: true }}
          id="map-test"
          w={14}
          h={14}
        />
      </Wrap>,
    );
    act(() => {
      primeScanScenario();
    });
    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("a11y smoke: config component (body picker + toggles) has no violations", async () => {
    const { container } = render(
      <MapViewConfigComponent config={{}} onSave={() => {}} />,
    );
    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("config body picker offers a Follow-vessel default and stock bodies", () => {
    render(<MapViewConfigComponent config={{}} onSave={() => {}} />);
    const select = screen.getByLabelText("Body") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(within(select).getByText("Follow vessel")).toBeInTheDocument();
    // Stock bodies are registered in beforeEach.
    expect(
      within(select).getByRole("option", { name: "Kerbin" }),
    ).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "Mun" }),
    ).toBeInTheDocument();
  });
});
