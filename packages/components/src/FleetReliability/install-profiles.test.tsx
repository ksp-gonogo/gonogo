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
 * The same scene rendered under four declared installs, which is the question
 * neither core nor an Uplink can ask. Core tests the election mechanism with
 * synthetic providers and never sees a widget; an Uplink tests its own provider
 * and cannot see who it displaced. "TestFlight won the reliability election" is
 * a fact about a WORLD, and this is where a world is declared.
 *
 * The scene below is deliberately ONE scene: a two-craft fleet with a busted
 * reaction wheel on the active one. Only the install changes, so any difference
 * in the row is the election and nothing else.
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
    /*
     * VISIBLE, not merely present: the roster row's update block collapses
     * itself when the slot renders nothing, and a failure list the operator
     * cannot see is the same to them as one that was never rendered.
     */
    expect(await screen.findByText("Reaction Wheel")).toBeVisible();
    expect(screen.getAllByText("4 at risk")).toHaveLength(1);
    /*
     * The engine row is TestFlight's alone: no other backend models a rated
     * burn, and the SCOPE is in the sentence because the two ratings diverge
     * tenfold under RO.
     */
    expect(screen.getByText("RD-180")).toBeVisible();
    expect(screen.getByText(/continuous rated burn left/)).toBeVisible();
    /*
     * The same sentence written from the COUNT pair rather than the seconds
     * one, which is the arm `budgetRow` has for a budget measured in uses. The
     * upper stage is the only part in the tree carrying it.
     */
    expect(screen.getByText("AJ10-137")).toBeVisible();
    const ignitions = screen.getByText(/of.*rated ignitions left/);
    expect(ignitions).toBeVisible();
    // Both numbers, because "of" between two of them is the whole sentence:
    // the remaining count is derived (limit minus used) and the limit is not.
    expect(ignitions.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "1 of 4 rated ignitions left",
    );
    await act(async () => {});
  });

  /**
   * The install the old matrix could not reach at all: its Kerbalism profile
   * emptied the part list, so the blank came from the DATA rather than from any
   * decision the widget made, and a Kerbalism craft with a failed part was a
   * state no test could render.
   */
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
    /*
     * And it is ALL of it: Kerbalism models no forward probability and no rated
     * burn, so a survival sentence or an engine row here would be a number
     * nothing in the mod computes.
     */
    expect(screen.queryByText(/to survive/)).toBeNull();
    expect(screen.queryByText(/rated burn/)).toBeNull();
    expect(screen.queryByText("RD-180")).toBeNull();
    await act(async () => {});
  });

  /**
   * THE DELIVERABLE of this whole change, and the inverse of the
   * characterisation this file used to lock in. The two absent-provider installs
   * used to render the same nothing as each other and as a healthy craft. They
   * now say what is actually true of them, and they say different things.
   */
  it("keeps the row silent when the backend is not modelling this save", async () => {
    const { fixture, block } = renderScene("rp1-no-testflight");
    await replay(fixture, block);

    const roster = await screen.findByText(/kerbalism=healthy/, {
      selector: "p",
    });
    expect(roster.textContent).not.toContain("testflight");
    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    // Whether a backend has failures switched off is a fact about the INSTALL:
    // constant for the session, unactionable from a roster row, and already
    // carried by `system.uplinkHealth`, which the settings panel and the Uplink
    // wizard both read. On the row it was a permanent badge that taught the
    // operator to stop looking at the slot.
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
    // Nothing is installed that could be silently broken, so silence here cannot
    // conceal a fault, and a permanent unactionable badge on every stock
    // player's active row trains them to ignore the slot. The install-level
    // distinction is on `system.uplinks`, which is an install-level surface.
    expect(
      screen.queryByRole("group", { name: "Reliability updates" }),
    ).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {});
  });

  /**
   * The distinction the whole change exists for, and the one a boolean could
   * not carry. On the wire this install is byte-identical to a stock career:
   * source "none", no parts. It is NOT the same situation. A modelling mod is
   * installed and its provider failed to activate, so the operator is BLIND,
   * where the stock player simply has nothing watching.
   *
   * Both are silent ON THE ROW, and the distinction survives where it can be
   * acted on: the uplink's own health. Putting it on the row said a craft with
   * a DIRECT link could not be read, which is not what happened and is not a
   * thing a roster row should ever claim.
   */
  it("keeps the row silent when the elected provider failed to activate", async () => {
    const { fixture, block } = renderScene("reliability-unavailable");
    await replay(fixture, block);

    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    expect(screen.queryByText(/unreadable/i)).toBeNull();
    // The profile still carries the fault, and it is still reachable: the
    // uplink reports `degraded` with its reason. That is an install-level
    // surface for an install-level fault, and it does not claim anything about
    // this craft, which has a direct link and is being read perfectly well.
    expect(
      await screen.findByText(/reliability=degraded/, { selector: "p" }),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The provider answered and its per-part reads did not. The craft is not
   * healthy and is not unmodelled: each part it could not read says so against
   * its own name, rather than the whole row collapsing to one verdict that
   * would have to be either falsely calm or falsely alarming.
   */
  it("marks the parts it could not read, not the whole craft", async () => {
    const { fixture, block } = renderScene("testflight-unreadable");
    await replay(fixture, block);

    expect(await screen.findByText("Active Craft")).toBeInTheDocument();
    expect((await screen.findAllByText(/unreadable/i)).length).toBeGreaterThan(
      1,
    );
    await act(async () => {});
  });

  /**
   * The finding this harness was built to be able to state, now stated as its
   * inverse. Three of the four installs put a DIFFERENT thing on the roster row,
   * and only the stock career is silent. What used to be pinned here as
   * "an unmodelled craft is indistinguishable from a healthy one" was a
   * characterisation of the bug; this is the assertion that it is gone.
   */
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

    /*
     * Named rather than counted, because WHICH installs are silent is the
     * design decision. Three are, and for one reason between them: nothing is
     * modelling this craft. Nothing installed, the backend switched off, the
     * provider failed to activate. Each is a fact about the install, holds for
     * the session, and cannot be acted on from a roster row; `system.uplinkHealth`
     * carries all three and the settings panel and Uplink wizard read it.
     */
    const SILENT = [
      "stock-career",
      "rp1-no-testflight",
      "reliability-unavailable",
    ];
    for (const id of SILENT) expect(rendered[id]).toBe("");

    /*
     * And the half that kept its content: where something IS modelling, each
     * install must say something, and no two may say the same thing. This is
     * the assertion the whole harness was built for, unchanged in substance.
     */
    const spoken = COVERED.filter((id) => !SILENT.includes(id)).map(
      (id) => rendered[id],
    );
    expect(spoken.every((text) => text.length > 0)).toBe(true);
    expect(new Set(spoken).size).toBe(spoken.length);
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
