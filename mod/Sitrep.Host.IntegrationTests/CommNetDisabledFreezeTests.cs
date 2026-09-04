using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The CommNet-off inversion, through the REAL reveal gate.
    ///
    /// <para><b>The defect.</b> With the stock CommNet difficulty option off,
    /// <c>CommNetScenario.OnAwake</c> destroys itself, so no network is built,
    /// no vessel's <c>IsConnected</c> is ever assigned and every
    /// <c>ControlPath</c> stays empty for the whole session. gonogo read that
    /// literally: <c>ChannelEngine.RevealDelayFor</c> returns
    /// <c>+Infinity</c> for any subject whose connectivity source says false,
    /// and it does so REGARDLESS of the delay magnitude (its own comment says
    /// so: "this fires even when _signalDelaySeconds is 0"). So every Delayed
    /// channel froze at last-known for the whole session, which is INFINITE
    /// delay on a save that is supposed to have none at all.</para>
    ///
    /// <para><b>What is real here and what stands in.</b> The engine, the
    /// reveal gate, the election, <see cref="SignalDelay"/> and
    /// <see cref="CommsModelPolicy"/> are the shipped code. The backend is a
    /// stand-in, because the real one reads <c>FlightGlobals</c>: what it
    /// reports is what stock's object graph reports on such a save, which is
    /// verified separately in <c>Gonogo.KSP.Tests.Comms</c> (including an IL
    /// walk of stock's own <c>CommNetScenario.CommNetEnabled</c>). The live
    /// difficulty read is the one link in the chain no headless process can
    /// take: <c>HighLogic.CurrentGame</c> is a property over a MonoBehaviour
    /// singleton whose setter no-ops without a scene.</para>
    /// </summary>
    public class CommNetDisabledFreezeTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        private static ChannelEngine EngineWith(CommNetDisabledTestUplink uplink)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(uplink, ContractVersion.Major, ContractVersion.Minor),
            });
            engine.ResolveCapabilities();
            return engine;
        }

        /// <summary>
        /// The control, and the behaviour that must not regress: on a save that
        /// DOES model comms, a craft with no path home freezes its Delayed
        /// telemetry. That is a real blackout and freezing is correct.
        /// </summary>
        [Fact]
        public async Task WithACommsModel_ADeadLinkStillFreezesDelayedTelemetry()
        {
            using var engine = EngineWith(new CommNetDisabledTestUplink(modelPresent: true));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.CommsDelayTopic, Timeout);
                await SubscribeAsync(client, CommNetDisabledTestUplink.DelayedTopic, Timeout);

                TickThrough(engine);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.DoesNotContain(frames, f => f.Topic == CommNetDisabledTestUplink.DelayedTopic);
                // And the delay says nothing measurable, which is the honest
                // report of a link that is down.
                var delay = Assert.IsType<Dictionary<string, object?>>(
                    Assert.Contains(ChannelEngine.CommsDelayTopic, Latest(frames)));
                Assert.Null(delay["oneWaySeconds"]);
                Assert.Equal((double)(int)CommsDelaySource.None, Convert.ToDouble(delay["source"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The fix. The SAME dead graph, on a save with no comms model, must
        /// deliver Delayed telemetry live: nothing is between the craft and the
        /// operator, so nothing may be withheld.
        /// </summary>
        [Fact]
        public async Task WithNoCommsModel_DelayedTelemetryFlowsLiveOverTheSameDeadGraph()
        {
            using var engine = EngineWith(new CommNetDisabledTestUplink(modelPresent: false));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CommNetDisabledTestUplink.DelayedTopic, Timeout);

                TickThrough(engine);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(frames, f => f.Topic == CommNetDisabledTestUplink.DelayedTopic);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The wire discriminator. A CommNet-off save and a permanent blackout
        /// both show no path and no relay graph, and an operator has to be able
        /// to tell them apart; <c>comms.delay</c> is true-now, so it says which
        /// one this is even while a blackout would be freezing everything else.
        /// </summary>
        [Fact]
        public async Task WithNoCommsModel_TheWireSaysKnownZeroRatherThanNothingMeasurable()
        {
            using var engine = EngineWith(new CommNetDisabledTestUplink(modelPresent: false));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.CommsDelayTopic, Timeout);
                await SubscribeAsync(client, ChannelEngine.ConnectivityMetaTopic, Timeout);

                TickThrough(engine);

                var latest = Latest(await DrainAllStreamDataAsync(client, Quiet));

                var delay = Assert.IsType<Dictionary<string, object?>>(
                    Assert.Contains(ChannelEngine.CommsDelayTopic, latest));
                Assert.Equal(0.0, Convert.ToDouble(delay["oneWaySeconds"]));
                Assert.Equal((double)(int)CommsDelaySource.NoCommsModel, Convert.ToDouble(delay["source"]));

                var link = Assert.IsType<Dictionary<string, object?>>(
                    Assert.Contains(ChannelEngine.ConnectivityMetaTopic, latest));
                Assert.True(Convert.ToBoolean(link["connected"]));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>Six ticks of live telemetry, so a frozen channel is visibly a channel with something to say.</summary>
        private static void TickThrough(ChannelEngine engine)
        {
            for (var ut = 0.0; ut <= 5.0; ut += 1.0)
            {
                engine.TickAndWait(ut, CommNetDisabledTestUplink.Snapshot(ut), Timeout);
            }
        }

        /// <summary>The last payload delivered on each topic.</summary>
        private static Dictionary<string, object?> Latest(IEnumerable<StreamData<object?>> frames)
        {
            var latest = new Dictionary<string, object?>();
            foreach (var frame in frames)
            {
                latest[frame.Topic] = frame.Payload;
            }
            return latest;
        }
    }
}
