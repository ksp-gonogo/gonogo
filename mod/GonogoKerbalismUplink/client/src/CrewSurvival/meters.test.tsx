import type {
  Reading,
  TopicPayload,
  TopicReading,
  Value,
} from "@ksp-gonogo/sitrep-sdk";
import { bandIn, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { Meter } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { survivalMeters } from "./meters";
import { deriveCrewSurvival } from "./processor";
import { ruleReadings } from "./ruleReadings";

/**
 * The reckoned band, on the meter it is about.
 *
 * `crewReckoning.ts` mints a genuine `sigma1` interval per moving accumulator
 * in the accumulator's OWN unit, and the bar it belongs on is drawn as a
 * fraction of the rule's fatal threshold. So this file is about the trip
 * between those two: that the interval reaches the meter at all, that it
 * arrives on the axis the track is drawn on, and that a rule the model
 * declined to bound carries a figure and no interval rather than an invented
 * one.
 *
 * Every fixture spaces its samples irregularly, for the reason
 * `crewReckoning.test.ts` gives: the stream is change-gated, so a topic carries
 * a point when its value changed and at no other time.
 */

const CARRIED = ["kerbalism.crew"];

type Crew = TopicPayload<"kerbalism.crew">;

/** Jeb's radiation accumulator moves; his stress and Bob's do not. */
function crew(radiation: number, asOfUt: number) {
  return [
    {
      name: "Jebediah Kerman",
      trait: "Pilot",
      rulesAsOfKerbalismUt: asOfUt,
      rules: [
        {
          name: "radiation",
          problem: radiation,
          degenPerSec: 0.002,
          fatalThreshold: 50,
        },
        { name: "stress", problem: 0.2, degenPerSec: 0.001, fatalThreshold: 1 },
      ],
    },
    {
      name: "Bob Kerman",
      trait: "Scientist",
      rulesAsOfKerbalismUt: asOfUt,
      rules: [
        {
          name: "stress",
          problem: 0.08,
          degenPerSec: 0.001,
          fatalThreshold: 1,
        },
      ],
    },
  ];
}

/** Climbing at about 0.01/s of stamp time with the middle sample off the line,
 *  so the fit has a residual and therefore a standard error. */
const SCATTERED = [
  [1000, 46.9, 1000],
  [1023, 47.15, 1020],
  [1049, 47.3, 1040],
] as const;

/** The same run with the middle sample dropped: a straight line through two
 *  points has zero residual, so the fit gives a slope and no sigma. */
const TWO_SAMPLES = [SCATTERED[0], SCATTERED[2]] as const;

const VIEW_UT = 1060;

type Run = readonly (readonly [number, number, number])[];

const renderedTrees: Array<() => void> = [];

function ReadingProbe({
  sink,
}: {
  sink: (reading: TopicReading<Crew>) => void;
}) {
  sink(useTelemetry("kerbalism.crew"));
  return null;
}

/**
 * Mount over a live stream, then put `run` on the wire, answering with the
 * reading the tree ends up seeing. The tree exists BEFORE the first sample
 * lands, which is the order production runs in.
 */
function readingOver(run: Run, children?: ReactNode) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: VIEW_UT,
  });
  for (const topic of CARRIED) fixture.subscribe(topic);
  let latest: TopicReading<Crew> | undefined;
  const result = render(
    <fixture.Provider>
      <ReadingProbe
        sink={(reading) => {
          latest = reading;
        }}
      />
      {children}
    </fixture.Provider>,
  );
  renderedTrees.push(result.unmount);
  return {
    container: result.container,
    async feed(): Promise<TopicReading<Crew>> {
      act(() => {
        for (const [validAt, radiation, asOfUt] of run) {
          fixture.emit("kerbalism.crew", crew(radiation, asOfUt), {
            validAt,
            deliveredAt: validAt,
          });
        }
      });
      await waitFor(() => {
        expect(latest?.state).toBe("observed");
      });
      if (!latest) throw new Error("no reading arrived");
      return latest;
    },
  };
}

