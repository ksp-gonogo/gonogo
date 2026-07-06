using System;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// M5b Task 6 -- the headless payoff test: wires the KSP-FREE pipeline
    /// EXACTLY as <c>Gonogo.KSP.GonogoBodiesServer</c> does in-game
    /// (<see cref="ReplayKspHost"/> -&gt; <see cref="SystemViewProvider"/> -&gt;
    /// <see cref="ReplayBodiesServer"/>'s Courier/outbox wiring -&gt; a real
    /// <see cref="FleckTransportListener"/>), but driven by a synthetic
    /// <see cref="RecordedSession"/> instead of live KSP, and asserts a real
    /// <see cref="ClientWebSocket"/> observes the delayed <c>system.bodies</c>
    /// stream correctly -- including through a UT rewind (an F9 quickload).
    ///
    /// This is the exact loop the user's real capture will drive: if this is
    /// green, the mod pipeline (replay -&gt; provider -&gt; courier -&gt;
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

            using var server = new ReplayBodiesServer("ws://127.0.0.1:0", NetworkDelaySeconds);
            server.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(server.BoundPort, Timeout);
                await SubscribeAsync(client, ReplayBodiesServer.BodiesTopic, Timeout);

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
        /// Drives <see cref="ReplayBodiesServer.Tick"/> directly (bypassing
        /// <see cref="ReplayKspHost"/> entirely) so the UT sequence handed to
        /// the Courier/Clock is exactly what a live quickload produces: UT
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

            using var server = new ReplayBodiesServer("ws://127.0.0.1:0", delaySeconds);
            server.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(server.BoundPort, Timeout);
                await SubscribeAsync(client, ReplayBodiesServer.BodiesTopic, Timeout);

                // ---- Establish a peak UT of 5 via two forward ticks. The
                // UT-0 tick's delivery (fireUt = 0+2 = 2) fires when the
                // clock reaches 5; the UT-5 tick's OWN delivery (fireUt = 7)
                // is what will be stranded by the coming rewind. ----
                server.Tick(0.0, BodiesPayload(111));
                server.Tick(5.0, BodiesPayload(222));

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
                server.Tick(1.0, BodiesPayload(333));

                // (b) timeline-reset was emitted, using the same EventMsg
                // shape as the subscribe-ack.
                var reset = await ReceiveTypedAsync<EventMsg>(client, Timeout);
                Assert.Equal("timeline-reset", reset.Name);
                Assert.Equal(ReplayBodiesServer.BodiesTopic, reset.Topic);

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
                server.Tick(3.0, BodiesPayload(444));

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
                server.Tick(9.0, BodiesPayload(555));

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
        /// consumed a SNAPSHOT, the freshly built <c>system.bodies</c>
        /// payload is handed to the Courier at the replay's own current UT --
        /// the exact shape <c>GonogoAddon.FixedUpdate</c> uses in-game
        /// (<c>server.Tick(host.NowUt(), payload)</c>). If the step consumed
        /// a lifecycle EVENT instead, nothing changed for
        /// <see cref="SystemViewProvider.BuildSystemBodies"/> to report, so
        /// no tick is recorded -- detected by checking whether
        /// <paramref name="lifecycleEvents"/> grew during this step (exactly
        /// one of snapshot/event fires per <see cref="RecordedEntry"/>, so
        /// this check is exact, not a heuristic).
        /// </summary>
        private static void DriveOneStep(ReplayKspHost host, ReplayBodiesServer server, List<KspLifecycleEvent> lifecycleEvents)
        {
            var lifecycleCountBefore = lifecycleEvents.Count;
            var more = host.Step();
            Assert.True(more, "test fixture ran out of recorded entries mid-scenario");

            if (lifecycleEvents.Count > lifecycleCountBefore)
            {
                return; // this step was a lifecycle event, not a snapshot -- nothing to tick.
            }

            var payload = SystemViewProvider.BuildSystemBodies(host.Sample());
            Assert.NotNull(payload);
            server.Tick(host.NowUt(), payload);
        }

        private static void AssertCleanSystemBodiesShape(StreamData delivered, double expectedPlanetSma, string expectedStarName, string expectedPlanetName)
        {
            Assert.Equal(ReplayBodiesServer.BodiesTopic, delivered.Topic);
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

        // ---------------------------------------------------------------
        // WS test helpers -- same shape as
        // Sitrep.Skeleton.Tests/SkeletonServerIntegrationTests.cs (private
        // and not shared across assemblies, hence duplicated here).
        // ---------------------------------------------------------------

        private static async Task<EventMsg> SubscribeAsync(TestClient client, string topic, TimeSpan timeout)
        {
            await client.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = topic }));
            return await ReceiveTypedAsync<EventMsg>(client, timeout);
        }

        private static async Task<StreamData> ReceiveStreamDataAsync(TestClient client, TimeSpan timeout)
        {
            return await ReceiveTypedAsync<StreamData>(client, timeout);
        }

        /// <summary>
        /// Drains <see cref="StreamData"/> frames until none arrive for a
        /// short quiet window, returning the LAST one seen -- the
        /// lossy-latest convergence point for a coalescing per-topic outbox
        /// (see <see cref="ReplayOutbox"/>). Needed wherever two Courier
        /// deliveries for the same topic can become due within a single
        /// clock-advance: which of them (if any, besides the last) actually
        /// reaches the wire as its own frame depends on exactly when the
        /// outbox's independent pump thread wakes up relative to the
        /// Courier thread's writes -- a genuine two-thread race, not
        /// something a single "receive the next message" call can assert on
        /// deterministically. The LAST frame observed is NOT racy, though:
        /// whichever delivery's <c>PublishTelemetry</c> call happened last in
        /// real time is guaranteed to be what any subsequent send reflects.
        /// Same idiom as <c>SkeletonServerIntegrationTests.DrainToLatestAsync</c>.
        /// </summary>
        private static async Task<StreamData?> DrainToLatestStreamDataAsync(TestClient client, TimeSpan quietWindow)
        {
            StreamData? last = null;
            while (true)
            {
                string raw;
                try
                {
                    raw = await client.ReceiveAsync(quietWindow);
                }
                catch (OperationCanceledException)
                {
                    return last;
                }

                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData streamData)
                {
                    last = streamData;
                }
            }
        }

        private static async Task<T> ReceiveTypedAsync<T>(TestClient client, TimeSpan timeout) where T : class
        {
            var deadline = DateTime.UtcNow + timeout;
            while (true)
            {
                var remaining = deadline - DateTime.UtcNow;
                if (remaining <= TimeSpan.Zero)
                {
                    throw new TimeoutException($"No {typeof(T).Name} arrived within {timeout}.");
                }
                var parsed = EnvelopeCodec.ParseServerMessage(await client.ReceiveAsync(remaining));
                if (parsed is T typed)
                {
                    return typed;
                }
            }
        }

        private sealed class TestClient : IAsyncDisposable
        {
            private readonly ClientWebSocket _socket = new ClientWebSocket();
            private readonly Channel<string> _incoming = Channel.CreateUnbounded<string>();
            private readonly CancellationTokenSource _pumpCts = new CancellationTokenSource();
            private Task? _pump;

            public static async Task<TestClient> ConnectAsync(int port, TimeSpan timeout)
            {
                var client = new TestClient();
                using var connectCts = new CancellationTokenSource(timeout);
                await client._socket.ConnectAsync(new Uri($"ws://127.0.0.1:{port}/"), connectCts.Token);
                client._pump = Task.Run(client.PumpAsync);
                return client;
            }

            private async Task PumpAsync()
            {
                var buffer = new byte[16384];
                try
                {
                    while (_socket.State == WebSocketState.Open && !_pumpCts.IsCancellationRequested)
                    {
                        using var ms = new MemoryStream();
                        WebSocketReceiveResult result;
                        do
                        {
                            result = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), _pumpCts.Token);
                            if (result.MessageType == WebSocketMessageType.Close)
                            {
                                return;
                            }
                            ms.Write(buffer, 0, result.Count);
                        } while (!result.EndOfMessage);

                        await _incoming.Writer.WriteAsync(Encoding.UTF8.GetString(ms.ToArray()), _pumpCts.Token);
                    }
                }
                catch (OperationCanceledException)
                {
                }
                catch (WebSocketException)
                {
                }
                catch (ChannelClosedException)
                {
                }
            }

            public Task SendAsync(string text)
            {
                var bytes = Encoding.UTF8.GetBytes(text);
                return _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
            }

            public async Task<string> ReceiveAsync(TimeSpan timeout)
            {
                using var cts = new CancellationTokenSource(timeout);
                return await _incoming.Reader.ReadAsync(cts.Token);
            }

            public async Task AssertNoMessageArrivesAsync(TimeSpan window)
            {
                using var cts = new CancellationTokenSource(window);
                await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
                    await _incoming.Reader.ReadAsync(cts.Token));
            }

            public async ValueTask DisposeAsync()
            {
                _pumpCts.Cancel();
                _socket.Dispose();
                if (_pump != null)
                {
                    try
                    {
                        await _pump;
                    }
                    catch
                    {
                        // best-effort cleanup only
                    }
                }
            }
        }
    }
}
