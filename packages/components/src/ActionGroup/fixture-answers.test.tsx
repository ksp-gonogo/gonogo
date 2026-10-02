import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { installCommandAnswers } from "../../scripts/probe/commandAnswers";
import { setupStreamFixture } from "../test/setupStreamFixture";
import fixture from "./__fixtures__/cold-pad-all-off.json";
import { ActionGroupComponent } from "./index";

afterEach(() => {
  clearActionHandlers();
});

describe("ActionGroup on its fixture's scripted answers", () => {
  it("flips ON then OFF through the stream when the toggle is pressed", async () => {
    const stream = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    const cancel = installCommandAnswers(stream, fixture._stream.answers);

    const { unmount } = render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-sas" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "SAS" }}
            id="ag-sas"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
    act(() => {
      for (const e of fixture._stream.emits) stream.emit(e.channel, e.value);
    });
    await screen.findByText("OFF");

    act(() => {
      screen.getByRole("button", { name: "Toggle SAS" }).click();
    });
    expect(await screen.findByText("ON")).toBeInTheDocument();

    act(() => {
      screen.getByRole("button", { name: "Toggle SAS" }).click();
    });
    expect(await screen.findByText("OFF")).toBeInTheDocument();

    cancel();
    unmount();
    await act(async () => {});
  });
});
