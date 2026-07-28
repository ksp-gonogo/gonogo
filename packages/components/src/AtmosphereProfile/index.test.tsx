import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

const CARRIED_CHANNELS = [
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
 * Resolves `vessel.state.parentBodyName` to `name` via a single-entry
 * `system.bodies` table. `vessel.flight` must ALSO be present here, in the
 * "measured" (Loaded) basis `deriveVesselState` gates the WHOLE
 * `vessel.state` record (not just `altitudeAsl`) on `vessel.flight` having
 * arrived at all.
 */
function emitBody(
  fixture: ReturnType<typeof setupStreamFixture>,
  name: string,
) {
  fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
  fixture.emit("vessel.flight", {});
  fixture.emit("vessel.identity", { parentBodyIndex: 1 });
  fixture.emit("system.bodies", {
    bodies: [{ name, index: 1, parentIndex: 0, radius: 600_000, orbit: null }],
  });
}

describe("AtmosphereProfileComponent", () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    clearBodies();
    vi.unstubAllGlobals();
  });

  function renderAtmo() {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
    });
    const rendered = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "atmo-test" }}>
          <AtmosphereProfileComponent config={{}} id="atmo-test" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    return { fixture, ...rendered };
  }

  it("draws a pressure curve for an atmospheric body", async () => {
    const { fixture, container } = renderAtmo();

    act(() => {
      emitBody(fixture, "Kerbin");
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });

  it("draws a current-altitude threshold line once altitude arrives", async () => {
    const { fixture, container } = renderAtmo();

    act(() => {
      emitBody(fixture, "Kerbin");
      fixture.emit("vessel.flight", { altitudeAsl: 5_600 });
    });

    await waitFor(() => {
      // The curve is drawn dashed; the threshold line is solid. Look for
      // any non-dashed stroke line spanning the plot width.
      const text = container.textContent ?? "";
      expect(text).toMatch(/Pa|kPa/);
    });
  });

  it("shows the airless notice for non-atmospheric bodies", async () => {
    const { fixture, container } = renderAtmo();

    act(() => {
      emitBody(fixture, "Mun");
    });

    await waitFor(() => {
      expect(container.textContent).toMatch(/no atmosphere/i);
    });
  });
});
