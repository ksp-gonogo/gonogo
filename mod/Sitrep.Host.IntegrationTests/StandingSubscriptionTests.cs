using System;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A standing subscription is the host saying it needs a topic recorded
    /// when no client has asked for it. The setup here is
    /// <see cref="VantageReadSubscriptionStarvationTests"/>'s exactly: zero
    /// delay, an instant-class topic, a client connected, a tick taken. The one
    /// difference is who is subscribed, so what these cases measure is the
    /// standing subscription and nothing else.
    /// </summary>
    public class StandingSubscriptionTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        /// <summary>The same command vantage the instant-class tests read from.</summary>
        private const string CommandVantage = "ground:Kerbal Space Center";

        private const string Holder = "alarm-roster";

        /// <summary>
        /// The defect this concept exists for: nobody subscribed, so nothing
        /// recorded, so the read was blind. A standing subscription is enough
        /// on its own to fill the archive.
        /// </summary>
        [Fact]
        public async Task AStandingSubscriptionRecordsATopicNoClientAskedFor()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                engine.OpenStandingSubscription(FreezeGateTestUplink.TrueNowTopic, Holder);

                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 0.0, trueNow: 42.0),
                    Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                Assert.Equal(
                    42.0,
                    Convert.ToDouble(
                        engine.ReadTopicAtVantage(FreezeGateTestUplink.TrueNowTopic, CommandVantage, 0.0)));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The topic is held for every consumer, not for the holder: a client
        /// that subscribes only after the tick catches up on what the standing
        /// subscription kept. Nothing ticks once it is subscribed, so the frame
        /// it receives can only have come out of the archive.
        /// </summary>
        [Fact]
        public async Task AClientSubscribingLaterCatchesUpOnWhatTheHolderKept()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                engine.OpenStandingSubscription(FreezeGateTestUplink.TrueNowTopic, Holder);

                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 0.0, trueNow: 42.0),
                    Timeout);

                // Sent raw rather than through SubscribeAsync, which waits for
                // the ack and drops every frame it passes on the way: the
                // catch-up is handed over inside the subscribe itself and can
                // reach the wire ahead of its own ack.
                await client.SendAsync(EnvelopeCodec.WriteSubscribe(
                    new Subscribe { Topic = FreezeGateTestUplink.TrueNowTopic }));
                var frames = await DrainAllStreamDataAsync(client, Quiet);

                var caught = frames.Single(f => f.Topic == FreezeGateTestUplink.TrueNowTopic);
                Assert.Equal(42.0, Convert.ToDouble(caught.Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The holder and the clients are separate reasons to record, and
        /// either one is enough: the client's unsubscribe takes the count to
        /// the holder's one rather than to zero.
        /// </summary>
        [Fact]
        public async Task AClientUnsubscribeLeavesTheHolderHolding()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                engine.OpenStandingSubscription(FreezeGateTestUplink.TrueNowTopic, Holder);
                await SubscribeAsync(client, FreezeGateTestUplink.TrueNowTopic, Timeout);

                await client.SendAsync(EnvelopeCodec.WriteUnsubscribe(
                    new Unsubscribe { Topic = FreezeGateTestUplink.TrueNowTopic }));
                await DrainAllStreamDataAsync(client, Quiet);

                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 0.0, trueNow: 42.0),
                    Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                Assert.Equal(
                    42.0,
                    Convert.ToDouble(
                        engine.ReadTopicAtVantage(FreezeGateTestUplink.TrueNowTopic, CommandVantage, 0.0)));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Released, the topic goes back to being recorded by nobody. An open
        /// and close that left one subscriber behind would read 42 here, which
        /// is what a leak looks like from the outside.
        /// </summary>
        [Fact]
        public async Task AReleasedStandingSubscriptionStopsRecording()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                engine.OpenStandingSubscription(FreezeGateTestUplink.TrueNowTopic, Holder);
                engine.CloseStandingSubscription(FreezeGateTestUplink.TrueNowTopic, Holder);

                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 0.0, trueNow: 42.0),
                    Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                Assert.Null(engine.ReadTopicAtVantage(FreezeGateTestUplink.TrueNowTopic, CommandVantage, 0.0));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A holder whose whole reason goes away releases in one call, without
        /// having kept the list of topics itself. Opened twice and released
        /// once, because a repeated open must not strand a subscriber the
        /// release cannot reach.
        /// </summary>
        [Fact]
        public async Task ReleasingAHolderDropsEveryTopicItHeld()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                engine.OpenStandingSubscription(FreezeGateTestUplink.TrueNowTopic, Holder);
                engine.OpenStandingSubscription(FreezeGateTestUplink.TrueNowTopic, Holder);
                engine.OpenStandingSubscription(FreezeGateTestUplink.DelayedTopic, Holder);
                engine.CloseStandingSubscriptions(Holder);

                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 0.0, trueNow: 42.0),
                    Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                Assert.Null(engine.ReadTopicAtVantage(FreezeGateTestUplink.TrueNowTopic, CommandVantage, 0.0));
                Assert.False(engine.IsAnyTopicSubscribed(FreezeGateTestUplink.DelayedTopic));
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
