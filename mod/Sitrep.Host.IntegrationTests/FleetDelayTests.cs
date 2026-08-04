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
                // near (delay 2) delivers its FIRST sample strictly earlier than
                // far (delay 6) -- the robust per-vessel-delay proof. (The exact
                // validAt of the first delivered sample is not asserted: under
                // LossyLatest a UT-0 sample can be coalesced past by the time its
                // scheduled delivery reads the archive, which is correct, not a
                // delay error.)
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

        [Fact]
        public async Task FleetVesselsFreezeIndependentlyOnTheirOwnLink()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "fleet.a.orbit", Timeout);
                await SubscribeAsync(client, "fleet.b.orbit", Timeout);

                // Both connected: both stream.
                engine.TickAndWait(0.0, ConnFixture(0.0, ("a", true), ("b", true)), Timeout);
                engine.TickAndWait(1.0, ConnFixture(1.0, ("a", true), ("b", true)), Timeout);
                var warm = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(warm, f => f.Topic == "fleet.a.orbit");
                Assert.Contains(warm, f => f.Topic == "fleet.b.orbit");

                // Disconnect ONLY a. b stays connected. Per-subject freeze: a's
                // in-blackout samples (validAt >= 2) are withheld; b keeps streaming.
                engine.TickAndWait(2.0, ConnFixture(2.0, ("a", false), ("b", true)), Timeout);
                engine.TickAndWait(3.0, ConnFixture(3.0, ("a", false), ("b", true)), Timeout);
                engine.TickAndWait(4.0, ConnFixture(4.0, ("a", false), ("b", true)), Timeout);
                var outage = await DrainAllStreamDataAsync(client, Quiet);
                // a: no sample captured during its blackout reaches the client.
                Assert.DoesNotContain(outage, f => f.Topic == "fleet.a.orbit" && f.Meta.ValidAt >= 2.0);
                // b: keeps streaming its own fresh samples (validAt >= 2 delivered).
                Assert.Contains(outage, f => f.Topic == "fleet.b.orbit" && f.Meta.ValidAt >= 2.0);

                // a reconnects: it resumes; b was never interrupted.
                engine.TickAndWait(5.0, ConnFixture(5.0, ("a", true), ("b", true)), Timeout);
                engine.TickAndWait(6.0, ConnFixture(6.0, ("a", true), ("b", true)), Timeout);
                var resumed = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(resumed, f => f.Topic == "fleet.a.orbit" && f.Meta.ValidAt >= 5.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task FleetSubjectFreezeMapsAreCleanedWhenAVesselGoesAway()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                var clientA = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var clientB = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(clientA, "fleet.a.orbit", Timeout);
                await SubscribeAsync(clientB, "fleet.b.orbit", Timeout);

                // Ticks populate the per-subject freeze maps for both vessels.
                engine.TickAndWait(0.0, ConnFixture(0.0, ("a", true), ("b", true)), Timeout);
                engine.TickAndWait(1.0, ConnFixture(1.0, ("a", true), ("b", true)), Timeout);
                await DrainAllStreamDataAsync(clientB, Quiet);
                Assert.True(engine.HasFreezeStateForSubject("fleet.a"));
                Assert.True(engine.HasFreezeStateForSubject("fleet.b"));

                // The only fleet.a subscriber disconnects. We do NOT tick during the
                // wait, so the gated capture cannot re-add fleet.a (in production a
                // torn-down vessel is likewise gone from the capture). Its freeze
                // maps are cleaned; fleet.b (still subscribed) is retained.
                await clientA.DisposeAsync();
                var deadline = DateTime.UtcNow + Timeout;
                while (engine.HasFreezeStateForSubject("fleet.a") && DateTime.UtcNow < deadline)
                {
                    await Task.Delay(20);
                }
                Assert.False(engine.HasFreezeStateForSubject("fleet.a")); // cleaned on disconnect
                Assert.True(engine.HasFreezeStateForSubject("fleet.b"));  // retained
            }
            finally
            {
                engine.Stop();
            }
        }

        // NOTE (Plan 2b): the Plan-2 `FleetFreezesTogetherOnGlobalDisconnectAndResumes`
        // test was REMOVED (its premise -- all fleet topics freeze together on the
        // global link -- is the one intended behaviour change). The pre-outage-tail-
        // drains case + active-vessel parity land in a later task.

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

        /// <summary>
        /// A KspSnapshot at <paramref name="ut"/> whose vessels carry a per-vessel
        /// <c>connected</c> flag (delay 0), for per-subject freeze tests.
        /// </summary>
        internal static KspSnapshot ConnFixture(double ut, params (string id, bool connected)[] vessels)
        {
            var roster = new List<object?>();
            foreach (var (id, connected) in vessels)
            {
                roster.Add(new Dictionary<string, object?>
                {
                    ["id"] = id,
                    ["delay"] = 0.0,
                    ["connected"] = connected,
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
