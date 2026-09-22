using System;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A topic is worth the same at one instant however it is asked for.
    ///
    /// <para>Two paths reach the same archive: a SUBSCRIBER is routed onto
    /// <see cref="ChannelEngine.MetaVantage"/> when its topic is instant-class
    /// (<c>TrueNow</c>, or freeze-exempt), and a READ
    /// (<see cref="ChannelEngine.ReadTopicAtVantage"/>, which is what a
    /// command-vantage alarm evaluates against) names a vantage of its own. The
    /// read used to take the whole-network light-time on every topic, so an
    /// instant-class topic answered a light-time late at a command vantage while
    /// the subscriber already had it. Same topic, same instant, two answers.</para>
    ///
    /// <para>These tests are deliberately about that ASYMMETRY and not about the
    /// routing that fixes it: what an operator's alarm compares is the value, and
    /// it has to be the value the dashboard beside them is showing.</para>
    /// </summary>
    public class VantageReadInstantClassTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        /// <summary>
        /// The vantage a command centre observes from. Any id with no explicit
        /// (vantage, node) delay pair and no node-default serves, so
        /// <c>StubNetwork.DelayTo</c> falls through to the whole-network default,
        /// which is exactly the tier <c>CaptureSignalDelay</c> drives from the
        /// active vessel's signal delay. That fall-through IS the defect.
        /// </summary>
        private const string CommandVantage = "ground:Kerbal Space Center";

        [Fact]
        public async Task TrueNowTopicReadsTheSameAtACommandVantageAsASubscriberSees()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.TrueNowTopic, Timeout);

                // Connected on a 240s link: the whole-network default delay is
                // now 240, and the TrueNow topic is exempt from it.
                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 240.0, trueNow: 42.0),
                    Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var seen = frames.Single(f => f.Topic == FreezeGateTestUplink.TrueNowTopic);
                Assert.Equal(42.0, Convert.ToDouble(seen.Payload));

                // Asked from the test thread, which is safe only because the
                // Courier thread is parked on an empty job queue by now:
                // TickAndWait has returned and the drain above waited out the
                // quiet period. Production asks this from the Courier thread.
                var read = engine.ReadTopicAtVantage(FreezeGateTestUplink.TrueNowTopic, CommandVantage, 0.0);
                Assert.Equal(42.0, Convert.ToDouble(read));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The freeze-exempt half of the same class. A freeze-exempt topic
        /// carries its own horizon in the reveal gate (comms.link reveals at the
        /// last-known link delay), so the ledger must not delay it a second
        /// time: that is why the subscribe path routes it onto the meta vantage,
        /// and a read has to inherit the same promise.
        ///
        /// <para>First tick with a link: the gate's horizon for comms.link is the
        /// last-CONNECTED delay, still 0 here, so the sample reveals live while
        /// the whole-network default is already 240. Delayed twice it would not
        /// have arrived at the command vantage for four minutes.</para>
        ///
        /// <para>Uses <see cref="ConnectivityHorizonTestUplink"/> rather than the
        /// <see cref="FreezeGateTestUplink"/> the other two use, for the reason
        /// that fixture's own doc comment gives: FreezeGateTestUplink registers
        /// comms.delay twice, so CaptureSignalDelay runs twice per tick and the
        /// second pass writes the INCOMING delay into the last-connected
        /// snapshot. That pushes comms.link's own horizon out to 240 and the
        /// sample never reveals at all, which is a property of the fixture and
        /// not of the exemption being tested here.</para>
        /// </summary>
        [Fact]
        public async Task FreezeExemptTopicReadsTheSameAtACommandVantageAsASubscriberSees()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ConnectivityHorizonTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ConnectivityHorizonTestUplink.LinkTopic, Timeout);

                engine.TickAndWait(
                    0.0,
                    ConnectivityHorizonTestUplink.Snapshot(0.0, connected: true, delay: 240.0),
                    Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(frames, f => f.Topic == ConnectivityHorizonTestUplink.LinkTopic);

                var read = engine.ReadTopicAtVantage(ConnectivityHorizonTestUplink.LinkTopic, CommandVantage, 0.0);
                var link = Assert.IsType<CommsLink>(read);
                Assert.True(link.Connected);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The control, and the reason this cannot be fixed by dropping the
        /// delay from the read: an ORDINARY Delayed topic must still be a
        /// light-time old at a command vantage. Nothing has reached it yet at
        /// UT 0 on a 240s link.
        /// </summary>
        [Fact]
        public async Task OrdinaryDelayedTopicIsStillLightTimeLateAtACommandVantage()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.DelayedTopic, Timeout);

                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: 240.0, delayed: 100.0),
                    Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                Assert.Null(engine.ReadTopicAtVantage(FreezeGateTestUplink.DelayedTopic, CommandVantage, 0.0));

                // ...and it is there once the light has had time to arrive.
                Assert.Equal(
                    100.0,
                    Convert.ToDouble(
                        engine.ReadTopicAtVantage(FreezeGateTestUplink.DelayedTopic, CommandVantage, 240.0)));
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
