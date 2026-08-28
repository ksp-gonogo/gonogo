import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, within } from "@ksp-gonogo/test-utils";
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
 * The same pre-launch scene under a stock career and under RP-1, which is the
 * claim this widget's rekey rests on: **vanilla is not a degraded mode.**
 *
 * A pad list needs two things from the wire, and stock carries both. Which pads
 * exist is `spaceCenter.launchSites`; whether one is holding a vessel is
 * `padOccupied`/`padVesselTitle` on the same entries. So an install with no
 * launch-complex mod running renders the SAME widget off the SAME reads, with a
 * different set of pads on it, rather than a stripped-down fallback that an RP-1
 * install replaces.
 *
 * What changes between the two cases below is only the install: the craft, the
 * crew and the balance are one scene. Under RP-1 the `rp1.*` channels are live
 * and the widget does not read one of them: what RP-1 knows about a pad reaches
 * the row through `launch-director.pad`, and this package cannot load that
 * Uplink's client, so the two renders here differ ONLY in the pads themselves.
 */
const SCENE = preLaunchMixed._stream as InstallProfileStreamBlock;

/**
 * Replays a profiled block one topic at a time, holding each until something has
 * subscribed: `StubTransport` drops a sample for a topic nobody is reading and
 * does not replay it, and the craft list only mounts once the pads have landed
 * and a pad row has opened.
 */
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
    carriedChannels: block.carriedChannels,
    pinnedUt: block.pinnedUt,
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
      "rp1-testflight",
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
    // Stock answers pad occupancy, so the widget's subject is fully served here:
    // the KSC pad says it is clear and the sites that report nothing say that.
    expect(screen.getByText("Clear")).toBeInTheDocument();
    expect(screen.getAllByText("Occupancy unreported")).toHaveLength(2);
    // And the whole launch flow is behind the open pad, not a stripped fallback.
    expect(screen.getByText(/Craft · 1\/2 ready/)).toBeInTheDocument();
    expect(screen.getByText("Mun Hopper I")).toBeInTheDocument();
    expect(screen.getByTitle("Available funds")).toBeInTheDocument();
  });

  it("renders the same widget, the same way, on the RP-1 install's own pads", async () => {
    const { view } = await renderUnder("rp1-testflight");

    // A different space centre entirely, off the same read.
    expect(padNames(view.container)).toEqual([
      "Cape Canaveral LC-1",
      "Cape Canaveral LC-5",
      "KSC Runway",
    ]);
    // Every RP-1 pad is silent about stock occupancy (the mod derives it on the
    // stock VAB pad alone), and the row says so rather than claiming it is
    // clear. What RP-1 knows arrives through the per-pad slot instead.
    expect(screen.getAllByText("Occupancy unreported")).toHaveLength(3);
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
    // Same shape, same controls, same funds rule.
    expect(screen.getByText(/Craft · 1\/2 ready/)).toBeInTheDocument();
    expect(screen.getByText("Mun Hopper I")).toBeInTheDocument();
    expect(screen.getByTitle("Available funds")).toBeInTheDocument();
  });

  it("reads nothing off rp1.* even where those channels are live", async () => {
    // The widget's capability is the stock one. An Uplink adds to a pad row; it
    // is not what makes the row exist, and a subscription here would be the
    // first step back towards a widget that only works under one mod.
    const { fixture } = await renderUnder("rp1-testflight");

    for (const channel of ["rp1.pads", "rp1.operations", "rp1.complexes"]) {
      expect(fixture.transport.isSubscribed(channel)).toBe(false);
    }
  });
});
