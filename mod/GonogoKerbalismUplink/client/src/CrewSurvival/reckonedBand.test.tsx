import type { Reading, Reckoning, TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
// The real module, so its module-load registerAugment runs and the component
// under test is the registered one.
import { bandedRulesFor, CrewSurvivalBandAugment } from "./reckonedBand";

/**
 * The one reckoned band in this tree, drawn.
 *
 * `crewReckoning.ts` mints a genuine `sigma1` interval per moving accumulator
 * and `crewReckoning.test.ts` proves the arithmetic. What this file is about is
 * the other half: that the interval survives the trip to a roster row, keyed by
 * the model's own path vocabulary, and that a row the model declined to bound
 * draws NOTHING rather than a zero-width interval or a null dash.
 *
 * Every fixture spaces its samples irregularly, for the reason
 * `crewReckoning.test.ts` gives: the stream is change-gated, so a topic carries
 * a point when its value changed and at no other time, and nothing here may
 * depend on a fixed interval.
 */

const CARRIED = ["kerbalism.crew"];

type Crew = TopicPayload<"kerbalism.crew">;

/**
 * Two kerbals. Jeb's radiation accumulator moves and his stress does not; Bob's
 * one rule does not move either.
 *
 * Bare numbers rather than minted `Value`s, because the transport is what wraps
 * them: `fixture.emit` runs the same `wrapTopicPayload` a real sample arrives
 * through, so a fixture that pre-minted them would be feeding a payload shape
 * the mod never sends.
 */
function crew(radiation: number, asOfUt: number) {
  return [
    {
      name: "Jebediah Kerman",
      trait: "Pilot",
      asOfUt,
      rules: [
        {
          name: "radiation",
          value: radiation,
          degenPerSec: 0.002,
          fatalThreshold: 50,
        },
        { name: "stress", value: 0.2, degenPerSec: 0.001, fatalThreshold: 1 },
      ],
    },
    {
      name: "Bob Kerman",
      trait: "Scientist",
      asOfUt,
      rules: [
        { name: "stress", value: 0.08, degenPerSec: 0.001, fatalThreshold: 1 },
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

/** The same run with the middle sample dropped. A straight line through two
 *  points has zero residual and `n - 2` degrees of freedom left, so the fit can
 *  still give a slope and cannot give a sigma. */
const TWO_SAMPLES = [SCATTERED[0], SCATTERED[2]] as const;

/** Far enough past the last stamp for the model to have carried the
 *  accumulator somewhere, and well inside its ten-minute horizon. */
const VIEW_UT = 1060;

type Run = readonly (readonly [number, number, number])[];

const renderedTrees: Array<() => void> = [];

/**
 * Reports the reading the tree is currently seeing, so the feed can be awaited
 * on the data rather than on whatever the subject happens to paint.
 *
 * A scene where the augment correctly draws nothing has no pixel to wait for,
 * and a bare `await act(async () => {})` after the emits is not enough: the
 * store's notification reaches React a tick later, which is what every other
 * `useTelemetry` test in this Uplink already waits on. Waiting on the reading
 * works for the drawing and the not-drawing cases alike.
 */
function ReadingProbe({ sink }: { sink: (reading: Reading<Crew>) => void }) {
  sink(useTelemetry("kerbalism.crew"));
  return null;
}

/**
 * Mount `children` over a live stream, and hand back the feed as a separate
 * step so the tree exists BEFORE the first sample lands. That is the order
 * production runs in, and the only one that proves the subject reacts to a
 * sample rather than to its own first paint.
 */
function mountOver(run: Run, children?: ReactNode) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: VIEW_UT,
  });
  for (const topic of CARRIED) fixture.subscribe(topic);
  let latest: Reading<Crew> | undefined;
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
    /** Put the run on the wire and settle, answering with the model on offer. */
    async feed(): Promise<Reckoning<Crew>> {
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
      if (latest?.reckoning !== "available") {
        throw new Error(
          `expected a model, got reckoning "${latest?.reckoning}"`,
        );
      }
      return latest.reckoned;
    },
  };
}

/** The model on offer over `run`, with nothing else mounted. */
function reckoningOf(run: Run = SCATTERED): Promise<Reckoning<Crew>> {
  return mountOver(run).feed();
}

/** The augment, over `run`, for one roster row. */
async function renderBand(run: Run, crewName: string, crewIndex: number) {
  const mounted = mountOver(
    run,
    <CrewSurvivalBandAugment crewName={crewName} crewIndex={crewIndex} />,
  );
  await mounted.feed();
  return mounted.container;
}

afterEach(() => {
  for (const unmount of renderedTrees.splice(0)) unmount();
});

describe("which rules it finds a band for", () => {
  it("bounds the accumulator the model watched move, and only that one", async () => {
    const banded = bandedRulesFor(
      await reckoningOf(),
      "Jebediah Kerman",
      0,
    ).map((b) => b.label);

    // Jeb carries two rules and one of them is flat. A flat rule is not a
    // shallow slope, it is positive evidence that its input resource is still
    // aboard, so the model offers no rate for it and there is nothing to bound.
    expect(banded).toEqual(["Radiation dose"]);
  });

  it("reads the band back under the same path the model keyed it by", async () => {
    const reckoned = await reckoningOf();
    const banded = bandedRulesFor(reckoned, "Jebediah Kerman", 0);

    // The join between producer and consumer is a runtime path string, so
    // nothing in the type system notices an off-by-one in either index. What
    // notices is the band's own `value`, which the model guarantees equals the
    // value reckoned at that path: read the wrong path and this is another
    // rule's number, or (as an off-by-one here happens to give) nothing at all.
    expect(banded[0].band.value.magnitude).toBe(
      reckoned.value[0].rules?.[0].value?.magnitude,
    );
    expect(Object.keys(reckoned.bands ?? {})).toEqual(["0.rules.0.value"]);
  });

  it("hands on the interval the model minted, not a wider or narrower one", async () => {
    const banded = bandedRulesFor(await reckoningOf(), "Jebediah Kerman", 0);
    const { lo, value, hi } = banded[0].band;

    // A real interval, not the degenerate one a collinear run produces: the
    // scattered fixture exists so the picture this draws has a visible width.
    expect(hi.magnitude - lo.magnitude).toBeGreaterThan(0);
    expect(lo.magnitude).toBeLessThanOrEqual(value.magnitude);
    expect(value.magnitude).toBeLessThanOrEqual(hi.magnitude);
    expect(banded[0].band.kind).toBe("sigma1");
  });

  it("finds the right kerbal when the roster position disagrees", async () => {
    // `crewIndex` is a position in `vessel.crew.crew`, a different array from
    // the one the paths index into. The name is the join that survives the two
    // disagreeing, so a stale position must not silently band another kerbal.
    const banded = bandedRulesFor(
      await reckoningOf(),
      "Jebediah Kerman",
      1,
    ).map((b) => b.label);

    expect(banded).toEqual(["Radiation dose"]);
  });

  it("finds nothing for a kerbal whose rules are all supplied", async () => {
    expect(bandedRulesFor(await reckoningOf(), "Bob Kerman", 1)).toEqual([]);
  });

  it("finds nothing for a name the Kerbalism wire never mentioned", async () => {
    expect(bandedRulesFor(await reckoningOf(), "Valentina Kerman", 0)).toEqual(
      [],
    );
  });
});

describe("what the row shows", () => {
  it("draws both ends of the interval, labelled with the rule it bounds", async () => {
    await renderBand(SCATTERED, "Jebediah Kerman", 0);

    expect(screen.getByText("Radiation dose")).toBeInTheDocument();
    // Two ends with a dash between them: the whole reason this is a `Band` and
    // not a `Unit` is that a midpoint answers a question nobody asked.
    expect(screen.getByText("–")).toBeInTheDocument();
  });

  it("draws the two ends as DIFFERENT numbers, at whatever precision that takes", async () => {
    const container = await renderBand(SCATTERED, "Jebediah Kerman", 0);

    // The failure `Band` widens its digits to avoid, and the one that would
    // make this whole augment pointless: an interval whose ends round to the
    // same figure is an interval rendered as a scalar, silently, exactly where
    // the width was the point. This band is a few hundredths of a unit wide
    // and the kind's own default is one decimal, so it only reads as an
    // interval at all because the widening happens.
    const [lo, hi] = (container.textContent ?? "")
      .split("–")
      .map((half) => half.trim());
    expect(lo).not.toEqual("");
    expect(hi).not.toEqual("");
    expect(lo).not.toEqual(hi);
  });

  it("says what the interval CLAIMS, a standard error not being a limit", async () => {
    const container = await renderBand(SCATTERED, "Jebediah Kerman", 0);

    expect(container.querySelector("[title]")?.getAttribute("title")).toContain(
      "one standard deviation",
    );
  });

  it("draws nothing at all for a kerbal the model declined to bound", async () => {
    const container = await renderBand(SCATTERED, "Bob Kerman", 1);

    /*
     * Not a dash and not an empty interval: `Band` renders the null display
     * when one end is missing, and reaching that state here would mean an
     * absent band had been passed off as a half-read one.
     */
    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing from a two-sample window, where there is no sigma to draw", async () => {
    const container = await renderBand(TWO_SAMPLES, "Jebediah Kerman", 0);

    /*
     * The model still carries the accumulator forward here, so this is the
     * case that separates "has a reckoning" from "has a band": a widget that
     * banded every reckoning would be inventing an interval out of `0/0`.
     */
    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing before the window has any samples in it", async () => {
    const mounted = mountOver(
      SCATTERED,
      <CrewSurvivalBandAugment crewName="Jebediah Kerman" crewIndex={0} />,
    );

    expect(mounted.container).toBeEmptyDOMElement();
    await act(async () => {});
  });

  it("has no accessibility violations", async () => {
    const container = await renderBand(SCATTERED, "Jebediah Kerman", 0);

    await expectNoA11yViolations(container);
  });
});
