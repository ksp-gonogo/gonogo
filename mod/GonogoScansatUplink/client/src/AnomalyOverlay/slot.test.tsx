import type {} from "@ksp-gonogo/components"; // pulls the "map-view.overlay" SlotRegistry merge into this program
import type { DataKey, SlotProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
// Importing the real module (not a throwaway test double) runs its
// module-load `registerAugment(...)` exactly once — same convention as
// ScienceAugment/slot.test.tsx.
import "./index";

const ANOMALIES = [
  // Near the vessel (lat 12, lon 35) → smallest distance.
  { name: "Near Site", latitude: 10, longitude: 33, known: true, detail: true },
  // Far across the planet.
  {
    name: "Far Site",
    latitude: -40,
    longitude: -120,
    known: true,
    detail: true,
  },
  // known=false → excluded from both markers and the panel.
  { name: "Hidden", latitude: 0, longitude: 0, known: false, detail: false },
];

function overlayProps(
  overrides: Partial<SlotProps<"map-view.overlay">> = {},
): SlotProps<"map-view.overlay"> {
  return {
    width: 600,
    height: 300,
    camera: { zoom: 1, panX: 0, panY: 0 },
    worldW: 720,
    worldH: 360,
    bodyName: "Kerbin",
    bodyRadius: 600_000,
    showAnomalies: true,
    showAnomalyPanel: true,
    vesselLat: 12,
    vesselLon: 35,
    project: (lat: number, lon: number) => ({ x: lon, y: lat }),
    ...overrides,
  };
}

// Rendered trees, tracked so afterEach can unmount them BEFORE disconnecting
// the buffered source. RTL auto-cleanup runs after this file's afterEach, so it
// can't be relied on to unmount first — disconnecting a live source while the
// widget is still mounted fires a status change into it, a state update outside
// act() (the documented anti-pattern in CLAUDE.md).
const renderedTrees: Array<() => void> = [];

function renderSlot(ui: ReactElement) {
  const result = render(ui);
  renderedTrees.push(result.unmount);
  return result;
}

describe("AnomalyOverlay — map-view.overlay slot", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    const keys: DataKey[] = [{ key: "scansat.anomalies.Kerbin" }];
    source = new MockDataSource({ keys });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    buffered.disconnect();
  });

  it("does not render while the scansat domain has not announced availability", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot name="map-view.overlay" props={overlayProps()} />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.anomalies.Kerbin", ANOMALIES);
    });

    expect(
      screen.queryByRole("region", { name: /Anomalies near/i }),
    ).toBeNull();
  });

  it("stays absent when the scansat domain is unavailable but other augments would render", () => {
    // No TelemetryProvider at all — the app-realistic case of a KSP install
    // with no SCANsat mod present: scansat.available never arrives, so the
    // presence gate's `available` stays permanently undefined.
    renderSlot(<AugmentSlot name="map-view.overlay" props={overlayProps()} />);
    act(() => {
      source.emit("scansat.anomalies.Kerbin", ANOMALIES);
    });

    expect(
      screen.queryByRole("region", { name: /Anomalies near/i }),
    ).toBeNull();
  });

  it("renders the anomaly panel sorted by distance once the domain is live", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot name="map-view.overlay" props={overlayProps()} />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.anomalies.Kerbin", ANOMALIES);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    const panel = await screen.findByRole("region", {
      name: /Anomalies near Kerbin/i,
    });
    const items = within(panel).getAllByRole("listitem");
    // Hidden (known=false) excluded; Near before Far (ascending distance).
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Near Site");
    expect(items[1]).toHaveTextContent("Far Site");
    expect(items[0]).toHaveTextContent(/km|m/);
    expect(items[0]).toHaveTextContent(/\b\d+°/);
  });

  it("renders markers but no panel when showAnomalyPanel is false", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const { container } = renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot
          name="map-view.overlay"
          props={overlayProps({ showAnomalyPanel: false })}
        />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.anomalies.Kerbin", ANOMALIES);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    // Two known anomalies → two marker divs. aria-hidden markers aren't
    // exposed to role queries, so assert on the DOM directly.
    await waitFor(() => {
      expect(container.querySelectorAll("div[aria-hidden='true']").length).toBe(
        2,
      );
    });
    expect(
      screen.queryByRole("region", { name: /Anomalies near/i }),
    ).toBeNull();
  });

  it("renders nothing when both showAnomalies and showAnomalyPanel are false (no fetch either)", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const { container } = renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot
          name="map-view.overlay"
          props={overlayProps({
            showAnomalies: false,
            showAnomalyPanel: false,
          })}
        />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.anomalies.Kerbin", ANOMALIES);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    expect(container.querySelectorAll("div[aria-hidden='true']").length).toBe(
      0,
    );
    expect(
      screen.queryByRole("region", { name: /Anomalies near/i }),
    ).toBeNull();
  });

  it("falls back to name-only ranking when the vessel position is unknown (bodyOverride diverges)", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot
          name="map-view.overlay"
          props={overlayProps({ vesselLat: undefined, vesselLon: undefined })}
        />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.anomalies.Kerbin", ANOMALIES);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    const panel = await screen.findByRole("region", {
      name: /Anomalies near Kerbin/i,
    });
    const items = within(panel).getAllByRole("listitem");
    // Sorted by name (Far before Near) when distance can't be computed.
    expect(items[0]).toHaveTextContent("Far Site");
    expect(items[1]).toHaveTextContent("Near Site");
  });

  it("passes an a11y smoke with markers + panel rendered", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const { container } = renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot name="map-view.overlay" props={overlayProps()} />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.anomalies.Kerbin", ANOMALIES);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await screen.findByRole("region", { name: /Anomalies near Kerbin/i });

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
