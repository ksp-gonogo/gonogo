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
import { afterEach, describe, expect, it } from "vitest";
import { ToolingSection } from "./Tooling";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const CARRIED = ["rp1.available", "rp1.tooling"];

function mount() {
  const stream = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 1000,
  });
  const result = render(
    <stream.Provider>
      <ToolingSection />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, container: result.container };
}

function emit(
  stream: ReturnType<typeof mount>,
  tooling: Record<string, unknown> | undefined,
) {
  act(() => {
    stream.emit("rp1.available", true, { validAt: 1000 });
    if (tooling !== undefined) {
      stream.emit("rp1.tooling", tooling, { validAt: 1000 });
    }
  });
}

/** Two parts of one size, and a third of another that is already paid for. */
const SHARED = {
  toolAllCost: 12500,
  untooledCount: 2,
  parts: [
    {
      partTitle: "Procedural Tank",
      toolingType: "TankStructural",
      toolingTypeTitle: "Structural tank",
      parameterSummary: "3.000m x 5.000m",
      tooled: false,
      toolingCost: 9000,
      untooledSurcharge: 4100,
      partId: "part-1",
      symmetryCounterparts: 1,
      refittable: true,
    },
    {
      partTitle: "Procedural Tank",
      toolingType: "TankStructural",
      toolingTypeTitle: "Structural tank",
      parameterSummary: "3.000m x 5.000m",
      tooled: false,
      toolingCost: 9000,
      untooledSurcharge: 4100,
      partId: "part-2",
      symmetryCounterparts: 1,
      refittable: true,
    },
    {
      partTitle: "Engine Mount",
      toolingType: "TankStructural",
      toolingTypeTitle: "Structural tank",
      parameterSummary: "1.500m x 0.400m",
      tooled: true,
      toolingCost: 0,
      untooledSurcharge: 0,
      partId: "part-3",
      symmetryCounterparts: 0,
      refittable: true,
    },
  ],
};

