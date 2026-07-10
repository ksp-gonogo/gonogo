import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import valentinaSoloOrbit from "./__fixtures__/valentina-solo-orbit.json";
import { CrewManifestComponent } from "./index";

/**
 * CrewManifest's M3 batch-4 behavior-preservation golden dual-run (mirrors
 * `ThermalStatus/dual-run.test.tsx`, batch 1): the SAME crew state, rendered
 * once off the legacy `DataSource` and once off the stream, must produce
 * byte-identical DOM at `delay=0`.
 *
 * `valentina-solo-orbit` populates every field the widget reads (`v.crew`,
 * `v.crewCount`, `v.crewCapacity`, `v.isEVA`) so the full roster renders on
 * both legs. P4a shared-map batch (G-13) un-gapped `v.crew` and
 * `v.crewCapacity` alongside the already-mapped `v.crewCount` — all three
 * now land on the single `vessel.crew` wire channel, so the stream leg
 * emits them together. Only `v.isEVA` (see `stream.test.tsx`'s doc comment)
 * still reads off a legacy AUX source in the stream leg.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = ["v.isEVA"] as const;

describe("CrewManifest — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same crew state", async () => {
    const mode = { name: "default-6x8", w: 6, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: CrewManifestComponent,
      fixture: valentinaSoloOrbit,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.crew"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: GAPPED_KEYS.map((key) => ({ key })),
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "crew-dual" }}>
          <CrewManifestComponent id="crew-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const key of GAPPED_KEYS) {
        legacyAux.source.emit(
          key,
          valentinaSoloOrbit[key as keyof typeof valentinaSoloOrbit],
        );
      }
      streamFixture.emit("vessel.crew", {
        count: valentinaSoloOrbit["v.crewCount"],
        capacity: valentinaSoloOrbit["v.crewCapacity"],
        crew: valentinaSoloOrbit["v.crew"].map((name) => ({ name })),
      });
    });

    // Wait on the subtitle text the stream leg's mapped vessel.crew
    // emission produces (crew count vs. capacity) so we don't race ahead
    // of the store propagating it.
    await waitFor(() => {
      if (!container.textContent?.includes("1 / 1 aboard")) {
        throw new Error("stream leg has not rendered crew count yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
