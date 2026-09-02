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

const CARRIED = ["rp1.available", "career.status", "rp1.constructions"];

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
) {
  act(() => {
    stream.emit("rp1.available", true, { validAt: 1000 });
    stream.emit("rp1.constructions", constructions, { validAt: 1000 });
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

/** The same career read from anywhere but the space centre. */
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
   * The whole point of the wording, and the one thing an operator does not
   * already know about this spend.
   *
   * <para>RP-1 charges nothing at the press: `ConstructionProject.AddProgress`
   * draws the funds down as the work advances and throttles itself to whatever
   * the career can meet, so a short career gets a slower upgrade and never a
   * refused one. A verdict here would tell the operator a falsehood about their
   * own save, and "spend" on the confirm would tell them their balance is about
   * to move.</para>
   */
  it("never draws an affordability verdict, and says the bill is progressive", async () => {
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
    expect(text).toContain("slows the work rather than stopping it");
    expect(
      screen.getByRole("button", { name: /queue launch pad tier 3/i }),
    ).toBeEnabled();
  });

  /**
   * Outside the space centre KSP has not built the facilities, so every tier and
   * every price arrives absent and the command's own gate refuses. Said out
   * loud, because a career with nothing left to upgrade renders the same
   * silence and only one of the two is a reason to go and stand somewhere else.
   */
  it("says the tiers cannot be read from away rather than showing an empty list", async () => {
    const stream = mount();

    emit(stream, AWAY);
    await screen.findByText("FACILITY UPGRADES");

    const text = visibleText(stream.container);
    expect(text).toContain("only while the space centre is on screen");
    expect(text).not.toContain("No facility has a tier left to queue");
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
    expect(text).not.toContain("only while the space centre is on screen");
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
