import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { clearReckoners } from "@ksp-gonogo/sitrep-client";
import { registerCoreReckoners } from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installRendezvousBox } from "../test/rendezvousBox";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RendezvousComponent } from "./index";

/**
 * The orbit-frame readout takes only room that is otherwise empty: a tall box
 * has a strip below the circle, a box the circle and figures fill has none.
 */

const TARGET = {
  name: "Test Station",
  kind: 0,
  vesselId: "target-vessel",
  bodyIndex: null,
  relativePosition: { x: 0, y: 0, z: 1800 },
  relativeVelocity: { x: 0, y: 0, z: -4.7 },
  orbitRelativePosition: { x: 12, y: -399, z: 3 },
  orbitRelativeVelocity: { x: 0.2, y: 0.4, z: -0.1 },
};

let restoreBox: (() => void) | undefined;
afterEach(() => {
  restoreBox?.();
  clearActionHandlers();
});
beforeEach(() => {
  clearReckoners();
  registerCoreReckoners();
});

async function mountWith(
  box: { w: number; h: number },
  target: Record<string, unknown>,
) {
  restoreBox = installRendezvousBox(box);
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "frame" }}>
        <RendezvousComponent id="frame" w={5} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.target", target);
  });
  await waitFor(() => expect(visibleText()).toContain("1.8 km"));
  // Holds the act scope across the frame the emit scheduled, which would otherwise land after the test body returns.
  await act(async () => {});
}

describe("Rendezvous orbit-frame readout", () => {
  it("shows where the target is along the craft's orbit and how it drifts, in a tall box", async () => {
    await mountWith({ w: 290, h: 1000 }, TARGET);
    const block = document.querySelector("[data-frame-readout]");
    expect(block).not.toBeNull();
    const rows = [...(block?.querySelectorAll("[data-frame-axis]") ?? [])];
    expect(rows.map((r) => r.getAttribute("data-frame-axis"))).toEqual([
      "alongTrack",
      "radial",
      "normal",
    ]);
    const text = (block?.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("Behind");
    expect(text).toContain("399");
    expect(text).toContain("Above");
    expect(text).toContain("Left");
    // The target is behind and moving forward, so the along-track offset is shrinking.
    expect(
      rows[0]
        .querySelector("[data-range-rate]")
        ?.getAttribute("data-range-rate"),
    ).toBe("closing");
  });

  it("takes no room from a box the circle and figures fill", async () => {
    await mountWith({ w: 926, h: 772 }, TARGET);
    expect(document.querySelector("[data-frame-readout]")).toBeNull();
  });

  it("shows nothing while the wire carries no orbit-frame fields", async () => {
    await mountWith(
      { w: 290, h: 1000 },
      {
        ...TARGET,
        orbitRelativePosition: null,
        orbitRelativeVelocity: null,
      },
    );
    expect(document.querySelector("[data-frame-readout]")).toBeNull();
  });
});
