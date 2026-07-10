import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import farApproach from "./__fixtures__/far-approach-vessel.json";
import { DistanceToTargetComponent } from "./index";

/**
 * DistanceToTarget's R6 de-Telemachus behavior-preservation golden dual-run:
 * the SAME tracking-mode target state, rendered once off the legacy
 * `DataSource` and once off the stream, must produce byte-identical DOM at
 * `delay=0`.
 *
 * Both legs now DERIVE the headline distance + Δv sub-readout from
 * `vessel.target`'s Vec3 fields (`tar.relativePosition` /
 * `tar.relativeVelocityVec`) — the legacy `tar.distance` /
 * `tar.o.relativeVelocity` scalar reads and their Telemachus fallbacks are
 * dropped. `far-approach-vessel` is a clean tracking-mode-only fixture (48 Mm
 * range, well past the docking/approach thresholds), so no dock.* readout is
 * on-screen. The STREAM leg has **no legacy `"data"` MockDataSource leg at
 * all** — the R6 read-fallback drop for this widget: `tar.name` rides
 * `vessel.target.name` and `tar.type` (mapped to the uncarried
 * `vessel.state.targetKind`) simply resolves to `undefined`, which — at 48 Mm,
 * far past every threshold — leaves the widget in tracking mode exactly as the
 * legacy leg's `Vessel` type does, so the rendered DOM matches.
 *
 * `TAR_POS`/`TAR_VEL` are chosen purely along the z axis so the derived
 * distance/closing-rate land on EXACTLY the fixture's own Vec3 values (48 Mm /
 * +312.5 m/s opening) — the legacy leg reads those same Vec3s off the fixture.
 */
afterEach(() => {
  cleanup();
});

const TAR_POS = { x: 0, y: 0, z: 48_000_000 };
const TAR_VEL = { x: 0, y: 0, z: 312.5 };

describe("DistanceToTarget — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same tracking-mode target", async () => {
    const mode = { name: "default-6x9", w: 6, h: 9 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: DistanceToTargetComponent,
      fixture: farApproach,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.target"],
      pinnedUt: 10,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-dual" }}>
          <DistanceToTargetComponent id="dtt-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit("vessel.target", {
        name: farApproach["tar.name"],
        kind: 0,
        vesselId: "target-vessel",
        bodyIndex: null,
        relativePosition: TAR_POS,
        relativeVelocity: TAR_VEL,
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("48.00 Mm")) {
        throw new Error("stream leg has not rendered distance yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);

    expect(streamHtml).toBe(legacyHtml);
  });
});
