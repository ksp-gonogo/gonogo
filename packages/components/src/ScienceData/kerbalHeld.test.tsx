import { DashboardItemContext } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ScienceDataComponent } from "./index";
import { kerbalHeldOf } from "./parsers";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sci-eva" }}>
        <ScienceDataComponent config={{}} id="sci-eva" w={8} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return fixture;
}

const KERBAL = {
  kerbalVesselId: "eva-1",
  name: "Maxwell Kerman",
  situation: "LANDED",
};

describe("Science Data: results a kerbal outside is holding", () => {
  it("lists a surface sample under the kerbal who holds it", async () => {
    const fixture = mount();

    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("eva.crew", {
        count: value("count", 1),
        kerbals: [KERBAL],
      });
    });
    act(() => {
      fixture.emit(`eva.kerbal.${KERBAL.kerbalVesselId}.state`, {
        ...KERBAL,
        heldData: [
          {
            subjectId: "surfaceSample@MunSrfLandedMidlands",
            title: "Surface Sample from The Mun's Midlands",
            dataAmount: 30,
          },
        ],
      });
    });

    await waitFor(() =>
      expect(visibleText()).toContain(
        "Maxwell Kerman holds Surface Sample from The Mun's Midlands",
      ),
    );
    expect(
      screen.getByLabelText("Science held by kerbals outside the vessel")
        .textContent,
    ).toContain("30");
  });

  it("lists nothing for a kerbal holding none or whose holdings were not read", async () => {
    const fixture = mount();

    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("eva.crew", {
        count: 2,
        kerbals: [
          KERBAL,
          { ...KERBAL, kerbalVesselId: "eva-2", name: "Dunbal Kerman" },
        ],
      });
    });
    act(() => {
      fixture.emit("eva.kerbal.eva-1.state", { ...KERBAL, heldData: [] });
      fixture.emit("eva.kerbal.eva-2.state", {
        ...KERBAL,
        kerbalVesselId: "eva-2",
        name: "Dunbal Kerman",
      });
    });

    await waitFor(() =>
      expect(visibleText()).toContain("No science data aboard"),
    );
    expect(
      screen.queryByLabelText("Science held by kerbals outside the vessel"),
    ).toBeNull();
  });
});

describe("kerbalHeldOf", () => {
  it("names the kerbal and falls back to the subject id when a result has no title", () => {
    expect(
      kerbalHeldOf(
        { kerbalVesselId: null, name: "Maxwell Kerman" },
        {
          name: "Maxwell Kerman",
          heldData: [
            {
              subjectId: "evaReport@Mun",
              title: null,
              dataAmount: value("Mit", 8),
            },
          ],
        },
      ),
    ).toEqual([
      {
        key: "Maxwell Kerman/evaReport@Mun",
        kerbal: "Maxwell Kerman",
        title: "evaReport@Mun",
        dataAmount: value("Mit", 8),
      },
    ]);
  });

  it("reads nothing from no state or a kerbal whose holdings were not read", () => {
    const member = { kerbalVesselId: "eva-1", name: "Dunbal Kerman" };
    expect(kerbalHeldOf(member, undefined)).toEqual([]);
    expect(kerbalHeldOf(member, { name: "Dunbal Kerman" })).toEqual([]);
  });

  it("reads the bare number a per-kerbal Topic carries as mits", () => {
    const [result] = kerbalHeldOf(
      { kerbalVesselId: "eva-1" },
      {
        name: "Maxwell Kerman",
        heldData: [
          { subjectId: "evaReport@Mun", title: "EVA", dataAmount: 8 as never },
        ],
      },
    );
    expect(result.dataAmount).toEqual(value("Mit", 8));
  });
});
