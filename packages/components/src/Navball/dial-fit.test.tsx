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
