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
 * both legs. Only `v.crewCount` is MAPPED (-> `vessel.crew.count`); the
 * other three (all GAPPED — see `stream.test.tsx`'s doc comment) read off a
 * legacy AUX source in the stream leg.
 */
afterEach(() => {
  cleanup();
});

const GAPPED_KEYS = ["v.crew", "v.crewCapacity", "v.isEVA"] as const;

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
      });
    });

    // "Valentina Kerman" alone isn't sufficient — that text comes from the
    // legacy AUX source's v.crew, which can land before the STREAM leg's
    // mapped vessel.crew emission has actually propagated through the
    // store. Wait on the subtitle text the stream leg alone produces (crew
    // count vs. capacity) so the race can't produce a false green.
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
