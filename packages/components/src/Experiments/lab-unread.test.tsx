import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ExperimentsComponent } from "./index";

/**
 * A lab whose operational and processing flags could not be read renders
 * UNREAD, never an OFFLINE verdict. Its own file so no other test's
 * `science.lab` sample carries into it.
 */

const renderedTrees: Array<() => void> = [];

function mount() {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sci-lab-unread" }}>
        <ExperimentsComponent config={{}} id="sci-lab-unread" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return fixture;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("Experiments: a lab whose status never arrived", () => {
  it("marks the lab unread instead of declaring it offline", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit("science.instruments", []);
      fixture.emit("science.lab", [
        {
          partName: "Mobile Processing Lab",
          dataStored: null,
          dataStorage: null,
          storedScience: null,
          processingData: null,
          statusText: null,
          scientistCount: null,
          scienceRate: null,
          isOperational: null,
        },
      ]);
    });

    await waitFor(() =>
      expect(screen.getByText("Mobile Processing Lab")).toBeInTheDocument(),
    );
    expect(screen.getByText("UNREAD")).toBeInTheDocument();
    expect(screen.queryByText("OFFLINE")).not.toBeInTheDocument();
    expect(screen.queryByText("OPERATIONAL")).not.toBeInTheDocument();
    expect(screen.queryByText("PROCESSING")).not.toBeInTheDocument();
  });
});
