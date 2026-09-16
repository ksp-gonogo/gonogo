import { value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Unit } from "./Unit";
import { UnitSharedFormat, useSharedFormat } from "./UnitSharedFormat";

describe("UnitSharedFormat", () => {
  /**
   * The failure that started this: two readings either side of a rung boundary
   * print in two different units, and the reader has to convert one of them
   * before the pair means anything.
   */
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

  /**
   * The rung the LARGEST member would pick (operator, 2026-09-13), because the
   * group is a group about its biggest reading: 3400 m reads `3.4 km`, so the
   * 500 m beside it reads `0.5 km` rather than dragging the pair down to a
   * four-digit `3400.0 m`.
   */
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

  /**
   * A zero is the smallest reading there is, so the largest-member rule leaves
   * it out of the choice on its own: no clause excludes it, and it still cannot
   * drag a group to the bottom of its ladder.
   */
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

  /**
   * The case the deleted zero-exclusion clause used to reach, and the reason it
   * could go: a group of nothing but zeros has a winner like any other, and its
   * members read alike because a zero is a zero at every rung. Excluding them
   * left the group unsettled and each member answering for itself, so two
   * readings of the same nothing printed in two units.
   */
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

  /**
   * The operator's requirement that a MIXED set works. Grouping is per kind, so
   * one scope settles metres and kilograms separately with nobody separating
   * them at the call site.
   */
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

  /**
   * The group settles a FORMAT and not just a rung. Both readings land on the
   * megametre rung, where a length's default single decimal prints each of them
   * as `6.7 Mm`, and no member can see that on its own: how many digits it
   * takes to tell two readings apart is a fact about the whole group.
   *
   * The caller here does what every caller does, which is wrap.
   */
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

  /**
   * A column of thirty cells has no promise to keep about the two closest of
   * them, and widening it until they read apart would print six decimals of
   * noise in every row. So separating is asked for, never assumed.
   */
  it("leaves the digits alone in a group that did not ask to read apart", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 6_700_000)} />
        <Unit value={value("m", 6_710_000)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).not.toContain("6.70");
  });

  /** Nothing to separate, and six decimals of noise is not an improvement. */
  it("does not widen a group whose members agree", () => {
    const { container } = render(
      <UnitSharedFormat separate>
        <Unit value={value("m", 6_700_000)} />
        <Unit value={value("m", 6_700_000)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).not.toContain("6.7000");
  });

  /**
   * The escape the operator kept: a caller may still PIN what the group would
   * otherwise settle. Stated once, on the scope, rather than at each member,
   * which is the difference between pinning and threading an answer back down.
   */
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

  /**
   * The defect `of` exists to close, and it broke the one promise this whole
   * component makes. A flat pin reached every group, so a scope pinned to
   * kilometres handed `format: "km"` to its KILOGRAMS as well; the formatter
   * refused the cross-kind rung, but the pin had already displaced the rung the
   * kilogram group settled for itself, and the two masses rendered as
   * `500.00 kg` and `1.00 kt`. One group, two units, which is exactly what a
   * shared format is for.
   */
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

  /**
   * A mixed scope pins each group under its own name, which is the only honest
   * way to pin two of them at once: one flat set of props cannot say two
   * things.
   */
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

  /**
   * Entries are opt-in: a group the map does not mention settles for itself,
   * which is what makes the map the whole statement a mixed scope has to make.
   */
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

  /**
   * The key names the GROUP, so one pin reaches every unit that settles with
   * it. A unit-keyed record made this ambiguous rather than wrong: `{ m: ... }`
   * and `{ km: ... }` addressed one length group by two names, and whichever
   * was written last silently won.
   */
  it("reaches every unit of the laddered kind it names", () => {
    render(
      <UnitSharedFormat pins={{ length: { format: "km" } }}>
        <Unit value={value("m", 4000)} />
        <Unit value={value("Mm", 3)} />
      </UnitSharedFormat>,
    );
    expect(screen.queryAllByText("kilometres")).toHaveLength(2);
  });

  /**
   * A pin that names no unit cannot be addressed to one, so it still reaches
   * every group, exactly as every pin did before `of` existed. Kept because the
   * scope is also a plain grouping mechanism and a caller holding a
   * `Value<string>` has no kind to name.
   */
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

  /**
   * The group is assembled from what is mounted, not from what has ever been
   * mounted, so a member leaving re-settles the rest. A high-water mark would
   * pin a stale rung for the life of the scope.
   */
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

  /**
   * A caller who pinned the rung on the MEMBER has already answered the question
   * the group exists to answer, so the pin wins and the value is not in the
   * group at all.
   */
  it("leaves a pinned rung alone", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 3_400_000)} format="m" />
        <Unit value={value("m", 1000)} />
      </UnitSharedFormat>,
    );
    // Held at metres, where the group would have put it on kilometres.
    expect(container.textContent).toContain("3,400,000.0");
    // And out of the group entirely, so the other reading is alone in it and
    // keeps the rung its own magnitude earns.
    expect(container.textContent).toContain("1.0");
    expect(container.textContent).toContain("km");
  });

  /**
   * A group rung changes the symbol, and a symbol is read out loud as a word.
   * The word is derived from the symbol actually rendered, so a spoken reading
   * cannot describe a rung the reader is not looking at.
   */
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
   * The whole engineering risk of a reporting context: a member cannot know the
   * group format until the group is assembled, so there is a second pass, and a
   * second pass that feeds itself never stops.
   *
   * What makes it stop is structural: a report is a function of the member's own
   * props, never of the format it was handed back, so the second pass reproduces
   * the first pass's reports exactly and settles on the same answer. This counts
   * the passes. A design that fed itself would not merely count higher here, it
   * would exceed React's update depth and throw.
   */
  it("settles in one extra pass and schedules nothing after it", async () => {
    let renders = 0;
    /** A member as `Unit` is one: it reports, and it reads the answer back. */
    function Counted({ magnitude }: { magnitude: number }) {
      renders += 1;
      const shared = useSharedFormat(value("m", magnitude));
      return <span>{shared?.format ?? "unsettled"}</span>;
    }
    /*
     * Built fresh each time rather than held in a constant: React bails out of
     * re-rendering a subtree handed back the identical element, so a reused one
     * would prove nothing about the second render.
     */
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

    // An unchanged re-render reports the same readings, so the group's answer
    // does not move and no member is rendered a second time for it. A fresh
    // `Value` per render is deliberate: what a member reports is its magnitude
    // and its unit, so an equal reading in a new object is not a change.
    rerender(members());
    expect(renders).toBe(afterMount + 3);
  });

  /**
   * A band inside an aligned column wants the COLUMN's rung, so a scope inside
   * a scope inherits it instead of settling one of its own.
   */
  it("takes the rung from the outermost scope rather than starting a new one", () => {
    const { container } = render(
      <UnitSharedFormat>
        <Unit value={value("m", 3400)} />
        <UnitSharedFormat>
          <Unit value={value("m", 500)} />
        </UnitSharedFormat>
      </UnitSharedFormat>,
    );
    // Alone the inner member reads `500.0 m`; in the column it reads the
    // column's kilometres.
    expect(screen.queryAllByText("kilometres")).toHaveLength(2);
    expect(container.textContent).not.toContain("500.0");
  });

  /**
   * And the other half of the same rule: the column decides the unit, the band
   * inside it still decides how many digits its own two ends need. Both ends
   * here would print `1.0 Mm` at the column's rung, and the inner scope widens
   * them without dragging the column's other cell along.
   */
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
