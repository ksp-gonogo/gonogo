import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import kerbinSuborbital from "./__fixtures__/kerbin-suborbital-prograde-node.json";
import { ManeuverPlannerComponent } from "./index";

/**
 * ManeuverPlanner's M3 vessel-gap batch behavior-preservation golden
 * dual-run (mirrors `CurrentOrbit/dual-run.test.tsx`): the SAME planned-node
 * state, rendered once off the legacy `DataSource` and once with a
 * `TelemetryProvider` mounted alongside it, must produce byte-identical DOM
 * at `delay=0`.
 *
 * Unlike the other two widgets in this batch, the migrated surface here
 * (`o.maneuverNodeIds` -> `vessel.maneuver.nodes`, feeding `resolveNodeId`)
 * is entirely DOM-INVISIBLE — no node id is ever rendered, only used to
 * build the update/remove command's args (see stream.test.tsx for that
 * proof). Every field this widget actually RENDERS (`o.maneuverNodes`
 * itself, `o.sma`/`o.eccentricity`/etc.) stays legacy either way — this
 * dual-run's job is simply proving that mounting the `TelemetryProvider`
 * alongside the existing legacy `DataSource` (the real production shape
 * once ANY widget on a screen migrates) doesn't perturb this widget's own
 * still-fully-legacy rendering at all. `carriedChannels` deliberately
 * carries ONLY `vessel.maneuver` — none of this widget's OTHER keys that
 * happen to have a mapTopic home from earlier M3 batches
 * (`o.ApA`/`o.PeA`/`o.trueAnomaly`/`o.period`/`o.timeToAp`/`o.timeToPe`, all
 * -> `vessel.state.*`) are carried, so they all correctly stay on the
 * legacy read on both legs (`useDataValue`'s `carried` gate), matching
 * `snapshotWidgetMode`'s pure-legacy baseline exactly.
 */
afterEach(() => {
  cleanup();
});

describe("ManeuverPlanner — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup with a TelemetryProvider mounted (vessel.maneuver carried) as fully legacy", async () => {
    const mode = { name: "default-10x18", w: 10, h: 18 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: ManeuverPlannerComponent,
      fixture: kerbinSuborbital,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.maneuver"],
      pinnedUt: 10,
    });
    const fixtureKeys = Object.keys(kerbinSuborbital).filter(
      (k) => k !== "_meta",
    );
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: fixtureKeys.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-dual" }}>
          <ManeuverPlannerComponent
            id="mnv-dual"
            config={{}}
            w={mode.w}
            h={mode.h}
          />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of fixtureKeys) {
        legacyAux.source.emit(
          key,
          (kerbinSuborbital as Record<string, unknown>)[key],
        );
      }
      // vessel.maneuver itself is DOM-invisible (see doc comment above) —
      // emitted purely to prove its presence doesn't perturb anything.
      streamFixture.emit("vessel.maneuver", {
        nodes: [
          {
            id: "dual-run-node-id",
            ut: kerbinSuborbital["o.maneuverNodes"][0].UT,
            dvRadial: 0,
            dvNormal: 0,
            dvPrograde: 300,
            dvTotal: 300,
          },
        ],
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("Planned nodes")) {
        throw new Error("stream leg has not rendered yet");
      }
    });
    // The migrated read (o.maneuverNodeIds -> vessel.maneuver) is DOM-
    // invisible, so the ONLY stream-dependent chrome is the title-row status
    // badge — it starts "SYNCING" and clears to nothing once the emitted
    // vessel.maneuver frame commits at the pinned viewUt (validAt 0 <= 10 ->
    // live). "Planned nodes" comes from the legacy o.maneuverNodes read and
    // lands a frame earlier, so wait specifically on the badge clearing
    // before snapshotting, else we'd race a still-SYNCING stream leg against
    // the badge-less legacy leg.
    await waitFor(() => {
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status badge has not cleared to live yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
