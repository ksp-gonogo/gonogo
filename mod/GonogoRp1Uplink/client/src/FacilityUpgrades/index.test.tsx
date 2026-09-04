import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
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
    // Operator-counted: the wire's tier 1 is the operator's tier 2.
    expect(screen.getByText("TIER 2")).toBeInTheDocument();
  });

  /**
   * ONE number about a building's tier, and it is the tier the building is AT.
   *
   * <para>Every tier on the wire is KSP's own zero-based facility level, and
   * this card used to render `level + 2`, the tier the press buys, as a badge
   * directly beneath the host grid's `level + 1`, the tier the building is at.
   * Both were correct and an operator read them as two opinions about one
   * Launch Pad. The state is a reading and belongs on the card; the step is an
   * act and belongs to the control, which says so in a verb and names the
   * destination only once the press is armed.</para>
   */
  it("states the tier it is at, and nowhere states the tier the press would buy", async () => {
    const stream = mount();

    emit(stream, AT_CENTRE);
    await screen.findByText("FACILITY UPGRADES");

    const text = visibleText(stream.container);
    // The tier the Launch Pad is at, agreeing with the host grid's "2 / 3".
    expect(text).toContain("TIER 2");
    // The destination, which used to compete with it from a badge.
    expect(text).not.toContain("TIER 3");
    expect(text).not.toContain("TO TIER");
    expect(text).not.toContain("now at tier");
    // The verb is on the control, and carries no number of its own.
    expect(
      screen.getByRole("button", { name: /queue launch pad upgrade/i }),
    ).toBeEnabled();
  });

  /**
   * Where the destination tier does belong: on the armed control, which is the
   * one moment the operator is asking about the step rather than the state.
   */
  it("names the tier the press buys once the press is armed", async () => {
    const user = userEvent.setup();
    const stream = mount();

    emit(stream, AT_CENTRE);
    await screen.findByText("FACILITY UPGRADES");

    await user.click(
      screen.getByRole("button", { name: /queue launch pad upgrade/i }),
    );

    expect(
      await screen.findByRole("button", {
        name: /confirm queueing launch pad tier 3/i,
      }),
    ).toBeInTheDocument();
    expect(visibleText(stream.container)).toContain("Commit tier 3");
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
      screen.getByRole("button", { name: /queue launch pad upgrade/i }),
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
    expect(text).toContain("TIER 2");
    expect(text).toContain("112,500");
    expect(text).not.toContain("cannot be read");
    expect(text).not.toContain("No tiers have arrived");
  });

  /**
   * Neither channel answered, so this section has nothing to say and says
   * nothing.
   *
   * <para>It used to answer with two sentences: that no tier had arrived, and
   * that a construction already under way keeps building wherever the operator
   * is. Both were true and neither was a reading. The host widget carries ONE
   * absence marker for the whole facilities area, this section is part of that
   * area, and a paragraph underneath the marker explaining the mod's internals
   * is the second opinion the marker exists to prevent.</para>
   */
  it("draws nothing at all when neither tier channel answered", async () => {
    const stream = mount();

    /* Drawn first, so the disappearance below is this branch and not a section
       that had not rendered yet. An assertion on an absence, made against a
       pipeline that was never proved live, passes for the wrong reason. */
    emit(stream, AT_CENTRE);
    await screen.findByText("FACILITY UPGRADES");

    emit(stream, AWAY);

    await waitFor(() =>
      expect(screen.queryByText("FACILITY UPGRADES")).not.toBeInTheDocument(),
    );
    const text = visibleText(stream.container);
    expect(text).not.toContain("No tiers have arrived");
    expect(text).not.toContain("keeps building wherever you are");
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
    expect(text).toContain("Nothing left to queue");
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

    expect(visibleText(stream.container)).toContain("not priced");
    expect(
      screen.getByRole("button", { name: /queue launch pad upgrade/i }),
    ).toBeEnabled();
  });

  it("has no accessibility violations", async () => {
    const stream = mount();

    emit(stream, AT_CENTRE);
    await screen.findByText("FACILITY UPGRADES");

    await expectNoA11yViolations(stream.container);
  });
});
