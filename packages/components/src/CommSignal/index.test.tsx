import type { DataKey, MockDataSource } from "@ksp-gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { CommSignalComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "comm.connected" },
  { key: "comm.signalStrength" },
  { key: "comm.controlState" },
  { key: "comm.controlStateName" },
  { key: "comm.signalDelay" },
];

describe("CommSignalComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({
      keys: KEYS,
      affectedBySignalLoss: true,
    });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  function primeFlight(): void {
    source.emit("v.name", "Test Vessel");
    source.emit("v.missionTime", 0);
  }

  it("renders the no-data placeholder until any signal field arrives", () => {
    render(<CommSignalComponent config={{}} id="comm" />);
    expect(screen.getByText("No signal data")).toBeInTheDocument();
  });

  it("labels the bars accessibly from signal strength", () => {
    render(<CommSignalComponent config={{}} id="comm" />);
    act(() => {
      primeFlight();
      source.emit("comm.connected", true);
      source.emit("comm.signalStrength", 0.82);
      source.emit("comm.controlState", 2);
      source.emit("comm.controlStateName", "Full");
      source.emit("comm.signalDelay", 0);
    });

    // ceil(0.82 * 4) = 4 lit bars
    expect(screen.getByLabelText("Signal 4 of 4")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();
  });

  it("drops to zero bars and shows the control tone as lost when disconnected", () => {
    render(<CommSignalComponent config={{}} id="comm" />);
    act(() => {
      primeFlight();
      source.emit("comm.connected", false);
      source.emit("comm.signalStrength", 0);
      source.emit("comm.controlState", 0);
      source.emit("comm.controlStateName", "None");
    });

    expect(screen.getByLabelText("Signal 0 of 4")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("formats signal delay in seconds or minutes depending on magnitude", () => {
    render(<CommSignalComponent config={{}} id="comm" />);
    act(() => {
      primeFlight();
      source.emit("comm.connected", true);
      source.emit("comm.signalStrength", 0.5);
      source.emit("comm.signalDelay", 135); // 2m 15s
    });
    expect(screen.getByText("2m 15s")).toBeInTheDocument();
  });
});
