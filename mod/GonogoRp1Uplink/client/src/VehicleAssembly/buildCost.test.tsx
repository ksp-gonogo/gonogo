import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { BuildCostSection } from "./BuildCost";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const CARRIED = ["rp1.available", "rp1.buildCost"];

function mount() {
  const stream = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 1000,
  });
  const result = render(
    <stream.Provider>
      <BuildCostSection />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, container: result.container };
}

function emit(
  stream: ReturnType<typeof mount>,
  cost: Record<string, unknown> | undefined,
) {
  act(() => {
    stream.emit("rp1.available", true, { validAt: 1000 });
    if (cost !== undefined) {
      stream.emit("rp1.buildCost", cost, { validAt: 1000 });
    }
  });
}

const PRICED = {
  vehicleCost: 68400,
  untooledSurcharge: 41000,
  toolingCost: 12500,
  unlockCost: 0,
  rolloutCost: 900,
  requiredTechs: [],
};

describe("BuildCostSection: funds, and only funds", () => {
  /**
   * The section is invisible without RP-1, which is most installs. Asserted
   * because a section that rendered its own empty state on a stock career would
   * put an RP-1 heading on a widget that has no RP-1 behind it.
   */
  it("draws nothing at all when RP-1 is not present", () => {
    mount();

    expect(
      screen.queryByText("WHAT THIS LAUNCH COSTS"),
    ).not.toBeInTheDocument();
  });

  /**
   * No reading is NOT a free vehicle. RP-1 keeps its editor figures only while a
   * ship is on the table, and a column of zeros would say the launch costs
   * nothing.
   */
  it("says there is no vehicle rather than showing a column of zeros", async () => {
    const stream = mount();

    emit(stream, undefined);

    expect(
      await screen.findByText(/No vehicle being designed/i),
    ).toBeInTheDocument();
    expect(visibleText(stream.container)).not.toContain("0f");
  });

  it("renders every line a launch is paid for in", async () => {
    const stream = mount();

    emit(stream, PRICED);

    const text = visibleText(
      await screen
        .findByText("WHAT THIS LAUNCH COSTS")
        .then((el) => el.closest("section") ?? stream.container),
    );
    expect(text).toContain("Vehicle");
    expect(text).toContain("Tooling");
    expect(text).toContain("Rollout");
  });

  /**
   * The assertion the whole section is shaped around. The surcharge is INSIDE the
   * vehicle cost, so the wording has to say so: an operator who reads the column
   * as a sum arrives at a number larger than the launch costs.
   */
  it("says the surcharge is part of the vehicle cost rather than on top of it", async () => {
    const stream = mount();

    emit(stream, PRICED);

    expect(await screen.findByText(/untooled/)).toBeInTheDocument();
    expect(visibleText(stream.container)).toContain("not on top of it");
  });

  /**
   * And the complement, which is what makes the test above non-vacuous: a vehicle
   * with nothing untooled has no such row and no such sentence, rather than a
   * zero one.
   */
  it("omits the surcharge entirely when there is none", async () => {
    const stream = mount();

    emit(stream, { ...PRICED, untooledSurcharge: null });

    await screen.findByText("WHAT THIS LAUNCH COSTS");
    expect(visibleText(stream.container)).not.toContain("not on top of it");
  });

  /**
   * A figure RP-1 leaves absent is a dash, not a zero. A spaceplane has no
   * rollout because it does not roll out, and "free" is a different claim.
   */
  it("shows an inapplicable rollout as absent rather than free", async () => {
    const stream = mount();

    emit(stream, { ...PRICED, rolloutCost: null });

    await screen.findByText("WHAT THIS LAUNCH COSTS");
    expect(visibleText(stream.container)).toContain(NULL_DISPLAY);
  });

  /**
   * Not a cost, and on the costs section anyway: it is the reason a vehicle that
   * prices fine still cannot be flown.
   */
  it("names the techs the vehicle cannot fly without", async () => {
    const stream = mount();

    emit(stream, { ...PRICED, requiredTechs: ["supersonicFlight"] });

    expect(await screen.findByText("supersonicFlight")).toBeInTheDocument();
    expect(screen.getByText("Needs tech")).toBeInTheDocument();
  });
});
