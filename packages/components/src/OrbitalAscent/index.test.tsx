import type { DataKey } from "@gonogo/core";
import {
  clearBodies,
  DashboardItemContext,
  type MockDataSource,
  registerBody,
  registerStockBodies,
} from "@gonogo/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { OrbitalAscentComponent } from "./index";

/**
 * The widget reads three telemetry keys; the reference curve is computed
 * client-side from the body registry. We don't need v.horizontalVelocity to
 * have a value for the curve to render, so the test only emits v.body.
 */
const ASCENT_KEYS: DataKey[] = [
  { key: "v.altitude", unit: "m" },
  { key: "v.horizontalVelocity", unit: "m/s" },
  { key: "v.body" },
];

describe("OrbitalAscentComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    clearBodies();
    registerStockBodies();
    // The default installDomStubs ResizeObserver never fires its callback,
    // which leaves LineChart's `size` null and skips the SVG paths we want
    // to assert against. Stub a version that fires once on observe(), the
    // same shape used by the Graph widget's own tests.
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
    fixture = await setupMockDataSource({ keys: ASCENT_KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
    clearBodies();
    vi.unstubAllGlobals();
  });

  function renderAscent() {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "ascent-test" }}>
        <OrbitalAscentComponent config={{}} id="ascent-test" />
      </DashboardItemContext.Provider>,
    );
  }

  it("renders the title and no reference curve before v.body arrives", async () => {
    const { container } = renderAscent();
    // Wait for the panel to actually render (covers any post-mount async
    // settling from the buffered series subscription) before asserting
    // the negative.
    await screen.findByText("ORBITAL ASCENT");
    expect(container.querySelectorAll("path[stroke-dasharray]")).toHaveLength(
      0,
    );
  });

  it("renders a circular-orbit reference curve once the body is known", async () => {
    const { container } = renderAscent();

    act(() => {
      source.emit("v.body", "Kerbin");
    });

    // The reference curve is a dashed SVG path inside the LineChart svg.
    await waitFor(() => {
      const dashed = container.querySelectorAll("path[stroke-dasharray]");
      expect(dashed.length).toBeGreaterThan(0);
    });
  });

  it("falls back to a notice when the body has no GM registered", async () => {
    registerBody({
      id: "Modtopia",
      name: "Modtopia",
      radius: 500_000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });

    const { container } = renderAscent();

    act(() => {
      source.emit("v.body", "Modtopia");
    });

    expect(await screen.findByText(/no reference data/i)).toBeInTheDocument();
    expect(container.querySelectorAll("path[stroke-dasharray]")).toHaveLength(
      0,
    );
  });

  it("falls back to a notice when the body is not in the registry", async () => {
    renderAscent();

    act(() => {
      source.emit("v.body", "MysteryRock");
    });

    expect(await screen.findByText(/unknown body/i)).toBeInTheDocument();
  });
});
