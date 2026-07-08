using System;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// M5b Task 6 -- the headless payoff test: wires the KSP-FREE pipeline
    /// EXACTLY as production does in-game (<see cref="ReplayKspHost"/> -&gt;
    /// <see cref="ChannelEngine"/>'s registered <see cref="SystemViewProvider"/>
    /// mapper -&gt; Courier/outbox wiring -&gt; a real
    /// <see cref="FleckTransportListener"/>), but driven by a synthetic
    /// <see cref="RecordedSession"/> instead of live KSP, and asserts a real
    /// <see cref="ClientWebSocket"/> observes the delayed <c>system.bodies</c>
    /// stream correctly -- including through a UT rewind (an F9 quickload).
    ///
    /// This now runs against the SAME <see cref="ChannelEngine"/> class
    /// <c>Gonogo.KSP.GonogoAddon</c> constructs in production (registering
    /// this project's own tiny <see cref="TestSystemUplink"/> instead of
    /// <c>Gonogo.KSP.SystemUplink</c>, since this project can't reference
    /// the net472 <c>Gonogo.KSP</c> assembly at all) -- there is no more
    /// hand-copied <c>ReplayBodiesServer</c> duplicating the engine's
    /// Courier/emitter/subscription wiring.
    ///
    /// This is the exact loop the user's real capture will drive: if this is
    /// green, the mod pipeline (replay -&gt; provider -&gt; engine -&gt;
    /// transport -&gt; client) is proven end to end without ever launching
    /// KSP.
    ///
    /// NOTE (M5b final review): the "rewind" this test drives is a dip in
    /// the RECORDED SESSION's own <c>t</c> values (entry C's t=3.0 sits
    /// below the immediately-preceding event's t=4.0) -- but that event
    /// entry never calls <c>server.Tick</c> (see <see cref="DriveOneStep"/>),
    /// so the UTs actually handed to the Courier/Clock across this whole
    /// test are 0, 2, 3, 6, 8: monotonically NON-DECREASING throughout. This
    /// test does NOT exercise a backward tick UT at the server/Courier
    /// Clock level, and so never caught the real defect (a live UT-backward
    /// quickload wedging the courier on the abandoned pre-quickload
    /// timeline). <see cref="ServerClockRewindResetsCourierAndResumesDeliveryWithoutStalling"/>
    /// below is the test that does drive an actual backward server-clock
    /// tick and pins the fix.
    /// </summary>
    public class ReplayToWebSocketEndToEndTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private const double NetworkDelaySeconds = 2.0;

        [Fact]
        public async Task ReplayDrivesDelayedSystemBodiesStreamThroughARewindWithoutSwallowingPostRewindSnapshots()
        {
            // ------------------------------------------------------------
            // 1. The synthetic recording: three pre-quickload snapshots
            //    (A, B held at UT 0/2), a game-state-load lifecycle event
            //    at UT 4, then THREE post-rewind snapshots (C, D, E) whose
            //    own UTs (3, 6, 8) dip back BELOW the UT the quickload event
            //    itself carried (4) before climbing again -- exactly the
            //    "T back to a lower value" shape a real F9 quickload
            //    produces (see the M5b plan's Task 6 spec). Each snapshot's
            //    "bodies" value follows SystemViewProvider's documented raw
            //    encoding: a root star (no parentIndex) + one planet
            //    (parentIndex 0) with a distinct sma per snapshot, so the
            //    test can tell which snapshot's payload actually reached the
            //    wire.
            // ------------------------------------------------------------
            var session = new RecordedSession
            {
                SchemaVersion = RecordedSessionCodec.CurrentSchemaVersion,
                StartUt = 0.0,
                Entries =
                {
                    SnapshotEntry(t: 0.0, planetSma: 13_599_840_256), // A
                    SnapshotEntry(t: 2.0, planetSma: 13_600_000_000), // B
                    EventEntry(t: 4.0, kind: "game-state-load", argKey: "reason", argValue: "quickload"),
                    SnapshotEntry(t: 3.0, planetSma: 99_000_000),     // C -- rewind: 3.0 < the event's 4.0
                    SnapshotEntry(t: 6.0, planetSma: 100_000_000),    // D -- resumes forward
                    SnapshotEntry(t: 8.0, planetSma: 100_500_000),    // E -- pushes the clock past D's own delivery
                },
            };

            var host = new ReplayKspHost(session);
            var lifecycleEvents = new List<KspLifecycleEvent>();
            host.Lifecycle += lifecycleEvents.Add;

            using var server = new ChannelEngine("ws://127.0.0.1:0", NetworkDelaySeconds);
            server.RegisterUplink(new TestSystemUplink());
            server.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(server.BoundPort, Timeout);
                await SubscribeAsync(client, SystemViewProvider.Topic, Timeout);

                // ---- Step 1: UT 0, snapshot A. Not due yet (fireUt = 0+2 = 2). ----
                DriveOneStep(host, server, lifecycleEvents);
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));

                // ---- Step 2: UT 2, snapshot B. Clock reaches 2 -> A's delivery
                //      (fireUt=2) fires: the client genuinely receives A DELAYED
                //      by the full network delay, not immediately. ----
                DriveOneStep(host, server, lifecycleEvents);
                var deliveredA = await ReceiveStreamDataAsync(client, Timeout);
                AssertCleanSystemBodiesShape(deliveredA, expectedPlanetSma: 13_599_840_256, expectedStarName: "Kerbol", expectedPlanetName: "Kerbin");
                Assert.Equal(0.0, deliveredA.Meta.ValidAt);
                Assert.Equal(2.0, deliveredA.Meta.DeliveredAt);
                Assert.Equal(NetworkDelaySeconds, deliveredA.Meta.DeliveredAt - deliveredA.Meta.ValidAt, precision: 6);

                // ---- Step 3: UT 4, the game-state-load (quickload) lifecycle
                //      event. No snapshot changed, so the driver does not tick
                //      the Courier for this step (see DriveOneStep) -- nothing
                //      new can arrive on the wire from this step alone. ----
                DriveOneStep(host, server, lifecycleEvents);
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));
                var quickload = Assert.Single(lifecycleEvents);
                Assert.Equal("game-state-load", quickload.Kind);
                Assert.Equal(4.0, quickload.Ut);
                Assert.Equal("quickload", quickload.Args["reason"]);

                // ---- Step 4: UT 3 -- THE REWIND. Lower than the event's UT 4
                //      immediately before it, exactly like a real capture's
                //      post-quickload entries (see ReplayKspHost.Step's doc
                //      comment). The clock still only advances to 3 (>= its
                //      prior position of 2), so nothing is due yet: neither
                //      B's delivery (fireUt=4) nor C's own (fireUt=5). This is
                //      the crucial proof that Step() keeps feeding the driver
                //      one entry at a time THROUGH the rewind rather than
                //      wedging or throwing. ----
                DriveOneStep(host, server, lifecycleEvents);
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));

                // ---- Step 5: UT 6 -- resumes forward past the pre-rewind
                //      peak. Both B's (fireUt=4) and C's (fireUt=5) deliveries
                //      are now due in the same Courier-thread drain, and
                //      ManualClock.AdvanceTo's ascending-fireUt order means
                //      C's delivery callback runs strictly AFTER B's (5 > 4)
                //      -- so C's write to the per-topic outbox (see
                //      ReplayOutbox) always happens after B's, in real time.
                //      Depending on exactly when the outbox's own pump thread
                //      (a second, independent thread) wakes up relative to
                //      those two writes, B may or may not reach the wire as
                //      its own separate frame before being coalesced away --
                //      that timing is a genuine race, which is why this
                //      drains to the LAST frame observed for the topic rather
                //      than asserting on "the next message": whether B is
                //      sent-then-superseded or never sent at all, C is
                //      guaranteed to be the final state observed, because its
                //      write is strictly ordered after B's. This is the same
                //      "drain to latest" idiom the M5a BackPressure test uses
                //      for exactly this lossy-latest-coalescing shape. ----
                DriveOneStep(host, server, lifecycleEvents);
                var deliveredC = await DrainToLatestStreamDataAsync(client, TimeSpan.FromMilliseconds(1000));
                Assert.NotNull(deliveredC);
                AssertCleanSystemBodiesShape(deliveredC!, expectedPlanetSma: 99_000_000, expectedStarName: "Kerbol", expectedPlanetName: "Kerbin");
                Assert.Equal(3.0, deliveredC!.Meta.ValidAt);
                Assert.Equal(5.0, deliveredC.Meta.DeliveredAt);
                Assert.Equal(NetworkDelaySeconds, deliveredC.Meta.DeliveredAt - deliveredC.Meta.ValidAt, precision: 6);

                // ---- Step 6: UT 8, snapshot E. Pushes the clock to 8, past
                //      D's own delivery (fireUt = 6+2 = 8) -- proving ordinary
                //      forward delayed delivery resumes cleanly after the
                //      rewind episode; the pipeline isn't left stuck. ----
                DriveOneStep(host, server, lifecycleEvents);
                var deliveredD = await ReceiveStreamDataAsync(client, Timeout);
                AssertCleanSystemBodiesShape(deliveredD, expectedPlanetSma: 100_000_000, expectedStarName: "Kerbol", expectedPlanetName: "Kerbin");
                Assert.Equal(6.0, deliveredD.Meta.ValidAt);
                Assert.Equal(8.0, deliveredD.Meta.DeliveredAt);
                Assert.Equal(NetworkDelaySeconds, deliveredD.Meta.DeliveredAt - deliveredD.Meta.ValidAt, precision: 6);

                // Every recorded entry was consumed exactly once, including
                // through the rewind -- the replay never got stuck, and the
                // quickload event fired exactly once (no re-fire, no drop).
                Assert.False(host.Step());
                Assert.Single(lifecycleEvents);
            }
            finally
            {
                server.Stop();
            }
        }

        /// <summary>
        /// M5b final-review fix: proves a genuine SERVER-CLOCK rewind (as
        /// opposed to <see cref="ReplayDrivesDelayedSystemBodiesStreamThroughARewindWithoutSwallowingPostRewindSnapshots"/>'s
        /// replay-CURSOR-only dip -- see the note on this class's doc
        /// comment) resumes delivery instead of stalling.
        ///
        /// Drives <see cref="ChannelEngine.TickAndWait"/> directly (bypassing
        /// <see cref="ReplayKspHost"/> entirely, via <see cref="TestSystemUplink"/>'s
        /// raw-passthrough <c>test.raw</c> channel) so the UT sequence handed
        /// to the Courier/Clock is exactly what a live quickload produces: UT
        /// climbs to a peak (0 -&gt; 5), then jumps BACKWARD (5 -&gt; 1,
        /// simulating an F9 load to an earlier save), then resumes forward.
        ///
        /// FAILS against the pre-fix no-op-on-backward
        /// <c>ManualClock.AdvanceTo</c>: the UT-5 tick's own pending delivery
        /// (fireUt=7) strands the clock at 5, so the post-rewind UT-1 tick's
        /// delivery (fireUt=3) can never fire while UT stays below 5 --
        /// <see cref="ReceiveStreamDataAsync"/> for the post-rewind frame
        /// times out. PASSES once the server resets the courier's timeline
        /// on a detected backward tick.
        /// </summary>
        [Fact]
        public async Task ServerClockRewindResetsCourierAndResumesDeliveryWithoutStalling()
        {
            const double delaySeconds = 2.0;

            using var server = new ChannelEngine("ws://127.0.0.1:0", delaySeconds);
            server.RegisterUplink(new TestSystemUplink());
            server.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(server.BoundPort, Timeout);
                await SubscribeAsync(client, TestSystemUplink.RawTopic, Timeout);

                // ---- Establish a peak UT of 5 via two forward ticks. The
                // UT-0 tick's delivery (fireUt = 0+2 = 2) fires when the
                // clock reaches 5; the UT-5 tick's OWN delivery (fireUt = 7)
                // is what will be stranded by the coming rewind. ----
                server.TickAndWait(0.0, TestSystemUplink.RawSnapshot(0.0, BodiesPayload(111)), Timeout);
                server.TickAndWait(5.0, TestSystemUplink.RawSnapshot(5.0, BodiesPayload(222)), Timeout);

                var deliveredPeak = await ReceiveStreamDataAsync(client, Timeout);
                AssertSma(deliveredPeak, 111);
                Assert.Equal(0.0, deliveredPeak.Meta.ValidAt);
                Assert.Equal(2.0, deliveredPeak.Meta.DeliveredAt);

                // Nothing else due yet (222's fireUt=7 is well beyond UT 5).
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));

                // ---- THE QUICKLOAD: tick backward to UT 1. Pre-fix, this
                // no-ops (1 < 5) and the courier stays wedged at UT 5 with
                // sma=222's delivery (fireUt=7) permanently pending -- the
                // live multi-minute stall this fix targets. Post-fix, the
                // server detects the backward tick, resets the courier's
                // timeline to UT 1 (dropping the abandoned fireUt=7
                // delivery), and broadcasts a timeline-reset event. ----
                server.TickAndWait(1.0, TestSystemUplink.RawSnapshot(1.0, BodiesPayload(333)), Timeout);

                // (b) timeline-reset was emitted, using the same EventMsg
                // shape as the subscribe-ack.
                var reset = await ReceiveTypedAsync<EventMsg>(client, Timeout);
                Assert.Equal("timeline-reset", reset.Name);
                Assert.Equal(TestSystemUplink.RawTopic, reset.Topic);

                // Not due yet: sma=333's own delivery is fireUt = 1+2 = 3,
                // and the clock only just reset to 1.
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));

                // ---- Resume forward on the NEW (post-rewind) timeline: UT 3
                // is when sma=333's delivery (fireUt=3) is due. If the
                // rewind hadn't reset the clock, this tick (3 < the old peak
                // of 5) would ALSO no-op and this would time out -- exactly
                // the live stall this fix targets.
                //
                // (c) subscriptions survived the reset: this delivery
                // reaches the client on the ORIGINAL subscription from
                // above -- no re-subscribe was sent. ----
                server.TickAndWait(3.0, TestSystemUplink.RawSnapshot(3.0, BodiesPayload(444)), Timeout);

                var deliveredPostRewind = await ReceiveStreamDataAsync(client, Timeout);
                AssertSma(deliveredPostRewind, 333);
                Assert.Equal(1.0, deliveredPostRewind.Meta.ValidAt);
                Assert.Equal(3.0, deliveredPostRewind.Meta.DeliveredAt);

                // ---- (a), continued: push well past the ABANDONED sma=222
                // delivery's original fireUt=7. If it had NOT been dropped
                // by the reset, ManualClock.AdvanceTo(9) would fire it here
                // (7 <= 9) as a second frame, interleaved with sma=444's own
                // delivery (fireUt=5). Exactly one frame (sma=444) must
                // arrive, and no sma=222 frame ever can -- proving the
                // abandoned delivery was truly dropped, not merely
                // delayed. ----
                server.TickAndWait(9.0, TestSystemUplink.RawSnapshot(9.0, BodiesPayload(555)), Timeout);

                var deliveredNext = await ReceiveStreamDataAsync(client, Timeout);
                AssertSma(deliveredNext, 444);
                Assert.Equal(3.0, deliveredNext.Meta.ValidAt);
                Assert.Equal(5.0, deliveredNext.Meta.DeliveredAt);

                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));
            }
            finally
            {
                server.Stop();
            }
        }

        /// <summary>
        /// Track C's fix, proven headlessly against the SAME
        /// <see cref="ChannelEngine"/> production uses -- see this class's
        /// doc comment. Ticks with ZERO subscribers must never even reach
        /// the emitter (proven via <see cref="ChannelEngine.ChannelCounters"/>,
        /// since "nothing arrived on the wire" alone doesn't distinguish this
        /// from the pre-fix behavior of no one being subscribed to receive it
        /// either way) -- and the moment a client subscribes, the very next
        /// tick both reaches the emitter AND streams immediately (the
        /// subscribe-triggered keyframe), with no wait for a change or a
        /// keyframe-cadence rollover.
        /// </summary>
        [Fact]
        public async Task ZeroSubscribersNeverReachTheEmitterButStreamImmediatelyOnceSomeoneSubscribes()
        {
            using var server = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            server.RegisterUplink(new TestSystemUplink());
            server.Start();
            try
            {
                // No client connected at all -- three ticks land with zero
                // subscribers. The SubscriptionRegistry/ChannelEmitter outer
                // gate means Decide is never called for any of them.
                server.TickAndWait(0.0, TestSystemUplink.RawSnapshot(0.0, BodiesPayload(1)), Timeout);
                server.TickAndWait(1.0, TestSystemUplink.RawSnapshot(1.0, BodiesPayload(2)), Timeout);
                server.TickAndWait(2.0, TestSystemUplink.RawSnapshot(2.0, BodiesPayload(3)), Timeout);
                Assert.Equal(0, server.ChannelCounters(TestSystemUplink.RawTopic).Considered);
                Assert.Equal(0, server.ChannelCounters(TestSystemUplink.RawTopic).Emitted);

                await using var client = await TestClient.ConnectAsync(server.BoundPort, Timeout);
                await SubscribeAsync(client, TestSystemUplink.RawTopic, Timeout);

                // The genuine 0 -> 1 subscribe transition forces a keyframe
                // on the very next tick, regardless of keyframe cadence.
                server.TickAndWait(3.0, TestSystemUplink.RawSnapshot(3.0, BodiesPayload(4)), Timeout);
                Assert.Equal(1, server.ChannelCounters(TestSystemUplink.RawTopic).Considered);
                Assert.Equal(1, server.ChannelCounters(TestSystemUplink.RawTopic).Emitted);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                AssertSma(delivered, 4);
            }
            finally
            {
                server.Stop();
            }
        }

        private static object BodiesPayload(double sma)
        {
            return new Dictionary<string, object?> { ["sma"] = sma };
        }

        private static void AssertSma(StreamData delivered, double expectedSma)
        {
            var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
            Assert.Equal(expectedSma, payload["sma"]);
        }

        /// <summary>
        /// One step of the replay-driving loop: <see cref="ReplayKspHost.Step"/>
        /// advances the replay by exactly one recorded entry (snapshot or
        /// event, whichever is next in capture order -- see its own doc
        /// comment for why this, and not <c>AdvanceTo</c>, is the correct
        /// driver for a real recording that may rewind). If the step
        /// consumed a SNAPSHOT, the raw snapshot is handed straight to
        /// <see cref="ChannelEngine.TickAndWait"/> -- the exact shape
        /// <c>GonogoAddon.FixedUpdate</c> uses in-game
        /// (<c>engine.Tick(host.NowUt(), snapshot)</c>), just blocking so the
        /// test can assert deterministically; the engine itself now applies
        /// <see cref="SystemViewProvider.BuildSystemBodies"/> (registered by
        /// <see cref="TestSystemUplink"/>) rather than this method
        /// building the payload by hand. If the step consumed a lifecycle
        /// EVENT instead, no tick is driven at all -- deliberately preserved
        /// from the pre-engine version of this test: this scenario's whole
        /// point (see this class's own doc comment NOTE) is that the UTs
        /// reaching the Courier/clock stay monotonically non-decreasing
        /// (0, 2, 3, 6, 8) even though the RECORDING'S own timestamps dip:
        /// ticking on the UT-4 event step too would hand the clock a real
        /// backward tick at step 4 (4 -&gt; 3), firing an unrelated
        /// timeline-reset this test doesn't expect. Detected by checking
        /// whether <paramref name="lifecycleEvents"/> grew during this step
        /// (exactly one of snapshot/event fires per <see cref="RecordedEntry"/>,
        /// so this check is exact, not a heuristic).
        /// </summary>
        private static void DriveOneStep(ReplayKspHost host, ChannelEngine server, List<KspLifecycleEvent> lifecycleEvents)
        {
            var lifecycleCountBefore = lifecycleEvents.Count;
            var more = host.Step();
            Assert.True(more, "test fixture ran out of recorded entries mid-scenario");

            if (lifecycleEvents.Count > lifecycleCountBefore)
            {
                return; // this step was a lifecycle event, not a snapshot -- nothing to tick.
            }

            server.TickAndWait(host.NowUt(), host.Sample(), Timeout);
        }

        private static void AssertCleanSystemBodiesShape(StreamData delivered, double expectedPlanetSma, string expectedStarName, string expectedPlanetName)
        {
            Assert.Equal(SystemViewProvider.Topic, delivered.Topic);
            var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
            var bodies = Assert.IsType<List<object?>>(payload["bodies"]);
            Assert.Equal(2, bodies.Count);

            var star = Assert.IsType<Dictionary<string, object?>>(bodies[0]);
            Assert.Equal(expectedStarName, star["name"]);
            Assert.Equal(0.0, star["index"]);
            // Root star: explicit parent-index tree with no sentinel -- null, never -1.
            Assert.Null(star["parentIndex"]);
            Assert.Null(star["orbit"]);

            var planet = Assert.IsType<Dictionary<string, object?>>(bodies[1]);
            Assert.Equal(expectedPlanetName, planet["name"]);
            Assert.Equal(1.0, planet["index"]);
            Assert.Equal(0.0, planet["parentIndex"]);
            var orbit = Assert.IsType<Dictionary<string, object?>>(planet["orbit"]);
            Assert.Equal(expectedPlanetSma, orbit["sma"]);
            Assert.Contains("ecc", orbit.Keys);
            Assert.Contains("inc", orbit.Keys);
            Assert.Contains("lan", orbit.Keys);
            Assert.Contains("argPe", orbit.Keys);
            Assert.Contains("meanAnomalyAtEpoch", orbit.Keys);
            Assert.Contains("epoch", orbit.Keys);
            // The Telemachus copy-paste bug (OrbitPatchJSONFormatter assigning
            // "eccentricAnomaly" the body's eccentricity) is NOT reproduced here.
            Assert.DoesNotContain("eccentricAnomaly", orbit.Keys);
        }

        private static RecordedEntry SnapshotEntry(double t, double planetSma)
        {
            return new RecordedEntry
            {
                T = t,
                Kind = "snapshot",
                Snapshot = new RecordedSnapshotPayload
                {
                    Values = new Dictionary<string, object?>
                    {
                        ["bodies"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Kerbol",
                                ["index"] = 0,
                                ["radius"] = 261_600_000.0,
                                // No "parentIndex" key at all -- the root star.
                            },
                            new Dictionary<string, object?>
                            {
                                ["name"] = "Kerbin",
                                ["index"] = 1,
                                ["parentIndex"] = 0,
                                ["radius"] = 600_000.0,
                                ["sma"] = planetSma,
                                ["ecc"] = 0.0,
                                ["inc"] = 0.0,
                                ["lan"] = 0.0,
                                ["argPe"] = 0.0,
                                ["meanAnomalyAtEpoch"] = 0.0,
                                ["epoch"] = 0.0,
                            },
                        },
                    },
                },
            };
        }

        private static RecordedEntry EventEntry(double t, string kind, string argKey, string argValue)
        {
            return new RecordedEntry
            {
                T = t,
                Kind = "event",
                Event = new RecordedEventPayload
                {
                    EventKind = kind,
                    Args = new Dictionary<string, object?> { [argKey] = argValue },
                },
            };
        }

    }
}
