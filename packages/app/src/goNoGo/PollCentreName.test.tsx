import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PollCentreName } from "./PollCentreName";

const KSC = "ground:Kerbal Space Center";

function renderName(centre: string | null) {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <PollCentreName centre={centre} />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit(
      "commandCentre.roster",
      [{ id: KSC, displayName: "KSC", active: true, isHome: true }],
      { vantage: KSC },
    );
    fixture.store.beginFrame();
  });
  return view;
}

describe("PollCentreName", () => {
  it("draws its 'Poll at' label where it can be seen, so the name is not read as a second command centre picker", async () => {
    renderName(KSC);
    const label = await screen.findByText("Poll at");
    expect(label.classList.contains("sr-only")).toBe(false);
    expect(label.parentElement?.textContent).toContain("KSC");
  });

  it("draws nothing when the poll has no centre", () => {
    const { container } = renderName(null);
    expect(container.textContent).toBe("");
  });
});
