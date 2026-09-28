import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor, within } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import mobileLabIdle from "./__fixtures__/mobile-lab-idle-one-instrument.json";
import { ExperimentsComponent } from "./index";

/**
 * The widget renders the full idle-lab and single-instrument state off the real
 * stream pipeline, with `science.instruments` in its `InstrumentEntry` wire shape.
 */
describe("Experiments: stream render golden (delay=0)", () => {
  it("renders the full idle-lab + instrument state off the stream pipeline", async () => {
    const mode = { name: "default-6x7", w: 6, h: 7 };

    const streamFixture = setupStreamFixture({
      suspendFrames: true,
      pinnedUt: 10,
    });

    const [legacyInstrument] = mobileLabIdle["sci.instruments"];

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "so-dual" }}>
          <ExperimentsComponent id="so-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
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
      if (!visibleText(container).includes("Mobile Processing Lab MPL-LG-2")) {
        throw new Error("stream leg has not rendered the lab status yet");
      }
      if (visibleText(container).includes("SYNCING")) {
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
