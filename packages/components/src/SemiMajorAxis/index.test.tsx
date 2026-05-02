import type { DataKey } from "@gonogo/core";
import { DashboardItemContext, type MockDataSource } from "@gonogo/core";
import { act, render } from "@testing-library/react";
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

  function renderSma() {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "sma-test" }}>
        <SemiMajorAxisComponent config={{}} id="sma-test" />
      </DashboardItemContext.Provider>,
    );
  }

  it("shows the empty state before any orbit data arrives", () => {
    const { container } = renderSma();
    expect(container.textContent).toMatch(/no orbit data/i);
  });

  it("renders SMA via formatDistance and includes the reference body subtitle", () => {
    const { container } = renderSma();
    act(() => {
      source.emit("o.referenceBody", "Kerbin");
      // SMA from body centre — Kerbin radius 600km + 75km altitude = 675km.
      source.emit("o.sma", 675_000);
    });
    // formatDistance(675_000) → "675.0 km"
    expect(container.textContent).toContain("675.0 km");
    expect(container.textContent).toContain("Kerbin");
  });
});
