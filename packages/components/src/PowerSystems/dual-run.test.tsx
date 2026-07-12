import type { VesselTopology } from "@ksp-gonogo/core";
import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  extractLegacyPartLiveFromFixture,
  topologyToVesselPartsWire,
} from "../test/topologyToVesselPartsWire";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import charging from "./__fixtures__/03-solar-charging-sunlight.json";
import { PowerSystemsComponent } from "./index";

/**
 * PowerSystems' behavior-preservation golden
 * dual-run (mirrors `DistanceToTarget/dual-run.test.tsx`): the SAME
 * solar-charging scenario, rendered once via `vessel.parts`-carried
 * resources (both legs now — `usePartsLive` reads the per-part `resources`
 * join off `vessel.parts`, not the legacy `DataSource`) and once with
 * `parts.power` ALSO carried (`totalProductionEc` wins the merge), must
 * produce byte-identical DOM at `delay=0`. `03-solar-charging-sunlight`'s
 * three producers sum to exactly 49.55 EC/s (24.4 + 24.4 + 0.75) — the
 * stream leg's `totalProductionEc` is chosen to match that exactly (NET
 * nets that against the fixture's own -0.05 consumer either way), proving
 * the merge is a genuine no-op parity case, not a coincidence of rounding.
 */
afterEach(() => {
  cleanup();
});

describe("PowerSystems — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup with parts.power carried as without it, when totalProductionEc matches the topology-summed total", async () => {
    const mode = { name: "default-8x12", w: 8, h: 12 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: PowerSystemsComponent,
      fixture: charging,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["parts.power", "vessel.parts"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(charging)
        .filter(
          (k) => k !== "_meta" && k !== "v.topology" && k !== "v.topologySeq",
        )
        .map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ps-dual" }}>
          <PowerSystemsComponent id="ps-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const [key, value] of Object.entries(charging)) {
        if (
          key === "_meta" ||
          key === "v.topology" ||
          key === "v.topologySeq"
        ) {
          continue;
        }
        legacyAux.source.emit(key, value);
      }
      // v.topology now streams via vessel.parts (useTopology reads it
      // canonically) — the same topology payload, reshaped to the wire
      // shape, instead of the legacy AUX emission above. The fixture's
      // r.resourceFor[fid] rows ride the SAME payload now too (usePartsLive
      // reads resources off vessel.parts, not the legacy DataSource) —
      // extracted and folded in here rather than left on the now-inert
      // legacyAux emission a few lines up.
      streamFixture.emit(
        "vessel.parts",
        topologyToVesselPartsWire(
          charging["v.topology"] as VesselTopology,
          extractLegacyPartLiveFromFixture(charging),
        ),
      );
      streamFixture.emit("parts.power", {
        solarPanels: [],
        batteries: [],
        fuelCells: [],
        alternators: [],
        totalProductionEc: 49.55,
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("+49.55")) {
        throw new Error("stream leg has not rendered the merged total yet");
      }
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
