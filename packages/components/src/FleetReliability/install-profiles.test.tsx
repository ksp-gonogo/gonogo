import {
  DashboardItemContext,
  registerAugment,
  registerDataSource,
} from "@ksp-gonogo/core";
import type { SystemUplinkHealth } from "@ksp-gonogo/sitrep-client";
import { useStream } from "@ksp-gonogo/sitrep-client";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { FleetRosterComponent } from "../FleetRoster";
import { RequiresGuard } from "../shared/RequiresGuard";
import {
  applyInstallProfile,
  fixtureProfiles,
  getInstallProfile,
  type InstallProfileStreamBlock,
} from "../test/installProfile";
import { setupStreamFixture } from "../test/setupStreamFixture";
import brokenReactionWheel from "./__fixtures__/broken-reaction-wheel.json";
import { FleetReliabilityUpdates } from "./index";

/**
 * The same scene rendered under three declared installs, which is the question
 * neither core nor an Uplink can ask. Core tests the election mechanism with
 * synthetic providers and never sees a widget; an Uplink tests its own provider
 * and cannot see who it displaced. "TestFlight won the reliability election" is
 * a fact about a WORLD, and this is where a world is declared.
 *
 * The scene below is deliberately ONE scene: a two-craft fleet with a broken
 * reaction wheel on the active one. Only the install changes.
 */
const SCENE = brokenReactionWheel._stream as InstallProfileStreamBlock;

/** The installs the cases below actually assert against; checked against the scene's own declaration. */
const COVERED = ["rp1-testflight", "rp1-no-testflight", "stock-career"];

/**
 * Replays a profiled block the way both render harnesses do: one topic at a
 * time, each held until something has actually subscribed to it, because
 * `StubTransport` drops a sample for a topic nobody is reading and does not
 * replay it. The fleet rows (and with them the per-row augment slots) only
 * mount once `system.vessels` lands, so the reliability topics genuinely have
 * to wait here rather than being emitted in one batch.
 */
