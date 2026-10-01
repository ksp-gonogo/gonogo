import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type HeldGrade,
  type Reading,
  railTagsForControlAxis,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ControlDelayStream } from "./CommandDelay/ControlDelayStream";
import { Countdown } from "./Countdown";
import { Dial } from "./Dial";
import { Gauge } from "./Gauge";
import { HeldFigure, HeldHost, HeldMark } from "./HeldMark";
import { unannouncedHeldMarks } from "./heldMarkAnnouncement";
import { InstrumentHeldMark } from "./instrumentCurrency";
import { Meter } from "./Meter";
import { MissionDate } from "./MissionDate";
import { ReckonedUnit } from "./ModelledAlongside";
import { Tape } from "./Tape";
import { Unit } from "./Unit";
import { UnitInput } from "./UnitInput";

/**
 * Every painter of the held mark, drawn held, says what the mark means: the
 * grade's word to a screen reader and on hover, and the instant the figure was
 * last good. A reading that names no grade is held all the same and says so.
 */

const AS_OF = value("ut", 12_000);

function held<UnitSymbol extends string>(
  quantity: Value<UnitSymbol>,
  grade: HeldGrade | undefined,
): Reading<Value<UnitSymbol>> {
  return {
    state: "held",
    value: quantity,
    asOfUt: AS_OF,
    reckoning: { status: "none" },
    ...(grade === undefined ? {} : { grade }),
  };
}

const PAINTERS: Record<string, (grade: HeldGrade | undefined) => ReactElement> =
  {
    Unit: (grade) => <Unit value={held(value("m", 420), grade)} />,
    Meter: (grade) => (
      <Meter label="Fuel" value={held(value("ratio", 0.4), grade)} />
    ),
    "Meter, row pair": (grade) => (
      <Meter
        label="LF"
        layout="row"
        value={held(value("units", 960), grade)}
        capacity={held(value("units", 1000), grade)}
      />
    ),
    "Meter, caller's label": (grade) => (
      <Meter
        label="Fuel"
        value={held(value("ratio", 0.4), grade)}
        valueLabel="40 %"
      />
    ),
    Countdown: (grade) => <Countdown value={held(value("s", 90), grade)} />,
    MissionDate: (grade) => (
      <MissionDate value={held(value("ut", 12_000), grade)} />
    ),
    UnitInput: (grade) => (
      <UnitInput
        label="Tangent"
        unit="m/s"
        value={held(value("m/s", 12), grade)}
        onChange={() => undefined}
      />
    ),
    Gauge: (grade) => (
      <Gauge
        value={held(value("1", 1.84), grade)}
        min={value("1", 0)}
        max={value("1", 3)}
        width={160}
        height={100}
        ariaLabel="TWR"
      />
    ),
    Dial: (grade) => (
      <Dial
        value={held(value("deg", 90), grade)}
        min={value("deg", 0)}
        max={value("deg", 360)}
        ariaLabel="Heading"
      />
    ),
    Tape: (grade) => (
      <Tape
        value={held(value("m", 420), grade)}
        min={value("m", 0)}
        max={value("m", 1000)}
        ariaLabel="AGL"
      />
    ),
    // A figure the model carried past the received edge wears the mark whatever the observation's grade.
    ReckonedUnit: () => (
      <ReckonedUnit
        value={{
          state: "observed",
          value: value("deg", 40),
          atUt: value("ut", 1_000),
          reckoning: {
            status: "available",
            modelled: value("deg", 52),
            atUt: value("ut", 1_240),
            beyondReceived: true,
            basis: "kepler-propagation",
          },
        }}
      />
    ),
    ControlDelayStream: (grade) => (
      <ControlDelayStream
        streams={[
          {
            id: "vessel.control.throttle",
            label: "Throttle",
            oneWaySeconds: 8,
            inTransit: [{ age: 0, value: 0.5 }],
            echo: [],
            current: 0.5,
            tags: railTagsForControlAxis("vessel.control.setThrottle"),
          },
        ]}
        variant="inline"
        delayReading={held(value("s", 8), grade)}
      />
    ),
  };

