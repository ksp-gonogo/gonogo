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
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import { act, render, waitFor, within } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import rails from "./__fixtures__/rails-warp-1000x.json";
import { WarpControlComponent } from "./index";

/**
 * WarpControl's stream render golden. This began life as a
 * fork↔stream byte-identical dual-run; with WarpControl de-Telemachus'd,
 * the widget no longer has a legacy read path to compare against, so the
 * legacy leg is gone (the id='data' MockDataSource legacy comparison was
 * dropped).
 * What remains proves the widget renders the full warp state correctly off
 * the real stream pipeline (`TelemetryProvider` + `TelemetryClient`/
 * `TimelineStore`).
 *
 * `rails-warp-1000x` exercises every branch worth covering: an active
 * on-rails warp rate (formatRate's `k×` branch), the highlighted ladder
 * button, AND the Flight-scene pause toggle. Scene now streams too —
 * `useGameContext` reads `spaceCenter.scene` off the canonical stream
 * (migrated off the `kc.scene` shim), so the whole render is one wire.
 */
// Reset the action-handler registry at the START of each test — the prior
// test's tree is already unmounted (RTL auto-cleanup, plus each test's own
// inline teardownMockDataSource) by then, so this never fires against a live
// component.
beforeEach(() => {
  clearActionHandlers();
});

describe("WarpControl — stream render golden (delay=0)", () => {
  it("renders the full warp state off the stream pipeline", async () => {
    const mode = { name: "default-6x5", w: 6, h: 5 };

    const streamFixture = setupStreamFixture({
      carriedChannels: ["time.warp", "spaceCenter.scene"],
      pinnedUt: 10,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "warp-dual" }}>
          <WarpControlComponent id="warp-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      // Scene rides the canonical stream (useGameContext reads
      // spaceCenter.scene) — a Flight scene renders the pause toggle.
      streamFixture.emit("spaceCenter.scene", { scene: rails["kc.scene"] });
      // The full warp state on the new wire: one "time.warp" record.
      // warpMode 0 = High — see normalizeWarpMode's doc comment in index.tsx.
      streamFixture.emit("time.warp", {
        warpRate: rails["t.currentRate"],
        warpRateIndex: rails["t.timeWarp"],
        warpMode: 0,
        paused: rails["t.isPaused"],
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("1.0k×")) {
        throw new Error("stream leg has not rendered the warp state yet");
      }
    });

    const scope = within(container);
    // Rate readout formats the on-rails k× branch.
    expect(
      scope.getByRole("img", { name: "Time warp rate 1.0k×" }),
    ).toBeTruthy();
    // warpMode 0 -> "High" caption.
    expect(scope.getByText("High")).toBeTruthy();
    // warpRateIndex 5 -> the "1k×" ladder button is the highlighted one.
    expect(
      scope.getByRole("button", { name: "1k×" }).getAttribute("aria-pressed"),
    ).toBe("true");
    // Flight scene (streamed) -> the pause toggle renders.
    expect(scope.getByRole("button", { name: "Pause game" })).toBeTruthy();
  });
});

/**
 * The plan's literal "off the recording's wire" golden (`m3-migration-plan
 * .md` §4-behavior: "stream — TelemetryProvider fed the reference-wire-
 * fixture.json frames"). Gitignored/local-only, skip-if-absent — mirrors
 * `reference-wire-fixture.test.ts`'s own discipline; CI never has this file
 * checked out, so this is a local/branch gate, not a CI one.
 */
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const realFixturePath = path.join(
  currentDir,
  "../../../../local_docs/telemetry-mod/recordings/reference-wire-fixture.json",
);
const realFixtureExists = existsSync(realFixturePath);

describe.skipIf(!realFixtureExists)(
  "WarpControl — stream render golden against the REAL captured recording",
  () => {
    if (!realFixtureExists) {
      it("SKIPPED: reference-wire-fixture.json not found (gitignored, local-only)", () => {});
      return;
    }

    it("renders the recorded rate/mode readout off the real recording's wire", async () => {
      const realFixture = JSON.parse(readFileSync(realFixturePath, "utf-8"));

      // The recording carries 3 rewinds (epochsSeen [0,1,2,3] —
      // reference-wire-fixture.test.ts's own assertion), each of which
      // resets validAt back near 0 in its own epoch and drops every
      // PRIOR-epoch point from the store's timelines (TimelineStore's
      // cross-topic sweep, `m3-migration-plan.md`'s "client ghost"
      // avoidance) — so replaying the WHOLE recording and then pinning
      // viewUt at 0 would resolve against whatever epoch-3 frame happens to
      // sit at validAt<=0, not the true first frame of the session (a real
      // trap the first draft of this test fell into: RED with a mismatched
      // mode caption AND highlighted ladder button). Trimmed here to only
      // the frames up to and including the FIRST "time.warp" sample (still
      // entirely within epoch 0), so there is nothing later to cross an
      // epoch boundary with.
      const orderedFrames = (realFixture.frames as string[])
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

      // Asserted so a future fixture regeneration that changes this frame
      // fails loudly instead of silently comparing against a stale
      // assumption.
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

      // A "schedule" clock that QUEUES deliveries instead of firing them —
      // ReplayTransport's constructor arms every frame's delivery
      // immediately, before `TelemetryClient` (built from `transport`,
      // necessarily AFTER it) has had a chance to `onMessage`-subscribe. A
      // clock whose `schedule` fires synchronously would lose every frame to
      // no listener; queueing lets the test flush them explicitly, once,
      // after the widget has mounted — deterministic, no real timers.
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

      // Pinned to UT 0 (the FIRST time.warp frame's own validAt, asserted
      // above) via `clock.scrubTo` — the plan's "FixedViewClock" pattern
      // (`m3-migration-plan.md` §4-test). Belt-and-suspenders alongside the
      // trim above (not load-bearing on its own — see that comment for why
      // trimming, not just pinning, is what actually fixes the epoch trap):
      // pinning ALONE, against the untrimmed full recording, advances the
      // confirmed edge to the LATEST
      // observed sample across the entire session, and the widget would
      // render the flight's FINAL warp state instead of the one frame this
      // test means to compare — a real trap the first draft of this test
      // fell into (RED: mismatched mode caption AND highlighted ladder
      // button once the full recording was flushed unpinned).
      const store = new TimelineStore(
        new ViewClock({
          nowWall: () => 0,
          warpRate: () => 1,
          delaySeconds: () => 0,
        }),
      );
      store.registerDerivedChannel(vesselStateChannel);
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

      // Specifically the rate READOUT, not just any "1×" text — the static
      // ladder always renders a "1×" button regardless of whether data has
      // arrived, which would otherwise satisfy a looser text check before
      // the real state has actually settled.
      await waitFor(() =>
        within(container).getByRole("img", {
          name: "Time warp rate 1×",
        }),
      );

      // warpMode 0 -> "High" caption, from the recorded frame asserted above.
      expect(within(container).getByText("High")).toBeTruthy();
    });
  },
);
