import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { arrivalsOf } from "./arrivals";
import { ExperimentsComponent } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const INSTRUMENT = {
  partId: "77",
  partName: "Mystery Goo™ Containment Unit",
  experimentId: "mysteryGoo",
  title: "Mystery Goo Observation",
  deployed: false,
  inoperable: false,
  rerunnable: false,
  resettable: false,
  holdsData: false,
};

function mount() {
  const fixture = setupStreamFixture({ suspendFrames: true, pinnedUt: 10 });
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "arrivals" }}>
        <ExperimentsComponent id="arrivals" w={6} h={9} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return fixture;
}

describe("Experiments: transmissions that have arrived", () => {
  it("lists a result once it has arrived, with what it was and when it left the vessel", async () => {
    const fixture = mount();

    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [INSTRUMENT]);
      fixture.emit("science.transmissions", [
        {
          subjectId: "crewReport@KerbinSrfLanded",
          title: "Crew Report from Kerbin's Shores",
          dataAmount: 5,
          startedAt: 4,
          completedAt: 9,
        },
      ]);
    });

    await waitFor(() =>
      expect(visibleText()).toContain("Crew Report from Kerbin's Shores"),
    );
    const row = screen
      .getByText("Crew Report from Kerbin's Shores")
      .closest("li") as HTMLElement;
    expect(row.textContent).toContain("Arrived");
    expect(row.textContent).toContain("Left the vessel Y1 D1 00:00:09");
    expect(row.textContent).toContain("after 5");
    expect(row.textContent).toContain("5.0");
  });

  it("lists nothing before any result has arrived", async () => {
    const fixture = mount();

    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [INSTRUMENT]);
    });

    await waitFor(() => expect(visibleText()).toContain("Mystery Goo"));
    expect(screen.queryByText("Sent home")).toBeNull();
    expect(screen.queryByText("Arrived")).toBeNull();
  });

  it("lists the newest arrival first", async () => {
    const fixture = mount();

    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [INSTRUMENT]);
      fixture.emit("science.transmissions", [
        { subjectId: "a", title: "Older", dataAmount: 1, completedAt: 3 },
        { subjectId: "b", title: "Newer", dataAmount: 2, completedAt: 8 },
      ]);
    });

    await waitFor(() => expect(visibleText()).toContain("Newer"));
    expect(visibleText().indexOf("Newer")).toBeLessThan(
      visibleText().indexOf("Older"),
    );
  });
});

describe("arrivalsOf", () => {
  it("keeps an entry with no title or amount, and dates how long it took only when its start is known", () => {
    const arrivals = arrivalsOf([
      { subjectId: "a", completedAt: value("ut", 5) },
      {
        subjectId: "b",
        title: "Sent",
        dataAmount: value("Mit", 2),
        startedAt: value("ut", 1),
        completedAt: value("ut", 9),
      },
    ]);

    expect(arrivals?.map((a) => [a.title, a.size, a.sendTime])).toEqual([
      ["Sent", value("Mit", 2), value("s", 8)],
      ["a", null, null],
    ]);
  });

  it("answers null for a list that has not arrived, so absence is not an empty list", () => {
    expect(arrivalsOf(undefined)).toBeNull();
    expect(arrivalsOf(null)).toBeNull();
    expect(arrivalsOf([])).toEqual([]);
  });
});
