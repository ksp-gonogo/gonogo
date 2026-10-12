import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { act, render } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RigName, rigFixture, startRigReplay } from "../test/replayRig";
import { installSizedResizeObserver } from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

/**
 * Landing Status played through two real landings the live rig recorded off the wire: a low pass that never meets the ground, and a fast crash from a 6 km orbit. The recordings are the frames exactly as they arrived, played into the real client and store through `ReplayTransport`, a second at a time, so any version of the widget can be held to what a real flight does.
 */
describe("Landing Status over the rig's recorded landings", () => {
  let restoreResizeObserver: () => void;
  beforeEach(() => {
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
    registerStockBodies();
  });
  afterEach(() => restoreResizeObserver());

  /** What the widget reads at each whole second of the recording. */
  function play(name: RigName): { second: number; text: string }[] {
    const replay = startRigReplay(rigFixture(name));
    const { container, unmount } = render(
      <replay.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "rig" }}>
          <LandingStatusComponent id="rig" w={14} h={24} />
        </DashboardItemContext.Provider>
      </replay.Provider>,
    );
    const frames: { second: number; text: string }[] = [];
    for (let second = 0; second <= Math.ceil(replay.duration); second++) {
      act(() => replay.advanceTo(second));
      frames.push({ second, text: visibleText(container) });
    }
    unmount();
    return frames;
  }

  describe("the fast crash", () => {
    const frames = play("landing-crashfall");
    const firstCrash = frames.findIndex((f) => f.text.includes("CRASHED"));

    it("carries no badge that only says the link is live", () => {
      for (const f of frames) {
        expect(f.text, `at ${f.second} s`).not.toContain("LIVE");
      }
    });

    it("shows the descent before it, with nothing said of a crash", () => {
      expect(firstCrash).toBeGreaterThan(100);
      for (const f of frames.slice(0, firstCrash)) {
        expect(f.text).not.toContain("CRASHED");
      }
      expect(
        frames.slice(0, firstCrash).some((f) => f.text.includes("Midlands")),
      ).toBe(true);
    });

    it("says CRASHED from the crash to the end, never LANDED, even while the wreck keeps reporting", () => {
      for (const f of frames.slice(firstCrash)) {
        expect(f.text, `at ${f.second} s`).toContain("CRASHED");
        expect(f.text, `at ${f.second} s`).not.toContain("LANDED");
        expect(f.text, `at ${f.second} s`).not.toContain(
          "No landing in progress",
        );
      }
    });

    // Fails today: the real descent withholds the countdown for 35 s. Remove `.fails` once a change-gated topic stops reading held between its keyframes.
    it.fails("keeps the burn countdown through the descent", () => {
      // The propulsion topic is sent only when it changes, with a keyframe every 30 s: after a burst of one-second changes the client expects the next within seconds and reads it held, which withholds the countdown.
      const descent = frames.slice(100, firstCrash);
      expect(
        descent.filter((f) => f.text.includes("NEEDS CURRENT TELEMETRY")),
      ).toEqual([]);
    });
  });

  describe("the low pass", () => {
    it("says no landing is in progress throughout, with no crash and no landing", () => {
      const frames = play("landing-lowpass").slice(40);
      for (const f of frames) {
        expect(f.text, `at ${f.second} s`).toContain("No landing in progress");
        expect(f.text).not.toContain("CRASHED");
        expect(f.text).not.toContain("LANDED");
      }
    });

    it("gives the whole panel over to that reason, as a panel does that has nothing to present", () => {
      for (const f of play("landing-lowpass").slice(40)) {
        // Nothing of the descent board stands beside it: no body line, no burn hero, no round trip.
        expect(f.text, `at ${f.second} s`).not.toContain("Mun · vacuum");
        expect(f.text).not.toContain("BURN TIMING");
        expect(f.text).not.toContain("RT ");
      }
    });

    it("carries no badge that only says the link is live", () => {
      for (const f of play("landing-lowpass")) {
        expect(f.text, `at ${f.second} s`).not.toContain("LIVE");
      }
    });
  });
});
