import { value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Unit } from "./Unit";
import { UnitScale, useSharedRung } from "./UnitScale";

describe("UnitScale", () => {
  /**
   * The failure that started this: two readings either side of a rung boundary
   * print in two different units, and the reader has to convert one of them
   * before the pair means anything.
   */
  it("settles one rung across readings that straddle a boundary", () => {
    const { container } = render(
      <UnitScale>
        <Unit value={value("m", 999)} />
        <Unit value={value("m", 1000)} />
      </UnitScale>,
    );
    expect(container.textContent).toContain("999.0");
    expect(container.textContent).toContain("1000.0");
    expect(container.textContent).not.toContain("km");
  });

  /**
   * The rung the SMALLEST member would pick, because a group rung may not round
   * a member away: on kilometres the 500 m reading below is `0.5 km` and a
   * 5 m one would be `0.0 km`, which is not a reading.
   */
  it("takes the smallest member's rung rather than the largest", () => {
    const { container } = render(
      <UnitScale>
        <Unit value={value("m", 500)} />
        <Unit value={value("m", 3400)} />
      </UnitScale>,
    );
    expect(container.textContent).toContain("500.0");
    expect(container.textContent).toContain("3400.0");
  });

  /**
   * A zero is a reading and keeps its zero at every rung, so it has no stake in
   * the choice. Counting it would drag every group holding one to the bottom of
   * its ladder, and a zero reading is common rather than rare.
   */
  it("does not let a zero member drag the group to the base unit", () => {
    const { container } = render(
      <UnitScale>
        <Unit value={value("m", 0)} />
        <Unit value={value("m", 3_400_000)} />
      </UnitScale>,
    );
    expect(container.textContent).toContain("3.4");
    expect(container.textContent).toContain("Mm");
  });

  /**
   * The operator's requirement that a MIXED set works. Grouping is per kind, so
   * one scope settles metres and kilograms separately with nobody separating
   * them at the call site.
   */
  it("settles a rung per kind rather than one for the whole scope", () => {
    const { container } = render(
      <UnitScale>
        <Unit value={value("m", 2_500_000)} />
        <Unit value={value("kg", 900)} />
      </UnitScale>,
    );
    expect(container.textContent).toContain("2.5");
    expect(container.textContent).toContain("Mm");
    expect(container.textContent).toContain("900.00");
    expect(container.textContent).toContain("kg");
  });

  /**
   * The group is assembled from what is mounted, not from what has ever been
   * mounted, so a member leaving re-settles the rest. A high-water mark would
   * pin a stale rung for the life of the scope.
   */
  it("re-settles when the member that was holding the rung unmounts", async () => {
    function Pair() {
      const [showSmall, setShowSmall] = useState(true);
      return (
        <UnitScale>
          {showSmall && <Unit value={value("m", 500)} />}
          <Unit value={value("m", 3400)} />
          <button type="button" onClick={() => setShowSmall(false)}>
            drop
          </button>
        </UnitScale>
      );
    }
    const { container } = render(<Pair />);
    expect(container.textContent).toContain("3400.0");

    await act(async () => {
      screen.getByRole("button", { name: "drop" }).click();
    });
    expect(container.textContent).toContain("3.4");
    expect(container.textContent).toContain("km");
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
   * A caller who pinned the rung has already answered the question the group
   * exists to answer, so the pin wins and the value is not in the group at all.
   */
  it("leaves a pinned rung alone", () => {
    const { container } = render(
      <UnitScale>
        <Unit value={value("m", 3_400_000)} format="m" />
        <Unit value={value("m", 1000)} />
      </UnitScale>,
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
      <UnitScale>
        <Unit value={value("m", 999)} />
        <Unit value={value("m", 1000)} />
      </UnitScale>,
    );
    expect(screen.queryAllByText("kilometres")).toHaveLength(0);
    expect(screen.queryAllByText("metres")).toHaveLength(2);
  });

  /**
   * The whole engineering risk of a reporting context: a member cannot know the
   * group rung until the group is assembled, so there is a second pass, and a
   * second pass that feeds itself never stops.
   *
   * What makes it stop is structural: a report is a function of the member's own
   * props, never of the rung it was handed back, so the second pass reproduces
   * the first pass's reports exactly and settles on the same rung. This counts
   * the passes. A design that fed itself would not merely count higher here, it
   * would exceed React's update depth and throw.
   */
  it("settles in one extra pass and schedules nothing after it", async () => {
    let renders = 0;
    /** A member as `Unit` is one: it reports, and it reads the answer back. */
    function Counted({ magnitude }: { magnitude: number }) {
      renders += 1;
      const rung = useSharedRung(value("m", magnitude));
      return <span>{rung ?? "unsettled"}</span>;
    }
    /*
     * Built fresh each time rather than held in a constant: React bails out of
     * re-rendering a subtree handed back the identical element, so a reused one
     * would prove nothing about the second render.
     */
    const members = () => (
      <UnitScale>
        <Counted magnitude={500} />
        <Counted magnitude={3400} />
        <Counted magnitude={12_000} />
      </UnitScale>
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
   * A band inside an aligned column wants the COLUMN's rung, not one of its
   * own, so a scope inside a scope joins it instead of dividing it.
   */
  it("joins an enclosing scope rather than starting a nested one", () => {
    const { container } = render(
      <UnitScale>
        <Unit value={value("m", 999)} />
        <UnitScale>
          <Unit value={value("m", 1000)} />
        </UnitScale>
      </UnitScale>,
    );
    expect(container.textContent).not.toContain("km");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <UnitScale>
        <Unit value={value("m", 999)} />
        <Unit value={value("m", 1000)} />
      </UnitScale>,
    );
    await expectNoA11yViolations(container);
  });
});
