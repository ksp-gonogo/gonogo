import {
  DashboardItemContext,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, type RenderResult, render } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { type HandoverFixture, loadHandoverFixture } from "./handoverFixture";
import { LandingStatusComponent } from "./index";

/**
 * The carried ASL altitude and its band, on the operator's screen.
 *
 * This is the first consumer of the interval `core-reckoners.ts` keys at
 * `"altitudeAsl"`, so these cases are as much a measurement of that band as a
 * check on the readout: where it is keyed, what unit it arrives in, and what it
 * is worth at descent scale. What they found is written into the readout's own
 * header and restated as the withheld case below.
 *
 * The handover fixtures are the input because they are the only committed
 * descent that crosses the atmosphere interface. Every one of them is generated
 * from a perfect quadratic (`gen-handover-fixtures.ts`: "the fitted slope IS
 * that acceleration by construction"), which is exactly the history a
 * residual-based band can say nothing about, so the banded case below
 * perturbs one.
 */

/**
 * The same descent with RESIDUALS in it: the two interior vertical-speed
 * samples pulled off the line the other two sit on.
 *
 * `atmosphericAltitudeBandAt` takes its one sigma from `SlopeFit.stdError`, and
 * a history lying exactly on its own fit leaves it nothing to take, so the fit
 * withholds the sigma altogether and there is no band to draw. Every committed
 * fixture is that history. The
 * nudge is 6 m/s at the two interior samples: small enough that the fitted
 * acceleration stays inside the regime envelope the model would otherwise
 * decline on, large enough to produce an interval a reader can see.
 */
function withScatteredHistory(fixture: HandoverFixture): HandoverFixture {
  let seen = 0;
  const emits = fixture._stream.emits.map((emit) => {
    if (emit.channel !== "vessel.flight") return emit;
    seen += 1;
    const nudge = seen === 2 ? 6 : seen === 3 ? -6 : 0;
    if (nudge === 0) return emit;
    const speed = emit.value.verticalSpeed;
    if (typeof speed !== "number") {
      throw new Error("fixture flight sample carries no verticalSpeed");
    }
    return { ...emit, value: { ...emit.value, verticalSpeed: speed + nudge } };
  });
  return { ...fixture, _stream: { ...fixture._stream, emits } };
}

function mount(fixture: HandoverFixture): RenderResult {
  const stream = setupStreamFixture({
    carriedChannels: fixture._stream.carriedChannels,
    pinnedUt: fixture._stream.pinnedUt,
    suspendFrames: true,
  });
  const tree = render(
    <stream.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "carried" }}>
        <WidgetContributions Widget={LandingStatusComponent}>
          <LandingStatusComponent id="carried" w={8} h={12} />
        </WidgetContributions>
      </DashboardItemContext.Provider>
    </stream.Provider>,
  );
  act(() => {
    for (const emit of fixture._stream.emits) {
      stream.emit(emit.channel, emit.value, emit.meta);
    }
  });
  return tree;
}

/**
 * Everything the altitude readout says, found through its HEADING.
 *
 * Text rather than nodes, the way the other `<Band>` consumer in the tree is
 * read: an interval is two `<Unit>`s and an `aria-hidden` dash inside one span,
 * so there is no single text node to match and no role to ask for. Anchoring on
 * the heading is what keeps it from matching the rest of a dense widget.
 */
function readoutText(tree: RenderResult): string {
  const heading = tree.getByRole("heading", { name: /altitude asl/i });
  const section = heading.parentElement;
  if (section === null) throw new Error("the heading has no section");
  return section.textContent ?? "";
}

/**
 * The two ends of whatever interval the readout drew, as it wrote them, or
 * `null` where it drew none.
 *
 * Found through the row's own visible LABEL and split on `<Band>`'s dash. The
 * ends are two whole `<Unit>`s inside one span, so there is no text node to
 * match and no role to ask for, and reading the section's text as a whole is
 * what the first attempt did: the left half then ran back through every readout
 * above it. The label is the boundary the widget itself draws.
 */
function drawnInterval(tree: RenderResult): { lo: string; hi: string } | null {
  const row = tree.queryByText("Known to")?.nextElementSibling;
  if (!row) return null;
  const [lo, hi] = (row.textContent ?? "").split("–");
  if (lo === undefined || hi === undefined) {
    throw new Error(`the interval row is not a pair: "${row.textContent}"`);
  }
  return { lo: lo.trim(), hi: hi.trim() };
}

