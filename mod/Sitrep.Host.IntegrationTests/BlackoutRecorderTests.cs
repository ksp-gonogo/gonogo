using System;
using System.Collections.Generic;
using System.Linq;
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
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

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
        /// The recorder's storage bound: a recording longer than
        /// <see cref="ChannelEngine.RecorderCapacityPerTopic"/> keeps the span
        /// ADJACENT to reacquisition, drops the oldest, and states what it
        /// dropped rather than presenting a truncated recording as a whole one.
        ///
        /// <para>Runs against a capacity-sized outage rather than a shrunken test
        /// constant, because the constant is what production runs with and a
        /// test-only capacity would prove the arithmetic and not the policy.</para>
        /// </summary>
        [Fact]
        public async Task ARecordingThatOverrunsItsBoundKeepsTheNewestSpanAndStatesTheDrop()
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

                // One sample per UT second of outage, three more than the
                // recorder holds.
                var overrun = 3;
                var firstOutageUt = 2.0;
                var lastOutageUt = firstOutageUt + ChannelEngine.RecorderCapacityPerTopic + overrun - 1;
                for (var ut = firstOutageUt; ut <= lastOutageUt; ut += 1.0)
                {
                    Tick(engine, Snap(ut, connected: false, delay: 0.0, onboard: ut));
                }

                var reacquiredAt = lastOutageUt + 1.0;
                Tick(engine, Snap(reacquiredAt, connected: true, delay: 0.0, onboard: reacquiredAt));

                var dump = On(await DrainAllStreamDataAsync(client, Quiet), BlackoutRecorderTestUplink.OnboardTopic)
                    .Where(f => f.Meta.Staleness == Staleness.Recorded)
                    .ToList();

                Assert.Equal(ChannelEngine.RecorderCapacityPerTopic, dump.Count);

                // The oldest `overrun` samples went, not the newest: the span
                // that still describes a live craft survives.
                Assert.DoesNotContain(dump, f => Value(f) < firstOutageUt + overrun);
                Assert.Equal(firstOutageUt + overrun, dump.Min(Value));
                Assert.Equal(lastOutageUt, dump.Max(Value));

                // The drop is STATED, on the first sample of the dump, running
                // back to UT 1: the last sample the ground actually received.
                var first = dump.OrderBy(f => f.Meta.ValidAt).First();
                Assert.Equal(1.0, first.Meta.GapSinceUt);
                Assert.All(dump.Skip(1), f => Assert.Null(f.Meta.GapSinceUt));
            }
            finally
            {
                engine.Stop();
            }
        }

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
        /// <para>The Courier records the mark per (node, vantage) over whatever
        /// is subscribed when it is told, so marking on the disconnect EDGE
        /// alone covers only the vantages already watching. This is the case
        /// that distinguishes it, and it is the ordinary one: an operator opens
        /// a dashboard while a craft is behind the Mun. The mark is re-applied
        /// on every disconnected tick, always at the original loss-of-signal
        /// instant.</para>
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
