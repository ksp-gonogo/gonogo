import type { DataKey } from "@gonogo/core";
import {
  clearBodies,
  DashboardItemContext,
  type MockDataSource,
  registerStockBodies,
} from "@gonogo/core";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { KeplerPeriodComponent } from "./index";

const KEPLER_KEYS: DataKey[] = [
  { key: "o.sma", unit: "m" },
  { key: "o.period", unit: "s" },
  { key: "o.referenceBody" },
  { key: "v.body" },
];

describe("KeplerPeriodComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    clearBodies();
    registerStockBodies();
    vi.stubGlobal(
      "ResizeObserver",
      class FakeResizeObserver {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(_el: Element) {
          this.cb(
            [
              {
                contentRect: { width: 400, height: 300 },
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
    fixture = await setupMockDataSource({ keys: KEPLER_KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
    clearBodies();
    vi.unstubAllGlobals();
  });

  function renderKepler() {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "kepler-test" }}>
        <KeplerPeriodComponent config={{}} id="kepler-test" />
      </DashboardItemContext.Provider>,
    );
  }

  it("draws the Kepler curve once a known body is selected", async () => {
    const { container } = renderKepler();

    act(() => {
      source.emit("o.referenceBody", "Kerbin");
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });

  it("falls back to v.body when o.referenceBody is absent", async () => {
    const { container } = renderKepler();

    act(() => {
      source.emit("v.body", "Mun");
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });
});
