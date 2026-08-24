import { UNIT_DEFINITIONS, value } from "@ksp-gonogo/sitrep-sdk";
import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "./testing";
import { UnitInput } from "./UnitInput";

/**
 * The input half of the unit system, and the claim that it is the OUTPUT half's
 * inverse.
 *
 * <p>The inverse claim is checked over the whole catalogue rather than on a
 * chosen few. The failure it guards against is a unit that renders but has no
 * way back, and picking examples finds that only for the examples picked: the
 * registry enumerates every unit, so the test can simply ask all of them.</p>
 */
describe("UnitInput", () => {
  it("emits a Value carrying the unit, never a bare number", () => {
    // The whole reason this component exists. A widget handed a magnitude has
    // to remember which unit it was in and where the wire wants it unwrapped,
    // and forgetting either is invisible until something far away binds wrong.
    const onChange = vi.fn();
    render(
      <UnitInput
        label="Tangent"
        unit="m/s"
        value={value("m/s", 12)}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Tangent"), {
      target: { value: "34" },
    });

    const emitted = onChange.mock.calls[0][0];
    expect(typeof emitted).toBe("object");
    expect(emitted.unit).toBe("m/s");
    expect(emitted.magnitude).toBe(34);
  });

  it("gives every control a VISIBLE name", async () => {
    // A column of unlabelled boxes is unreadable, and this is not hypothetical:
    // the plan composer shipped four of them, distinguishable only by an
    // aria-label nobody looking at the screen can see.
    const { container } = render(
      <UnitInput
        label="Tangent"
        unit="m/s"
        value={value("m/s", 12)}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText("Tangent")).toBeVisible();
    await expectNoA11yViolations(container);
  });

  describe("as the inverse of the output half", () => {
    /**
     * Every unit the registry declares, rendered into the control and read back
     * out unchanged.
     *
     * <p>A unit is exercised through the control's own value path: what it puts
     * in the field is what a reader sees, and what it emits on an unchanged edit
     * is what the caller gets back. Those two agreeing IS the inverse property,
     * and it is the half a type check cannot see.</p>
     */
    const units = Object.keys(UNIT_DEFINITIONS);

    it("covers the whole catalogue rather than a chosen few", () => {
      // Guards the guard: a registry that stopped enumerating would make every
      // case below pass by having nothing to check.
      expect(units.length).toBeGreaterThan(20);
    });

    it.each(units)("round-trips %s unchanged", (unit) => {
      const onChange = vi.fn();
      const original = value(unit, 7.5);
      render(
        <UnitInput
          label={`Field ${unit}`}
          unit={unit}
          value={original}
          onChange={onChange}
        />,
      );

      const field = screen.getByLabelText(`Field ${unit}`) as HTMLInputElement;
      // Out: what the reader sees is the magnitude that went in.
      expect(Number(field.value)).toBeCloseTo(original.magnitude, 6);

      // Back in: a DIFFERENT number, because React drops a change event whose
      // value matches what is already there, and a test that fired the same one
      // would assert nothing while looking like it asserted the round trip.
      fireEvent.change(field, { target: { value: "12.25" } });
      const emitted = onChange.mock.calls[0][0];
      expect(emitted.unit).toBe(unit);
      expect(emitted.magnitude).toBeCloseTo(12.25, 6);
    });
  });

  describe("rungs", () => {
    it("splits a value across them and adds it back up", () => {
      // 4h 12m 30s. Time is the case this exists for, and the case the ladder
      // tables cannot serve: `time` is deliberately absent from them, because it
      // does not climb by thousands.
      const onChange = vi.fn();
      render(
        <UnitInput
          label="Coast"
          unit="s"
          rungs={["h", "min", "s"]}
          value={value("s", 4 * 3600 + 12 * 60 + 30)}
          onChange={onChange}
        />,
      );

      expect((screen.getByLabelText("Coast h") as HTMLInputElement).value).toBe(
        "4",
      );
      expect(
        (screen.getByLabelText("Coast min") as HTMLInputElement).value,
      ).toBe("12");
      expect((screen.getByLabelText("Coast s") as HTMLInputElement).value).toBe(
        "30",
      );

      fireEvent.change(screen.getByLabelText("Coast min"), {
        target: { value: "13" },
      });
      expect(onChange.mock.calls[0][0].magnitude).toBeCloseTo(
        4 * 3600 + 13 * 60 + 30,
        6,
      );
    });

    it("keeps the remainder on the smallest rung rather than losing it", () => {
      // Rounding the last rung too would drop whatever fell below it, and the
      // value would drift a little every time it was shown and typed back.
      const onChange = vi.fn();
      render(
        <UnitInput
          label="Coast"
          unit="s"
          rungs={["min", "s"]}
          value={value("s", 90.25)}
          onChange={onChange}
        />,
      );

      expect(
        (screen.getByLabelText("Coast min") as HTMLInputElement).value,
      ).toBe("1");
      expect((screen.getByLabelText("Coast s") as HTMLInputElement).value).toBe(
        "30.25",
      );
    });
  });

  it("adds a slider only when bounds are given", () => {
    const { rerender } = render(
      <UnitInput
        label="Throttle"
        unit="%"
        value={value("%", 40)}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Throttle slider")).toBeNull();

    rerender(
      <UnitInput
        label="Throttle"
        unit="%"
        value={value("%", 40)}
        onChange={() => {}}
        range={{ min: 0, max: 100 }}
      />,
    );
    expect(screen.getByLabelText("Throttle slider")).toBeTruthy();
  });
});
