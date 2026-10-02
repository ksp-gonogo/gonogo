import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, within } from "@ksp-gonogo/test-utils";
import { getByTip } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  applyInstallProfile,
  fixtureProfiles,
  getInstallProfile,
  type InstallProfileStreamBlock,
} from "../test/installProfile";
import { setupStreamFixture } from "../test/setupStreamFixture";
import preLaunchMixed from "./__fixtures__/pre-launch-mixed.json";
import { LaunchDirectorComponent } from "./index";

/**
 * The same pre-launch scene under a stock career and under a career mod that
 * runs its own space centre: vanilla is not a degraded mode. Stock carries the
 * pads and their occupancy, so both installs render the same widget off the
 * same reads and differ ONLY in the pads.
 */
const SCENE = preLaunchMixed._stream as InstallProfileStreamBlock;

/** Replays a block one topic at a time, holding each until subscribed: `StubTransport` drops samples nobody reads. */
async function replay(
  fixture: ReturnType<typeof setupStreamFixture>,
  block: InstallProfileStreamBlock,
): Promise<void> {
  for (const emit of block.emits) {
    for (let frame = 0; frame < 30; frame++) {
      if (fixture.transport.isSubscribed(emit.channel)) break;
      await act(async () => {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      });
    }
    act(() => {
      fixture.emit(emit.channel, emit.value);
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });
  }
}

async function renderUnder(profileId: string) {
  const block = applyInstallProfile(getInstallProfile(profileId), SCENE);
  const fixture = setupStreamFixture({
    pinnedUt: block.pinnedUt,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: `ld-${profileId}` }}>
        <LaunchDirectorComponent id={`ld-${profileId}`} w={7} h={12} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  await replay(fixture, block);
  return { fixture, view };
}

/** Every pad row's leading name, in the order the widget put them in. */
function padNames(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole("button")
    .filter((b) => b.hasAttribute("data-pad-row"))
    .map((b) => b.firstElementChild?.firstElementChild?.textContent ?? "");
}

describe("LaunchDirector across declared installs", () => {
  it("is declared interesting under exactly the installs asserted below", () => {
    expect(fixtureProfiles(preLaunchMixed).sort()).toEqual([
      "planted-space-centre",
      "stock-career",
    ]);
  });

  it("lists the stock space centre's own pads on a career with no launch-complex mod", async () => {
    const { view } = await renderUnder("stock-career");

    expect(padNames(view.container)).toEqual([
      "KSC Launch Pad",
      "KSC Runway",
      "Woomerang",
    ]);
    // Stock answers pad occupancy: the KSC pad says clear and the silent sites say that.
    expect(screen.getByText("Clear")).toBeInTheDocument();
    expect(screen.getAllByText("Occupancy unreported")).toHaveLength(2);
    // And the whole launch flow is behind the open pad, not a stripped fallback.
    expect(screen.getByText(/Craft · 1\/2 ready/)).toBeInTheDocument();
    expect(screen.getByText("Mun Hopper I")).toBeInTheDocument();
    expect(getByTip(document.body, "Available funds")).toBeInTheDocument();
  });

  it("renders the same widget, the same way, on a career mod's own pads", async () => {
    const { view } = await renderUnder("planted-space-centre");

    // A different space centre entirely, off the same read.
    expect(padNames(view.container)).toEqual([
      "Planted Site 1",
      "Planted Site 2",
      "KSC Runway",
    ]);
    // The mod's sites are silent about stock occupancy, and the row says so rather than claiming clear.
    expect(screen.getAllByText("Occupancy unreported")).toHaveLength(3);
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
    // Same shape, same controls, same funds rule.
    expect(screen.getByText(/Craft · 1\/2 ready/)).toBeInTheDocument();
    expect(screen.getByText("Mun Hopper I")).toBeInTheDocument();
    expect(getByTip(document.body, "Available funds")).toBeInTheDocument();
  });

  it("reads nothing off the career mod's own channels even where they are live", async () => {
    // An Uplink adds to a pad row; the widget subscribes to none of its channels.
    const { fixture } = await renderUnder("planted-space-centre");

    for (const channel of [
      "planted.pads",
      "planted.operations",
      "planted.complexes",
    ]) {
      expect(fixture.transport.isSubscribed(channel)).toBe(false);
    }
  });
});
