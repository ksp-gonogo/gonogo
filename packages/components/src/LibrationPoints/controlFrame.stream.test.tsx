import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import followsControlFrame from "./__fixtures__/low-kerbin-orbit-mun-control-frame.json";
import type { LibrationPointsConfig } from "./config";
import { LibrationPointsComponent } from "./index";

/**
 * Auto follows a rotating Control Frame's pair ahead of proximity. The scene
 * is a low Kerbin orbit, where proximity alone picks Kerbol-Kerbin, under a
 * Kerbin-Mun Control Frame, so the two rules name different pairs.
 */

const EMITS = followsControlFrame._stream.emits;
const CONTROL_FRAME = EMITS.find((e) => e.channel === "system.frame")?.value;

function mount(
  config: LibrationPointsConfig,
  opts: { frame?: unknown; craft?: boolean } = {},
) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "lp" }}>
        <LibrationPointsComponent config={config} id="lp" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    for (const e of EMITS) {
      if (e.channel === "system.frame") continue;
      if (opts.craft === false && e.channel.startsWith("vessel.")) continue;
      fixture.emit(e.channel, e.value);
    }
    if (opts.frame !== undefined) fixture.emit("system.frame", opts.frame);
  });
  return view;
}

async function drawnPair(view: { container: HTMLElement }) {
  return await waitFor(() => {
    const svg = view.container.querySelector("[data-libration-frame]");
    if (svg === null) throw new Error("nothing drawn yet");
    return svg.getAttribute("data-libration-pair");
  });
}

describe("LibrationPoints: Auto follows a rotating Control Frame", () => {
  it("picks the nearest pair by proximity when no Control Frame is reported", async () => {
    const view = mount({});
    expect(await drawnPair(view)).toBe("Kerbol-Kerbin");
    await act(async () => {});
  });

  it("draws the Control Frame's pair where proximity would pick another", async () => {
    const view = mount({}, { frame: CONTROL_FRAME });
    expect(await drawnPair(view)).toBe("Kerbin-Mun");
    await expectNoA11yViolations(view.container);
  });

  it("leaves an explicit pin in place under a Control Frame", async () => {
    const view = mount({ pair: "Minmus" }, { frame: CONTROL_FRAME });
    expect(await drawnPair(view)).toBe("Kerbin-Minmus");
    await act(async () => {});
  });

  it("falls through to proximity when the Control Frame's pair is not parent and child", async () => {
    const view = mount(
      {},
      { frame: { kind: 4, primaryBody: "Kerbol", secondaryBody: "Mun" } },
    );
    expect(await drawnPair(view)).toBe("Kerbol-Kerbin");
    await act(async () => {});
  });

  it("says nothing about a craft when there is none", async () => {
    const view = mount({}, { frame: CONTROL_FRAME, craft: false });
    expect(await drawnPair(view)).toBe("Kerbin-Mun");
    await waitFor(() =>
      expect(view.container.textContent).toContain("Mass ratio"),
    );
    expect(view.container.textContent).not.toContain("Craft");
    expect(view.container.textContent).not.toContain("not placeable");
    await expectNoA11yViolations(view.container);
  });
});
