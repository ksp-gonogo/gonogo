import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/**
 * The dial is drawn on a MEASURED fit, not on the tile's grid units alone.
 *
 * jsdom lays nothing out, so these drive the widget's own ResizeObserver with
 * the sizes a browser reported: the attitude column each tier actually gets,
 * taken off the render harness. What they pin is the rule, not the pixels.
 *
 * The rule exists because grid units stopped predicting the pixels the moment
 * the SAS/RCS row moved into the body. A 5x8 tile clears `rows >= 6` by two and
 * has 91px of attitude column; the indicator is never shorter than
 * `MIN_DIAL_PX + ATTITUDE_CHROME_PX` = 154, and its wrap centres it, so it
 * painted 31px past both ends of that column and the heading tape landed on the
 * toggles below. The overlap gate is the instrument that sees the paint; this is
 * the one that sees the decision.
 */

/** The one entry a real observer delivers, shaped as the widget reads it. */
function entryFor(el: Element, width: number, height: number) {
  return {
    target: el,
    contentRect: { width, height } as DOMRectReadOnly,
  } as ResizeObserverEntry;
}

/**
 * A ResizeObserver that reports one size to every box observed, replacing the
 * no-op `installDomStubs` leaves in place. Held in a module-level list so a
 * test can re-report after a change, which is what proves the dial comes BACK:
 * the widget stops rendering a dial box when the fit says no, so an observer
 * attached to that box would go quiet exactly when it mattered.
 */
const observers: Array<{ el: Element; cb: ResizeObserverCallback }> = [];
const pristineObserver = globalThis.ResizeObserver;

function installSizedObserver(width: number, height: number): void {
  globalThis.ResizeObserver = class SizedObserver {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(el: Element) {
      observers.push({ el, cb: this.cb });
      this.cb([entryFor(el, width, height)], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/** Re-report a new size to every live observer, as a resize would. */
function reportSize(width: number, height: number): void {
  act(() => {
    for (const { el, cb } of observers) {
      cb([entryFor(el, width, height)], {} as ResizeObserver);
    }
  });
}

afterEach(() => {
  globalThis.ResizeObserver = pristineObserver;
  observers.length = 0;
});

function renderAt(
  size: { w: number; h: number },
  emit: (fixture: StreamFixture) => void,
) {
  const fixture = setupStreamFixture({
    carriedChannels: ["vessel.attitude", "vessel.control", "vessel.orbit"],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const tree = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "nav" }}>
        <NavballComponent config={{}} id="nav" w={size.w} h={size.h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    emit(fixture);
  });
  return tree;
}

function emitAttitude(fixture: StreamFixture): void {
  fixture.emit("vessel.attitude", {
    headingRootFrame: 90,
    pitchRootFrame: 0,
    rollRootFrame: 0,
  });
}

const dial = () => screen.queryByRole("img", { name: "Attitude indicator" });

/**
 * How many LINES the numeric readout lays its three cells out on, read off the
 * DOM rather than off a style: jsdom lays nothing out, so an assertion on
 * `grid-template-columns` would pass against a row that had been handed no
 * width at all. The two presentations differ in their container, so the
 * container is what says which one rendered.
 */
function readoutShape(): "three-across" | "stacked" | "absent" {
  const hdg = screen.queryByText("HDG");
  if (!hdg) return "absent";
  // HDG's cell: three-across is a BigReadout carrying the reading with the
  // label as a caption UNDER it, stacked is a label-beside-value pair.
  const row = hdg.parentElement?.parentElement;
  if (!row) throw new Error("readout row not found above the HDG label");
  return getComputedStyle(row).display === "grid" ? "three-across" : "stacked";
}

describe("Navball dial fit", () => {
  it("draws the dial when the measured column can hold one", () => {
    // mobile 9x8's column, measured: 318x163. 163 - 74 of indicator chrome
    // leaves 89, over the 80px floor, and that is the size the ball gets.
    installSizedObserver(318, 163);
    renderAt({ w: 9, h: 8 }, emitAttitude);
    expect(dial()).toHaveAttribute("width", "89");
  });

  it("falls back to the numeric readout on a column too short for a legible dial", () => {
    // wide 5x8's column, measured: 158x91. Clears `rows >= 6` by two rows and
    // still holds no ball: 91 - 74 = 17.
    installSizedObserver(158, 91);
    renderAt({ w: 5, h: 8 }, emitAttitude);
    expect(dial()).not.toBeInTheDocument();
    expect(screen.getByText("HDG")).toBeInTheDocument();
    expect(screen.getByText("PCH")).toBeInTheDocument();
    expect(screen.getByText("RLL")).toBeInTheDocument();
  });

  it("brings the dial back when the column grows", () => {
    installSizedObserver(158, 91);
    renderAt({ w: 5, h: 8 }, emitAttitude);
    expect(dial()).not.toBeInTheDocument();
    // The measured box is the attitude column, which renders either way, so a
    // tile that grows is still being observed and the dial can return. Pinned
    // because measuring the DIAL's own box instead would go quiet here for
    // good.
    reportSize(158, 200);
    expect(dial()).toHaveAttribute("width", "116");
  });

  it("lays the numeric readout three across once the column can hold three", () => {
    // full 7x20's column on the control-delay scene, measured: 238x146. Over
    // the 190px three-across minimum on width, and 8px short of a ball on
    // height, so the readout is what draws and it draws on one line.
    installSizedObserver(238, 146);
    renderAt({ w: 7, h: 20 }, emitAttitude);
    expect(dial()).not.toBeInTheDocument();
    expect(readoutShape()).toBe("three-across");
  });

  it("stacks all three rather than two-and-one on a column too narrow for three", () => {
    // wide 5x8's column, measured: 158px, against a 190px minimum. This is the
    // tier the complaint came from: three readings do not fit at this width and
    // no template makes them, so what it gets is one per line.
    //
    // Three lines and not two is the whole assertion. The wrap this replaces
    // fitted whatever the width allowed, so the same tile laid out two cells
    // with the third slung underneath or all three stacked depending on how
    // many digits the vessel's attitude happened to have: `north-level` got
    // two-and-one and `gravity-turn-east`, one degree of pitch later, got three.
    installSizedObserver(158, 91);
    renderAt({ w: 5, h: 8 }, emitAttitude);
    expect(readoutShape()).toBe("stacked");
  });

  it("brings the readout back to three across when the column grows", () => {
    installSizedObserver(78, 85);
    renderAt({ w: 3, h: 4 }, emitAttitude);
    expect(readoutShape()).toBe("stacked");
    // Same reasoning as the dial coming back: the measured box is the attitude
    // column, which renders either way, so the decision is not sealed by
    // having been taken.
    reportSize(300, 85);
    expect(readoutShape()).toBe("three-across");
  });

  it("reserves the throttle column's width wherever a tile is wide enough for one", () => {
    // 5 columns is where the throttle column appears, so its 42px comes off the
    // width whether or not one is on screen: read off `showDial` instead, a
    // width that fits a dial without the column and not with it would add the
    // column, lose the dial, drop the reserve and fit again.
    installSizedObserver(150, 400);
    renderAt({ w: 5, h: 20 }, emitAttitude);
    expect(dial()).toHaveAttribute("width", "108");
  });
});