describe("every painter of the held mark announces it", () => {
  for (const [name, draw] of Object.entries(PAINTERS)) {
    for (const grade of ["held", "recorded", undefined] as const) {
      it(`${name}, ${grade ?? "no grade"}`, () => {
        const { container } = render(draw(grade));
        expect(
          container.querySelector("[data-held-mark]"),
          "draws the mark",
        ).not.toBeNull();
        expect(unannouncedHeldMarks(container)).toEqual([]);
      });
    }
  }
});

/** The kit's own source, read as text, for the census of who draws the mark. */
function kitSources(): Record<string, string> {
  const root = dirname(fileURLToPath(import.meta.url));
  return Object.fromEntries(
    readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".tsx") && !path.endsWith(".test.tsx"))
      .map((path) => [`./${path}`, readFileSync(join(root, path), "utf8")]),
  );
}

/**
 * Each file that draws the mark, and the painters above that render it. The
 * two definitions are named with the painters that use them.
 */
const DRAWN_BY: Record<string, readonly string[]> = {
  "./HeldMark.tsx": ["Meter, caller's label", "Countdown", "UnitInput"],
  "./instrumentCurrency.tsx": ["Gauge", "Dial", "Tape"],
  "./Unit.tsx": ["Unit"],
  "./Meter.tsx": ["Meter", "Meter, row pair", "Meter, caller's label"],
  "./Countdown.tsx": ["Countdown"],
  "./MissionDate.tsx": ["MissionDate"],
  "./UnitInput.tsx": ["UnitInput"],
  "./ModelledAlongside.tsx": ["ReckonedUnit"],
  "./Gauge.tsx": ["Gauge"],
  "./Dial.tsx": ["Dial"],
  "./Tape.tsx": ["Tape"],
  "./CommandDelay/ControlDelayStream.tsx": ["ControlDelayStream"],
};

describe("the census of held-mark painters", () => {
  it("names every kit file that draws the mark, each with a painter rendered above", () => {
    const drawing = Object.entries(kitSources())
      .filter(([, source]) =>
        /data-held-mark|<(HeldMark|InstrumentHeldMark|HeldFigure)\b/.test(
          source,
        ),
      )
      .map(([path]) => path)
      .sort();
    expect(drawing).toEqual(Object.keys(DRAWN_BY).sort());
    for (const painters of Object.values(DRAWN_BY)) {
      for (const painter of painters)
        expect(PAINTERS).toHaveProperty([painter]);
    }
  });
});

describe("unannouncedHeldMarks", () => {
  function faults(ui: ReactElement): string[] {
    const { container } = render(ui);
    return unannouncedHeldMarks(container).map((m) => m.fault);
  }

  it("finds a dot drawn with no words", () => {
    expect(
      faults(
        <HeldHost>
          420 m
          <HeldMark aria-hidden="true" data-held-mark="" />
        </HeldHost>,
      ),
    ).toEqual(["silent"]);
  });

  it("finds a dot whose words name no grade", () => {
    expect(
      faults(<HeldFigure caption="as of Y1 D1">420 m</HeldFigure>),
    ).toEqual(["silent"]);
  });

  it("finds a dot spoken but not on hover", () => {
    expect(
      faults(
        <HeldHost>
          420 m
          <HeldMark aria-hidden="true" data-held-mark="" />
          <span data-unit-currency="">, HELD, as of Y1 D1</span>
        </HeldHost>,
      ),
    ).toEqual(["no-hover"]);
  });

  it("finds a hover that leaves out the instant the words give", () => {
    expect(
      faults(
        <HeldHost data-tooltip="HELD">
          420 m
          <HeldMark aria-hidden="true" data-held-mark="" />
          <span data-unit-currency="">, HELD, as of Y1 D1</span>
        </HeldHost>,
      ),
    ).toEqual(["no-as-of"]);
  });

  it("finds an instrument's dot its accessible name leaves out", () => {
    expect(
      faults(
        <svg role="img" aria-label="TWR">
          <title>TWR</title>
          <text>
            1.84
            <InstrumentHeldMark size={7} />
          </text>
        </svg>,
      ),
    ).toEqual(["silent"]);
  });

  it("passes an instrument that ends its name and its title with the caption", () => {
    expect(
      faults(
        <svg role="img" aria-label="TWR, HELD, as of Y1 D1">
          <title>TWR, HELD, as of Y1 D1</title>
          <text>
            1.84
            <InstrumentHeldMark size={7} />
          </text>
        </svg>,
      ),
    ).toEqual([]);
  });
});
