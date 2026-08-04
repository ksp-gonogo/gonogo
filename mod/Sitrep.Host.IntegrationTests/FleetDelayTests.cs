using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Plan 2 (fleet under delay) integration tests: each fleet vessel gets its
    /// own delayed telemetry topic. Driven by <see cref="FleetDelayTestUplink"/>
    /// over the real WS harness (the same shape as <see cref="RevealGateTests"/>).
    /// </summary>
    public class FleetDelayTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        [Theory]
        [InlineData("fleet.abc-123.orbit", "fleet.abc-123")] // per-vessel topic -> its own node
        [InlineData("fleet.abc-123.comms", "fleet.abc-123")] // any field under a vessel shares the node
        [InlineData("vessel.orbit", "system")]               // active-vessel topics stay on the single node
        [InlineData("system.vessels", "system")]             // system topics unchanged
        [InlineData("comms.delay", "system")]
        [InlineData("fleet.abc-123", "system")]              // no field segment -> not a per-vessel topic
        public void NodeForTopicRoutesFleetTopicsToPerVesselNodes(string topic, string expectedNode)
        {
            Assert.Equal(expectedNode, ChannelEngine.NodeForTopic(topic));
        }

        [Fact]
        public async Task FleetVesselsEmitPerVesselOrbitTopics()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "fleet.near.orbit", Timeout);
                await SubscribeAsync(client, "fleet.far.orbit", Timeout);

                engine.TickAndWait(0.0, FleetFixture(("near", 700000.0), ("far", 900000.0)), Timeout);
                engine.TickAndWait(1.0, FleetFixture(("near", 700000.0), ("far", 900000.0)), Timeout);

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                // Both vessels materialize their own fleet.<id>.orbit topic and deliver.
                Assert.Contains(frames, f => f.Topic == "fleet.near.orbit");
                Assert.Contains(frames, f => f.Topic == "fleet.far.orbit");
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>A KspSnapshot whose <c>vessels</c> roster carries per-vessel id + orbit-element dicts.</summary>
        internal static KspSnapshot FleetFixture(params (string id, double sma)[] vessels)
        {
            var roster = new List<object?>();
            foreach (var (id, sma) in vessels)
            {
                roster.Add(new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["orbit"] = new Dictionary<string, object?>
                    {
                        ["sma"] = sma,
                        ["ecc"] = 0.0,
                        ["inc"] = 0.0,
                        ["meanAnomalyAtEpoch"] = 0.0,
                        ["epoch"] = 0.0,
                        ["mu"] = 3.5316000e12,
                        ["referenceBody"] = "Kerbin",
                    },
                });
            }
            return new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["vessels"] = roster },
            };
        }
    }
}
