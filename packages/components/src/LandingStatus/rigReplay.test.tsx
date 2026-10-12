import {
  DashboardItemContext,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { type RigName, rigFixture, startRigReplay } from "../test/replayRig";
import {
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

/**
 * Landing Status played through two real landings the live rig recorded off the wire: a low pass that never meets the ground, and a fast crash from a 6 km orbit. The recordings are the frames exactly as they arrived, played into the real client and store through `ReplayTransport`, a second at a time, so any version of the widget can be held to what a real flight does.
 */

interface Second {
  second: number;
  text: string;
  /** The ids of every plot layer on screen. */
  layers: Set<string>;
}

/** What the widget reads at each whole second of a recording. */
async function play(name: RigName): Promise<Second[]> {
  const replay = startRigReplay(rigFixture(name));
  const { container, unmount } = render(
    <replay.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "rig" }}>
        <WidgetContributions Widget={LandingStatusComponent}>
          <LandingStatusComponent id="rig" w={14} h={24} />
        </WidgetContributions>
      </DashboardItemContext.Provider>
    </replay.Provider>,
  );
  const seconds: Second[] = [];
  for (let second = 0; second <= Math.ceil(replay.duration); second++) {
    // A second of the recording takes milliseconds here, so the contribution budgets, which count per rolling second of real time, are reset each step.
    for (const b of PerfBudget.getAll()) b.reset();
    await act(async () => {
      replay.advanceTo(second);
      // The contributed plots settle a moment after a frame.
      await new Promise((r) => setTimeout(r, 80));
    });
    const read = () => ({
      text: visibleText(container),
      layers: new Set(
        [...container.querySelectorAll("[data-plot-layer]")].map(
          (el) => el.getAttribute("data-plot-layer") ?? "",
        ),
      ),
    });
    let now = read();
    // A plot that has just been mounted draws a beat after its frame, once it has measured itself: give it that beat before reading.
    for (let wait = 0; wait < 3; wait++) {
      if (!now.text.includes("Touchdown view") || now.layers.size > 0) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 120));
      });
      now = read();
    }
    seconds.push({ second, ...now });
  }
  unmount();
  return seconds;
}

describe("Landing Status over the rig's recorded landings", () => {
  let crash: Second[] = [];
  let lowPass: Second[] = [];
  let firstCrash = -1;

  beforeAll(async () => {
    const restore = installSizedResizeObserver({ w: 720, h: 640 });
    registerStockBodies();
    crash = await play("landing-crashfall");
    lowPass = await play("landing-lowpass");
    firstCrash = crash.findIndex((f) => f.text.includes("CRASHED"));
    restore();
  }, 240_000);

  describe("the fast crash", () => {
    it("shows the descent before it, with nothing said of a crash", () => {
      expect(firstCrash).toBeGreaterThan(100);
      for (const f of crash.slice(0, firstCrash)) {
        expect(f.text).not.toContain("CRASHED");
      }
      expect(
        crash.slice(0, firstCrash).some((f) => f.text.includes("Midlands")),
      ).toBe(true);
    });

    it("carries no badge that only says the link is live", () => {
      for (const f of crash) {
        expect(f.text, `at ${f.second} s`).not.toContain("LIVE");
      }
    });

    it("says CRASHED from the crash to the end, never LANDED, even while the wreck keeps reporting", () => {
      for (const f of crash.slice(firstCrash)) {
        expect(f.text, `at ${f.second} s`).toContain("CRASHED");
        expect(f.text, `at ${f.second} s`).not.toContain("LANDED");
        expect(f.text, `at ${f.second} s`).not.toContain(
          "No landing in progress",
        );
      }
    });

    it("keeps the touchdown plots' last scene from the crash to the end, marked held, with the real impact on it", () => {
      // The plots settle a second or so behind the readings, so the first second of the crash is the one the scene is still being held up from.
      for (const f of crash.slice(firstCrash + 2)) {
        expect(f.layers.has("landing-zone"), `at ${f.second} s`).toBe(true);
        expect(f.layers.has("impact"), `at ${f.second} s`).toBe(true);
        expect(f.text, `at ${f.second} s`).toContain("HELD");
      }
    });

    it("draws no impact before the crash", () => {
      for (const f of crash.slice(0, firstCrash)) {
        expect(f.layers.has("impact"), `at ${f.second} s`).toBe(false);
      }
    });

    // Fails today: the real descent withholds the countdown for 35 s. Remove `.fails` once a change-gated topic stops reading held between its keyframes.
    it.fails("keeps the burn countdown through the descent", () => {
      // The propulsion topic is sent only when it changes, with a keyframe every 30 s: after a burst of one-second changes the client expects the next within seconds and reads it held, which withholds the countdown.
      const descent = crash.slice(100, firstCrash);
      expect(
        descent.filter((f) => f.text.includes("NEEDS CURRENT TELEMETRY")),
      ).toEqual([]);
    });
  });

  describe("the low pass", () => {
    it("says no landing is in progress throughout, with no crash and no landing", () => {
      for (const f of lowPass.slice(40)) {
        expect(f.text, `at ${f.second} s`).toContain("No landing in progress");
        expect(f.text).not.toContain("CRASHED");
        expect(f.text).not.toContain("LANDED");
      }
    });

    it("gives the whole panel over to that reason, as a panel does that has nothing to present", () => {
      for (const f of lowPass.slice(40)) {
        // Nothing of the descent board stands beside it: no body line, no burn hero, no round trip.
        expect(f.text, `at ${f.second} s`).not.toContain("Mun · vacuum");
        expect(f.text).not.toContain("BURN TIMING");
        expect(f.text).not.toContain("RT ");
      }
    });

    it("draws no crash, impact or held scene", () => {
      for (const f of lowPass) {
        expect(f.layers.has("impact"), `at ${f.second} s`).toBe(false);
        expect(f.text).not.toContain("HELD");
      }
    });

    it("carries no badge that only says the link is live", () => {
      for (const f of lowPass) {
        expect(f.text, `at ${f.second} s`).not.toContain("LIVE");
      }
    });
  });
});
