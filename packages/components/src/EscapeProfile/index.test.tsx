import type { DataKey } from "@gonogo/core";
import {
  clearBodies,
  DashboardItemContext,
  type MockDataSource,
  registerBody,
  registerStockBodies,
} from "@gonogo/core";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { EscapeProfileComponent } from "./index";

const ESCAPE_KEYS: DataKey[] = [
  { key: "v.altitude", unit: "m" },
  { key: "v.orbitalVelocity", unit: "m/s" },
  { key: "v.body" },
];

describe("EscapeProfileComponent", () => {
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
    fixture = await setupMockDataSource({ keys: ESCAPE_KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
    clearBodies();
    vi.unstubAllGlobals();
  });

  function renderEscape() {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "esc-test" }}>
        <EscapeProfileComponent config={{}} id="esc-test" />
      </DashboardItemContext.Provider>,
    );
  }

  it("renders the title and no curve before v.body arrives", () => {
    const { container } = renderEscape();
    expect(container.textContent).toContain("ESCAPE PROFILE");
    expect(container.querySelectorAll("path[stroke-dasharray]")).toHaveLength(
      0,
    );
  });

  it("draws the escape-velocity curve once the body is known", async () => {
    const { container } = renderEscape();

    act(() => {
      source.emit("v.body", "Kerbin");
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });

  it("falls back to a notice when the body has no GM", () => {
    registerBody({
      id: "Modtopia",
      name: "Modtopia",
      radius: 500_000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });

    const { container } = renderEscape();

    act(() => {
      source.emit("v.body", "Modtopia");
    });

    expect(container.textContent).toMatch(/no reference data/i);
  });
});
