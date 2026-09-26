import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/**
 * The dial is drawn on a measured fit, not on grid units: these feed the
 * widget's ResizeObserver the attitude-column sizes a browser reported for each
 * tier, and pin the rule rather than the pixels.
 */

/** The one entry a real observer delivers, shaped as the widget reads it. */
function entryFor(el: Element, width: number, height: number) {
  return {
    target: el,
    contentRect: { width, height } as DOMRectReadOnly,
  } as ResizeObserverEntry;
}

/** A ResizeObserver reporting one size to every box, kept in a list so a test can re-report after a resize. */
const observers: Array<{ el: Element; cb: ResizeObserverCallback }> = [];
const pristineObserver = globalThis.ResizeObserver;

function installSizedObserver(width: number, height: number): void {
  class SizedObserver implements ResizeObserver {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(el: Element): void {
      observers.push({ el, cb: this.cb });
      this.cb([entryFor(el, width, height)], this);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = SizedObserver;
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

/** Which presentation the numeric readout rendered, read off its container since jsdom lays nothing out. */
function readoutShape(): "three-across" | "stacked" | "absent" {
  const hdg = screen.queryByText("HDG");
  if (!hdg) return "absent";
  const row = hdg.parentElement?.parentElement;
  if (!row) throw new Error("readout row not found above the HDG label");
  return getComputedStyle(row).display === "grid" ? "three-across" : "stacked";
}

describe("Navball dial fit", () => {
  it("draws the dial when the measured column can hold one", () => {
    // mobile 9x8's column: 163 - 74 of indicator chrome leaves 89, over the 80px floor.
    installSizedObserver(318, 163);
    renderAt({ w: 9, h: 8 }, emitAttitude);
    expect(dial()).toHaveAttribute("width", "89");
  });

  it("falls back to the numeric readout on a column too short for a legible dial", () => {
    // wide 5x8's column: 91 - 74 = 17, far below a legible ball.
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
    // The measured box is the attitude column, which renders either way, so the dial can return.
    reportSize(158, 200);
    expect(dial()).toHaveAttribute("width", "116");
  });

  it("lays the numeric readout three across once the column can hold three", () => {
    // full 7x20's column: over the 158px three-across minimum, 8px short of a ball.
    installSizedObserver(238, 146);
    renderAt({ w: 7, h: 20 }, emitAttitude);
    expect(dial()).not.toBeInTheDocument();
    expect(readoutShape()).toBe("three-across");
  });

  it("lays it three across on the 5-column tier the complaint came from", () => {
    // wide 5x8's column: exactly the 158px three-across minimum.
    installSizedObserver(158, 91);
    renderAt({ w: 5, h: 8 }, emitAttitude);
    expect(dial()).not.toBeInTheDocument();
    expect(readoutShape()).toBe("three-across");
  });

  it("holds the three-across minimum where the measurement put it", () => {
    // 158 is three readings at their widest plus two gaps on a coarse pointer; both sides are pinned so it cannot drift.
    installSizedObserver(158, 91);
    renderAt({ w: 5, h: 8 }, emitAttitude);
    expect(readoutShape()).toBe("three-across");
    reportSize(157, 91);
    expect(readoutShape()).toBe("stacked");
  });

  it("stacks all three rather than two-and-one on a column too narrow for three", () => {
    // tiny 3x4's column is 78px; the layout must never depend on how many digits the attitude has.
    installSizedObserver(78, 85);
    renderAt({ w: 3, h: 4 }, emitAttitude);
    expect(readoutShape()).toBe("stacked");
  });

  it("brings the readout back to three across when the column grows", () => {
    installSizedObserver(78, 85);
    renderAt({ w: 3, h: 4 }, emitAttitude);
    expect(readoutShape()).toBe("stacked");
    reportSize(300, 85);
    expect(readoutShape()).toBe("three-across");
  });

  it("reserves the throttle column's width wherever a tile is wide enough for one", () => {
    // Reserved by tile width, not by `showDial`, which would otherwise oscillate between fitting and not.
    installSizedObserver(150, 400);
    renderAt({ w: 5, h: 20 }, emitAttitude);
    expect(dial()).toHaveAttribute("width", "108");
  });
});
