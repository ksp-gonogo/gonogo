import type { DataKey } from "@ksp-gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BufferedDataSource } from "../BufferedDataSource";
import { MemoryStore } from "../storage/MemoryStore";
import { FlightGraph } from "./FlightGraph";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.altitude" },
  { key: "v.verticalSpeed" },
];

describe("FlightGraph", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();

    // Prime a flight and emit a few samples so the store has data to plot.
    source.emit("v.name", "Test");
    source.emit("v.missionTime", 0);
    await new Promise((r) => setTimeout(r, 0));

    for (let i = 0; i < 5; i++) {
      source.emit("v.altitude", 1000 + i * 100);
      source.emit("v.verticalSpeed", 10 + i);
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 20));
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
  });

  it("renders a placeholder until the user picks a data key", async () => {
    const flights = await buffered.listFlights();
    const f = flights[0];
    expect(f).toBeDefined();

    render(
      <FlightGraph
        flightId={f.id}
        launchedAt={f.launchedAt}
        lastSampleAt={f.lastSampleAt || f.launchedAt + 60_000}
      />,
    );

    expect(
      screen.getByText(/pick one or more numeric telemetry keys/i),
    ).toBeTruthy();
  });

  it("excludes non-numeric keys (enum/bool/raw) from the picker", async () => {
    const flights = await buffered.listFlights();
    const f = flights[0];
    render(
      <FlightGraph
        flightId={f.id}
        launchedAt={f.launchedAt}
        lastSampleAt={f.lastSampleAt || f.launchedAt + 60_000}
      />,
    );

    // v.name is enum — should never appear among the picker's rendered options.
    // v.altitude carries the "m" unit — should appear.
    await waitFor(() => {
      expect(screen.queryByText("Vessel name")).toBeNull();
      expect(screen.getByText("Altitude")).toBeTruthy();
    });
  });
});
