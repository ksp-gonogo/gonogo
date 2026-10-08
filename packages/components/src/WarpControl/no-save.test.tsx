import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

describe("WarpControl outside a warpable scene", () => {
  afterEach(() => {
    clearActionHandlers();
  });

  it("names the missing save and says nothing more", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "warp-no-save" }}>
          <WarpControlComponent id="warp-no-save" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "Editor" });
    });

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("No active save");
    expect(banner.textContent).toBe("No active save");
    expect(document.body.textContent).not.toMatch(/Tracking Station/);
    await expectNoA11yViolations(container);
  });
});
