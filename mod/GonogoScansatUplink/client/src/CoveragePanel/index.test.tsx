import type {} from "@ksp-gonogo/components"; // pulls the "map-view.sections" SlotRegistry merge into this program
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
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
// Importing the real module (not a throwaway test double) runs its
// module-load `registerAugment(...)` exactly once — same convention as
// FootprintOverlay/index.test.tsx and AnomalyOverlay/slot.test.tsx.
import "./index";
import type { SCANScanningVessel } from "../schema";

function vessel(over: Partial<SCANScanningVessel>): SCANScanningVessel {
  return {
    vesselId: "v1",
    vesselName: "Mapper",
    body: "Kerbin",
    subLatitude: 12,
    subLongitude: 35,
    altitude: 250_000,
    sensors: [
      {
        type: 2, // AltimetryHiRes
        fov: 5,
        minAlt: 5000,
        maxAlt: 500_000,
        bestAlt: 250_000,
        inRange: true,
        bestRange: true,
      },
      {
        type: 8, // Biome
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
    ...over,
  };
}

function sectionsProps(
  overrides: Partial<SlotProps<"map-view.sections">> = {},
): SlotProps<"map-view.sections"> {
  return {
    bodyName: "Kerbin",
    augmentSettings: undefined,
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

describe("CoveragePanel — map-view.sections slot", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    const keys: DataKey[] = [
      { key: "scansat.scanningVessels" },
      { key: "scansat.coverage.Kerbin.2" },
      { key: "scansat.coverage.Kerbin.1" },
      { key: "scansat.coverage.Kerbin.8" },
      { key: "scansat.coverage.Kerbin.256" },
      { key: "scansat.coverage.Kerbin.128" },
    ];
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
        <AugmentSlot name="map-view.sections" props={sectionsProps()} />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.coverage.Kerbin.2", 45.6);
    });

    expect(
      screen.queryByRole("region", { name: /Scan coverage for Kerbin/i }),
    ).toBeNull();
  });

  it("stays absent when the scansat domain is unavailable but no provider is mounted", () => {
    // No TelemetryProvider at all — the app-realistic case of a KSP install
    // with no SCANsat mod present: scansat.available never arrives.
    renderSlot(
      <AugmentSlot name="map-view.sections" props={sectionsProps()} />,
    );
    act(() => {
      source.emit("scansat.coverage.Kerbin.2", 45.6);
    });

    expect(
      screen.queryByRole("region", { name: /Scan coverage for Kerbin/i }),
    ).toBeNull();
  });

  it("renders per-type coverage percentages and live in-range chips once the domain is live", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot name="map-view.sections" props={sectionsProps()} />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.scanningVessels", [vessel({})]);
      source.emit("scansat.coverage.Kerbin.2", 45.6);
      source.emit("scansat.coverage.Kerbin.1", 67.6);
      source.emit("scansat.coverage.Kerbin.8", 29.6);
      source.emit("scansat.coverage.Kerbin.256", 7.4);
      source.emit("scansat.coverage.Kerbin.128", 0);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    const panel = await screen.findByRole("region", {
      name: /Scan coverage for Kerbin/i,
    });
    expect(within(panel).getByText("46%")).toBeInTheDocument(); // AltHiRes
    expect(within(panel).getByText("68%")).toBeInTheDocument(); // AltLoRes
    expect(within(panel).getByText("30%")).toBeInTheDocument(); // Biome
    // AltHiRes sensor is bestRange → "best"; Biome sensor inRange → "scan".
    expect(within(panel).getByText("best")).toBeInTheDocument();
    expect(within(panel).getAllByText("scan").length).toBeGreaterThan(0);
  });

  it("excludes scanning vessels on a different body from the in-range chips", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot name="map-view.sections" props={sectionsProps()} />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.scanningVessels", [vessel({ body: "Mun" })]);
      source.emit("scansat.coverage.Kerbin.2", 12);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    const panel = await screen.findByRole("region", {
      name: /Scan coverage for Kerbin/i,
    });
    await waitFor(() => {
      expect(within(panel).getByText("12%")).toBeInTheDocument();
    });
    expect(within(panel).queryByText("best")).toBeNull();
  });

  it("does not render when no body is mapped", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot
          name="map-view.sections"
          props={sectionsProps({ bodyName: undefined })}
        />
      </TelemetryProvider>,
    );
    act(() => {
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    expect(screen.queryByRole("region")).toBeNull();
  });

  it("passes an a11y smoke with the coverage panel rendered", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const { container } = renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot name="map-view.sections" props={sectionsProps()} />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.scanningVessels", [vessel({})]);
      source.emit("scansat.coverage.Kerbin.2", 45.6);
      source.emit("scansat.coverage.Kerbin.1", 67.6);
      source.emit("scansat.coverage.Kerbin.8", 29.6);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await screen.findByRole("region", { name: /Scan coverage for Kerbin/i });

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
