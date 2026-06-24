import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { MissionStatusComponent, parseObjectives, parseScore } from "./index";

const KEYS: DataKey[] = [
  { key: "mh.available" },
  { key: "mh.name" },
  { key: "mh.testMode" },
  { key: "mh.phase" },
  { key: "mh.score" },
  { key: "mh.finished" },
  { key: "mh.outcome" },
  { key: "mh.objectives" },
];

describe("MissionStatusComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("shows the unavailable note when no mission is running (or no DLC)", () => {
    render(<MissionStatusComponent config={{}} id="ms" />);
    expect(
      screen.getByText(/Making History not installed or no active mission/i),
    ).toBeInTheDocument();
  });

  it("stays hidden when mh.available is explicitly false", () => {
    render(<MissionStatusComponent config={{}} id="ms" />);
    act(() => {
      source.emit("mh.available", false);
      source.emit("mh.name", "Should Not Show");
    });
    expect(screen.queryByText("Should Not Show")).not.toBeInTheDocument();
    expect(screen.getByText(/no active mission/i)).toBeInTheDocument();
  });

  it("renders name, phase, score and the objective checklist", () => {
    render(<MissionStatusComponent config={{}} id="ms" />);
    act(() => {
      source.emit("mh.available", true);
      source.emit("mh.name", "Munar 1");
      source.emit("mh.phase", "Reach orbit");
      source.emit("mh.score", { current: 40, max: 100, enabled: true });
      source.emit("mh.objectives", [
        { title: "Launch", description: "", state: "reached", scoring: false },
        {
          title: "Orbit Kerbin",
          description: "Ap > 70km",
          state: "active",
          scoring: true,
        },
        {
          title: "Land on Mun",
          description: "",
          state: "pending",
          scoring: true,
        },
      ]);
    });

    expect(screen.getByText("Munar 1")).toBeInTheDocument();
    expect(screen.getByText("Reach orbit")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("Orbit Kerbin")).toBeInTheDocument();
    expect(screen.getByText("Land on Mun")).toBeInTheDocument();
  });

  it("shows a polite success banner when the mission ends successfully", () => {
    render(<MissionStatusComponent config={{}} id="ms" />);
    act(() => {
      source.emit("mh.available", true);
      source.emit("mh.name", "Munar 1");
      source.emit("mh.finished", true);
      source.emit("mh.outcome", "success");
    });
    const banner = screen.getByText(/MISSION SUCCESS/i);
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveAttribute("aria-live", "polite");
  });

  it("shows an assertive fail banner when the mission fails", () => {
    render(<MissionStatusComponent config={{}} id="ms" />);
    act(() => {
      source.emit("mh.available", true);
      source.emit("mh.name", "Munar 1");
      source.emit("mh.finished", true);
      source.emit("mh.outcome", "fail");
    });
    const banner = screen.getByText(/MISSION FAILED/i);
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveAttribute("aria-live", "assertive");
  });
});

describe("parseObjectives", () => {
  it("returns [] for non-array input", () => {
    expect(parseObjectives(null)).toEqual([]);
    expect(parseObjectives({})).toEqual([]);
  });

  it("defaults an unknown state to pending and coerces scoring", () => {
    const parsed = parseObjectives([
      { title: "A", state: "weird" },
      { title: "B", state: "active", scoring: true },
    ]);
    expect(parsed[0]?.state).toBe("pending");
    expect(parsed[0]?.scoring).toBe(false);
    expect(parsed[1]?.state).toBe("active");
    expect(parsed[1]?.scoring).toBe(true);
  });
});

describe("parseScore", () => {
  it("returns null for non-object input", () => {
    expect(parseScore(null)).toBeNull();
    expect(parseScore([])).toBeNull();
  });

  it("coerces fields with sane defaults", () => {
    expect(parseScore({ current: 12, max: 50, enabled: true })).toEqual({
      current: 12,
      max: 50,
      enabled: true,
    });
    expect(parseScore({})).toEqual({ current: 0, max: 0, enabled: false });
  });
});
