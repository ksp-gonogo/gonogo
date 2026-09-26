import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  ReplayTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, render, waitFor, within } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import rails from "./__fixtures__/rails-warp-1000x.json";
import { WarpControlComponent } from "./index";

/**
 * WarpControl's stream render golden: the full warp state and the Flight scene
 * render correctly off the real stream pipeline. `rails-warp-1000x` covers the
 * `k×` rate branch, the highlighted ladder button and the pause toggle.
 */
// Reset at the start of each test, once the prior test's tree is already unmounted.
beforeEach(() => {
  clearActionHandlers();
});

describe("WarpControl: stream render golden (delay=0)", () => {
  it("renders the full warp state off the stream pipeline", async () => {
    const mode = { name: "default-6x5", w: 6, h: 5 };

    const streamFixture = setupStreamFixture({
      carriedChannels: ["time.warp", "spaceCenter.scene"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "warp-dual" }}>
          <WarpControlComponent id="warp-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit("spaceCenter.scene", { scene: rails["kc.scene"] });
      // warpMode 0 is High.
      streamFixture.emit("time.warp", {
        warpRate: rails["t.currentRate"],
        warpRateIndex: rails["t.timeWarp"],
        warpMode: 0,
        paused: rails["t.isPaused"],
      });
    });

    await waitFor(() => {
      if (!visibleText(container).includes("1.0k×")) {
        throw new Error("stream leg has not rendered the warp state yet");
      }
    });

    const scope = within(container);
    expect(
      scope.getByRole("img", { name: "Time warp rate 1.0k×" }),
    ).toBeTruthy();
    expect(scope.getByText("High")).toBeTruthy();
    expect(
      scope.getByRole("button", { name: "1k×" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(scope.getByRole("button", { name: "Pause game" })).toBeTruthy();
  });
});

/**
 * The render golden off a real recording's wire. The recording is local-only
 * and gitignored, so this skips when absent and is a local gate, not a CI one.
 */
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const realFixturePath = path.join(
  currentDir,
  "../../../../local_docs/telemetry-mod/recordings/reference-wire-fixture.json",
);
const realFixtureExists = existsSync(realFixturePath);

describe.skipIf(!realFixtureExists)(
  "WarpControl: stream render golden against the REAL captured recording",
  () => {
    if (!realFixtureExists) {
      it("SKIPPED: reference-wire-fixture.json not found (gitignored, local-only)", () => {});
      return;
    }

    it("renders the recorded rate/mode readout off the real recording's wire", async () => {
      const realFixture = JSON.parse(readFileSync(realFixturePath, "utf-8"));

      /*
       * Trimmed to the frames up to the first "time.warp" sample, inside epoch 0:
       * the recording carries rewinds, and each drops every prior-epoch point from
       * the store, so a view pinned at 0 over the whole recording resolves against a
       * later epoch.
       */
      const recorded: string[] = realFixture.frames;
      const orderedFrames = recorded
        .map((raw) => ({ raw, message: JSON.parse(raw) }))
        .filter(
          (f) => f.message.type === "stream-data" || f.message.type === "event",
        )
        .sort(
          (a, b) => a.message.meta.deliveredAt - b.message.meta.deliveredAt,
        );
      const firstWarpIndex = orderedFrames.findIndex(
        (f) => f.message.topic === "time.warp",
      );
      expect(firstWarpIndex).toBeGreaterThanOrEqual(0);
      const firstWarpFrame = orderedFrames[firstWarpIndex].message;

      // Fails loudly if a fixture regeneration changes this frame.
      expect(firstWarpFrame.payload).toEqual(
        expect.objectContaining({
          warpRate: 1,
          warpRateIndex: 1,
          warpMode: 0,
          paused: false,
        }),
      );

      const trimmedFixture = {
        subscribedTopics: realFixture.subscribedTopics,
        frames: orderedFrames.slice(0, firstWarpIndex + 1).map((f) => f.raw),
      };

      const mode = { name: "default-6x5", w: 6, h: 5 };

      // Queues deliveries: ReplayTransport arms every frame before `TelemetryClient` can subscribe, so the test flushes them after mount.
      const pending: (() => void)[] = [];
      const queueingClock = {
        now: () => 0,
        schedule: (_atUt: number, fn: () => void) => {
          pending.push(fn);
          return () => {
            const i = pending.indexOf(fn);
            if (i !== -1) pending.splice(i, 1);
          };
        },
      };
      const transport = new ReplayTransport(trimmedFixture, {
        clock: queueingClock,
      });
      const client = new TelemetryClient(transport);

      // Pinned to the first time.warp frame's validAt; the trim above is what keeps later epochs out.
      const store = new TimelineStore(
        new ViewClock({
          nowWall: () => 0,
          warpRate: () => 1,
          delaySeconds: () => 0,
        }),
      );
      store.clock.scrubTo(0);

      const { container } = render(
        <TelemetryProvider client={client} store={store}>
          <DashboardItemContext.Provider value={{ instanceId: "warp-real" }}>
            <WarpControlComponent id="warp-real" w={mode.w} h={mode.h} />
          </DashboardItemContext.Provider>
        </TelemetryProvider>,
      );

      act(() => {
        for (const fn of pending.slice()) fn();
      });

      // The rate readout specifically: the static ladder always renders a "1×" button.
      await waitFor(() =>
        within(container).getByRole("img", {
          name: "Time warp rate 1×",
        }),
      );

      expect(within(container).getByText("High")).toBeTruthy();
    });
  },
);
