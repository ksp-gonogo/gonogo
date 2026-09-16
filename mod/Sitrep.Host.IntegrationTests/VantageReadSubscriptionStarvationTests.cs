using System;
using System.Threading.Tasks;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A vantage read answers only for a topic somebody is SUBSCRIBED to, and
    /// that is a property of the archive rather than of the read.
    ///
    /// <para>Both paths that feed the archive check the subscription first: the
    /// channel loop skips a source nothing is subscribed to, and
    /// <c>ProcessPublish</c> drops a publisher's frame the same way. So
    /// <see cref="ChannelEngine.ReadTopicAtVantage"/> over a quiet topic is not
    /// "the light has not arrived yet", it is "nothing was ever recorded", and
    /// the two are indistinguishable to a caller.</para>
    ///
    /// <para>This is why the SCET alarm arm reads a threshold off the tick's own
    /// snapshot instead of off the archive: an alarm evaluated through a vantage
    /// read would fire or not depending on which widgets the operator happened to
    /// have open. Anything that moves an alarm onto the vantage read has to carry
    /// its own subscription or keep reading the snapshot; these two tests are
    /// what makes the difference visible rather than discovered in flight.</para>
    /// </summary>
    public class VantageReadSubscriptionStarvationTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        /// <summary>The same command vantage the instant-class tests read from.</summary>
        private const string CommandVantage = "ground:Kerbal Space Center";

        /// <summary>
        /// Zero delay, an instant-class topic, a client connected and a tick
        /// taken: every reason a read could be empty is excluded except the one
        /// being shown. Nobody subscribed, so nothing was recorded, so the read
        /// is blind.
        /// </summary>
        [Fact]
        public async Task AnUnsubscribedTopicIsInvisibleToAVantageReadAtZeroDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

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
        /// The control, so the test above cannot pass for some other reason: the
        /// identical tick, read at the identical vantage and instant, answers 42
        /// once one client is subscribed.
        /// </summary>
        [Fact]
        public async Task TheSameTopicAnswersOnceSomethingIsSubscribed()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.TrueNowTopic, Timeout);

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
    }
}