async function replay(
  fixture: ReturnType<typeof setupStreamFixture>,
  block: InstallProfileStreamBlock,
): Promise<void> {
  for (const emit of block.emits) {
    for (let frame = 0; frame < 30; frame++) {
      if (fixture.transport.isSubscribed(emit.channel)) break;
      // Outside `act`, so the commit that mounts the next round of subscribers
      // (a fleet row's augment slot mounts only once the roster payload has
      // rendered) actually lands between frames instead of being batched to
      // the end of one long act scope.
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

/**
 * Renders the install itself: the roster the profile put on the wire, plus the
 * reliability backend that won. Without it an absent-provider render is
 * indistinguishable from a render where nothing was fed, which is the failure
 * mode a profile harness has to be able to tell apart from a real finding.
 */
function InstallReadout() {
  const health = useStream<SystemUplinkHealth>("system.uplinkHealth");
  if (!health) return <p>roster: pending</p>;
  return (
    <p>
      {`roster: ${health.uplinks
        .map((entry) => `${entry.id}=${entry.health.state}`)
        .sort()
        .join(" ")}`}
    </p>
  );
}

function renderScene(profileId: string) {
  const block = applyInstallProfile(getInstallProfile(profileId), SCENE);
  const fixture = setupStreamFixture({
    carriedChannels: block.carriedChannels,
  });
  render(
    <fixture.Provider>
      <InstallReadout />
      <DashboardItemContext.Provider value={{ instanceId: "fleet-test" }}>
        <FleetRosterComponent config={{}} id="fleet-test" w={8} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, block };
}

describe("the reliability election, seen from three installs", () => {
  registerAugment({
    id: "fleet-reliability-updates",
    augments: "fleet-roster.updates",
    component: FleetReliabilityUpdates,
    channels: ["reliability.summary", "reliability.parts", "vessel.identity"],
  });

  /**
   * The scene names its own worlds, and this is what makes that naming
   * load-bearing: adding a profile to the fixture without a case for it fails
   * here rather than passing silently as coverage nobody wrote.
   */
  it("covers every install the scene declares itself interesting under", () => {
    expect(fixtureProfiles(brokenReactionWheel).sort()).toEqual(
      COVERED.slice().sort(),
    );
    for (const id of fixtureProfiles(brokenReactionWheel)) {
      expect(getInstallProfile(id).id).toBe(id);
    }
  });

  it("renders the failure list when TestFlight won", async () => {
    const { fixture, block } = renderScene("rp1-testflight");
    await replay(fixture, block);

    expect(
      await screen.findByText(/testflight=healthy/, { selector: "p" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Reaction Wheel")).toBeInTheDocument();
    expect(screen.getAllByText("1 at risk")).toHaveLength(1);
    await act(async () => {});
  });

  it("renders no failure list when TestFlight is not installed", async () => {
    const { fixture, block } = renderScene("rp1-no-testflight");
    await replay(fixture, block);

    // The roster proves the install landed: TestFlight is not in it at all,
    // and the Kerbalism provider that inherited the election models nothing.
    const roster = await screen.findByText(/kerbalism=healthy/, {
      selector: "p",
    });
    expect(roster.textContent).not.toContain("testflight");
    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    expect(screen.queryByText("Reaction Wheel")).toBeNull();
    expect(screen.queryByText(/at risk/)).toBeNull();
    await act(async () => {});
  });

  it("renders no failure list on a stock career either", async () => {
    const { fixture, block } = renderScene("stock-career");
    await replay(fixture, block);

    expect(
      await screen.findByText(/rp1=unavailable/, { selector: "p" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    expect(screen.queryByText("Reaction Wheel")).toBeNull();
    await act(async () => {});
  });

  /**
   * The finding this harness was built to be able to state. Both absent-provider
   * installs produce a roster and a `reliability.summary` that differ from the
   * TestFlight one in every field, and the operator sees the SAME thing in all
   * three of the non-TestFlight cases: nothing. A craft whose reliability nobody
   * is modelling reads exactly like a craft with nothing wrong with it.
   *
   * Locked in as a characterisation rather than repaired here, because the
   * repair is a design decision about what the roster row should say when no
   * backend is elected, not a detail of the profile mechanism.
   */
  it("makes an unmodelled craft indistinguishable from a healthy one", async () => {
    const absent = renderScene("stock-career");
    await replay(absent.fixture, absent.block);
    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    // Every output the augment can produce is absent: no verdict group, and no
    // withheld-reading caption either.
    expect(
      screen.queryByRole("group", { name: "Reliability updates" }),
    ).toBeNull();
    expect(
      screen.queryByRole("status", { name: "Reliability not current" }),
    ).toBeNull();
    await act(async () => {});
  });
});

/**
 * The other half of what an install decides, and the half that DOES have a
 * named empty state: a channel whose owning Uplink is installed but reports its
 * target assembly missing. `RequiresGuard` reads that off the same roster the
 * profile put on the wire, so the gate is driven entirely by the declared
 * install and not by anything the widget was handed.
 */
describe("channel ownership, seen from two installs", () => {
  const GUARDED: InstallProfileStreamBlock = {
    carriedChannels: ["comms.linkMargin"],
    emits: [{ channel: "comms.linkMargin", value: { db: 12.5 } }],
  };

  // The guard blocks on a missing telemetry host before it looks at any roster,
  // so the host has to be up for the ownership branch to be the one under test.
  beforeEach(() => {
    registerDataSource({
      id: "sitrep",
      name: "Sitrep Stream",
      status: "connected",
      connect: async () => {},
      disconnect: () => {},
      schema: () => [],
      subscribe: () => () => {},
      execute: async () => {},
      configSchema: () => [],
      getConfig: () => ({}),
      configure: () => {},
      onStatusChange: () => () => {},
    });
  });

  function renderGuard(profileId: string) {
    const block = applyInstallProfile(getInstallProfile(profileId), GUARDED);
    const fixture = setupStreamFixture({
      carriedChannels: block.carriedChannels,
    });
    render(
      <fixture.Provider>
        <RequiresGuard channels={["comms.linkMargin"]}>
          <p>link margin panel</p>
        </RequiresGuard>
      </fixture.Provider>,
    );
    return { fixture, block };
  }

  it("passes the widget through when RealAntennas is installed", async () => {
    const { fixture, block } = renderGuard("rp1-testflight");
    await replay(fixture, block);

    expect(await screen.findByText("link margin panel")).toBeInTheDocument();
    await act(async () => {});
  });

  it("blocks with the owning Uplink's own reason when it is not", async () => {
    const { fixture, block } = renderGuard("stock-career");
    await replay(fixture, block);

    expect(
      await screen.findByText("RealAntennas assembly not loaded"),
    ).toBeInTheDocument();
    expect(screen.queryByText("link margin panel")).toBeNull();
    await act(async () => {});
  });
});
