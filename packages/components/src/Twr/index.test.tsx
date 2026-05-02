import type { DataKey } from "@gonogo/core";
import { DashboardItemContext, type MockDataSource } from "@gonogo/core";
import { act, render } from "@testing-library/react";
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

  it("shows the empty state before any telemetry arrives", () => {
    const { container } = renderTwr();
    expect(container.textContent).toMatch(/no engine data/i);
  });

  it("renders TWR rounded to two decimals", () => {
    const { container } = renderTwr();
    act(() => {
      source.emit("dv.currentTWR", 1.832);
    });
    expect(container.textContent).toContain("1.83");
  });

  it("renders the TWR value as the gauge's aria-label so screen readers can read it", () => {
    const { container } = renderTwr();
    act(() => {
      source.emit("dv.currentTWR", 0.85);
    });
    // The gauge SVG carries an aria-label embedding the value; that's the
    // screen-reader-friendly assertion that doesn't depend on
    // styled-components colour resolution.
    const gauge = container.querySelector('svg[aria-label^="TWR "]');
    expect(gauge?.getAttribute("aria-label")).toBe("TWR 0.85");
  });

  it("draws three coloured zones on the dial (nogo / warning / ok)", () => {
    const { container } = renderTwr();
    act(() => {
      source.emit("dv.currentTWR", 1.5);
    });
    // 1 track + 3 zone arcs = 4 paths inside the gauge svg.
    const gauge = container.querySelector('svg[aria-label^="TWR "]');
    expect(gauge?.querySelectorAll("path")).toHaveLength(4);
  });
});
