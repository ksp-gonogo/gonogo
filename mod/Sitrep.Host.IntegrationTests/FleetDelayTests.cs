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

                engine.TickAndWait(0.0, FleetFixture(0.0, ("near", 0.0), ("far", 0.0)), Timeout);
                engine.TickAndWait(1.0, FleetFixture(1.0, ("near", 0.0), ("far", 0.0)), Timeout);

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

        [Fact]
        public async Task EachFleetVesselIsDelayedByItsOwnLightTime()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "fleet.near.orbit", Timeout);
                await SubscribeAsync(client, "fleet.far.orbit", Timeout);

                // near light-time 2 s, far light-time 6 s. Emit at UT 0; the
                // capture calls SetVesselDelay per vessel, so each fleet.<id>
                // node carries its own DelayTo.
                for (var ut = 0.0; ut <= 6.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("near", 2.0), ("far", 6.0)), Timeout);
                }

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var near = frames.Where(f => f.Topic == "fleet.near.orbit").ToList();
                var far = frames.Where(f => f.Topic == "fleet.far.orbit").ToList();
                // Both eventually arrive, but "near" (delay 2) reveals its UT-0 sample
                // by UT 2, while "far" (delay 6) only reveals it by UT 6 -- proving each
                // vessel is delayed by its OWN light-time, not a shared one.
                Assert.NotEmpty(near);
                Assert.NotEmpty(far);
                var firstNearValidAt = near.Min(f => f.Meta.ValidAt);
                var firstFarValidAt = far.Min(f => f.Meta.ValidAt);
                // The UT-0 sample is what arrives first for each (validAt 0).
                Assert.Equal(0.0, firstNearValidAt);
                Assert.Equal(0.0, firstFarValidAt);
                // near delivered strictly earlier than far (its horizon is nearer).
                var nearArrival = near.Min(f => f.Meta.DeliveredAt);
                var farArrival = far.Min(f => f.Meta.DeliveredAt);
                Assert.True(nearArrival < farArrival,
                    $"near arrived at {nearArrival}, far at {farArrival} -- expected near strictly earlier");
            }
            finally
            {
                engine.Stop();
            }
        }

        // NOTE (Plan 2b): the Plan-2 `FleetFreezesTogetherOnGlobalDisconnectAndResumes`
        // test was REMOVED here -- its premise (all fleet topics freeze together on
        // the global link) is the one intended behaviour change of the per-subject
        // freeze rewrite. Its per-subject replacements (independent-freeze +
        // pre-outage-tail-drains) land in a later task, once the per-vessel
        // connectivity source exists.

        /// <summary>
        /// A KspSnapshot at <paramref name="ut"/> whose <c>vessels</c> roster
        /// carries each vessel's id, a per-vessel <c>delay</c> (one-way seconds,
        /// consumed by the test uplink's SetVesselDelay), and an orbit-element
        /// dict.
        /// </summary>
        internal static KspSnapshot FleetFixture(double ut, params (string id, double delay)[] vessels)
        {
            var roster = new List<object?>();
            foreach (var (id, delay) in vessels)
            {
                roster.Add(new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["delay"] = delay,
                    ["orbit"] = new Dictionary<string, object?>
                    {
                        ["sma"] = 700000.0,
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
                Ut = ut,
                Values = new Dictionary<string, object?> { ["vessels"] = roster },
            };
        }
    }
}
