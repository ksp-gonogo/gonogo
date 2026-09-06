import {
  act,
  render,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { OrbitAnalysisSection } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const VIEW_UT = 1_000_000;
const CARRIED = ["principia.analysis"];

function mount() {
  const stream = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: VIEW_UT,
  });
  const result = render(
    <stream.Provider>
      <OrbitAnalysisSection />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, container: result.container };
}

/**
 * Emits and WAITS for the sample to land.
 *
 * Delivery is asynchronous: the sample reaches the store after the emit
 * returns, so a synchronous assertion reads the pending state and every test
 * here would assert against an empty section while looking like it had an
 * analysis. The unobserved badge going away is the settle condition, because it
 * is the one thing every arm below replaces.
 */
async function emit(
  stream: ReturnType<typeof mount>,
  payload: Record<string, unknown>,
) {
  act(() => {
    stream.emit("principia.analysis", payload, { validAt: VIEW_UT });
  });
  await waitFor(() => {
    expect(stream.container.textContent).not.toContain("Analysis not observed");
  });
}

function orbit(overrides: Record<string, unknown> = {}) {
  return {
    missionDurationSeconds: 604_800,
    primaryIndex: 1,
    primaryBody: "Kerbin",
    gravitationallyBound: true,
    elementsPresent: true,
    /*
     * Inside one revolution of the view, because that is what a vessel analysis
     * ordinarily looks like: the producer re-anchors one every two seconds while
     * its own main window is open.
     */
    elementsEpochUt: VIEW_UT - 1800,
    siderealPeriodSeconds: 5401.2,
    nodalPeriodSeconds: 5388.4,
    anomalisticPeriodSeconds: 5412.9,
    nodalPrecessionDegreesPerHour: -0.2061,
    meanSemimajorAxisMetres: { min: 6_700_120, max: 6_710_480 },
    meanEccentricity: { min: 0.0012, max: 0.0041 },
    meanInclinationDegrees: { min: 97.42, max: 97.61 },
    meanLongitudeOfAscendingNodeDegrees: { min: 12.4, max: 41.9 },
    meanArgumentOfPeriapsisDegrees: { min: 61.2, max: 88.7 },
    meanPeriapsisAltitudeMetres: { min: 481_200, max: 496_400 },
    meanApoapsisAltitudeMetres: { min: 512_900, max: 528_300 },
    lowestAltitudeMetres: 479_800,
    // The ground track. Present by default because the producer fits a
    // recurrence for any closed orbit and derives the crossings from it, so an
    // analysis WITHOUT these is the exception rather than the norm.
    recurrenceCycleRotations: 7,
    recurrenceRevolutionsPerRotation: 16,
    recurrenceRevolutions: 111,
    recurrenceSubcycleRotations: 3,
    recurrenceEquatorialShiftDegrees: -3.21,
    recurrenceGridIntervalDegrees: 3.21,
    ascendingCrossingDegrees: { min: 10.2, max: 10.9 },
    descendingCrossingDegrees: { min: 190.2, max: 190.8 },
    ascendingNodeSolarTimeDegrees: { min: 157.4, max: 157.9 },
    descendingNodeSolarTimeDegrees: { min: 337.4, max: 337.8 },
    ...overrides,
  };
}

