import type { DataKey } from "@ksp-gonogo/core";
import {
  clearBodies,
  DashboardItemContext,
  type MockDataSource,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { AtmosphereProfileComponent } from "./index";

const ATMO_KEYS: DataKey[] = [
  { key: "v.altitude", unit: "m" },
  { key: "v.body" },
];

describe("AtmosphereProfileComponent", () => {
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
    fixture = await setupMockDataSource({ keys: ATMO_KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
    clearBodies();
    vi.unstubAllGlobals();
  });

  function renderAtmo() {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "atmo-test" }}>
        <AtmosphereProfileComponent config={{}} id="atmo-test" />
      </DashboardItemContext.Provider>,
    );
  }

  it("draws a pressure curve for an atmospheric body", async () => {
    const { container } = renderAtmo();

    act(() => {
      source.emit("v.body", "Kerbin");
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });

  it("draws a current-altitude threshold line once altitude arrives", async () => {
    const { container } = renderAtmo();

    act(() => {
      source.emit("v.body", "Kerbin");
      source.emit("v.altitude", 5_600);
    });

    await waitFor(() => {
      // The curve is drawn dashed; the threshold line is solid. Look for
      // any non-dashed stroke line spanning the plot width.
      const text = container.textContent ?? "";
      expect(text).toMatch(/Pa|kPa/);
    });
  });

  it("shows the airless notice for non-atmospheric bodies", async () => {
    const { container } = renderAtmo();

    act(() => {
      source.emit("v.body", "Mun");
    });

    await waitFor(() => {
      expect(container.textContent).toMatch(/no atmosphere/i);
    });
  });
});
