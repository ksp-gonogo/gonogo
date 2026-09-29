import {
  affineVectorUnitFor,
  UNIT_DEFINITIONS,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "./testing";
import { UnitInput } from "./UnitInput";

/** The input half of the unit system, proven the inverse of the output half over the whole unit catalogue. */
describe("UnitInput", () => {
  it("emits a Value carrying the unit, never a bare number", () => {
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
    // A blank field is an unfinished edit, never a zero the operator typed.
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
      // A field that refills itself cannot be cleared and retyped.
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
      // The first keystroke of every negative number.
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
      // Zero is a real Δv: only an empty field is withheld.
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
    const units = Object.keys(UNIT_DEFINITIONS);

    it("covers the whole catalogue rather than a chosen few", () => {
      // A registry that stopped enumerating would make every case below pass vacuously.
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
        // An instant is entered on the calendar, covered by "an instant, typed" below.
        expect(screen.getByLabelText(`Field ${unit} SEC`)).toBeTruthy();
        return;
      }

      const field = screen.getByLabelText(`Field ${unit}`) as HTMLInputElement;
      expect(Number(field.value)).toBeCloseTo(original.magnitude, 6);

      // A different number: React drops a change event whose value matches the current one.
      fireEvent.change(field, { target: { value: "12.25" } });
      const emitted = onChange.mock.calls[0][0];
      expect(emitted.unit).toBe(unit);
      expect(emitted.magnitude).toBeCloseTo(12.25, 6);
    });
  });

  describe("rungs", () => {
    it("splits a value across them and adds it back up", () => {
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

    it("shows its name, as every UnitInput does, with the date fields' group named once", () => {
      render(
        <UnitInput
          label="Ignition"
          unit="ut"
          value={value("ut", 1_000_000)}
          onChange={() => {}}
        />,
      );
      expect(screen.getByText("Ignition")).toBeVisible();
      expect(screen.getByRole("group", { name: "Ignition" })).toBeTruthy();
    });

    it("drops the coarse-step row when a rate wheel is there to nudge with", () => {
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

    it("shows an unread instant as an empty date, not as the epoch", () => {
      render(
        <UnitInput
          label="Ignition"
          unit="ut"
          value={null}
          onChange={() => {}}
        />,
      );
      const fields = screen.getAllByRole("spinbutton") as HTMLInputElement[];
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) expect(field.value).toBe("");
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

describe("UnitInput over a Reading", () => {
  const held = {
    state: "held" as const,
    reckoning: { status: "none" as const },
    value: value("m/s", 12),
    asOfUt: value("ut", 12_000),
    grade: "held" as const,
  };

  it("edits the reading's value and marks its name held, in words too", () => {
    const { container } = render(
      <UnitInput label="Tangent" unit="m/s" value={held} onChange={() => {}} />,
    );
    const field = screen.getByRole("spinbutton", {
      name: /^Tangent, .*HELD/,
    });
    expect(field).toHaveValue(12);
    expect(container.querySelector("[data-held-mark]")).not.toBeNull();
  });

  it("marks nothing for a current reading", () => {
    const { container } = render(
      <UnitInput
        label="Tangent"
        unit="m/s"
        value={{
          state: "observed",
          reckoning: { status: "none" },
          value: value("m/s", 12),
          asOfUt: value("ut", 12_000),
        }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "Tangent" })).toHaveValue(12);
    expect(container.querySelector("[data-held-mark]")).toBeNull();
  });
});
