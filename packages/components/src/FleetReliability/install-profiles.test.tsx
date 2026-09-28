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
 * One scene (a two-craft fleet with a busted reaction wheel on the active one)
 * rendered under four declared installs, so any difference in the row is the
 * reliability election and nothing else.
 */
const SCENE = brokenReactionWheel._stream as InstallProfileStreamBlock;

/** The installs the cases below actually assert against; checked against the scene's own declaration. */
const COVERED = [
  "rp1-testflight",
  "rp1-kerbalism-live",
  "rp1-no-testflight",
  "stock-career",
  "reliability-unavailable",
  "testflight-unreadable",
];

/**
 * Replays a profiled block one topic at a time, each held until subscribed:
 * `StubTransport` drops samples nobody reads, and the fleet rows mount only once
 * `system.vessels` lands.
 */
async function replay(
  fixture: ReturnType<typeof setupStreamFixture>,
  block: InstallProfileStreamBlock,
): Promise<void> {
  for (const emit of block.emits) {
    for (let frame = 0; frame < 30; frame++) {
      if (fixture.transport.isSubscribed(emit.channel)) break;
      // Outside `act`, so the commit that mounts the next subscribers lands between frames.
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

/** Renders the install itself, so an absent-provider render is distinguishable from nothing fed. */
function InstallReadout() {
  const healthReading = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const health =
    healthReading.state === "observed" || healthReading.state === "stale"
      ? healthReading.value
      : undefined;
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
    suspendFrames: true,
  });
  const { unmount } = render(
    <fixture.Provider>
      <InstallReadout />
      <DashboardItemContext.Provider value={{ instanceId: "fleet-test" }}>
        <FleetRosterComponent config={{}} id="fleet-test" w={8} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, block, unmount };
}

describe("the reliability election, seen from six installs", () => {
  registerAugment({
    id: "fleet-reliability-updates",
    augments: "fleet-roster.updates",
    component: FleetReliabilityUpdates,
    channels: ["reliability.summary", "reliability.parts", "vessel.identity"],
  });

  /** Adding a profile to the fixture without a case for it fails here. */
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
    // VISIBLE, not merely present: the update block collapses itself when the slot renders nothing.
    expect(await screen.findByText("Reaction Wheel")).toBeVisible();
    expect(screen.getAllByText("4 at risk")).toHaveLength(1);
    // TestFlight alone models a rated burn, and the scope is in the sentence because the two ratings diverge tenfold under RO.
    expect(screen.getByText("RD-180")).toBeVisible();
    expect(screen.getByText(/continuous rated burn left/)).toBeVisible();
    // The same sentence off the COUNT pair, `budgetRow`'s arm for a budget measured in uses.
    expect(screen.getByText("AJ10-137")).toBeVisible();
    const ignitions = screen.getByText(/of.*rated ignitions left/);
    expect(ignitions).toBeVisible();
    // Both numbers: the remaining count is derived and the limit is not.
    expect(ignitions.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "1 of 4 rated ignitions left",
    );
    await act(async () => {});
  });

  /** A Kerbalism craft with a failed part. */
  it("renders Kerbalism's own conditions, and no probability, when Kerbalism won", async () => {
    const { fixture, block } = renderScene("rp1-kerbalism-live");
    await replay(fixture, block);

    const roster = await screen.findByText(/kerbalism=healthy/, {
      selector: "p",
    });
    expect(roster.textContent).not.toContain("testflight");
    expect(await screen.findByText("Reaction Wheel")).toBeVisible();
    expect(screen.getAllByText("2 at risk")).toHaveLength(1);
    expect(screen.getByText("critical failure")).toBeVisible();
    // The service clock is the whole of Kerbalism's numeric contribution.
    expect(screen.getByText(/overdue by/)).toBeVisible();
    // Kerbalism models no forward probability and no rated burn, so neither may appear.
    expect(screen.queryByText(/to survive/)).toBeNull();
    expect(screen.queryByText(/rated burn/)).toBeNull();
    expect(screen.queryByText("RD-180")).toBeNull();
    await act(async () => {});
  });

  /** The two absent-provider installs say what is true of them, and different things. */
  it("keeps the row silent when the backend is not modelling this save", async () => {
    const { fixture, block } = renderScene("rp1-no-testflight");
    await replay(fixture, block);

    const roster = await screen.findByText(/kerbalism=healthy/, {
      selector: "p",
    });
    expect(roster.textContent).not.toContain("testflight");
    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    // Failures switched off is an install fact, carried by `system.uplinkHealth`, not the row.
    expect(screen.queryByText(/not modelling/)).toBeNull();
    expect(screen.queryByText(/at risk/)).toBeNull();
    await act(async () => {});
  });

  it("stays silent on a stock career, which is the one silence it may keep", async () => {
    const { fixture, block } = renderScene("stock-career");
    await replay(fixture, block);

    expect(
      await screen.findByText(/rp1=unavailable/, { selector: "p" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    // Nothing installed could be silently broken, so silence cannot conceal a fault.
    expect(
      screen.queryByRole("group", { name: "Reliability updates" }),
    ).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {});
  });

  /**
   * Byte-identical on the wire to a stock career, but a modelling mod failed to
   * activate. Both are silent on the row; the distinction survives in the
   * uplink's own health, since the row must never claim this craft cannot be
   * read.
   */
  it("keeps the row silent when the elected provider failed to activate", async () => {
    const { fixture, block } = renderScene("reliability-unavailable");
    await replay(fixture, block);

    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    expect(screen.queryByText(/unreadable/i)).toBeNull();
    // The uplink reports `degraded` with its reason: an install-level surface for an install-level fault.
    expect(
      await screen.findByText(/reliability=degraded/, { selector: "p" }),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  /** The provider answered and its per-part reads did not: each unreadable part says so against its own name. */
  it("marks the parts it could not read, not the whole craft", async () => {
    const { fixture, block } = renderScene("testflight-unreadable");
    await replay(fixture, block);

    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    expect((await screen.findAllByText(/unreadable/i)).length).toBeGreaterThan(
      1,
    );
    await act(async () => {});
  });

  /** Three of the four installs put a different thing on the row; only the stock career is silent. */
  it("speaks only where something is modelling, and never twice alike", async () => {
    const rendered: Record<string, string> = {};
    for (const id of COVERED) {
      const scene = renderScene(id);
      await replay(scene.fixture, scene.block);
      await screen.findByText("Active Craft");
      const slot =
        document.querySelector('[aria-label="Reliability updates"]') ??
        document.querySelector('[role="status"]');
      rendered[id] = (slot?.textContent ?? "").trim();
      scene.unmount();
    }

    // Named rather than counted: the silent installs are the three where nothing is modelling this craft.
    const SILENT = [
      "stock-career",
      "rp1-no-testflight",
      "reliability-unavailable",
    ];
    for (const id of SILENT) expect(rendered[id]).toBe("");

    // Where something IS modelling, each install must say something and no two the same thing.
    const spoken = COVERED.filter((id) => !SILENT.includes(id)).map(
      (id) => rendered[id],
    );
    expect(spoken.every((text) => text.length > 0)).toBe(true);
    expect(new Set(spoken).size).toBe(spoken.length);
    await act(async () => {});
  });
});

/**
 * A channel whose owning Uplink is installed but reports its target assembly
 * missing: `RequiresGuard` reads that off the profile's roster, so the gate is
 * driven by the declared install alone.
 */
describe("channel ownership, seen from two installs", () => {
  const GUARDED: InstallProfileStreamBlock = {
    emits: [{ channel: "comms.linkMargin", value: { db: 12.5 } }],
  };

  // The guard checks the telemetry host first, so it has to be up for the ownership branch to be under test.
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
      suspendFrames: true,
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