/** `drawnInterval`, refusing where the point of the case is that one exists. */
function requireInterval(tree: RenderResult): { lo: string; hi: string } {
  const interval = drawnInterval(tree);
  if (interval === null) {
    throw new Error(
      `no interval was drawn; the readout says "${readoutText(tree)}"`,
    );
  }
  return interval;
}

describe("the carried ASL altitude reaches the operator", () => {
  let restoreResizeObserver: () => void;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
    registerStockBodies();
  });

  afterEach(() => {
    restoreResizeObserver();
  });

  it("names the quantity it is describing, as a heading", () => {
    const tree = mount(loadHandoverFixture("05-drag-biting-42km.json"));
    expect(
      tree.getByRole("heading", { name: /altitude asl/i }),
    ).toBeInTheDocument();
  });

  it("draws the OBSERVED altitude, which nothing on this widget drew before", () => {
    // 42 000 m is the anchor sample of the drag-biting frame. Before this
    // readout the widget's only use of `altitudeAsl` was an unwrapped magnitude
    // fed into `solveSuicideBurn`, so the number never reached a pixel.
    expect(
      readoutText(mount(loadHandoverFixture("05-drag-biting-42km.json"))),
    ).toMatch(/42\.0/);
  });

  it("draws the CARRIED altitude beside it rather than in place of it", () => {
    // The rate integration puts the craft at 37 977 m six seconds past the
    // anchor. It must appear as a figure of its own and must not replace the
    // observation: a model quietly overwriting a measurement is the
    // substitution `Reading` exists to prevent.
    const text = readoutText(
      mount(loadHandoverFixture("05-drag-biting-42km.json")),
    );
    expect(text).toMatch(/42\.0/);
    expect(text).toMatch(/38\.0/);
  });

  it("draws the descent fit's band as its two ends", () => {
    const interval = requireInterval(
      mount(
        withScatteredHistory(loadHandoverFixture("05-drag-biting-42km.json")),
      ),
    );
    expect(interval.lo).not.toBe(interval.hi);
  });

  it("says what a one-sigma interval claims, rather than leaving it assumed", () => {
    expect(
      readoutText(
        mount(
          withScatteredHistory(loadHandoverFixture("05-drag-biting-42km.json")),
        ),
      ),
    ).toMatch(/about two thirds of the time/);
  });

  /**
   * The finding, as an executable fact rather than a paragraph.
   *
   * Every committed handover fixture is a noiseless quadratic, so the fit has
   * nothing to take a sigma from and withholds one, and the first real consumer
   * of this band draws no interval at all through the whole set. The readout
   * does not paper over that with a point: a zero-width band reads downstream
   * as "this extrapolation is exact", which is the opposite of what a
   * residual-free window establishes, so the producer offers nothing and the
   * consumer says so in words instead of inventing a hedge.
   */
  it("draws no band at all through the handover set, and says so", () => {
    const tree = mount(loadHandoverFixture("05-drag-biting-42km.json"));
    expect(drawnInterval(tree)).toBeNull();
    expect(readoutText(tree)).toMatch(
      /carried with no interval: this model bounds nothing/,
    );
  });

  it("draws no interval where the conic carried the altitude, and invents none", () => {
    // Above the interface `vessel.flight` is carried by Kepler propagation,
    // which offers no `bandAt` at all. The carried figure is still there; an
    // interval must not be.
    const tree = mount(loadHandoverFixture("01-above-interface-95km.json"));
    expect(readoutText(tree)).toMatch(/92\.6/);
    expect(drawnInterval(tree)).toBeNull();
  });

  it("says why the model withdrew, where it withdrew", () => {
    // Peak deceleration closes the rate integration's horizon, so there is no
    // carried altitude at all. A blank is the one answer that would be wrong.
    const tree = mount(loadHandoverFixture("06-peak-deceleration-30km.json"));
    expect(readoutText(tree)).toMatch(
      /honest for about 2\.5 seconds at the sensed deceleration/,
    );
    expect(drawnInterval(tree)).toBeNull();
  });

  it("has no a11y violations with the band drawn", async () => {
    const tree = mount(
      withScatteredHistory(loadHandoverFixture("05-drag-biting-42km.json")),
    );
    await expectNoA11yViolations(tree.container);
  });
});
