import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import {
  ReplayTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@gonogo/sitrep-client";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import rails from "./__fixtures__/rails-warp-1000x.json";
import { WarpControlComponent } from "./index";

/**
 * The M3 pilot's behavior-preservation golden dual-run
 * (`m3-migration-plan.md` §4-behavior): the SAME warp state, rendered once
 * off the legacy `DataSource` (today's proven-working path) and once off
 * the stream (`TelemetryProvider` + a real `TelemetryClient`/`TimelineStore`
 * pipeline), must produce byte-identical DOM at `delay=0` — this is the
 * "no drift" gate a widget's own unit assertions can miss (§5.4:
 * `getByText("1234")` passes off either path; only a full-markup diff
 * catches a subtly different rounding/units/layout).
 *
 * `rails-warp-1000x` is chosen because it's the one WarpControl fixture that
 * exercises EVERY branch this dual-run needs to prove parity on: an active
 * on-rails warp rate (formatRate's `k×` branch), the highlighted ladder
 * button, AND the Flight-scene pause toggle (kc.scene stays a legacy-only
 * read either way — `useGameContext` is not part of this widget's own
 * migration scope — so the stream leg ALSO registers a legacy source for
 * just the non-warp keys, proving the shim's designed MIXED-source
 * coexistence: some keys stream, others legacy, on the very same render).
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("WarpControl — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same warp state", async () => {
    const mode = { name: "default-6x5", w: 6, h: 5 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: WarpControlComponent,
      fixture: rails,
      mode,
      connectSource: true,
    });

    // Stream leg: time.warp (t.currentRate/t.timeWarp/t.warpMode/t.isPaused)
    // routed through the real stream pipeline; kc.scene/kc.padOccupied/
    // career.mode (unmapped — useGameContext is out of this widget's M3
    // scope) still via a legacy DataSource, registered alongside the
    // TelemetryProvider — exactly the MIXED-source shape a real transition
    // period looks like.
    const streamFixture = setupStreamFixture({
      carriedChannels: ["time.warp"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [
        { key: "kc.scene" },
        { key: "kc.padOccupied" },
        { key: "career.mode" },
      ],
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "warp-dual" }}>
          <WarpControlComponent id="warp-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("kc.scene", rails["kc.scene"]);
      legacyAux.source.emit("kc.padOccupied", rails["kc.padOccupied"]);
      legacyAux.source.emit("career.mode", rails["career.mode"]);
      // The SAME warp state as the legacy fixture, on the new wire: one
      // "time.warp" record. warpMode 0 = High (legacy fixture's "High"
      // string) — see normalizeWarpMode's doc comment in index.tsx for the
      // enum mapping this proves round-trips to identical rendered text.
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

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
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
  "WarpControl — behavior-preservation golden against the REAL captured recording",
  () => {
    if (!realFixtureExists) {
      it("SKIPPED: reference-wire-fixture.json not found (gitignored, local-only)", () => {});
      return;
    }

    it("renders the SAME rate/mode readout off the real recording's wire as off an equivalent legacy fixture", async () => {
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
      const legacyHtml = await snapshotWidgetMode({
        Widget: WarpControlComponent,
        fixture: {
          "t.currentRate": 1,
          "t.timeWarp": 1,
          "t.warpMode": "High",
          "t.isPaused": false,
        },
        mode,
        connectSource: true,
      });

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
      // the real state has actually settled (a race the strict `toBe` below
      // would then catch as a flaky failure instead of this wait doing its
      // job).
      await waitFor(() =>
        within(container).getByRole("img", {
          name: "Time warp rate 1×",
        }),
      );

      const streamHtml = stripVolatile(container.innerHTML);
      expect(streamHtml).toBe(legacyHtml);
    });
  },
);