/** The roster the Processor joins the Kerbalism wire against. */
const ROSTER = {
  meta: { source: "vessel:4", quality: 1 },
  crew: [
    { name: "Jebediah Kerman", trait: "Pilot" },
    { name: "Bob Kerman", trait: "Scientist" },
  ],
} as never;

/** The meters this Uplink contributes over `run`, keyed by entry id. */
async function metersOver(run: Run = SCATTERED) {
  const reading = await readingOver(run).feed();
  const observed =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value
      : undefined;
  const entries =
    survivalMeters(
      deriveCrewSurvival(ROSTER, observed, VIEW_UT),
      ruleReadings(reading),
    ) ?? [];
  return new Map(entries.map((entry) => [entry.id, entry]));
}

afterEach(() => {
  for (const unmount of renderedTrees.splice(0)) unmount();
});

describe("what a survival meter carries", () => {
  it("hands the meter the whole reading, not a bare fraction", async () => {
    const dose = (await metersOver()).get("Jebediah Kerman:radiation");

    // The whole point: a number cannot say how current it is or how well it is
    // known, so the primitive that draws doubt is given nothing to draw.
    expect(typeof dose?.value).toBe("object");
  });

  it("places the band on the axis the track is drawn on", async () => {
    const dose = (await metersOver()).get("Jebediah Kerman:radiation");
    const reading = dose?.value as Reading<Value<"ratio">>;
    if (reading.reckoning.status !== "available") {
      throw new Error(`expected a model, got "${reading.reckoning}"`);
    }

    /*
     * `ratio`, and on the reading itself rather than under a path: a per-value
     * reading has one figure, so it has one band and nothing to key it by. The
     * model mints this interval in the accumulator's own units against a fatal
     * threshold of 50, so a band handed over unconverted is an interval fifty
     * times too wide that the primitive silently declines to draw.
     */
    const band = bandIn(reading.reckoning.band, "ratio");
    if (!band) throw new Error("no ratio band on the reading");
    expect(band.kind).toBe("sigma1");
    expect(band.hi.magnitude - band.lo.magnitude).toBeGreaterThan(0);
    expect(band.lo.magnitude).toBeLessThanOrEqual(band.value.magnitude);
    expect(band.value.magnitude).toBeLessThanOrEqual(band.hi.magnitude);
    // 47-ish of 50, as a fraction of the axis rather than of nothing.
    expect(band.value.magnitude).toBeCloseTo(47.3 / 50, 1);
  });

  it("offers no interval for an accumulator the model never watched move", async () => {
    const stress = (await metersOver()).get("Jebediah Kerman:stress");
    const reading = stress?.value as Reading<Value<"ratio">>;

    /*
     * A flat rule is not a shallow slope: it is positive evidence that the
     * rule's input resource is still aboard. The bar still draws, because the
     * figure is a real observation; what it must not draw is an interval.
     */
    expect(reading.reckoning.status).toBe("none");
  });

  it("offers no interval from a two-sample window, where there is no sigma", async () => {
    const dose = (await metersOver(TWO_SAMPLES)).get(
      "Jebediah Kerman:radiation",
    );
    const reading = dose?.value as Reading<Value<"ratio">>;
    const banded =
      reading.reckoning.status === "available" &&
      reading.reckoning.band !== undefined;

    // The model still carries the accumulator here, so this separates "has a
    // reckoning" from "has a band": banding every reckoning invents `0/0`.
    expect(banded).toBe(false);
  });
});

describe("what the meter says with it", () => {
  it("announces the interval beside the figure the bar is drawing", async () => {
    const dose = (await metersOver()).get("Jebediah Kerman:radiation");
    const { container } = render(
      <Meter label={dose?.label ?? ""} value={dose?.value ?? null} />,
    );
    const said =
      container.querySelector("[role=meter]")?.getAttribute("aria-valuetext") ??
      "";

    // The marks themselves are a shape and say nothing, so the sentence on the
    // track is the only place a screen reader learns the interval exists.
    expect(said).toMatch(/between/i);
    expect(said).toMatch(/two thirds of the time/i);
    await act(async () => {});
  });
});
