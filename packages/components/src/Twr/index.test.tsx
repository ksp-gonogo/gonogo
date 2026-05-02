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

  it("colours the readout red when TWR < 1", () => {
    const { container } = renderTwr();
    act(() => {
      source.emit("dv.currentTWR", 0.85);
    });
    const readout = container.querySelector('[role="status"]') as HTMLElement;
    expect(readout).not.toBeNull();
    // styled-components inlines the colour CSS variable as the resolved
    // var(--…) reference — assert on the CSS string we set.
    expect(readout.style.color || getComputedStyle(readout).color).toMatch(
      /nogo|red/i,
    );
  });
});
