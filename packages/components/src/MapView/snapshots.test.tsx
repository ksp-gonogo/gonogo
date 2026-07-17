import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { act, render } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWidget } from "../../scripts/widgets";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import {
  stripVolatile,
  type WidgetSnapshotMode,
} from "../test/widgetDomSnapshot";
import launchpad from "./__fixtures__/kerbin-launchpad.json";
import lko from "./__fixtures__/kerbin-lko-equator.json";
import reentry from "./__fixtures__/kerbin-reentry.json";
import mun from "./__fixtures__/mun-polar-orbit.json";
import noVessel from "./__fixtures__/no-vessel-data.json";
import { MapViewComponent } from "./index";

/**
 * MapView DOM snapshots. The vessel kinematics/body read off the stream
 * (vessel.flight + the derived vessel.state) now, so these render through a
 * real `TelemetryProvider` via `setupStreamFixture` rather than the shared
 * legacy `MockDataSource` `snapshotWidgetMode` harness. The legacy fixtures'
 * keys are reshaped onto the wire topics before emitting.
 */
const FIXTURES = {
  "kerbin-launchpad": launchpad,
  "kerbin-lko-equator": lko,
  "kerbin-reentry": reentry,
  "mun-polar-orbit": mun,
  "no-vessel-data": noVessel,
};

// All eight vessel.state inputs — the carried gate is parent-channel-scoped.
const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
] as const;

type Fixture = Record<string, unknown>;

function num(f: Fixture, key: string): number {
  const v = f[key];
  return typeof v === "number" ? v : 0;
}

async function emitFixture(fixture: StreamFixture, f: Fixture): Promise<void> {
  const body =
    typeof f["v.body"] === "string" ? (f["v.body"] as string) : undefined;
  act(() => {
    fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
    fixture.emit("vessel.flight", {
      latitude: num(f, "v.lat"),
      longitude: num(f, "v.long"),
      altitudeAsl: num(f, "v.altitude"),
      dynamicPressureKPa: num(f, "v.dynamicPressure"),
      mach: num(f, "v.mach"),
      surfaceSpeed: num(f, "v.surfaceSpeed"),
      verticalSpeed: num(f, "v.verticalSpeed"),
    });
    if (body !== undefined) {
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Test Vessel",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      fixture.emit("system.bodies", {
        bodies: [{ index: 1, name: body, radius: 600_000 }],
      });
    }
  });
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function snapshotMapView(
  f: Fixture,
  mode: WidgetSnapshotMode,
): Promise<string> {
  const fixture = setupStreamFixture({
    carriedChannels: [...VESSEL_STATE_INPUTS],
    pinnedUt: 10,
  });
  const config = { ...(mode.config ?? {}) };
  const { container, unmount } = render(
    <ThemeProvider theme={defaultDarkTheme}>
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
          <MapViewComponent config={config} id="snap" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </fixture.Provider>
    </ThemeProvider>,
  );
  // Only the data-bearing fixtures need an emit; the no-vessel-data one renders
  // its placeholder chrome with nothing on the wire.
  if (f["v.lat"] !== undefined || f["v.body"] !== undefined) {
    await emitFixture(fixture, f);
  }
  const html = stripVolatile(container.innerHTML);
  unmount();
  return html;
}

const config = getWidget("map-view");
if (!config) throw new Error("map-view missing from widgets.ts");

describe("MapView DOM snapshots", () => {
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
                contentRect: { width: 600, height: 300 },
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
    vi.unstubAllGlobals();
    clearBodies();
  });

  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotMapView(fixture as Fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
