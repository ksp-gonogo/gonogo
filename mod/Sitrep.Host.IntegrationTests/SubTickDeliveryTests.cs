using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A sample whose signal delay is a fraction of a sample interval is delivered
    /// when the game's UT reaches its due time, not at the next sampled tick, and
    /// never before it.
    /// </summary>
    public class SubTickDeliveryTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private const double SmallDelay = 0.001;

        private static void Tick(ChannelEngine engine, double ut, double craft, double delay)
        {
            var snapshot = HomeLedgerTestUplink.Snapshot(ut, craft: craft, delay: delay, connected: true);
            snapshot.Values["vessel"] = new Dictionary<string, object?>
            {
                ["identity"] = new Dictionary<string, object?> { ["id"] = "G" },
            };
            engine.TickAndWait(ut, snapshot, Timeout);
        }

        private static async Task<List<StreamData<object?>>> Delivered(TestClient client) =>
            (await DrainAllStreamDataAsync(client, Quiet)).Where(f => f.Topic == HomeLedgerTestUplink.CraftTopic).ToList();

        [Fact]
        public async Task AZeroDelaySampleIsDeliveredInItsOwnTick()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, Timeout);

                Tick(engine, 100.0, craft: 1.0, delay: 0.0);
                Tick(engine, 101.0, craft: 2.0, delay: 0.0);

                var frames = await Delivered(client);
                Assert.NotEmpty(frames);
                Assert.Equal(2.0, Convert.ToDouble(frames[^1].Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASmallDelaySampleWaitsForItsDueTimeAndIsDeliveredWithoutATick()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, Timeout);

                Tick(engine, 100.0, craft: 1.0, delay: SmallDelay);
                Assert.Empty(await Delivered(client));

                engine.AdvanceDue(100.0 + SmallDelay / 2);
                Assert.Empty(await Delivered(client));

                engine.AdvanceDue(100.0 + SmallDelay * 2);
                var frames = await Delivered(client);
                Assert.Single(frames);
                Assert.Equal(1.0, Convert.ToDouble(frames[0].Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AdvancingBetweenTicksDoesNotMakeTheNextTickARewind()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HomeLedgerTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, HomeLedgerTestUplink.CraftTopic, Timeout);

                Tick(engine, 100.0, craft: 1.0, delay: SmallDelay);
                engine.AdvanceDue(100.5);
                Assert.Single(await Delivered(client));

                Tick(engine, 101.0, craft: 2.0, delay: SmallDelay);
                engine.AdvanceDue(101.5);
                var frames = await Delivered(client);
                Assert.Single(frames);
                Assert.Equal(2.0, Convert.ToDouble(frames[0].Payload));
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
