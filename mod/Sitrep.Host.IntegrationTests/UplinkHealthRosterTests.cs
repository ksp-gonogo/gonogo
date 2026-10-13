using System;
using System.Collections.Generic;
using System.Text.Json;
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
    /// The health an Uplink reports reaches <c>system.uplinks</c> whenever it
    /// changes, including while the active craft is out of contact, which is
    /// when a forced comms blackout reports itself.
    /// </summary>
    public class UplinkHealthRosterTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        [Fact]
        public async Task AHealthChangeReachesTheRosterWhileTheActiveCraftIsOutOfContact()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HealthTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeToRosterAsync(engine, client);

                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                Assert.Equal(0, await LastStateAsync(client));

                uplink.Health_ = new UplinkHealth(UplinkHealthState.Degraded, "forced blackout");
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);
                engine.TickAndWait(3.0, new KspSnapshot { Ut = 3.0 }, Timeout);

                Assert.Equal(1, await LastStateAsync(client));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASubscriberJoiningAfterAHealthChangeIsHandedTheCurrentHealthFirst()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HealthTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using (var early = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeToRosterAsync(engine, early);
                    engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                    Assert.Equal(0, await LastStateAsync(early));
                }

                // Nobody is subscribed while the health changes.
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);
                uplink.Health_ = new UplinkHealth(UplinkHealthState.Degraded, "forced blackout");
                engine.TickAndWait(3.0, new KspSnapshot { Ut = 3.0 }, Timeout);

                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeToRosterAsync(engine, late);
                engine.TickAndWait(4.0, new KspSnapshot { Ut = 4.0 }, Timeout);
                Assert.Equal(1, await FirstStateAsync(late));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static async Task SubscribeToRosterAsync(ChannelEngine engine, TestClient client)
        {
            await client.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = ChannelEngine.UplinksTopic }));
            var deadline = DateTime.UtcNow + Timeout;
            while (engine.SubscriberCountFor(ChannelEngine.UplinksTopic) == 0)
            {
                if (DateTime.UtcNow > deadline)
                {
                    throw new TimeoutException("The engine never took the subscription.");
                }
                await Task.Delay(5);
            }
        }

        private static async Task<int> FirstStateAsync(TestClient client)
        {
            var frames = await DrainAllStreamDataAsync(client, Quiet);
            foreach (var frame in frames)
            {
                if (frame.Topic == ChannelEngine.UplinksTopic)
                {
                    return StateOf(frame);
                }
            }
            return -1;
        }

        private static int StateOf(StreamData frame)
        {
            var state = -1;
            if (frame.Payload is not Dictionary<string, object?> payload)
            {
                return state;
            }
            foreach (var entry in (IEnumerable<object?>)payload["uplinks"]!)
            {
                var row = (Dictionary<string, object?>)entry!;
                if ((string?)row["id"] == "health-roster-test")
                {
                    state = Convert.ToInt32(((Dictionary<string, object?>)row["health"]!)["state"]);
                }
            }
            return state;
        }

        private static async Task<int> LastStateAsync(TestClient client)
        {
            var state = -1;
            foreach (var frame in await DrainAllStreamDataAsync(client, Quiet))
            {
                if (frame.Topic != ChannelEngine.UplinksTopic || frame.Payload is not Dictionary<string, object?> payload)
                {
                    continue;
                }
                foreach (var entry in (IEnumerable<object?>)payload["uplinks"]!)
                {
                    var row = (Dictionary<string, object?>)entry!;
                    if ((string?)row["id"] == "health-roster-test")
                    {
                        var health = (Dictionary<string, object?>)row["health"]!;
                        state = Convert.ToInt32(health["state"]);
                    }
                }
            }
            return state;
        }

        private sealed class HealthTestUplink : ISitrepUplink
        {
            public UplinkHealth Health_ = UplinkHealth.Healthy;

            public UplinkHealth Health() => Health_;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "health-roster-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
            };

            public void Register(IUplinkHost host)
            {
                // The active craft is out of contact for the whole test.
                host.SetConnectivitySource(_ => false);
            }
        }
    }
}
