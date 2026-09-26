import { value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Unit } from "./Unit";
import { UnitSharedFormat, useSharedFormat } from "./UnitSharedFormat";

describe("UnitSharedFormat", () => {
  // Two readings either side of a rung boundary print in one unit.
  it("settles one rung across readings that straddle a boundary", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 999)} />
        <Unit value={value("m", 1000)} />
      </UnitSharedFormat>,
    );
    expect(screen.queryAllByText("kilometres")).toHaveLength(2);
    expect(container.textContent).not.toContain("999");
  });

  // The largest member picks the rung: 500 m beside 3400 m reads `0.5 km`, not `3400.0 m`.
  it("takes the largest member's rung rather than the smallest", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 500)} />
        <Unit value={value("m", 3400)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).toContain("0.5");
    expect(container.textContent).toContain("3.4");
    expect(screen.queryAllByText("kilometres")).toHaveLength(2);
  });

  describe("hideUnitInGroup", () => {
    it("draws the symbol once when the first member hides it", () => {
      const { container } = render(
        <UnitSharedFormat>
          <Unit value={value("m", 1200)} hideUnitInGroup />
          {"/"}
          <Unit value={value("m", 2000)} />
        </UnitSharedFormat>,
      );
      expect(screen.queryAllByText("kilometres")).toHaveLength(1);
      expect(container.textContent).toContain("1.2");
      expect(container.textContent).toContain("2.0");
    });

    // The hidden member is the larger, so this fails if hiding it also dropped its vote on the rung.
    it("still lets a hidden member's scale decide the group's rung", () => {
      const { container } = render(
        <UnitSharedFormat>
          <Unit value={value("m", 3400)} hideUnitInGroup />
          <Unit value={value("m", 500)} />
        </UnitSharedFormat>,
      );
      expect(container.textContent).toContain("0.5");
      expect(container.textContent).not.toContain("500");
      expect(screen.queryAllByText("kilometres")).toHaveLength(1);
    });

    // `rpm` climbs no ladder, so its group settles nothing; membership, not a settled answer, must gate the hiding.
    it("hides the symbol for a unit that climbs no ladder", () => {
      const { container } = render(
        <UnitSharedFormat>
          <Unit value={value("rpm", 200)} decimals={0} hideUnitInGroup />
          {"/"}
          <Unit value={value("rpm", 300)} decimals={0} />
        </UnitSharedFormat>,
      );
      expect(screen.queryAllByText("revolutions per minute")).toHaveLength(1);
      expect(container.textContent).toContain("200/300");
    });

    // A number with no unit anywhere near it is not a readout, so the prop is inert on its own.
    it("does nothing on a lone Unit with no scope above it", () => {
      render(<Unit value={value("m", 1200)} hideUnitInGroup />);
      expect(screen.queryAllByText("kilometres")).toHaveLength(1);
    });
  });

  // A zero is the smallest reading, so the largest-member rule already keeps it from dragging the group down.
  it("does not let a zero member drag the group to the base unit", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 0)} />
        <Unit value={value("m", 3_400_000)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).toContain("3.4");
    expect(container.textContent).toContain("Mm");
    expect(screen.queryAllByText("megametres")).toHaveLength(2);
  });

  // A group of zeros still settles, so two readings of the same nothing print in one unit.
  it("settles a group whose every member is zero", () => {
    render(
      <UnitSharedFormat>
        <Unit value={value("km", 0)} />
        <Unit value={value("m", 0)} />
      </UnitSharedFormat>,
    );
    expect(screen.queryAllByText("metres")).toHaveLength(2);
    expect(screen.queryAllByText("kilometres")).toHaveLength(0);
  });

  // Grouping is per kind, so one scope settles metres and kilograms separately.
  it("settles a format per kind rather than one for the whole scope", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 2_500_000)} />
        <Unit value={value("kg", 900)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).toContain("2.5");
    expect(container.textContent).toContain("Mm");
    expect(container.textContent).toContain("900.00");
    expect(container.textContent).toContain("kg");
  });

  // How many digits it takes to tell two readings apart is a fact about the whole group, not any one member.
  it("settles the digit count too, when the scope asks its members to read apart", () => {
    const { container } = render(
      <UnitSharedFormat separate>
        <Unit value={value("m", 6_700_000)} />
        <Unit value={value("m", 6_710_000)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).toContain("6.70");
    expect(container.textContent).toContain("6.71");
    expect(container.textContent).toContain("Mm");
  });

  // Separating is asked for, never assumed: a column would otherwise print decimals of noise in every row.
  it("leaves the digits alone in a group that did not ask to read apart", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 6_700_000)} />
        <Unit value={value("m", 6_710_000)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).not.toContain("6.70");
  });

  it("does not widen a group whose members agree", () => {
    const { container } = render(
      <UnitSharedFormat separate>
        <Unit value={value("m", 6_700_000)} />
        <Unit value={value("m", 6_700_000)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).not.toContain("6.7000");
  });

  // A pin on the scope overrides what the group would otherwise settle.
  it("lets the scope pin the digits the group would have settled", () => {
    const { container } = render(
      <UnitSharedFormat separate decimals={4}>
        <Unit value={value("m", 6_700_000)} />
        <Unit value={value("m", 6_710_000)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).toContain("6.7000");
    expect(container.textContent).toContain("6.7100");
  });

  it("lets the scope pin the rung the group would have settled", () => {
    // The group would have said kilometres, 1000 m being the larger member.
    render(
      <UnitSharedFormat of="m" format="m">
        <Unit value={value("m", 999)} />
        <Unit value={value("m", 1000)} />
      </UnitSharedFormat>,
    );
    expect(screen.queryAllByText("metres")).toHaveLength(2);
    expect(screen.queryAllByText("kilometres")).toHaveLength(0);
  });

  // A pin addressed with `of` reaches only its own group, so the masses still settle one unit between them.
  it("leaves a group the pin does not name settling for itself", () => {
    render(
      <UnitSharedFormat of="m" format="km">
        <Unit value={value("kg", 500)} />
        <Unit value={value("kg", 1_000_000)} />
      </UnitSharedFormat>,
    );
    // One unit across the pair, and the mass group is the one that chose it.
    expect(screen.queryAllByText("kilotonnes")).toHaveLength(2);
    expect(screen.queryAllByText("kilograms")).toHaveLength(0);
  });

  // A mixed scope pins each group under its own name.
  it("pins each named group in the unit it is keyed to", () => {
    render(
      <UnitSharedFormat
        pins={{ length: { format: "km" }, mass: { format: "t" } }}
      >
        <Unit value={value("m", 999)} />
        <Unit value={value("kg", 500)} />
      </UnitSharedFormat>,
    );
    expect(screen.queryAllByText("kilometres")).toHaveLength(1);
    expect(screen.queryAllByText("tonnes")).toHaveLength(1);
  });

  // A group the map does not mention settles for itself.
  it("leaves a group the pin map omits settling for itself", () => {
    render(
      <UnitSharedFormat pins={{ length: { format: "km" } }}>
        <Unit value={value("m", 999)} />
        <Unit value={value("kg", 500)} />
        <Unit value={value("kg", 1_000_000)} />
      </UnitSharedFormat>,
    );
    expect(screen.queryAllByText("kilometres")).toHaveLength(1);
    expect(screen.queryAllByText("kilotonnes")).toHaveLength(2);
  });

  // The key names the group, so one pin reaches every unit that settles with it.
  it("reaches every unit of the laddered kind it names", () => {
    render(
      <UnitSharedFormat pins={{ length: { format: "km" } }}>
        <Unit value={value("m", 4000)} />
        <Unit value={value("Mm", 3)} />
      </UnitSharedFormat>,
    );
    expect(screen.queryAllByText("kilometres")).toHaveLength(2);
  });

  // A pin that names no unit reaches every group.
  it("hands an unaddressed pin to every group in the scope", () => {
    const { container } = render(
      <UnitSharedFormat decimals={3}>
        <Unit value={value("m", 999)} />
        <Unit value={value("kg", 500)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).toContain("999.000");
    expect(container.textContent).toContain("500.000");
  });

  // The group is what is mounted now, so a member leaving re-settles the rest.
  it("re-settles when the member that was holding the rung unmounts", async () => {
    function Pair() {
      const [showLarge, setShowLarge] = useState(true);
      return (
        <UnitSharedFormat>
          <Unit value={value("m", 500)} />
          {showLarge && <Unit value={value("m", 3400)} />}
          <button type="button" onClick={() => setShowLarge(false)}>
            drop
          </button>
        </UnitSharedFormat>
      );
    }
    const { container } = render(<Pair />);
    expect(container.textContent).toContain("0.5");

    await act(async () => {
      screen.getByRole("button", { name: "drop" }).click();
    });
    expect(container.textContent).toContain("500.0");
    expect(container.textContent).not.toContain("km");
  });

  it("leaves a Unit with no scope above it on its own ladder", () => {
    const { container } = render(
      <>
        <Unit value={value("m", 999)} />
        <Unit value={value("m", 1000)} />
      </>,
    );
    expect(container.textContent).toContain("999.0");
    expect(container.textContent).toContain("1.0");
    expect(container.textContent).toContain("km");
  });

  // A member that pins its own rung is not in the group at all.
  it("leaves a pinned rung alone", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 3_400_000)} format="m" />
        <Unit value={value("m", 1000)} />
      </UnitSharedFormat>,
    );
    // Held at metres, where the group would have put it on kilometres.
    expect(container.textContent).toContain("3,400,000.0");
    // And out of the group entirely, so the other reading is alone in it and keeps the rung its own magnitude earns.
    expect(container.textContent).toContain("1.0");
    expect(container.textContent).toContain("km");
  });

  // The spoken word follows the symbol actually rendered at the group's rung.
  it("speaks the rung the group settled on", () => {
    render(
      <UnitSharedFormat>
        <Unit value={value("m", 999)} />
        <Unit value={value("m", 1000)} />
      </UnitSharedFormat>,
    );
    expect(screen.queryAllByText("kilometres")).toHaveLength(2);
    expect(screen.queryAllByText("metres")).toHaveLength(0);
  });

  /**
   * A report depends only on the member's own props, never on the format handed back, so the group settles in one extra pass.
   * A design that fed itself would exceed React's update depth and throw.
   */
  it("settles in one extra pass and schedules nothing after it", async () => {
    let renders = 0;
    function Counted({ magnitude }: { magnitude: number }) {
      renders += 1;
      const shared = useSharedFormat(value("m", magnitude));
      return <span>{shared?.format ?? "unsettled"}</span>;
    }
    // Built fresh each time: React bails out of re-rendering an identical element, so a reused one would prove nothing.
    const members = () => (
      <UnitSharedFormat separate>
        <Counted magnitude={500} />
        <Counted magnitude={3400} />
        <Counted magnitude={12_000} />
      </UnitSharedFormat>
    );
    const { rerender } = render(members());
    // Three members, one pass to report and one to hear the answer.
    expect(renders).toBeLessThanOrEqual(6);
    expect(screen.queryAllByText("unsettled")).toHaveLength(0);

    // Nothing is in flight: a pending settle would land here.
    const afterMount = renders;
    await act(async () => {});
    expect(renders).toBe(afterMount);

    // An equal reading in a fresh `Value` is not a change, so an unchanged re-render renders no member a second time.
    rerender(members());
    expect(renders).toBe(afterMount + 3);
  });

  // A scope inside a scope inherits the outer rung instead of settling its own.
  it("takes the rung from the outermost scope rather than starting a new one", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 3400)} />
        <UnitSharedFormat>
          <Unit value={value("m", 500)} />
        </UnitSharedFormat>
      </UnitSharedFormat>,
    );
    // Alone the inner member reads `500.0 m`; in the column it reads the column's kilometres.
    expect(screen.queryAllByText("kilometres")).toHaveLength(2);
    expect(container.textContent).not.toContain("500.0");
  });

  // The outer scope decides the unit; the inner one still widens the digits its own two ends need.
  it("keeps a nested scope's own digit count while inheriting the rung", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 4_000_000)} />
        <UnitSharedFormat separate>
          <Unit value={value("m", 1_000_000)} />
          <Unit value={value("m", 1_010_000)} />
        </UnitSharedFormat>
      </UnitSharedFormat>,
    );
    expect(container.textContent).toContain("1.00");
    expect(container.textContent).toContain("1.01");
    // The outer cell is not in the inner group and keeps the kind's default.
    expect(container.textContent).toContain("4.0");
    expect(container.textContent).not.toContain("4.00");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <UnitSharedFormat separate>
        <Unit value={value("m", 999)} />
        <Unit value={value("m", 1000)} />
      </UnitSharedFormat>,
    );
    await expectNoA11yViolations(container);
  });
});