describe("OrbitAnalysisSection", () => {
  /**
   * Nothing on the stream, the producer knowing the craft and analysing
   * nothing, and an analysis that found no elements are three different facts.
   * The middle one is fixed by opening a window, the last one by waiting, and
   * the first by neither, so an operator shown one message for all three is
   * being sent to do the wrong thing.
   */
  it("keeps its three absences apart", async () => {
    const nothing = mount();
    expect(await visibleText(nothing.container)).toContain(
      "Analysis not observed",
    );

    const notAnalysing = mount();
    await emit(notAnalysing, {
      vesselId: "v",
      sampledAtUt: VIEW_UT,
      orbit: null,
    });
    expect(await visibleText(notAnalysing.container)).toContain(
      "Not being analysed",
    );

    const noElements = mount();
    await emit(noElements, {
      vesselId: "v",
      sampledAtUt: VIEW_UT,
      orbit: orbit({ elementsPresent: false }),
    });
    expect(await visibleText(noElements.container)).toContain(
      "Elements not determined",
    );
  });

  it("assembles the producer's own adjective phrase", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    expect(await visibleText(stream.container)).toContain(
      "circular polar retrograde Kerbin orbit",
    );
  });

  /**
   * The vessel's own analysis is dated now, which it was not for most of this
   * widget's life: the producer carries no instant on the analysis struct, and
   * that was read as the age being unknowable rather than as its being somewhere
   * else. It is on the mean elements, and the Uplink recovers it.
   */
  it("dates the vessel's own analysis rather than calling it undateable", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    const text = await visibleText(stream.container);
    expect(text).toContain("Measured from");
    expect(text).toContain("ago");
    expect(text).not.toContain("Elements of unknown age");
  });

  /**
   * An epoch that could not be established is still its own state, and the one
   * thing it must never do is read as "these are current". Absent is not zero.
   */
  it("says the elements are of unknown age when they carry no epoch", async () => {
    const stream = mount();
    await emit(stream, {
      vesselId: "v",
      sampledAtUt: VIEW_UT,
      orbit: orbit({ elementsEpochUt: null }),
    });

    const text = await visibleText(stream.container);
    expect(text).toContain("Elements of unknown age");
    expect(text).not.toContain("Measured from now");
  });

  /**
   * Stale is decided against the orbit's OWN sidereal period rather than a fixed
   * span, because every band on this section is a mean over one period: an age
   * shorter than that is inside the smearing the numbers already carry. A fixed
   * threshold would call the same fraction of a revolution fresh in low orbit
   * and stale around the Mun.
   *
   * <p>Asserted on the attribute because the verdict is otherwise carried only
   * by a text colour, and a colour is a CSS variable nothing can read here.</p>
   */
  it("calls an age stale only once it exceeds one revolution", async () => {
    const fresh = mount();
    await emit(fresh, {
      vesselId: "v",
      sampledAtUt: VIEW_UT,
      orbit: orbit({ elementsEpochUt: VIEW_UT - 5000 }),
    });
    expect(
      fresh.container
        .querySelector("[data-elements-age]")
        ?.getAttribute("data-elements-age"),
    ).toBe("current");

    const stale = mount();
    await emit(stale, {
      vesselId: "v",
      sampledAtUt: VIEW_UT,
      orbit: orbit({ elementsEpochUt: VIEW_UT - 7200 }),
    });
    expect(
      stale.container
        .querySelector("[data-elements-age]")
        ?.getAttribute("data-elements-age"),
    ).toBe("stale");
  });

  /**
   * Every element is an interval and the width is the number that says whether
   * the orbit is stable. A midpoint would answer a question nobody asked.
   */
  it("renders each mean element as both ends of its band", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    const text = await visibleText(stream.container);
    expect(text).toContain("0.0012");
    expect(text).toContain("0.0041");
    expect(text).toContain("97.42");
    expect(text).toContain("97.61");
  });

  /**
   * The three periods differ by seconds on a low orbit, and a two-tier duration
   * prints all three as the same "1h 30min". The offset is what survives that,
   * and without it the group says nothing at all.
   */
  it("shows what separates the three periods", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    const text = await visibleText(stream.container);
    expect(text).toContain("SIDEREAL");
    expect(text).toContain("−12s");
    expect(text).toContain("+11s");
  });

  it("carries the node drift in degrees per hour", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    const text = await visibleText(stream.container);
    expect(text).toContain("-0.2061");
    expect(text).toContain("°/h");
  });

  /**
   * This used to assert the opposite: that the widget NAMED four adjectives it
   * could not reach, because they were believed to need a ground-track
   * recurrence this Uplink refused to request.
   *
   * <p>All four are reachable and none is disclaimed now, so the caveat renders
   * nothing. The guard is what makes that silence rather than an empty
   * accusation, and this is the assertion that would catch it coming back as
   * "Cannot say ." if the list were ever emptied without it.</p>
   */
  it("disclaims no adjective now that none is out of reach", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    expect(await visibleText(stream.container)).not.toContain("Cannot say");
  });

  /**
   * The ground track, which is the data the synchronicity adjectives are read
   * from. Showing it lets an operator see WHY the phrase says what it says
   * rather than taking the adjective on trust.
   */
  it("shows the repeat cycle in turns of the primary, not days", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    const text = await visibleText(stream.container);
    expect(text).toContain("REPEATS IN");
    expect(text).toContain("SUBCYCLE");
    // "turns", never "days": a stock day is six hours or twenty-four depending
    // on a setting, so a day here would mean one of two things.
    expect(text).toContain("turns");
    expect(text).not.toContain("days");
  });

  it("shows the crossing and sun-angle bands the adjectives are read from", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    const text = await visibleText(stream.container);
    expect(text).toContain("ASC NODE");
    expect(text).toContain("DESC NODE");
    expect(text).toContain("SUN ANGLE");
  });

  /**
   * A trajectory with no repeating track is ordinary, not broken: anything on an
   * escape or a transfer has none. Five rows of dashes would say "broken" where
   * nothing is, so the whole block goes rather than each row emptying.
   */
  it("drops the whole ground-track block when there is no track", async () => {
    const stream = mount();
    await emit(stream, {
      vesselId: "v",
      sampledAtUt: VIEW_UT,
      orbit: orbit({
        recurrenceCycleRotations: null,
        recurrenceRevolutions: null,
        recurrenceSubcycleRotations: null,
        ascendingCrossingDegrees: null,
        descendingCrossingDegrees: null,
        ascendingNodeSolarTimeDegrees: null,
        descendingNodeSolarTimeDegrees: null,
      }),
    });

    const text = await visibleText(stream.container);
    expect(text).not.toContain("REPEATS IN");
    expect(text).not.toContain("ASC NODE");
    expect(text).not.toContain("SUN ANGLE");
    // The rest of the analysis still renders: losing a ground track is not
    // losing the orbit.
    expect(text).toContain("SMA");
  });

  /** A hazard row is absent when there is no hazard, not a permanent dash. */
  it("shows a hazard countdown only when the analysis found one", async () => {
    const clear = mount();
    await emit(clear, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });
    expect(await visibleText(clear.container)).not.toContain("REENTRY");

    const hazard = mount();
    await emit(hazard, {
      vesselId: "v",
      sampledAtUt: VIEW_UT,
      orbit: orbit({ firstReentryUt: VIEW_UT + 3600 }),
    });
    expect(await visibleText(hazard.container)).toContain("REENTRY");
  });

  it("has no accessibility violations", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    expect(await axe(stream.container)).toHaveNoViolations();
  });
});
