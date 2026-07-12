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
import { LandingStatusComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.body" },
  { key: "v.heightFromTerrain" },
  { key: "v.verticalSpeed" },
  { key: "land.timeToImpact" },
  { key: "land.speedAtImpact" },
  { key: "land.bestSpeedAtImpact" },
  { key: "land.suicideBurnCountdown" },
  { key: "land.predictedLat" },
  { key: "land.predictedLon" },
  { key: "land.slopeAngle" },
];

describe("LandingStatusComponent", () => {
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

  function primeFlight(): void {
    source.emit("v.name", "Test Vessel");
    source.emit("v.missionTime", 0);
  }

  it("shows the idle placeholder when no landing is in progress", () => {
    render(<LandingStatusComponent config={{}} id="land" />);
    act(() => {
      primeFlight();
      source.emit("v.body", "Mun");
    });
    expect(screen.getByText("No landing in progress")).toBeInTheDocument();
    // Body subtitle should note vacuum.
    expect(screen.getByText(/vacuum/i)).toBeInTheDocument();
  });

  it("renders the full readout when a prediction lands", () => {
    render(<LandingStatusComponent config={{}} id="land" />);
    act(() => {
      primeFlight();
      source.emit("v.body", "Mun");
      source.emit("v.heightFromTerrain", 2800);
      source.emit("v.verticalSpeed", -42.5);
      source.emit("land.timeToImpact", 38);
      source.emit("land.speedAtImpact", 120);
      source.emit("land.bestSpeedAtImpact", 9);
      source.emit("land.suicideBurnCountdown", 15);
      source.emit("land.predictedLat", 1.2);
      source.emit("land.predictedLon", -72.4);
      source.emit("land.slopeAngle", 4.2);
    });

    expect(screen.getByText(/T−/)).toBeInTheDocument();
    expect(screen.getByText(/120 m\/s/)).toBeInTheDocument();
    expect(screen.getByText(/best 9\.00 m\/s/)).toBeInTheDocument();
    expect(screen.getByText(/2\.80 km/)).toBeInTheDocument();
    // suicide burn at T-15s — status (polite), not alert
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("escalates to role=alert when the suicide-burn countdown drops below 5s", () => {
    render(<LandingStatusComponent config={{}} id="land" />);
    act(() => {
      primeFlight();
      source.emit("v.body", "Mun");
      source.emit("land.timeToImpact", 8);
      source.emit("land.speedAtImpact", 80);
      source.emit("land.bestSpeedAtImpact", 5);
      source.emit("land.suicideBurnCountdown", 3);
      source.emit("land.predictedLat", 1.2);
      source.emit("land.predictedLon", -72.4);
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/T−/);
  });

  it("flags atmospheric bodies and demotes the suicide-burn row", () => {
    render(<LandingStatusComponent config={{}} id="land" />);
    act(() => {
      primeFlight();
      source.emit("v.body", "Kerbin");
      source.emit("land.timeToImpact", 120);
      source.emit("land.speedAtImpact", 220);
      source.emit("land.bestSpeedAtImpact", 180);
      source.emit("land.suicideBurnCountdown", 40);
      source.emit("land.predictedLat", -0.05);
      source.emit("land.predictedLon", -74.6);
    });

    // Subtitle mentions atmospheric, and the suicide-burn row's caveat note
    // mentions aerobraking. Both should be on-screen.
    expect(screen.getByText(/kerbin · atmospheric/i)).toBeInTheDocument();
    expect(screen.getByText(/aerobraking/i)).toBeInTheDocument();
  });
});
