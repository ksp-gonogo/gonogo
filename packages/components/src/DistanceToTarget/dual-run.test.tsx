import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import farApproach from "./__fixtures__/far-approach-vessel.json";
import { DistanceToTargetComponent } from "./index";

/**
 * DistanceToTarget's M3 vessel-gap batch behavior-preservation golden
 * dual-run (mirrors `CurrentOrbit/dual-run.test.tsx`, M3 batch-2): the SAME
 * tracking-mode target state, rendered once off the legacy `DataSource` and
 * once off the stream, must produce byte-identical DOM at `delay=0`.
 *
 * `far-approach-vessel` is a clean tracking-mode-only fixture (48 Mm range,
 * well past the docking/approach thresholds — the fixture's own `_meta`
 * note) — no dock.* readout is on-screen in this mode, so the dual-run only
 * needs to prove parity for the headline distance + Δv sub-readout, both now
 * DERIVED from `vessel.target`'s Vec3 fields
 * (`tar.relativePosition`/`tar.relativeVelocityVec`) rather than read
 * directly. `TAR_POS`/`TAR_VEL` are chosen purely along the z axis so the
 * derived distance/closing-rate land on EXACTLY the fixture's own
 * `tar.distance` (48,000,000) / `tar.o.relativeVelocity` (312.5) — no
 * legacy-leg override needed, unlike CurrentOrbit's own dual-run (whose
 * derived fields needed a body radius to match against).
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
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "tar.name" }, { key: "tar.type" }],
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "dtt-dual" }}>
          <DistanceToTargetComponent id="dtt-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("tar.name", farApproach["tar.name"]);
      legacyAux.source.emit("tar.type", farApproach["tar.type"]);
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
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
