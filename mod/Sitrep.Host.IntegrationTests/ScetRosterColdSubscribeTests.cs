using System;
using System.Collections;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A roster channel has to be able to say it is EMPTY, and the client that
    /// needs to hear it is the one that has never heard anything.
    ///
    /// <para><b>The defect, measured on the deck 2026-09-12.</b> Subscribing to
    /// <c>alarm.scet</c> returned the subscribed event and then nothing at all,
    /// for twenty-seven seconds and for twelve thousand UT of warp, well past the
    /// channel's own keyframe interval. A successful arm produced no frame
    /// either. The client's reconciler waits for a roster before it arms
    /// anything, so a cold client armed nothing: the one state that had to reach
    /// it, "there are no alarms", was the only state that never did.</para>
    ///
    /// <para><b>Why the keyframe cadence could not save it.</b> A keyframe is
    /// decided inside the emitter, and the emitter is only consulted when
    /// something is published. A publisher-backed channel that publishes only on
    /// CHANGE therefore has no cadence at all until its first change: there is
    /// nothing for keyframe-on-subscribe or the Courier's catch-up to replay,
    /// because nothing was ever recorded. The first case below pins that, because
    /// it is the half that reads like it should have worked.</para>
    ///
    /// <para><b>Two ticks per publish, throughout.</b> A sampled source's handle
    /// runs on the Courier after the tick's reveal flush, so the frame it
    /// publishes reaches the wire on the NEXT clock advance. That is the harness,
    /// not the feature: a test that ticks once and waits sees silence for a
    /// perfectly healthy channel.</para>
    /// </summary>
    public class ScetRosterColdSubscribeTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(300);

        /// <summary>
        /// The mechanism, against the real engine: a publish made while nothing
        /// is subscribed is DROPPED, not held, so a later subscriber is not
        /// caught up to it. A "publish the empty roster once at registration" fix
        /// lands entirely inside this hole, which is why the uplink asks whether
        /// anyone is listening instead of counting its own publishes.
        ///
        /// <para>The second half is what stops this passing vacuously: the same
        /// uplink is allowed one more publish, and that one arrives. The silence
        /// above was the drop, not a channel that never worked.</para>
        /// </summary>
        [Fact]
        public async Task APublishMadeWithNobodySubscribedIsNotReplayedToTheFirstSubscriber()
        {
            var uplink = new PublishOnceTestUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                // The uplink's one and only publish, with no client connected.
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, PublishOnceTestUplink.Topic, Timeout);
                engine.TickAndWait(3.0, new KspSnapshot { Ut = 3.0 }, Timeout);
                engine.TickAndWait(4.0, new KspSnapshot { Ut = 4.0 }, Timeout);

                await client.AssertNoMessageArrivesAsync(Quiet);

                uplink.PublishAgain();
                engine.TickAndWait(5.0, new KspSnapshot { Ut = 5.0 }, Timeout);
                engine.TickAndWait(6.0, new KspSnapshot { Ut = 6.0 }, Timeout);

                var frame = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(PublishOnceTestUplink.Topic, frame.Topic);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The fix, stated as the operator sees it: subscribe to an empty roster
        /// and be told it is empty, without anything having to change first.
        /// </summary>
        [Fact]
        public async Task AColdSubscriberIsToldTheRosterIsEmpty()
        {
            var uplink = new ScetRosterTestUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                // Ticks before anyone is watching, exactly as the game does while
                // the operator is still opening a browser.
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ScetRosterTestUplink.Topic, Timeout);
                engine.TickAndWait(3.0, new KspSnapshot { Ut = 3.0 }, Timeout);
                engine.TickAndWait(4.0, new KspSnapshot { Ut = 4.0 }, Timeout);

                var frame = await ReceiveStreamDataAsync(client, Timeout);

                Assert.Equal(ScetRosterTestUplink.Topic, frame.Topic);
                Assert.Empty(Assert.IsAssignableFrom<IEnumerable>(frame.Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The other half of the deck report: an arm that returned success
        /// produced no roster frame either. An arm is a change to the roster, so
        /// the tick after it must carry one.
        /// </summary>
        [Fact]
        public async Task ArmingAfterTheColdFrameSendsTheRosterAgain()
        {
            var uplink = new ScetRosterTestUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ScetRosterTestUplink.Topic, Timeout);
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);

                var empty = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Empty(Assert.IsAssignableFrom<IEnumerable>(empty.Payload));

                uplink.Arm("alarm-1");
                engine.TickAndWait(3.0, new KspSnapshot { Ut = 3.0 }, Timeout);
                engine.TickAndWait(4.0, new KspSnapshot { Ut = 4.0 }, Timeout);

                var armed = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Single(Assert.IsAssignableFrom<IEnumerable>(armed.Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// And it stays quiet once the audience has its answer: the roster is
        /// republished on a change, not on every tick. A list payload is compared
        /// by reference by the emitter's change gate, so an unconditional publish
        /// would emit one frame per tick forever on a channel that coalesces
        /// nothing.
        /// </summary>
        [Fact]
        public async Task AnAnsweredSubscriberIsNotSentTheSameRosterEveryTick()
        {
            var uplink = new ScetRosterTestUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ScetRosterTestUplink.Topic, Timeout);
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);
                await ReceiveStreamDataAsync(client, Timeout);

                engine.TickAndWait(3.0, new KspSnapshot { Ut = 3.0 }, Timeout);
                engine.TickAndWait(4.0, new KspSnapshot { Ut = 4.0 }, Timeout);
                engine.TickAndWait(5.0, new KspSnapshot { Ut = 5.0 }, Timeout);

                await client.AssertNoMessageArrivesAsync(Quiet);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
