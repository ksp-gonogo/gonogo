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
        [InlineData("silence.abc-123.state", "fleet.abc-123")] // comms-owned reckoning shares the vessel's node
        [InlineData("silence.abc-123", "system")]              // no field segment -> not a per-vessel topic
        [InlineData("extension.abc-123.field", "fleet.abc-123")] // an Uplink's own declared namespace, same node
        public void NodeForTopicRoutesFleetTopicsToPerVesselNodes(string topic, string expectedNode)
        {
            // Through a REGISTERED engine: every namespace except core's own
            // "fleet." earns the per-vessel node by declaring PerVesselNode, so
            // the routing is only answerable once the uplink has registered.
            // Not started: registration is all the routing question needs, and
            // Stop() would join a thread that never ran.
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            Assert.Equal(expectedNode, engine.NodeFor(topic));
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
        public async Task FleetVesselDelayTopicEmitsAndSerializesEndToEnd()
        {
            // Plan 2c: fleet.<id>.delay carries FleetVesselLink (oneWaySeconds +
            // connected), emitted as a self-flattened dict. This proves it
            // serializes through the JsonWriter/WS boundary and arrives with its
            // values intact -- the coverage the .orbit-only tests missed, which
            // let a missing JsonWriter case (fixed by allowlisting the flattened
            // producer) reach the fold gate.
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "fleet.probe.delay", Timeout);

                // Every tick carries the same one-way delay (4.5), so whichever
                // sample LossyLatest delivers past the horizon carries it.
                for (var ut = 0.0; ut <= 5.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("probe", 4.5)), Timeout);
                }

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var delayFrame = frames.FirstOrDefault(f => f.Topic == "fleet.probe.delay");
                // Arriving at all proves FleetVesselLink serialized end-to-end
                // (no NotSupportedException at the JsonWriter boundary).
                Assert.NotNull(delayFrame);
                var payload = Assert.IsType<Dictionary<string, object?>>(delayFrame!.Payload);
                Assert.Equal(4.5, payload["oneWaySeconds"]);
                Assert.Equal(true, payload["connected"]);
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

                // near light-time 2 s, far light-time 6 s. Emit from UT 0; the
                // capture calls SetVesselDelay per vessel, so each fleet.<id>
                // node carries its own DelayTo.
                //
                // The proof is drained in two halves, at each vessel's own
                // light-time, rather than once at the end and compared by
                // DeliveredAt. LossyLatest may coalesce a burst of samples down
                // to the latest, so a single end-of-run drain can leave both
                // vessels' surviving frames sitting on the SAME delivery UT and
                // fail an ordering assertion for a reason that is correct
                // behaviour. Presence and absence survive coalescing intact:
                // it drops superseded frames, it never invents one and never
                // empties a stream that had something to reveal.
                for (var ut = 0.0; ut <= 2.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("near", 2.0), ("far", 6.0)), Timeout);
                }

                var byNearLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(byNearLightTime, f => f.Topic == "fleet.near.orbit");
                Assert.DoesNotContain(byNearLightTime, f => f.Topic == "fleet.far.orbit");

                for (var ut = 3.0; ut <= 6.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("near", 2.0), ("far", 6.0)), Timeout);
                }

                var byFarLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(byFarLightTime, f => f.Topic == "fleet.far.orbit");
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ADeclaredPerVesselNamespaceIsDelayedByEachVesselsOwnLightTime()
        {
            // The leak this closes is silent: a per-vessel topic under a
            // namespace core does not recognise records on the single default
            // node, so a Munar base's payload arrives at the ACTIVE craft's
            // light-time. The value still turns up, just early, with someone
            // else's delay on it, which no assertion about presence can see.
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, FleetDelayTestUplink.ExtensionPrefix + "near.field", Timeout);
                await SubscribeAsync(client, FleetDelayTestUplink.ExtensionPrefix + "far.field", Timeout);

                var nearTopic = FleetDelayTestUplink.ExtensionPrefix + "near.field";
                var farTopic = FleetDelayTestUplink.ExtensionPrefix + "far.field";

                // Drained at each vessel's own light-time rather than once at
                // the end: see EachFleetVesselIsDelayedByItsOwnLightTime for why
                // a DeliveredAt comparison is not safe against LossyLatest
                // coalescing, and presence/absence is.
                for (var ut = 0.0; ut <= 2.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("near", 2.0), ("far", 6.0)), Timeout);
                }

                var byNearLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(byNearLightTime, f => f.Topic == nearTopic);
                Assert.DoesNotContain(byNearLightTime, f => f.Topic == farTopic);

                for (var ut = 3.0; ut <= 6.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, FleetFixture(ut, ("near", 2.0), ("far", 6.0)), Timeout);
                }

                var byFarLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(byFarLightTime, f => f.Topic == farTopic);
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
        public async Task FleetVesselPreOutageTailDrainsThenFreezes()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, "fleet.v.orbit", Timeout);

                // v has light-time 3. Emit while CONNECTED at UT 0 and 1 (these are
                // in flight, scheduled to reveal at UT 3 and 4).
                engine.TickAndWait(0.0, TailFixture(0.0, connected: true), Timeout);
                engine.TickAndWait(1.0, TailFixture(1.0, connected: true), Timeout);
                // v DISCONNECTS at UT 2. Samples emitted during its blackout (validAt
                // >= 2) get +Inf and are withheld; the pre-outage tail (validAt 0, 1)
                // still reveals as the clock overtakes their horizon (UT 3, 4).
                for (var ut = 2.0; ut <= 6.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, TailFixture(ut, connected: false), Timeout);
                }

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                var v = frames.Where(f => f.Topic == "fleet.v.orbit").ToList();
                // The pre-outage tail drained (a connected sample, validAt < 2, revealed).
                Assert.Contains(v, f => f.Meta.ValidAt < 2.0);
                // No in-blackout sample (validAt >= 2) ever reached the client: frozen.
                Assert.DoesNotContain(v, f => f.Meta.ValidAt >= 2.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The officially-lost feature publishes <c>fleet.&lt;guid&gt;.contact</c>
        /// while the craft is dark: that is the only time it has anything to
        /// say. On the ordinary Delayed path every one of those samples takes an
        /// infinite reveal horizon and is then dropped on reconnect, so the
        /// operator would be told nothing at all about the vessel that went
        /// quiet, the exact opposite of the point. The channel is freeze-exempt
        /// (the treatment <c>comms.link</c> already carries) and this pins both
        /// halves: the report gets through, and it gets through no earlier than
        /// the vessel's last-known light-time allows.
        /// </summary>
        [Fact]
        public async Task AContactReportPublishedWhileTheVesselIsDarkStillReachesTheClient()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var contactTopic = "fleet.q" + ChannelEngine.ContactMetaSuffix;
                var silenceTopic = "silence.q.state";
                await SubscribeAsync(client, "fleet.q.orbit", Timeout);
                await SubscribeAsync(client, contactTopic, Timeout);
                await SubscribeAsync(client, silenceTopic, Timeout);

                // q is 3 light-seconds out while its link is up.
                engine.TickAndWait(0.0, ContactFixture(0.0, connected: true), Timeout);
                engine.TickAndWait(1.0, ContactFixture(1.0, connected: true), Timeout);
                await DrainAllStreamDataAsync(client, Quiet);

                // Dark from UT 2. Its routed light-time collapses to 0 in the same
                // tick (no path left to measure), as the live CommNet read does.
                for (var ut = 2.0; ut <= 4.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, ContactFixture(ut, connected: false), Timeout);
                }
                var duringOutage = await DrainAllStreamDataAsync(client, Quiet);
                // The exemption is not a free pass: the UT-2 report still waits
                // out the vessel's last-known 3-second light-time, so by UT 4
                // nothing from the blackout has surfaced. KSC cannot learn of the
                // silence ahead of the light that carries the evidence for it.
                Assert.DoesNotContain(duringOutage, f => f.Topic == contactTopic && f.Meta.ValidAt >= 2.0);
                Assert.DoesNotContain(duringOutage, f => f.Topic == silenceTopic && f.Meta.ValidAt >= 2.0);

                // Reconnect at UT 5: the point at which that subject's in-blackout
                // backlog is dropped, and at which the UT-2 report's horizon is
                // finally reached.
                engine.TickAndWait(5.0, ContactFixture(5.0, connected: true), Timeout);
                engine.TickAndWait(6.0, ContactFixture(6.0, connected: true), Timeout);
                engine.TickAndWait(7.0, ContactFixture(7.0, connected: true), Timeout);
                var afterHorizon = await DrainAllStreamDataAsync(client, Quiet);

                // The reports captured WHILE the craft was dark survived the
                // freeze and the reconnect drop, and reached the client.
                Assert.Contains(
                    afterHorizon,
                    f => f.Topic == contactTopic && f.Meta.ValidAt >= 2.0 && f.Meta.ValidAt <= 4.0);
                Assert.Contains(
                    afterHorizon,
                    f => f.Topic == silenceTopic && f.Meta.ValidAt >= 2.0 && f.Meta.ValidAt <= 4.0);
                // Surgical, not blanket: the SAME vessel's ordinary telemetry over
                // the SAME window is still frozen and dropped, in both phases.
                Assert.DoesNotContain(
                    duringOutage.Concat(afterHorizon),
                    f => f.Topic == "fleet.q.orbit" && f.Meta.ValidAt >= 2.0 && f.Meta.ValidAt <= 4.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Vessel "q" at a 3-second light-time while connected, collapsing to 0
        /// when it drops off the network (what the live routed read returns once
        /// there is no path to measure).
        /// </summary>
        private static KspSnapshot ContactFixture(double ut, bool connected)
        {
            var snap = ConnFixture(ut, ("q", connected));
            ((Dictionary<string, object?>)((List<object?>)snap.Values["vessels"]!)[0]!)["delay"] = connected ? 3.0 : 0.0;
            return snap;
        }

        private static KspSnapshot TailFixture(double ut, bool connected)
        {
            var snap = ConnFixture(ut, ("v", connected));
            // Give v a non-zero light-time so its pre-outage samples are genuinely
            // in flight (horizon ahead of the disconnect), not delivered instantly.
            ((Dictionary<string, object?>)((List<object?>)snap.Values["vessels"]!)[0]!)["delay"] = 3.0;
            return snap;
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
