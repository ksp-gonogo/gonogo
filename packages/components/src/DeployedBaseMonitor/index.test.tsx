import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { DeployedBaseMonitorComponent, parseBases } from "./index";

const KEYS: DataKey[] = [
  { key: "deployed.bases" },
  { key: "deployed.available" },
];

const base = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1,
  body: "Mun",
  powered: true,
  partialPower: false,
  powerAvailable: 12,
  powerRequired: 8,
  controllerEnabled: true,
  experimentCount: 1,
  experiments: [
    {
      id: "deployedSeismic",
      name: "Seismometer",
      total: 30,
      limit: 60,
      progress: 0.5,
      stored: 5,
      transmitted: 25,
      collecting: true,
    },
  ],
  ...over,
});

describe("DeployedBaseMonitorComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("shows the DLC-absent state when deployed.available is false", () => {
    render(<DeployedBaseMonitorComponent config={{}} id="db" />);
    act(() => {
      source.emit("deployed.available", false);
      source.emit("deployed.bases", []);
    });
    expect(
      screen.getByText(/Breaking Ground not installed/i),
    ).toBeInTheDocument();
  });

  it("shows the no-bases state when available but the list is empty", () => {
    render(<DeployedBaseMonitorComponent config={{}} id="db" />);
    act(() => {
      source.emit("deployed.available", true);
      source.emit("deployed.bases", []);
    });
    expect(screen.getByText(/No deployed bases/i)).toBeInTheDocument();
  });

  it("shows the no-bases state when the key is absent (older fork)", () => {
    render(<DeployedBaseMonitorComponent config={{}} id="db" />);
    expect(screen.getByText(/No deployed bases/i)).toBeInTheDocument();
  });

  it("renders a base with power balance and experiment progress", () => {
    render(<DeployedBaseMonitorComponent config={{}} id="db" />);
    act(() => {
      source.emit("deployed.available", true);
      source.emit("deployed.bases", [base()]);
    });
    expect(screen.getByText("Mun")).toBeInTheDocument();
    expect(screen.getByText(/Powered/i)).toBeInTheDocument();
    expect(screen.getByText(/EC 12\/8/)).toBeInTheDocument();
    expect(screen.getByText("Seismometer")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("labels an unpowered base and a brownout base distinctly", () => {
    render(<DeployedBaseMonitorComponent config={{}} id="db" />);
    act(() => {
      source.emit("deployed.available", true);
      source.emit("deployed.bases", [
        base({ id: 1, body: "Mun", powered: false, experiments: [] }),
        base({
          id: 2,
          body: "Minmus",
          powered: true,
          partialPower: true,
          experiments: [],
        }),
      ]);
    });
    expect(screen.getByText(/Unpowered/i)).toBeInTheDocument();
    expect(screen.getByText(/Brownout/i)).toBeInTheDocument();
  });
});

describe("parseBases", () => {
  it("returns null for absent or non-array input", () => {
    expect(parseBases(undefined)).toBeNull();
    expect(parseBases(null)).toBeNull();
    expect(parseBases({})).toBeNull();
  });

  it("drops bases with no numeric id and clamps experiment progress", () => {
    const parsed = parseBases([
      {
        id: 7,
        experiments: [{ name: "X", progress: 5 }],
      },
      { body: "no id" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.experiments[0]?.progress).toBe(1);
    expect(parsed?.[0]?.experiments[0]?.collecting).toBe(false);
  });
});
