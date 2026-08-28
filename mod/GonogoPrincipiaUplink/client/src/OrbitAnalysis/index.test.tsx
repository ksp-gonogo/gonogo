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
    elementsEpochUt: null,
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
   * The producer publishes no instant for a vessel's own analysis and keeps the
   * last completed one indefinitely once its window shuts. Mean elements look
   * exactly as confident an hour old, so the one thing this must never do is
   * present an undateable reading as a current one.
   */
  it("says the elements are of unknown age rather than implying they are current", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    const text = await visibleText(stream.container);
    expect(text).toContain("Elements of unknown age");
    expect(text).not.toContain("Measured from now");
  });

  /** A dated reading is dated, and an old one says how old. */
  it("dates elements that carry an epoch", async () => {
    const stream = mount();
    await emit(stream, {
      vesselId: "v",
      sampledAtUt: VIEW_UT,
      orbit: orbit({ elementsEpochUt: VIEW_UT - 7200 }),
    });

    expect(await visibleText(stream.container)).toContain("Measured from");
    expect(await visibleText(stream.container)).toContain("ago");
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
   * Four of the producer's adjectives need a ground-track recurrence this
   * Uplink does not request. Naming them is what stops an operator reading
   * their absence as a claim that the orbit is not synchronous.
   */
  it("names the adjectives it cannot reach", async () => {
    const stream = mount();
    await emit(stream, { vesselId: "v", sampledAtUt: VIEW_UT, orbit: orbit() });

    expect(await visibleText(stream.container)).toContain("sun-synchronous");
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
