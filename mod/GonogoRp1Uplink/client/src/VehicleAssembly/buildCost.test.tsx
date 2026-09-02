import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
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

/** One blocking node, as the wire carries it. */
function node(
  id: string,
  title?: string,
  parts?: string[],
): Record<string, unknown> {
  return { id, title: title ?? null, parts: parts ?? null };
}

describe("BuildCostSection: funds, and only funds", () => {
  /**
   * The section is invisible without RP-1, which is most installs. Asserted
   * because a section that rendered its own empty state on a stock career would
   * put an RP-1 heading on a widget that has no RP-1 behind it.
   */
  it("draws nothing at all when RP-1 is not present", () => {
    mount();

    expect(screen.queryByText("LAUNCH COST")).not.toBeInTheDocument();
  });

  /**
   * No reading is NOT a free vehicle. RP-1 keeps its editor figures only while a
   * ship is on the table, and a column of zeros would say the launch costs
   * nothing.
   */
  it("renders nothing at all rather than a heading over an empty answer", async () => {
    const stream = mount();

    emit(stream, undefined);

    // The section used to draw its title and a sentence saying it had nothing
    // to say. An operator who is not designing a vehicle is not asking what one
    // costs, so the honest expression of absent is silence.
    await waitFor(() => {
      expect(
        stream.container.querySelector("[data-build-cost-section]"),
      ).toBeNull();
    });
    // Still not a column of zeros, which is the thing that would be a LIE
    // rather than merely noise.
    expect(visibleText(stream.container)).not.toContain("0f");
    expect(visibleText(stream.container)).not.toContain("LAUNCH COST");
  });

  it("renders every line a launch is paid for in", async () => {
    const stream = mount();

    emit(stream, PRICED);

    const text = visibleText(
      await screen
        .findByText("LAUNCH COST")
        .then((el) => el.closest("section") ?? stream.container),
    );
    expect(text).toContain("Vehicle");
    expect(text).toContain("Tooling");
    expect(text).toContain("Rollout");
  });

  /**
   * The containment is STRUCTURAL, so this asserts the structure rather than a
   * sentence. The surcharge is inside the vehicle cost, and an operator who reads
   * the column as a sum arrives at more than the launch costs; the indent is what
   * stops that, on every render and at every size, where prose was clipped away at
   * the narrow ones.
   *
   * <para>Asserted through the marker the indent container carries rather than
   * through a class or a pixel offset: the test should fail if the row stops being
   * SUBORDINATE, not if the design system changes how far it insets.</para>
   */
  it("nests the surcharge under the vehicle cost rather than beside it", async () => {
    const stream = mount();

    emit(stream, PRICED);
    await screen.findByText("Untooled");

    const nested = stream.container.querySelector("[data-of-which]");
    expect(nested).not.toBeNull();
    expect(nested?.textContent).toContain("Untooled");

    // And the prose it replaced is gone, so a later edit cannot quietly put a
    // sentence back beside the structure that now carries the meaning.
    expect(visibleText(stream.container)).not.toContain("not on top of it");
    expect(visibleText(stream.container)).not.toContain("charged once");
  });

  /**
   * And the complement, which is what makes the test above non-vacuous: a vehicle
   * with nothing untooled has no such row and no such sentence, rather than a
   * zero one.
   */
  it("omits the surcharge entirely when there is none", async () => {
    const stream = mount();

    emit(stream, { ...PRICED, untooledSurcharge: null });

    await screen.findByText("LAUNCH COST");
    expect(visibleText(stream.container)).not.toContain("not on top of it");
  });

  /**
   * A figure RP-1 leaves absent is a dash, not a zero. A spaceplane has no
   * rollout because it does not roll out, and "free" is a different claim.
   */
  it("shows an inapplicable rollout as absent rather than free", async () => {
    const stream = mount();

    emit(stream, { ...PRICED, rolloutCost: null });

    await screen.findByText("LAUNCH COST");
    expect(visibleText(stream.container)).toContain(NULL_DISPLAY);
  });

  // ── The blocking tech nodes ───────────────────────────────────────────────

  /**
   * Not a cost, and on the costs section anyway: it is the reason a vehicle that
   * prices fine still cannot be flown.
   *
   * <para>The node is named by its TITLE, which is what the wire now carries
   * beside the id. `supersonicFlight` is an identifier and said nothing about
   * what the node is.</para>
   */
  it("names the techs the vehicle cannot fly without", async () => {
    const stream = mount();

    emit(stream, {
      ...PRICED,
      requiredTechs: [node("supersonicFlight", "Supersonic Flight")],
    });

    expect(await screen.findByText("Supersonic Flight")).toBeInTheDocument();
    expect(screen.getByText("Needs tech")).toBeInTheDocument();
  });

  /**
   * A node the career's tree has no title for falls back to its ID rather than
   * rendering nameless.
   *
   * <para>This is why the wire leaves the title ABSENT instead of substituting
   * the id: a producer that substituted would leave a client unable to tell a
   * titled node from an untitled one, and unable to make this choice at all. An
   * id is at least searchable in a tech tree.</para>
   */
  it("falls back to the node id where the tree has no title for it", async () => {
    const stream = mount();

    emit(stream, { ...PRICED, requiredTechs: [node("someModdedNode")] });

    expect(await screen.findByText("someModdedNode")).toBeInTheDocument();
  });

  /**
   * ONE badge, however many nodes are missing.
   *
   * <para>This drew a critical badge per tech id, so a vehicle missing five
   * nodes got five red alarms. Severity is a reading about the VEHICLE and the
   * vehicle has one state here: it needs tech the career has not researched.
   * The fifth red badge says nothing the first did not, and using severity as
   * decoration spends the one signal that is supposed to mean "this cannot
   * fly".</para>
   *
   * <para>Both halves are asserted, and the pair is what makes it meaningful:
   * five nodes ARE on screen as five rows, and the state is said ONCE over
   * them.</para>
   */
  it("draws one severity badge whatever the number of missing nodes", async () => {
    const stream = mount();

    emit(stream, {
      ...PRICED,
      requiredTechs: [
        node("supersonicFlight", "Supersonic Flight"),
        node("highAltitudeFlight", "High Altitude Flight"),
        node("heavyAerodynamics", "Heavy Aerodynamics"),
        node("hypersonicFlight", "Hypersonic Flight"),
        node("experimentalAerodynamics", "Experimental Aerodynamics"),
      ],
    });

    await screen.findByText("Supersonic Flight");
    expect(
      stream.container.querySelectorAll("[data-blocking-node]"),
    ).toHaveLength(5);
    expect(screen.getAllByText("Needs tech")).toHaveLength(1);
  });

  /**
   * The half that makes a row an ANSWER rather than a name, and the operator's
   * actual question: "it's not clear what the tech is needed for".
   *
   * <para>The parts sit UNDER their node rather than the node being repeated
   * beside each part. This surface is about the vehicle and has no part list of
   * its own, so the question it answers is what the vehicle is missing; a node
   * blocking two parts is one thing to research, not two rows.</para>
   */
  it("names what on the vehicle is waiting for each node", async () => {
    const stream = mount();

    emit(stream, {
      ...PRICED,
      requiredTechs: [
        node("supersonicFlight", "Supersonic Flight", [
          "Ram Air Intake",
          "XM-G50 Radial Intake",
        ]),
      ],
    });

    await screen.findByText("Supersonic Flight");
    const row = stream.container.querySelector("[data-blocking-node]");
    expect(row?.textContent).toContain("Ram Air Intake, XM-G50 Radial Intake");
  });

  /**
   * A node NOTHING on the ship names says so, rather than leaving a blank under
   * it.
   *
   * <para>A node can be required by something other than a part, so an empty
   * list is a real answer. Said out loud because an operator looking at a node
   * with nothing under it cannot otherwise tell "nothing needs this" from "we
   * could not work out what needs this", and those are the two states the wire
   * deliberately distinguishes.</para>
   */
  it("says so when nothing on the vehicle names a node", async () => {
    const stream = mount();

    emit(stream, {
      ...PRICED,
      requiredTechs: [node("flightControl", "Flight Control", [])],
    });

    await screen.findByText("Flight Control");
    const row = stream.container.querySelector("[data-blocking-node]");
    expect(row?.textContent).toContain("nothing on this vehicle names it");
  });

  /**
   * And the third state: an ABSENT parts list draws nothing at all, because the
   * editor ship could not be read and no claim is available to make.
   *
   * <para>The complement of the test above, and what stops that sentence being
   * printed over an unknown.</para>
   */
  it("claims nothing about waiting parts when the ship could not be read", async () => {
    const stream = mount();

    emit(stream, {
      ...PRICED,
      requiredTechs: [node("supersonicFlight", "Supersonic Flight")],
    });

    await screen.findByText("Supersonic Flight");
    const row = stream.container.querySelector("[data-blocking-node]");
    expect(row?.textContent).not.toContain("nothing on this vehicle names it");
  });
});
