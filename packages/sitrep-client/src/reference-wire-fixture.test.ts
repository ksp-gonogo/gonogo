import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Meta, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { type OrbitElements, solve } from "./kepler";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import type { Transport, TransportStatus } from "./transport";
import type { VesselOrbitPayload } from "./vessel-state";
import { vesselStateChannel } from "./vessel-state";
import { ViewClock } from "./view-clock";

/**
 * M2 end-to-end SDK validation, TS half — the counterpart to
 * `mod/Sitrep.Host.IntegrationTests/WireFixtureGeneratorTests.cs`. That test
 * replays the REAL reference recording through
 * `ReplayKspHost -> ChannelEngine` (both extensions registered, zero network
 * delay) and captures every raw wire frame for six real channels
 * (`vessel.orbit`, `vessel.flight`, `system.bodies`, `time.warp`,
 * `vessel.control`, `vessel.comms`) to
 * `local_docs/telemetry-mod/recordings/reference-wire-fixture.json` —
 * gitignored/local-only, regenerated on demand (`dotnet test
 * --filter WireFixtureGeneratorTests` in `mod/`), never present in CI. This
 * file loads that fixture and replays it through a REAL `TelemetryClient` /
 * `TimelineStore`, proving the FULL SDK — derived channels, epoch/ghost
 * handling, staleness/certainty, the `ViewClock` estimator — against genuine
 * engine output rather than a hand-built fixture (`recording -> C# engine ->
 * wire -> TS SDK`, the actual M2 milestone claim).
 *
 * Skip-cleanly contract, same as the C# side and `reference-*.test.ts`
 * elsewhere in this repo: if the fixture file isn't present, the whole suite
 * is skipped (not failed) — this is expected in CI, which never has the
 * gitignored recording checked out.
 */

interface WireFixture {
  generatedAtUtc: string;
  recordingFile: string;
  recordingEntries: number;
  networkDelaySeconds: number;
  subscribedTopics: string[];
  frameCount: number;
  epochsSeen: number[];
  /** Each element is the EXACT raw wire text of one captured frame — see the C# generator's own doc comment. */
  frames: string[];
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
  currentDir,
  "../../../local_docs/telemetry-mod/recordings/reference-wire-fixture.json",
);
const fixtureExists = existsSync(fixturePath);

/** Controllable wall clock — advanced explicitly by the driver loop instead of racing real time (same idiom as `timeline-store-status.test.ts`'s `fakeWall`). */
function fakeWall(start = 0) {
  let now = start;
  return {
    now: () => now,
    advanceBy: (seconds: number) => {
      if (seconds > 0) now += seconds;
    },
  };
}

/**
 * A `Transport` whose `send` is a no-op and whose messages are fed in
 * explicitly by the driver loop via `deliver` — a scriptable stand-in for a
 * live WebSocket carrying the captured wire fixture, in fixture (arrival)
 * order. Both `TelemetryClient` (constructor-registered) and this test's own
 * `onMessage` listener (registered separately) observe every delivered
 * message off the SAME transport, so the frames genuinely flow through
 * `TelemetryClient` on their way to the `TimelineStore` ingestion this test
 * drives — not a bypass of it.
 */
class FixtureTransport implements Transport {
  readonly status: TransportStatus = "connected";
  private readonly listeners = new Set<(message: ServerMessage) => void>();

