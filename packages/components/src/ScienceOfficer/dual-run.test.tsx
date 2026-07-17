import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import mobileLabIdle from "./__fixtures__/mobile-lab-idle-one-instrument.json";
import { ScienceOfficerComponent } from "./index";
import { renderWithTheme } from "./testTheme";

/**
 * ScienceOfficer's stream render golden. This began life as a
 * legacy-`DataSource`↔stream byte-identical dual-run (comparing `science.lab`
 * + `science.instruments` streamed against every other fixture key staying
 * legacy); with the widget now reading its whole state off canonical Topics
 * (`science.instruments`/`science.experiments`/`science.lab`), there is no
 * legacy read path left to compare against — same "the legacy leg is gone"
 * story as `LaunchDirector/dual-run.test.tsx`'s own doc comment. What remains
 * proves the widget renders the full idle-lab + single-instrument state
 * correctly off the real stream pipeline (`TelemetryProvider` +
 * `TelemetryClient`/`TimelineStore`), using the SAME `mobile-lab-idle`
 * fixture, with `science.instruments` emitted in its NEW `InstrumentEntry`
 * wire shape (string `partId`, `partName`/`experimentId`/`dataIsCollectable`)
 * to prove `parseInstruments` reconciles it to the same rendered output.
 */
describe("ScienceOfficer — stream render golden (delay=0)", () => {
  it("renders the full idle-lab + instrument state off the stream pipeline", async () => {
    const mode = { name: "default-6x7", w: 6, h: 7 };

    const streamFixture = setupStreamFixture({
      carriedChannels: [
        "science.lab",
        "science.instruments",
        "science.experiments",
      ],
      pinnedUt: 10,
    });

    const [legacyInstrument] = mobileLabIdle["sci.instruments"];

    const { container } = renderWithTheme(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "so-dual" }}>
          <ScienceOfficerComponent id="so-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      // Same instrument, translated into the new science.instruments wire
      // shape (partId stringified, field renames) — proves parseInstruments
      // reconciles it to the same rendered output.
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

    const scope = within(container);
    expect(scope.getByText("Mobile Processing Lab MPL-LG-2")).toBeTruthy();
    expect(scope.getByText("OPERATIONAL")).toBeTruthy();
    expect(scope.getByText("2 scientists")).toBeTruthy();
    expect(scope.getByText("Mystery Goo™ Containment Unit")).toBeTruthy();
    expect(scope.getByText("mysteryGoo")).toBeTruthy();
  });
});
