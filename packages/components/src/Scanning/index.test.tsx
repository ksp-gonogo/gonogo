import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
  registerStockBodies,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { ScanningComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "scan.available" },
  { key: "scan.scanningVessels" },
  { key: "v.body" },
  { key: "v.lat" },
  { key: "v.long" },
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
      source.emit("scan.available", false);
    });
    expect(screen.getByText(/SCANsat is not installed/i)).toBeInTheDocument();
  });

  it("renders the coverage / vessels / anomalies layout when SCANsat is present", () => {
    render(<ScanningComponent config={{}} id="scanning" />);
    act(() => {
      source.emit("scan.available", true);
      source.emit("v.body", "Kerbin");
      source.emit("scan.scanningVessels", []);
    });
    expect(screen.getByText(/Coverage — Kerbin/)).toBeInTheDocument();
    expect(screen.getByText(/Scanning vessels/)).toBeInTheDocument();
    expect(
      screen.getByText(/No vessels tracked by SCANsat yet/),
    ).toBeInTheDocument();
  });

  it("passes an a11y smoke when SCANsat is unavailable", async () => {
    const { container } = render(
      <ScanningComponent config={{}} id="scanning" />,
    );
    act(() => {
      source.emit("scan.available", false);
    });
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
