import {
  affineVectorUnitFor,
  UNIT_DEFINITIONS,
  value,
} from "@ksp-gonogo/sitrep-sdk";
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

  describe("a field being cleared", () => {
    /**
     * A control that reads a blank field as zero commits a number the operator
     * never typed, and does it at the moment they are most obviously mid-edit.
     * On a burn's Δv that is a real instruction: clear the field, look away, and
     * the plan now says burn nothing on that axis rather than what it said
     * before. The same read makes a value impossible to retype at all, because
     * the field snaps to "0" between keystrokes.
     */
    it("commits nothing when the field is emptied", () => {
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
        target: { value: "" },
      });

      expect(onChange).not.toHaveBeenCalled();
    });

    it("leaves the emptied field empty rather than filling in a zero", () => {
      // The other half of the same fault. A field that refills itself cannot be
      // cleared and retyped, which is the ordinary way anybody changes a number.
      render(
        <UnitInput
          label="Tangent"
          unit="m/s"
          value={value("m/s", 12)}
          onChange={() => {}}
        />,
      );

      const field = screen.getByLabelText("Tangent") as HTMLInputElement;
      fireEvent.change(field, { target: { value: "" } });

      expect(field.value).toBe("");
    });

    it("commits nothing for a minus sign on its own", () => {
      // The first keystroke of every negative number. Reading it as zero puts a
      // zero on the wire on the way to typing -40.
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
        target: { value: "-" },
      });

      expect(onChange).not.toHaveBeenCalled();
    });

    it("commits nothing when a RUNG is emptied", () => {
      // Same rule on the several-field shape: an emptied hours box is an
      // unfinished edit, and reading it as zero silently subtracts four hours.
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

      fireEvent.change(screen.getByLabelText("Coast h"), {
        target: { value: "" },
      });

      expect(onChange).not.toHaveBeenCalled();
      expect((screen.getByLabelText("Coast h") as HTMLInputElement).value).toBe(
        "",
      );
    });

    it("still commits a zero the operator actually types", () => {
      // The contrast that makes the rule above a rule rather than a hole: zero
      // is a real Δv and typing it must reach the plan.
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
        target: { value: "0" },
      });

      expect(onChange.mock.calls[0][0].magnitude).toBe(0);
    });
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

      if (affineVectorUnitFor(unit) === "s") {
        // An INSTANT is entered on the game's calendar rather than as one
        // number, so there is no single box to read a magnitude out of. The
        // round trip is asserted the same way, one field at a time, in "an
        // instant, typed" below. Skipping it silently would be the failure this
        // whole describe exists to prevent, so it says so.
        expect(screen.getByLabelText(`Field ${unit} SEC`)).toBeTruthy();
        return;
      }

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

  describe("driving a value by RATE", () => {
    /**
     * The shape a bounded slider cannot have, and the reason instants had no
     * control at all.
     *
     * <p>A position slider maps where the handle sits onto a value, so it needs
     * a min and a max. An instant is legitimately years out, and any pair wide
     * enough to reach offers no precision anywhere inside it, so a UT could be
     * typed and nothing else. A rate control needs no bounds: displacement sets
     * how FAST the value moves, and the wheel springs back to centre. The
     * producer's own planner drives both time and Δv this way.</p>
     */
    it("offers a rate wheel for an INSTANT, which no slider can take", () => {
      render(
        <UnitInput
          label="Ignition"
          unit="ut"
          value={value("ut", 1_000_000)}
          onChange={() => {}}
          rate={{ step: 60 }}
        />,
      );

      expect(screen.getByLabelText("Ignition rate")).toBeTruthy();
    });

    it("moves an instant by an INTERVAL, and says which one", () => {
      // The `ut` / `s` split, on the control. An instant is a `ut` and what
      // moves it is an `s`; a wheel that claimed to step a UT "by 60 ut" would
      // be naming a quantity that does not exist. One notch here is a minute.
      render(
        <UnitInput
          label="Ignition"
          unit="ut"
          value={value("ut", 1_000_000)}
          onChange={() => {}}
          rate={{ step: 60 }}
        />,
      );

      expect(screen.getByText("60 s / notch")).toBeVisible();
    });

    it("emits a Value in the field's OWN unit, not the one it moves by", () => {
      // What comes back is still an instant. The interval is how far it moved,
      // never what it became, and a control that emitted `s` here would put a
      // duration where the plan wants a date.
      const onChange = vi.fn();
      render(
        <UnitInput
          label="Ignition"
          unit="ut"
          value={value("ut", 1_000_000)}
          onChange={onChange}
          rate={{ step: 60 }}
        />,
      );

      fireEvent.keyDown(screen.getByLabelText("Ignition rate"), {
        key: "ArrowRight",
      });

      const emitted = onChange.mock.calls[0][0];
      expect(emitted.unit).toBe("ut");
      expect(emitted.magnitude).toBe(1_000_060);
    });

    it("steps a Δv in its own unit, because it has no other one to move by", () => {
      // The contrast that shows the interval above is a PROPERTY of instants
      // rather than a hard-coded time rule: a speed is moved by a speed.
      const onChange = vi.fn();
      render(
        <UnitInput
          label="Tangent"
          unit="m/s"
          value={value("m/s", 120)}
          onChange={onChange}
          rate={{ step: 5 }}
        />,
      );

      expect(screen.getByText("5 m/s / notch")).toBeVisible();
      fireEvent.keyDown(screen.getByLabelText("Tangent rate"), {
        key: "ArrowLeft",
      });

      expect(onChange.mock.calls[0][0].magnitude).toBe(115);
    });

    it("has no rate wheel unless one is asked for", () => {
      render(
        <UnitInput
          label="Tangent"
          unit="m/s"
          value={value("m/s", 120)}
          onChange={() => {}}
        />,
      );

      expect(screen.queryByLabelText("Tangent rate")).toBeNull();
    });

    it("freezes the wheel with the field", async () => {
      const { container } = render(
        <UnitInput
          label="Ignition"
          unit="ut"
          value={value("ut", 1_000_000)}
          onChange={() => {}}
          rate={{ step: 60 }}
          disabled
        />,
      );

      expect(
        screen.getByLabelText("Ignition rate").getAttribute("aria-disabled"),
      ).toBe("true");
      await expectNoA11yViolations(container);
    });
  });

  describe("an instant, typed", () => {
    it("is entered as a DATE rather than as a count of seconds", async () => {
      // An operator holds an ignition as "year 8, day 12, about ten past four",
      // never as 4,633,000. One number box for a UT makes every edit an
      // arithmetic problem about how long a day is on the calendar the game is
      // running, which is knowledge this kit already owns.
      const { container } = render(
        <UnitInput
          label="Ignition"
          unit="ut"
          value={value("ut", 1_000_000)}
          onChange={() => {}}
        />,
      );

      expect(screen.getByLabelText("Ignition YEAR")).toBeTruthy();
      expect(screen.getByLabelText("Ignition DAY")).toBeTruthy();
      await expectNoA11yViolations(container);
    });

    it("drops the coarse-step row when a rate wheel is there to nudge with", () => {
      // One gesture, offered once. Eight buttons that wrap onto a second line at
      // a panel's width, sitting above a control that nudges continuously and
      // says its own notch size, is the same job twice at four times the height.
      const { rerender } = render(
        <UnitInput
          label="Ignition"
          unit="ut"
          value={value("ut", 1_000_000)}
          onChange={() => {}}
        />,
      );
      expect(screen.getByText("NUDGE")).toBeVisible();

      rerender(
        <UnitInput
          label="Ignition"
          unit="ut"
          value={value("ut", 1_000_000)}
          onChange={() => {}}
          rate={{ step: 60 }}
        />,
      );

      expect(screen.queryByText("NUDGE")).toBeNull();
    });

    it("still emits a Value carrying the instant's own unit", () => {
      const onChange = vi.fn();
      render(
        <UnitInput
          label="Ignition"
          unit="ut"
          value={value("ut", 0)}
          onChange={onChange}
        />,
      );

      fireEvent.change(screen.getByLabelText("Ignition DAY"), {
        target: { value: "2" },
      });

      const emitted = onChange.mock.calls[0][0];
      expect(emitted.unit).toBe("ut");
      expect(emitted.magnitude).toBeGreaterThan(0);
    });
  });

  describe("a value that is not there", () => {
    it("shows nothing rather than a zero nobody entered", () => {
      // A quantity that has not been read is not a quantity of zero. Rendering
      // one as "0" is the same claim `Unit` refuses to make on its output side,
      // and here it also reads as a number the operator typed.
      render(
        <UnitInput
          label="Tangent"
          unit="m/s"
          value={null}
          onChange={() => {}}
        />,
      );

      expect((screen.getByLabelText("Tangent") as HTMLInputElement).value).toBe(
        "",
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
