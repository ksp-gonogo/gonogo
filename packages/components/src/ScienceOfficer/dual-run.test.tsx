import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import mobileLabIdle from "./__fixtures__/mobile-lab-idle-one-instrument.json";
import { ScienceOfficerComponent } from "./index";

/**
 * ScienceOfficer's behavior-preservation golden dual-run (mirrors
 * `PowerSystems/dual-run.test.tsx`): the SAME idle-lab + single-instrument
 * state, rendered once off a plain legacy `DataSource` (fed the fixture's
 * legacy-shape keys straight, untranslated) and once with `science.lab` AND
 * `science.instruments` genuinely carried over the stream, must produce
 * byte-identical DOM at `delay=0`. `science.lab` has no legacy key at all
 * (M3 science/parts batch) — its leg proves the read-layer swap itself
 * (legacy `DataSource` read vs `TelemetryProvider`-routed stream read of the
 * identical topic name) is a no-op, independent of whether a prior legacy
 * key ever existed. `science.instruments` (P4a shared-map batch) DOES have
 * a legacy `sci.instruments` predecessor with a different wire shape
 * (`partId` as a number, `partTitle`/`expId`/`hasData` instead of
 * `partName`/`experimentId`/`dataIsCollectable`) — its leg instead hand-
 * translates the fixture's legacy instrument entry into the new
 * `InstrumentEntry` shape and proves `parseInstruments` normalizes both to
 * an identical `Instrument`, so the DOM stays byte-identical across the
 * rename too.
 */
afterEach(() => {
  cleanup();
});

describe("ScienceOfficer — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off a plain legacy DataSource for the same idle-lab payload", async () => {
    const mode = { name: "default-6x7", w: 6, h: 7 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: ScienceOfficerComponent,
      fixture: mobileLabIdle,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["science.lab", "science.instruments"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: Object.keys(mobileLabIdle)
        .filter(
          (k) =>
            k !== "_meta" && k !== "science.lab" && k !== "sci.instruments",
        )
        .map((key) => ({ key })),
      connectSource: true,
    });

    const [legacyInstrument] = mobileLabIdle["sci.instruments"];

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "so-dual" }}>
          <ScienceOfficerComponent id="so-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const [key, value] of Object.entries(mobileLabIdle)) {
        if (
          key === "_meta" ||
          key === "science.lab" ||
          key === "sci.instruments"
        )
          continue;
        legacyAux.source.emit(key, value);
      }
      // Same instrument, translated into the new science.instruments wire
      // shape (partId stringified, field renames) — proves parseInstruments
      // reconciles both shapes to the same rendered output.
      streamFixture.emit("science.instruments", [
        {
          partId: String(legacyInstrument.partId),
          partName: legacyInstrument.partTitle,
          experimentId: legacyInstrument.expId,
          deployed: legacyInstrument.deployed,
          inoperable: legacyInstrument.inoperable,
          rerunnable: legacyInstrument.rerunnable,
          dataIsCollectable: legacyInstrument.hasData,
        },
      ]);
      streamFixture.emit("science.lab", mobileLabIdle["science.lab"]);
    });

    await waitFor(() => {
      if (!container.textContent?.includes("Mobile Processing Lab MPL-LG-2")) {
        throw new Error("stream leg has not rendered the lab status yet");
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
