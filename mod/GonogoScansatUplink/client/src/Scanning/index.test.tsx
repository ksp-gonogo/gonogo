import type { DataKey } from "@ksp-gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { ScanningComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "scansat.available" },
  { key: "scansat.scanningVessels" },
  { key: "v.body" },
  { key: "v.lat" },
  { key: "v.long" },
  // Coverage bars — DISPLAY_SCAN_TYPES: AltimetryHiRes=2, AltimetryLoRes=1, Biome=8, Anomaly=16, ResourceHiRes=256
  { key: "scansat.coverage.Kerbin.2" },
  { key: "scansat.coverage.Kerbin.1" },
  { key: "scansat.coverage.Kerbin.8" },
  { key: "scansat.coverage.Kerbin.16" },
  { key: "scansat.coverage.Kerbin.256" },
  // Anomaly list
  { key: "scansat.anomalies.Kerbin" },
];

describe("ScanningComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    registerStockBodies();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
  });

  it("shows the empty state when SCANsat is not installed", () => {
    render(<ScanningComponent config={{}} id="scanning" />);
    act(() => {
      source.emit("scansat.available", false);
    });
    expect(screen.getByText(/SCANsat is not installed/i)).toBeInTheDocument();
  });

  it("renders the coverage / vessels / anomalies layout when SCANsat is present", () => {
    render(<ScanningComponent config={{}} id="scanning" />);
    act(() => {
      source.emit("scansat.available", true);
      source.emit("v.body", "Kerbin");
      source.emit("scansat.scanningVessels", []);
    });
    expect(screen.getByText(/Coverage — Kerbin/)).toBeInTheDocument();
    expect(screen.getByText(/Scanning vessels/)).toBeInTheDocument();
    expect(
      screen.getByText(/No vessels tracked by SCANsat yet/),
    ).toBeInTheDocument();
  });

  it("renders coverage percentages for each scan type when values are emitted", () => {
    render(<ScanningComponent config={{}} id="scanning" />);
    act(() => {
      source.emit("scansat.available", true);
      source.emit("v.body", "Kerbin");
      source.emit("scansat.scanningVessels", []);
      // Distinct non-zero values for each of the 5 DISPLAY_SCAN_TYPES
      source.emit("scansat.coverage.Kerbin.2", 12.3); // AltimetryHiRes
      source.emit("scansat.coverage.Kerbin.1", 34.5); // AltimetryLoRes
      source.emit("scansat.coverage.Kerbin.8", 56.7); // Biome
      source.emit("scansat.coverage.Kerbin.16", 78.9); // Anomaly
      source.emit("scansat.coverage.Kerbin.256", 91.0); // ResourceHiRes
    });
    expect(screen.getByText("12.3%")).toBeInTheDocument();
    expect(screen.getByText("34.5%")).toBeInTheDocument();
    expect(screen.getByText("56.7%")).toBeInTheDocument();
    expect(screen.getByText("78.9%")).toBeInTheDocument();
    expect(screen.getByText("91.0%")).toBeInTheDocument();
  });

  it("renders anomaly names according to discovery state", () => {
    render(<ScanningComponent config={{}} id="scanning" />);
    act(() => {
      source.emit("scansat.available", true);
      source.emit("v.body", "Kerbin");
      source.emit("scansat.scanningVessels", []);
      source.emit("scansat.anomalies.Kerbin", [
        // detail=true → show the name
        {
          name: "Monolith One",
          latitude: 10.5,
          longitude: 20.5,
          known: true,
          detail: true,
        },
        // known=true, detail=false → "(unknown)"
        {
          name: "Hidden Site",
          latitude: 30.5,
          longitude: 40.5,
          known: true,
          detail: false,
        },
        // known=false, detail=false → "(undetected)"
        {
          name: "Mystery Spot",
          latitude: 50.5,
          longitude: 60.5,
          known: false,
          detail: false,
        },
      ]);
    });
    expect(screen.getByText("Monolith One")).toBeInTheDocument();
    expect(screen.getByText("(unknown)")).toBeInTheDocument();
    expect(screen.getByText("(undetected)")).toBeInTheDocument();
  });

  it("passes an a11y smoke when SCANsat is unavailable", async () => {
    const { container } = render(
      <ScanningComponent config={{}} id="scanning" />,
    );
    act(() => {
      source.emit("scansat.available", false);
    });
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
