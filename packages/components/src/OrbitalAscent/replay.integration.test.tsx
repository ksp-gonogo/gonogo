import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@gonogo/core";
import { synthesizeFlight } from "@gonogo/data";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ReplayDataSourceFixture,
  setupReplayDataSource,
  teardownReplayDataSource,
} from "../test/setupReplayDataSource";
import { OrbitalAscentComponent } from "./index";

/**
 * Demo integration test: drive OrbitalAscent from a synthesized flight via
 * `FlightReplayDataSource` instead of hand-crafted single-key emits.
 *
 * The test reads almost like a story: build a fixture for the ascent,
 * advance the clock, assert the widget reflects the end-state. The same
 * pattern scales to "given this docking sequence, the DistanceToTarget
 * widget…" without proliferating ad-hoc setup helpers.
 */

// A modest sub-orbital → orbital sample timeline. Real KSP data would be
// much denser; the values here are coarse but capture the shape (altitude
// climbs from sea level past the atmosphere; horizontal velocity rises
// toward the ~2,287 m/s circular-orbit target at 75 km).
const KERBIN_ASCENT = synthesizeFlight({
  vesselName: "Demo Ascent",
  launchedAt: 1_700_000_000_000,
  samples: {
    "v.name": [[0, "Demo Ascent"]],
    "v.missionTime": [
      [0, 0],
      [10_000, 10],
      [60_000, 60],
      [120_000, 120],
      [240_000, 240],
      [300_000, 300],
    ],
    "v.body": [[0, "Kerbin"]],
    "v.altitude": [
      [0, 80],
      [10_000, 1_500],
      [60_000, 25_000],
      [120_000, 60_000],
      [240_000, 75_000],
      [300_000, 75_500],
    ],
    "v.horizontalVelocity": [
      [0, 0],
      [10_000, 80],
      [60_000, 600],
      [120_000, 1_400],
      [240_000, 2_280],
      [300_000, 2_287],
    ],
  },
});

describe("OrbitalAscent — integration via FlightReplayDataSource", () => {
  let fixture: ReplayDataSourceFixture;

  beforeEach(async () => {
    clearBodies();
    registerStockBodies();
    // The shared installDomStubs ResizeObserver never fires; LineChart needs
    // a non-null `size` to render its SVG paths. Stub one that fires once.
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
    fixture = await setupReplayDataSource({ fixture: KERBIN_ASCENT });
  });

  afterEach(() => {
    teardownReplayDataSource(fixture);
    clearBodies();
    vi.unstubAllGlobals();
  });

  function renderAscent() {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "ascent-replay" }}>
        <OrbitalAscentComponent config={{}} id="ascent-replay" />
      </DashboardItemContext.Provider>,
    );
  }

  it("renders the reference curve once v.body is replayed past launch", async () => {
    const { container } = renderAscent();
    act(() => {
      // First few seconds of the flight — v.body lands and the curve mounts.
      fixture.replay.advance(1_000);
    });
    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });

  it("plays the whole ascent and ends with both the curve and a live trace path", async () => {
    const { container } = renderAscent();

    act(() => {
      // Run every sample in the fixture — same shape as a real e2e replay.
      fixture.replay.advance(fixture.replay.duration());
    });

    await waitFor(() => {
      // Reference curve (dashed) and live trace (solid) both present.
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
      const solidPaths = Array.from(
        container.querySelectorAll("svg path"),
      ).filter((p) => !p.hasAttribute("stroke-dasharray"));
      expect(solidPaths.length).toBeGreaterThan(0);
    });
  });

  it("rewinding the replay re-anchors the widget to an earlier snapshot", async () => {
    renderAscent();
    await act(async () => {
      fixture.replay.advance(fixture.replay.duration());
    });
    // After playing through, current is the last v.body sample = "Kerbin"
    expect(fixture.replay.now()).toBe(KERBIN_ASCENT.flight.lastSampleAt);

    // The rewind re-emits the snapshot for every subscribed key, which
    // cascades through BufferedDataSource → FlightDetector (revert
    // detection) → React subscribers. Use async act so every follow-up
    // state update settles inside scope.
    await act(async () => {
      fixture.replay.seek(KERBIN_ASCENT.flight.launchedAt + 500);
    });
    expect(fixture.replay.now()).toBe(KERBIN_ASCENT.flight.launchedAt + 500);
  });
});