describe("ToolingSection: what a vehicle owes, and what it costs not to pay", () => {
  /**
   * Invisible without RP-1, which is most installs. A heading naming an RP-1
   * concept on a stock career describes a system that is not there.
   */
  it("draws nothing at all when RP-1 is not present", () => {
    mount();

    expect(screen.queryByText("TOOLING")).not.toBeInTheDocument();
  });

  /**
   * The channel's own headline: no sample is NOT "everything is tooled". It
   * means no ship on the editor's table, or RP-1's tooling switched off, and in
   * that second case RP-1's own level lookup would have reported a finished
   * vehicle. A section that drew "all tooled" here would state the one thing
   * the wire refuses to say.
   */
  it("renders nothing rather than claiming the vehicle is fully tooled", async () => {
    const stream = mount();

    emit(stream, undefined);

    await waitFor(() => {
      expect(
        stream.container.querySelector("[data-tooling-section]"),
      ).toBeNull();
    });
    expect(visibleText(stream.container)).not.toContain("TOOLING");
    expect(visibleText(stream.container)).not.toContain("Tooled");
  });

  it("names each tooling by what it is and what size it is", async () => {
    const stream = mount();

    emit(stream, SHARED);

    expect(await screen.findByText("TOOLING")).toBeInTheDocument();
    expect(screen.getAllByText("Structural tank").length).toBeGreaterThan(0);
    expect(screen.getByText("3.000m x 5.000m")).toBeInTheDocument();
    expect(screen.getByText("1.500m x 0.400m")).toBeInTheDocument();
  });

  /**
   * The structural half of the fuzzy-match consequence, and the reason the rows
   * are grouped at all.
   *
   * <para>A tooling covers every part of its type whose parameters match, so two
   * parts of one size are ONE purchase. Drawn as two rows each priced at 9,000f
   * an operator reads 18,000f and budgets for a vehicle that costs 9,000f to
   * tool. The price appears once, for the purchase, with both parts named under
   * it.</para>
   */
  it("prices two parts of one size as a single purchase, once", async () => {
    const stream = mount();

    emit(stream, SHARED);
    await screen.findByText("TOOLING");

    // A purchase is a card, and a card is a list item. Queried by its role
    // rather than by a marker of our own: the list semantics are the card's own
    // documented contract and are what a screen reader reads too.
    const purchases = screen.getAllByRole("listitem");
    // Three parts, two sizes, so two purchases rather than three.
    expect(purchases).toHaveLength(2);

    const shared = purchases.find((node) =>
      node.textContent?.includes("3.000m x 5.000m"),
    );
    expect(shared).toBeDefined();
    // Both parts named, and the once-off price stated exactly once between them.
    expect(shared?.textContent).toContain("Procedural Tank");
    expect(shared?.querySelectorAll("[data-tooling-once]")).toHaveLength(1);
  });

  /**
   * The number the decision actually turns on: the surcharge is paid on every
   * copy of the vehicle, for ever, and the tooling is paid once. It is PER PART
   * where the price is per purchase, so it is drawn per part.
   */
  it("states the standing surcharge for each untooled part", async () => {
    const stream = mount();

    emit(stream, SHARED);
    await screen.findByText("TOOLING");

    const perBuild = stream.container.querySelectorAll(
      "[data-tooling-per-build]",
    );
    // One for each of the two untooled parts; the tooled one owes nothing.
    expect(perBuild).toHaveLength(2);
  });

  /**
   * A tooling already owned is a real reading and travels for that reason: it
   * says the money has been spent. It carries no price, because there is
   * nothing left to buy.
   */
  it("marks an owned tooling as paid for rather than pricing it again", async () => {
    const stream = mount();

    emit(stream, SHARED);
    await screen.findByText("TOOLING");

    const owned = screen
      .getAllByRole("listitem")
      .find((node) => node.textContent?.includes("1.500m x 0.400m"));
    expect(owned?.textContent).toContain("Tooled");
    expect(owned?.querySelector("[data-tooling-once]")).toBeNull();
  });

  /**
   * RP-1's own deduplicated whole-ship price, drawn on the control rather than
   * under the rows.
   *
   * <para>It is NOT the sum of the purchases above it: a tooling covers anything
   * of its type within four per cent, so paying for one can leave a neighbour of
   * a different size free. Placed at the foot of the column it would read as
   * that column's total and be wrong by however much the fuzzy match saves. It
   * sits with the button it is the price of.</para>
   */
  it("shows RP-1's whole-ship price with the control, not under the rows", async () => {
    const stream = mount();

    emit(stream, SHARED);
    await screen.findByText("TOOLING");

    const header = stream.container.querySelector("[data-tooling-header]");
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain("Tool all");
    expect(
      screen.getByRole("button", { name: /tool this vehicle/i }),
    ).toBeInTheDocument();
  });

  /**
   * Nothing outstanding is not a reason to draw a dead purchase button: the
   * command's own answer to it is a refusal, and a control whose only outcome is
   * a refusal is a control that should not be there.
   */
  it("offers no purchase when every tooling is already owned", async () => {
    const stream = mount();

    emit(stream, {
      toolAllCost: 0,
      untooledCount: 0,
      parts: [SHARED.parts[2]],
    });

    await screen.findByText("TOOLING");
    expect(
      screen.queryByRole("button", { name: /tool this vehicle/i }),
    ).not.toBeInTheDocument();
  });

  /**
   * The client never computes affordability, and this is what holds that.
   *
   * <para>RP-1 charges a tooling purchase through its unlock-credit pool before
   * it reaches funds, so a balance of 100f and a price of 12,500f is not a
   * refusal: the credit may cover all of it. The command asks RP-1 and refuses
   * in RP-1's own words. A client that drew its own verdict from the funds
   * balance would be confidently wrong exactly when the career has credit.</para>
   */
  it("never draws its own affordability verdict", async () => {
    const stream = mount();

    emit(stream, SHARED);
    await screen.findByText("TOOLING");

    const text = visibleText(stream.container);
    expect(text).not.toContain("cannot afford");
    expect(text).not.toContain("Cannot afford");
    expect(text).not.toContain("Insufficient");
    // And the control is live rather than dark: only RP-1 knows the answer.
    expect(
      screen.getByRole("button", { name: /tool this vehicle/i }),
    ).toBeEnabled();
  });

  /**
   * A purchase whose price RP-1 could not read is still offered, and says so
   * where the price would be. The command refuses in RP-1's words if the field
   * really is unreadable, which is a better answer than a client guessing one.
   */
  it("says the whole-ship price is unread rather than showing it as free", async () => {
    const stream = mount();

    emit(stream, { ...SHARED, toolAllCost: null });

    await screen.findByText("TOOLING");
    const header = stream.container.querySelector("[data-tooling-header]");
    expect(header?.textContent).not.toContain("0f");
  });

  it("has no accessibility violations with a purchase on offer", async () => {
    const stream = mount();

    emit(stream, SHARED);
    await screen.findByText("TOOLING");

    await expectNoA11yViolations(stream.container);
  });
});
