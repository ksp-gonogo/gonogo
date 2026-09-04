import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { FacilityUpgrades } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const CARRIED = [
  "rp1.available",
  "career.status",
  "rp1.constructions",
  "rp1.facilities",
];

function mount() {
  const stream = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 1000,
  });
  const result = render(
    <stream.Provider>
      <FacilityUpgrades />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, container: result.container };
}

function emit(
  stream: ReturnType<typeof mount>,
  career: Record<string, unknown> | undefined,
  constructions: unknown[] = [],
  facilities?: unknown[],
) {
  act(() => {
    stream.emit("rp1.available", true, { validAt: 1000 });
    stream.emit("rp1.constructions", constructions, { validAt: 1000 });
    if (facilities !== undefined) {
      stream.emit("rp1.facilities", facilities, { validAt: 1000 });
    }
    if (career !== undefined) {
      stream.emit("career.status", career, { validAt: 1000 });
    }
  });
}

/**
 * A career at the space centre: two buildings with a tier to go, one already at
 * its ceiling. Tiers are the wire's zero-based indices.
 */
const AT_CENTRE = {
  economy: { funds: 289848, science: 340, reputation: 62 },
  facilities: {
    LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 112500 },
    VehicleAssemblyBuilding: { currentTier: 0, maxTier: 2, upgradeCost: 40000 },
    TrackingStation: { currentTier: 2, maxTier: 2, upgradeCost: null },
  },
};

/**
 * The same career read from anywhere but the space centre. KSP has instantiated
 * no facility, so core's channel answers absent for every tier and every price.
 */
const AWAY = {
  economy: { funds: 289848 },
  facilities: {
    LaunchPad: { currentTier: null, maxTier: null, upgradeCost: null },
    VehicleAssemblyBuilding: {
      currentTier: null,
      maxTier: null,
      upgradeCost: null,
    },
  },
};

/**
 * What RP-1 answers for the same two buildings, from the same place: it
 * denormalises the level KSP persists in the SAVE against its own config tier
 * count, so this channel carries the identical figures whatever scene the
 * operator is in.
 */
const RP1_TIERS = [
  {
    facility: "LaunchPad",
    currentTier: 1,
    maxTier: 2,
    upgradeCost: 112500,
    upgradedByRp1: true,
  },
  {
    facility: "VehicleAssemblyBuilding",
    currentTier: 0,
    maxTier: 2,
    upgradeCost: 40000,
    upgradedByRp1: true,
  },
];

