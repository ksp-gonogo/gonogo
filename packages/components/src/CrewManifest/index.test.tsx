import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrewManifestComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.crew" },
  { key: "v.crewCount" },
  { key: "v.crewCapacity" },
  { key: "v.isEVA" },
];

describe("CrewManifestComponent", () => {
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

  function prime() {
    source.emit("v.name", "Test");
    source.emit("v.missionTime", 0);
  }

  it("shows the waiting placeholder until crew telemetry arrives", () => {
    render(<CrewManifestComponent config={{}} id="crew" />);
    expect(screen.getByText(/Waiting for telemetry/i)).toBeInTheDocument();
  });

  it("lists crew names alongside count / capacity", () => {
    render(<CrewManifestComponent config={{}} id="crew" />);
    act(() => {
      prime();
      source.emit("v.crew", ["Jebediah Kerman", "Bill Kerman", "Bob Kerman"]);
      source.emit("v.crewCount", 3);
      source.emit("v.crewCapacity", 4);
      source.emit("v.isEVA", false);
    });

    expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument();
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    expect(screen.getByText("Bob Kerman")).toBeInTheDocument();
    expect(screen.getByText("3 / 4 aboard")).toBeInTheDocument();
  });

  it("shows the unmanned placeholder when crewCount is 0", () => {
    render(<CrewManifestComponent config={{}} id="crew" />);
    act(() => {
      prime();
      source.emit("v.crew", []);
      source.emit("v.crewCount", 0);
      source.emit("v.crewCapacity", 0);
    });
    expect(screen.getByText(/Unmanned/i)).toBeInTheDocument();
  });

  it("handles Kerbalism-style object payloads by extracting .name", () => {
    render(<CrewManifestComponent config={{}} id="crew" />);
    act(() => {
      prime();
      // Some mods return rich objects instead of plain strings — our guard
      // should fish out the name and ignore the rest.
      source.emit("v.crew", [
        { name: "Jebediah Kerman", health: 1.0 } as unknown as string,
        { name: "Bill Kerman", health: 0.8 } as unknown as string,
      ] as string[]);
      source.emit("v.crewCount", 2);
      source.emit("v.crewCapacity", 2);
    });
    expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument();
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
  });

  it("surfaces EVA state in the subtitle", () => {
    render(<CrewManifestComponent config={{}} id="crew" />);
    act(() => {
      prime();
      source.emit("v.crew", ["Jebediah Kerman"]);
      source.emit("v.crewCount", 1);
      source.emit("v.crewCapacity", 1);
      source.emit("v.isEVA", true);
    });
    expect(screen.getByText(/EVA/)).toBeInTheDocument();
  });
});
