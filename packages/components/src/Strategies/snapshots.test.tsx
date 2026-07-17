import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  stripVolatile,
  type WidgetSnapshotMode,
} from "../test/widgetDomSnapshot";
import atCap from "./__fixtures__/at-admin-cap.json";
import unavailable from "./__fixtures__/feature-unavailable.json";
import highCommit from "./__fixtures__/high-commitment-conversion.json";
import noStrategies from "./__fixtures__/no-strategies-early-career.json";
import oneActive from "./__fixtures__/one-active-room-for-more.json";
import overCap from "./__fixtures__/over-cap-quirk.json";
import { StrategiesComponent } from "./index";

const FIXTURES = {
  "no-strategies-early-career": noStrategies,
  "one-active-room-for-more": oneActive,
  "at-admin-cap": atCap,
  "over-cap-quirk": overCap,
  "high-commitment-conversion": highCommit,
  "feature-unavailable": unavailable,
};

const config = getWidget("strategies");
if (!config) throw new Error("strategies missing from widgets.ts");

interface CareerFixture {
  "strategies.all": unknown[] | null;
  "career.funds": number | null;
  "career.reputation": number | null;
  "career.science": number | null;
}

/**
 * DOM snapshots. The widget reads its whole career snapshot
 * off the canonical `career.status` Topic (no legacy fallback), so — unlike
 * the shared legacy `snapshotWidgetMode` helper, which seeds a
 * `MockDataSource` — these snapshots feed the fixture through a real stream
 * pipeline (`setupStreamFixture`). The per-strategy entries are emitted
 * VERBATIM (the fixtures already carry `departmentName`/`effectiveCostReputation`,
 * both of which `parseStrategies` reads directly), so the rendered strategy
 * cards are byte-identical to the pre-migration legacy render; the only
 * difference vs. the old baseline is the stream-status badge (a live stream
 * shows no "OFFLINE" badge).
 */
async function streamSnapshot(
  fixture: CareerFixture,
  mode: WidgetSnapshotMode,
): Promise<string> {
  const stream = setupStreamFixture({
    carriedChannels: ["career.status"],
    pinnedUt: 10,
  });

  const all = fixture["strategies.all"];
  const active =
    all === null
      ? []
      : all.filter((s) => (s as { isActive?: boolean }).isActive === true);

  const { container } = render(
    <stream.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
        <StrategiesComponent
          config={mode.config ?? {}}
          id="snap"
          w={mode.w}
          h={mode.h}
        />
      </DashboardItemContext.Provider>
    </stream.Provider>,
  );

  act(() => {
    stream.emit("career.status", {
      economy: {
        funds: fixture["career.funds"],
        reputation: fixture["career.reputation"],
        science: fixture["career.science"],
      },
      facilities: null,
      contracts: null,
      strategies:
        all === null ? null : { active, all, activeCount: active.length },
      tech: null,
    });
  });

  // Wait for the emitted `career.status` to land in the store (fixture-
  // independent — every fixture emits it, even the null "feature-unavailable"
  // one). The same `notifyStore` that makes it samplable drives the widget's
  // `useSyncExternalStore` subscription, so once it's present the DOM has
  // committed the read.
  await waitFor(() => {
    if (!stream.store.sample("career.status", stream.store.currentFrame())) {
      throw new Error("career.status not sampled yet");
    }
  });

  return stripVolatile(container.innerHTML);
}

describe("Strategies DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await streamSnapshot(fixture as CareerFixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
