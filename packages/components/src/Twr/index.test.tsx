import type { DataKey } from "@gonogo/core";
import { DashboardItemContext, type MockDataSource } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { TwrComponent } from "./index";

const TWR_KEYS: DataKey[] = [{ key: "dv.currentTWR", unit: "g" }];

describe("TwrComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: TWR_KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  function renderTwr() {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "twr-test" }}>
        <TwrComponent config={{}} id="twr-test" />
      </DashboardItemContext.Provider>,
    );
  }

  it("shows the empty state before any telemetry arrives", async () => {
    renderTwr();
    expect(await screen.findByText(/no engine data/i)).toBeInTheDocument();
  });

  it("renders TWR rounded to two decimals", async () => {
    renderTwr();
    act(() => {
      source.emit("dv.currentTWR", 1.832);
    });
    // findByText awaits the value appearing — covers both the synchronous
    // emit propagation and any follow-up state updates from the buffered
    // series subscription that lives behind the sparkline.
    expect(await screen.findByText("1.83")).toBeInTheDocument();
  });

  it("renders the TWR value as the gauge's aria-label so screen readers can read it", async () => {
    renderTwr();
    act(() => {
      source.emit("dv.currentTWR", 0.85);
    });
    // The gauge's aria-label embeds the live value — that's the
    // screen-reader-friendly assertion that doesn't depend on
    // styled-components colour resolution.
    expect(await screen.findByLabelText("TWR 0.85")).toBeInTheDocument();
  });

  it("draws three coloured zones on the dial (nogo / warning / ok)", async () => {
    renderTwr();
    act(() => {
      source.emit("dv.currentTWR", 1.5);
    });
    // Wait for the gauge to render the new value, then count the zone arcs
    // (1 track + 3 zones = 4 paths inside the gauge svg).
    const gauge = await screen.findByLabelText("TWR 1.50");
    expect(gauge.querySelectorAll("path")).toHaveLength(4);
  });
});
