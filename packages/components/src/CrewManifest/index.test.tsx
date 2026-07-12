import type { DataKey, MockDataSource } from "@ksp-gonogo/core";
import { registerAugment } from "@ksp-gonogo/core";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { type CrewBadgeContext, CrewManifestComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.crew" },
  { key: "v.crewCount" },
  { key: "v.crewCapacity" },
  { key: "v.isEVA" },
];

describe("CrewManifestComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
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

  it("does not flash Unmanned when capacity arrives before count", () => {
    render(<CrewManifestComponent config={{}} id="crew" />);
    // crewCapacity (and crew names) can land a sample before crewCount.
    // The widget must not conclude "Unmanned" from a still-undefined count.
    act(() => {
      prime();
      source.emit("v.crewCapacity", 4);
    });
    expect(screen.queryByText(/Unmanned/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Waiting for telemetry/i)).toBeInTheDocument();

    act(() => {
      source.emit("v.crew", ["Jebediah Kerman"]);
      source.emit("v.crewCount", 1);
    });
    expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument();
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

  it("renders the per-crew badges slot with no bound augment (empty is fine)", () => {
    // No augment registered → the slot composes nothing and the roster renders
    // exactly as before, one row per kerbal.
    render(<CrewManifestComponent config={{}} id="crew" />);
    act(() => {
      prime();
      source.emit("v.crew", ["Jebediah Kerman", "Bill Kerman"]);
      source.emit("v.crewCount", 2);
      source.emit("v.crewCapacity", 2);
    });
    expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument();
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    expect(screen.queryByTestId("crew-badge")).not.toBeInTheDocument();
  });

  it("renders a bound augment once per crew row, carrying each kerbal's identity", () => {
    // A test Uplink binds `crew-manifest.badges` and echoes the slot props back.
    // Proves (a) the slot is exposed, (b) an augment composes into it, and (c)
    // the per-row props carry the right kerbal so the badge lands on the right
    // one. `requires` is omitted so no Domain presence gate applies.
    registerAugment<"crew-manifest.badges">({
      id: "test-crew-badge",
      augments: "crew-manifest.badges",
      component: ({ crewName, crewIndex }: CrewBadgeContext) => (
        <span data-testid="crew-badge" data-index={crewIndex}>
          {crewName} ✓
        </span>
      ),
    });

    render(<CrewManifestComponent config={{}} id="crew" />);
    act(() => {
      prime();
      source.emit("v.crew", ["Jebediah Kerman", "Bill Kerman", "Bob Kerman"]);
      source.emit("v.crewCount", 3);
      source.emit("v.crewCapacity", 3);
    });

    const badges = screen.getAllByTestId("crew-badge");
    expect(badges).toHaveLength(3);
    expect(badges.map((b) => b.textContent)).toEqual([
      "Jebediah Kerman ✓",
      "Bill Kerman ✓",
      "Bob Kerman ✓",
    ]);
    // Each badge sits inside its own kerbal's row (props identity is correct).
    const jebRow = screen.getByText("Jebediah Kerman").closest("li");
    expect(jebRow).not.toBeNull();
    expect(
      within(jebRow as HTMLElement).getByTestId("crew-badge"),
    ).toHaveTextContent("Jebediah Kerman ✓");
  });
});
