import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { CoastAnalysisSection } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const VIEW_UT = 1_000_000;

function mount() {
  const stream = setupStreamFixture({
    carriedChannels: ["principia.analysis"],
    pinnedUt: VIEW_UT,
  });
  const result = render(
    <stream.Provider>
      <CoastAnalysisSection />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, container: result.container };
}

/** Emits and waits for the sample to land; delivery is asynchronous. */
async function emit(stream: ReturnType<typeof mount>, coasts: unknown[]) {
  act(() => {
    stream.emit(
      "principia.analysis",
      { vesselId: "vessel-1", sampledAtUt: VIEW_UT, orbit: null, coasts },
      { validAt: VIEW_UT },
    );
  });
  await waitFor(() => {
    expect(stream.container.textContent).not.toContain("ANALYSIS NOT OBSERVED");
  });
}

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    missionDurationSeconds: 14_520,
    primaryIndex: 1,
    primaryBody: "Kerbin",
    gravitationallyBound: true,
    elementsPresent: true,
    elementsEpochUt: VIEW_UT - 13_200,
    siderealPeriodSeconds: 5401.2,
    nodalPeriodSeconds: 5388.4,
    anomalisticPeriodSeconds: 5412.9,
    nodalPrecessionDegreesPerHour: -0.2061,
    meanSemimajorAxisMetres: { min: 6_700_120, max: 6_700_480 },
    meanEccentricity: { min: 0.0011, max: 0.0019 },
    meanInclinationDegrees: { min: 28.42, max: 28.51 },
    meanLongitudeOfAscendingNodeDegrees: { min: 12.4, max: 13.1 },
    meanArgumentOfPeriapsisDegrees: { min: 61.2, max: 74.7 },
    meanPeriapsisAltitudeMetres: { min: 493_200, max: 496_400 },
    meanApoapsisAltitudeMetres: { min: 505_900, max: 508_300 },
    lowestAltitudeMetres: 492_800,
    ...overrides,
  };
}

const TWO_COASTS = [
  {
    index: 0,
    startsAtUt: VIEW_UT - 13_200,
    endsAtUt: VIEW_UT + 1320,
    analysis: analysis(),
  },
  {
    index: 1,
    startsAtUt: VIEW_UT + 1463,
    endsAtUt: VIEW_UT + 144_000,
    analysis: analysis({
      primaryBody: "Mun",
      elementsEpochUt: VIEW_UT + 1463,
      meanEccentricity: { min: 0.61, max: 0.68 },
    }),
  },
];

describe("CoastAnalysisSection", () => {
  it("says nothing has arrived rather than that there is no plan", async () => {
    const stream = mount();
    expect(await visibleText(stream.container)).toContain(
      "ANALYSIS NOT OBSERVED",
    );
  });

  /**
   * A craft the producer knows and that holds no plan is a positive observation
   * of absence, and it is a different fact from nothing having reached the
   * console. An operator told the second when the first is true goes looking for
   * a stream fault.
   */
  it("states an empty plan as an absence with a reason", async () => {
    const stream = mount();
    await emit(stream, []);

    expect(await visibleText(stream.container)).toContain(
      "No flight plan, so no planned orbits.",
    );
  });

  /**
   * The last coast is the orbit the plan ENDS in, which is the one an operator
   * is usually asking about, so it is named rather than numbered.
   */
  it("names the final coast and numbers the rest", async () => {
    const stream = mount();
    await emit(stream, TWO_COASTS);

    const text = await visibleText(stream.container);
    expect(text).toContain("COAST 1");
    expect(text).toContain("FINAL");
    expect(text).toContain("CIRCULAR KERBIN ORBIT");
    expect(text).toContain("HIGHLY ELLIPTICAL MUN ORBIT");
  });

  /**
   * A coast following a burn the integrator could not compute has no valid
   * initial state to analyse from. The row still exists and is still dated; only
   * its analysis is missing, and it says so rather than showing a blank that
   * reads as a coast in no particular orbit.
   */
  it("keeps a coast the producer could not analyse, and says why it is bare", async () => {
    const stream = mount();
    await emit(stream, [
      {
        index: 0,
        startsAtUt: VIEW_UT,
        endsAtUt: VIEW_UT + 100,
        analysis: null,
      },
    ]);

    expect(await visibleText(stream.container)).toContain(
      "no analysis for this coast",
    );
  });

  /**
   * The bands are behind a disclosure and the epoch travels WITH them, because
   * the same rows are shown under the current orbit too and a qualifier left in
   * one header is one the other surface silently drops.
   */
  it("shows the full band set, dated, when a coast is opened", async () => {
    const stream = mount();
    await emit(stream, TWO_COASTS);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Show the mean elements of the final coast",
      }),
    );

    const text = await visibleText(stream.container);
    expect(text).toContain("Measured from");
    expect(text).toContain("0.6100");
    expect(text).toContain("0.6800");
  });

  it("has no accessibility violations", async () => {
    const stream = mount();
    await emit(stream, TWO_COASTS);

    expect(await axe(stream.container)).toHaveNoViolations();
  });
});
