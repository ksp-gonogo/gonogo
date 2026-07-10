import type { DataKey, MockDataSource } from "@gonogo/core";
import { clearAugments, registerAugment } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  type DeployedExperimentContext,
  DeployedScienceComponent,
  parseBases,
} from "./index";

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

describe("DeployedScienceComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
    clearAugments();
  });

  it("shows the DLC-absent state when deployed.available is false", () => {
    render(<DeployedScienceComponent config={{}} id="db" />);
    act(() => {
      source.emit("deployed.available", false);
      source.emit("deployed.bases", []);
    });
    expect(
      screen.getByText(/Breaking Ground not installed/i),
    ).toBeInTheDocument();
  });

  it("shows the no-bases state when available but the list is empty", () => {
    render(<DeployedScienceComponent config={{}} id="db" />);
    act(() => {
      source.emit("deployed.available", true);
      source.emit("deployed.bases", []);
    });
    expect(screen.getByText(/No deployed bases/i)).toBeInTheDocument();
  });

  it("shows the no-bases state when the key is absent (older fork)", () => {
    render(<DeployedScienceComponent config={{}} id="db" />);
    expect(screen.getByText(/No deployed bases/i)).toBeInTheDocument();
  });

  it("renders a base with power balance and experiment progress", () => {
    render(<DeployedScienceComponent config={{}} id="db" />);
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
    render(<DeployedScienceComponent config={{}} id="db" />);
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

  it("renders the augment slots with no bound augment (empty is fine)", () => {
    // No augment registered → both slots compose nothing and the base card
    // renders exactly as before.
    render(<DeployedScienceComponent config={{}} id="db" />);
    act(() => {
      source.emit("deployed.available", true);
      source.emit("deployed.bases", [base()]);
    });
    expect(screen.getByText("Seismometer")).toBeInTheDocument();
    expect(screen.queryByTestId("deployed-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("deployed-section")).not.toBeInTheDocument();
  });

  it("renders a bound header-badges augment next to the title", () => {
    registerAugment<"deployed-science.badges">({
      id: "test-deployed-badge",
      augments: "deployed-science.badges",
      component: () => <span data-testid="deployed-badge">RAD</span>,
    });

    render(<DeployedScienceComponent config={{}} id="db" />);
    act(() => {
      source.emit("deployed.available", true);
      source.emit("deployed.bases", [base()]);
    });

    expect(screen.getByTestId("deployed-badge")).toHaveTextContent("RAD");
  });

  it("renders a bound sections augment per experiment card, carrying its datum", () => {
    // A test Uplink binds `deployed-science.sections` and echoes back the
    // per-card experiment props. Proves (a) the slot is exposed, (b) an
    // augment composes into it once per experiment, and (c) the props carry
    // the right experiment/body so a per-card augment targets correctly.
    registerAugment<"deployed-science.sections">({
      id: "test-deployed-section",
      augments: "deployed-science.sections",
      component: ({ experiment, body }: DeployedExperimentContext) => (
        <span data-testid="deployed-section">
          {body}:{experiment.name}:{Math.round(experiment.progress * 100)}
        </span>
      ),
    });

    render(<DeployedScienceComponent config={{}} id="db" />);
    act(() => {
      source.emit("deployed.available", true);
      source.emit("deployed.bases", [
        base({
          id: 1,
          body: "Mun",
          experiments: [
            { id: "a", name: "Seismometer", progress: 0.5 },
            { id: "b", name: "Ion Detector", progress: 0.25 },
          ],
        }),
      ]);
    });

    // One augment per experiment card, each carrying its own card's datum
    // (name + progress + body) in DOM order — proves the per-card props
    // identity is correct.
    const sections = screen.getAllByTestId("deployed-section");
    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.textContent)).toEqual([
      "Mun:Seismometer:50",
      "Mun:Ion Detector:25",
    ]);
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
