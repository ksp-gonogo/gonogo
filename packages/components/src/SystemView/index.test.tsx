import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SystemViewComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "b.number" },
  { key: "v.body" },
  { key: "tar.name" },
  // Keys per body — Kerbin (0), Mun (1), Minmus (2)
  { key: "b.name[0]" },
  { key: "b.name[1]" },
  { key: "b.name[2]" },
  { key: "b.referenceBody[0]" },
  { key: "b.referenceBody[1]" },
  { key: "b.referenceBody[2]" },
  { key: "b.radius[0]" },
  { key: "b.radius[1]" },
  { key: "b.radius[2]" },
  { key: "b.mass[0]" },
  { key: "b.mass[1]" },
  { key: "b.mass[2]" },
  { key: "b.geeASL[0]" },
  { key: "b.geeASL[1]" },
  { key: "b.geeASL[2]" },
  { key: "b.rotationPeriod[1]" },
  { key: "b.atmosphere[0]" },
  { key: "b.atmosphere[1]" },
  { key: "b.o.sma[1]" },
  { key: "b.o.sma[2]" },
  { key: "b.o.eccentricity[1]" },
  { key: "b.o.eccentricity[2]" },
  { key: "b.o.phaseAngle[1]" },
  { key: "b.o.phaseAngle[2]" },
];

describe("SystemViewComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
  });

  function primeBodies() {
    act(() => {
      source.emit("b.number", 3);
      source.emit("b.name[0]", "Kerbin");
      source.emit("b.name[1]", "Mun");
      source.emit("b.name[2]", "Minmus");
      source.emit("b.referenceBody[1]", "Kerbin");
      source.emit("b.referenceBody[2]", "Kerbin");
      source.emit("b.radius[0]", 600_000);
      source.emit("b.radius[1]", 200_000);
      source.emit("b.radius[2]", 60_000);
      source.emit("b.mass[1]", 9.76e20);
      source.emit("b.geeASL[1]", 0.166);
      source.emit("b.rotationPeriod[1]", 138984);
      source.emit("b.atmosphere[1]", false);
      source.emit("b.o.sma[1]", 12_000_000);
      source.emit("b.o.sma[2]", 47_000_000);
      source.emit("b.o.eccentricity[1]", 0);
      source.emit("b.o.eccentricity[2]", 0);
      source.emit("v.body", "Kerbin");
    });
  }

  it("waits for body data before rendering anything", () => {
    render(<SystemViewComponent config={{}} id="sv" />);
    expect(screen.getByText(/Waiting for Telemachus/i)).toBeInTheDocument();
  });

  it("renders the almanac panel for the vessel's body when nothing is hovered", () => {
    render(<SystemViewComponent config={{}} id="sv" />);
    primeBodies();
    // "Kerbin" appears in both the SVG parent label and the almanac
    // title — both confirm the panel landed on the vessel's body.
    const matches = screen.getAllByText("Kerbin");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("renders almanac fields when they're available", () => {
    render(<SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />);
    primeBodies();
    // Mun has fielded almanac data — expect the labels to surface in the
    // panel for the focused/default body. Default focus picks the vessel's
    // body (Kerbin), so we manually pin the frame to Kerbin and expect to
    // see its surface gravity if we add it. Easier: assert the panel
    // exists with one of the Kerbin labels we did emit ("Radius", "Atm").
    expect(screen.getByText("Radius")).toBeInTheDocument();
  });

  it("subscribes to phase angle keys for child bodies of the frame", () => {
    render(<SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />);
    primeBodies();
    act(() => {
      source.emit("b.o.phaseAngle[1]", 47.2);
      source.emit("b.o.phaseAngle[2]", 12);
    });
    // The numeric phase-angle labels render inside SystemDiagram. They're
    // signed-normalised, so 47.2° survives unchanged. Assert via a
    // matching SVG <text> entry.
    const labels = screen.getAllByText(/47°/);
    expect(labels.length).toBeGreaterThan(0);
  });
});