  send(): void {
    // no-op — the fixture already only carries frames for the topics the C#
    // harness subscribed to; a real transport's subscribe/unsubscribe
    // bookkeeping isn't what this test exercises.
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatusChange(): () => void {
    return () => {};
  }

  deliver(message: ServerMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Narrows a `vessel.state` read down to a non-null position, failing the test with a clear message instead of a bare non-null assertion. */
function requirePosition(
  point:
    | TimelinePoint<{ position: readonly [number, number, number] | null }>
    | undefined,
): readonly [number, number, number] {
  const position = point?.payload?.position;
  if (!position) {
    throw new Error(
      `expected a defined vessel.state.position, got ${JSON.stringify(point)}`,
    );
  }
  return position;
}

/** Mirrors `deriveVesselState`'s OnRails element-building exactly (see `vessel-state.ts`) — used to independently cross-check the derived channel's own output. */
function elementsFromOrbitPayload(orbit: VesselOrbitPayload): OrbitElements {
  return {
    sma: orbit.sma,
    ecc: orbit.ecc,
    inc: degToRad(orbit.inc),
    lan: orbit.lan == null ? 0 : degToRad(orbit.lan),
    argPe: orbit.argPe == null ? 0 : degToRad(orbit.argPe),
    meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch,
    epoch: orbit.epoch,
    mu: orbit.mu,
  };
}

describe.skipIf(!fixtureExists)(
  "M2 end-to-end SDK validation against the real reference-session wire fixture",
  () => {
    if (!fixtureExists) {
      // describe.skipIf still evaluates its body once to register (skipped)
      // tests — guard the fixture read so that registration doesn't itself
      // throw when the gitignored fixture is absent (CI).
      it("SKIPPED: reference-wire-fixture.json not found (gitignored, local-only — regenerate via `dotnet test --filter WireFixtureGeneratorTests`)", () => {});
      return;
    }

    const fixture: WireFixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

    it("loaded the full wire fixture, generated from the real recording", () => {
      expect(fixture.frameCount).toBeGreaterThan(0);
      expect(fixture.frames.length).toBe(fixture.frameCount);
      expect(fixture.epochsSeen).toEqual([0, 1, 2, 3]);
      expect(fixture.subscribedTopics).toEqual(
        expect.arrayContaining([
          "vessel.orbit",
          "vessel.flight",
          "system.bodies",
          "time.warp",
          "vessel.control",
          "vessel.comms",
        ]),
      );
    });

    it(
      "drives the whole fixture through TelemetryClient/TimelineStore in fixture order, honoring deliveredAt, " +
        "and proves derived channels, epoch/ghost handling, staleness/certainty, and the ViewClock estimator all end to end",
      () => {
        const wall = fakeWall(0);
        const clock = new ViewClock({
          nowWall: wall.now,
          warpRate: () => 1,
          delaySeconds: () => 0,
        });
        const store = new TimelineStore(clock);
        store.registerDerivedChannel(vesselStateChannel);

        const transport = new FixtureTransport();
        const client = new TelemetryClient(transport);
        for (const topic of fixture.subscribedTopics) {
          client.subscribe(topic, () => {});
        }

        // ---- Bookkeeping ----

        // Ghost check (mirrors WireFixtureGeneratorTests.cs's own C#
        // watermark/awaitingGhostCheck technique, re-implemented client-side):
        // the highest validAt seen for a topic BEFORE its most recent
        // timeline-reset; the first post-reset sample for that topic must be
        // strictly below that watermark.
        const watermarkBeforeReset = new Map<string, number>();
        const awaitingGhostCheck = new Map<string, boolean>();
        const ghostViolations: string[] = [];

        // Per-epoch sample-clamp / monotonic-viewUt tracking (reset on every
        // rewind, since ViewClock's own maxSampleUt/lastConfirmedViewUt
        // reset then too). Despite the name (kept from the sample-clamp
        // check it's paired with in handleMessage), this sequence holds
        // FrameToken.viewUt readings, not raw confirmedEdgeUt() — see
        // handleMessage's own comment for why.
        let maxValidAtInEpoch = Number.NEGATIVE_INFINITY;
        let confirmedEdgeSequence: number[] = [];
        let lastDeliveredAt = 0;

        // vessel.state resync-after-rewind observations, one per rewind.
        const postBumpStateObservations: {
          topic: string;
          definedImmediately: boolean;
        }[] = [];

        // epoch-0 (pre-first-rewind) OnRails vessel.orbit samples, for the
        // kepler cross-check.
        const epoch0OnRailsOrbit: {
          validAt: number;
          payload: VesselOrbitPayload;
        }[] = [];
        let inEpoch0 = true;

        function handleMessage(message: ServerMessage): void {
          if (message.type === "event") {
            if (message.name === "timeline-reset") {
              awaitingGhostCheck.set(message.topic, true);
            }
            return;
          }
          if (message.type !== "stream-data") return;

          const meta = message.meta as Meta;
          const topic = message.topic;

          // Ghost check: the first stream-data for a topic after its reset
          // event must not carry a validAt at/after the pre-reset watermark
          // — that would be a stale sample from the abandoned timeline.
          if (awaitingGhostCheck.get(topic)) {
            const watermark = watermarkBeforeReset.get(topic);
            if (watermark !== undefined && meta.validAt >= watermark) {
              ghostViolations.push(
                `topic "${topic}": first post-reset validAt ${meta.validAt} >= pre-reset watermark ${watermark}`,
              );
            }
            awaitingGhostCheck.set(topic, false);
          }

          const point: TimelinePoint<unknown> = {
            validAt: meta.validAt,
            payload: message.payload,
            meta,
            epoch: meta.timelineEpoch,
          };

          const beforeEpoch = clock.getEpoch();
          store.ingest(topic, point);
          const afterEpoch = clock.getEpoch();
          const rewoundThisIngest = afterEpoch > beforeEpoch;

          if (rewoundThisIngest) {
            // Rewind confirmed client-side. Fresh per-epoch tracking.
            maxValidAtInEpoch = Number.NEGATIVE_INFINITY;
            confirmedEdgeSequence = [];
            inEpoch0 = false;
          }

          const currentWatermark =
            watermarkBeforeReset.get(topic) ?? Number.NEGATIVE_INFINITY;
          watermarkBeforeReset.set(
            topic,
            Math.max(currentWatermark, meta.validAt),
          );

          if (meta.validAt > maxValidAtInEpoch)
            maxValidAtInEpoch = meta.validAt;

          // Sample-clamp, immediately after ingest: the raw estimator
          // (confirmedEdgeUt(), before any monotonic clamp) must never
          // exceed the max validAt actually observed this epoch. This is
          // the one invariant confirmedEdgeUt() itself documents ("never
          // ahead of the max sample UT actually observed") — it does NOT
          // document monotonicity for itself; see the `token.viewUt`
          // tracking below for that.
          expect(clock.confirmedEdgeUt()).toBeLessThanOrEqual(
            maxValidAtInEpoch + 1e-6,
          );

          // ONE beginFrame() per ingest — the frame token this whole
          // handler reasons about, matching real usage (never re-mint per
          // read).
          const token = store.beginFrame();

          if (rewoundThisIngest) {
            // The store's cross-topic sweep (TimelineStore.ingest) just
            // cleared EVERY registered raw timeline to the new (empty) epoch
            // — including vessel.orbit's, UNLESS this very ingest was itself
            // vessel.orbit (in which case its own fresh point survives the
            // sweep, since it's appended before the sweep runs). So
            // vessel.state can only already resolve here if `topic` is
            // "vessel.orbit" — anything else resolving would mean a
            // pre-rewind (dead-epoch) record survived: a ghost.
            const state = store.sample("vessel.state", token);
            if (state !== undefined) {
              expect(topic).toBe("vessel.orbit");
            }
            postBumpStateObservations.push({
              topic,
              definedImmediately: state !== undefined,
            });
          }

          // Monotonic viewUt (M2 design: "confirmed mode tracks
          // confirmedEdgeUt(), monotonic non-decreasing within an epoch" —
          // ViewClock.viewUt()'s OWN documented guarantee, delivered via its
          // internal lastConfirmedViewUt clamp). Deliberately NOT asserted
          // on raw clock.confirmedEdgeUt() directly: the real captured wire
          // order interleaves independently-cadenced channels (vessel.orbit
          // ~1s, time.warp/system.bodies on a much slower keyframe), and a
          // later-ARRIVING frame from a slower channel can carry an OLDER
          // deliveredAt than one already observed from a faster channel —
          // confirmedEdgeUt() itself briefly dips when that happens (its own
          // doc only promises the sample clamp, never monotonicity). This
          // is exactly the raw estimator noise viewUt()'s clamp exists to
          // absorb ("the design's mitigation for estimator weakness") — so
          // this is the assertion that actually matters to a real consumer.
          if (confirmedEdgeSequence.length > 0) {
            const prev =
              confirmedEdgeSequence[confirmedEdgeSequence.length - 1];
            expect(token.viewUt).toBeGreaterThanOrEqual(prev - 1e-9);
          }
          confirmedEdgeSequence.push(token.viewUt);

          if (
            inEpoch0 &&
            topic === "vessel.orbit" &&
            message.payload !== null &&
            meta.quality === Quality.OnRails
          ) {
            epoch0OnRailsOrbit.push({
              validAt: meta.validAt,
              payload: message.payload as VesselOrbitPayload,
            });
          }

          // Staleness/certainty sanity: this client subscribes to every
          // topic before any ticking starts (matching the C# generator), so
          // the server never has a catch-up reason to stamp anything but
          // Fresh — a tombstone always reads "absent"; a live delivery of
          // this exact topic always reads "live" immediately after ingest
          // (never "resyncing" — this topic just got a point; never
          // "held-stale"/"disconnected" — nothing has gone quiet or dropped).
          const status = store.sampleStatus(topic, token);
          if (message.payload === null) {
            expect(status).toBe("absent");
          } else {
            expect(status).toBe("live");
          }
        }

        transport.onMessage(handleMessage);

        // ---- Drive the whole fixture, in fixture (arrival) order ----
        for (const raw of fixture.frames) {
          const message = JSON.parse(raw) as ServerMessage;
          const meta = (message as { meta?: Meta }).meta;

          if (meta) {
            // Mid-gap wall-clock advance BEFORE delivering this frame — the
            // estimator's "coasting" behavior between confirmed samples,
            // honoring the recording's own deliveredAt timing. Probed
            // halfway through the gap (a point where nothing NEW has
            // confirmed yet) to stress the "never runs ahead of buffered
            // data" invariant, not just check it trivially right after each
            // ingest.
            const gap = meta.deliveredAt - lastDeliveredAt;
            if (gap > 0) {
              wall.advanceBy(gap / 2);
              if (Number.isFinite(maxValidAtInEpoch)) {
                expect(clock.confirmedEdgeUt()).toBeLessThanOrEqual(
                  maxValidAtInEpoch + 1e-6,
                );
              }
              wall.advanceBy(gap / 2);
              lastDeliveredAt = meta.deliveredAt;
            }
          }

          transport.deliver(message);
        }

        // ================= 1. TelemetryClient genuinely in the loop =================
        expect(client.getValue("vessel.orbit")).toBeDefined();
        expect(client.getValue("time.warp")).toBeDefined();

        // ================= 2. vessel.state derives from REAL orbit elements =================
        // Deliberately an ISOLATED store/clock (not the shared one the main
        // drive loop just ran to epoch 3) — the shared store's
        // "vessel.orbit" ClientTimeline has long since been swept by the
        // rewind sweeps and now only holds epoch-3 points, so a read at an
        // epoch-0 viewUt against it would just be a (correctly) empty
        // resync, not the wiring proof this section wants. This isolates
        // "does the derived channel correctly wire a REAL captured
        // vessel.orbit payload into kepler.solve" from the epoch/rewind
        // mechanics already proven in section 3.
        expect(epoch0OnRailsOrbit.length).toBeGreaterThan(2);
        const midIndex = Math.floor(epoch0OnRailsOrbit.length / 2);
        const sampleA = epoch0OnRailsOrbit[midIndex];
        const sampleB = epoch0OnRailsOrbit[midIndex + 1];
        expect(sampleB.validAt).toBeGreaterThan(sampleA.validAt);

        const elements = elementsFromOrbitPayload(sampleA.payload);
        const window = sampleB.validAt - sampleA.validAt;
        const viewUt1 = sampleA.validAt + window * 0.25;
        const viewUt2 = sampleA.validAt + window * 0.75;

        const expected1 = solve(elements, viewUt1);
        const expected2 = solve(elements, viewUt2);

        const orbitClock = new ViewClock({
          delaySeconds: () => 0,
          warpRate: () => 1,
        });
        const orbitStore = new TimelineStore(orbitClock);
        orbitStore.registerDerivedChannel(vesselStateChannel);
        orbitStore.ingest("vessel.orbit", {
          validAt: sampleA.validAt,
          payload: sampleA.payload,
          meta: makeMeta({
            source: "vessel:reference-recording",
            validAt: sampleA.validAt,
            deliveredAt: sampleA.validAt,
            quality: Quality.OnRails,
            active: true,
          }),
          epoch: 0,
        });

        orbitClock.scrubTo(viewUt1);
        let orbitToken = orbitStore.beginFrame();
        const state1 = orbitStore.sample<{
          position: readonly [number, number, number] | null;
        }>("vessel.state", orbitToken);
        const pos1 = requirePosition(state1);
        expect(pos1[0]).toBeCloseTo(expected1.position[0], 3);
        expect(pos1[1]).toBeCloseTo(expected1.position[1], 3);
        expect(pos1[2]).toBeCloseTo(expected1.position[2], 3);

        orbitClock.scrubTo(viewUt2);
        orbitToken = orbitStore.beginFrame();
        const state2 = orbitStore.sample<{
          position: readonly [number, number, number] | null;
        }>("vessel.state", orbitToken);
        const pos2 = requirePosition(state2);
        expect(pos2[0]).toBeCloseTo(expected2.position[0], 3);
        expect(pos2[1]).toBeCloseTo(expected2.position[1], 3);
        expect(pos2[2]).toBeCloseTo(expected2.position[2], 3);

        // Moves along the orbit as viewUt advances — not a frozen/repeated value.
        expect(pos1).not.toEqual(pos2);

        // ================= 3. 3 rewinds -> epoch bumps -> NO client ghost =================
        expect(ghostViolations).toEqual([]);
        expect(postBumpStateObservations.length).toBe(3);
        // Stable invariant (holds for ANY reference recording, not just this
        // one): vessel.state can resolve IMMEDIATELY post-bump only when the
        // very sample that confirmed the rewind was itself vessel.orbit —
        // any other topic bumping the epoch means the store's cross-topic
        // sweep just cleared vessel.orbit's own timeline too, so a genuine
        // resync is required. This is already enforced per-observation
        // inline above (`expect(topic).toBe("vessel.orbit")` whenever
        // `state !== undefined`); restated here as an aggregate check over
        // the whole session.
        //
        // M2 finalization Fix 3: this block used to ALSO assert that BOTH
        // branches (immediate AND deferred resolution) were actually
        // observed across the session's 3 rewinds — a claim about which
        // topic happens to arrive first after each rewind, i.e. about THIS
        // capture session's specific frame-interleaving, not about the SDK.
        // vessel.orbit is comfortably the fastest-cadence channel in the
        // reference recording, so it is plausible — and, empirically, now
        // the case — for a regenerated recording to have vessel.orbit be the
        // very first post-reset sample for every single rewind, hitting only
        // the "immediate" branch. That made the test flake across fixture
        // regenerations (a real recording-content dependency, not a
        // correctness bug — verified deterministic given a FIXED fixture
        // file: it failed 100% of repeated runs against the same JSON, never
        // intermittently within one). Dropped in favor of the stable
        // per-observation invariant below, which holds regardless of how the
        // 3 rewinds happen to interleave.
        for (const observation of postBumpStateObservations) {
          if (observation.definedImmediately) {
            expect(observation.topic).toBe("vessel.orbit");
          }
        }

        // ================= 4. Staleness/certainty sane across the session =================
        // (Per-frame "live"/"absent" assertions already ran inside
        // handleMessage for every one of the fixture's frames.) Certainty
        // flips at the horizon: well behind the last confirmed sample of the
        // FINAL epoch reads "confirmed"; far ahead of anything ever
        // delivered reads "predicted".
        expect(Number.isFinite(maxValidAtInEpoch)).toBe(true);
        clock.scrubTo(maxValidAtInEpoch - 50);
        const confirmedToken = store.beginFrame();
        expect(store.sampleCertainty(confirmedToken)).toBe("confirmed");

        clock.scrubTo(maxValidAtInEpoch + 100_000);
        const predictedToken = store.beginFrame();
        expect(store.sampleCertainty(predictedToken)).toBe("predicted");

        clock.scrubTo(null);

        // ================= 5. ViewClock estimator: sample-clamped & monotonic =================
        // (The sample-clamp and within-epoch monotonic assertions already
        // ran inline for every ingest and every mid-gap probe across the
        // whole 4800+ frame replay — see handleMessage and the driver loop
        // above. This final check just confirms the tracking itself
        // actually accumulated real data, i.e. the inline assertions above
        // were not vacuously skipped.)
        expect(confirmedEdgeSequence.length).toBeGreaterThan(10);
      },
    );
  },
);