describe("FacilityUpgrades: the tier a career can commit to next", () => {
  /**
   * Invisible without RP-1, which is most installs. Stock sells a facility
   * upgrade outright and the host widget's own control is the one for it; a
   * section describing a construction queue would name a system that is not
   * there.
   */
  it("draws nothing at all when RP-1 is not present", () => {
    mount();

    expect(screen.queryByText("FACILITY UPGRADES")).not.toBeInTheDocument();
  });

  it("names each building with a tier left, at the tier it is at", async () => {
    const stream = mount();

    emit(stream, AT_CENTRE);

    expect(await screen.findByText("FACILITY UPGRADES")).toBeInTheDocument();
    expect(screen.getByText("Launch Pad")).toBeInTheDocument();
    expect(screen.getByText("Vehicle Assembly Building")).toBeInTheDocument();
    // Operator-counted: the wire's tier 1 of max 2 is "tier 2 of 3".
    expect(visibleText(stream.container)).toContain("now at tier 2 of 3");
  });

  /**
   * A building at its ceiling has nothing to commit to, and the command's own
   * answer to it is a refusal. A control whose only outcome is a refusal is a
   * control that should not be there.
   */
  it("offers nothing for a building already at its top tier", async () => {
    const stream = mount();

    emit(stream, AT_CENTRE);
    await screen.findByText("FACILITY UPGRADES");

    expect(screen.queryByText("Tracking Station")).not.toBeInTheDocument();
  });

  /**
   * RP-1's own `AlreadyInProgressByID` refuses a second project for a facility
   * being upgraded, so offering one is offering a press that cannot land. The
   * queue beside this section is where that work is shown.
   */
  it("offers nothing for a building already in the construction queue", async () => {
    const stream = mount();

    emit(stream, AT_CENTRE, [
      { kind: "FacilityUpgrade", facilityType: "LaunchPad", name: "LaunchPad" },
    ]);
    await screen.findByText("FACILITY UPGRADES");

    expect(screen.queryByText("Launch Pad")).not.toBeInTheDocument();
    expect(screen.getByText("Vehicle Assembly Building")).toBeInTheDocument();
  });

  /**
   * The house rule, and the reason this section carries its own figure rather
   * than leaning on the host's the way the construction queue does: this one
   * carries the press, and the host draws its balance only once the widget is
   * four rows tall.
   */
  it("shows the funds balance beside the control", async () => {
    const stream = mount();

    emit(stream, AT_CENTRE);
    await screen.findByText("FACILITY UPGRADES");

    const text = visibleText(stream.container);
    expect(text).toContain("Funds");
    expect(text).toContain("289,848");
  });

  /**
   * The fact that has to survive, stated as readings rather than as advice.
   *
   * <para>RP-1 charges nothing at the press: `ConstructionProject.AddProgress`
   * draws the funds down as the work advances and throttles itself to whatever
   * the career can meet, so a short career gets a slower upgrade and never a
   * refused one. A verdict here would tell the operator a falsehood about their
   * own save, and "spend" on the confirm would tell them their balance is about
   * to move. What carries it now is "over the build" beside each price and
   * "Commit" on the confirm: the section states what it costs and when, and
   * never counsels the operator about their own career.</para>
   */
  it("never draws an affordability verdict, and prices the spend over the build", async () => {
    const stream = mount();

    emit(stream, {
      ...AT_CENTRE,
      // Far short of every price on screen, and still not a refusal.
      economy: { funds: 12 },
    });
    await screen.findByText("FACILITY UPGRADES");

    const text = visibleText(stream.container);
    expect(text).not.toContain("cannot afford");
    expect(text).not.toContain("Cannot afford");
    expect(text).not.toContain("Insufficient");
    expect(text).toContain("over the build");
    // The advice this used to give in its own sentence. Instrumentation reports
    // readings; it does not counsel.
    expect(text).not.toContain("slows the work");
    expect(text).not.toContain("short career");
    expect(
      screen.getByRole("button", { name: /queue launch pad tier 3/i }),
    ).toBeEnabled();
  });

  /**
   * THE OFF-SCENE CASE, and the reason `rp1.facilities` exists.
   *
   * <para>Core's channel has gone silent because KSP instantiates the buildings
   * in the SPACECENTER scene only. RP-1's has not: it reads the level KSP
   * persists in the save and denormalises it against its own config tier count,
   * which its own MaintenanceHandler does in all four scenes to bill the career.
   * So the tier and the price are still on screen, and the section says nothing
   * about not being able to read them.</para>
   */
  it("still names the tiers and their prices when only RP-1's channel answers", async () => {
    const stream = mount();

    emit(stream, AWAY, [], RP1_TIERS);
    await screen.findByText("FACILITY UPGRADES");

    const text = visibleText(stream.container);
    expect(text).toContain("Launch Pad");
    expect(text).toContain("now at tier 2 of 3");
    expect(text).toContain("112,500");
    expect(text).not.toContain("cannot be read");
    expect(text).not.toContain("No tiers have arrived");
  });

  /**
   * Neither channel answered. On an RP-1 install that is a cold start rather
   * than a scene, because RP-1's cost table loads once at game load; either way
   * it is said out loud, since a career with nothing left to upgrade renders the
   * same silence and only one of the two is worth waiting through.
   */
  it("says no tiers have arrived rather than showing an empty list", async () => {
    const stream = mount();

    emit(stream, AWAY);
    await screen.findByText("FACILITY UPGRADES");

    const text = visibleText(stream.container);
    expect(text).toContain("No tiers have arrived");
    expect(text).not.toContain("No facility has a tier left to queue");
    /* And it says what is NOT happening, which is the half this wording has
       twice got wrong. RP-1 advances a construction on UNIVERSAL TIME out of
       MaintenanceHandler.FixedUpdate, whose [KSPScenario] names EDITOR, FLIGHT,
       SPACECENTER and TRACKSTATION, and neither
       ConstructionProject.IncrementProgress nor Formula.GetConstructionBuildRate
       tests the scene at all. */
    expect(text).toContain("keeps building wherever you are");
  });

  /**
   * The five buildings RP-1 prices at a single fund under its own "cosmetic
   * only" comment. It drives their tier itself from the mean of the ones it does
   * upgrade, so a project queued against one would finish almost at once and
   * then be overwritten; RP-1's own menu disables the button. Offered until this
   * fact reached the wire, and refused by the command; now not offered at all.
   */
  it("does not offer a building RP-1 declines to upgrade as a building", async () => {
    const stream = mount();

    emit(
      stream,
      AWAY,
      [],
      [{ ...RP1_TIERS[0], upgradedByRp1: false }, RP1_TIERS[1]],
    );
    await screen.findByText("FACILITY UPGRADES");

    const text = visibleText(stream.container);
    expect(text).not.toContain("Launch Pad");
    expect(text).toContain("Vehicle Assembly");
  });

  /**
   * The other side of that branch, and the one that makes it read the tiers
   * rather than the steps.
   *
   * <para>A career whose buildings are all at their ceiling has no step left
   * either, so a check on "did anything price a next tier" would send an
   * operator to the space centre they are already standing in. The question is
   * whether any facility ANSWERED its tiers.</para>
   */
  it("says nothing is left rather than blaming the scene when every tier is bought", async () => {
    const stream = mount();

    emit(stream, {
      economy: { funds: 289848 },
      facilities: {
        LaunchPad: { currentTier: 2, maxTier: 2, upgradeCost: null },
        VehicleAssemblyBuilding: {
          currentTier: 2,
          maxTier: 2,
          upgradeCost: null,
        },
      },
    });
    await screen.findByText("FACILITY UPGRADES");

    const text = visibleText(stream.container);
    expect(text).toContain("No facility has a tier left to queue");
    expect(text).not.toContain("No tiers have arrived");
  });

  /**
   * A price RP-1 did not send is said out loud rather than drawn as free, and
   * the press is still offered: the command reads `GetUpgradeCost()` itself and
   * refuses if it really cannot be had.
   */
  it("says an unpriced tier is unpriced and still offers the press", async () => {
    const stream = mount();

    emit(stream, {
      economy: { funds: 289848 },
      facilities: {
        LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: null },
      },
    });
    await screen.findByText("FACILITY UPGRADES");

    expect(visibleText(stream.container)).toContain("has not priced this tier");
    expect(
      screen.getByRole("button", { name: /queue launch pad tier 3/i }),
    ).toBeEnabled();
  });

  it("has no accessibility violations", async () => {
    const stream = mount();

    emit(stream, AT_CENTRE);
    await screen.findByText("FACILITY UPGRADES");

    await expectNoA11yViolations(stream.container);
  });
});
