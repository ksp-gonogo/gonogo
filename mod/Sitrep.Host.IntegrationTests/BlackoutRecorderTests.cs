using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The blackout RECORDER, proven end-to-end over a real WebSocket, the same
    /// un-bypassable choke point <see cref="RevealGateTests"/> uses.
    ///
    /// <para>An outage window used to be DELETED. On the disconnected-to-connected
    /// edge the engine called <c>DropInBlackoutBacklog</c>, the first post-outage
    /// sample was stamped <see cref="Staleness.Fresh"/>, and everything read
    /// normal instantly: the outage left no trace on the wire at all. These tests
    /// pin the replacement, which is that the craft holds the window and dumps it
    /// on acquisition of signal, at the light-time of the REACQUISITION geometry.
    /// </para>
    /// </summary>
    public class BlackoutRecorderTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private static List<StreamData> On(IEnumerable<StreamData> frames, string topic) =>
            frames.Where(f => f.Topic == topic && f.Payload != null).ToList();

        private static double Value(StreamData frame) => Convert.ToDouble(frame.Payload);

        /// <summary>
        /// The whole recording is dumped, and it arrives at the REACQUISITION
        /// light-time rather than the one in force at loss of signal.
        ///
        /// <para>The two are deliberately far apart (9s at LOS, 2s at
        /// reacquisition) because a dump scheduled off the frozen last-connected
        /// delay is the plausible wrong answer and it is invisible at one delay:
        /// it would land at UT 14 instead of UT 7. The samples arrive at UT 7
        /// carrying their ORIGINAL <c>validAt</c> from inside the outage, and a
        /// <c>deliveredAt</c> of the real arrival, not <c>validAt + light-time</c>.
        /// </para>
        /// </summary>
        [Fact]
        public async Task TheRecordingIsDumpedAtTheReacquisitionLightTime()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.LinkTopic, Timeout);

                // In contact at a 9s light-time.
                Tick(engine, Snap(0.0, connected: true, delay: 9.0));
                Tick(engine, Snap(1.0, connected: true, delay: 9.0, onboard: 1.0));

                // Out of contact UT 2..4. The live delay collapses to 0 (no path
                // to measure), exactly as SignalDelay does on a real dropout.
                foreach (var ut in new[] { 2.0, 3.0, 4.0 })
                {
                    Tick(engine, Snap(ut, connected: false, delay: 0.0, onboard: ut));
                }
                var duringOutage = On(await DrainAllStreamDataAsync(client, Quiet), BlackoutRecorderTestUplink.OnboardTopic);
                Assert.DoesNotContain(duringOutage, f => Value(f) >= 2.0);

                // Reacquired at UT 5, now 2s away. The dump transmits at UT 5 and
                // lands at UT 7. Nothing at UT 5 or 6.
                Tick(engine, Snap(5.0, connected: true, delay: 2.0, onboard: 5.0));
                Tick(engine, Snap(6.0, connected: true, delay: 2.0, onboard: 5.0));
                var beforeArrival = On(await DrainAllStreamDataAsync(client, Quiet), BlackoutRecorderTestUplink.OnboardTopic);
                Assert.DoesNotContain(beforeArrival, f => Value(f) is 2.0 or 3.0 or 4.0);

                Tick(engine, Snap(7.0, connected: true, delay: 2.0, onboard: 5.0));
                var dump = On(await DrainAllStreamDataAsync(client, Quiet), BlackoutRecorderTestUplink.OnboardTopic);

                foreach (var expected in new[] { 2.0, 3.0, 4.0 })
                {
                    var frame = dump.SingleOrDefault(f => Value(f) == expected);
                    Assert.NotNull(frame);
                    // The instant it describes is the one it was taken at,
                    // inside the outage.
                    Assert.Equal(expected, frame!.Meta.ValidAt);
                    // ...and the instant it ARRIVED is the dump's arrival, which
                    // is the reacquisition instant plus the reacquisition
                    // light-time. Not validAt + delay (which would be 4, 5, 6),
                    // and not the loss-of-signal horizon (which would be 14).
                    Assert.Equal(7.0, frame.Meta.DeliveredAt);
                    Assert.Equal(Staleness.Recorded, frame.Meta.Staleness);
                    // A complete recording claims no hole.
                    Assert.Null(frame.Meta.GapSinceUt);
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A channel declared <c>Recordable = false</c> has no recording to dump,
        /// and says so: its samples from inside the outage never appear, and its
        /// first post-outage sample carries <see cref="Meta.GapSinceUt"/> naming
        /// the last sample the ground actually received.
        ///
        /// <para>Both halves matter. Replaying a session fact would have the
        /// craft report the player's own warp rate back to them hours late;
        /// dropping it silently is the defect this whole task exists to fix, one
        /// channel at a time.</para>
        /// </summary>
        [Fact]
        public async Task ANonRecordableChannelReplaysNothingAndStatesTheHole()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.SessionTopic, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.LinkTopic, Timeout);

                // Delay 0 throughout: this test is about WHAT arrives, not when,
                // so the light-time is kept out of it.
                Tick(engine, Snap(0.0, connected: true, delay: 0.0));
                Tick(engine, Snap(1.0, connected: true, delay: 0.0, session: 1.0));

                foreach (var ut in new[] { 2.0, 3.0, 4.0 })
                {
                    Tick(engine, Snap(ut, connected: false, delay: 0.0, session: ut));
                }
                Tick(engine, Snap(5.0, connected: true, delay: 0.0, session: 5.0));

                var frames = On(await DrainAllStreamDataAsync(client, Quiet), BlackoutRecorderTestUplink.SessionTopic);

                // Nothing from inside the outage.
                Assert.DoesNotContain(frames, f => Value(f) is 2.0 or 3.0 or 4.0);

                // The first sample after it names the hole, back to UT 1: the
                // last one the ground has.
                var resumed = frames.Single(f => Value(f) == 5.0);
                Assert.Equal(1.0, resumed.Meta.GapSinceUt);

                // And the pre-outage sample itself claims no hole.
                Assert.Null(frames.Single(f => Value(f) == 1.0).Meta.GapSinceUt);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The recorder's byte budget: a recording that outgrows it keeps the span
        /// ADJACENT to reacquisition, drops the oldest, and states what it dropped
        /// rather than presenting a truncated recording as a whole one.
        ///
        /// <para>The budget is shrunk to a thousand samples' worth so the test can
        /// outgrow it; what is under test is the policy, and the production budget
        /// is checked separately to be the one a new engine starts with.</para>
        /// </summary>
        [Fact]
        public async Task ARecordingThatOutgrowsItsBudgetKeepsTheNewestSpanAndStatesTheDrop()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.LinkTopic, Timeout);

                Tick(engine, Snap(0.0, connected: true, delay: 0.0));
                Tick(engine, Snap(1.0, connected: true, delay: 0.0, onboard: 1.0));

                // What one held sample costs, read off the first two, so the
                // budget below is a count of samples whatever the sample weighs.
                Tick(engine, Snap(2.0, connected: false, delay: 0.0, onboard: 2.0));
                Tick(engine, Snap(3.0, connected: false, delay: 0.0, onboard: 3.0));
                var perSample = engine.RecordedBytes / 2;
                Assert.True(perSample > 0);
                var capacity = 1000;
                engine.SetRecorderBudgetForTests(perSample * capacity);

                var lastOutageUt = 3.0 + capacity + 50;
                for (var ut = 4.0; ut <= lastOutageUt; ut += 1.0)
                {
                    Tick(engine, Snap(ut, connected: false, delay: 0.0, onboard: ut));
                }
                Assert.True(engine.RecordedBytes <= perSample * capacity);

                var reacquiredAt = lastOutageUt + 1.0;
                Tick(engine, Snap(reacquiredAt, connected: true, delay: 0.0, onboard: reacquiredAt));

                var dump = On(await DrainAllStreamDataAsync(client, Quiet), BlackoutRecorderTestUplink.OnboardTopic)
                    .Where(f => f.Meta.Staleness == Staleness.Recorded)
                    .OrderBy(f => f.Meta.ValidAt)
                    .ToList();

                // The newest span survives whole and the oldest went.
                Assert.InRange(dump.Count, capacity - capacity / 50, capacity);
                Assert.Equal(lastOutageUt, dump.Max(Value));
                Assert.Equal(dump.Count, dump.Select(Value).Distinct().Count());
                Assert.Equal(dump.Max(Value) - dump.Min(Value) + 1, dump.Count);
                Assert.True(dump.Min(Value) > 2.0);

                // The drop is STATED, on the first sample of the dump, running
                // back to UT 1: the last sample the ground actually received.
                Assert.Equal(1.0, dump[0].Meta.GapSinceUt);
                Assert.All(dump.Skip(1), f => Assert.Null(f.Meta.GapSinceUt));
                Assert.Equal(0, engine.RecordedBytes);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A new engine starts with the production budget and not a test's.
        /// </summary>
        [Fact]
        public void ANewEngineHoldsTheProductionBudget()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Start();
            try
            {
                Assert.Equal(ChannelEngine.RecorderBudgetBytes, engine.RecorderBudgetBytesNow);
                Assert.True(ChannelEngine.RecorderBudgetBytes >= 256L << 20);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A recording longer than one burst is released over several ticks, oldest
        /// first and in order, each tick carrying no more than the release's
        /// allowance, and none of it is dropped: the whole outage arrives, with no
        /// gap stated.
        /// </summary>
        [Fact]
        public async Task ALongRecordingIsReleasedInLumpsOldestFirstAndLosesNothing()
        {
            var wall = 0.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SetReleaseClockForTests(() => wall);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.LinkTopic, Timeout);

                Tick(engine, Snap(0.0, connected: true, delay: 0.0));
                Tick(engine, Snap(1.0, connected: true, delay: 0.0, onboard: 1.0));
                await DrainAllStreamDataAsync(client, Quiet);

                var outage = ChannelEngine.ReleaseSamplesPerSecond * 5 / 2;
                for (var ut = 2.0; ut < 2.0 + outage; ut += 1.0)
                {
                    Tick(engine, Snap(ut, connected: false, delay: 0.0, onboard: ut));
                }
                var reacquiredAt = 2.0 + outage;

                var lumps = new List<List<StreamData>>();
                Tick(engine, Snap(reacquiredAt, connected: true, delay: 0.0, onboard: reacquiredAt));
                lumps.Add(Recorded(await DrainAllStreamDataAsync(client, Quiet)));
                for (var i = 1; i <= 4; i++)
                {
                    wall += 1.0;
                    Tick(engine, Snap(reacquiredAt + i, connected: true, delay: 0.0, onboard: reacquiredAt + i));
                    lumps.Add(Recorded(await DrainAllStreamDataAsync(client, Quiet)));
                }

                // More than one lump, none over the allowance (plus the one sample
                // that may overdraw it).
                Assert.True(lumps.Count(l => l.Count > 0) >= 2);
                Assert.All(lumps, l => Assert.True(l.Count <= ChannelEngine.ReleaseSamplesPerSecond + 1, "lump of " + l.Count));

                // Every sample of the outage arrived, once, in UT order across
                // the lumps, and the first lump's first sample is the oldest.
                var all = lumps.SelectMany(l => l).ToList();
                Assert.Equal(outage, all.Count);
                Assert.Equal(all.OrderBy(f => f.Meta.ValidAt).Select(Value), all.Select(Value));
                Assert.Equal(2.0, Value(all[0]));
                Assert.Equal(reacquiredAt - 1.0, Value(all[all.Count - 1]));
                Assert.All(all, f => Assert.Null(f.Meta.GapSinceUt));
                Assert.Equal(0, engine.RecordedBytes);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A link lost again part way through a release stops it where it is: what
        /// was not yet sent stays held, ahead of what the new outage records, and
        /// the next reacquisition sends all of it in order.
        /// </summary>
        [Fact]
        public async Task AReleaseCutShortByAnotherOutageResumesInOrderAtTheNextReacquisition()
        {
            var wall = 0.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SetReleaseClockForTests(() => wall);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.LinkTopic, Timeout);

                Tick(engine, Snap(0.0, connected: true, delay: 0.0));
                Tick(engine, Snap(1.0, connected: true, delay: 0.0, onboard: 1.0));

                var outage = ChannelEngine.ReleaseSamplesPerSecond * 3 / 2;
                var ut = 2.0;
                for (var i = 0; i < outage; i++, ut += 1.0)
                {
                    Tick(engine, Snap(ut, connected: false, delay: 0.0, onboard: ut));
                }

                // Back for one tick: the first burst goes. Down again at once.
                Tick(engine, Snap(ut, connected: true, delay: 0.0, onboard: ut));
                ut += 1.0;
                var first = Recorded(await DrainAllStreamDataAsync(client, Quiet));
                Assert.InRange(first.Count, 1, outage - 1);
                Assert.True(engine.RecordedBytes > 0);

                Tick(engine, Snap(ut, connected: false, delay: 0.0, onboard: ut));
                ut += 1.0;
                Assert.Empty(Recorded(await DrainAllStreamDataAsync(client, Quiet)));

                // Back for good, and the wall clock runs.
                for (var i = 0; i < 6; i++)
                {
                    wall += 1.0;
                    Tick(engine, Snap(ut, connected: true, delay: 0.0, onboard: ut));
                    ut += 1.0;
                }
                var rest = Recorded(await DrainAllStreamDataAsync(client, Quiet));

                var all = first.Concat(rest).ToList();
                Assert.Equal(all.OrderBy(f => f.Meta.ValidAt).Select(Value), all.Select(Value));
                Assert.Equal(all.Count, all.Select(Value).Distinct().Count());
                Assert.Equal(outage + 1, all.Count);
                Assert.Equal(0, engine.RecordedBytes);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static List<StreamData> Recorded(IEnumerable<StreamData> frames) =>
            On(frames, BlackoutRecorderTestUplink.OnboardTopic).Where(f => f.Meta.Staleness == Staleness.Recorded).ToList();

        /// <summary>
        /// A subscriber that joins DURING the outage is served the last sample
        /// that got out before it, honestly labelled
        /// <see cref="Staleness.LastBeforeBlackout"/> rather than
        /// <see cref="Staleness.Fresh"/>.
        ///
        /// <para>The <c>MarkLinkDown</c>/<c>MarkLinkUp</c> seam and that enum
        /// member both shipped in M2 and had no production caller for a year: the
        /// blackout authority is the only thing that ever knew enough to drive
        /// them, and it was busy deleting the evidence instead. Reconnecting mid-
        /// outage is the case that used to read "live".</para>
        /// </summary>
        [Fact]
        public async Task ASubscriberJoiningDuringTheOutageIsToldTheSampleIsFromBeforeIt()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(first, BlackoutRecorderTestUplink.OnboardTopic, Timeout);
                await SubscribeAsync(first, BlackoutRecorderTestUplink.LinkTopic, Timeout);

                Tick(engine, Snap(0.0, connected: true, delay: 0.0));
                Tick(engine, Snap(1.0, connected: true, delay: 0.0, onboard: 1.0));
                await DrainAllStreamDataAsync(first, Quiet);

                // Out of contact from UT 2.
                Tick(engine, Snap(2.0, connected: false, delay: 0.0, onboard: 2.0));

                // A second operator opens a dashboard mid-outage.
                //
                // The subscribe frame is sent by hand rather than through
                // SubscribeAsync: that helper waits for the EventMsg ack via
                // ReceiveTypedAsync, which DISCARDS every non-matching message
                // it reads on the way, and the catch-up this test is about is
                // delivered synchronously inside the subscribe and so arrives
                // among them. Draining everything is what lets it be seen.
                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await late.SendAsync(EnvelopeCodec.WriteSubscribe(
                    new Subscribe { Topic = BlackoutRecorderTestUplink.OnboardTopic }));
                var catchUp = On(await DrainAllStreamDataAsync(late, Quiet), BlackoutRecorderTestUplink.OnboardTopic);

                var served = catchUp.Single();
                Assert.Equal(1.0, Value(served));
                Assert.Equal(Staleness.LastBeforeBlackout, served.Meta.Staleness);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The link-down mark reaches a vantage that did not exist at loss of
        /// signal: the ONLY subscriber here connects mid-outage.
        ///
        /// <para>The catch-up is served inside the subscribe, before any later
        /// tick, so a mark that only reached the vantages subscribed when it was
        /// applied would leave this one reading Fresh. This is the ordinary case:
        /// an operator opens a dashboard while a craft is behind the Mun and
        /// nobody else is watching.</para>
        /// </summary>
        [Fact]
        public async Task AVantageThatFirstAppearsMidOutageIsStillToldTheLinkIsDown()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                // A first client establishes the subscription so the channel
                // loop runs and UT 1's sample is archived, then LEAVES before
                // the outage. Its vantage is the only one the edge could have
                // marked, and it is gone.
                await using (var seed = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeAsync(seed, BlackoutRecorderTestUplink.OnboardTopic, Timeout);
                    await SubscribeAsync(seed, BlackoutRecorderTestUplink.LinkTopic, Timeout);
                    Tick(engine, Snap(0.0, connected: true, delay: 0.0));
                    Tick(engine, Snap(1.0, connected: true, delay: 0.0, onboard: 1.0));
                    await DrainAllStreamDataAsync(seed, Quiet);
                }

                // The seed's departure is processed on the engine's own queue.
                // Ticking before it lands marks the departing vantage, which the
                // late client shares, and the catch-up then reads as down for a
                // reason this test is not about.
                await WaitUntilUnsubscribedAsync(engine, BlackoutRecorderTestUplink.OnboardTopic);

                // Out of contact from UT 2, with nobody watching.
                Tick(engine, Snap(2.0, connected: false, delay: 0.0, onboard: 2.0));
                Tick(engine, Snap(3.0, connected: false, delay: 0.0, onboard: 3.0));

                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await late.SendAsync(EnvelopeCodec.WriteSubscribe(
                    new Subscribe { Topic = BlackoutRecorderTestUplink.OnboardTopic }));
                var catchUp = On(await DrainAllStreamDataAsync(late, Quiet), BlackoutRecorderTestUplink.OnboardTopic);

                var served = catchUp.Single();
                Assert.Equal(1.0, Value(served));
                Assert.Equal(Staleness.LastBeforeBlackout, served.Meta.Staleness);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The pre-outage in-flight tail is NOT the recording and must not be
        /// relabelled as one: a sample captured while the link was up rides its
        /// own light-time through the outage and arrives
        /// <see cref="Staleness.Fresh"/>, at <c>validAt + delay</c>.
        ///
        /// <para>That behaviour predates the recorder ("the last delaySeconds of
        /// pre-outage telemetry arrives, THEN freezes") and the recorder is
        /// bolted onto the same buffer, so this is the regression that catches a
        /// replay sweeping up entries it does not own.</para>
        /// </summary>
        [Fact]
        public async Task ThePreOutageTailStillArrivesOnItsOwnLightTimeAsFresh()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BlackoutRecorderTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.OnboardTopic, Timeout);
                await SubscribeAsync(client, BlackoutRecorderTestUplink.LinkTopic, Timeout);

                // Captured at UT 1 with a 4s light-time: due at UT 5, which is
                // inside the outage that starts at UT 2.
                Tick(engine, Snap(0.0, connected: true, delay: 4.0));
                Tick(engine, Snap(1.0, connected: true, delay: 4.0, onboard: 1.0));
                foreach (var ut in new[] { 2.0, 3.0, 4.0, 5.0 })
                {
                    Tick(engine, Snap(ut, connected: false, delay: 0.0, onboard: 99.0));
                }

                var frames = On(await DrainAllStreamDataAsync(client, Quiet), BlackoutRecorderTestUplink.OnboardTopic);
                var tail = frames.Single(f => Value(f) == 1.0);
                Assert.Equal(1.0, tail.Meta.ValidAt);
                Assert.Equal(Staleness.Fresh, tail.Meta.Staleness);
                Assert.Null(tail.Meta.GapSinceUt);

                // ...and the in-blackout sample is still withheld at this point.
                Assert.DoesNotContain(frames, f => Value(f) == 99.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Returns once no client subscribes to <paramref name="topic"/>. The
        /// engine drops a topic from its subscribed set inside the same queued job
        /// that unsubscribes the Courier, so a tick enqueued after this returns
        /// runs against a Courier with no subscriber on it.
        /// </summary>
        private static async Task WaitUntilUnsubscribedAsync(ChannelEngine engine, string topic)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (engine.IsAnyTopicSubscribed(topic))
            {
                if (DateTime.UtcNow > deadline)
                {
                    throw new TimeoutException($"'{topic}' was still subscribed after {Timeout}");
                }
                await Task.Delay(10);
            }
        }

        private static void Tick(ChannelEngine engine, KspSnapshot snapshot) =>
            engine.TickAndWait(snapshot.Ut, snapshot, Timeout);

        private static KspSnapshot Snap(
            double ut,
            bool? connected = null,
            double? delay = null,
            double? onboard = null,
            double? session = null) =>
            BlackoutRecorderTestUplink.Snapshot(ut, connected, delay, onboard, session);
    }
}
