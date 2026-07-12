import type { DataKey } from "@ksp-gonogo/core";
import { DashboardItemContext, type MockDataSource } from "@ksp-gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { SemiMajorAxisComponent } from "./index";

const SMA_KEYS: DataKey[] = [
  { key: "o.sma", unit: "m" },
  { key: "o.referenceBody" },
];

describe("SemiMajorAxisComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: SMA_KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  function renderSma(size: { w: number; h: number } = { w: 5, h: 6 }) {
    // Default render size meets the subtitle threshold (rows≥5, cols≥4)
    // so tests that assert on the "Semi-major axis · Kerbin" subtitle
    // continue to exercise it. Below the threshold the widget hides the
    // subtitle to keep the value readout from crowding.
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "sma-test" }}>
        <SemiMajorAxisComponent
          config={{}}
          id="sma-test"
          w={size.w}
          h={size.h}
        />
      </DashboardItemContext.Provider>,
    );
  }

  it("shows the empty state before any orbit data arrives", async () => {
    renderSma();
    expect(await screen.findByText(/no orbit data/i)).toBeInTheDocument();
  });

  it("renders SMA via formatDistance and includes the reference body subtitle", async () => {
    renderSma();
    act(() => {
      source.emit("o.referenceBody", "Kerbin");
      // SMA from body centre — Kerbin radius 600km + 75km altitude = 675km.
      source.emit("o.sma", 675_000);
    });
    expect(await screen.findByText("675.0 km")).toBeInTheDocument();
    expect(screen.getByText(/Kerbin/)).toBeInTheDocument();
  });
});
