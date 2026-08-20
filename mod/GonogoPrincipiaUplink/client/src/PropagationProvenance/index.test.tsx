import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { PropagationProvenanceComponent } from "./index";

const VIEW_UT = 20_000;

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function mount() {
  const stream = setupStreamFixture({
    carriedChannels: ["principia.provenance"],
    pinnedUt: VIEW_UT,
  });
  const result = render(
    <stream.Provider>
      <PropagationProvenanceComponent config={{}} id="prov" />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, container: result.container };
}

/** The cold-readable half, with no prediction bound observed. `validAt` is
 *  stated because the transport defaults it to 0, which against a pinned clock
 *  would silently make every fixture stale. */
function provenance(overrides: Record<string, unknown> = {}) {
  return {
    displayPatchedConics: false,
    historyLengthSeconds: 604_800,
    framesHidingUnpinnedMarkers: 0,
    framesHidingUnpinnedCelestials: 0,
    plottingFrameType: 3,
    plottingFrameCentreBody: "Kerbin",
    targetFrameSelected: false,
    ...overrides,
  };
}

function emit(
  stream: ReturnType<typeof mount>,
  overrides: Record<string, unknown> = {},
) {
  act(() => {
    stream.emit("principia.provenance", provenance(overrides), {
      validAt: VIEW_UT,
    });
  });
}

describe("PropagationProvenance", () => {
  /**
   * The case the panel exists for. The producer recomputes the tolerance and step
   * limit inside its own settings UI, so unobserved they sit at constructor
   * defaults that resolve to plausible values. The panel must say UNOBSERVED
   * rather than print a number, because a fabricated yardstick is worse than a
   * missing one: the operator calibrates their trust in every other widget
   * against it and has nothing to tell them not to.
   */
  it("says the prediction bound is unobserved rather than printing a default", async () => {
    const stream = mount();

    emit(stream);

    expect(await screen.findByText("UNOBSERVED")).toBeInTheDocument();
    expect(visibleText(stream.container)).not.toMatch(/Tolerance/);
  });

  /**
   * The complement, and what makes the test above mean something: an observed
   * bound is shown, dated, and attributed to the craft it was read for. Without
   * this pair, a panel that always said UNOBSERVED would pass.
   */
  it("shows an observed bound with its instant and its vessel", async () => {
    const stream = mount();

    emit(stream, {
      predictionToleranceMetres: 0.01,
      predictionMaxSteps: 10_000,
      predictionObservedAtUt: VIEW_UT,
      predictionVesselId: "vessel-4",
    });

    expect(await screen.findByText("Tolerance")).toBeInTheDocument();
    expect(screen.getByText("Step limit")).toBeInTheDocument();
    expect(screen.getByText(/vessel-4/)).toBeInTheDocument();
    expect(screen.queryByText("UNOBSERVED")).not.toBeInTheDocument();
  });

  /**
   * Per-vessel, so the age matters as much as the value: a bound read six hours
   * ago against a craft that has since been switched away from is not the bound
   * governing what is on screen now.
   */
  it("ages a bound observed in the past", async () => {
    const stream = mount();

    emit(stream, {
      predictionToleranceMetres: 0.1,
      predictionMaxSteps: 1_000,
      predictionObservedAtUt: VIEW_UT - 7_200,
      predictionVesselId: "vessel-4",
    });

    expect(await screen.findByText("Tolerance")).toBeInTheDocument();
    expect(visibleText(stream.container)).toMatch(/OBSERVED .* AGO/);
  });

  /**
   * The trust question in reverse: with stock conics also drawn there are two
   * curves on the map and only one is integrated, so which one the operator is
   * reading has to be said before anything else on this panel matters.
   */
  it("warns when stock conics are also being drawn", async () => {
    const stream = mount();

    emit(stream, { displayPatchedConics: true });

    expect(
      await screen.findByText("STOCK CONICS ALSO DRAWN"),
    ).toBeInTheDocument();
  });

  it("stays quiet about conics when only the integrated curve is drawn", async () => {
    const stream = mount();

    emit(stream, { displayPatchedConics: false });

    expect(await screen.findByText("PLOTTING")).toBeInTheDocument();
    expect(
      screen.queryByText("STOCK CONICS ALSO DRAWN"),
    ).not.toBeInTheDocument();
  });

  /**
   * The frame label is built here because every producer method that would name a
   * frame can abort the process. An ordinal with no entry renders AS the ordinal:
   * a later build's new frame kind should read as obviously incomplete rather than
   * be rounded to a neighbour, which would be a confident wrong answer about which
   * frame the numbers are in.
   */
  it("names a known frame and refuses to guess at an unknown one", async () => {
    const stream = mount();
    emit(stream, { plottingFrameType: 3, plottingFrameCentreBody: "Kerbin" });
    expect(
      await screen.findByText("Rotating-pulsating, Kerbin"),
    ).toBeInTheDocument();

    emit(stream, { plottingFrameType: 99, plottingFrameCentreBody: "Duna" });
    expect(await screen.findByText("Frame 99, Duna")).toBeInTheDocument();
  });

  it("hides the marker row when nothing is hidden and shows it when something is", async () => {
    const stream = mount();
    emit(stream);
    expect(await screen.findByText("PLOTTING")).toBeInTheDocument();
    expect(screen.queryByText(/HIDE/)).not.toBeInTheDocument();

    emit(stream, { framesHidingUnpinnedMarkers: 2 });
    expect(
      await screen.findByText("SOME FRAMES HIDE UNPINNED MARKERS"),
    ).toBeInTheDocument();
  });

  /**
   * With nothing publishing, the honest answer is that the trajectories are the
   * stock two-body ones, which is a real statement about what is on screen rather
   * than an empty panel.
   */
  it("says the trajectories are stock when nothing publishes provenance", () => {
    mount();

    expect(screen.getByText("NO N-BODY PROVIDER")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const stream = mount();
    emit(stream, {
      predictionToleranceMetres: 0.01,
      predictionMaxSteps: 10_000,
      predictionObservedAtUt: VIEW_UT,
      predictionVesselId: "vessel-4",
    });

    expect(await screen.findByText("Tolerance")).toBeInTheDocument();
    expect(await axe(stream.container)).toHaveNoViolations();
  });
});
