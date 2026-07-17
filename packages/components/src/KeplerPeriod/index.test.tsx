import type { DataKey } from "@ksp-gonogo/core";
import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KeplerPeriodComponent } from "./index";

// The graph's `o.sma`/`o.period` scatter series still ride
// `useDataSeries("data", ...)` (`@ksp-gonogo/data`) unconditionally — that
// hook has no stream awareness at all, so a legacy `MockDataSource`
// registered under "data" is still required for `GraphView` to mount
// without erroring, even though neither test below emits onto these keys
// (the dashed reference curve these tests assert on is drawn purely from
// the resolved `BodyDefinition`, not from streamed samples).
const GRAPH_KEYS: DataKey[] = [
  { key: "o.sma", unit: "m" },
  { key: "o.period", unit: "s" },
];

const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

/**
 * `o.referenceBody`/`v.body` stream off `vessel.state`'s
 * `referenceBodyName`/`parentBodyName` display maps (see `stream.test.tsx`'s
 * doc comment) — no legacy fallback — so both tests below mount a real
 * `TelemetryProvider` and feed `vessel.orbit`/`vessel.identity`/
 * `system.bodies` rather than emitting the old legacy keys directly.
 */
describe("KeplerPeriodComponent", () => {
  let fixture: MockDataSourceFixture;
  let stream: ReturnType<typeof setupStreamFixture>;

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
    fixture = await setupMockDataSource({ keys: GRAPH_KEYS });
    stream = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 10,
    });
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
    clearBodies();
    vi.unstubAllGlobals();
  });

  function renderKepler() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "kepler-test" }}>
          <KeplerPeriodComponent config={{}} id="kepler-test" />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  it("draws the Kepler curve once a known body is selected", async () => {
    const { container } = renderKepler();

    act(() => {
      stream.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600000,
            orbit: null,
          },
        ],
      });
      stream.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: 700000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: 3.5316e12,
      });
      stream.emit("vessel.identity", { parentBodyIndex: null, launchUt: null });
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
      stream.emit("system.bodies", {
        bodies: [
          {
            name: "Mun",
            index: 2,
            parentIndex: 1,
            radius: 200000,
            orbit: null,
          },
        ],
      });
      // referenceBodyIndex points at an index `system.bodies` doesn't carry,
      // so `referenceBodyName` resolves to undefined and the widget falls
      // back to `parentBodyName` — same precedence `index.tsx` documents.
      stream.emit("vessel.orbit", {
        referenceBodyIndex: 999,
        sma: 700000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: 3.5316e12,
      });
      stream.emit("vessel.identity", { parentBodyIndex: 2, launchUt: null });
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });
});
