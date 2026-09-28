import type { VesselTopology } from "@ksp-gonogo/core";
import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
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
 * The same solar-charging scenario rendered with and without `parts.power` carried must produce identical DOM at `delay=0`.
 *
 * The fixture's three producers sum to exactly 49.55 EC/s and the streamed `totalProductionEc` matches it, so an agreeing measurement adds nothing.
 */

describe("PowerSystems: behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup with parts.power carried as without it, when totalProductionEc matches the topology-summed total", async () => {
    const mode = { name: "default-8x12", w: 8, h: 12 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: PowerSystemsComponent,
      fixture: charging,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
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
      // Topology and per-part resources both ride the one `vessel.parts` payload.
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
      if (!visibleText(container).includes("+49.55")) {
        throw new Error("stream leg has not rendered the merged total yet");
      }
      if (visibleText(container).includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
